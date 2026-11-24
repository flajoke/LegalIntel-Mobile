from datetime import datetime, timezone

from app.application.analysis_service import AnalysisService
from app.domain.cases.salary_delay import CaseInputError, transition
from app.domain.letters import build_letter


class LetterService:
    def __init__(self, analysis: AnalysisService):
        self.analysis = analysis

    def draft(self, state: dict, details: dict, template: str, options: dict) -> dict:
        case = transition(state, {"kind": "refresh"})
        analysis = self.analysis.analyze(state, options)
        result = build_letter(case, details, template, analysis)
        sources = {source["id"]: source for source in self.analysis.knowledge.list_documents()}
        if any(key not in sources for key in result["source_ids"]):
            raise CaseInputError("В базе отсутствует один из источников шаблона. Проверьте состав правовой базы перед подготовкой обращения.")
        result["sources"] = [sources[key] for key in result.pop("source_ids") if key in sources]
        result["created_at"] = datetime.now(timezone.utc)
        return result
