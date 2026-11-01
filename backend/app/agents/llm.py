"""Model client: talks to the OpenAI API (the model name and key come from agent settings / environment)."""
from dataclasses import dataclass, field
from typing import Any, Protocol

from app.core.config import get_settings


class LLMError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


@dataclass
class ToolCallRequest:
    id: str
    name: str
    arguments: str  # raw JSON string from the model


@dataclass
class AssistantTurn:
    content: str | None
    tool_calls: list[ToolCallRequest] = field(default_factory=list)


class LLMClient(Protocol):
    name: str

    def chat(self, messages: list[dict], tools: list[dict] | None, model: str, temperature: float) -> AssistantTurn: ...


class OpenAIClient:
    name = "openai"

    def __init__(self):
        from openai import OpenAI
        s = get_settings()
        self._client = OpenAI(api_key=s.openai_api_key, timeout=s.openai_timeout_seconds,
                              max_retries=s.openai_max_retries)

    def chat(self, messages, tools, model, temperature) -> AssistantTurn:
        kwargs: dict[str, Any] = {"model": model, "messages": messages, "temperature": temperature}
        if tools:
            kwargs["tools"] = [{"type": "function", "function": t} for t in tools]
        try:
            resp = self._client.chat.completions.create(**kwargs)
        except Exception as exc:  # map provider errors to user-safe messages; never leak internals
            kind = type(exc).__name__
            if kind == "AuthenticationError":
                raise LLMError("openai_auth", "OpenAI rejected the configured API key.") from exc
            if kind == "RateLimitError":
                raise LLMError("openai_rate_limited", "OpenAI rate limit or quota reached. Try again later.") from exc
            if kind in ("APITimeoutError", "Timeout"):
                raise LLMError("openai_timeout", "The model provider timed out.") from exc
            if kind == "APIConnectionError":
                raise LLMError("openai_unreachable", "Could not reach the model provider.") from exc
            if kind == "NotFoundError":
                raise LLMError("openai_model_not_found", f"Model '{model}' was not found for this API key.") from exc
            raise LLMError("openai_error", "The model provider returned an error.") from exc
        msg = resp.choices[0].message
        calls = [ToolCallRequest(c.id, c.function.name, c.function.arguments or "{}")
                 for c in (msg.tool_calls or [])]
        return AssistantTurn(content=msg.content, tool_calls=calls)


def make_llm() -> LLMClient:
    if not get_settings().openai_configured:
        raise LLMError("openai_not_configured", "OPENAI_API_KEY is not configured on the server.")
    return OpenAIClient()