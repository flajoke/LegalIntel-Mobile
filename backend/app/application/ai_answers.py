"""Unambiguous replies to an actually asked question, still returned as proposals."""
import re

from app.domain.cases.salary_delay import BY_FIELD, CaseInputError, normalize


def words(value: str) -> str:
    return re.sub(r"[^\w]+", " ", value.casefold().replace("ё", "е")).strip()


def question_was_asked(case: dict, history: list[dict]) -> bool:
    question = case["question"]
    return bool(question and history and history[-1]["role"] == "assistant"
                and question["prompt"] in history[-1]["content"])


def short_reply(message: str, case: dict, history: list[dict], pending: list[dict]) -> dict | None:
    question = case["question"]
    if pending or not question or not history or len(message.strip()) > 160:
        return None
    # A bare 'yes' at the start of a chat or after a different question proves nothing.
    if not question_was_asked(case, history):
        return None
    q = BY_FIELD[question["field"]]
    text = words(message)
    if q.allow_unknown and text in {"не знаю", "не помню", "неизвестно", "затрудняюсь ответить"}:
        return {"field": q.field, "value": None, "evidence": message.strip()}
    value = None
    if q.kind == "choice":
        for option in question["options"]:
            if text in {words(option["value"]), words(option["label"])}:
                value = option["value"]
                break
        yes = text in {"да", "да конечно", "конечно", "ага", "да верно", "да все верно", "да именно так"}
        no = text in {"нет", "нет конечно", "неа"}
        if q.field == "jurisdiction":
            if yes or text in {"россия", "в россии"}: value = "russia"
            elif no: value = "other"
        elif q.field in {"worked_last_day", "settlement_requested"}:
            if yes: value = "yes"
            elif no: value = "no"
        elif q.field == "work_status" and yes:
            value = "working"
        elif q.field == "employer_contact" and no:
            value = "no"
    elif q.kind in {"money", "date"}:
        try:
            value = normalize(q, message)
        except CaseInputError:
            return None
    if value is None:
        return None
    return {"field": q.field, "value": value, "evidence": message.strip()}
