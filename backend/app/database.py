from collections.abc import Generator
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session
from .core.config import get_settings

settings = get_settings()
_url = settings.sqlalchemy_database_url
if _url.startswith("sqlite"):
    engine = create_engine(_url, connect_args={"check_same_thread": False}, future=True, pool_pre_ping=True)
else:
    # Serverless-friendly: a small pool per function instance, recycled before
    # idle connections are dropped by the database's pooler.
    engine = create_engine(_url, future=True, pool_pre_ping=True, pool_size=2, max_overflow=3, pool_recycle=300)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
