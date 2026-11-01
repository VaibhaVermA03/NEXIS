import os
import tempfile

_DB = os.path.join(tempfile.mkdtemp(prefix="nexis-test-"), "test.db")
os.environ.update({"APP_ENV": "test", "DATABASE_URL": os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{_DB}", "OPENAI_API_KEY": "",
                   "GOOGLE_CLIENT_ID": "", "GOOGLE_CLIENT_SECRET": "", 
                   "APP_SECRET_KEY": "test-secret-key-for-pytest-only-0123456789",
                   "RATE_LIMIT_AUTH": "1000/60", "RATE_LIMIT_API": "100000/60"})

import pytest  # noqa: E402
from cryptography.fernet import Fernet  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.models  # noqa: E402,F401
from app.core.config import get_settings  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import get_engine, get_sessionmaker  # noqa: E402
from app.main import app  # noqa: E402
from app.middleware.ratelimit import reset_limits  # noqa: E402

PASSWORD = "Str0ngPassw0rd!"


@pytest.fixture(autouse=True)
def _fresh_db(monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "tool_secret_encryption_key", Fernet.generate_key().decode())
    engine = get_engine()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    reset_limits()
    yield
    from app.services.execution_service import shutdown_executor
    shutdown_executor()


@pytest.fixture
def db():
    session = get_sessionmaker()()
    yield session
    session.close()


class Client(TestClient):
    """TestClient that attaches the CSRF + XHR headers like the SPA does."""
    csrf: str | None = None

    def request(self, method, url, **kw):
        headers = dict(kw.pop("headers", None) or {})
        headers.setdefault("X-Requested-With", "nexis")
        if self.csrf and "X-CSRF-Token" not in headers:
            headers["X-CSRF-Token"] = self.csrf
        return super().request(method, url, headers=headers, **kw)


def make_client() -> Client:
    return Client(app, base_url="http://testserver")


@pytest.fixture
def client():
    with make_client() as c:
        yield c


def signup(c: Client, email="alice@example.com", name="Alice Tester", password=PASSWORD):
    r = c.post("/api/v1/auth/signup", json={"full_name": name, "email": email, "password": password,
                                            "password_confirm": password})
    if r.status_code == 201:
        c.csrf = r.json()["csrf_token"]
    return r


@pytest.fixture
def auth_client(client):
    assert signup(client).status_code == 201
    return client


@pytest.fixture
def second_client():
    with make_client() as c:
        assert signup(c, email="bob@example.com", name="Bob Tester").status_code == 201
        yield c