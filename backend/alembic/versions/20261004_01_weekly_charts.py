"""Add weekly diet and workout charts.

Revision ID: 20261004_01
Revises: 20261003_01
Create Date: 2026-10-04
"""
from alembic import op
from app import models
from app.database import Base

revision = "20261004_01"
down_revision = "20261003_01"
branch_labels = None
depends_on = None

TABLES = ["diet_charts", "diet_chart_items", "workout_charts", "workout_chart_items"]


def upgrade() -> None:
    # checkfirst keeps this safe for databases created by the baseline revision,
    # which builds every table currently defined in the models.
    Base.metadata.create_all(bind=op.get_bind(), tables=[Base.metadata.tables[name] for name in TABLES], checkfirst=True)


def downgrade() -> None:
    for name in reversed(TABLES):
        op.drop_table(name)
