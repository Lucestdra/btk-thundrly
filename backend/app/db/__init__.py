"""Database layer — engine, session factory, ORM models.

V1 ships sync SQLAlchemy 2.x with SQLite by default and Postgres via
`DATABASE_URL`. Schema bootstrap uses `Base.metadata.create_all`; once we
ship a real first migration, swap in Alembic without touching call sites.
"""

from app.db.database import Base, SessionLocal, engine, get_db
from app.db.models import PriceObservation

__all__ = ["Base", "PriceObservation", "SessionLocal", "engine", "get_db"]
