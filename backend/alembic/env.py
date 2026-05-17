"""Alembic environment.

We deliberately override `sqlalchemy.url` from the application's runtime
config so a single `DATABASE_URL` env var configures both the app and
migrations. `target_metadata = Base.metadata` makes `alembic revision
--autogenerate` work for future schema changes.
"""

from __future__ import annotations

from sqlalchemy import engine_from_config, pool

from alembic import context

from app.db.database import DATABASE_URL
from app.db.models import Base

config = context.config
# Single source of truth: app reads DATABASE_URL, so do migrations.
config.set_main_option("sqlalchemy.url", DATABASE_URL)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        # Required for SQLite's limited ALTER support — Alembic batches
        # column edits into copy+swap. No-op for Postgres.
        render_as_batch=DATABASE_URL.startswith("sqlite"),
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=DATABASE_URL.startswith("sqlite"),
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
