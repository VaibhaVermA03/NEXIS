from sqlalchemy import (
    JSON,
    Boolean,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin


class Agent(Base, IdMixin, TimestampMixin):
    __tablename__ = "agents"
    __table_args__ = (UniqueConstraint("owner_id", "name", name="uq_agents_owner_name"),)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(String(500), default="")
    system_instructions: Mapped[str] = mapped_column(Text, default="")
    model: Mapped[str] = mapped_column(String(64), default="gpt-4o-mini")
    temperature: Mapped[float] = mapped_column(Float, default=0.2)
    max_steps: Mapped[int] = mapped_column(Integer, default=6)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    tool_permissions: Mapped[list["AgentToolPermission"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin")


class AgentToolPermission(Base):
    """tool_key is 'builtin:<name>' or 'custom:<tool_id>'."""
    __tablename__ = "agent_tool_permissions"
    agent_id: Mapped[str] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"), primary_key=True)
    tool_key: Mapped[str] = mapped_column(String(80), primary_key=True)


class ToolDefinition(Base, IdMixin, TimestampMixin):
    __tablename__ = "tool_definitions"
    __table_args__ = (UniqueConstraint("owner_id", "name", name="uq_tools_owner_name"),)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(String(500))
    method: Mapped[str] = mapped_column(String(8), default="GET")
    url: Mapped[str] = mapped_column(String(2048))
    auth_mode: Mapped[str] = mapped_column(String(16), default="none")  # none|bearer|header|query
    auth_name: Mapped[str | None] = mapped_column(String(64), nullable=True)  # header/query param name
    headers: Mapped[dict] = mapped_column(JSON, default=dict)  # NON-secret headers only
    input_schema: Mapped[dict] = mapped_column(JSON, default=dict)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=10)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    secrets: Mapped[list["EncryptedToolSecret"]] = relationship(cascade="all, delete-orphan", lazy="selectin")


class EncryptedToolSecret(Base, IdMixin):
    __tablename__ = "encrypted_tool_secrets"
    __table_args__ = (UniqueConstraint("tool_id", "key_name", name="uq_tool_secret_key"),)
    tool_id: Mapped[str] = mapped_column(ForeignKey("tool_definitions.id", ondelete="CASCADE"), index=True)
    key_name: Mapped[str] = mapped_column(String(64))
    ciphertext: Mapped[str] = mapped_column(Text)