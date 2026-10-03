from functools import lru_cache
from typing import Literal
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="FITTRACK_", extra="ignore")

    database_url: str = "sqlite:///./fittrack.db"
    secret_key: str = "development-only-change-me"
    cors_origins: str = "http://localhost:3000"
    environment: Literal["development", "production", "test"] = "development"
    cookie_secure: bool = False
    cookie_domain: str | None = None
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    access_token_minutes: int = 60 * 24

    @property
    def origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def sqlalchemy_database_url(self) -> str:
        # Most hosted providers expose the standard PostgreSQL scheme; SQLAlchemy
        # needs the installed psycopg 3 dialect specified explicitly.
        if self.database_url.startswith("postgresql://"):
            return self.database_url.replace("postgresql://", "postgresql+psycopg://", 1)
        return self.database_url

    @property
    def session_cookie_domain(self) -> str | None:
        return self.cookie_domain.strip() if self.cookie_domain and self.cookie_domain.strip() else None


@lru_cache
def get_settings() -> Settings:
    return Settings()
