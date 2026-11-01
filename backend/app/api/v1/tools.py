import time

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.registry import ToolContext, builtin_specs, check_schema, custom_spec, validate_arguments
from app.api.deps import current_user, get_owned
from app.core.exceptions import AppError, Conflict
from app.core.security import encrypt_secret
from app.db.session import get_db
from app.middleware.ratelimit import limit_api
from app.models import AgentToolPermission, EncryptedToolSecret, ToolDefinition, User
from app.schemas.resources import ToolIn, ToolOut, ToolPatch, ToolTestIn
from app.services.auth_service import audit
from app.tools import ssrf
from app.tools.http_tools import ToolExecutionError

router = APIRouter(prefix="/tools", tags=["tools"], dependencies=[Depends(limit_api)])


def _out(t: ToolDefinition) -> ToolOut:
    return ToolOut(key=f"custom:{t.id}", kind="custom", id=t.id, name=t.name, description=t.description,
                   method=t.method, url=t.url, auth_mode=t.auth_mode, auth_name=t.auth_name,
                   headers=dict(t.headers or {}), has_secret=bool(t.secrets), input_schema=t.input_schema,
                   timeout_seconds=t.timeout_seconds, enabled=t.enabled, available=t.enabled,
                   unavailable_reason=None if t.enabled else "Disabled",
                   side_effect="none" if t.method == "GET" else "external", requires_approval=t.method != "GET")


def _validate_definition(url: str, headers: dict, input_schema: dict) -> None:
    try:
        ssrf.validate_url_static(url)
        ssrf.sanitize_headers(headers)
    except ssrf.UrlValidationError as exc:
        raise AppError(str(exc), status_code=422, code="invalid_tool") from exc
    if input_schema.get("type") != "object":
        raise AppError("input_schema must be a JSON Schema with type 'object'", status_code=422, code="invalid_schema")
    try:
        check_schema(input_schema)
    except Exception as exc:
        raise AppError(f"Invalid JSON Schema: {str(exc).splitlines()[0][:200]}", status_code=422,
                       code="invalid_schema") from exc


def _builtin_out(s) -> ToolOut:
    return ToolOut(key=s.key, kind="builtin", name=s.name, description=s.description, input_schema=s.input_schema,
                   timeout_seconds=s.timeout_seconds, enabled=True, available=s.available,
                   unavailable_reason=s.unavailable_reason, side_effect=s.side_effect,
                   requires_approval=s.requires_approval)


@router.get("", response_model=list[ToolOut])
def list_tools(user: User = Depends(current_user), db: Session = Depends(get_db)):
    custom = db.scalars(select(ToolDefinition).where(ToolDefinition.owner_id == user.id)
                        .order_by(ToolDefinition.created_at.desc())).all()
    return [_builtin_out(s) for s in builtin_specs().values()] + [_out(t) for t in custom]


@router.post("", response_model=ToolOut, status_code=201)
def create_tool(body: ToolIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if db.scalar(select(ToolDefinition.id).where(ToolDefinition.owner_id == user.id,
                                                 ToolDefinition.name == body.name)) \
            or body.name in {s.name for s in builtin_specs().values()}:
        raise Conflict("A tool with this name already exists", code="name_taken")
    _validate_definition(body.url, body.headers, body.input_schema)
    if body.auth_mode != "none" and not body.secret_value:
        raise AppError("secret_value is required when auth_mode is not 'none'", status_code=422, code="secret_required")
    tool = ToolDefinition(owner_id=user.id, **body.model_dump(exclude={"secret_value"}))
    if body.secret_value:
        tool.secrets = [EncryptedToolSecret(key_name="auth", ciphertext=encrypt_secret(body.secret_value))]
    db.add(tool)
    audit(db, user.id, "tool.created", "tool", tool.id, name=tool.name)
    db.commit()
    return _out(tool)


@router.get("/{tool_id}", response_model=ToolOut)
def get_tool(tool_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _out(get_owned(db, ToolDefinition, tool_id, user.id, "Tool"))


@router.patch("/{tool_id}", response_model=ToolOut)
def update_tool(tool_id: str, body: ToolPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = get_owned(db, ToolDefinition, tool_id, user.id, "Tool")
    data = body.model_dump(exclude_unset=True)
    secret, clear = data.pop("secret_value", None), data.pop("clear_secret", False)
    if data.get("name") and data["name"] != t.name:
        if db.scalar(select(ToolDefinition.id).where(ToolDefinition.owner_id == user.id,
                                                     ToolDefinition.name == data["name"])) \
                or data["name"] in {s.name for s in builtin_specs().values()}:
            raise Conflict("A tool with this name already exists", code="name_taken")
    merged = {"url": t.url, "headers": t.headers, "input_schema": t.input_schema, **{k: v for k, v in data.items()
              if v is not None}}
    _validate_definition(merged["url"], merged["headers"], merged["input_schema"])
    for k, v in data.items():
        if v is not None:
            setattr(t, k, v)
    if t.auth_mode in ("header", "query") and not t.auth_name:
        raise AppError("auth_name is required for header/query auth", status_code=422, code="validation_error")
    if clear:
        t.secrets = []
    if secret:
        if t.secrets:  # update in place: replacing the row would violate the unique (tool_id, key_name)
            t.secrets[0].ciphertext = encrypt_secret(secret)
        else:
            t.secrets = [EncryptedToolSecret(tool_id=t.id, key_name="auth", ciphertext=encrypt_secret(secret))]
    if t.auth_mode != "none" and not t.secrets:
        raise AppError("A secret is required when auth_mode is not 'none'", status_code=422, code="secret_required")
    audit(db, user.id, "tool.updated", "tool", t.id, secret_replaced=bool(secret or clear))
    db.commit()
    return _out(t)


@router.delete("/{tool_id}", status_code=204)
def delete_tool(tool_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    t = get_owned(db, ToolDefinition, tool_id, user.id, "Tool")
    for perm in db.scalars(select(AgentToolPermission).where(AgentToolPermission.tool_key == f"custom:{t.id}")):
        db.delete(perm)
    audit(db, user.id, "tool.deleted", "tool", t.id)
    db.delete(t)
    db.commit()


@router.post("/{tool_id}/test")
def test_tool(tool_id: str, body: ToolTestIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Performs a REAL request through the SSRF-protected runner. Non-GET tools need explicit confirmation."""
    t = get_owned(db, ToolDefinition, tool_id, user.id, "Tool")
    if t.method != "GET" and not body.confirm_side_effects:
        raise AppError(f"{t.method} tools can change data on the remote system. Re-send with "
                       "confirm_side_effects=true to proceed.", status_code=409, code="confirmation_required")
    started = time.monotonic()
    spec = custom_spec(t)
    try:
        validate_arguments(t.input_schema, body.arguments)
        result = spec.run(ToolContext(db, user.id, "tool-test"), body.arguments)
        ok, error = True, None
    except ToolExecutionError as exc:
        result, ok, error = None, False, {"code": exc.code, "message": exc.message}
    audit(db, user.id, "tool.tested", "tool", t.id, ok=ok)
    db.commit()
    return {"ok": ok, "duration_ms": int((time.monotonic() - started) * 1000), "result": result, "error": error}