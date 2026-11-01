"""Sanitization of event payloads and tool-result framing. Policy checks never rely on the model."""
import json
from typing import Any

from app.core.logging import redact

MAX_STR = 2000
SENSITIVE_KEYS = {"password", "secret", "token", "api_key", "apikey", "authorization", "cookie", "secret_value"}


def sanitize(value: Any, depth: int = 0) -> Any:
    """JSON-safe, size-bounded, secret-redacted copy suitable for persisting and streaming."""
    if depth > 6:
        return "…"
    if isinstance(value, dict):
        return {str(k)[:80]: ("[REDACTED]" if str(k).lower() in SENSITIVE_KEYS else sanitize(v, depth + 1))
                for k, v in list(value.items())[:50]}
    if isinstance(value, (list, tuple)):
        return [sanitize(v, depth + 1) for v in list(value)[:50]]
    if isinstance(value, str):
        text = redact(value)
        return text if len(text) <= MAX_STR else text[:MAX_STR] + "…[truncated]"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return redact(str(value))[:MAX_STR]


def wrap_tool_result(name: str, result: Any, limit: int = 8000) -> str:
    body = json.dumps(result, default=str)
    if len(body) > limit:
        body = body[:limit] + '…[truncated]"'
    return f'<tool_result untrusted="true" tool="{name}">{body}</tool_result>'
