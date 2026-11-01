from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import current_user, get_owned
from app.core.exceptions import AppError
from app.core.security import generate_api_key, utcnow
from app.db.session import get_db
from app.middleware.ratelimit import limit_api
from app.models import ApiKey, User
from app.schemas.resources import ApiKeyCreated, ApiKeyIn, ApiKeyOut
from app.services.auth_service import audit

router = APIRouter(prefix="/api-keys", tags=["api-keys"], dependencies=[Depends(limit_api)])
MAX_ACTIVE_KEYS = 20


@router.get("", response_model=list[ApiKeyOut])
def list_keys(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(select(ApiKey).where(ApiKey.owner_id == user.id).order_by(ApiKey.created_at.desc())).all()


@router.post("", response_model=ApiKeyCreated, status_code=201)
def create_key(body: ApiKeyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    active = db.scalar(select(func.count()).select_from(ApiKey).where(
        ApiKey.owner_id == user.id, ApiKey.revoked_at.is_(None))) or 0
    if active >= MAX_ACTIVE_KEYS:
        raise AppError("Active API key limit reached; revoke an unused key first", status_code=409, code="key_limit")
    full, prefix, digest = generate_api_key()
    row = ApiKey(owner_id=user.id, name=body.name.strip(), prefix=prefix, key_hash=digest, scopes=list(body.scopes))
    db.add(row)
    audit(db, user.id, "api_key.created", "api_key", row.id, prefix=prefix)
    db.commit()
    return ApiKeyCreated(**ApiKeyOut.model_validate(row).model_dump(), key=full)


@router.post("/{key_id}/rotate", response_model=ApiKeyCreated)
def rotate_key(key_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = get_owned(db, ApiKey, key_id, user.id, "API key")
    if row.revoked_at is not None:
        raise AppError("Revoked keys cannot be rotated", status_code=409, code="key_revoked")
    full, prefix, digest = generate_api_key()
    row.prefix, row.key_hash, row.last_used_at = prefix, digest, None
    audit(db, user.id, "api_key.rotated", "api_key", row.id, prefix=prefix)
    db.commit()
    return ApiKeyCreated(**ApiKeyOut.model_validate(row).model_dump(), key=full)


@router.delete("/{key_id}", status_code=204)
def revoke_key(key_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = get_owned(db, ApiKey, key_id, user.id, "API key")
    if row.revoked_at is None:
        row.revoked_at = utcnow()
        audit(db, user.id, "api_key.revoked", "api_key", row.id)
        db.commit()
