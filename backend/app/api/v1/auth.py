import logging
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.api.deps import ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE, current_user
from app.core.config import get_settings
from app.core.exceptions import AppError, Forbidden, Unauthorized
from app.core.security import generate_token, hash_token
from app.db.session import get_db
from app.middleware.ratelimit import limit_auth
from app.models import User
from app.schemas.auth import (
    AuthConfigOut,
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    MessageOut,
    ResetPasswordRequest,
    SessionOut,
    SignupRequest,
    UserOut,
)
from app.services import auth_service as svc
from app.services import google_oauth_service as google

log = logging.getLogger("nexis.auth")
router = APIRouter(prefix="/auth", tags=["auth"])


def set_session_cookies(resp: Response, access: str, refresh: str, csrf: str) -> None:
    s = get_settings()
    common = {"secure": s.cookie_secure, "samesite": s.cookie_samesite, "domain": s.cookie_domain}
    resp.set_cookie(ACCESS_COOKIE, access, max_age=s.access_token_minutes * 60, httponly=True, path="/", **common)
    resp.set_cookie(REFRESH_COOKIE, refresh, max_age=s.refresh_token_days * 86400, httponly=True,
                    path="/api/v1/auth", **common)
    # Readable by the backend only for double-submit comparison; the SPA gets the value from the response body.
    resp.set_cookie(CSRF_COOKIE, csrf, max_age=s.refresh_token_days * 86400, httponly=True, path="/", **common)


def clear_session_cookies(resp: Response) -> None:
    s = get_settings()
    for name, path in ((ACCESS_COOKIE, "/"), (REFRESH_COOKIE, "/api/v1/auth"), (CSRF_COOKIE, "/")):
        resp.delete_cookie(name, path=path, domain=s.cookie_domain, secure=s.cookie_secure,
                           samesite=s.cookie_samesite, httponly=True)


def require_xhr(request: Request) -> None:
    """Forces a CORS preflight for cross-site callers of cookie-only endpoints (refresh/logout)."""
    if request.headers.get("x-requested-with") != "nexis":
        raise Forbidden("Missing X-Requested-With header", code="csrf_failed")


def _session_response(db: Session, user: User, response: Response, access: str, refresh: str, csrf: str) -> SessionOut:
    set_session_cookies(response, access, refresh, csrf)
    return SessionOut(user=svc.user_out(db, user), csrf_token=csrf)


@router.get("/config", response_model=AuthConfigOut)
def auth_config():
    s = get_settings()
    return AuthConfigOut(google_enabled=s.google_configured, openai_enabled=s.openai_configured,
                         email_delivery_enabled=False, environment=s.app_env)


@router.post("/signup", response_model=SessionOut, status_code=201, dependencies=[Depends(limit_auth)])
def signup(body: SignupRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    user = svc.register(db, body.full_name, body.email, body.password)
    access, refresh, csrf = svc.issue_session(db, user, request.headers.get("user-agent"))
    return _session_response(db, user, response, access, refresh, csrf)


@router.post("/login", response_model=SessionOut, dependencies=[Depends(limit_auth)])
def login(body: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    user = svc.authenticate(db, body.email, body.password)
    access, refresh, csrf = svc.issue_session(db, user, request.headers.get("user-agent"))
    return _session_response(db, user, response, access, refresh, csrf)


@router.post("/refresh", response_model=SessionOut, dependencies=[Depends(limit_auth), Depends(require_xhr)])
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    try:
        user, access, new_refresh, csrf = svc.rotate_refresh(
            db, request.cookies.get(REFRESH_COOKIE), request.headers.get("user-agent"))
    except Unauthorized:
        clear_session_cookies(response)
        raise
    return _session_response(db, user, response, access, new_refresh, csrf)


@router.post("/logout", status_code=204, dependencies=[Depends(require_xhr)])
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    svc.revoke_refresh(db, request.cookies.get(REFRESH_COOKIE))
    clear_session_cookies(response)
    response.status_code = 204
    return response


@router.get("/me", response_model=SessionOut)
def me(request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    csrf = request.cookies.get(CSRF_COOKIE) or generate_token(24)
    return SessionOut(user=svc.user_out(db, user), csrf_token=csrf)


@router.post("/change-password", response_model=MessageOut)
def change_password(body: ChangePasswordRequest, request: Request, user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    """Lives under /auth so the path-scoped refresh cookie is sent and the current session can be kept."""
    raw = request.cookies.get(REFRESH_COOKIE)
    svc.change_password(db, user, body.current_password, body.new_password, hash_token(raw) if raw else None)
    return MessageOut(message="Password changed. Other sessions were signed out.")


@router.post("/forgot-password", response_model=MessageOut, dependencies=[Depends(limit_auth)])
def forgot_password(body: ForgotPasswordRequest, db: Session = Depends(get_db)):
    s = get_settings()
    token = svc.create_reset_token(db, body.email)
    generic = "If an account exists for that email, a reset link has been issued."
    if token and s.app_env != "production":
        link = f"{s.frontend_url}/reset-password?token={token}"
        log.info("DEV password reset link for %s (email delivery is not configured)", body.email)
        return MessageOut(message=generic + " Email delivery is not configured; use the development link below.",
                          dev_reset_link=link)
    if token:
        log.warning("Password reset requested but no email provider is configured; nothing was sent.")
    return MessageOut(message=generic)


@router.post("/reset-password", response_model=MessageOut, dependencies=[Depends(limit_auth)])
def reset_password(body: ResetPasswordRequest, db: Session = Depends(get_db)):
    svc.reset_password(db, body.token, body.password)
    return MessageOut(message="Password updated. Please sign in.")


# ---------------- Google OAuth ----------------
def _front(path: str, **params) -> str:
    q = f"?{urlencode(params)}" if params else ""
    return f"{get_settings().frontend_url}{path}{q}"


@router.get("/google/login", dependencies=[Depends(limit_auth)])
def google_login():
    s = get_settings()
    if not s.google_configured:
        return RedirectResponse(_front("/login", error="google_not_configured"), status_code=302)
    url, flow_cookie = google.start_flow()
    resp = RedirectResponse(url, status_code=302)
    resp.set_cookie(google.FLOW_COOKIE, flow_cookie, max_age=google.FLOW_TTL_SECONDS, httponly=True,
                    secure=s.cookie_secure, samesite="lax", path="/api/v1/auth/google", domain=s.cookie_domain)
    return resp


@router.get("/google/callback", dependencies=[Depends(limit_auth)])
def google_callback(request: Request, code: str | None = None, state: str | None = None,
                    error: str | None = None, db: Session = Depends(get_db)):
    s = get_settings()

    def fail(code_: str) -> RedirectResponse:
        r = RedirectResponse(_front("/auth/callback", error=code_), status_code=302)
        r.delete_cookie(google.FLOW_COOKIE, path="/api/v1/auth/google", domain=s.cookie_domain)
        return r

    if not s.google_configured:
        return fail("google_not_configured")
    if error:
        return fail("consent_cancelled" if error == "access_denied" else "oauth_error")
    try:
        flow = google.read_flow(request.cookies.get(google.FLOW_COOKIE), state)
        if not code:
            return fail("oauth_error")
        tokens = google.exchange_code(code, flow["cv"])
        claims = google.verify_id_token(tokens.get("id_token", ""), flow["nonce"])
        user = google.complete_login(db, claims)
    except AppError as exc:
        log.info("Google login failed: %s", exc.code)
        return fail(exc.code)
    access, refresh_tok, csrf = svc.issue_session(db, user, request.headers.get("user-agent"))
    resp = RedirectResponse(_front("/auth/callback", status="success"), status_code=302)
    set_session_cookies(resp, access, refresh_tok, csrf)
    resp.delete_cookie(google.FLOW_COOKIE, path="/api/v1/auth/google", domain=s.cookie_domain)
    return resp


__all__ = ["router", "UserOut"]