"""Create the initial FitTrack schema.

Revision ID: 20261003_01
Revises:
Create Date: 2026-10-03
"""
from alembic import op
from app import models  # noqa: F401 - registers every mapped table
from app.database import Base

revision = "20261003_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The application schema is defined once in SQLAlchemy models. This initial
    # migration creates that complete, normalized baseline on SQLite or Postgres.
    Base.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind())
