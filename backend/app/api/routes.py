from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app import __version__
from app.api.dependencies import get_chat_service
from app.api.schemas import (
    AssistantMessageOut, ChatRequest, ChatResponse, ErrorResponse, HealthResponse,
)
from app.application.chat_service import ChatService
from app.core.config import get_settings
from app.domain.chat import ChatCommand, ContextMessage

router = APIRouter()


@router.get("/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(service=settings.app_name, version=__version__, reply_mode=settings.reply_mode)


@router.post(
    "/api/v1/chat",
    response_model=ChatResponse,
    responses={422: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    tags=["chat"],
    summary="Получить демонстрационный ответ LegalIntel",
    description="Без AI, аккаунтов и серверной БД. Историю хранит клиент и передаёт ограниченный контекст.",
)
async def chat(
    payload: ChatRequest,
    request: Request,
    service: Annotated[ChatService, Depends(get_chat_service)],
) -> ChatResponse:
    result = await service.reply(ChatCommand(
        conversation_id=payload.conversation_id,
        client_message_id=payload.client_message_id,
        message=payload.message,
        history=tuple(ContextMessage(role=m.role, content=m.content) for m in payload.history),
    ))
    return ChatResponse(
        conversation_id=payload.conversation_id,
        client_message_id=payload.client_message_id,
        message=AssistantMessageOut(id=result.id, content=result.content, created_at=result.created_at),
        mode=result.mode,
        request_id=request.state.request_id,
    )
