import logging
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from app import __version__
from app.api.routes import router
from app.core.config import get_settings

settings = get_settings()
app = FastAPI(
    title=settings.app_name,
    version=__version__,
    description="Технический прототип LegalIntel. Ответы — заглушки, юридический анализ не выполняется.",
)
logger = logging.getLogger("legalintel")


def error_response(request: Request, status: int, code: str, message: str, details=None):
    return JSONResponse(status_code=status, content={
        "error": {"code": code, "message": message, "details": details or []},
        "request_id": getattr(request.state, "request_id", ""),
    })


@app.middleware("http")
async def request_context(request: Request, call_next):
    request.state.request_id = str(uuid4())
    try:
        response = await call_next(request)
    except Exception as exc:
        # Do not log message bodies, raw validation inputs or personal data.
        logger.error("request_id=%s error_type=%s", request.state.request_id, type(exc).__name__)
        response = error_response(request, 500, "internal_error", "Не удалось обработать запрос")
    response.headers["X-Request-ID"] = request.state.request_id
    response.headers["Cache-Control"] = "no-store"
    return response


# Outermost middleware: browser clients receive CORS headers on errors too.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
    expose_headers=["X-Request-ID"],
)


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, exc: RequestValidationError):
    details = [
        {"field": ".".join(str(part) for part in error["loc"]), "message": error["msg"]}
        for error in exc.errors()
    ]
    return error_response(request, 422, "validation_error", "Проверьте данные запроса", details)


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    return error_response(request, exc.status_code, "http_error", str(exc.detail))


app.include_router(router)
