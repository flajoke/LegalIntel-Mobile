from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, model_validator

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="LEGALINTEL_", env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "LegalIntel API"
    reply_mode: Literal["stub"] = "stub"
    cors_origins: list[str] = ["http://localhost:8081", "http://127.0.0.1:8081"]
    knowledge_db: Path = Path("data/knowledge.sqlite3")
    knowledge_corpus: Path = Path(__file__).resolve().parents[2] / "knowledge"
    accounts_db: Path = Path("data/accounts.sqlite3")
    auth_session_days: int = Field(default=30, ge=1, le=90)
    auth_cookie_secure: bool = False
    ai_provider: Literal["disabled", "groq", "ollama", "compatible"] = "disabled"
    ai_api_key: SecretStr = SecretStr("")
    ai_model: str = ""
    ai_base_url: str = ""
    ai_timeout_seconds: float = Field(default=60, ge=5, le=120)
    ai_max_output_tokens: int = Field(default=1536, ge=256, le=4096)
    ai_max_calls_per_day: int = Field(default=100, ge=1, le=100000)
    ai_usage_db: Path = Path("data/ai_usage.sqlite3")
    ai_context_chars: int = Field(default=6000, ge=3000, le=18000)
    ai_ollama_context: int = Field(default=8192, ge=4096, le=32768)

    @model_validator(mode="after")
    def check_ai_url(self):
        if self.ai_base_url:
            url = urlsplit(self.ai_base_url)
            if url.scheme not in {"http", "https"} or not url.hostname or url.username or url.password or url.query or url.fragment:
                raise ValueError("AI base URL must be an http(s) endpoint without credentials, query or fragment")
            if self.ai_provider in {"groq", "compatible"} and url.scheme != "https" and url.hostname not in {"localhost", "127.0.0.1", "::1"}:
                raise ValueError("Cloud AI requires HTTPS")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
