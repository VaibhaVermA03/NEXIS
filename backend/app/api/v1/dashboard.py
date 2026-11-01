from collections import Counter, defaultdict
from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.core.security import utcnow
from app.db.session import get_db
from app.middleware.ratelimit import limit_api
from app.models import Agent, Execution, ExecutionEvent, User
from app.models.execution import TERMINAL

router = APIRouter(prefix="/dashboard", tags=["dashboard"], dependencies=[Depends(limit_api)])
ROW_CAP = 20000


def _aware(dt):
    return dt if dt.tzinfo else dt.replace(tzinfo=utcnow().tzinfo)


def _period_rows(db: Session, user_id: str, days: int):
    since = utcnow() - timedelta(days=days)
    rows = db.execute(select(Execution.id, Execution.agent_id, Execution.status, Execution.duration_ms,
                             Execution.created_at).where(
        Execution.owner_id == user_id, Execution.created_at >= since).order_by(Execution.created_at.desc())
        .limit(ROW_CAP)).all()
    return since, rows


def _daily(rows, days: int) -> list[dict]:
    today = utcnow().date()
    buckets = {(today - timedelta(days=i)).isoformat(): {"total": 0, "completed": 0, "failed": 0, "dur": []}
               for i in range(days - 1, -1, -1)}
    for r in rows:
        b = buckets.get(_aware(r.created_at).date().isoformat())
        if b is None:
            continue
        b["total"] += 1
        if r.status == "completed":
            b["completed"] += 1
            if r.duration_ms is not None:
                b["dur"].append(r.duration_ms)
        elif r.status == "failed":
            b["failed"] += 1
    return [{"date": d, "total": b["total"], "completed": b["completed"], "failed": b["failed"],
             "avg_duration_ms": round(sum(b["dur"]) / len(b["dur"])) if b["dur"] else None}
            for d, b in buckets.items()]


@router.get("/summary")
def summary(days: int = Query(7, ge=1, le=90), user: User = Depends(current_user), db: Session = Depends(get_db)):
    total_agents = db.scalar(select(func.count()).select_from(Agent).where(Agent.owner_id == user.id)) or 0
    active_agents = db.scalar(select(func.count()).select_from(Agent).where(
        Agent.owner_id == user.id, Agent.enabled.is_(True))) or 0
    _, rows = _period_rows(db, user.id, days)
    status_counts = Counter(r.status for r in rows)
    names = dict(db.execute(select(Agent.id, Agent.name).where(Agent.owner_id == user.id)).all())
    usage = Counter(r.agent_id for r in rows if r.agent_id)
    recent = db.scalars(select(Execution).where(Execution.owner_id == user.id)
                        .order_by(Execution.created_at.desc()).limit(6)).all()
    return {
        "period_days": days, "total_agents": total_agents, "active_agents": active_agents,
        "executions_in_period": len(rows), "completed": status_counts["completed"], "failed": status_counts["failed"],
        "cancelled": status_counts["cancelled"], "in_progress": sum(status_counts[s] for s in
                                                                    ("queued", "running", "awaiting_approval")),
        "agent_usage": [{"agent_id": a, "name": names.get(a, "(deleted)"), "executions": n}
                        for a, n in usage.most_common(8)],
        "daily": _daily(rows, days),
        "recent_executions": [{"id": e.id, "task": e.task[:140], "status": e.status,
                               "agent_name": names.get(e.agent_id), "created_at": e.created_at,
                               "duration_ms": e.duration_ms} for e in recent],
    }


@router.get("/analytics")
def analytics(days: int = Query(30, ge=1, le=90), user: User = Depends(current_user), db: Session = Depends(get_db)):
    _, rows = _period_rows(db, user.id, days)
    finished = [r for r in rows if r.status in TERMINAL]
    durations = sorted(r.duration_ms for r in rows if r.status == "completed" and r.duration_ms is not None)
    ids = [r.id for r in rows][:5000]
    tool_stats: dict[str, dict] = defaultdict(lambda: {"completed": 0, "failed": 0})
    if ids:
        for etype, payload in db.execute(select(ExecutionEvent.type, ExecutionEvent.payload).where(
                ExecutionEvent.execution_id.in_(ids),
                ExecutionEvent.type.in_(("tool.execution.completed", "tool.execution.failed")))).all():
            name = (payload or {}).get("tool", "unknown")
            tool_stats[name]["completed" if etype.endswith("completed") else "failed"] += 1
    p = lambda q: durations[min(len(durations) - 1, int(len(durations) * q))] if durations else None  # noqa: E731
    return {
        "period_days": days, "total": len(rows),
        "success_rate": round(100 * sum(1 for r in finished if r.status == "completed") / len(finished), 1)
        if finished else None,
        "avg_duration_ms": round(sum(durations) / len(durations)) if durations else None,
        "p50_duration_ms": p(0.5), "p95_duration_ms": p(0.95),
        "daily": _daily(rows, days),
        "tool_usage": sorted([{"tool": k, **v} for k, v in tool_stats.items()],
                             key=lambda x: -(x["completed"] + x["failed"])),
    }