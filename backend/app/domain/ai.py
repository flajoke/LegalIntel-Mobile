"""LLM contracts. Extracted facts are proposals until explicitly accepted."""
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field


class AIError(Exception):
    def __init__(self, code: str, message: str, status: int = 502):
        super().__init__(message)
        self.code, self.status = code, status


class StructuredModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


FactField = Literal[
    "jurisdiction", "employment_type", "work_status", "dismissal_date", "payment_type",
    "worked_last_day", "settlement_requested", "settlement_request_date", "period", "due_date",
    "due_source", "expected_amount", "payment_status", "received_amount", "last_payment_date",
    "documents", "employer_contact", "reported_delay_days",
]


class ExtractedFact(StructuredModel):
    field: FactField
    value: str | None
    evidence: str = Field(min_length=1, max_length=500)


class Extraction(StructuredModel):
    intent: Literal["salary_delay", "other", "unclear"]
    message_kind: Literal["facts", "question", "greeting", "other"]
    facts: list[ExtractedFact] = Field(max_length=18)


class Explanation(StructuredModel):
    chunk_id: str
    quote: str = Field(min_length=20, max_length=700)
    explanation: str = Field(min_length=1, max_length=1100)


class GroundedAnswer(StructuredModel):
    acknowledgement: str = Field(min_length=1, max_length=450)
    explanations: list[Explanation] = Field(max_length=3)


class ModelGateway(Protocol):
    def ensure_configured(self) -> None: ...
    async def generate(self, messages: list[dict], schema: type[BaseModel]) -> BaseModel: ...
