"""Engine + session factory + FastAPI dependency.

Reads `DATABASE_URL` from the environment. Defaults to a file-based SQLite
at `app/data/observations.db` so local dev needs zero setup. Postgres example:

    DATABASE_URL=postgresql+psycopg2://user:pass@host:5432/thundrly
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

_DEFAULT_SQLITE_PATH = Path(__file__).resolve().parent.parent / "data" / "observations.db"


def _resolve_database_url() -> str:
    raw = os.environ.get("DATABASE_URL", "").strip()
    if raw:
        return raw
    _DEFAULT_SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{_DEFAULT_SQLITE_PATH.as_posix()}"


DATABASE_URL = _resolve_database_url()
_IS_SQLITE = DATABASE_URL.startswith("sqlite")

# `check_same_thread=False` is sqlite-only; FastAPI shares sessions across
# threads via the dependency. Postgres has no such restriction.
engine = create_engine(
    DATABASE_URL,
    echo=False,
    future=True,
    connect_args={"check_same_thread": False} if _IS_SQLITE else {},
    pool_pre_ping=not _IS_SQLITE,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    """Root ORM class — all models inherit from this."""


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding a managed session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
