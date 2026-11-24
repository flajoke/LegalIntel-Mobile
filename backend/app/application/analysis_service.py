import json
from pathlib import Path

from app.domain.cases.salary_delay import transition
from app.domain.rules.salary_analysis import evaluate
from app.infrastructure.knowledge.repository import KnowledgeRepository


class AnalysisService:
    def __init__(self, knowledge: KnowledgeRepository, reference: dict | None = None):
        self.knowledge = knowledge
        self.reference = reference if reference is not None else json.loads(
            (Path(__file__).resolve().parents[1] / "domain/rules/reference_data.json").read_text(encoding="utf-8"))

    def analyze(self, state: dict, options: dict) -> dict:
        # Reuse ALL collector validation, including dependency pruning and confirmation.
        # Only its normalized copy is inspected; the user's stored state is untouched.
        case = transition(state, {"kind": "refresh"})
        sources = {item["id"]: item for item in self.knowledge.list_documents()}
        valid = all(item_id in sources and sources[item_id]["sha256"] == expected["sha256"]
                    for item_id, expected in self.reference["norms"].items())
        result = evaluate(case, options, self.reference, sources_valid=valid)
        ids = {source for group in (result["findings"], result["next_steps"], result["documents"]) for item in group for source in item["source_ids"]}
        result["sources"] = [sources[item_id] for item_id in sorted(ids) if item_id in sources] if result["status"] != "outside_scope" else []
        result["corpus"] = self.knowledge.status()
        return result
