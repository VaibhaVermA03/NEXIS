from typing import Any, TypedDict


class AgentState(TypedDict, total=False):
    messages: list[dict[str, Any]]   # OpenAI-style chat messages
    pending_calls: list[dict[str, Any]]
    step: int                        # number of model invocations so far
    final: str | None
    budget_exhausted: bool
