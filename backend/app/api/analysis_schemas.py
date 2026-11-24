from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.api.schemas import StrictModel, SalaryStateIn, CorpusStatus, LegalSource

IsoDate = Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}$")]
Money = Annotated[str, StringConstraints(pattern=r"^\d{1,10}(?:\.\d{1,2})?$")]


class PaymentIn(StrictModel):
    date: IsoDate
    amount: Money


class AnalysisOptions(StrictModel):
    deadline_mode: Literal["unverified", "already_adjusted", "federal_five_day"] = "unverified"
    amount_basis: Literal["unknown", "accrued"] = "unknown"
    payment_history_complete: bool = False
    payments: list[PaymentIn] = Field(default_factory=list, max_length=50)


class AnalysisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    conversation_id: UUID
    state: SalaryStateIn
    options: AnalysisOptions = Field(default_factory=AnalysisOptions)


class AnalysisFact(StrictModel):
    label: str
    value: str


class AnalysisFinding(StrictModel):
    id: str
    title: str
    status: Literal["supports", "attention", "missing", "info"]
    explanation: str
    facts: list[AnalysisFact]
    source_ids: list[str]


class AnalysisItem(StrictModel):
    id: str
    title: str
    text: str
    source_ids: list[str]


class CompensationSegment(StrictModel):
    start: str
    end: str
    days: int
    principal: str
    rate_percent: str
    amount: str


class CompensationOut(StrictModel):
    status: Literal["calculated", "not_needed", "unavailable"]
    amount: str | None
    explanation: str
    formula: str
    segments: list[CompensationSegment]
    missing: list[str]
    rate_source_url: str
    rates_checked_through: str


class DeadlineOut(StrictModel):
    date: str | None
    basis: str
    delay_days: int | None
    calendar_source_url: str | None


class RuleReferenceOut(StrictModel):
    version: str
    valid_from: str
    checked_through: str
    legal_reviewed: bool


class SalaryAnalysisOut(StrictModel):
    status: Literal["needs_confirmation", "outside_scope", "needs_review", "needs_facts", "possible_delay", "paid_late", "no_delay_detected"]
    title: str
    summary: str
    as_of_date: str
    data_quality: Literal["sufficient", "limited", "insufficient"]
    data_quality_explanation: str
    missing: list[str]
    findings: list[AnalysisFinding]
    deadline: DeadlineOut
    remaining_amount: str | None
    compensation: CompensationOut
    next_steps: list[AnalysisItem]
    documents: list[AnalysisItem]
    lawyer_reasons: list[str]
    sources: list[LegalSource]
    corpus: CorpusStatus
    rules: RuleReferenceOut
    limitations: list[str]
    disclaimer: str


class AnalysisResponse(StrictModel):
    conversation_id: UUID
    analysis: SalaryAnalysisOut
    request_id: str
