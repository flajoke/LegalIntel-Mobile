from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StringConstraints, model_validator

from app.api.analysis_schemas import AnalysisOptions
from app.api.schemas import LegalSource, SalaryStateIn, StrictModel

TemplateId = Literal["employer", "labor_inspectorate"]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]


class LetterDetails(StrictModel):
    document_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    applicant_name: ShortText = ""
    applicant_address: str = Field(default="", max_length=600)
    applicant_contact: ShortText = ""
    employer_name: ShortText = ""
    employer_address: str = Field(default="", max_length=600)
    inspectorate_name: ShortText = ""
    job_title: ShortText = ""
    additional_facts: str = Field(default="", max_length=2000)
    attachments: str = Field(default="", max_length=2000)
    request_compensation: bool = True


class DocumentDraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    conversation_id: UUID
    document_id: UUID
    template: TemplateId
    state: SalaryStateIn
    analysis_options: AnalysisOptions = Field(default_factory=AnalysisOptions)
    details: LetterDetails


class DocumentDraftResponse(BaseModel):
    conversation_id: UUID
    document_id: UUID
    template: TemplateId
    template_version: str
    title: str
    text: str
    missing: list[str]
    warnings: list[str]
    sources: list[LegalSource]
    created_at: datetime
    request_id: str


class DocumentExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: UUID
    template: TemplateId
    format: Literal["pdf", "docx"]
    text: str = Field(min_length=80, max_length=30000)
    reviewed: StrictBool

    @model_validator(mode="after")
    def confirmed_review(self):
        if self.reviewed is not True:
            raise ValueError("Перед экспортом проверьте текст и подтвердите проверку")
        return self
