"""Google OAuth 2.0 / OpenID Connect: authorization code flow + PKCE + ID-token validation."""
import base64
import hashlib
import secrets
from datetime import timedelta
from urllib.parse import urlencode

import httpx
import jwt
from jwt import PyJWKClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.exceptions import AppError, Conflict
from app.core.security import JWT_ALG, constant_time_equals, new_id, utcnow
from app.models import OAuthAccount, User
from app.services.auth_service import audit

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"  # noqa: S105 public endpoint URL
JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
ISSUERS = ("https://accounts.google.com", "accounts.google.com")
FLOW_COOKIE = "nx_oauth_flow"
FLOW_TTL_SECONDS = 600


class OAuthFlowError(AppError):
    status_code = 400
    code = "oauth_error"


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def start_flow() -> tuple[str, str]:
    """Return (authorization_url, signed flow cookie value). state/nonce/verifier never reach JS."""
    s = get_settings()
    state, nonce = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(64)
    challenge = _b64(hashlib.sha256(verifier.encode()).digest())
    cookie = jwt.encode({"state": state, "nonce": nonce, "cv": verifier, "typ": "oauth_flow",
                         "exp": utcnow() + timedelta(seconds=FLOW_TTL_SECONDS)}, s.app_secret_key, algorithm=JWT_ALG)
    params = {"client_id": s.google_client_id, "redirect_uri": s.google_redirect_uri, "response_type": "code",
              "scope": "openid email profile", "state": state, "nonce": nonce,
              "code_challenge": challenge, "code_challenge_method": "S256", "prompt": "select_account"}
    return f"{AUTH_URL}?{urlencode(params)}", cookie


def read_flow(cookie: str | None, state: str | None) -> dict:
    if not cookie or not state:
        raise OAuthFlowError("Missing OAuth state", code="oauth_state_missing")
    try:
        flow = jwt.decode(cookie, get_settings().app_secret_key, algorithms=[JWT_ALG])
    except jwt.PyJWTError as exc:
        raise OAuthFlowError("OAuth session expired", code="oauth_state_expired") from exc
    if flow.get("typ") != "oauth_flow" or not constant_time_equals(flow["state"], state):
        raise OAuthFlowError("OAuth state mismatch", code="oauth_state_mismatch")
    return flow


def exchange_code(code: str, verifier: str) -> dict:
    s = get_settings()
    try:
        r = httpx.post(TOKEN_URL, timeout=10, data={
            "code": code, "client_id": s.google_client_id, "client_secret": s.google_client_secret,
            "redirect_uri": s.google_redirect_uri, "grant_type": "authorization_code", "code_verifier": verifier})
    except httpx.HTTPError as exc:
        raise OAuthFlowError("Could not reach Google", code="oauth_unreachable") from exc
    if r.status_code != 200:
        raise OAuthFlowError("Google rejected the authorization code", code="oauth_code_rejected")
    return r.json()


_jwks: PyJWKClient | None = None


def verify_id_token(id_token: str, nonce: str) -> dict:
    """Signature (Google JWKS), issuer, audience, expiry and nonce are all verified."""
    global _jwks
    s = get_settings()
    try:
        _jwks = _jwks or PyJWKClient(JWKS_URL, cache_keys=True, timeout=10)
        key = _jwks.get_signing_key_from_jwt(id_token).key
        claims = jwt.decode(id_token, key, algorithms=["RS256"], audience=s.google_client_id,
                            options={"require": ["exp", "iss", "aud", "sub"]})
    except jwt.PyJWTError as exc:
        raise OAuthFlowError("Invalid Google ID token", code="oauth_invalid_token") from exc
    if claims.get("iss") not in ISSUERS:
        raise OAuthFlowError("Invalid token issuer", code="oauth_invalid_token")
    if not constant_time_equals(str(claims.get("nonce", "")), nonce):
        raise OAuthFlowError("Nonce mismatch", code="oauth_invalid_token")
    return claims


def complete_login(db: Session, claims: dict) -> User:
    """Safe account policy: existing Google link -> login. Unknown email -> create (verified by Google).
    Email already used by a password account -> refuse (prevents pre-registration account takeover)."""
    if not claims.get("email") or claims.get("email_verified") is not True:
        raise OAuthFlowError("Google account email is not verified", code="oauth_email_unverified")
    email = claims["email"].strip().lower()
    link = db.scalar(select(OAuthAccount).where(OAuthAccount.provider == "google",
                                                OAuthAccount.subject == claims["sub"]))
    if link:
        user = db.get(User, link.user_id)
    else:
        if db.scalar(select(User.id).where(User.email == email)):
            raise Conflict("An account with this email already exists. Sign in with your password.",
                           code="account_exists")
        user = User(id=new_id(), email=email, full_name=(claims.get("name") or email.split("@")[0])[:120],
                    password_hash=None, email_verified=True)
        db.add(user)
        db.flush()
        db.add(OAuthAccount(user_id=user.id, provider="google", subject=claims["sub"], email=email))
        audit(db, user.id, "user.signup_google", "user", user.id)
    if not user or not user.is_active:
        raise OAuthFlowError("Account disabled", code="account_disabled")
    user.last_login_at = utcnow()
    audit(db, user.id, "user.login_google", "user", user.id)
    db.commit()
    return user