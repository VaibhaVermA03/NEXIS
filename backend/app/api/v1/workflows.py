from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import current_user, get_owned
from app.core.exceptions import AppError, Conflict
from app.db.session import get_db
from app.middleware.ratelimit import limit_api
from app.models import Agent, Execution, User, Workflow, WorkflowStep
from app.schemas.resources import Page, WorkflowIn, WorkflowOut, WorkflowPatch, WorkflowStepIn, WorkflowStepOut
from app.services.auth_service import audit

router = APIRouter(prefix="/workflows", tags=["workflows"], dependencies=[Depends(limit_api)])


def _steps(db: Session, user_id: str, steps: list[WorkflowStepIn]) -> list[WorkflowStep]:
    ids = {s.agent_id for s in steps}
    owned = set(db.scalars(select(Agent.id).where(Agent.id.in_(ids), Agent.owner_id == user_id)))
    if ids - owned:
        raise AppError("One or more agents were not found", status_code=422, code="unknown_agent")
    return [WorkflowStep(position=i, agent_id=s.agent_id, instruction=s.instruction) for i, s in enumerate(steps)]


def _out(db: Session, w: Workflow) -> WorkflowOut:
    names = dict(db.execute(select(Agent.id, Agent.name).where(Agent.id.in_([s.agent_id for s in w.steps]))).all()) \
        if w.steps else {}
    runs = db.scalar(select(func.count()).select_from(Execution).where(Execution.workflow_id == w.id)) or 0
    return WorkflowOut(id=w.id, name=w.name, description=w.description, enabled=w.enabled, run_count=runs,
                       created_at=w.created_at, updated_at=w.updated_at,
                       steps=[WorkflowStepOut(id=s.id, position=s.position, agent_id=s.agent_id,
                                              agent_name=names.get(s.agent_id), instruction=s.instruction)
                              for s in w.steps])


def _taken(db: Session, owner_id: str, name: str, exclude: str | None = None) -> bool:
    q = select(Workflow.id).where(Workflow.owner_id == owner_id, Workflow.name == name)
    if exclude:
        q = q.where(Workflow.id != exclude)
    return db.scalar(q) is not None


@router.get("", response_model=Page[WorkflowOut])
def list_workflows(page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
                   user: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(Workflow).where(Workflow.owner_id == user.id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(Workflow.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return Page(items=[_out(db, w) for w in rows], total=total, page=page, page_size=page_size)


@router.post("", response_model=WorkflowOut, status_code=201)
def create_workflow(body: WorkflowIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if _taken(db, user.id, body.name.strip()):
        raise Conflict("You already have a workflow with this name", code="name_taken")
    w = Workflow(owner_id=user.id, name=body.name.strip(), description=body.description, enabled=body.enabled,
                 steps=_steps(db, user.id, body.steps))
    db.add(w)
    audit(db, user.id, "workflow.created", "workflow", w.id)
    db.commit()
    return _out(db, w)


@router.get("/{workflow_id}", response_model=WorkflowOut)
def get_workflow(workflow_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _out(db, get_owned(db, Workflow, workflow_id, user.id, "Workflow"))


@router.patch("/{workflow_id}", response_model=WorkflowOut)
def update_workflow(workflow_id: str, body: WorkflowPatch, user: User = Depends(current_user),
                    db: Session = Depends(get_db)):
    w = get_owned(db, Workflow, workflow_id, user.id, "Workflow")
    data = body.model_dump(exclude_unset=True, exclude={"steps"})
    if data.get("name"):
        data["name"] = data["name"].strip()
        if _taken(db, user.id, data["name"], exclude=w.id):
            raise Conflict("You already have a workflow with this name", code="name_taken")
    for k, v in data.items():
        if v is not None:
            setattr(w, k, v)
    if body.steps is not None:
        new_steps = _steps(db, user.id, body.steps)
        w.steps.clear()
        db.flush()  # delete old rows first so (workflow_id, position) stays unique
        w.steps.extend(new_steps)
    audit(db, user.id, "workflow.updated", "workflow", w.id)
    db.commit()
    return _out(db, w)


@router.delete("/{workflow_id}", status_code=204)
def delete_workflow(workflow_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    w = get_owned(db, Workflow, workflow_id, user.id, "Workflow")
    audit(db, user.id, "workflow.deleted", "workflow", w.id)
    db.delete(w)
    db.commit()
