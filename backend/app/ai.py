"""Local diagnostics: status is offline; check makes one real, budgeted LLM call."""
import argparse
import asyncio
import json

from app.api.dependencies import get_llm
from app.domain.ai import AIError, StructuredModel


class ConnectionCheck(StructuredModel):
    message: str


async def run(command: str):
    model = get_llm()
    if command == "status":
        print(json.dumps(model.status(), ensure_ascii=False, indent=2))
        return
    result = await model.generate([
        {"role": "system", "content": "Верни JSON по схеме. В поле message напиши: Связь с моделью работает."},
        {"role": "user", "content": "Проверка подключения. Персональных данных нет."},
    ], ConnectionCheck)
    print(json.dumps({"connected": True, "provider": model.provider, "model": model.model,
                      "reply": result.message}, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description="LegalIntel AI connection diagnostics")
    parser.add_argument("command", choices=["status", "check"])
    args = parser.parse_args()
    try:
        asyncio.run(run(args.command))
    except AIError as exc:
        print(json.dumps({"connected": False, "code": exc.code, "message": str(exc)}, ensure_ascii=False))
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
