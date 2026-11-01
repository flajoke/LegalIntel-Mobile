from typing import Protocol

from app.domain.chat import ChatCommand


class ReplyGenerator(Protocol):
    """Application boundary: replace the stub with a case orchestration service later."""

    async def generate(self, command: ChatCommand) -> str: ...
