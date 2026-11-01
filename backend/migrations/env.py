from alembic import context

import app.models  # noqa: F401  (register models)
from app.db.base import Base
from app.db.session import get_engine

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(url=str(get_engine().url), target_metadata=target_metadata, literal_binds=True,
                      render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    with get_engine().connect() as connection:
        sqlite = connection.dialect.name == "sqlite"
        if sqlite:
            # SQLite changes columns by re-creating the table (DROP + RENAME). With foreign keys ON, dropping a
            # parent table fires ON DELETE CASCADE / SET NULL on its children and silently destroys their rows.
            # Foreign keys must be OFF for the duration of a migration (this PRAGMA is a no-op inside a transaction).
            connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
            connection.commit()
        try:
            context.configure(connection=connection, target_metadata=target_metadata,
                              render_as_batch=sqlite, compare_type=True)
            with context.begin_transaction():
                context.run_migrations()
        finally:
            if sqlite:
                connection.exec_driver_sql("PRAGMA foreign_keys=ON")


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()