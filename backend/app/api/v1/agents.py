from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.agents.registry import builtin_specs
from app.api.deps import current_user, get_owned
from app.core.exceptions import AppError, Conflict
from app.db.session import get_db
from app.middleware.ratelimit import limit_api
from app.models import Agent, AgentToolPermission, Execution, ToolDefinition, User
from app.schemas.resources import AgentIn, AgentOut, AgentPatch, Page
from app.services.auth_service import audit

router = APIRouter(prefix="/agents", tags=["agents"], dependencies=[Depends(limit_api)])


def _validate_tool_keys(db: Session, user_id: str, keys: list[str]) -> list[str]:
    keys = list(dict.fromkeys(keys))
    builtins = builtin_specs()
    custom_ids = []
    for k in keys:
        if k in builtins:
            continue
        if k.startswith("custom:"):
            custom_ids.append(k.split(":", 1)[1])
        else:
            raise AppError(f"Unknown tool '{k}'", status_code=422, code="unknown_tool")
    if custom_ids:
        found = set(db.scalars(select(ToolDefinition.id).where(ToolDefinition.id.in_(custom_ids),
                                                                ToolDefinition.owner_id == user_id)))
        missing = set(custom_ids) - found
        if missing:
            raise AppError("One or more custom tools were not found", status_code=422, code="unknown_tool")
    return keys


def _out(a: Agent, count: int = 0) -> AgentOut:
    return AgentOut(id=a.id, name=a.name, description=a.description, system_instructions=a.system_instructions,
                    model=a.model, temperature=a.temperature, max_steps=a.max_steps, enabled=a.enabled,
                    tool_keys=sorted(p.tool_key for p in a.tool_permissions),
                    execution_count=count, created_at=a.created_at, updated_at=a.updated_at)


def _count(db: Session, agent_id: str) -> int:
    return db.scalar(select(func.count()).select_from(Execution).where(Execution.agent_id == agent_id)) or 0


def _name_taken(db: Session, owner_id: str, name: str, exclude: str | None = None) -> bool:
    q = select(Agent.id).where(Agent.owner_id == owner_id, Agent.name == name)
    if exclude:
        q = q.where(Agent.id != exclude)
    return db.scalar(q) is not None


@router.get("", response_model=Page[AgentOut])
def list_agents(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100), q: str | None = None,
                enabled: bool | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(Agent).where(Agent.owner_id == user.id)
    if q:
        stmt = stmt.where(Agent.name.ilike(f"%{q[:100]}%"))
    if enabled is not None:
        stmt = stmt.where(Agent.enabled.is_(enabled))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(Agent.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    counts = dict(db.execute(select(Execution.agent_id, func.count()).where(
        Execution.agent_id.in_([a.id for a in rows])).group_by(Execution.agent_id)).all()) if rows else {}
    return Page(items=[_out(a, counts.get(a.id, 0)) for a in rows], total=total, page=page, page_size=page_size)


@router.post("", response_model=AgentOut, status_code=201)
def create_agent(body: AgentIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if _name_taken(db, user.id, body.name):
        raise Conflict("You already have an agent with this name", code="name_taken")
    keys = _validate_tool_keys(db, user.id, body.tool_keys)
    agent = Agent(owner_id=user.id, **body.model_dump(exclude={"tool_keys"}),
                  tool_permissions=[AgentToolPermission(tool_key=k) for k in keys])
    db.add(agent)
    audit(db, user.id, "agent.created", "agent", agent.id)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise Conflict("You already have an agent with this name", code="name_taken") from exc
    return _out(agent)


@router.get("/{agent_id}", response_model=AgentOut)
def get_agent(agent_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = get_owned(db, Agent, agent_id, user.id, "Agent")
    return _out(a, _count(db, a.id))


@router.patch("/{agent_id}", response_model=AgentOut)
def update_agent(agent_id: str, body: AgentPatch, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = get_owned(db, Agent, agent_id, user.id, "Agent")
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        data["name"] = data["name"].strip()
        if not data["name"]:
            raise AppError("Name cannot be blank", status_code=422, code="validation_error")
        if _name_taken(db, user.id, data["name"], exclude=a.id):
            raise Conflict("You already have an agent with this name", code="name_taken")
    keys = data.pop("tool_keys", None)
    for k, v in data.items():
        if v is not None:
            setattr(a, k, v)
    if keys is not None:
        keys = _validate_tool_keys(db, user.id, keys)
        a.tool_permissions = [AgentToolPermission(agent_id=a.id, tool_key=k) for k in keys]
    audit(db, user.id, "agent.updated", "agent", a.id)
    db.commit()
    return _out(a, _count(db, a.id))


@router.post("/{agent_id}/duplicate", response_model=AgentOut, status_code=201)
def duplicate_agent(agent_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    src = get_owned(db, Agent, agent_id, user.id, "Agent")
    base, n = f"{src.name} (copy)"[:100], 1
    name = base
    while _name_taken(db, user.id, name):
        n += 1
        name = f"{base[:92]} {n}"
    clone = Agent(owner_id=user.id, name=name, description=src.description, model=src.model,
                  system_instructions=src.system_instructions, temperature=src.temperature,
                  max_steps=src.max_steps, enabled=src.enabled,
                  tool_permissions=[AgentToolPermission(tool_key=p.tool_key) for p in src.tool_permissions])
    db.add(clone)
    audit(db, user.id, "agent.duplicated", "agent", clone.id, source=src.id)
    db.commit()
    return _out(clone)


@router.delete("/{agent_id}", status_code=204)
def delete_agent(agent_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = get_owned(db, Agent, agent_id, user.id, "Agent")
    audit(db, user.id, "agent.deleted", "agent", a.id)
    db.delete(a)  # executions keep history (agent_id -> NULL); workflow steps referencing it cascade
    db.commit()