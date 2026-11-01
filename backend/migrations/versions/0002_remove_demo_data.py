"""Remove all demo functionality: sample_orders table, agents.is_demo, and demo/mock data rows.

Revision ID: 0002
Revises: 0001

DATA MIGRATION (destructive, demo data only). On upgrade this deletes:
  * agents flagged is_demo (the auto-created "Order Support Assistant (Demo)") with their tool grants / workflow steps
  * executions that ran in mock mode (with their events and approvals)
  * tool grants that point to the removed built-in tools (order_lookup, shipping_status, send_email)
Executions of real runs that used a demo agent are kept (their agent link becomes empty).
Take a database backup before applying this to a database that holds real data.
"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

REMOVED_TOOLS = ("builtin:order_lookup", "builtin:shipping_status", "builtin:send_email")


def upgrade() -> None:
    bind = op.get_bind()
    demo_agents = "SELECT id FROM agents WHERE is_demo = :t"
    mock_runs = "SELECT id FROM executions WHERE mode = 'mock'"
    t = {"t": True}
    # mock executions (events/approvals first so this also works where FK cascades are not enforced)
    bind.execute(sa.text(f"DELETE FROM execution_events WHERE execution_id IN ({mock_runs})"))
    bind.execute(sa.text(f"DELETE FROM execution_approvals WHERE execution_id IN ({mock_runs})"))
    bind.execute(sa.text("DELETE FROM executions WHERE mode = 'mock'"))
    # demo agents
    bind.execute(sa.text(f"UPDATE executions SET agent_id = NULL WHERE agent_id IN ({demo_agents})"), t)
    bind.execute(sa.text(f"DELETE FROM workflow_steps WHERE agent_id IN ({demo_agents})"), t)
    bind.execute(sa.text(f"DELETE FROM agent_tool_permissions WHERE agent_id IN ({demo_agents})"), t)
    bind.execute(sa.text("DELETE FROM agents WHERE is_demo = :t"), t)
    # grants to the removed built-in tools on remaining (user-made) agents
    for key in REMOVED_TOOLS:
        bind.execute(sa.text("DELETE FROM agent_tool_permissions WHERE tool_key = :k"), {"k": key})
    # schema
    with op.batch_alter_table("sample_orders", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_sample_orders_order_no"))
    op.drop_table("sample_orders")
    with op.batch_alter_table("agents", schema=None) as batch_op:
        batch_op.drop_column("is_demo")


def downgrade() -> None:
    """Restores the (empty) schema only; deleted demo rows are not brought back."""
    with op.batch_alter_table("agents", schema=None) as batch_op:
        batch_op.add_column(sa.Column("is_demo", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_table(
        "sample_orders",
        sa.Column("order_no", sa.String(length=24), nullable=False),
        sa.Column("customer_name", sa.String(length=120), nullable=False),
        sa.Column("customer_email", sa.String(length=320), nullable=False),
        sa.Column("items", sa.JSON(), nullable=False),
        sa.Column("total", sa.Numeric(precision=10, scale=2), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("carrier", sa.String(length=32), nullable=False),
        sa.Column("tracking_no", sa.String(length=40), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("id", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sample_orders")),
    )
    with op.batch_alter_table("sample_orders", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_sample_orders_order_no"), ["order_no"], unique=True)