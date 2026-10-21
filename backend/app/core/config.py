from functools import lru_cache
from typing import Literal
from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="FITTRACK_", extra="ignore")

    # FITTRACK_DATABASE_URL wins; DATABASE_URL is what the Neon/Vercel integration injects.
    database_url: str = Field(default="sqlite:///./fittrack.db", validation_alias=AliasChoices("FITTRACK_DATABASE_URL", "DATABASE_URL"))
    secret_key: str = "development-only-change-me"
    cors_origins: str = "http://localhost:3000"
    environment: Literal["development", "production", "test"] = "development"
    cookie_secure: bool = False
    cookie_domain: str | None = None
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    access_token_minutes: int = 60 * 24
    # Create missing tables when the API starts. Safe to leave on (it only creates
    # tables that don't exist); turn off once the schema is in place to speed cold starts.
    auto_create_tables: bool = True
    # Who can create accounts: "open" (anyone), "code" (needs FITTRACK_SIGNUP_CODE), "closed" (no new accounts).
    signup_mode: Literal["open", "code", "closed"] = "open"
    signup_code: str | None = None
    # AI diet planner. Without a key the built-in regional planner is used instead.
    anthropic_api_key: str | None = Field(default=None, validation_alias=AliasChoices("FITTRACK_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"))
    ai_model: str = "claude-haiku-5-5"

    @model_validator(mode="after")
    def _production_guards(self) -> "Settings":
        if self.environment == "production":
            if len(self.secret_key) < 32 or self.secret_key.startswith("development-only"):
                raise ValueError("FITTRACK_SECRET_KEY must be a random value of at least 32 characters in production")
            if self.database_url.startswith("sqlite"):
                raise ValueError("Production needs PostgreSQL: set DATABASE_URL or FITTRACK_DATABASE_URL")
        return self

    @property
    def origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def sqlalchemy_database_url(self) -> str:
        # Most hosted providers expose the standard PostgreSQL scheme; SQLAlchemy
        # needs the installed psycopg 3 dialect specified explicitly.
        for prefix in ("postgresql://", "postgres://"):
            if self.database_url.startswith(prefix):
                return self.database_url.replace(prefix, "postgresql+psycopg://", 1)
        return self.database_url

    @property
    def session_cookie_domain(self) -> str | None:
        return self.cookie_domain.strip() if self.cookie_domain and self.cookie_domain.strip() else None


@lru_cache
def get_settings() -> Settings:
    return Settings()
