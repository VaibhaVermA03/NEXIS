"""Authentication dependencies and ownership helpers."""
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import Forbidden, NotFound, Unauthorized
from app.core.security import (
    constant_time_equals,
    decode_access_token,
    hash_token,
    parse_api_key_prefix,
)
from app.db.session import get_db
from app.models import ApiKey, User

ACCESS_COOKIE = "nx_access"
REFRESH_COOKIE = "nx_refresh"
CSRF_COOKIE = "nx_csrf"
CSRF_HEADER = "x-csrf-token"
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}




@dataclass
class Principal:
    user: User
    via: str  # cookie | bearer | api_key
    api_key: ApiKey | None = None


def _load_user(db: Session, user_id: str) -> User:
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise Unauthorized("Account not found or disabled")
    return user


def enforce_csrf(request: Request) -> None:
    cookie = request.cookies.get(CSRF_COOKIE)
    header = request.headers.get(CSRF_HEADER)
    if not cookie or not header or not constant_time_equals(cookie, header):
        raise Forbidden("CSRF validation failed", code="csrf_failed")


def session_principal(request: Request, db: Session = Depends(get_db)) -> Principal:
    """Browser session: cookie (CSRF enforced on unsafe methods) or Bearer access JWT."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer ") and not auth[7:].startswith("nx_"):
        payload = decode_access_token(auth[7:].strip())
        return Principal(_load_user(db, payload["sub"]), "bearer")
    token = request.cookies.get(ACCESS_COOKIE)
    if not token:
        raise Unauthorized("Authentication required")
    payload = decode_access_token(token)
    if request.method in UNSAFE:
        enforce_csrf(request)
    return Principal(_load_user(db, payload["sub"]), "cookie")


def current_user(p: Principal = Depends(session_principal)) -> User:
    return p.user


def api_key_principal(raw: str, db: Session) -> Principal:
    prefix = parse_api_key_prefix(raw)
    key = db.scalar(select(ApiKey).where(ApiKey.prefix == prefix)) if prefix else None
    if not key or key.revoked_at is not None or not constant_time_equals(key.key_hash, hash_token(raw)):
        raise Unauthorized("Invalid API key")
    user = _load_user(db, key.owner_id)
    key.last_used_at = datetime.now(UTC)
    db.commit()
    return Principal(user, "api_key", key)


def execution_principal(request: Request, db: Session = Depends(get_db)) -> Principal:
    """Session OR API key (X-API-Key / Authorization: Bearer nx_...)."""
    raw = request.headers.get("x-api-key")
    auth = request.headers.get("authorization", "")
    if not raw and auth.lower().startswith("bearer ") and auth[7:].startswith("nx_"):
        raw = auth[7:].strip()
    if raw:
        return api_key_principal(raw, db)
    return session_principal(request, db)


def get_owned[T](db: Session, model: type[T], obj_id: str, owner_id: str, label: str = "Resource") -> T:
    """Fetch a tenant-owned row; a foreign owner's row is indistinguishable from a missing one."""
    obj = db.get(model, obj_id)
    if obj is None or getattr(obj, "owner_id", None) != owner_id:
        raise NotFound(f"{label} not found")
    return obj
