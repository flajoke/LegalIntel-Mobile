from functools import lru_cache

from fastapi import Request

from app.core.config import get_settings
from app.infrastructure.accounts import AccountError, AccountRepository

COOKIE = "legalintel_session"


@lru_cache
def get_accounts():
    settings = get_settings()
    return AccountRepository(settings.accounts_db, settings.auth_session_days)


def check_origin(request: Request):
    origin = request.headers.get("origin")
    if not origin: return
    allowed = get_settings().cors_origins
    own_loopback = request.url.hostname in {"localhost", "127.0.0.1", "::1"} and origin == str(request.base_url).rstrip("/")
    if origin not in allowed and not own_loopback:
        raise AccountError("origin_denied", "Источник запроса не разрешён.", 403)


def request_token(request: Request):
    header = request.headers.get("authorization")
    if header is not None:
        return header[7:] if header.startswith("Bearer ") else None
    return request.cookies.get(COOKIE)


def current_user(request: Request):
    check_origin(request)
    user = get_accounts().authenticate(request_token(request))
    expected = request.headers.get("x-account-id")
    if expected is not None and expected != user["id"]:
        raise AccountError("account_changed", "Аккаунт изменился в другой вкладке. Войдите снова.", 401)
    return user
