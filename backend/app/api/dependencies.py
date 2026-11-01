from functools import lru_cache

from app.application.chat_service import ChatService
from app.infrastructure.stub_reply import StubReplyGenerator


@lru_cache
def get_chat_service() -> ChatService:
    return ChatService(StubReplyGenerator())
