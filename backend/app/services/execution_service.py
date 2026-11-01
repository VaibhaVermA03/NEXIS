"""Execution lifecycle: create, run in a bounded worker pool, persist events, cancel, approve, recover.

Durability model: state and events are persisted in the database; the work itself runs in an in-process thread
pool with a concurrency limit. If the process dies, in-flight runs are marked failed on next startup and queued runs
are resubmitted. For horizontal scale, replace `submit()` with a queue consumer (documented in DEPLOYMENT.md)."""
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.agents.graph import run_agent_graph
from app.agents.llm import LLMError, make_llm
from app.agents.nodes import AgentSnapshot, RunContext
from app.agents.policies import sanitize
from app.agents.registry import resolve_agent_tools
from app.core.config import get_settings
from app.core.exceptions import AppError, Conflict, NotFound, RateLimited
from app.core.security import utcnow
from app.db.session import get_sessionmaker
from app.models import Agent, Execution, ExecutionApproval, ExecutionEvent, Workflow
from app.models.execution import TERMINAL
from app.services.auth_service import audit

log = logging.getLogger("nexis.exec")
MAX_ACTIVE_PER_USER = 10
ACTIVE = ("queued", "running", "awaiting_approval")

_executor: ThreadPoolExecutor | None = None
_executor_lock = threading.Lock()


class ExecutionCancelled(Exception):
    pass


class ExecutionTimeout(Exception):
    pass


def get_executor() -> ThreadPoolExecutor:
    global _executor
    with _executor_lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=get_settings().execution_max_concurrency,
                                           thread_name_prefix="nexis-exec")
        return _executor


def shutdown_executor() -> None:
    global _executor
    with _executor_lock:
        if _executor:
            _executor.shutdown(wait=False, cancel_futures=True)
        _executor = None


def submit(execution_id: str) -> None:
    get_executor().submit(run_execution, execution_id)


def _aware(dt: datetime | None):
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=utcnow().tzinfo)


# ---------------- events ----------------
def emit(execution_id: str, type_: str, payload: dict | None = None) -> int:
    with get_sessionmaker()() as db:
        ev = ExecutionEvent(execution_id=execution_id, type=type_, payload=sanitize(payload or {}))
        db.add(ev)
        db.commit()
        return ev.id


def event_dict(ev: ExecutionEvent) -> dict:
    return {"v": 1, "id": ev.id, "execution_id": ev.execution_id, "type": ev.type,
            "timestamp": _aware(ev.created_at).isoformat(), "payload": ev.payload}


# ---------------- creation ----------------
def create_execution(db: Session, owner_id: str, body, source: str, api_key_id: str | None) -> Execution:
    s = get_settings()
    if not s.openai_configured:
        raise AppError("AI execution is disabled: OPENAI_API_KEY is not configured on the server. "
                       "Set it in the backend environment and restart.",
                       status_code=409, code="openai_not_configured")
    active = db.scalar(select(func.count()).select_from(Execution).where(
        Execution.owner_id == owner_id, Execution.status.in_(ACTIVE))) or 0
    if active >= MAX_ACTIVE_PER_USER:
        raise RateLimited("Too many executions in progress. Wait for some to finish or cancel them.")
    params = {}
    if body.params:
        for k in ("max_steps",):
            if k in body.params:
                v = body.params[k]
                if not isinstance(v, int) or isinstance(v, bool) or not 1 <= v <= 10:
                    raise AppError("params.max_steps must be an integer between 1 and 10", status_code=422,
                                   code="validation_error")
                params[k] = v
        unknown = set(body.params) - {"max_steps"}
        if unknown:
            raise AppError(f"Unknown params: {', '.join(sorted(unknown))}", status_code=422, code="validation_error")
    agent_id = None
    if body.agent_id:
        agent = db.get(Agent, body.agent_id)
        if not agent or agent.owner_id != owner_id:
            raise NotFound("Agent not found")
        if not agent.enabled:
            raise Conflict("This agent is disabled. Enable it to run tasks.", code="agent_disabled")
        agent_id = agent.id
    else:
        wf = db.get(Workflow, body.workflow_id)
        if not wf or wf.owner_id != owner_id:
            raise NotFound("Workflow not found")
        if not wf.enabled:
            raise Conflict("This workflow is disabled.", code="workflow_disabled")
    ex = Execution(owner_id=owner_id, agent_id=agent_id, workflow_id=body.workflow_id, task=body.task.strip(),
                   params=params, mode="live", status="queued", source=source, api_key_id=api_key_id)
    db.add(ex)
    audit(db, owner_id, "execution.created", "execution", ex.id, source=source)
    db.commit()
    emit(ex.id, "execution.accepted", {"source": source,
                                       "target": "workflow" if body.workflow_id else "agent"})
    return ex


# ---------------- run ----------------
def _finish(execution_id: str, status: str, result: str | None = None, error: str | None = None,
            event_payload: dict | None = None) -> None:
    """Status update + terminal event in ONE transaction so streams never end before the final event."""
    with get_sessionmaker()() as db:
        ex = db.get(Execution, execution_id)
        if ex is None or ex.status in TERMINAL:
            return
        now = utcnow()
        ex.status, ex.result, ex.error, ex.finished_at = status, result, error, now
        if ex.started_at:
            ex.duration_ms = int((now - _aware(ex.started_at)).total_seconds() * 1000)
        for ap in db.scalars(select(ExecutionApproval).where(ExecutionApproval.execution_id == execution_id,
                                                             ExecutionApproval.status == "pending")):
            ap.status, ap.decided_at = "expired", now
        db.add(ExecutionEvent(execution_id=execution_id, type=f"execution.{status}",
                              payload=sanitize({"duration_ms": ex.duration_ms, **(event_payload or {})})))
        db.commit()


def _make_check(execution_id: str, deadline: list[float]):
    def check() -> None:
        with get_sessionmaker()() as db:
            cancelled = db.scalar(select(Execution.cancel_requested).where(Execution.id == execution_id))
        if cancelled:
            raise ExecutionCancelled
        if time.monotonic() > deadline[0]:
            raise ExecutionTimeout
    return check


def _make_approval(execution_id: str, check, deadline: list[float]):
    timeout = get_settings().approval_timeout_seconds

    def request(tool: str, args: dict) -> bool:
        with get_sessionmaker()() as db:
            ap = ExecutionApproval(execution_id=execution_id, tool_name=tool, arguments=args)
            db.add(ap)
            db.get(Execution, execution_id).status = "awaiting_approval"
            db.commit()
            ap_id = ap.id
        emit(execution_id, "approval.required", {"approval_id": ap_id, "tool": tool, "arguments": args,
                                                 "timeout_seconds": timeout,
                                                 "description": f"Approval needed before running '{tool}'"})
        begin = time.monotonic()
        status = "pending"
        try:
            while True:
                check()
                with get_sessionmaker()() as db:
                    status = db.scalar(select(ExecutionApproval.status).where(ExecutionApproval.id == ap_id))
                if status != "pending":
                    break
                if time.monotonic() - begin > timeout:
                    with get_sessionmaker()() as db:
                        a = db.get(ExecutionApproval, ap_id)
                        if a.status == "pending":
                            a.status, a.decided_at = "expired", utcnow()
                            db.commit()
                    status = "expired"
                    break
                time.sleep(0.3)
        finally:
            deadline[0] += time.monotonic() - begin  # waiting for a human doesn't consume the run budget
        with get_sessionmaker()() as db:
            ex = db.get(Execution, execution_id)
            if ex.status == "awaiting_approval":
                ex.status = "running"
                db.commit()
        emit(execution_id, {"approved": "approval.granted", "rejected": "approval.denied",
                            "expired": "approval.expired"}.get(status, "approval.expired"),
             {"approval_id": ap_id, "tool": tool})
        return status == "approved"
    return request


def _snapshot(a: Agent, override_steps: int | None) -> AgentSnapshot:
    return AgentSnapshot(a.id, a.name, a.model, a.temperature, min(a.max_steps, override_steps or a.max_steps))


def run_execution(execution_id: str) -> None:
    sm = get_sessionmaker()
    s = get_settings()
    with sm() as db:
        ex = db.get(Execution, execution_id)
        if ex is None or ex.status != "queued":
            return  # cancelled before pickup
        ex.status, ex.started_at = "running", utcnow()
        db.commit()
        owner_id, task, params = ex.owner_id, ex.task, dict(ex.params or {})
        agent_id, workflow_id = ex.agent_id, ex.workflow_id
    emit(execution_id, "execution.started", {})
    deadline = [time.monotonic() + s.execution_max_seconds]
    check = _make_check(execution_id, deadline)
    approval = _make_approval(execution_id, check, deadline)
    emitter = lambda t, p=None: emit(execution_id, t, p)  # noqa: E731
    try:
        llm = make_llm()
        steps: list[tuple[AgentSnapshot, str, dict, str, str]] = []  # (snapshot, instructions, tools, instruction)
        with sm() as db:
            if workflow_id:
                wf = db.get(Workflow, workflow_id)
                if not wf or not wf.steps:
                    raise LLMError("workflow_missing", "The workflow no longer exists or has no steps.")
                for st in wf.steps:
                    ag = db.get(Agent, st.agent_id)
                    if not ag or ag.owner_id != owner_id or not ag.enabled:
                        raise LLMError("agent_unavailable", "A workflow step references an unavailable agent.")
                    steps.append((_snapshot(ag, params.get("max_steps")), ag.system_instructions,
                                  resolve_agent_tools(db, ag), st.instruction))
            else:
                ag = db.get(Agent, agent_id)
                if not ag or ag.owner_id != owner_id:
                    raise LLMError("agent_unavailable", "The agent no longer exists.")
                steps.append((_snapshot(ag, params.get("max_steps")), ag.system_instructions,
                              resolve_agent_tools(db, ag), task))
        emitter("agent.planning", {"description": "Task classification started", "steps": len(steps),
                                   "tools": sorted({n for _, _, t, _ in steps for n in t})})
        previous, result = "", ""
        for idx, (snap, instructions, tools, instruction) in enumerate(steps):
            if workflow_id:
                emitter("workflow.step.started", {"step": idx + 1, "total": len(steps), "agent": snap.name})
                prompt = instruction.replace("{{input}}", task).replace("{{previous}}", previous)
                if idx == 0 and "{{input}}" not in instruction:
                    prompt += f"\n\nInput: {task}"
            else:
                prompt = instruction
            ctx = RunContext(execution_id, owner_id, snap, {t.name: t for t in tools.values()}, llm, emitter, check,
                             approval, sm, stream_final=(idx == len(steps) - 1))
            result = run_agent_graph(ctx, instructions, prompt)
            if workflow_id:
                emitter("workflow.step.completed", {"step": idx + 1, "total": len(steps), "agent": snap.name})
            previous = result
        _finish(execution_id, "completed", result=result)
    except ExecutionCancelled:
        _finish(execution_id, "cancelled", error="Cancelled by user")
    except ExecutionTimeout:
        _finish(execution_id, "failed", error=f"Execution exceeded the {s.execution_max_seconds}s time limit",
                event_payload={"code": "timeout"})
    except LLMError as exc:
        _finish(execution_id, "failed", error=exc.message, event_payload={"code": exc.code, "message": exc.message})
    except Exception:
        log.exception("Execution %s failed unexpectedly", execution_id)
        _finish(execution_id, "failed", error="An internal error occurred while running this execution.",
                event_payload={"code": "internal_error"})


# ---------------- cancel / approve / recover ----------------
def cancel_execution(db: Session, ex: Execution) -> Execution:
    if ex.status in TERMINAL:
        raise Conflict("Execution has already finished", code="already_finished")
    ex.cancel_requested = True
    was_queued = ex.status == "queued"
    db.commit()
    if was_queued:
        _finish(ex.id, "cancelled", error="Cancelled by user")
    db.refresh(ex)
    return ex


def decide_approval(db: Session, ex: Execution, approve: bool) -> ExecutionApproval:
    ap = db.scalar(select(ExecutionApproval).where(ExecutionApproval.execution_id == ex.id,
                                                   ExecutionApproval.status == "pending")
                   .order_by(ExecutionApproval.created_at.desc()))
    if not ap:
        raise Conflict("There is no pending approval for this execution", code="no_pending_approval")
    ap.status, ap.decided_at = ("approved" if approve else "rejected"), utcnow()
    audit(db, ex.owner_id, "execution.approval", "execution", ex.id, tool=ap.tool_name, approved=approve)
    db.commit()
    return ap


def recover_interrupted() -> dict:
    """Startup: fail runs that were in flight when the process stopped; resubmit still-queued runs."""
    failed = requeued = 0
    with get_sessionmaker()() as db:
        stale = db.scalars(select(Execution).where(Execution.status.in_(ACTIVE))).all()
        ids = [(e.id, e.status) for e in stale]
    for eid, status in ids:
        if status == "queued":
            submit(eid)
            requeued += 1
        else:
            _finish(eid, "failed", error="Interrupted by a server restart", event_payload={"code": "interrupted"})
            failed += 1
    return {"failed": failed, "requeued": requeued}