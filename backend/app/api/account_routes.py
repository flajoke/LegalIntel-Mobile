from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from app.api.auth import COOKIE, check_origin, current_user, get_accounts, request_token
from app.api.account_schemas import Credentials, SessionOut, StateRead, StateWrite, StateWritten, UserOut
from app.core.config import get_settings

router = APIRouter(prefix="/api/v1", tags=["account"])


def session_response(user, payload, response):
    repo = get_accounts()
    token, expires = repo.create_session(user["id"])
    if payload.device == "web":
        response.set_cookie(COOKIE, token, max_age=repo.ttl, httponly=True, secure=get_settings().auth_cookie_secure, samesite="lax", path="/api/v1")
    return {"user": user, "token": token if payload.device == "native" else None, "expires_at": expires}


@router.post("/auth/register", response_model=SessionOut)
def register(payload: Credentials, request: Request, response: Response):
    check_origin(request)
    peer = request.client.host if request.client else "local"
    user = get_accounts().register(payload.username, payload.password.get_secret_value(), peer)
    get_accounts().logout(request_token(request))
    return session_response(user, payload, response)


@router.post("/auth/login", response_model=SessionOut)
def login(payload: Credentials, request: Request, response: Response):
    check_origin(request)
    peer = request.client.host if request.client else "local"
    user = get_accounts().login(payload.username, payload.password.get_secret_value(), peer)
    get_accounts().logout(request_token(request))
    return session_response(user, payload, response)


@router.get("/auth/me", response_model=UserOut)
def me(user: Annotated[dict, Depends(current_user)]): return user


@router.post("/auth/logout")
def logout(request: Request, response: Response):
    check_origin(request)
    if request.headers.get("x-account-id") is not None:
        current_user(request)
    get_accounts().logout(request_token(request))
    response.delete_cookie(COOKIE, path="/api/v1", httponly=True, secure=get_settings().auth_cookie_secure, samesite="lax")
    return {"ok": True}


@router.get("/account/state", response_model=StateRead, response_model_exclude_unset=True)
def read_state(user: Annotated[dict, Depends(current_user)]):
    return get_accounts().read_state(user["id"])


@router.post("/account/state", response_model=StateWritten)
def write_state(payload: StateWrite, user: Annotated[dict, Depends(current_user)]):
    return get_accounts().write_state(user["id"], payload.base_revision, payload.state.model_dump(mode="json", exclude_unset=True))
