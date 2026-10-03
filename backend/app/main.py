from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .api.v1.router import router as v1_router
from .core.config import get_settings
from .database import Base, engine
from . import models  # noqa: F401 - registers SQLAlchemy mappings


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Local development stays frictionless. Deployments run the versioned Alembic
    # migration before the API starts, so multiple workers never race on DDL.
    if settings.environment == "development":
        Base.metadata.create_all(bind=engine)
    yield


settings = get_settings()
app = FastAPI(title="FitTrack API", version="0.1.0", lifespan=lifespan)
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


@app.get("/health")
def health():
    return {"status": "ok"}
