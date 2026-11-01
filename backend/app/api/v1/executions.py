import asyncio
import json
import time

from fastapi import APIRouter, Depends, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import Principal, execution_principal, get_owned
from app.core.exceptions import Forbidden
from app.db.session import get_db, get_sessionmaker
from app.middleware.ratelimit import check, limit_api
from app.models import Agent, Execution, ExecutionApproval, ExecutionEvent
from app.models.execution import TERMINAL
from app.schemas.resources import ApprovalDecision, ExecutionCreate, ExecutionOut, Page
from app.services import execution_service as svc

router = APIRouter(prefix="/executions", tags=["executions"], dependencies=[Depends(limit_api)])
MAX_STREAM_SECONDS = 600
HEARTBEAT_SECONDS = 15


def principal_with(scope: str):
    def dep(p: Principal = Depends(execution_principal)) -> Principal:
        if p.api_key is not None:
            if scope not in (p.api_key.scopes or []):
                raise Forbidden(f"API key lacks the '{scope}' scope", code="insufficient_scope")
            from app.core.config import get_settings
            check(f"key:{p.api_key.id}", get_settings().rate_limit_api)
        return p
    return dep


def _out(db: Session, e: Execution) -> ExecutionOut:
    name = db.scalar(select(Agent.name).where(Agent.id == e.agent_id)) if e.agent_id else None
    pending = None
    if e.status == "awaiting_approval":
        ap = db.scalar(select(ExecutionApproval).where(ExecutionApproval.execution_id == e.id,
                                                       ExecutionApproval.status == "pending"))
        if ap:
            pending = {"approval_id": ap.id, "tool": ap.tool_name, "arguments": ap.arguments}
    return ExecutionOut(id=e.id, agent_id=e.agent_id, agent_name=name, workflow_id=e.workflow_id, task=e.task,
                        params=e.params or {}, status=e.status, mode=e.mode, result=e.result, error=e.error,
                        source=e.source, created_at=e.created_at, started_at=e.started_at,
                        finished_at=e.finished_at, duration_ms=e.duration_ms, pending_approval=pending)


@router.post("", response_model=ExecutionOut, status_code=202)
def create(body: ExecutionCreate, p: Principal = Depends(principal_with("executions:write")),
           db: Session = Depends(get_db)):
    ex = svc.create_execution(db, p.user.id, body, "api" if p.api_key else "ui", p.api_key.id if p.api_key else None)
    svc.submit(ex.id)
    return _out(db, ex)


@router.get("", response_model=Page[ExecutionOut])
def list_executions(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), status: str | None = None,
                    agent_id: str | None = None, workflow_id: str | None = None,
                    p: Principal = Depends(principal_with("executions:read")), db: Session = Depends(get_db)):
    stmt = select(Execution).where(Execution.owner_id == p.user.id)
    if status:
        stmt = stmt.where(Execution.status == status)
    if agent_id:
        stmt = stmt.where(Execution.agent_id == agent_id)
    if workflow_id:
        stmt = stmt.where(Execution.workflow_id == workflow_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(Execution.created_at.desc()).offset((page - 1) * page_size)
                      .limit(page_size)).all()
    return Page(items=[_out(db, e) for e in rows], total=total, page=page, page_size=page_size)


@router.get("/{execution_id}", response_model=ExecutionOut)
def get_execution(execution_id: str, p: Principal = Depends(principal_with("executions:read")),
                  db: Session = Depends(get_db)):
    return _out(db, get_owned(db, Execution, execution_id, p.user.id, "Execution"))


@router.get("/{execution_id}/events")
def list_events(execution_id: str, after_id: int = Query(0, ge=0), limit: int = Query(500, ge=1, le=1000),
                p: Principal = Depends(principal_with("executions:read")), db: Session = Depends(get_db)):
    get_owned(db, Execution, execution_id, p.user.id, "Execution")
    rows = db.scalars(select(ExecutionEvent).where(ExecutionEvent.execution_id == execution_id,
                                                   ExecutionEvent.id > after_id)
                      .order_by(ExecutionEvent.id).limit(limit)).all()
    return {"events": [svc.event_dict(e) for e in rows]}


@router.post("/{execution_id}/cancel", response_model=ExecutionOut)
def cancel(execution_id: str, p: Principal = Depends(principal_with("executions:write")),
           db: Session = Depends(get_db)):
    ex = get_owned(db, Execution, execution_id, p.user.id, "Execution")
    return _out(db, svc.cancel_execution(db, ex))


@router.post("/{execution_id}/approval", response_model=ExecutionOut)
def decide(execution_id: str, body: ApprovalDecision, p: Principal = Depends(principal_with("executions:write")),
           db: Session = Depends(get_db)):
    if p.api_key is not None:
        raise Forbidden("Approvals must be given by a signed-in user, not an API key", code="approval_requires_user")
    ex = get_owned(db, Execution, execution_id, p.user.id, "Execution")
    svc.decide_approval(db, ex, body.approve)
    return _out(db, ex)


def _sse(event_id: int | None, type_: str, data: dict) -> str:
    head = f"id: {event_id}\n" if event_id is not None else ""
    return f"{head}event: {type_}\ndata: {json.dumps(data)}\n\n"


def _fetch(execution_id: str, after: int):
    with get_sessionmaker()() as db:
        events = db.scalars(select(ExecutionEvent).where(ExecutionEvent.execution_id == execution_id,
                                                         ExecutionEvent.id > after)
                            .order_by(ExecutionEvent.id).limit(200)).all()
        status = db.scalar(select(Execution.status).where(Execution.id == execution_id))
        return [svc.event_dict(e) for e in events], status


@router.get("/{execution_id}/stream")
async def stream(execution_id: str, request: Request, last_event_id: int | None = Query(None),
                 p: Principal = Depends(principal_with("executions:read")), db: Session = Depends(get_db)):
    """Server-Sent Events. Resume with the Last-Event-ID header (sent automatically by EventSource on reconnect)
    or ?last_event_id=. Persisted events are replayed, then new ones are pushed until the run is terminal."""
    get_owned(db, Execution, execution_id, p.user.id, "Execution")
    db.close()
    header = request.headers.get("last-event-id")
    after = last_event_id if last_event_id is not None else (int(header) if header and header.isdigit() else 0)

    async def gen():
        nonlocal after
        started = last_beat = time.monotonic()
        yield "retry: 2000\n\n"
        while True:
            if await request.is_disconnected():
                return
            events, status = await run_in_threadpool(_fetch, execution_id, after)
            for ev in events:
                yield _sse(ev["id"], ev["type"], ev)
                after = ev["id"]
                last_beat = time.monotonic()
            if status in TERMINAL and not events:
                yield _sse(None, "stream.end", {"v": 1, "execution_id": execution_id, "status": status})
                return
            if time.monotonic() - started > MAX_STREAM_SECONDS:
                yield _sse(None, "stream.timeout", {"v": 1, "message": "Reconnect to continue"})
                return
            if not events:
                if time.monotonic() - last_beat >= HEARTBEAT_SECONDS:
                    yield _sse(None, "heartbeat", {"v": 1, "type": "heartbeat"})
                    last_beat = time.monotonic()
                await asyncio.sleep(0.4)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no",
                                      "Connection": "keep-alive"})
