"""SQLite accounts, opaque revocable sessions and revision-checked user snapshots."""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import hmac
import json
from pathlib import Path
import secrets
import sqlite3
import time
from uuid import uuid4


class AccountError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.status = code, status


def iso(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


def password_hash(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=32)
    return salt.hex() + ":" + digest.hex()


def password_matches(password, stored):
    try:
        salt, _ = stored.split(":")
        return hmac.compare_digest(password_hash(password, bytes.fromhex(salt)), stored)
    except (ValueError, TypeError):
        return False


DUMMY_PASSWORD_HASH = password_hash("not-a-real-user-password", b"dummy-user-salt!")


class AccountRepository:
    def __init__(self, path: Path, session_days=30, now=time.time):
        self.path, self.ttl, self.now = Path(path), session_days * 86400, now
        self.initialize()

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys=ON")
            with db: yield db
        finally:
            db.close()

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version not in {0, 1}: raise RuntimeError("Unsupported account database version")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS snapshots(user_id TEXT PRIMARY KEY REFERENCES users(id),revision INTEGER NOT NULL,data TEXT NOT NULL,updated_at INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS attempts(key TEXT PRIMARY KEY,count INTEGER NOT NULL,until_at INTEGER NOT NULL);
                PRAGMA user_version=1;
            """)

    def reserve_attempt(self, key, limit, window=600):
        key = hashlib.sha256(key.encode()).hexdigest()
        now = int(self.now())
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM attempts WHERE key=?", (key,)).fetchone()
            count = row["count"] if row and row["until_at"] > now else 0
            if count >= limit: raise AccountError("auth_rate_limit", "Слишком много попыток. Подождите несколько минут.", 429)
            until = row["until_at"] if count else now + window
            db.execute("INSERT OR REPLACE INTO attempts VALUES (?,?,?)", (key, count + 1, until))

    @staticmethod
    def user(row):
        return {"id": row["id"], "username": row["username"], "created_at": iso(row["created_at"])}

    def register(self, username, password, peer="local"):
        self.reserve_attempt("register:" + peer, 20, 3600)
        uid, now = str(uuid4()), int(self.now())
        encoded = password_hash(password)
        try:
            with self.connection() as db:
                db.execute("INSERT INTO users VALUES (?,?,?,?)", (uid, username.lower(), encoded, now))
        except sqlite3.IntegrityError:
            raise AccountError("username_taken", "Этот логин уже занят.", 409) from None
        return {"id": uid, "username": username.lower(), "created_at": iso(now)}

    def login(self, username, password, peer="local"):
        self.reserve_attempt("login:" + peer + ":" + username.lower(), 8)
        with self.connection() as db:
            row = db.execute("SELECT * FROM users WHERE username=?", (username.lower(),)).fetchone()
        stored = row["password_hash"] if row else DUMMY_PASSWORD_HASH
        valid = password_matches(password, stored)
        if row is None or not valid: raise AccountError("invalid_credentials", "Неверный логин или пароль.", 401)
        with self.connection() as db:
            key = hashlib.sha256(("login:" + peer + ":" + username.lower()).encode()).hexdigest()
            db.execute("DELETE FROM attempts WHERE key=?", (key,))
        return self.user(row)

    def create_session(self, user_id):
        token, expires = secrets.token_urlsafe(32), int(self.now()) + self.ttl
        with self.connection() as db:
            db.execute("DELETE FROM sessions WHERE expires_at<=?", (int(self.now()),))
            db.execute("INSERT INTO sessions VALUES (?,?,?)", (hashlib.sha256(token.encode()).hexdigest(), user_id, expires))
        return token, iso(expires)

    def authenticate(self, token):
        if not token or not 32 <= len(token) <= 128:
            raise AccountError("auth_required", "Войдите в аккаунт.", 401)
        with self.connection() as db:
            row = db.execute("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
                             (hashlib.sha256(token.encode()).hexdigest(), int(self.now()))).fetchone()
        if not row: raise AccountError("session_expired", "Сеанс завершён. Войдите снова; сохранённые данные останутся.", 401)
        return self.user(row)

    def logout(self, token):
        if token:
            with self.connection() as db:
                db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))

    def read_state(self, user_id):
        with self.connection() as db:
            row = db.execute("SELECT * FROM snapshots WHERE user_id=?", (user_id,)).fetchone()
        return {"revision": row["revision"], "state": json.loads(row["data"]), "updated_at": iso(row["updated_at"])} if row else {"revision": 0, "state": None, "updated_at": None}

    def write_state(self, user_id, base_revision, state):
        encoded = json.dumps(state, ensure_ascii=False, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > 2_000_000:
            raise AccountError("state_too_large", "История превышает лимит MVP 2 МБ. Данные на устройстве сохранены.", 413)
        now = int(self.now())
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT revision FROM snapshots WHERE user_id=?", (user_id,)).fetchone()
            current = row["revision"] if row else 0
            if current != base_revision:
                raise AccountError("sync_conflict", "История изменилась на другом устройстве. Сохраните обе версии через настройки.", 409)
            db.execute("INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?)", (user_id, current + 1, encoded, now))
        return {"revision": current + 1, "updated_at": iso(now)}
