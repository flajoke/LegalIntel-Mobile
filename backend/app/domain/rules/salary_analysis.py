"""Bounded, deterministic checks for ONE Russian employment payment.

The existing collector remains the authority for normalization/confirmation.
This module never calls a model, mutates answers, or treats unknown facts as true.
"""
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

from app.domain.cases.salary_delay import CaseInputError, parse_date

FORMULA = "Сумма долга × ключевая ставка / 100 / 150 × календарные дни"
HOLIDAYS = {"01-01", "01-02", "01-03", "01-04", "01-05", "01-06", "01-07", "01-08", "02-23", "03-08", "05-01", "05-09", "06-12", "11-04"}


def money(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def workday(day: date, reference: dict) -> bool | None:
    calendar = reference["calendar"]["years"].get(str(day.year))
    if calendar is None:
        return None
    key = day.strftime("%m-%d")
    if key in calendar["extra_workdays"]:
        return True
    return day.weekday() < 5 and key not in HOLIDAYS and key not in calendar["extra_days_off"]


def payments_for(answers: dict, options: dict) -> list[tuple[date, Decimal]]:
    result = []
    as_of = parse_date(answers["as_of_date"])
    for item in options.get("payments", []):
        day, amount = parse_date(item["date"]), Decimal(item["amount"])
        if amount <= 0 or amount > Decimal("1000000000") or amount.as_tuple().exponent < -2:
            raise CaseInputError("Каждая выплата должна быть больше нуля, не больше 1 000 000 000 ₽ и содержать не более двух знаков после запятой.")
        if day > as_of:
            raise CaseInputError("Дата выплаты не может быть позже даты проверки.")
        result.append((day, amount))
    if result and answers.get("payment_status") == "none":
        raise CaseInputError("В анкете указано, что выплат не было. Сначала исправьте статус выплаты в сведениях по кейсу.")
    if options.get("payment_history_complete"):
        status = answers.get("payment_status")
        if status not in {"partial", "full"}:
            if result:
                raise CaseInputError("Для истории выплат сначала укажите частичную или полную выплату в анкете.")
        else:
            if not result or not answers.get("received_amount") or not answers.get("last_payment_date"):
                raise CaseInputError("Для полной истории нужны суммы и даты выплат, а также общая полученная сумма и дата последней выплаты в анкете.")
            if sum((amount for _, amount in result), Decimal(0)) != Decimal(answers["received_amount"]):
                raise CaseInputError("Сумма выплат в истории должна совпадать с полем «Получено» в анкете.")
            if max(day for day, _ in result) != parse_date(answers["last_payment_date"]):
                raise CaseInputError("Последняя дата в истории должна совпадать с датой последней выплаты в анкете.")
    return sorted(result)


def resolve_deadline(answers: dict, options: dict, reference: dict) -> tuple[date | None, str, list[str], str | None]:
    mode = options["deadline_mode"]
    entered = parse_date(answers["due_date"]) if answers.get("due_date") else None
    if answers.get("payment_type") == "settlement":
        dismissal = parse_date(answers["dismissal_date"]) if answers.get("dismissal_date") else None
        if not dismissal:
            return None, "Расчёт при увольнении: ст. 140 ТК РФ.", ["Уточните дату увольнения."], None
        if answers.get("worked_last_day") == "yes":
            due = dismissal
            basis = "Работали в день увольнения: срок расчёта — день увольнения (ст. 140 ТК РФ)."
        elif answers.get("worked_last_day") == "no":
            if answers.get("settlement_requested") != "yes" or not answers.get("settlement_request_date"):
                return None, "Если в день увольнения не работали, нужен факт предъявления требования о расчёте.", ["Уточните предъявление требования о расчёте и его дату."], None
            request = parse_date(answers["settlement_request_date"])
            if request < dismissal:
                return None, "Даты увольнения и требования противоречат друг другу.", ["Сверьте дату требования: она раньше увольнения."], None
            due = request + timedelta(days=1)
            basis = "По ст. 140 ТК РФ — не позднее следующего дня после требования о расчёте."
            calendar_confirmed = (mode == "already_adjusted" and entered == due) or (mode == "federal_five_day" and workday(due, reference) is True)
            if not calendar_confirmed:
                return None, basis, ["Подтвердите срок после требования по графику работодателя: укажите уже скорректированную дату в анкете либо выберите федеральную пятидневку. При нерабочем дне нужна отдельная проверка; перенос назад не применяется."], None
        else:
            return None, "Срок зависит от работы в день увольнения.", ["Уточните, работали ли вы в день увольнения."], None
        if entered and entered != due:
            return None, basis, ["Срок выплаты в анкете отличается от срока по ст. 140 ТК РФ. Сверьте даты и график с юристом."], None
        return due, basis, [], None
    if answers.get("payment_type") != "salary":
        return None, "Вид выплаты не установлен.", ["Уточните вид выплаты."], None
    if not entered:
        return None, "Нужен установленный срок конкретной выплаты.", ["Уточните установленную дату выплаты; длительность задержки со слов её не заменяет."], None
    if answers.get("due_source") not in {"contract", "rules"}:
        return None, "Срок проверяется по договору, правилам внутреннего распорядка или коллективному договору.", ["Подтвердите срок договором или локальными правилами; оценка и сообщение работодателя сами по себе недостаточны."], None
    if mode == "unverified":
        return None, "Срок из анкеты ещё не проверен с учётом нерабочих дней.", ["Уточните, учитывает ли срок выходные и праздники, или выберите расчёт по федеральной пятидневке."], None
    if mode == "already_adjusted":
        return entered, "Использован подтверждённый вами срок с учётом графика и нерабочих дней (ст. 136 ТК РФ).", [], None
    due = entered
    while workday(due, reference) is False:
        due -= timedelta(days=1)
    if workday(due, reference) is None:
        return None, "Календарь для этого года отсутствует.", ["Для этого года нет проверенного календаря; укажите уже скорректированный срок."], None
    return due, "Дата из анкеты принята как исходная и перенесена на предшествующий рабочий день по федеральной пятидневке (ст. 136 ТК РФ). Региональные праздники и особый график не учитываются.", [], reference["calendar"]["source_url"]


def compensation(answers: dict, options: dict, due: date | None, payments: list, reference: dict, eligible: bool, days: int | None) -> dict:
    rates = reference["rates"]
    result = {"status": "unavailable", "amount": None, "explanation": "Для расчёта недостаточно подтверждённых условий.",
              "formula": FORMULA, "segments": [], "missing": [], "rate_source_url": rates["source_url"],
              "rates_checked_through": rates["valid_through"]}
    if not eligible or due is None or days is None:
        result["missing"] = ["Сначала подтвердите применимость правил и срок выплаты."]
        return result
    if days == 0:
        result.update(status="not_needed", amount="0.00", explanation="По установленным датам дней задержки не выявлено. Это не проверка всех обязательств работодателя.")
        return result
    if options["amount_basis"] != "accrued":
        result["missing"].append("Подтвердите, что сумма начислена работодателем. Для неначисленной или спорной суммы требуется отдельная оценка, в том числе судебного признания права.")
    if not answers.get("expected_amount"):
        result["missing"].append("Уточните сумму к получению после удержаний.")
    status = answers.get("payment_status")
    if status in {"partial", "full"} and not options["payment_history_complete"]:
        result["missing"].append("Укажите все выплаты по этой сумме с датами и подтвердите полноту истории. Общей полученной суммы и последней даты недостаточно.")
    end = parse_date(answers["last_payment_date"]) if status == "full" and answers.get("last_payment_date") else parse_date(answers["as_of_date"])
    start = due + timedelta(days=1)
    if start < parse_date(rates["valid_from"]) or end > parse_date(rates["valid_through"]):
        result["missing"].append("Проверенные ставки Банка России не покрывают весь период. Текущая ставка не подставляется за прошлые даты.")
    if result["missing"]:
        return result
    periods = [(parse_date(item["from"]), Decimal(item["percent"])) for item in rates["periods"]]
    principal, total = Decimal(answers["expected_amount"]), Decimal(0)
    by_date = {}
    for day, amount in payments:
        by_date[day] = by_date.get(day, Decimal(0)) + amount
    principal -= sum((amount for day, amount in payments if day <= due), Decimal(0))
    segments = []
    for offset in range((end - start).days + 1):
        day = start + timedelta(days=offset)
        valid_rates = [rate for since, rate in periods if since <= day]
        if not valid_rates:
            result["missing"] = ["В истории ставок есть пробел. Требуется обновить справочник."]
            return result
        rate = valid_rates[-1]
        if principal > 0:
            value = principal * rate / Decimal(100) / Decimal(150)
            total += value
            if segments and segments[-1]["principal"] == money(principal) and segments[-1]["rate_percent"] == str(rate):
                segment = segments[-1]
                segment["end"], segment["days"] = day.isoformat(), segment["days"] + 1
                segment["raw"] += value
            else:
                segments.append({"start": day.isoformat(), "end": day.isoformat(), "days": 1,
                                 "principal": money(principal), "rate_percent": str(rate), "raw": value})
        # The payment day is included. Reduce principal only AFTER that day's interest.
        principal -= by_date.get(day, Decimal(0))
        if principal < 0:
            raise CaseInputError("История выплат превышает сумму к получению.")
    for segment in segments:
        segment["amount"] = money(segment.pop("raw"))
    result.update(status="calculated", amount=money(total), segments=segments,
                  explanation="Ориентировочный законный минимум по ст. 236 ТК РФ для указанной начисленной суммы. Учтены календарные дни, изменения ставки и день каждой выплаты включительно. Итог округлён один раз; округлённые строки могут отличаться на копейки. Повышенная компенсация по договору не учтена; результат не определяет остаток уже выплаченной компенсации.")
    return result


def evaluate(case: dict, options: dict, reference: dict, sources_valid: bool = True) -> dict:
    answers = case["answers"]
    as_of = parse_date(answers["as_of_date"])
    payments = payments_for(answers, options)
    findings, missing, lawyer = [], [], []
    facts = {item["field"]: {"label": item["label"], "value": item["value"]} for item in case["summary"]}

    def finding(id, title, status, explanation, fields=(), sources=()):
        findings.append({"id": id, "title": title, "status": status, "explanation": explanation,
                         "facts": [facts[field] for field in fields if field in facts], "source_ids": list(sources)})

    confirmed = case["confirmed"] and case["status"] == "complete"
    relation = answers.get("jurisdiction") == "russia" and answers.get("employment_type") == "employment"
    in_period = parse_date(reference["valid_from"]) <= as_of <= parse_date(reference["checked_through"])
    historical_dates = [parse_date(answers[key]) for key in ("due_date", "dismissal_date", "settlement_request_date", "last_payment_date") if answers.get(key)]
    if any(day < parse_date(reference["valid_from"]) for day in historical_dates) or any(day < parse_date(reference["valid_from"]) for day, _ in payments):
        in_period = False
    if not confirmed:
        missing.append("Завершите анкету и подтвердите сведения. Неподтверждённые предложения AI в оценке не используются.")
    if answers.get("jurisdiction") not in {"russia", "other"}:
        missing.append("Подтвердите, что работа относится к российской юрисдикции.")
    if answers.get("employment_type") != "employment":
        missing.append("Уточните наличие трудовых отношений; ГПХ и отсутствие письменного договора автоматически не квалифицируются.")
        lawyer.append("Вид отношений требует оценки: отсутствие письменного договора не исключает трудовых прав, а ГПХ может потребовать признания отношений трудовыми.")
    finding("employment", "Применимость трудовых норм", "supports" if relation else "missing",
            "Правила применяются предварительно исходя из указанного трудового договора и работы в России." if relation else "Автоматическое применение правил возможно после уточнения юрисдикции и трудовых отношений.",
            ("jurisdiction", "employment_type"), ("tk-16", "tk-19.1", "tk-67") if answers.get("employment_type") != "employment" else ("tk-16", "tk-67"))
    due, basis, deadline_missing, calendar_url = resolve_deadline(answers, options, reference)
    if due and due < parse_date(reference["valid_from"]):
        in_period = False
    missing.extend(deadline_missing)
    finding("deadline", "Установленный срок выплаты", "supports" if due else "missing", basis,
            ("payment_type", "due_date", "due_source", "dismissal_date", "worked_last_day", "settlement_request_date"),
            ("tk-140",) if answers.get("payment_type") == "settlement" else ("tk-136",))
    if not in_period or not sources_valid:
        missing.append("Требуется проверка редакций: период случая или состав источников не покрывается этой версией правил.")
        lawyer.append("Нужна проверка редакций законодательства на даты событий. Система не переносит текущие правила на неподдерживаемый период.")
    finding("edition", "Редакция правил и источников", "info" if in_period and sources_valid else "attention",
            f"Технически сверенные тексты и правила для периода {reference['valid_from']} — {reference['checked_through']}. Юридическая экспертиза правил ещё не проведена." if in_period and sources_valid else "Для выбранных дат или изменившихся источников автоматическая оценка заблокирована. Нужна проверенная редакция.")
    eligible = confirmed and relation and in_period and sources_valid
    payment_status = answers.get("payment_status")
    days = None
    if due and payment_status in {"none", "partial", "full"}:
        end = parse_date(answers["last_payment_date"]) if payment_status == "full" and answers.get("last_payment_date") else as_of if payment_status != "full" else None
        if end:
            days = max(0, (end - due).days)
        else:
            missing.append("Уточните дату окончательного расчёта: полная выплата не исключает прежнюю задержку.")
    elif payment_status not in {"none", "partial", "full"}:
        missing.append("Уточните, была ли выплата полной, частичной или отсутствовала.")
    remaining = case["metrics"]["remaining_amount"]
    if payment_status == "partial" and (not answers.get("expected_amount") or not answers.get("received_amount")):
        missing.append("Для частичной выплаты уточните ожидаемую и полученную суммы.")
    assessed = eligible and due is not None and days is not None
    if answers.get("jurisdiction") == "other":
        status, title, summary = "outside_scope", "Нужен разбор по праву другой страны", "Этот движок проверяет одну выплату в рамках трудовых отношений в России."
    elif not confirmed:
        status, title, summary = "needs_confirmation", "Сначала подтвердите сведения", "Оценка появится после завершения и подтверждения анкеты."
    elif not in_period or not sources_valid or answers.get("employment_type") in {"civil", "unwritten"}:
        status, title, summary = "needs_review", "Нужна дополнительная правовая проверка", "Собранных сведений недостаточно для применения текущих правил без индивидуального разбора."
    elif not assessed or (payment_status == "partial" and remaining is None):
        status, title, summary = "needs_facts", "Недостаточно подтверждённых условий", "Уточните сведения ниже. Неизвестное не считается отсутствием нарушения."
    elif days > 0:
        status = "paid_late" if payment_status == "full" else "possible_delay"
        title = "Выплата поступила с признаками задержки" if payment_status == "full" else "Есть признаки задержки выплаты"
        summary = f"По подтверждённым вами данным после установленного срока прошло {days} календарных дней." + (" Основная сумма выплачена полностью; вопрос компенсации проверяется отдельно." if payment_status == "full" else " Оценка относится только к одной указанной выплате.")
    else:
        status, title, summary = "no_delay_detected", "По указанным датам задержка не выявлена", "На дату проверки установленный срок ещё не прошёл либо полная выплата поступила вовремя. Это не вывод об отсутствии любых нарушений."
    finding("payment", "Сопоставление срока и выплаты", "attention" if assessed and days and days > 0 else "info" if assessed else "missing",
            summary if assessed else "Длительность со слов пользователя не заменяет срок выплаты; неизвестная дата полной выплаты не считается своевременным расчётом.",
            ("payment_status", "expected_amount", "received_amount", "last_payment_date", "as_of_date"),
            ("tk-140", "tk-236") if answers.get("payment_type") == "settlement" else ("tk-136", "tk-236"))
    comp = compensation(answers, options, due, payments, reference, assessed, days)
    missing.extend(comp["missing"] if assessed and days and days > 0 else [])
    if assessed and days and days > 15 and answers.get("work_status") == "working":
        finding("suspension", "Задержка более 15 дней", "attention",
                "Ст. 142 ТК РФ содержит отдельные условия и исключения: письменное извещение, специальные режимы, госслужба, оборона, опасные производства и обеспечение жизнедеятельности. Эти условия анкета не проверяет; разрешение приостановить работу система не выдаёт.",
                ("work_status",), ("tk-142",))
        lawyer.append("Перед решением о приостановлении работы проверьте с юристом все условия и исключения ст. 142 ТК РФ. Самостоятельный уход с работы может иметь последствия.")
    if due and due <= as_of and (as_of - due).days >= 335:
        finding("court_term", "Проверьте срок обращения в суд", "attention",
                "По общему правилу ст. 392 ТК РФ по невыплате предусмотрен один год со дня установленного срока выплаты. Дата подачи, нерабочие дни и возможность восстановления требуют отдельной оценки; система не объявляет срок пропущенным.", sources=("tk-392",))
        lawyer.append("С установленного срока выплаты прошло около года или больше. Срочно уточните срок обращения в суд и основания его восстановления.")
    if options["amount_basis"] == "unknown" and assessed and days and days > 0:
        lawyer.append("Если работодатель не начислил сумму или спорит с правом на неё, нужна отдельная оценка оснований взыскания и компенсации.")
    steps = [{"id": "verify", "title": "Сверьте документы и сведения", "text": "Проверьте срок, сумму после удержаний и фактические поступления. Ошибки исправляются в карточке сведений, после изменения нужно снова подтвердить анкету.", "source_ids": ["tk-136", "tk-62"]}]
    if status in {"possible_delay", "paid_late"}:
        steps.append({"id": "employer", "title": "Зафиксируйте обращение к работодателю", "text": "Сохраните письменный запрос о выплате и компенсации и подтверждение его получения. Если уже обращались письменно, сохраните обращение и ответ.", "source_ids": ["tk-236", "tk-352"]})
        steps.append({"id": "protection", "title": "Рассмотрите способы защиты права", "text": "Можно обратиться в государственную инспекцию труда или суд. Выбор способа и сроков зависит от документов и спорных обстоятельств; обращение к работодателю или в инспекцию не следует считать автоматическим продлением судебного срока.", "source_ids": ["tk-352", "tk-356", "tk-392"]})
    elif status in {"needs_review", "needs_facts", "needs_confirmation"}:
        steps.append({"id": "clarify", "title": "Уточните недостающие условия", "text": "Начните с пунктов раздела «Что уточнить». Правовую оценку не стоит строить на предположениях о договоре, сроке или сумме.", "source_ids": ["tk-16", "tk-136"]})
    documents = [
        {"id": "employment", "title": "Документы о работе", "text": "Трудовой договор, приказ, сведения о трудовой деятельности; при отсутствии оформления — подтверждения фактической работы.", "source_ids": ["tk-16", "tk-67", "tk-62"]},
        {"id": "deadline", "title": "Подтверждение срока и начислений", "text": "Правила внутреннего распорядка, коллективный или трудовой договор, расчётные листки; при увольнении — приказ и требование о расчёте.", "source_ids": ["tk-136", "tk-140", "tk-62"]},
        {"id": "payments", "title": "История поступлений и переписка", "text": "Банковские выписки или документы о наличных выплатах с датами и суммами, письменные обращения, ответы и подтверждения получения.", "source_ids": ["tk-352", "tk-62"]},
    ]
    if answers.get("payment_type") != "settlement":
        documents[1]["text"] = "Правила внутреннего распорядка, коллективный или трудовой договор с датами выплаты, расчётные листки с начислениями и удержаниями."
        documents[1]["source_ids"] = ["tk-136", "tk-62"]
    missing = list(dict.fromkeys(missing))
    quality = "sufficient" if assessed and not missing else "limited" if assessed else "insufficient"
    return {"status": status, "title": title, "summary": summary, "as_of_date": as_of.isoformat(),
            "data_quality": quality, "data_quality_explanation": "Это полнота сведений для выбранных проверок, а не вероятность выигрыша. Документы и фактические обстоятельства система не удостоверяет.",
            "missing": missing, "findings": findings,
            "deadline": {"date": due.isoformat() if due else None, "basis": basis, "delay_days": days if eligible else None, "calendar_source_url": calendar_url},
            "remaining_amount": remaining if eligible else None, "compensation": comp,
            "next_steps": [] if status == "outside_scope" else steps,
            "documents": [] if status == "outside_scope" else documents,
            "lawyer_reasons": list(dict.fromkeys(lawyer)),
            "rules": {key: reference[key] for key in ("version", "valid_from", "checked_through", "legal_reviewed")},
            "limitations": ["Проверяется одна выплата и только введённые сведения. Особые категории работников, региональные праздники, спор о начислении и специальные правовые режимы требуют отдельной проверки.",
                            "Размер штрафа, состав административного или уголовного правонарушения и исход дела автоматически не устанавливаются.",
                            "Правила прошли техническую проверку; юридическая экспертиза перед публичным использованием ещё необходима."],
            "disclaimer": "Предварительная справочная оценка по вашим данным. Она не заменяет индивидуальную юридическую консультацию и проверку документов."}
