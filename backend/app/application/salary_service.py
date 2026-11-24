from datetime import datetime, timezone
from uuid import uuid5

from app.domain.cases.salary_delay import transition
from app.infrastructure.knowledge.repository import KnowledgeRepository


class SalaryService:
    def __init__(self, knowledge: KnowledgeRepository):
        self.knowledge = knowledge

    def turn(self, conversation_id, message_id, state: dict | None, action: dict, description: str) -> dict:
        case = transition(state, action, description)
        case["corpus"] = self.knowledge.status()
        case["sources"] = self.knowledge.sources_for(case["answers"]) if case["status"] in {"review", "complete"} else []
        if case["status"] == "outside_scope":
            content = "Этот сценарий посвящён выплатам в рамках работы в России. Для другой страны потребуется отдельный разбор. Если ответ выбран случайно, его можно исправить ниже."
        elif case["question"]:
            content = case["question"]["prompt"]
            if action["kind"] == "start":
                content = "Разберём одну выплату и соберём необходимые сведения. Если чего-то не знаете, так и отметьте.\n\n" + content
        elif case["status"] == "review":
            content = "Сведения собраны. Проверьте даты и суммы ниже: любой ответ можно исправить. Затем подтвердите данные."
        else:
            content = "Данные подтверждены. Ниже — сведения по выплате и нормы по теме. Подборка источников не является правовой оценкой вашей ситуации. Предварительная оценка доступна по кнопке «Посмотреть анализ выплаты»."
        return {"conversation_id": conversation_id, "client_message_id": message_id, "mode": "guided", "case": case,
                "message": {"id": uuid5(conversation_id, str(message_id)), "role": "assistant", "content": content,
                            "created_at": datetime.now(timezone.utc)}}
