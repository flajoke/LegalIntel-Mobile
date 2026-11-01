from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

MessageText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class ContextMessageIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: MessageText


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    conversation_id: UUID
    client_message_id: UUID
    message: MessageText
    history: list[ContextMessageIn] = Field(default_factory=list, max_length=40)

    @model_validator(mode="after")
    def bounded_context(self) -> Self:
        if sum(len(item.content) for item in self.history) > 20000:
            raise ValueError("История запроса должна содержать не более 20000 символов")
        return self


class AssistantMessageOut(BaseModel):
    id: UUID
    role: Literal["assistant"] = "assistant"
    content: str
    created_at: datetime


class ChatResponse(BaseModel):
    conversation_id: UUID
    client_message_id: UUID
    message: AssistantMessageOut
    mode: Literal["stub"]
    request_id: str


class ErrorDetail(BaseModel):
    field: str
    message: str


class ErrorBody(BaseModel):
    code: str
    message: str
    details: list[ErrorDetail] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    error: ErrorBody
    request_id: str


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str
    version: str
    reply_mode: Literal["stub"]
