"""Password hashing, JWT, opaque tokens, API keys, secret encryption, CSRF."""
import hashlib
import hmac
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings
from app.core.exceptions import ServiceUnavailable, Unauthorized

_ph = PasswordHasher()  # Argon2id by default
JWT_ALG = "HS256"


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_id() -> str:
    return str(uuid.uuid4())


# ---- passwords ----
def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return _ph.verify(hashed, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(hashed: str) -> bool:
    return _ph.check_needs_rehash(hashed)


# Hash used to equalize timing when the account does not exist.
DUMMY_HASH = _ph.hash("nexis-dummy-password")


# ---- JWT access tokens ----
def create_access_token(user_id: str) -> str:
    s = get_settings()
    now = utcnow()
    payload = {"sub": user_id, "iat": now, "exp": now + timedelta(minutes=s.access_token_minutes),
               "typ": "access", "jti": new_id()}
    return jwt.encode(payload, s.app_secret_key, algorithm=JWT_ALG)


def decode_access_token(token: str) -> dict:
    s = get_settings()
    try:
        payload = jwt.decode(token, s.app_secret_key, algorithms=[JWT_ALG], options={"require": ["exp", "sub"]})
    except jwt.PyJWTError as exc:
        raise Unauthorized("Invalid or expired session") from exc
    if payload.get("typ") != "access":
        raise Unauthorized("Invalid token type")
    return payload


# ---- opaque tokens (refresh, reset, csrf) ----
def generate_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def hash_token(token: str) -> str:
    """HMAC-SHA256 keyed with the app secret; only this value is stored."""
    key = get_settings().app_secret_key.encode()
    return hmac.new(key, token.encode(), hashlib.sha256).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


# ---- API keys: nx_<8 char prefix>_<secret> ----
API_KEY_PREFIX_LEN = 8


def generate_api_key() -> tuple[str, str, str]:
    prefix = secrets.token_hex(4)
    secret = secrets.token_urlsafe(32)
    full = f"nx_{prefix}_{secret}"
    return full, f"nx_{prefix}", hash_token(full)


def parse_api_key_prefix(raw: str) -> str | None:
    if not raw.startswith("nx_"):
        return None
    parts = raw.split("_", 2)
    if len(parts) != 3 or len(parts[1]) != API_KEY_PREFIX_LEN:
        return None
    return f"nx_{parts[1]}"


# ---- tool secret encryption (Fernet = AES-128-CBC + HMAC, authenticated) ----
def _fernet() -> Fernet:
    key = get_settings().tool_secret_encryption_key
    if not key:
        raise ServiceUnavailable(
            "TOOL_SECRET_ENCRYPTION_KEY is not configured; tool secrets cannot be stored.",
            code="encryption_not_configured")
    return Fernet(key.encode())


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise ServiceUnavailable("Stored secret could not be decrypted (wrong key?)",
                                 code="decryption_failed") from exc


def mask_secret(value: str) -> str:
    return "••••••••"
