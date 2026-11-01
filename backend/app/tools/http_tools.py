"""Executes REST calls for custom tools and the generic http_request builtin, through the SSRF guard."""
import json
import time
from dataclasses import dataclass, field

import httpx

from app.core.config import get_settings
from app.tools import ssrf

ALLOWED_CT_PREFIXES = ("text/",)
ALLOWED_CT_EXACT = ("application/json",)


class ToolExecutionError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


@dataclass
class HttpCall:
    method: str
    url: str
    args: dict
    headers: dict = field(default_factory=dict)
    auth_mode: str = "none"  # none | bearer | header | query
    auth_name: str | None = None
    secret: str | None = None
    timeout: float = 10.0


def _content_type_ok(ct: str) -> bool:
    base = ct.split(";")[0].strip().lower()
    return base in ALLOWED_CT_EXACT or base.endswith("+json") or base.startswith(ALLOWED_CT_PREFIXES)


def execute_http(call: HttpCall, transport: httpx.BaseTransport | None = None) -> dict:
    s = get_settings()
    try:
        target = ssrf.validate_target(call.url)
        headers = ssrf.sanitize_headers(call.headers)
    except ssrf.UrlValidationError as exc:
        raise ToolExecutionError("url_blocked", str(exc)) from exc

    params: dict = {}
    body = None
    if call.method == "GET":
        params = {k: v if isinstance(v, (str, int, float, bool)) else json.dumps(v) for k, v in call.args.items()}
    else:
        body = call.args
    if call.secret and call.auth_mode == "bearer":
        headers["Authorization"] = f"Bearer {call.secret}"
    elif call.secret and call.auth_mode == "header" and call.auth_name:
        headers[call.auth_name] = call.secret
    elif call.secret and call.auth_mode == "query" and call.auth_name:
        params[call.auth_name] = call.secret

    # Pin the connection to a validated IP; keep Host + SNI for the real name (anti DNS-rebinding).
    ip = target.ips[0]
    ip_host = f"[{ip}]" if ":" in ip else ip
    default_port = 443 if target.scheme == "https" else 80
    pinned_url = f"{target.scheme}://{ip_host}:{target.port}{target.path_query}"
    headers["Host"] = target.host if target.port == default_port else f"{target.host}:{target.port}"
    headers.setdefault("User-Agent", "NEXIS-Tool-Runner/1.0")
    headers.setdefault("Accept", "application/json, text/*;q=0.8")
    timeout = httpx.Timeout(call.timeout, connect=min(call.timeout, 5.0))
    started = time.monotonic()
    try:
        client_kwargs = {"follow_redirects": False, "timeout": timeout, "trust_env": False}
        if transport is not None:
            client_kwargs["transport"] = transport
        with httpx.Client(**client_kwargs) as client, client.stream(
                call.method, pinned_url, params=params or None, json=body, headers=headers,
                extensions={"sni_hostname": target.host}) as resp:
            if 300 <= resp.status_code < 400:
                raise ToolExecutionError("redirect_blocked",
                                         f"Remote returned HTTP {resp.status_code}; redirects are not followed")
            ct = resp.headers.get("content-type", "")
            if resp.status_code != 204 and not _content_type_ok(ct):
                raise ToolExecutionError("unsupported_content_type", f"Unsupported response content type '{ct[:60]}'")
            chunks, size, truncated = [], 0, False
            for chunk in resp.iter_bytes():
                size += len(chunk)
                if size > s.tool_max_response_bytes:
                    keep = len(chunk) - (size - s.tool_max_response_bytes)
                    chunks.append(chunk[:max(keep, 0)])
                    truncated = True
                    break
                chunks.append(chunk)
            raw = b"".join(chunks)
            status = resp.status_code
    except ToolExecutionError:
        raise
    except httpx.TimeoutException as exc:
        raise ToolExecutionError("timeout", f"Request timed out after {call.timeout:g}s") from exc
    except httpx.HTTPError as exc:
        raise ToolExecutionError("network_error", f"Network error: {type(exc).__name__}") from exc

    text = raw.decode("utf-8", errors="replace")
    result: dict = {"status_code": status, "duration_ms": int((time.monotonic() - started) * 1000),
                    "truncated": truncated}
    if ct.split(";")[0].strip().lower() == "application/json" or ct.split(";")[0].strip().endswith("+json"):
        if truncated:
            result["text"] = text[:4000]
        else:
            try:
                result["json"] = json.loads(text) if text else None
            except json.JSONDecodeError as exc:
                raise ToolExecutionError("malformed_json", "Response declared JSON but could not be parsed") from exc
    else:
        result["text"] = text[:4000]
    if status >= 400:
        result["error"] = f"Remote returned HTTP {status}"
    return result
