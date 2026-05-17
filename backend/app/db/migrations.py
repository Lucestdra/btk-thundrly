"""Migration runner — invoked from the FastAPI lifespan.

Behavior across the three DB states we care about:

  1. Fresh DB (no tables)            → `alembic upgrade head` creates everything.
  2. Pre-Alembic DB (tables but no   → `alembic stamp head` records the current
     `alembic_version`)                schema as already-migrated, no DDL runs.
  3. Migrated DB (alembic_version    → `alembic upgrade head` applies any
     present)                          pending revisions.

This makes the create_all → Alembic switchover invisible to anyone who
already has a DB on disk; their next server start just records the
existing schema as the baseline.
"""

from __future__ import annotations

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from app.db.database import DATABASE_URL, engine

logger = logging.getLogger(__name__)

# Project root holds `alembic.ini` + `alembic/`. This file lives at
# backend/app/db/migrations.py — three parents up gets us to backend/.
_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_ALEMBIC_INI = _BACKEND_ROOT / "alembic.ini"


def _build_config() -> Config:
    cfg = Config(str(_ALEMBIC_INI))
    cfg.set_main_option("script_location", str(_BACKEND_ROOT / "alembic"))
    cfg.set_main_option("sqlalchemy.url", DATABASE_URL)
    return cfg


def run_migrations() -> str:
    """Bring the database to head, choosing the right entry point.

    Returns a short label describing what happened, for log clarity.
    """
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    cfg = _build_config()

    if "alembic_version" in tables:
        command.upgrade(cfg, "head")
        return "upgraded"

    if "price_observations" in tables:
        # Pre-Alembic DB — adopt the current schema as the baseline
        # without rerunning the create_table statements.
        command.stamp(cfg, "head")
        logger.info("Stamped existing DB at head (legacy create_all bootstrap detected).")
        return "stamped"

    command.upgrade(cfg, "head")
    return "initialized"
