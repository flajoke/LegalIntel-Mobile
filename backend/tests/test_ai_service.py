"""Conversation regressions with real state transitions/RAG, no provider or server."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from uuid import uuid4

from app.application.ai_answers import short_reply
from app.application.ai_service import AIService, minimal_state
from app.domain.cases.salary_delay import transition
from app.infrastructure.knowledge.repository import KnowledgeRepository


class FixtureModel:
    def __init__(self, extractions=()):
        self.extractions = iter(extractions)
        self.calls = []

    def ensure_configured(self): pass

    async def generate(self, messages, schema):
        context = json.loads(messages[-1]["content"])
        self.calls.append(schema.__name__)
        if schema.__name__ == "Extraction":
            return schema.model_validate(next(self.extractions))
        if context["message_kind"] == "question" and context["supplied_sources"]:
            source = context["supplied_sources"][0]
            return schema.model_validate({"acknowledgement": "Объясню норму из базы.", "explanations": [{
                "chunk_id": source["chunk_id"], "quote": source["excerpt"][:80],
                "explanation": "Это положение описывает условия выплаты."}]})
        return schema.model_validate({"acknowledgement": "Здравствуйте! Расскажите о ситуации с выплатой.", "explanations": []})


def extraction(facts=(), intent="salary_delay", kind="facts"):
    return {"intent": intent, "message_kind": kind, "facts": list(facts)}


class ConversationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.knowledge = KnowledgeRepository(Path(self.temp.name) / "knowledge.sqlite3", Path(__file__).resolve().parents[1] / "knowledge")
        self.knowledge.rebuild()
        self.case = transition(None, {"kind": "start", "value": "2026-11-23"}, "Задерживают зарплату")

    def tearDown(self): self.temp.cleanup()

    def asked(self, case=None):
        return [{"role": "assistant", "content": (case or self.case)["question"]["prompt"]}]

    async def turn(self, service, message, case=None, candidates=(), action="message", history=()):
        return await service.turn(uuid4(), uuid4(), message, minimal_state(case or self.case),
                                  list(candidates), action, list(history), "2026-11-23")

    async def test_yes_of_course_is_proposed_then_accept_advances_question(self):
        model = FixtureModel()  # A direct reply does not depend on stochastic extraction.
        service = AIService(model, self.knowledge)
        result = await self.turn(service, "да, конечно", history=self.asked())
        self.assertEqual(model.calls, ["GroundedAnswer"])
        self.assertNotIn("jurisdiction", result["case"]["answers"])
        self.assertEqual(result["candidates"][0]["value"], "russia")
        self.assertEqual(result["candidates"][0]["evidence"], "да, конечно")
        self.assertNotIn("Речь о работе в России?", result["message"]["content"])
        self.assertIn("пока не сохранены", result["message"]["content"])
        accepted = await self.turn(service, "Сохранить сведения", result["case"], result["candidates"], "accept")
        self.assertEqual(accepted["case"]["answers"]["jurisdiction"], "russia")
        self.assertEqual(accepted["case"]["question"]["field"], "employment_type")
        self.assertIn("Как оформлена ваша работа?", accepted["message"]["content"])
        self.assertNotIn("Речь о работе в России?", accepted["message"]["content"])

    async def test_greeting_does_not_force_country_question(self):
        service = AIService(FixtureModel([extraction(intent="unclear", kind="greeting")]), self.knowledge)
        result = await self.turn(service, "привет")
        self.assertFalse(result["candidates"])
        self.assertNotIn("Речь о работе в России?", result["message"]["content"])
        self.assertEqual(result["case"]["answers"], {"as_of_date": "2026-11-23"})

    async def test_long_previous_answer_does_not_erase_its_final_question(self):
        model = FixtureModel()
        result = await self.turn(AIService(model, self.knowledge), "да, конечно", history=[{
            "role": "assistant", "content": "Длинное пояснение. " * 150 + self.case["question"]["prompt"]}])
        self.assertEqual(result["candidates"][0]["value"], "russia")
        self.assertEqual(model.calls, ["GroundedAnswer"])

    async def test_legal_question_is_answered_without_repeating_form_question(self):
        service = AIService(FixtureModel([extraction(kind="question")]), self.knowledge)
        result = await self.turn(service, "Что говорит ТК РФ о компенсации при задержке зарплаты?", history=self.asked())
        self.assertTrue(result["sources"])
        self.assertIn("Это положение описывает", result["message"]["content"])
        self.assertNotIn("Речь о работе в России?", result["message"]["content"])
        self.assertFalse(result["candidates"])

    async def test_unknown_amount_and_date_survive_accept_without_guessing_country(self):
        message = "Задерживают зарплату, точную сумму и дату не помню"
        service = AIService(FixtureModel([extraction([
            {"field": "expected_amount", "value": None, "evidence": "точную сумму и дату не помню"},
            {"field": "due_date", "value": None, "evidence": "точную сумму и дату не помню"},
        ])]), self.knowledge)
        result = await self.turn(service, message)
        accepted = await self.turn(service, "Сохранить сведения", result["case"], result["candidates"], "accept")
        self.assertIsNone(accepted["case"]["answers"]["expected_amount"])
        self.assertIsNone(accepted["case"]["answers"]["due_date"])
        self.assertNotIn("jurisdiction", accepted["case"]["answers"])
        self.assertIsNone(accepted["case"]["metrics"]["remaining_amount"])

    async def test_unknown_reply_is_not_converted_to_no_or_zero(self):
        result = await self.turn(AIService(FixtureModel(), self.knowledge), "Не знаю.", history=self.asked())
        self.assertIsNone(result["candidates"][0]["value"])
        accepted = await self.turn(AIService(FixtureModel(), self.knowledge), "Сохранить", result["case"], result["candidates"], "accept")
        self.assertIsNone(accepted["case"]["answers"]["jurisdiction"])

    def test_bare_yes_needs_an_actually_asked_matching_question(self):
        self.assertIsNone(short_reply("да, конечно", self.case, [], []))
        self.assertIsNone(short_reply("да", self.case, [{"role": "assistant", "content": "Расскажите подробнее."}], []))
        self.assertIsNone(short_reply("да", self.case, [{"role": "user", "content": self.case["question"]["prompt"]}], []))

    def test_ambiguous_or_qualified_reply_does_not_trigger_direct_match(self):
        for text in ("да, но я спрашиваю о другом человеке", "нет, это пример", "почему вы спрашиваете?"):
            self.assertIsNone(short_reply(text, self.case, self.asked(), []))
        case = transition({**minimal_state(self.case), "answers": {**self.case["answers"], "jurisdiction": "russia", "employment_type": "employment"}}, {"kind": "refresh"})
        self.assertIsNone(short_reply("нет", case, self.asked(case), []), "Not working now does not prove dismissal")

    async def test_yes_does_not_silently_accept_existing_proposals(self):
        pending = [{"field": "jurisdiction", "value": "russia", "evidence": "в России"}]
        service = AIService(FixtureModel([extraction(intent="unclear")]), self.knowledge)
        result = await self.turn(service, "да", candidates=pending, history=self.asked())
        self.assertNotIn("jurisdiction", result["case"]["answers"])
        self.assertEqual(result["candidates"][0]["value"], "russia")

    async def test_complete_description_keeps_all_facts_until_confirmation(self):
        facts = {
            "jurisdiction": "russia", "employment_type": "employment", "work_status": "working", "payment_type": "salary",
            "period": "ноябрь 2026", "due_date": "2026-11-10", "due_source": "contract", "expected_amount": "45000",
            "payment_status": "none", "documents": "contract,payslip,bank", "employer_contact": "no",
        }
        message = "Явно описанная тестовая ситуация."
        model = FixtureModel([extraction([{"field": f, "value": v, "evidence": message} for f, v in facts.items()])])
        service = AIService(model, self.knowledge)
        result = await self.turn(service, message)
        self.assertEqual(len(result["candidates"]), len(facts))
        self.assertEqual(result["case"]["answers"], {"as_of_date": "2026-11-23"})
        accepted = await self.turn(service, "Сохранить", result["case"], result["candidates"], "accept")
        self.assertEqual(accepted["case"]["status"], "review")
        confirmed = await self.turn(service, "Подтвердить", accepted["case"], action="confirm")
        self.assertTrue(confirmed["case"]["confirmed"])
        self.assertEqual(confirmed["case"]["metrics"]["remaining_amount"], "45000.00")
        self.assertEqual(confirmed["case"]["metrics"]["delay_days"], 13)

    async def test_fabricated_evidence_is_still_rejected(self):
        service = AIService(FixtureModel([extraction([{"field": "jurisdiction", "value": "russia", "evidence": "в России"}])]), self.knowledge)
        result = await self.turn(service, "Не хочу пока указывать страну")
        self.assertFalse(result["candidates"])
        self.assertNotIn("jurisdiction", result["case"]["answers"])
        self.assertIn("не подтверждалась", result["message"]["content"])
