"""Idempotent bootstrap of canonical demo data.

Runs once on startup for each independent table:

  - price_observations  → 3 fixture URLs × their priceHistory points
  - user_budgets        → demo-user × (Giyim, Elektronik, Kitap) budgets

Each block runs only when its own table is empty, so re-seeding never
overwrites real production data.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.data.mock_data import EXAMPLES
from app.db.models import PriceObservation, UserBudgetRow
from app.services.url_normalizer import normalize


def seed_if_empty(db: Session) -> int:
    """Run all idempotent seeders. Returns the total rows inserted."""
    inserted = 0
    inserted += _seed_price_observations(db)
    inserted += _seed_user_budgets(db)
    return inserted


def _seed_price_observations(db: Session) -> int:
    existing = db.execute(select(func.count(PriceObservation.id))).scalar_one()
    if existing:
        return 0

    inserted = 0
    for fixture in EXAMPLES.values():
        product = fixture["product"]
        url = product["url"]
        currency = product.get("currency", "TRY")
        title = product.get("title")
        canon = normalize(url)

        for point in fixture.get("priceHistory", []):
            observed_at = _parse_iso_date(point["date"])
            db.add(
                PriceObservation(
                    url=canon.canonical,
                    raw_url=url,
                    price=float(point["price"]),
                    currency=currency,
                    platform=canon.platform,
                    title=title,
                    observed_at=observed_at,
                )
            )
            inserted += 1

    db.commit()
    return inserted


def _seed_user_budgets(db: Session) -> int:
    existing = db.execute(select(func.count(UserBudgetRow.user_id))).scalar_one()
    if existing:
        return 0

    inserted = 0
    for fixture in EXAMPLES.values():
        user_id = fixture["userId"]
        category = fixture["product"]["category"]
        budget = fixture["userBudget"]
        db.add(
            UserBudgetRow(
                user_id=user_id,
                category=category,
                monthly_limit=float(budget["monthlyLimit"]),
                monthly_spent=float(budget.get("monthlySpent") or 0.0),
                category_limit=float(budget["categoryLimit"]),
                category_spent=float(budget["categorySpent"]),
                currency=budget.get("currency", "TRY"),
            )
        )
        inserted += 1

    db.commit()
    return inserted


def _parse_iso_date(s: str) -> datetime:
    """Treat the fixture's YYYY-MM-DD as midnight UTC."""
    return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc)
