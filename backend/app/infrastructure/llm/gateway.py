import asyncio
import json
import socket
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from pydantic import BaseModel, ValidationError

from app import __version__
from app.core.config import Settings
from app.domain.ai import AIError
from app.infrastructure.llm.usage import UsageBudget


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward an Authorization header to a redirect target.


class LLMGateway:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.provider = settings.ai_provider
        self.model = settings.ai_model.strip() or {"groq": "qwen/qwen3.8-27b", "ollama": "qwen3:4b-instruct"}.get(self.provider, "")
        self.base_url = (settings.ai_base_url.strip() or {"groq": "https://api.groq.com/openai/v1", "ollama": "http://127.0.0.1:11434"}.get(self.provider, "")).rstrip("/")
        self.budget = UsageBudget(settings.ai_usage_db, settings.ai_max_calls_per_day)

    def ensure_configured(self) -> None:
        if self.provider == "disabled" or not self.model or not self.base_url:
            raise AIError("ai_not_configured", "AI пока не подключён. Настройте модель на сервере.", 503)
        if self.provider != "ollama" and not self.settings.ai_api_key.get_secret_value().strip():
            raise AIError("ai_not_configured", "Для AI не задан серверный API-ключ. Добавьте ключ в backend/.env или используйте локальную Ollama.", 503)

    def status(self) -> dict:
        try:
            self.ensure_configured()
            configured = True
        except AIError:
            configured = False
        return {"provider": self.provider, "model": self.model, "configured": configured,
                "connection_verified": False, "usage": self.budget.status()}

    async def generate(self, messages: list[dict], schema: type[BaseModel]) -> BaseModel:
        self.ensure_configured()
        # urllib is blocking; the API event loop remains free during inference.
        return await asyncio.to_thread(self._generate, messages, schema)

    def _generate(self, messages: list[dict], schema: type[BaseModel]) -> BaseModel:
        # Identify the application: provider edge filters may reject urllib's default agent.
        headers = {"Content-Type": "application/json", "Accept": "application/json",
                   "User-Agent": f"LegalIntel/{__version__}"}
        json_schema = schema.model_json_schema()
        if self.provider == "ollama":
            path = "/api/chat"
            body = {"model": self.model, "messages": messages, "stream": False,
                    "format": json_schema, "keep_alive": "5m", "options": {
                        "temperature": 0.1, "num_predict": self.settings.ai_max_output_tokens,
                        "num_ctx": self.settings.ai_ollama_context}}
            if "instruct" not in self.model:
                body["think"] = False
        else:
            path = "/chat/completions"
            headers["Authorization"] = "Bearer " + self.settings.ai_api_key.get_secret_value().strip()
            body = {"model": self.model, "messages": messages, "temperature": 0.1,
                    "max_completion_tokens": self.settings.ai_max_output_tokens,
                    "response_format": {"type": "json_schema", "json_schema": {
                        "name": schema.__name__, "strict": True, "schema": json_schema}}}
            if self.provider == "groq" and self.model.startswith("qwen/"):
                body["reasoning_effort"] = "none"
                body["reasoning_format"] = "hidden"
            elif self.provider == "groq" and self.model in {"openai/gpt-oss-20b", "openai/gpt-oss-120b"}:
                body["reasoning_effort"] = "low"
        self.budget.reserve()  # Count attempts too; retries are explicit, never automatic.
        req = Request(self.base_url + path, data=json.dumps(body, ensure_ascii=False).encode(), headers=headers, method="POST")
        try:
            with build_opener(NoRedirect()).open(req, timeout=self.settings.ai_timeout_seconds) as response:
                raw = response.read(256_001)
            if len(raw) > 256_000:
                raise AIError("ai_bad_response", "Модель вернула слишком большой ответ. Попробуйте сократить вопрос.")
            data = json.loads(raw)
            if self.provider == "ollama":
                if data.get("done") is not True or data.get("done_reason") == "length":
                    raise AIError("ai_truncated", "Ответ модели не завершён. Сократите сообщение и повторите запрос.")
                content = data["message"]["content"]
            else:
                choice = data["choices"][0]
                if choice.get("finish_reason") != "stop" or choice["message"].get("refusal"):
                    raise AIError("ai_incomplete", "Модель не смогла завершить ответ в требуемом формате. Переформулируйте сообщение.")
                content = choice["message"]["content"]
            if not isinstance(content, str):
                raise ValueError("Expected JSON text")
            return schema.model_validate(json.loads(content))
        except HTTPError as exc:
            # Provider bodies may echo personal inputs. Do not log or expose them.
            if exc.code == 429:
                raise AIError("ai_provider_limit", "Лимит запросов модели временно исчерпан. Подождите минуту и повторите; также проверьте дневной лимит аккаунта.", 429) from None
            if exc.code in {401, 403}:
                raise AIError("ai_access", "Модель отклонила доступ. Проверьте серверный API-ключ и доступность выбранной модели для аккаунта.", 503) from None
            if exc.code in {400, 404, 422}:
                raise AIError("ai_model_config", "Не удалось обратиться к выбранной модели. Проверьте её имя и поддержку JSON Schema; для Ollama проверьте, что модель скачана.", 503) from None
            raise AIError("ai_provider_error", "Сервис модели временно недоступен. Попробуйте позже.", 502) from None
        except (TimeoutError, socket.timeout):
            raise AIError("ai_timeout", "Модель не ответила вовремя. Для локальной модели проверьте ресурсы компьютера; запрос можно повторить.", 504) from None
        except URLError:
            raise AIError("ai_connection", "Нет соединения с моделью. Проверьте интернет или запуск Ollama.", 503) from None
        except (ValueError, KeyError, IndexError, TypeError, AttributeError, ValidationError):
            raise AIError("ai_bad_response", "Не удалось проверить структуру ответа модели. Сведения не изменены; попробуйте уточнить сообщение.") from None
