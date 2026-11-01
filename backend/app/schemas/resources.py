import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

TOOL_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{2,63}$")


class Page[T](BaseModel):
    items: list[T]
    total: int
    page: int
    page_size: int


# ---------- agents ----------
class AgentIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    system_instructions: str = Field(default="", max_length=8000)
    model: str = Field(default="gpt-4o-mini", min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._\-:]+$")
    temperature: float = Field(default=0.2, ge=0, le=2)
    max_steps: int = Field(default=6, ge=1, le=10)
    enabled: bool = True
    tool_keys: list[str] = Field(default_factory=list, max_length=30)

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name cannot be blank")
        return v


class AgentPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    system_instructions: str | None = Field(default=None, max_length=8000)
    model: str | None = Field(default=None, min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._\-:]+$")
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_steps: int | None = Field(default=None, ge=1, le=10)
    enabled: bool | None = None
    tool_keys: list[str] | None = Field(default=None, max_length=30)


class AgentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    description: str
    system_instructions: str
    model: str
    temperature: float
    max_steps: int
    enabled: bool
    tool_keys: list[str]
    execution_count: int = 0
    created_at: datetime
    updated_at: datetime


# ---------- tools ----------
class ToolIn(BaseModel):
    name: str
    description: str = Field(min_length=3, max_length=500)
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] = "GET"
    url: str = Field(min_length=8, max_length=2048)
    auth_mode: Literal["none", "bearer", "header", "query"] = "none"
    auth_name: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9_\-]+$")
    headers: dict[str, str] = Field(default_factory=dict)
    input_schema: dict = Field(default_factory=lambda: {"type": "object", "properties": {}, "additionalProperties": False})
    timeout_seconds: int = Field(default=10, ge=1, le=30)
    enabled: bool = True
    secret_value: str | None = Field(default=None, min_length=1, max_length=2000)  # write-only

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        if not TOOL_NAME_RE.match(v):
            raise ValueError("Name must be snake_case: lowercase letters, digits, underscores (3-64 chars)")
        return v

    @field_validator("headers")
    @classmethod
    def _headers(cls, v: dict) -> dict:
        if len(v) > 20:
            raise ValueError("At most 20 headers")
        return v

    @model_validator(mode="after")
    def _auth(self):
        if self.auth_mode in ("header", "query") and not self.auth_name:
            raise ValueError("auth_name is required for header/query auth")
        return self


class ToolPatch(BaseModel):
    name: str | None = None
    description: str | None = Field(default=None, min_length=3, max_length=500)
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] | None = None
    url: str | None = Field(default=None, min_length=8, max_length=2048)
    auth_mode: Literal["none", "bearer", "header", "query"] | None = None
    auth_name: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9_\-]+$")
    headers: dict[str, str] | None = None
    input_schema: dict | None = None
    timeout_seconds: int | None = Field(default=None, ge=1, le=30)
    enabled: bool | None = None
    secret_value: str | None = Field(default=None, min_length=1, max_length=2000)  # replaces stored secret
    clear_secret: bool = False

    @field_validator("name")
    @classmethod
    def _name(cls, v):
        if v is not None and not TOOL_NAME_RE.match(v):
            raise ValueError("Name must be snake_case: lowercase letters, digits, underscores (3-64 chars)")
        return v


class ToolTestIn(BaseModel):
    arguments: dict = Field(default_factory=dict)
    confirm_side_effects: bool = False


class ToolOut(BaseModel):
    key: str
    kind: Literal["builtin", "custom"]
    id: str | None = None
    name: str
    description: str
    method: str | None = None
    url: str | None = None
    auth_mode: str | None = None
    auth_name: str | None = None
    headers: dict[str, str] = {}
    has_secret: bool = False
    input_schema: dict
    timeout_seconds: int
    enabled: bool
    available: bool
    unavailable_reason: str | None = None
    side_effect: str = "none"
    requires_approval: bool = False


# ---------- api keys ----------
ApiScope = Literal["executions:read", "executions:write"]


class ApiKeyIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    scopes: list[ApiScope] = Field(default_factory=lambda: ["executions:read", "executions:write"], min_length=1)


class ApiKeyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    prefix: str
    scopes: list[str]
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None


class ApiKeyCreated(ApiKeyOut):
    key: str  # full secret, returned ONCE


# ---------- workflows ----------
class WorkflowStepIn(BaseModel):
    agent_id: str
    instruction: str = Field(min_length=1, max_length=4000)


class WorkflowIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=500)
    enabled: bool = True
    steps: list[WorkflowStepIn] = Field(min_length=1, max_length=10)


class WorkflowPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    enabled: bool | None = None
    steps: list[WorkflowStepIn] | None = Field(default=None, min_length=1, max_length=10)


class WorkflowStepOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    position: int
    agent_id: str
    agent_name: str | None = None
    instruction: str


class WorkflowOut(BaseModel):
    id: str
    name: str
    description: str
    enabled: bool
    steps: list[WorkflowStepOut]
    run_count: int = 0
    created_at: datetime
    updated_at: datetime


# ---------- executions ----------
class ExecutionCreate(BaseModel):
    agent_id: str | None = None
    workflow_id: str | None = None
    task: str = Field(min_length=1, max_length=8000)
    params: dict = Field(default_factory=dict)
    mode: Literal["live"] = "live"   # accepted for backward compatibility; the only supported mode

    @model_validator(mode="after")
    def _one(self):
        if bool(self.agent_id) == bool(self.workflow_id):
            raise ValueError("Provide exactly one of agent_id or workflow_id")
        return self


class ExecutionOut(BaseModel):
    id: str
    agent_id: str | None
    agent_name: str | None = None
    workflow_id: str | None
    task: str
    params: dict
    status: str
    mode: str
    result: str | None
    error: str | None
    source: str
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    duration_ms: int | None
    pending_approval: dict | None = None


class ApprovalDecision(BaseModel):
    approve: bool