"""Price history repository.

Thin layer over the SQLAlchemy session — keeps DB calls out of the agent
code and lets tests stub it. Two public functions:

    insert_observation(...)   append-only write
    get_recent(...)           list of (date, price) for the price_agent

Reads collapse rows to one observation per (url, date) by taking the
**median** price for that day. Median resists a flood of poisoned writes
better than mean, which matters because the observation endpoint accepts
unauthenticated traffic from extension installs.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from statistics import median
from typing import Iterable, List, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import PriceObservation
from app.models.schemas import PriceHistoryPoint
from app.services.url_normalizer import CanonicalUrl, normalize


def insert_observation(
    db: Session,
    *,
    raw_url: str,
    price: float,
    currency: str = "TRY",
    title: str | None = None,
    observed_at: datetime | None = None,
) -> PriceObservation:
    """Append a single observation. Commits the session."""
    canon = normalize(raw_url)
    row = PriceObservation(
        url=canon.canonical,
        raw_url=raw_url[:1024],
        price=price,
        currency=currency,
        platform=canon.platform,
        title=(title[:512] if title else None),
        observed_at=observed_at or datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_recent(
    db: Session,
    raw_url: str,
    *,
    days: int = 90,
    now: datetime | None = None,
) -> List[PriceHistoryPoint]:
    """Return one (date, price) point per day for the last `days` days.

    Per-day price is the median of that day's observations; this absorbs
    intra-day fluctuations and resists poisoning.
    """
    canon = normalize(raw_url)
    return _history_for_canonical(db, canon, days=days, now=now)


def _history_for_canonical(
    db: Session,
    canon: CanonicalUrl,
    *,
    days: int,
    now: datetime | None,
) -> List[PriceHistoryPoint]:
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)

    stmt = (
        select(PriceObservation.observed_at, PriceObservation.price)
        .where(PriceObservation.url == canon.canonical)
        .where(PriceObservation.observed_at >= cutoff)
        .order_by(PriceObservation.observed_at.asc())
    )

    return _collapse_to_daily(db.execute(stmt).all())


def _collapse_to_daily(
    rows: Iterable[Tuple[datetime, float]],
) -> List[PriceHistoryPoint]:
    by_day: dict[date, list[float]] = {}
    for observed_at, price in rows:
        d = _as_date(observed_at)
        by_day.setdefault(d, []).append(float(price))

    return [
        PriceHistoryPoint(date=d.isoformat(), price=float(median(prices)))
        for d, prices in sorted(by_day.items())
    ]


def _as_date(value: datetime) -> date:
    # SQLite roundtrips naive datetimes; treat naive as UTC for daily bucketing.
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).date()
