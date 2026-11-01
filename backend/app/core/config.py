from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="LEGALINTEL_", env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "LegalIntel API"
    reply_mode: Literal["stub"] = "stub"
    cors_origins: list[str] = ["http://localhost:8081", "http://127.0.0.1:8081"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
