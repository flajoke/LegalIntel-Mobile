"""Persistent request budget, with no prompt, response or user identifiers."""
from datetime import datetime, timezone
from pathlib import Path
import sqlite3

from app.domain.ai import AIError


class UsageBudget:
    def __init__(self, path: Path, limit: int):
        self.path, self.limit = path, limit

    def _connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=10)
        connection.execute("CREATE TABLE IF NOT EXISTS daily_calls (day TEXT PRIMARY KEY, calls INTEGER NOT NULL)")
        return connection

    def reserve(self):
        day = datetime.now(timezone.utc).date().isoformat()
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT calls FROM daily_calls WHERE day=?", (day,)).fetchone()
            if row and row[0] >= self.limit:
                raise AIError("ai_daily_limit", "Достигнут дневной лимит запросов к AI, установленный для этого приложения. Попробуйте завтра.", 429)
            connection.execute("INSERT INTO daily_calls VALUES (?,1) ON CONFLICT(day) DO UPDATE SET calls=calls+1", (day,))
            connection.commit()
        finally:
            connection.close()

    def status(self) -> dict:
        day = datetime.now(timezone.utc).date().isoformat()
        connection = self._connect()
        try:
            row = connection.execute("SELECT calls FROM daily_calls WHERE day=?", (day,)).fetchone()
            return {"day_utc": day, "calls": row[0] if row else 0, "limit": self.limit}
        finally:
            connection.close()
