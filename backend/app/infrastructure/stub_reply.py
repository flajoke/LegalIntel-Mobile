from app.domain.chat import ChatCommand


class StubReplyGenerator:
    async def generate(self, command: ChatCommand) -> str:
        # Deliberately no keyword-based legal reasoning, model, network calls or storage.
        return "Сообщение получено. Сейчас я отвечаю в демонстрационном режиме."
