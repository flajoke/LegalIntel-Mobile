from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import UUID


@dataclass(frozen=True, slots=True)
class ContextMessage:
    role: Literal["user", "assistant"]
    content: str


@dataclass(frozen=True, slots=True)
class ChatCommand:
    conversation_id: UUID
    client_message_id: UUID
    message: str
    history: tuple[ContextMessage, ...]


@dataclass(frozen=True, slots=True)
class ChatReply:
    id: UUID
    content: str
    created_at: datetime
    mode: Literal["stub"] = "stub"
