"""Shared pytest fixtures.

Critical bit: we set `DATABASE_URL` to a fresh tempfile **before** any
`app.*` module is imported. The engine is built at module-load time of
`app.db.database`, so once that's done we can't redirect it; we have to
get there first. pytest loads `conftest.py` before any test module, so
module-top side effects here are safe.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

# --- DATABASE_URL override (must precede app imports) ---
_TMPDIR = Path(tempfile.mkdtemp(prefix="thundrly-test-"))
_TEST_DB = _TMPDIR / "test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB.as_posix()}"
os.environ["EXTERNAL_PRICE_COMPARISON_ENABLED"] = "0"

# Rate-limit storage stays in-memory; no env override needed.

import pytest  # noqa: E402  (env var must be set first)
from fastapi.testclient import TestClient  # noqa: E402

from app.core.cache import gemini_cache  # noqa: E402
from app.db.database import SessionLocal, engine  # noqa: E402
from app.db.models import Base, PriceObservation, UserBudgetRow  # noqa: E402
from app.main import app  # noqa: E402

# Ensure schema exists for tests that don't go through the lifespan
# (TestClient triggers it lazily, but unit tests touching SessionLocal
# directly need the tables up front).
Base.metadata.create_all(bind=engine)


@pytest.fixture(autouse=True)
def _clear_gemini_cache():
    """Each test starts with an empty Gemini response cache.

    Without this, a `_run_with_gemini` call in one test can serve a
    cached value to a later test, making cache-vs-LLM-call assertions
    flaky depending on test order.
    """
    gemini_cache.clear()
    yield
    gemini_cache.clear()


def _wipe_data_tables(session) -> None:
    session.query(PriceObservation).delete()
    session.query(UserBudgetRow).delete()
    session.commit()


@pytest.fixture()
def db():
    """Yield a fresh session bound to the test engine.

    Wipes data tables BEFORE and after the test. Pre-wipe matters because
    the FastAPI lifespan (which TestClient fires on every context entry)
    re-seeds canonical fixture rows whenever it finds the table empty;
    without a pre-wipe a previous test's cleanup wouldn't be enough to
    guarantee an empty slate when a new TestClient is constructed.
    """
    session = SessionLocal()
    _wipe_data_tables(session)
    try:
        yield session
    finally:
        session.rollback()
        _wipe_data_tables(session)
        session.close()


@pytest.fixture()
def client(db):
    """`TestClient` with the same DB the `db` fixture cleans up.

    Important: `TestClient(app)` fires the lifespan on context entry,
    which re-seeds canonical rows whenever the table is empty. We wipe
    once more immediately AFTER lifespan to give each test a true blank
    slate; tests that want fixture data populate it explicitly.
    """
    with TestClient(app) as c:
        _wipe_data_tables(db)
        yield c


def pytest_sessionfinish(session, exitstatus):  # noqa: ARG001
    shutil.rmtree(_TMPDIR, ignore_errors=True)
