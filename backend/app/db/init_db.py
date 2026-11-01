"""CLI: apply database migrations.

    python -m app.db.init_db                  # alembic upgrade head
    python -m app.db.init_db --migrate-only   # same (accepted for deploy pipelines)
"""
from pathlib import Path

from alembic import command
from alembic.config import Config


def migrate() -> None:
    root = Path(__file__).resolve().parents[2]
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "migrations"))
    command.upgrade(cfg, "head")


if __name__ == "__main__":
    migrate()
    print("Migrations applied.")