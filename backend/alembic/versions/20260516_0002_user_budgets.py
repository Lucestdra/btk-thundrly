"""user_budgets — per (user_id, category) budget snapshot

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-16
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_budgets",
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("category", sa.String(length=64), nullable=False),
        sa.Column("monthly_limit", sa.Float(), nullable=False),
        sa.Column("monthly_spent", sa.Float(), nullable=False, server_default="0"),
        sa.Column("category_limit", sa.Float(), nullable=False),
        sa.Column("category_spent", sa.Float(), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(length=8), nullable=False, server_default="TRY"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("user_id", "category", name="pk_user_budgets"),
    )


def downgrade() -> None:
    op.drop_table("user_budgets")
