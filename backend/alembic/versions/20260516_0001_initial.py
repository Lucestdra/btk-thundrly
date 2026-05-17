"""initial — price_observations table

Revision ID: 0001
Revises:
Create Date: 2026-05-16

Mirrors the schema that `Base.metadata.create_all` produced before
Alembic ownership. Existing databases bootstrapped via create_all are
stamped at this revision by the lifespan, so this migration's
`upgrade()` is only ever run against a truly empty database.
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "price_observations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("url", sa.String(length=512), nullable=False),
        sa.Column("raw_url", sa.String(length=1024), nullable=False),
        sa.Column("price", sa.Float(), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("platform", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=True),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        op.f("ix_price_observations_url"),
        "price_observations",
        ["url"],
    )
    op.create_index(
        op.f("ix_price_observations_observed_at"),
        "price_observations",
        ["observed_at"],
    )
    # Composite index — hot path for the price_agent's
    # "history for url over last N days" query.
    op.create_index(
        "ix_obs_url_observed_at",
        "price_observations",
        ["url", "observed_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_obs_url_observed_at", table_name="price_observations")
    op.drop_index(
        op.f("ix_price_observations_observed_at"),
        table_name="price_observations",
    )
    op.drop_index(
        op.f("ix_price_observations_url"),
        table_name="price_observations",
    )
    op.drop_table("price_observations")
