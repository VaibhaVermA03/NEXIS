import app.services.google_oauth_service as g
from app.core.config import get_settings
from app.core.security import hash_token
from app.middleware.ratelimit import reset_limits
from app.models import AuditLog, RefreshToken, User
from app.tests.conftest import PASSWORD, make_client, signup


def test_health_and_ready(client):
    assert client.get("/api/v1/health").json() == {"status": "ok"}
    r = client.get("/api/v1/ready")
    assert r.status_code == 200 and r.json()["database"] is True


def test_security_headers(client):
    r = client.get("/api/v1/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"


def test_signup_success_sets_cookies_and_hashes(client, db):
    r = signup(client)
    assert r.status_code == 201
    body = r.json()
    assert body["user"]["email"] == "alice@example.com" and body["csrf_token"]
    assert "password_hash" not in str(body) and "argon2" not in str(body)
    cookies = r.headers.get_list("set-cookie")
    assert any("nx_access" in c and "HttpOnly" in c for c in cookies)
    assert any("nx_refresh" in c and "HttpOnly" in c and "Path=/api/v1/auth" in c for c in cookies)
    user = db.query(User).one()
    assert user.password_hash.startswith("$argon2id$")


def test_signup_validation(client):
    base = {"full_name": "Al", "email": "not-an-email", "password": "short", "password_confirm": "other"}
    r = client.post("/api/v1/auth/signup", json=base)
    assert r.status_code == 422
    fields = {d["field"] for d in r.json()["error"]["details"]}
    assert {"email", "password"} <= fields
    r = client.post("/api/v1/auth/signup", json={"full_name": "Alice", "email": "a@example.com",
                                                 "password": PASSWORD, "password_confirm": PASSWORD + "x"})
    assert r.status_code == 422


def test_email_normalized_and_duplicate_rejected(client):
    assert signup(client, email="  Alice@Example.COM ").status_code == 201
    r = signup(make_client(), email="alice@example.com")
    assert r.status_code == 409 and r.json()["error"]["code"] == "email_taken"


def test_login_success_and_generic_failure(client):
    signup(client)
    with make_client() as c:
        assert c.post("/api/v1/auth/login", json={"email": "alice@example.com", "password": PASSWORD}).status_code == 200
        bad_pw = c.post("/api/v1/auth/login", json={"email": "alice@example.com", "password": "Wrong-pass1"})
        bad_user = c.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": "Wrong-pass1"})
    assert bad_pw.status_code == bad_user.status_code == 401
    assert bad_pw.json() == bad_user.json()


def test_protected_routes_require_auth(client):
    for path in ("/api/v1/auth/me", "/api/v1/users/me", "/api/v1/users/me/sessions"):
        assert client.get(path).status_code == 401


def test_me_and_profile_update(auth_client):
    assert auth_client.get("/api/v1/auth/me").json()["user"]["full_name"] == "Alice Tester"
    r = auth_client.patch("/api/v1/users/me", json={"full_name": "Alice  Updated"})
    assert r.status_code == 200 and r.json()["full_name"] == "Alice Updated"


def test_csrf_enforced_on_unsafe_cookie_requests(auth_client):
    auth_client.csrf = None
    r = auth_client.patch("/api/v1/users/me", json={"full_name": "No Csrf"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "csrf_failed"
    auth_client.csrf = "wrong-token"
    assert auth_client.patch("/api/v1/users/me", json={"full_name": "Bad Csrf"}).status_code == 403


def test_access_token_expiry(auth_client, monkeypatch):
    monkeypatch.setattr(get_settings(), "access_token_minutes", -1)
    with make_client() as c:
        r = c.post("/api/v1/auth/login", json={"email": "alice@example.com", "password": PASSWORD})
        assert r.status_code == 200
        assert c.get("/api/v1/auth/me").status_code == 401  # already expired


def test_refresh_rotation_and_reuse_detection(client, db):
    signup(client)
    old_refresh = client.cookies.get("nx_refresh")
    r = client.post("/api/v1/auth/refresh")
    assert r.status_code == 200
    new_refresh = client.cookies.get("nx_refresh")
    assert new_refresh != old_refresh
    rows = db.query(RefreshToken).all()
    assert len(rows) == 2 and all(len(x.token_hash) == 64 and x.token_hash != new_refresh for x in rows)
    # Replay the old (rotated) token: whole family must be revoked
    with make_client() as attacker:
        attacker.cookies.set("nx_refresh", old_refresh, path="/api/v1/auth")
        assert attacker.post("/api/v1/auth/refresh").status_code == 401
    db.expire_all()
    assert all(x.revoked_at is not None for x in db.query(RefreshToken).all())
    assert client.post("/api/v1/auth/refresh").status_code == 401
    assert db.query(AuditLog).filter_by(action="session.reuse_detected").count() >= 1


def test_refresh_requires_xhr_header(client):
    signup(client)
    r = client.post("/api/v1/auth/refresh", headers={"X-Requested-With": ""})
    assert r.status_code == 403


def test_logout_revokes_refresh(client, db):
    signup(client)
    token = client.cookies.get("nx_refresh")
    assert client.post("/api/v1/auth/logout").status_code == 204
    db.expire_all()
    row = db.query(RefreshToken).filter_by(token_hash=hash_token(token)).one()
    assert row.revoked_at is not None
    with make_client() as replay:
        replay.cookies.set("nx_refresh", token, path="/api/v1/auth")
        assert replay.post("/api/v1/auth/refresh").status_code == 401


def test_auth_rate_limit(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "rate_limit_auth", "3/60")
    reset_limits()
    codes = [client.post("/api/v1/auth/login", json={"email": "x@example.com", "password": "Wrong-pass1"}).status_code
             for _ in range(5)]
    assert codes[:3] == [401, 401, 401] and codes[3:] == [429, 429]


def test_password_reset_flow(client, monkeypatch):
    signup(client)
    with make_client() as c:
        r = c.post("/api/v1/auth/forgot-password", json={"email": "alice@example.com"})
        assert r.status_code == 200
        link = r.json()["dev_reset_link"]
        token = link.split("token=")[1]
        unknown = c.post("/api/v1/auth/forgot-password", json={"email": "ghost@example.com"})
        assert unknown.status_code == 200 and unknown.json()["dev_reset_link"] is None
        new_pw = "N3wPassword!!"
        body = {"token": token, "password": new_pw, "password_confirm": new_pw}
        assert c.post("/api/v1/auth/reset-password", json=body).status_code == 200
        assert c.post("/api/v1/auth/reset-password", json=body).status_code == 401  # single use
        assert c.post("/api/v1/auth/login", json={"email": "alice@example.com", "password": new_pw}).status_code == 200
    assert client.post("/api/v1/auth/refresh").status_code == 401  # old sessions revoked


def test_no_reset_link_returned_in_production(client, monkeypatch):
    signup(client)
    monkeypatch.setattr(get_settings(), "app_env", "production")
    r = client.post("/api/v1/auth/forgot-password", json={"email": "alice@example.com"})
    assert r.status_code == 200 and r.json()["dev_reset_link"] is None


def test_change_password_revokes_other_sessions(auth_client):
    other = make_client()
    other.post("/api/v1/auth/login", json={"email": "alice@example.com", "password": PASSWORD})
    new_pw = "An0therPass!!"
    r = auth_client.post("/api/v1/auth/change-password", json={
        "current_password": PASSWORD, "new_password": new_pw, "new_password_confirm": new_pw})
    assert r.status_code == 200
    assert other.post("/api/v1/auth/refresh").status_code == 401
    rr = auth_client.post("/api/v1/auth/refresh")
    assert rr.status_code == 200
    auth_client.csrf = rr.json()["csrf_token"]  # refresh rotates the CSRF token, like the SPA does
    bad = auth_client.post("/api/v1/auth/change-password", json={
        "current_password": "nope", "new_password": new_pw, "new_password_confirm": new_pw})
    assert bad.status_code == 401


# ---------------- Google OAuth ----------------
def _configure_google(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "google_client_id", "client-id.apps.googleusercontent.com")
    monkeypatch.setattr(s, "google_client_secret", "client-secret")


def test_google_unconfigured_is_explicit(client):
    assert client.get("/api/v1/auth/config").json()["google_enabled"] is False
    r = client.get("/api/v1/auth/google/login", follow_redirects=False)
    assert r.status_code == 302 and "error=google_not_configured" in r.headers["location"]
    r = client.get("/api/v1/auth/google/callback?code=x&state=y", follow_redirects=False)
    assert "error=google_not_configured" in r.headers["location"]
    assert client.get("/api/v1/auth/me").status_code == 401


def test_google_login_redirect_has_pkce_state_nonce(client, monkeypatch):
    _configure_google(monkeypatch)
    r = client.get("/api/v1/auth/google/login", follow_redirects=False)
    loc = r.headers["location"]
    assert loc.startswith(g.AUTH_URL)
    for part in ("code_challenge_method=S256", "state=", "nonce=", "code_challenge=", "response_type=code"):
        assert part in loc
    assert "nx_oauth_flow" in r.headers["set-cookie"] and "HttpOnly" in r.headers["set-cookie"]


def _start(client, monkeypatch):
    _configure_google(monkeypatch)
    r = client.get("/api/v1/auth/google/login", follow_redirects=False)
    state = [p.split("=")[1] for p in r.headers["location"].split("?")[1].split("&") if p.startswith("state=")][0]
    return state


def test_google_callback_success_creates_user(client, monkeypatch, db):
    state = _start(client, monkeypatch)
    captured = {}
    monkeypatch.setattr(g, "exchange_code", lambda code, verifier: captured.update(v=verifier) or {"id_token": "t"})
    monkeypatch.setattr(g, "verify_id_token", lambda tok, nonce: {
        "sub": "g-123", "email": "Gina@Example.com", "email_verified": True, "name": "Gina G"})
    r = client.get(f"/api/v1/auth/google/callback?code=abc&state={state}", follow_redirects=False)
    assert r.status_code == 302 and "status=success" in r.headers["location"]
    assert captured["v"]  # PKCE verifier was sent
    me = client.get("/api/v1/auth/me").json()["user"]
    assert me["email"] == "gina@example.com" and me["providers"] == ["google"] and me["has_password"] is False
    assert me["email_verified"] is True


def test_google_callback_state_mismatch_and_missing_cookie(client, monkeypatch):
    _start(client, monkeypatch)
    r = client.get("/api/v1/auth/google/callback?code=abc&state=forged", follow_redirects=False)
    assert "error=oauth_state_mismatch" in r.headers["location"]
    with make_client() as fresh:
        r = fresh.get("/api/v1/auth/google/callback?code=abc&state=x", follow_redirects=False)
        assert "error=oauth_state_missing" in r.headers["location"]


def test_google_callback_cancelled_and_bad_token(client, monkeypatch):
    state = _start(client, monkeypatch)
    r = client.get("/api/v1/auth/google/callback?error=access_denied", follow_redirects=False)
    assert "error=consent_cancelled" in r.headers["location"]
    state = _start(client, monkeypatch)  # the cancelled attempt correctly cleared the flow cookie
    monkeypatch.setattr(g, "exchange_code", lambda c, v: {"id_token": "bad"})
    r = client.get(f"/api/v1/auth/google/callback?code=abc&state={state}", follow_redirects=False)
    assert "error=oauth_invalid_token" in r.headers["location"]
    assert client.get("/api/v1/auth/me").status_code == 401


def test_google_refuses_to_link_existing_password_account(client, monkeypatch):
    signup(make_client(), email="gina@example.com")
    state = _start(client, monkeypatch)
    monkeypatch.setattr(g, "exchange_code", lambda c, v: {"id_token": "t"})
    monkeypatch.setattr(g, "verify_id_token", lambda t, n: {"sub": "g-9", "email": "gina@example.com",
                                                            "email_verified": True})
    r = client.get(f"/api/v1/auth/google/callback?code=abc&state={state}", follow_redirects=False)
    assert "error=account_exists" in r.headers["location"]
    assert client.get("/api/v1/auth/me").status_code == 401


def test_google_rejects_unverified_email(client, monkeypatch):
    state = _start(client, monkeypatch)
    monkeypatch.setattr(g, "exchange_code", lambda c, v: {"id_token": "t"})
    monkeypatch.setattr(g, "verify_id_token", lambda t, n: {"sub": "g-1", "email": "x@example.com",
                                                            "email_verified": False})
    r = client.get(f"/api/v1/auth/google/callback?code=abc&state={state}", follow_redirects=False)
    assert "error=oauth_email_unverified" in r.headers["location"]


def test_id_token_validation_rejects_wrong_audience_and_nonce(monkeypatch):
    import jwt as pyjwt
    from cryptography.hazmat.primitives.asymmetric import rsa
    _configure_google(monkeypatch)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    class FakeJwks:
        def get_signing_key_from_jwt(self, _):
            class K:
                pass
            k = K()
            k.key = key.public_key()
            return k
    monkeypatch.setattr(g, "_jwks", FakeJwks())
    import time
    base = {"iss": "https://accounts.google.com", "aud": "client-id.apps.googleusercontent.com",
            "sub": "1", "exp": int(time.time()) + 300, "nonce": "n1"}
    ok = pyjwt.encode(base, key, algorithm="RS256")
    assert g.verify_id_token(ok, "n1")["sub"] == "1"
    for bad_claims, nonce in (({**base, "aud": "other"}, "n1"), ({**base, "iss": "https://evil.example"}, "n1"),
                              ({**base, "exp": int(time.time()) - 10}, "n1"), (base, "wrong-nonce")):
        try:
            g.verify_id_token(pyjwt.encode(bad_claims, key, algorithm="RS256"), nonce)
        except g.OAuthFlowError:
            continue
        raise AssertionError(f"accepted bad token {bad_claims}")


def test_production_config_validation():
    import pytest
    from cryptography.fernet import Fernet

    from app.core.config import Settings
    with pytest.raises(ValueError, match="APP_SECRET_KEY"):
        Settings(app_env="production", app_secret_key="dev-secret-123", database_url="postgresql://u:p@h/db", cookie_secure=True,
                 frontend_url="https://x.example", tool_secret_encryption_key=Fernet.generate_key().decode())
    with pytest.raises(ValueError, match="Fernet"):
        Settings(app_env="development", tool_secret_encryption_key="not-a-key")


def test_blank_env_values_are_safe(tmp_path):
    """A beginner copies .env.example with blank secrets: must not sign tokens with an empty key."""
    import pytest

    from app.core.config import Settings
    env = tmp_path / ".env"
    env.write_text("APP_SECRET_KEY=   # blank\nCOOKIE_DOMAIN=\nOPENAI_API_KEY=\nTOOL_SECRET_ENCRYPTION_KEY=\n")
    dev = Settings(_env_file=str(env), app_secret_key="")
    assert len(dev.app_secret_key) >= 32 and dev.cookie_domain is None
    assert dev.openai_configured is False and dev.google_configured is False
    with pytest.raises(ValueError, match="APP_SECRET_KEY"):
        Settings(_env_file=str(env), app_env="production", app_secret_key="")
