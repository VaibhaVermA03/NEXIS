"""Migration 0002 removes demo data. Verified against realistic rows: demo data goes, real data stays."""
from datetime import UTC, datetime
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import MetaData, insert, inspect, select, text

from app.db.base import Base
from app.db.session import get_engine

NOW = datetime(2026, 10, 1, tzinfo=UTC)


def _cfg() -> Config:
    root = Path(__file__).resolve().parents[2]
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "migrations"))
    return cfg


def _reset(engine):
    Base.metadata.drop_all(engine)
    with engine.begin() as c:
        for t in ("sample_orders", "alembic_version"):
            c.execute(text(f"DROP TABLE IF EXISTS {t}"))


def test_demo_data_and_schema_are_removed_but_real_data_is_kept():
    engine = get_engine()
    _reset(engine)
    try:
        command.upgrade(_cfg(), "0001")
        meta = MetaData()
        meta.reflect(bind=engine)
        t = meta.tables
        with engine.begin() as c:
            c.execute(insert(t["users"]), [{"id": "u1", "email": "a@example.com", "full_name": "A", "is_active": True,
                                            "email_verified": False, "created_at": NOW, "updated_at": NOW}])
            base = {"owner_id": "u1", "description": "", "system_instructions": "", "model": "gpt-4o-mini",
                    "temperature": 0.2, "max_steps": 6, "enabled": True, "created_at": NOW, "updated_at": NOW}
            c.execute(insert(t["agents"]), [{**base, "id": "demo", "name": "Order Support Assistant (Demo)", "is_demo": True},
                                            {**base, "id": "real", "name": "My Agent", "is_demo": False}])
            c.execute(insert(t["agent_tool_permissions"]), [
                {"agent_id": "demo", "tool_key": "builtin:order_lookup"}, {"agent_id": "demo", "tool_key": "builtin:generate_report"},
                {"agent_id": "real", "tool_key": "builtin:order_lookup"}, {"agent_id": "real", "tool_key": "builtin:shipping_status"},
                {"agent_id": "real", "tool_key": "builtin:send_email"}, {"agent_id": "real", "tool_key": "builtin:generate_report"},
                {"agent_id": "real", "tool_key": "builtin:http_request"}])
            c.execute(insert(t["workflows"]), [{"id": "w1", "owner_id": "u1", "name": "W", "description": "", "enabled": True,
                                                "created_at": NOW, "updated_at": NOW}])
            c.execute(insert(t["workflow_steps"]), [{"id": "s1", "workflow_id": "w1", "position": 0, "agent_id": "demo", "instruction": "x"},
                                                    {"id": "s2", "workflow_id": "w1", "position": 1, "agent_id": "real", "instruction": "y"}])
            ex = {"owner_id": "u1", "task": "t", "params": {}, "status": "completed", "cancel_requested": False, "source": "ui",
                  "created_at": NOW}
            c.execute(insert(t["executions"]), [
                {**ex, "id": "e_mock", "agent_id": "real", "mode": "mock"},         # demo run on a user's own agent
                {**ex, "id": "e_live_demo", "agent_id": "demo", "mode": "live"},    # real run that used the demo agent
                {**ex, "id": "e_live_real", "agent_id": "real", "mode": "live"}])
            c.execute(insert(t["execution_events"]), [{"execution_id": "e_mock", "type": "execution.accepted", "payload": {}, "created_at": NOW},
                                                       {"execution_id": "e_live_real", "type": "execution.accepted", "payload": {}, "created_at": NOW}])
            c.execute(insert(t["execution_approvals"]), [{"id": "ap1", "execution_id": "e_mock", "tool_name": "send_email", "arguments": {},
                                                          "status": "approved", "created_at": NOW}])
            c.execute(insert(t["sample_orders"]), [{"id": "o1", "order_no": "ORD-1001", "customer_name": "x", "customer_email": "x@example.com",
                                                    "items": [], "total": 1, "status": "delivered", "carrier": "c", "tracking_no": "T1"}])

        command.upgrade(_cfg(), "0002")

        insp = inspect(engine)
        assert "sample_orders" not in insp.get_table_names()
        assert "is_demo" not in {c["name"] for c in insp.get_columns("agents")}
        meta2 = MetaData()
        meta2.reflect(bind=engine)
        q = lambda tbl, col: sorted(r[0] for r in engine.connect().execute(select(meta2.tables[tbl].c[col])))  # noqa: E731
        assert q("agents", "id") == ["real"]                                                        # demo agent gone, user's agent kept
        assert q("agent_tool_permissions", "tool_key") == ["builtin:generate_report", "builtin:http_request"]  # removed tools revoked
        assert q("workflow_steps", "id") == ["s2"]                                                  # step using the demo agent removed
        assert q("executions", "id") == ["e_live_demo", "e_live_real"]                               # mock run removed; real runs kept
        with engine.connect() as c:
            e = c.execute(select(meta2.tables["executions"].c.agent_id).where(meta2.tables["executions"].c.id == "e_live_demo")).scalar()
        assert e is None                                                                             # history kept, link cleared
        assert q("execution_events", "execution_id") == ["e_live_real"] and q("execution_approvals", "id") == []

        command.downgrade(_cfg(), "0001")                                                            # schema comes back (empty)
        insp = inspect(engine)
        assert "sample_orders" in insp.get_table_names() and "is_demo" in {c["name"] for c in insp.get_columns("agents")}
        command.upgrade(_cfg(), "head")
        assert "sample_orders" not in inspect(engine).get_table_names()
    finally:
        _reset(engine)


def test_fresh_install_has_no_demo_schema_or_data():
    """A brand-new database (migrations only) must not contain any demo table/column or sample data."""
    engine = get_engine()
    _reset(engine)
    try:
        command.upgrade(_cfg(), "head")
        insp = inspect(engine)
        assert "sample_orders" not in insp.get_table_names()
        assert "is_demo" not in {c["name"] for c in insp.get_columns("agents")}
        with engine.connect() as c:
            assert c.execute(text("SELECT COUNT(*) FROM agents")).scalar() == 0
            assert c.execute(text("SELECT COUNT(*) FROM users")).scalar() == 0
    finally:
        _reset(engine)