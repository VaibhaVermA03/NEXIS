"""In-memory sliding-window rate limiter (per process; use Redis/gateway limits for multi-instance)."""
import threading
import time
from collections import defaultdict, deque

from fastapi import Request

from app.core.config import get_settings
from app.core.exceptions import RateLimited

_lock = threading.Lock()
_hits: dict[str, deque] = defaultdict(deque)


def reset_limits() -> None:
    with _lock:
        _hits.clear()


def _parse(spec: str) -> tuple[int, int]:
    count, seconds = spec.split("/")
    return int(count), int(seconds)


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def check(key: str, spec: str) -> None:
    limit, window = _parse(spec)
    now = time.monotonic()
    with _lock:
        q = _hits[key]
        while q and q[0] <= now - window:
            q.popleft()
        if len(q) >= limit:
            raise RateLimited("Too many requests. Please slow down and retry shortly.")
        q.append(now)


def limit_auth(request: Request) -> None:
    check(f"auth:{client_ip(request)}:{request.url.path}", get_settings().rate_limit_auth)


def limit_api(request: Request) -> None:
    check(f"api:{client_ip(request)}", get_settings().rate_limit_api)
