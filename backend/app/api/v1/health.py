from fastapi import APIRouter, Response
from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import get_engine

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/ready")
def ready(response: Response):
    s = get_settings()
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False
    response.status_code = 200 if db_ok else 503
    return {"status": "ready" if db_ok else "degraded", "database": db_ok,
            "openai_configured": s.openai_configured, "google_configured": s.google_configured}
