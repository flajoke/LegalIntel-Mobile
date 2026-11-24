"""User-reviewable templates, never an autonomous submission or a legal verdict."""
from datetime import date
from decimal import Decimal
import re

from app.domain.cases.salary_delay import CaseInputError, parse_date

TEMPLATE_VERSION = "salary-letters-v1"
TITLES = {
    "employer": "Заявление о проверке и выплате причитающихся сумм",
    "labor_inspectorate": "Обращение о проверке соблюдения трудовых прав",
}
PLACEHOLDER = re.compile(r"\[Укажите[^\]\n]*\]", re.IGNORECASE)


def clean_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if any(not ch.isprintable() and ch not in "\n\t" for ch in text):
        raise CaseInputError("Удалите из документа непечатаемые символы.")
    return text


def validate_export(text: str) -> str:
    text = clean_text(text)
    if not 80 <= len(text) <= 30000:
        raise CaseInputError("Текст обращения должен содержать от 80 до 30000 символов.")
    if PLACEHOLDER.search(text):
        raise CaseInputError("Перед экспортом заполните все пропуски вида [Укажите ...] в тексте обращения.")
    return text


def rubles(value: str) -> str:
    return f"{Decimal(value):,.2f}".replace(",", " ").replace(".", ",") + " руб."


def build_letter(case: dict, details: dict, template: str, analysis: dict) -> dict:
    if template not in TITLES:
        raise CaseInputError("Неизвестный шаблон обращения.")
    if not case["confirmed"] or case["status"] != "complete":
        raise CaseInputError("Сначала завершите анкету и подтвердите сведения.")
    answers = case["answers"]
    if answers.get("jurisdiction") != "russia" or answers.get("employment_type") != "employment":
        raise CaseInputError("Эти шаблоны предназначены для подтверждённых сведений о трудовом договоре и работе в России. При ГПХ или неоформленной работе нужен отдельный разбор.")
    document_date = parse_date(details["document_date"])
    if not 1900 <= document_date.year <= 2100:
        raise CaseInputError("Проверьте дату обращения.")
    details = {key: clean_text(value) if isinstance(value, str) else value for key, value in details.items()}
    missing = []

    def field(key, label):
        value = details.get(key, "")
        if not value:
            missing.append(label)
            return f"[Укажите {label}]"
        return value

    employer = field("employer_name", "наименование работодателя")
    employer_address = field("employer_address", "адрес работодателя")
    applicant = field("applicant_name", "ФИО заявителя")
    address = field("applicant_address", "почтовый адрес заявителя для ответа")
    recipient = employer if template == "employer" else field("inspectorate_name", "наименование территориальной инспекции труда")
    lines = [f"Кому: {recipient}"]
    if template == "employer":
        lines.append(f"Адрес: {employer_address}")
    lines += [f"От: {applicant}", f"Почтовый адрес: {address}"]
    if details["applicant_contact"]:
        lines.append("Контактные данные: " + details["applicant_contact"])
    lines += ["", TITLES[template], ""]
    relation = "Я работаю у работодателя" if answers.get("work_status") == "working" else "Я состоял(а) в трудовых отношениях с работодателем" if answers.get("work_status") == "dismissed" else "Я состою или состоял(а) в трудовых отношениях с работодателем"
    intro = f"{relation} {employer} на основании трудового договора."
    if details["job_title"]:
        intro += " Должность: " + details["job_title"] + "."
    if answers.get("work_status") == "dismissed" and answers.get("dismissal_date"):
        intro += " Дата увольнения: " + date.fromisoformat(answers["dismissal_date"]).strftime("%d.%m.%Y") + "."
    if template == "labor_inspectorate":
        intro += " Адрес работодателя: " + employer_address + "."
    lines += [intro, ""]
    kind = "расчёт при увольнении" if answers.get("payment_type") == "settlement" else "зарплата или аванс" if answers.get("payment_type") == "salary" else "выплата, причитающаяся в связи с работой"
    lines += ["Обращение касается следующей выплаты: " + kind + (". Период: " + answers["period"] if answers.get("period") else "") + ".", ""]
    if analysis["status"] in {"possible_delay", "paid_late", "no_delay_detected"} and analysis["deadline"]["date"]:
        lines += ["По предоставленным мной сведениям срок выплаты с учётом графика: " + date.fromisoformat(analysis["deadline"]["date"]).strftime("%d.%m.%Y") + ".", ""]
    elif answers.get("due_date"):
        lines += ["Известная мне дата выплаты: " + date.fromisoformat(answers["due_date"]).strftime("%d.%m.%Y") + ". Прошу сверить установленный срок с документами и графиком работы, включая выходные и праздники.", ""]
    else:
        lines += ["Установленный срок выплаты мне необходимо уточнить. Прошу сообщить срок и документы, которыми он предусмотрен.", ""]
    amount = "По моим сведениям сумма к получению после удержаний составляет " + rubles(answers["expected_amount"]) + "." if answers.get("expected_amount") else "Сумма к получению после удержаний требует уточнения по документам о начислениях."
    payment_status = answers.get("payment_status")
    if payment_status == "none":
        amount += " По состоянию на " + date.fromisoformat(answers["as_of_date"]).strftime("%d.%m.%Y") + " эта выплата не поступила."
    elif payment_status == "partial":
        amount += " Выплата поступила частично."
        if answers.get("received_amount"): amount += " Получено: " + rubles(answers["received_amount"]) + "."
        if case["metrics"]["remaining_amount"]: amount += " По моим данным остаток: " + rubles(case["metrics"]["remaining_amount"]) + "."
    elif payment_status == "full":
        amount += " Основная сумма выплачена полностью. Настоящее обращение касается проверки сроков, расчётов и, при наличии оснований, компенсации."
    else:
        amount += " Объём фактически произведённых выплат требует сверки."
    if answers.get("last_payment_date"):
        amount += " Последнее поступление: " + date.fromisoformat(answers["last_payment_date"]).strftime("%d.%m.%Y") + "."
    lines += [amount, ""]
    contact = answers.get("employer_contact")
    if contact in {"written", "oral"}:
        lines += ["Ранее я обращался(ась) к работодателю " + ("письменно" if contact == "written" else "устно") + " по поводу этой выплаты.", ""]
    if details["additional_facts"]:
        lines += [details["additional_facts"], ""]
    source_ids = ["tk-140" if answers.get("payment_type") == "settlement" else "tk-136", "tk-62"]
    if template == "employer":
        lines += ["Прошу:", "1. Проверить изложенные сведения и сообщить начисленные суммы, удержания, сроки и фактические даты выплат."]
        if payment_status != "full":
            lines += ["2. При подтверждении задолженности выплатить причитающиеся мне неполученные суммы."]
        if details["request_compensation"]:
            number = 2 if payment_status == "full" else 3
            lines += [f"{number}. При подтверждении оснований рассчитать и выплатить денежную компенсацию по статье 236 ТК РФ с учётом фактических дат и сумм выплат."]
            source_ids.append("tk-236")
        lines += ["Предоставить связанные с указанной выплатой расчётные листки и заверенные копии документов о начислении и выплате в порядке статьи 62 ТК РФ."]
    else:
        lines += ["Прошу рассмотреть обращение в пределах компетенции государственной инспекции труда, проверить соблюдение работодателем сроков и порядка выплаты причитающихся мне сумм и при наличии оснований принять предусмотренные законом меры реагирования."]
        source_ids += ["tk-352", "tk-356"]
        if details["request_compensation"]:
            lines += ["Прошу также проверить соблюдение обязанности работодателя по выплате денежной компенсации при наличии оснований, предусмотренных статьёй 236 ТК РФ."]
            source_ids.append("tk-236")
    lines += ["", f"Ответ прошу направить по почтовому адресу: {address}."]
    if details["attachments"]:
        lines += ["", "Приложения", details["attachments"]]
    lines += ["", "Дата: " + document_date.strftime("%d.%m.%Y"), "Подпись: ____________________ / " + applicant + " /"]
    text = "\n".join(lines)
    if len(text) > 30000:
        raise CaseInputError("Черновик получился слишком длинным. Сократите дополнительные сведения и реквизиты.")
    warnings = ["Проверьте факты, реквизиты и текст перед экспортом. Файл сам по себе не подаёт обращение; для бумажной подачи нужна ваша подпись.",
                "Перечень приложений не прикрепляет файлы. При подаче приложите документы самостоятельно."]
    if analysis["status"] not in {"possible_delay", "paid_late", "no_delay_detected"}:
        warnings.append("Автоматическая оценка не завершена или требует проверки. Шаблон просит сверить факты и не утверждает наличие нарушения.")
    if template == "labor_inspectorate":
        warnings.append("Для электронной подачи используйте официальный сервис с идентификацией, например «Онлайнинспекция.рф» или Госуслуги. Экспорт файла и отправка обычного email не заменяют подачу через такой сервис.")
    return {"title": TITLES[template], "text": text, "missing": list(dict.fromkeys(missing)), "warnings": warnings,
            "source_ids": list(dict.fromkeys(source_ids)), "template_version": TEMPLATE_VERSION}
