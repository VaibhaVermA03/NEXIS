"""Application settings. Fails fast on insecure production configuration."""
import logging
import secrets
from functools import lru_cache
from typing import Literal

from cryptography.fernet import Fernet
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_INSECURE_SECRETS = {"", "change-me", "dev-secret", "changeme", "secret"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    app_env: Literal["development", "test", "production"] = "development"
    app_secret_key: str = "dev-secret-key-only-for-local-development-0000"  # noqa: S105 dev default; rejected in production
    database_url: str = "sqlite:///./nexis_dev.db"
    frontend_url: str = "http://localhost:5173"
    backend_url: str = "http://localhost:8000"
    cors_origins: str = "http://localhost:5173"

    # Sessions
    access_token_minutes: int = 15
    refresh_token_days: int = 14
    cookie_secure: bool = False
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    cookie_domain: str | None = None

    # AI
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    openai_timeout_seconds: int = 60
    openai_max_retries: int = 2
    agent_max_steps: int = Field(default=6, ge=1, le=20)
    execution_max_seconds: int = Field(default=120, ge=10, le=900)
    execution_max_concurrency: int = Field(default=4, ge=1, le=32)
    approval_timeout_seconds: int = Field(default=120, ge=5, le=900)

    # Google OAuth
    google_client_id: str | None = None
    google_client_secret: str | None = None
    google_redirect_uri: str = "http://localhost:8000/api/v1/auth/google/callback"

    # Tool secrets (Fernet key, urlsafe base64 32 bytes)
    tool_secret_encryption_key: str | None = None
    # Optional comma-separated host allowlist for custom REST tools (empty = any public host)
    tool_outbound_allowlist: str = ""
    tool_allow_http: bool = False
    tool_max_response_bytes: int = 262144

    tavily_api_key: str | None = None

    # Email (only "preview" is implemented; real providers must be added explicitly)
    email_provider: Literal["preview"] = "preview"

    # Rate limits: "count/seconds"
    rate_limit_auth: str = "10/60"
    rate_limit_api: str = "120/60"

    log_level: str = "INFO"

    @property
    def is_prod(self) -> bool:
        return self.app_env == "production"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def google_configured(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    @property
    def openai_configured(self) -> bool:
        return bool(self.openai_api_key)

    @property
    def outbound_allowlist(self) -> list[str]:
        return [h.strip().lower() for h in self.tool_outbound_allowlist.split(",") if h.strip()]

    @model_validator(mode="after")
    def _validate(self) -> "Settings":
        self.cookie_domain = (self.cookie_domain or "").strip() or None
        if not self.app_secret_key.strip() and not self.is_prod:
            # Blank in .env: never sign tokens with an empty key. Ephemeral secret => sessions reset on restart.
            self.app_secret_key = secrets.token_urlsafe(48)
            logging.getLogger("nexis.config").warning(
                "APP_SECRET_KEY is empty; using a temporary random secret (sessions will not survive a restart). "
                "Set APP_SECRET_KEY in .env.")
        if self.tool_secret_encryption_key:
            try:
                Fernet(self.tool_secret_encryption_key.encode())
            except Exception as exc:
                raise ValueError("TOOL_SECRET_ENCRYPTION_KEY must be a valid Fernet key") from exc
        if self.cookie_samesite == "none" and not self.cookie_secure:
            raise ValueError("COOKIE_SAMESITE=none requires COOKIE_SECURE=true")
        if self.is_prod:
            problems = []
            if self.app_secret_key in _INSECURE_SECRETS or len(self.app_secret_key) < 32 \
                    or self.app_secret_key.startswith("dev-secret"):
                problems.append("APP_SECRET_KEY must be a random value of at least 32 characters")
            if self.database_url.startswith("sqlite"):
                problems.append("DATABASE_URL must be PostgreSQL in production")
            if not self.tool_secret_encryption_key:
                problems.append("TOOL_SECRET_ENCRYPTION_KEY is required in production")
            if not self.cookie_secure:
                problems.append("COOKIE_SECURE must be true in production")
            if not self.frontend_url.startswith("https://"):
                problems.append("FRONTEND_URL must use https in production")
            if self.tool_allow_http:
                problems.append("TOOL_ALLOW_HTTP must be false in production")
            if "*" in self.cors_origin_list:
                problems.append("CORS_ORIGINS must not contain * in production")
            if problems:
                raise ValueError("Invalid production configuration: " + "; ".join(problems))
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()