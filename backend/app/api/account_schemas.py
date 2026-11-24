from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, StringConstraints, field_validator, model_validator
from typing import Annotated

from app.api.schemas import SalaryCaseOut, SalaryAction, SourceExcerpt, CandidateOut, LegalSource
from app.api.analysis_schemas import AnalysisOptions
from app.api.document_schemas import LetterDetails


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Credentials(Strict):
    username: str = Field(min_length=3, max_length=32, pattern=r"^[A-Za-z][A-Za-z0-9_.-]*$")
    password: SecretStr
    device: Literal["web", "native"] = "web"

    @field_validator("password")
    @classmethod
    def password_length(cls, value):
        if not 10 <= len(value.get_secret_value()) <= 128:
            raise ValueError("Пароль должен содержать от 10 до 128 символов")
        return value


class UserOut(Strict):
    id: str
    username: str
    created_at: str


class SessionOut(Strict):
    user: UserOut
    token: str | None = None
    expires_at: str


class CloudMessage(Strict):
    id: str = Field(min_length=1, max_length=100)
    role: Literal["user", "assistant"]
    content: str = Field(max_length=20000)
    createdAt: str = Field(max_length=50)
    status: Literal["pending", "sent", "failed"]
    error: str | None = Field(default=None, max_length=2000)
    inReplyTo: str | None = Field(default=None, max_length=100)
    mode: Literal["stub", "guided", "ai"] | None = None
    scenarioAction: SalaryAction | None = None
    aiAction: Literal["message", "accept", "dismiss", "confirm"] | None = None
    sources: list[SourceExcerpt] | None = Field(default=None, max_length=20)

    @model_validator(mode="before")
    @classmethod
    def no_optional_nulls(cls, value):
        if isinstance(value, dict) and any(key in value and value[key] is None for key in ("error", "inReplyTo", "mode", "scenarioAction", "aiAction", "sources")):
            raise ValueError("Необязательные поля сообщения следует опускать, а не передавать null")
        return value


class SavedAnalysis(Strict):
    caseFingerprint: str = Field(max_length=32000)
    options: AnalysisOptions


class CloudDocument(Strict):
    id: str = Field(pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")
    template: Literal["employer", "labor_inspectorate"]
    templateVersion: str = Field(max_length=100)
    title: str = Field(max_length=500)
    text: str = Field(max_length=30000)
    details: LetterDetails
    caseFingerprint: str = Field(max_length=32000)
    createdAt: str = Field(max_length=50)
    updatedAt: str = Field(max_length=50)
    reviewed: bool
    warnings: list[str] = Field(max_length=30)
    sources: list[LegalSource] = Field(max_length=20)


class CloudConversation(Strict):
    id: str = Field(min_length=1, max_length=100)
    title: str = Field(max_length=500)
    createdAt: str = Field(max_length=50)
    updatedAt: str = Field(max_length=50)
    draft: str = Field(max_length=20000)
    messages: list[CloudMessage] = Field(max_length=2000)
    scenario: Literal["salary_delay"] | None = None
    salaryCase: SalaryCaseOut | None = None
    assistantMode: Literal["ai", "guided"] | None = None
    aiCandidates: list[CandidateOut] | None = Field(default=None, max_length=30)
    salaryAnalysis: SavedAnalysis | None = None
    documentDrafts: list[CloudDocument] | None = Field(default=None, max_length=10)

    @model_validator(mode="before")
    @classmethod
    def no_optional_nulls(cls, value):
        if isinstance(value, dict) and any(key in value and value[key] is None for key in ("scenario", "salaryCase", "assistantMode", "aiCandidates", "salaryAnalysis", "documentDrafts")):
            raise ValueError("Необязательные поля чата следует опускать, а не передавать null")
        return value


class CloudSettings(Strict):
    apiUrl: str = Field(max_length=1000)
    theme: Literal["system", "light", "dark"]


class CloudState(Strict):
    version: Literal[3]
    conversations: list[CloudConversation] = Field(max_length=100)
    activeId: str | None = Field(max_length=100)
    newDraft: str = Field(max_length=20000)
    settings: CloudSettings

    @model_validator(mode="after")
    def unique_chats(self):
        ids = [chat.id for chat in self.conversations]
        if len(ids) != len(set(ids)): raise ValueError("Повторяются идентификаторы чатов")
        return self


class StateWrite(Strict):
    base_revision: int = Field(ge=0, strict=True)
    state: CloudState


class StateRead(Strict):
    revision: int
    state: CloudState | None
    updated_at: str | None


class StateWritten(Strict):
    revision: int
    updated_at: str
