"""Salary fact collection. No LLM, legal qualification or compensation calculation."""
from dataclasses import asdict, dataclass, replace
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import re


class CaseInputError(ValueError):
    pass


@dataclass(frozen=True)
class Option:
    value: str
    label: str


@dataclass(frozen=True)
class Question:
    field: str
    label: str
    prompt: str
    kind: str = "choice"
    hint: str = ""
    options: tuple[Option, ...] = ()
    allow_unknown: bool = True

    def json(self) -> dict:
        return asdict(self)


def options(*pairs: tuple[str, str]) -> tuple[Option, ...]:
    return tuple(Option(*pair) for pair in pairs)


QUESTIONS = (
    Question("jurisdiction", "Место работы", "Речь о работе в России?", options=options(("russia", "Да, в России"), ("other", "В другой стране"))),
    Question("employment_type", "Оформление работы", "Как оформлена ваша работа?", options=options(
        ("employment", "Трудовой договор"), ("unwritten", "Работаю без письменного договора"), ("civil", "Договор ГПХ / самозанятость"))),
    Question("work_status", "Статус работы", "Вы продолжаете работать у этого работодателя?", options=options(("working", "Продолжаю работать"), ("dismissed", "Уже уволен(а)"))),
    Question("dismissal_date", "Дата увольнения", "Когда вы были уволены?", "date", "Например, 30.09.2026. Если дата спорная, выберите «Не знаю»."),
    Question("payment_type", "Вид выплаты", "Какую выплату разберём?", options=options(("salary", "Зарплата или аванс"), ("settlement", "Расчёт при увольнении"))),
    Question("worked_last_day", "Работа в день увольнения", "Вы работали в день увольнения?", options=options(("yes", "Да"), ("no", "Нет"))),
    Question("settlement_requested", "Требование о расчёте", "Вы предъявляли работодателю требование о расчёте?", options=options(("yes", "Да"), ("no", "Нет"))),
    Question("settlement_request_date", "Дата требования о расчёте", "Когда вы предъявили требование о расчёте?", "date", "Укажите дату, которую можете подтвердить."),
    Question("period", "За какой период", "За какой период вам должны эту выплату?", "text", "Например: зарплата за сентябрь 2026. В этом диалоге разберём одну конкретную выплату."),
    Question("due_date", "Срок выплаты", "Какого числа эта выплата должна была поступить?", "date", "Укажите срок с учётом переноса выходных, если он известен. Пример: 25.09.2026. Если срок неясен, выберите «Не знаю»."),
    Question("due_source", "Откуда известен срок", "Где указан срок этой выплаты?", options=options(
        ("contract", "В договоре"), ("rules", "В правилах / коллективном договоре"), ("notice", "В сообщении работодателя"), ("assumed", "Это моя оценка"))),
    Question("expected_amount", "Сумма к получению", "Сколько вы должны были получить за эту выплату?", "money", "Сумма в рублях к получению на руки, после удержаний. Пример: 45000 или 45000,50."),
    Question("payment_status", "Что уже выплачено", "Какая часть этой выплаты уже поступила?", options=options(("none", "Ничего"), ("partial", "Часть суммы"), ("full", "Вся сумма"))),
    Question("received_amount", "Получено", "Сколько всего вы уже получили в счёт этой выплаты?", "money", "Укажите общую полученную сумму за выбранную выплату, без компенсации за задержку."),
    Question("last_payment_date", "Последняя выплата", "Когда поступила последняя часть этой выплаты?", "date", "Если долг погашен полностью — дата окончательного расчёта. Пример: 02.10.2026."),
    Question("documents", "Подтверждения", "Какие подтверждения у вас есть?", "multi", "Можно выбрать несколько. Загружать документы сейчас не нужно.", options=options(
        ("contract", "Договор / приказ"), ("payslip", "Расчётный листок"), ("bank", "Банковская выписка"), ("messages", "Переписка"), ("other", "Другие подтверждения"), ("none", "Пока ничего"))),
    Question("employer_contact", "Обращение к работодателю", "Вы уже обращались к работодателю по поводу этой выплаты?", options=options(("written", "Письменно"), ("oral", "Устно"), ("no", "Ещё нет"))),
    Question("as_of_date", "Дата проверки", "На какую дату проверяем сведения?", "date", "Все полученные суммы укажите по состоянию на эту дату.", allow_unknown=False),
    Question("reported_delay_days", "Задержка с ваших слов", "Сколько дней задержки вы указали?", "text", "Это ваша оценка. Она не заменяет подтверждение установленной даты выплаты."),
)
BY_FIELD = {question.field: question for question in QUESTIONS}
DEPENDENCIES = {
    "work_status": ("dismissal_date", "payment_type"),
    "payment_type": ("worked_last_day", "period", "due_date", "expected_amount", "payment_status"),
    "due_date": ("due_source",), "expected_amount": ("received_amount",),
    "payment_status": ("received_amount", "last_payment_date"),
    "worked_last_day": ("settlement_requested", "settlement_request_date"),
    "settlement_requested": ("settlement_request_date",),
}


def clear_dependents(answers: dict, field: str, supplied: set[str] | None = None) -> None:
    pending = list(DEPENDENCIES.get(field, ()))
    while pending:
        key = pending.pop()
        if key not in (supplied or set()):
            answers.pop(key, None)
        pending.extend(DEPENDENCIES.get(key, ()))


def today() -> date:
    return datetime.now(timezone(timedelta(hours=3))).date()


def parse_date(value: str) -> date:
    try:
        if re.fullmatch(r"\d{2}\.\d{2}\.\d{4}", value):
            return datetime.strptime(value, "%d.%m.%Y").date()
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            return date.fromisoformat(value)
    except ValueError:
        pass
    raise CaseInputError("Введите существующую дату в формате ДД.ММ.ГГГГ, например 25.09.2026.")


def normalize(question: Question, value: str | None) -> str | None:
    if value is None:
        if not question.allow_unknown:
            raise CaseInputError("Для этого поля нужно указать дату.")
        return None
    value = value.strip()
    if not value:
        raise CaseInputError("Введите ответ или выберите «Не знаю».")
    if question.field == "reported_delay_days":
        if not re.fullmatch(r"\d{1,5}", value) or int(value) > 36500:
            raise CaseInputError("Укажите число дней от 0 до 36500.")
        return str(int(value))
    if question.kind == "date":
        parsed = parse_date(value)
        if parsed.year < 1900:
            raise CaseInputError("Проверьте год: он должен быть не раньше 1900.")
        if question.field == "as_of_date" and parsed > today() + timedelta(days=1):
            raise CaseInputError("Дата проверки не может быть в будущем.")
        return parsed.isoformat()
    if question.kind == "money":
        clean = re.sub(r"[\s\u00a0₽]", "", value).replace(",", ".")
        if not re.fullmatch(r"\d{1,12}(?:\.\d{1,2})?", clean):
            raise CaseInputError("Введите сумму в рублях, не более двух цифр после запятой.")
        try:
            amount = Decimal(clean)
        except InvalidOperation as exc:
            raise CaseInputError("Не удалось прочитать сумму.") from exc
        if amount <= 0 or amount > Decimal("1000000000"):
            raise CaseInputError("Сумма должна быть больше нуля и не больше 1 000 000 000 ₽.")
        return f"{amount:.2f}"
    if question.kind in {"choice", "multi"}:
        values = value.split(",") if question.kind == "multi" else [value]
        allowed = {option.value for option in question.options}
        if len(values) != len(set(values)) or any(item not in allowed for item in values):
            raise CaseInputError("Выберите один из предложенных вариантов.")
        if "none" in values and len(values) > 1:
            raise CaseInputError("Вариант «Пока ничего» нельзя сочетать с документами.")
        return ",".join(option.value for option in question.options if option.value in values)
    if len(value) > 240:
        raise CaseInputError("Сократите ответ до 240 символов.")
    return value


def applicable(answers: dict) -> list[Question]:
    result = []
    for q in QUESTIONS:
        if q.field == "reported_delay_days" and q.field not in answers:
            continue
        if q.field == "payment_type" and answers.get("work_status") == "working":
            q = replace(q, options=tuple(option for option in q.options if option.value != "settlement"))
        if q.field == "dismissal_date" and answers.get("work_status") != "dismissed":
            continue
        if q.field in {"worked_last_day", "settlement_requested", "settlement_request_date"}:
            if answers.get("payment_type") != "settlement":
                continue
            if q.field in {"settlement_requested", "settlement_request_date"} and answers.get("worked_last_day") != "no":
                continue
            if q.field == "settlement_request_date" and answers.get("settlement_requested") != "yes":
                continue
        if q.field == "due_source" and not answers.get("due_date"):
            continue
        if q.field in {"received_amount", "last_payment_date"} and answers.get("payment_status") not in {"partial", "full"}:
            continue
        result.append(q)
    return result


def validate_consistency(answers: dict) -> None:
    as_of = parse_date(answers["as_of_date"])
    for field in ("dismissal_date", "settlement_request_date", "last_payment_date"):
        if answers.get(field) and parse_date(answers[field]) > as_of:
            raise CaseInputError(f"Поле «{BY_FIELD[field].label}» не может быть позже даты проверки.")
    if answers.get("payment_type") == "settlement" and answers.get("work_status") == "working":
        raise CaseInputError("Вы указали, что ещё работаете. Выберите зарплату либо исправьте статус работы перед разбором расчёта при увольнении.")
    expected, received = answers.get("expected_amount"), answers.get("received_amount")
    if expected and received:
        if Decimal(received) > Decimal(expected):
            raise CaseInputError("Полученная сумма больше ожидаемой. Проверьте суммы: компенсацию за задержку сюда включать не нужно.")
        if answers.get("payment_status") == "partial" and Decimal(received) == Decimal(expected):
            raise CaseInputError("Суммы равны. Если долг погашен, выберите «Вся сумма»; иначе исправьте полученную сумму.")
        if answers.get("payment_status") == "full" and Decimal(received) != Decimal(expected):
            raise CaseInputError("Для полной выплаты суммы должны совпадать. Проверьте сумму или выберите частичную выплату.")


def display_value(field: str, value: str | None) -> str:
    if value is None:
        return "Неизвестно"
    question = BY_FIELD[field]
    if question.kind == "date":
        return date.fromisoformat(value).strftime("%d.%m.%Y")
    if question.kind == "money":
        return f"{Decimal(value):,.2f} ₽".replace(",", " ").replace(".", ",")
    if question.kind in {"choice", "multi"}:
        labels = {option.value: option.label for option in question.options}
        return ", ".join(labels[item] for item in value.split(","))
    return value


def transition(state: dict | None, action: dict, description: str = "") -> dict:
    kind = action["kind"]
    if kind == "start":
        if state is not None:
            raise CaseInputError("Этот сценарий уже начат. Продолжите ответы или создайте новый чат.")
        as_of = normalize(BY_FIELD["as_of_date"], action.get("value") or today().isoformat())
        answers = {"as_of_date": as_of}
        confirmed = False
    else:
        if state is None or state.get("version") != 1:
            raise CaseInputError("Сначала начните сценарий задержки зарплаты.")
        description = state.get("description", "")
        raw = state["answers"]
        if "as_of_date" not in raw or any(field not in BY_FIELD for field in raw):
            raise CaseInputError("Некорректный набор полей сценария.")
        answers = {field: normalize(BY_FIELD[field], value) for field, value in raw.items()}
        confirmed = bool(state.get("confirmed"))
        fields = applicable(answers)
        next_question = next((q for q in fields if q.field not in answers), None)
        if kind in {"answer", "edit"}:
            field = action.get("field")
            if field not in {q.field for q in fields}:
                raise CaseInputError("Этот вопрос сейчас не относится к выбранному сценарию.")
            if kind == "answer" and (next_question is None or field != next_question.field):
                raise CaseInputError("Ответьте на текущий вопрос сценария.")
            if kind == "edit" and field not in answers:
                raise CaseInputError("Это поле ещё не заполнено.")
            value = normalize(BY_FIELD[field], action.get("value"))
            changed = field in answers and answers[field] != value
            answers[field] = value
            if changed:
                clear_dependents(answers, field)
            confirmed = False
        elif kind == "confirm":
            if next_question or answers.get("jurisdiction") == "other":
                raise CaseInputError("Сначала завершите сбор сведений.")
            confirmed = True
        elif kind != "refresh":
            raise CaseInputError("Неизвестное действие сценария.")
    fields = applicable(answers)
    allowed = {q.field for q in fields}
    answers = {field: value for field, value in answers.items() if field in allowed}
    validate_consistency(answers)
    outside = answers.get("jurisdiction") == "other"
    question = None if outside else next((q for q in fields if q.field not in answers), None)
    status = "outside_scope" if outside else "collecting" if question else "complete" if confirmed else "review"
    if status != "complete":
        confirmed = False
    notices = []
    if answers.get("employment_type") in {"civil", "unwritten"}:
        notices.append("Вид отношений требует уточнения: отсутствие письменного трудового договора само по себе не означает отсутствие трудовых прав.")
    if "jurisdiction" in answers and answers["jurisdiction"] is None:
        notices.append("Применимость российского трудового законодательства пока не подтверждена.")
    if answers.get("due_source") in {None, "assumed", "notice"} and "due_date" in answers:
        notices.append("Срок выплаты нужно сверить с документами. Перенос выходных и праздничных дней автоматически не рассчитывается.")
    unknown = [q.label for q in fields if q.field in answers and answers[q.field] is None]
    if unknown:
        notices.append("Неизвестные сведения: " + ", ".join(unknown) + ".")
    as_of = date.fromisoformat(answers["as_of_date"])
    payment_status = answers.get("payment_status")
    delay = None
    if answers.get("due_date") and payment_status in {"none", "partial", "full"}:
        due = date.fromisoformat(answers["due_date"])
        end = date.fromisoformat(answers["last_payment_date"]) if payment_status == "full" and answers.get("last_payment_date") else as_of if payment_status != "full" else None
        delay = max(0, (end - due).days) if end else None
        if due > as_of:
            notices.append("Указанная дата выплаты ещё не наступила на дату проверки.")
    remaining = None
    if payment_status == "full":
        remaining = "0.00"
    elif answers.get("expected_amount") and payment_status == "none":
        remaining = answers["expected_amount"]
    elif answers.get("expected_amount") and answers.get("received_amount") and payment_status == "partial":
        remaining = f"{Decimal(answers['expected_amount']) - Decimal(answers['received_amount']):.2f}"
    return {
        "version": 1, "description": description, "answers": answers, "confirmed": confirmed,
        "status": status, "question": question.json() if question else None,
        "fields": [q.json() for q in fields],
        "progress": {"answered": sum(q.field in answers for q in fields), "total": len(fields)},
        "summary": [{"field": q.field, "label": q.label, "value": display_value(q.field, answers[q.field])} for q in fields if q.field in answers],
        "notices": notices, "metrics": {"delay_days": delay, "remaining_amount": remaining, "as_of_date": as_of.isoformat()},
    }
