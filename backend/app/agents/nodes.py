"""LangGraph nodes. All side effects flow through RunContext; every policy check is enforced here, not by the model."""
import json
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.agents.llm import LLMClient, LLMError
from app.agents.policies import sanitize, wrap_tool_result
from app.agents.prompts import BUDGET_NOTE
from app.agents.registry import ToolContext, ToolSpec, validate_arguments
from app.agents.state import AgentState
from app.tools.http_tools import ToolExecutionError

log = logging.getLogger("nexis.agent")
CHUNK = 80


@dataclass
class AgentSnapshot:
    id: str
    name: str
    model: str
    temperature: float
    max_steps: int


@dataclass
class RunContext:
    execution_id: str
    owner_id: str
    agent: AgentSnapshot
    tools: dict[str, ToolSpec]          # keyed by function name; ONLY tools granted to this agent
    llm: LLMClient
    emit: Callable[[str, dict], int]
    check: Callable[[], None]           # raises on cancel/timeout
    request_approval: Callable[[str, dict], bool]
    session_factory: Callable[[], Any]
    stream_final: bool = True           # False for intermediate workflow steps


def _tool_schemas(ctx: RunContext) -> list[dict]:
    return [{"name": s.name, "description": s.description, "parameters": s.input_schema} for s in ctx.tools.values()]


def model_node(ctx: RunContext):
    def run(state: AgentState) -> AgentState:
        ctx.check()
        step = state.get("step", 0) + 1
        exhausted = step > ctx.agent.max_steps
        messages = list(state["messages"])
        ctx.emit("agent.step.started", {"step": step, "agent": ctx.agent.name,
                                        "description": "Deciding next action" if not exhausted
                                        else "Step budget reached; composing final answer"})
        if exhausted:
            messages.append({"role": "system", "content": BUDGET_NOTE})
        try:
            turn = ctx.llm.chat(messages, None if exhausted else (_tool_schemas(ctx) or None), ctx.agent.model,
                                ctx.agent.temperature)
        except LLMError:
            raise
        assistant: dict[str, Any] = {"role": "assistant", "content": turn.content or ""}
        calls = [] if exhausted else turn.tool_calls
        if calls:
            assistant["tool_calls"] = [{"id": c.id, "type": "function",
                                        "function": {"name": c.name, "arguments": c.arguments}} for c in calls]
            # interim assistant text next to tool calls is intentionally NOT surfaced
        return {"messages": [*state["messages"], assistant], "step": step, "budget_exhausted": exhausted,
                "pending_calls": [{"id": c.id, "name": c.name, "arguments": c.arguments} for c in calls],
                "final": None if calls else (turn.content or "").strip() or "(The model returned an empty response.)"}
    return run


def route(state: AgentState) -> str:
    return "tools" if state.get("pending_calls") else "finalize"


def _fail(ctx: RunContext, call: dict, code: str, message: str, started: float | None = None) -> str:
    ctx.emit("tool.execution.failed", {"tool": call["name"], "call_id": call["id"], "code": code,
                                       "message": message[:300],
                                       "duration_ms": int((time.monotonic() - started) * 1000) if started else 0})
    return wrap_tool_result(call["name"], {"error": message[:300], "code": code})


def tools_node(ctx: RunContext):
    def run(state: AgentState) -> AgentState:
        messages = list(state["messages"])
        for call in state.get("pending_calls", []):
            ctx.check()
            name = call["name"]
            spec = ctx.tools.get(name)
            if spec is None:  # independent authorization: model cannot call tools outside the agent's grant
                content = _fail(ctx, call, "tool_not_permitted", f"Tool '{name}' is not available to this agent")
                messages.append({"role": "tool", "tool_call_id": call["id"], "content": content})
                continue
            try:
                args = json.loads(call["arguments"] or "{}")
                if not isinstance(args, dict):
                    raise ValueError
            except ValueError:
                content = _fail(ctx, call, "invalid_arguments", "Arguments must be a JSON object")
                messages.append({"role": "tool", "tool_call_id": call["id"], "content": content})
                continue
            try:
                validate_arguments(spec.input_schema, args)
            except ToolExecutionError as exc:
                messages.append({"role": "tool", "tool_call_id": call["id"],
                                 "content": _fail(ctx, call, exc.code, exc.message)})
                continue
            ctx.emit("tool.call.requested", {
                "tool": name, "call_id": call["id"], "arguments": sanitize(args), "side_effect": spec.side_effect,
                "requires_approval": spec.requires_approval,
                "description": f"Agent requested tool '{name}'"})
            if spec.requires_approval and not ctx.request_approval(name, sanitize(args)):
                content = _fail(ctx, call, "approval_denied", "The user did not approve this action; it was not performed")
                messages.append({"role": "tool", "tool_call_id": call["id"], "content": content})
                continue
            started = time.monotonic()
            ctx.emit("tool.execution.started", {"tool": name, "call_id": call["id"]})
            try:
                with ctx.session_factory() as db:
                    result = spec.run(ToolContext(db, ctx.owner_id, ctx.execution_id), args)
            except ToolExecutionError as exc:
                content = _fail(ctx, call, exc.code, exc.message, started)
            except Exception:
                log.exception("Tool %s crashed", name)
                content = _fail(ctx, call, "tool_error", "The tool failed unexpectedly", started)
            else:
                preview = sanitize(result)
                ctx.emit("tool.execution.completed", {
                    "tool": name, "call_id": call["id"],
                    "duration_ms": int((time.monotonic() - started) * 1000), "result_preview": preview})
                content = wrap_tool_result(name, result)
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": content})
        ctx.emit("agent.resumed", {"description": "Tool results returned to the agent"})
        return {"messages": messages, "pending_calls": []}
    return run


def finalize_node(ctx: RunContext):
    def run(state: AgentState) -> AgentState:
        ctx.check()
        final = state.get("final") or ""
        if ctx.stream_final:
            ctx.emit("agent.response.started", {"description": "Writing final response"})
            for i in range(0, len(final), CHUNK):  # chunked after generation (not token-level streaming)
                ctx.emit("agent.response.delta", {"text": final[i:i + CHUNK]})
        return {"final": final}
    return run