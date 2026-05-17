"""User budget repository.

Three public functions:

    get(db, user_id, category)             → Optional[UserBudget]
    get_or_default(db, user_id, category)  → UserBudget snapshot (legacy)
    upsert(db, user_id, category, budget)  → persisted row

`get` returns ``None`` when no row exists — orchestrator uses this so the
budget_agent honestly reports "Bütçe Verisi Yok" instead of scoring
against a fabricated default, which would bias every analysis for users
who haven't set a budget.

`get_or_default` is retained for the GET /api/user-budget endpoint where
returning a sane default is preferable to a 404, but it is no longer
used inside the analysis path.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import UserBudgetRow
from app.models.schemas import UserBudget

# Permissive defaults — only used by the GET endpoint to give the frontend
# a sane starting state when no row exists yet. Never injected into the
# analysis path; see `get()` for that.
DEFAULT_BUDGET = UserBudget(
    monthlyLimit=10_000.0,
    categoryLimit=5_000.0,
    categorySpent=0.0,
    monthlySpent=0.0,
    currency="TRY",
)


def _row_to_budget(row: UserBudgetRow) -> UserBudget:
    return UserBudget(
        monthlyLimit=row.monthly_limit,
        monthlySpent=row.monthly_spent,
        categoryLimit=row.category_limit,
        categorySpent=row.category_spent,
        currency=row.currency,  # type: ignore[arg-type]
    )


def get(db: Session, user_id: str, category: str) -> Optional[UserBudget]:
    """Return the stored budget for (user_id, category) or ``None``.

    Used by the orchestrator so the budget_agent can honestly report
    "Bütçe Verisi Yok" when the user hasn't configured limits yet.
    """
    if not user_id or not category:
        return None

    row = db.execute(
        select(UserBudgetRow).where(
            UserBudgetRow.user_id == user_id,
            UserBudgetRow.category == category,
        )
    ).scalar_one_or_none()

    return _row_to_budget(row) if row is not None else None


def get_or_default(db: Session, user_id: str, category: str) -> UserBudget:
    budget = get(db, user_id, category)
    return budget if budget is not None else DEFAULT_BUDGET


def upsert(
    db: Session,
    *,
    user_id: str,
    category: str,
    budget: UserBudget,
) -> UserBudgetRow:
    """Insert-or-update by (user_id, category). Commits the session."""
    row = db.execute(
        select(UserBudgetRow).where(
            UserBudgetRow.user_id == user_id,
            UserBudgetRow.category == category,
        )
    ).scalar_one_or_none()

    if row is None:
        row = UserBudgetRow(
            user_id=user_id,
            category=category,
            monthly_limit=budget.monthlyLimit,
            monthly_spent=budget.monthlySpent or 0.0,
            category_limit=budget.categoryLimit,
            category_spent=budget.categorySpent,
            currency=budget.currency,
        )
        db.add(row)
    else:
        row.monthly_limit = budget.monthlyLimit
        row.monthly_spent = budget.monthlySpent or 0.0
        row.category_limit = budget.categoryLimit
        row.category_spent = budget.categorySpent
        row.currency = budget.currency
        row.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(row)
    return row
