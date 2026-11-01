import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.core.exceptions import register_handlers
from app.core.logging import setup_logging
from app.middleware.security_headers import SecurityHeadersMiddleware
from app.services.execution_service import recover_interrupted, shutdown_executor

log = logging.getLogger("nexis")


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    setup_logging(s.log_level)
    log.info("NEXIS API starting (env=%s, openai=%s, google=%s)", s.app_env, s.openai_configured, s.google_configured)
    if s.app_env != "test":
        try:
            log.info("Execution recovery: %s", recover_interrupted())
        except Exception:
            log.exception("Startup tasks failed (have migrations been applied? run: alembic upgrade head)")
    yield
    shutdown_executor()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="NEXIS API", version="1.0.0", lifespan=lifespan, docs_url="/api/docs",
                  redoc_url="/api/redoc", openapi_url="/api/openapi.json")
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(CORSMiddleware, allow_origins=s.cors_origin_list, allow_credentials=True,
                       allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
                       allow_headers=["Content-Type", "X-CSRF-Token", "X-Requested-With", "X-API-Key",
                                      "Last-Event-ID", "Authorization"])
    register_handlers(app)
    app.include_router(api_router)
    return app


app = create_app()