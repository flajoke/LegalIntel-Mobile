import asyncio
from datetime import datetime, timezone
import json
import re
from uuid import uuid5

from app.application.ai_prompts import ANSWER, EXTRACT, PROMPT_VERSION
from app.application.ai_answers import question_was_asked, short_reply
from app.domain.ai import AIError, Extraction, GroundedAnswer, ModelGateway
from app.domain.cases.salary_delay import (
    BY_FIELD, QUESTIONS, CaseInputError, applicable, clear_dependents, display_value, normalize, transition,
)
from app.infrastructure.knowledge.repository import KnowledgeRepository


def compact(value: str) -> str:
    return " ".join(value.split())


def minimal_state(case: dict) -> dict:
    return {key: case[key] for key in ("version", "description", "answers", "confirmed")}


class AIService:
    def __init__(self, model: ModelGateway, knowledge: KnowledgeRepository, context_chars: int = 6000):
        self.model, self.knowledge, self.context_chars = model, knowledge, context_chars
        self.lock = asyncio.Lock()

    async def turn(self, conversation_id, message_id, message: str, state: dict | None,
                   candidates: list[dict], action: str, history: list[dict], as_of_date: str | None) -> dict:
        self.model.ensure_configured()
        if self.lock.locked():
            raise AIError("ai_busy", "AI обрабатывает другой запрос. Повторите отправку после его завершения.", 429)
        async with self.lock:
            return await self._turn(conversation_id, message_id, message, state, candidates, action, history, as_of_date)

    async def _turn(self, conversation_id, message_id, message, state, candidates, action, history, as_of_date):
        bounded_history, characters = [], 0
        for item in reversed(history):
            if len(bounded_history) >= 4 or characters >= 1800:
                break
            if characters + len(item["content"]) > 1800:
                if not bounded_history:
                    bounded_history.insert(0, {**item, "content": item["content"][-1800:]})
                break
            bounded_history.insert(0, item)
            characters += len(item['content'])
        history = bounded_history
        if state is None and action != "message":
            raise CaseInputError("Сначала опишите ситуацию в чате.")
        case = transition(state, {"kind": "refresh"}) if state else transition(None, {"kind": "start", "value": as_of_date}, message)
        pending = self.normalize_candidates(candidates, case)
        warnings = []
        message_kind = "facts"
        direct = None
        intent = "salary_delay" if len(case["answers"]) > 1 or pending else "unclear"
        if action == "message":
            fields = [{"field": q.field, "label": q.label, "kind": q.kind,
                       "options": [{"value": o.value, "label": o.label} for o in q.options]} for q in QUESTIONS if q.field != "as_of_date"]
            direct = short_reply(message, case, history, pending)
            if direct is not None:
                extraction = Extraction.model_validate({"intent": "salary_delay", "message_kind": "facts", "facts": [direct]})
            else:
                extraction = await self.model.generate([
                    {"role": "system", "content": EXTRACT},
                    {"role": "user", "content": json.dumps({
                        "latest_message": message, "history": history[-6:], "confirmed_facts": case["answers"],
                        "current_question": case["question"] if question_was_asked(case, history) else None, "pending_facts": pending,
                        "as_of_date": case["metrics"]["as_of_date"], "allowed_fields": fields,
                    }, ensure_ascii=False)},
                ], Extraction)
            intent = extraction.intent
            message_kind = extraction.message_kind
            proposed = {item["field"]: item for item in pending}
            seen = set()
            for fact in extraction.facts:
                if fact.field in seen:
                    warnings.append("В сообщении есть несколько значений одного поля. Уточните, какое из них верно.")
                    proposed.pop(fact.field, None)
                    continue
                seen.add(fact.field)
                if compact(fact.evidence).casefold() not in compact(message).casefold():
                    warnings.append("Часть предложенных моделью сведений не подтверждалась вашим сообщением и не была добавлена.")
                    continue
                # A reported duration is not the contractual due date.
                if fact.field == "due_date" and re.fullmatch(r"\D*\d+\s+д(?:ень|ня|ней)\D*", fact.evidence, re.I) and not re.search(r"назад|\d[./-]\d", fact.evidence, re.I):
                    warnings.append("Дату выплаты нужно указать отдельно: оценка задержки в днях её не заменяет.")
                    continue
                try:
                    value = normalize(BY_FIELD[fact.field], fact.value)
                except CaseInputError:
                    warnings.append("Не удалось проверить часть дат или сумм. Уточните их в следующем сообщении.")
                    continue
                if fact.field in case["answers"] and value == case["answers"][fact.field]:
                    proposed.pop(fact.field, None)
                    continue
                proposed[fact.field] = {"field": fact.field, "value": value, "evidence": fact.evidence}
            pending = self.normalize_candidates(list(proposed.values()), case)
        elif action == "accept":
            if not pending:
                raise CaseInputError("Нет сведений для подтверждения.")
            supplied = {item["field"]: item["value"] for item in pending}
            answers = dict(case["answers"])
            for field, value in supplied.items():
                if field in answers and answers[field] != value:
                    clear_dependents(answers, field, set(supplied))
            answers.update(supplied)
            inactive = set(supplied) - {q.field for q in applicable(answers)}
            if inactive:
                labels = ", ".join(BY_FIELD[field].label for field in sorted(inactive))
                raise CaseInputError(f"Для полей «{labels}» сначала уточните вид выплаты, её статус и оформление ситуации. Можно дописать уточнение в чате или не сохранять предложенные сведения.")
            case = transition({**minimal_state(case), "answers": answers, "confirmed": False}, {"kind": "refresh"})
            pending = []
        elif action == "dismiss":
            pending = []
        elif action == "confirm":
            if pending:
                raise CaseInputError("Сначала подтвердите предложенные сведения или выберите «Не сохранять».")
            case = transition(minimal_state(case), {"kind": "confirm"})
        else:
            raise CaseInputError("Неизвестное действие AI-диалога.")

        needs_sources = message_kind == "question" or case["status"] in {"review", "complete"} or (action == "message" and direct is None and message_kind == "facts")
        sources = self.retrieve(message, case["answers"]) if needs_sources and case["status"] != "outside_scope" and intent == "salary_delay" else []
        fact_update = "proposed" if pending else {"accept": "saved", "dismiss": "dismissed", "confirm": "confirmed"}.get(action, "none")
        next_question = case["question"] if not pending and message_kind == "facts" and intent == "salary_delay" else None
        generated = await self.model.generate([
            {"role": "system", "content": ANSWER},
            {"role": "user", "content": json.dumps({
                "latest_message": message, "action": action, "intent": intent, "message_kind": message_kind,
                "fact_update": fact_update, "history": history[-6:],
                "confirmed_facts": case["summary"], "proposed_facts": [{"field": p["field"], "value": p["value"]} for p in pending], "case_status": case["status"],
                "next_question": next_question, "supplied_sources": [
                    {k: s[k] for k in ("chunk_id", "citation", "edition", "excerpt")} for s in sources],
            }, ensure_ascii=False)},
        ], GroundedAnswer)
        # The server, rather than a free-form acknowledgement, reports whether facts were saved.
        acknowledgement = {"accept": "Сведения сохранены.", "dismiss": "Предложенные сведения не сохранены.",
                           "confirm": "Сведения подтверждены."}.get(action)
        if pending and message_kind == "facts":
            acknowledgement = "Я выделил сведения из вашего сообщения. Они пока не сохранены в кейсе."
        if acknowledgement:
            generated = generated.model_copy(update={"acknowledgement": acknowledgement})
        text, used_sources = self.render(generated, sources)
        if pending:
            text += "\n\nЯ выделил сведения из ваших слов. Проверьте карточку ниже: они сохранятся только после подтверждения. Можно дописать уточнение в чат."
        elif case["status"] == "outside_scope":
            text += "\n\nТекущий сценарий рассчитан на работу в России. Страну можно исправить в сведениях по выплате."
        elif next_question:
            text += "\n\n" + next_question["prompt"]
        elif case["status"] == "review" and message_kind == "facts":
            text += "\n\nСведения собраны. Проверьте их в карточке и подтвердите."
        elif case["status"] == "complete":
            text += "\n\nСведения подтверждены. Это справочное объяснение источников. Предварительная оценка доступна отдельно по кнопке «Посмотреть анализ выплаты»."
        if warnings:
            text += "\n\n" + " ".join(dict.fromkeys(warnings))
        case["corpus"] = self.knowledge.status()
        case["sources"] = self.knowledge.sources_for(case["answers"]) if case["status"] in {"review", "complete"} else []
        return {"conversation_id": conversation_id, "client_message_id": message_id, "mode": "ai",
                "message": {"id": uuid5(conversation_id, str(message_id)), "role": "assistant", "content": text,
                            "created_at": datetime.now(timezone.utc)},
                "case": case, "candidates": pending, "sources": used_sources, "prompt_version": PROMPT_VERSION}

    @staticmethod
    def normalize_candidates(items: list[dict], case: dict) -> list[dict]:
        result = []
        seen = set()
        for item in items:
            field = item["field"]
            if field not in BY_FIELD or field == "as_of_date" or field in seen:
                raise CaseInputError("Некорректный набор предложенных сведений.")
            seen.add(field)
            q = BY_FIELD[field]
            value = normalize(q, item["value"])
            result.append({"field": field, "value": value, "evidence": item["evidence"],
                           "label": q.label, "display_value": display_value(field, value),
                           "previous_value": display_value(field, case["answers"][field]) if field in case["answers"] else None})
        order = {q.field: i for i, q in enumerate(QUESTIONS)}
        return sorted(result, key=lambda item: order[item["field"]])

    def retrieve(self, query: str, answers: dict) -> list[dict]:
        hits = self.knowledge.search(query, 12)
        # A transparent topical fallback, still using stored, existing chunks.
        for source in self.knowledge.sources_for(answers):
            doc = self.knowledge.document(source["id"])
            chunk = doc["chunks"][0]
            hits.append({**source, "chunk_id": chunk["id"], "excerpt": chunk["text"]})
        result, used, characters = [], set(), 0
        for hit in hits:
            if hit["id"] in used or characters + len(hit["excerpt"]) > self.context_chars:
                continue
            used.add(hit["id"])
            result.append(hit)
            characters += len(hit["excerpt"])
            if len(result) == 3:
                break
        return result

    @staticmethod
    def render(answer: GroundedAnswer, sources: list[dict]) -> tuple[str, list[dict]]:
        lookup = {s["chunk_id"]: s for s in sources}
        paragraphs = [answer.acknowledgement]
        used = {}
        for explanation in answer.explanations:
            source = lookup.get(explanation.chunk_id)
            if source is None or compact(explanation.quote) not in compact(source["excerpt"]):
                raise AIError("ai_unsupported_source", "Не удалось подтвердить ссылку или цитату в ответе AI. Ответ не показан; попробуйте уточнить вопрос.")
            paragraphs.append(f"{source['citation']}: {explanation.explanation}\n\n«{explanation.quote}»")
            used[source["chunk_id"]] = {**source, "excerpt": explanation.quote}
        text = "\n\n".join(paragraphs)
        if re.search(r"https?://|www\.", text, re.I):
            raise AIError("ai_unsupported_link", "AI предложил ссылку вне проверенной базы. Ответ не показан; повторите запрос.")
        return text, list(used.values())
