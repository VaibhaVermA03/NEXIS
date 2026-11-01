from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.security import utcnow
from app.db.base import Base, IdMixin, TimestampMixin


class ApiKey(Base, IdMixin):
    __tablename__ = "api_keys"
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    prefix: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True)
    scopes: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Workflow(Base, IdMixin, TimestampMixin):
    __tablename__ = "workflows"
    __table_args__ = (UniqueConstraint("owner_id", "name", name="uq_workflows_owner_name"),)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(String(500), default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    steps: Mapped[list["WorkflowStep"]] = relationship(
        cascade="all, delete-orphan", order_by="WorkflowStep.position", lazy="selectin")


class WorkflowStep(Base, IdMixin):
    """Sequential step. `instruction` may reference {{input}} and {{previous}}."""
    __tablename__ = "workflow_steps"
    __table_args__ = (UniqueConstraint("workflow_id", "position", name="uq_wfstep_pos"),)
    workflow_id: Mapped[str] = mapped_column(ForeignKey("workflows.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"))
    instruction: Mapped[str] = mapped_column(Text)