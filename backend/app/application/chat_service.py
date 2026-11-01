from datetime import datetime, timezone
from uuid import uuid5

from app.domain.chat import ChatCommand, ChatReply
from app.domain.ports import ReplyGenerator


class ChatService:
    def __init__(self, replies: ReplyGenerator) -> None:
        self._replies = replies

    async def reply(self, command: ChatCommand) -> ChatReply:
        content = await self._replies.generate(command)
        return ChatReply(
            # Stable ID lets the client de-duplicate a manual retry. This is NOT
            # durable server-side idempotency, which will require a repository.
            id=uuid5(command.conversation_id, str(command.client_message_id)),
            content=content,
            created_at=datetime.now(timezone.utc),
        )
