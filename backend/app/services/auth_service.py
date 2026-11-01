import logging
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import Conflict, Unauthorized
from app.core.security import (
    DUMMY_HASH,
    create_access_token,
    generate_token,
    hash_password,
    hash_token,
    password_needs_rehash,
    utcnow,
    verify_password,
)
from app.models import AuditLog, OAuthAccount, PasswordResetToken, RefreshToken, User
from app.schemas.auth import UserOut

log = logging.getLogger("nexis.auth")


def audit(db: Session, owner_id: str | None, action: str, target_type: str | None = None,
          target_id: str | None = None, **meta) -> None:
    db.add(AuditLog(owner_id=owner_id, action=action, target_type=target_type, target_id=target_id, meta=meta))


def user_out(db: Session, user: User) -> UserOut:
    providers = list(db.scalars(select(OAuthAccount.provider).where(OAuthAccount.user_id == user.id)))
    return UserOut(id=user.id, email=user.email, full_name=user.full_name, email_verified=user.email_verified,
                   has_password=bool(user.password_hash), providers=providers, created_at=user.created_at)


def register(db: Session, full_name: str, email: str, password: str) -> User:
    if db.scalar(select(User.id).where(User.email == email)):
        raise Conflict("An account with this email already exists", code="email_taken")
    user = User(email=email, full_name=full_name, password_hash=hash_password(password))
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:  # concurrent signup race
        db.rollback()
        raise Conflict("An account with this email already exists", code="email_taken") from exc
    audit(db, user.id, "user.signup", "user", user.id)
    db.commit()
    return user


def authenticate(db: Session, email: str, password: str) -> User:
    user = db.scalar(select(User).where(User.email == email))
    # Always run a hash verification so response time does not reveal account existence.
    ok = verify_password(password, user.password_hash if user else DUMMY_HASH)
    if not user or not user.password_hash or not ok or not user.is_active:
        raise Unauthorized("Invalid email or password", code="invalid_credentials")
    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    user.last_login_at = utcnow()
    audit(db, user.id, "user.login", "user", user.id)
    db.commit()
    return user


def _new_refresh(db: Session, user_id: str, family_id: str | None, ua: str | None) -> tuple[str, RefreshToken]:
    raw = generate_token(48)
    row = RefreshToken(user_id=user_id, token_hash=hash_token(raw), user_agent=(ua or "")[:255] or None,
                       expires_at=utcnow() + timedelta(days=get_settings().refresh_token_days))
    if family_id:
        row.family_id = family_id
    db.add(row)
    db.flush()
    return raw, row


def issue_session(db: Session, user: User, ua: str | None) -> tuple[str, str, str]:
    raw, _ = _new_refresh(db, user.id, None, ua)
    db.commit()
    return create_access_token(user.id), raw, generate_token(24)


def rotate_refresh(db: Session, raw: str | None, ua: str | None) -> tuple[User, str, str, str]:
    if not raw:
        raise Unauthorized("No refresh token", code="no_refresh")
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw)))
    if row is None:
        raise Unauthorized("Invalid refresh token", code="invalid_refresh")
    if row.revoked_at is not None:
        # Reuse of a rotated/revoked token: assume theft and revoke the whole family.
        db.execute(update(RefreshToken).where(RefreshToken.family_id == row.family_id,
                                              RefreshToken.revoked_at.is_(None)).values(revoked_at=utcnow()))
        audit(db, row.user_id, "session.reuse_detected", "refresh_token", row.id)
        db.commit()
        log.warning("Refresh token reuse detected for user %s", row.user_id)
        raise Unauthorized("Session is no longer valid", code="refresh_reuse")
    expires = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=utcnow().tzinfo)
    if expires <= utcnow():
        raise Unauthorized("Session expired", code="refresh_expired")
    user = db.get(User, row.user_id)
    if not user or not user.is_active:
        raise Unauthorized("Account not found or disabled")
    new_raw, new_row = _new_refresh(db, user.id, row.family_id, ua)
    row.revoked_at = utcnow()
    row.replaced_by_id = new_row.id
    db.commit()
    return user, create_access_token(user.id), new_raw, generate_token(24)


def revoke_refresh(db: Session, raw: str | None) -> None:
    if not raw:
        return
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw)))
    if row:
        db.execute(update(RefreshToken).where(RefreshToken.family_id == row.family_id,
                                              RefreshToken.revoked_at.is_(None)).values(revoked_at=utcnow()))
        db.commit()


def revoke_all_sessions(db: Session, user_id: str, except_hash: str | None = None) -> None:
    stmt = update(RefreshToken).where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
    if except_hash:
        stmt = stmt.where(RefreshToken.token_hash != except_hash)
    db.execute(stmt.values(revoked_at=utcnow()))
    db.commit()


def create_reset_token(db: Session, email: str) -> str | None:
    user = db.scalar(select(User).where(User.email == email))
    if not user or not user.is_active:
        return None
    raw = generate_token(32)
    db.add(PasswordResetToken(user_id=user.id, token_hash=hash_token(raw),
                              expires_at=utcnow() + timedelta(minutes=30)))
    audit(db, user.id, "user.password_reset_requested", "user", user.id)
    db.commit()
    return raw


def reset_password(db: Session, raw: str, new_password: str) -> None:
    row = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(raw)))
    exp = row.expires_at if row and row.expires_at.tzinfo else (
        row.expires_at.replace(tzinfo=utcnow().tzinfo) if row else None)
    if not row or row.used_at is not None or exp <= utcnow():
        raise Unauthorized("Reset link is invalid or has expired", code="invalid_reset_token")
    user = db.get(User, row.user_id)
    user.password_hash = hash_password(new_password)
    row.used_at = utcnow()
    audit(db, user.id, "user.password_reset", "user", user.id)
    db.commit()
    revoke_all_sessions(db, user.id)


def change_password(db: Session, user: User, current: str, new: str, keep_hash: str | None) -> None:
    if not user.password_hash:
        raise Conflict("This account has no password (signed in with Google).", code="no_password")
    if not verify_password(current, user.password_hash):
        raise Unauthorized("Current password is incorrect", code="invalid_credentials")
    user.password_hash = hash_password(new)
    audit(db, user.id, "user.password_changed", "user", user.id)
    db.commit()
    revoke_all_sessions(db, user.id, except_hash=keep_hash)
