"""User budget repository.

Two public functions:

    get_or_default(db, user_id, category)  → UserBudget snapshot
    upsert(db, user_id, category, budget)  → persisted row

`get_or_default` never raises and never returns `None`: if no row exists
for the (user_id, category) pair, a permissive default is returned so the
budget_agent always has something to score against. This is deliberate —
"no budget data" should produce a neutral verdict, not a crash.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import UserBudgetRow
from app.models.schemas import UserBudget

# Permissive defaults used when no budget row exists for (user_id, category).
# Limits are deliberately high enough that the budget_agent will say
# "rahat aralıkta", so unknown users / new categories never produce a
# false-positive overrun warning.
DEFAULT_BUDGET = UserBudget(
    monthlyLimit=10_000.0,
    categoryLimit=5_000.0,
    categorySpent=0.0,
    monthlySpent=0.0,
    currency="TRY",
)


def get_or_default(db: Session, user_id: str, category: str) -> UserBudget:
    if not user_id or not category:
        return DEFAULT_BUDGET

    row = db.execute(
        select(UserBudgetRow).where(
            UserBudgetRow.user_id == user_id,
            UserBudgetRow.category == category,
        )
    ).scalar_one_or_none()

    if row is None:
        return DEFAULT_BUDGET

    return UserBudget(
        monthlyLimit=row.monthly_limit,
        monthlySpent=row.monthly_spent,
        categoryLimit=row.category_limit,
        categorySpent=row.category_spent,
        currency=row.currency,  # type: ignore[arg-type]
    )


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
