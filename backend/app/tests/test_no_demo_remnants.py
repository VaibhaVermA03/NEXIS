"""Guard: demo / mock / sample-order functionality must never creep back into the shipped backend."""
import re
from pathlib import Path

import app.models  # noqa: F401
from app.core.config import Settings
from app.db.base import Base

ROOT = Path(__file__).resolve().parents[1]   # backend/app
FORBIDDEN = re.compile(r"demo|mock|sample_?order|seed_|is_demo|order_lookup|shipping_status|send_email|ORD-\d{4}", re.I)


def test_backend_source_has_no_demo_references():
    hits = []
    for f in sorted(ROOT.rglob("*.py")):
        if "tests" in f.parts:        # tests may mention what they assert is gone
            continue
        for n, line in enumerate(f.read_text().splitlines(), 1):
            if FORBIDDEN.search(line):
                hits.append(f"{f.relative_to(ROOT)}:{n}: {line.strip()[:90]}")
    assert hits == []


def test_demo_modules_are_deleted():
    for rel in ("services/demo_service.py", "tools/database_tools.py", "tools/mock_tools.py"):
        assert not (ROOT / rel).exists(), rel


def test_no_demo_setting_table_or_column():
    assert not hasattr(Settings(), "seed_demo_data")
    assert "sample_orders" not in Base.metadata.tables
    assert "is_demo" not in Base.metadata.tables["agents"].c


def test_only_the_openai_client_exists():
    from app.agents import llm
    assert not hasattr(llm, "MockClient") and llm.make_llm.__code__.co_argcount == 0