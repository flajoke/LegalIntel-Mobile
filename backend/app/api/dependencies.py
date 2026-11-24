from functools import lru_cache

from app.application.chat_service import ChatService
from app.infrastructure.stub_reply import StubReplyGenerator
from app.application.salary_service import SalaryService
from app.core.config import get_settings
from app.infrastructure.knowledge.repository import KnowledgeRepository
from app.infrastructure.llm.gateway import LLMGateway
from app.application.ai_service import AIService
from app.application.analysis_service import AnalysisService
from app.application.letter_service import LetterService


@lru_cache
def get_chat_service() -> ChatService:
    return ChatService(StubReplyGenerator())


@lru_cache
def get_knowledge() -> KnowledgeRepository:
    settings = get_settings()
    return KnowledgeRepository(settings.knowledge_db, settings.knowledge_corpus)


@lru_cache
def get_salary_service() -> SalaryService:
    return SalaryService(get_knowledge())


@lru_cache
def get_llm() -> LLMGateway:
    return LLMGateway(get_settings())


@lru_cache
def get_ai_service() -> AIService:
    return AIService(get_llm(), get_knowledge(), get_settings().ai_context_chars)


@lru_cache
def get_analysis_service() -> AnalysisService:
    return AnalysisService(get_knowledge())


@lru_cache
def get_letter_service() -> LetterService:
    return LetterService(get_analysis_service())
