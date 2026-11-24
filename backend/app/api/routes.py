from typing import Annotated
import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app import __version__
from app.api.dependencies import get_chat_service, get_knowledge, get_salary_service, get_ai_service, get_llm, get_analysis_service
from app.api.analysis_schemas import AnalysisRequest, AnalysisResponse
from app.application.analysis_service import AnalysisService
from app.api.schemas import (
    AssistantMessageOut, ChatRequest, ChatResponse, ErrorResponse, HealthResponse,
    SalaryRequest, SalaryResponse, KnowledgeIndex, KnowledgeSearch, LegalDocument,
    AIRequest, AIResponse, AIStatus,
)
from app.application.chat_service import ChatService
from app.application.salary_service import SalaryService
from app.application.ai_service import AIService
from app.domain.ai import AIError
from app.domain.cases.salary_delay import CaseInputError
from app.infrastructure.knowledge.repository import KnowledgeRepository
from app.core.config import get_settings
from app.domain.chat import ChatCommand, ContextMessage
from app.api.auth import current_user

router = APIRouter(dependencies=[Depends(current_user)])
system_router = APIRouter()


@system_router.get("/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(service=settings.app_name, version=__version__, reply_mode=settings.reply_mode)


@router.post(
    "/api/v1/chat",
    response_model=ChatResponse,
    responses={422: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    tags=["chat"],
    summary="Получить демонстрационный ответ LegalIntel",
    description="Общий чат без AI. Историю хранит клиент. Сценарий зарплаты доступен через /salary-delay/turn.",
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


@router.post("/api/v1/salary-delay/turn", response_model=SalaryResponse,
             responses={422: {"model": ErrorResponse}}, tags=["salary-delay"],
             summary="Следующий шаг сбора фактов о выплате")
def salary_turn(payload: SalaryRequest, request: Request,
                service: Annotated[SalaryService, Depends(get_salary_service)]):
    try:
        result = service.turn(payload.conversation_id, payload.client_message_id,
                              payload.state.model_dump() if payload.state else None,
                              payload.action.model_dump(), payload.message)
    except CaseInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {**result, "request_id": request.state.request_id}


@router.get("/api/v1/knowledge", response_model=KnowledgeIndex, tags=["knowledge"])
def knowledge_index(repository: Annotated[KnowledgeRepository, Depends(get_knowledge)]):
    return {"corpus": repository.status(), "documents": repository.list_documents()}


@router.post("/api/v1/salary-delay/analysis", response_model=AnalysisResponse,
             responses={422: {"model": ErrorResponse}}, tags=["salary-delay"],
             summary="Предварительная оценка подтверждённых фактов без LLM")
def salary_analysis(payload: AnalysisRequest, request: Request,
                    service: Annotated[AnalysisService, Depends(get_analysis_service)]):
    try:
        result = service.analyze(payload.state.model_dump(), payload.options.model_dump())
    except CaseInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"conversation_id": payload.conversation_id, "analysis": result, "request_id": request.state.request_id}


@router.get("/api/v1/knowledge/search", response_model=KnowledgeSearch, tags=["knowledge"])
def knowledge_search(repository: Annotated[KnowledgeRepository, Depends(get_knowledge)],
                     q: Annotated[str, Query(min_length=1, max_length=300)],
                     limit: Annotated[int, Query(ge=1, le=30)] = 12):
    return {"corpus": repository.status(), "query": q, "results": repository.search(q, limit)}


@router.get("/api/v1/knowledge/documents/{document_id}", response_model=LegalDocument,
            responses={404: {"model": ErrorResponse}}, tags=["knowledge"])
def knowledge_document(document_id: str, repository: Annotated[KnowledgeRepository, Depends(get_knowledge)]):
    document = repository.document(document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Источник не найден в этой версии базы.")
    return document


@router.get("/api/v1/ai/status", response_model=AIStatus, tags=["ai"],
            summary="Настройки AI и локальный счётчик, без вызова модели")
def ai_status():
    return get_llm().status()


@router.post("/api/v1/ai/turn", response_model=AIResponse, tags=["ai"],
             responses={422: {"model": ErrorResponse}, 429: {"model": ErrorResponse},
                        502: {"model": ErrorResponse}, 503: {"model": ErrorResponse}, 504: {"model": ErrorResponse}},
             summary="AI-диалог: кандидаты фактов, подтверждение и объяснение источников")
async def ai_turn(payload: AIRequest, request: Request, service: Annotated[AIService, Depends(get_ai_service)]):
    try:
        result = await asyncio.wait_for(service.turn(
            payload.conversation_id, payload.client_message_id, payload.message,
            payload.state.model_dump() if payload.state else None,
            [item.model_dump() for item in payload.candidates], payload.action,
            [item.model_dump() for item in payload.history], payload.as_of_date,
        ), timeout=get_settings().ai_timeout_seconds * 2 + 10)
    except CaseInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except TimeoutError:
        raise AIError("ai_turn_timeout", "Обработка запроса заняла слишком много времени. Сведения не изменены; можно повторить отправку.", 504) from None
    return {**result, "request_id": request.state.request_id}
