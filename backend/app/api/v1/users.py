from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.api.v1.auth import clear_session_cookies
from app.db.session import get_db
from app.models import RefreshToken, User
from app.schemas.auth import ProfileUpdate, UserOut
from app.services import auth_service as svc

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserOut)
def get_me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return svc.user_out(db, user)


@router.patch("/me", response_model=UserOut)
def update_me(body: ProfileUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    user.full_name = " ".join(body.full_name.split())
    svc.audit(db, user.id, "user.profile_updated", "user", user.id)
    db.commit()
    return svc.user_out(db, user)


@router.get("/me/sessions")
def list_sessions(user: User = Depends(current_user), db: Session = Depends(get_db)):
    from app.core.security import utcnow
    rows = db.scalars(select(RefreshToken).where(RefreshToken.user_id == user.id,
                                                 RefreshToken.revoked_at.is_(None))
                      .order_by(RefreshToken.created_at.desc()).limit(50)).all()
    now = utcnow()
    return [{"id": r.id, "user_agent": r.user_agent, "created_at": r.created_at}
            for r in rows if (r.expires_at if r.expires_at.tzinfo else r.expires_at.replace(tzinfo=now.tzinfo)) > now]


@router.delete("/me/sessions", status_code=204)
def revoke_sessions(response: Response, user: User = Depends(current_user), db: Session = Depends(get_db)):
    svc.revoke_all_sessions(db, user.id)
    clear_session_cookies(response)
    response.status_code = 204
    return response
