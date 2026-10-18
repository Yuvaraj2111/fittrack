import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .api.v1.router import router as v1_router
from .core.config import get_settings
from .database import Base, engine
from . import models  # noqa: F401 - registers SQLAlchemy mappings

settings = get_settings()
log = logging.getLogger("fittrack")


def ensure_schema() -> None:
    """Create any missing tables (never alters or drops existing ones).

    Runs at import time so it also works on serverless platforms such as Vercel,
    which may not deliver ASGI lifespan events, and again on lifespan startup.
    Disable with FITTRACK_AUTO_CREATE_TABLES=false once the schema exists.
    """
    if not settings.auto_create_tables:
        return
    try:
        Base.metadata.create_all(bind=engine, checkfirst=True)
    except Exception:  # e.g. two cold starts racing on DDL; the other one wins
        log.exception("Schema check failed; continuing because tables may already exist")


ensure_schema()


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_schema()
    yield


app = FastAPI(title="FitTrack API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization", "X-CSRF-Token"],
)


@app.exception_handler(HTTPException)
async def http_error_handler(_: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"error": {"message": str(exc.detail), "code": exc.status_code}})


app.include_router(v1_router, prefix="/api/v1")


@app.get("/")
def root():
    return {"service": "FitTrack API", "docs": "/docs", "health": "/health"}


@app.get("/health")
def health():
    return {"status": "ok"}
