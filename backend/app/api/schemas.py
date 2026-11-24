from datetime import datetime
from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from app.domain.ai import ExtractedFact

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
    capabilities: list[str] = ["salary_delay_v1", "knowledge_fts5", "ai_chat_v1", "salary_analysis_v1", "salary_documents_v1", "accounts_v1", "account_sync_v1"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


AnswerValue = Annotated[str, StringConstraints(max_length=4000)] | None


class SalaryStateIn(StrictModel):
    version: Literal[1]
    description: str = Field(default="", max_length=4000)
    answers: dict[str, AnswerValue] = Field(max_length=24)
    confirmed: bool = False


class SalaryAction(StrictModel):
    kind: Literal["start", "answer", "edit", "confirm", "refresh"]
    field: str | None = Field(default=None, max_length=40)
    value: AnswerValue = None

    @model_validator(mode="after")
    def check_action(self) -> Self:
        if self.kind in {"answer", "edit"} and not self.field:
            raise ValueError("Укажите поле ответа")
        if self.kind not in {"answer", "edit"} and self.field is not None:
            raise ValueError("Это действие не принимает поле")
        if self.kind in {"confirm", "refresh"} and self.value is not None:
            raise ValueError("Это действие не принимает значение")
        return self


class SalaryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    conversation_id: UUID
    client_message_id: UUID
    message: MessageText
    state: SalaryStateIn | None = None
    action: SalaryAction


class QuestionOption(BaseModel):
    value: str
    label: str


class QuestionOut(BaseModel):
    field: str
    label: str
    prompt: str
    kind: Literal["choice", "multi", "date", "money", "text"]
    hint: str
    options: list[QuestionOption]
    allow_unknown: bool


class CorpusStatus(BaseModel):
    version: str
    checked_on: str
    documents: int
    chunks: int


class LegalSource(BaseModel):
    id: str
    citation: str
    title: str
    source_url: str
    publisher: str
    edition: str
    checked_on: str
    source_type: Literal["normative", "expert"]
    sha256: str


class SourceExcerpt(LegalSource):
    chunk_id: str
    excerpt: str


class SearchHit(SourceExcerpt):
    position: int
    rank: float


class DocumentChunk(BaseModel):
    id: str
    position: int
    start_offset: int
    end_offset: int
    text: str


class LegalDocument(LegalSource):
    text: str
    chunks: list[DocumentChunk]


class KnowledgeIndex(BaseModel):
    corpus: CorpusStatus
    documents: list[LegalSource]


class KnowledgeSearch(BaseModel):
    corpus: CorpusStatus
    query: str
    results: list[SearchHit]


class CaseProgress(BaseModel):
    answered: int
    total: int


class CaseSummaryRow(BaseModel):
    field: str
    label: str
    value: str


class CaseMetrics(BaseModel):
    delay_days: int | None
    remaining_amount: str | None
    as_of_date: str


class SalaryCaseOut(BaseModel):
    version: Literal[1]
    description: str
    answers: dict[str, str | None]
    confirmed: bool
    status: Literal["collecting", "review", "complete", "outside_scope"]
    question: QuestionOut | None
    fields: list[QuestionOut]
    progress: CaseProgress
    summary: list[CaseSummaryRow]
    notices: list[str]
    metrics: CaseMetrics
    sources: list[SourceExcerpt]
    corpus: CorpusStatus


class SalaryResponse(BaseModel):
    conversation_id: UUID
    client_message_id: UUID
    message: AssistantMessageOut
    mode: Literal["guided"]
    case: SalaryCaseOut
    request_id: str


class CandidateOut(ExtractedFact):
    label: str
    display_value: str
    previous_value: str | None


class AIRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    conversation_id: UUID
    client_message_id: UUID
    message: MessageText
    state: SalaryStateIn | None = None
    candidates: list[ExtractedFact] = Field(default_factory=list, max_length=18)
    action: Literal["message", "accept", "dismiss", "confirm"] = "message"
    as_of_date: str | None = Field(default=None, max_length=10)
    history: list[ContextMessageIn] = Field(default_factory=list, max_length=12)

    @model_validator(mode="after")
    def bounded_context(self) -> Self:
        if sum(len(item.content) for item in self.history) > 10000:
            raise ValueError("История AI-запроса должна содержать не более 10000 символов")
        return self


class AIResponse(BaseModel):
    conversation_id: UUID
    client_message_id: UUID
    message: AssistantMessageOut
    mode: Literal["ai"]
    case: SalaryCaseOut
    candidates: list[CandidateOut]
    sources: list[SourceExcerpt]
    prompt_version: str
    request_id: str


class UsageOut(BaseModel):
    day_utc: str
    calls: int
    limit: int


class AIStatus(BaseModel):
    provider: str
    model: str
    configured: bool
    connection_verified: Literal[False] = False
    usage: UsageOut
