import asyncio
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from uuid import uuid4

from app.infrastructure.accounts import AccountError, AccountRepository, password_hash, password_matches


def empty_state():
    return {"version": 3, "conversations": [], "activeId": None, "newDraft": "", "settings": {"apiUrl": "", "theme": "system"}}


class AccountDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.clock = [1800000000]
        self.repo = AccountRepository(Path(self.temp.name) / "accounts.sqlite3", now=lambda: self.clock[0])

    def tearDown(self): self.temp.cleanup()

    def test_password_salted_and_verified(self):
        first, second = password_hash("Test-password-2026"), password_hash("Test-password-2026")
        self.assertNotEqual(first, second)
        self.assertTrue(password_matches("Test-password-2026", first))
        self.assertFalse(password_matches("other-password", first))

    def test_case_insensitive_login_and_duplicate(self):
        user = self.repo.register("Tester", "Test-password-2026")
        self.assertEqual(self.repo.login("TESTER", "Test-password-2026")["id"], user["id"])
        with self.assertRaises(AccountError) as caught: self.repo.register("tester", "Different-pass-2026")
        self.assertEqual(caught.exception.status, 409)

    def test_token_stored_only_as_hash(self):
        user = self.repo.register("tester", "Test-password-2026")
        token, _ = self.repo.create_session(user["id"])
        self.assertEqual(self.repo.authenticate(token)["id"], user["id"])
        with self.repo.connection() as db:
            dump = "\n".join(db.iterdump())
        self.assertNotIn(token, dump)
        self.assertNotIn("Test-password-2026", dump)

    def test_expiry_and_logout(self):
        user = self.repo.register("tester", "Test-password-2026")
        first, _ = self.repo.create_session(user["id"])
        second, _ = self.repo.create_session(user["id"])
        self.repo.logout(first)
        with self.assertRaises(AccountError): self.repo.authenticate(first)
        self.assertEqual(self.repo.authenticate(second)["id"], user["id"])
        self.clock[0] += 31 * 86400
        with self.assertRaises(AccountError): self.repo.authenticate(second)

    def test_ownership_and_revision_conflict(self):
        a = self.repo.register("alice", "Test-password-2026")
        b = self.repo.register("bob", "Test-password-2026")
        data = empty_state(); data["newDraft"] = "private to alice"
        self.repo.write_state(a["id"], 0, data)
        self.assertIsNone(self.repo.read_state(b["id"])["state"])
        with self.assertRaises(AccountError) as caught: self.repo.write_state(a["id"], 0, empty_state())
        self.assertEqual(caught.exception.code, "sync_conflict")
        self.assertEqual(self.repo.read_state(a["id"])["state"], data)

    def test_restart_preserves_accounts_and_state(self):
        user = self.repo.register("tester", "Test-password-2026")
        self.repo.write_state(user["id"], 0, empty_state())
        other = AccountRepository(self.repo.path, now=lambda: self.clock[0])
        self.assertEqual(other.login("tester", "Test-password-2026")["id"], user["id"])
        self.assertEqual(other.read_state(user["id"])["revision"], 1)

    def test_concurrent_writers_do_not_clobber(self):
        from concurrent.futures import ThreadPoolExecutor
        user = self.repo.register("tester", "Test-password-2026")
        def write(label):
            state = empty_state(); state["newDraft"] = label
            try: return self.repo.write_state(user["id"], 0, state)["revision"]
            except AccountError as exc: return exc.code
        with ThreadPoolExecutor(max_workers=2) as executor:
            result = list(executor.map(write, ("first", "second")))
        self.assertCountEqual(result, [1, "sync_conflict"])

    def test_login_rate_limit(self):
        self.repo.register("tester", "Test-password-2026")
        for _ in range(8):
            with self.assertRaises(AccountError): self.repo.login("tester", "wrong-password")
        with self.assertRaises(AccountError) as caught: self.repo.login("tester", "Test-password-2026")
        self.assertEqual(caught.exception.status, 429)
        self.clock[0] += 601
        self.assertEqual(self.repo.login("tester", "Test-password-2026")["username"], "tester")


try:
    import httpx
except ImportError:
    httpx = None


@unittest.skipIf(httpx is None, "Install requirements-dev.txt for in-process ASGI tests; no server is started")
class AccountASGITests(unittest.IsolatedAsyncioTestCase):
    """HTTP semantics through ASGITransport: no Uvicorn, no listening port."""
    async def asyncSetUp(self):
        from app.main import app
        from app.api.auth import get_accounts
        from app.api.dependencies import get_knowledge
        from app.infrastructure.knowledge.repository import KnowledgeRepository
        self.temp = TemporaryDirectory()
        self.repo = AccountRepository(Path(self.temp.name) / "accounts.sqlite3")
        self.knowledge = KnowledgeRepository(Path(self.temp.name) / "knowledge.sqlite3", Path(__file__).resolve().parents[1] / "knowledge")
        self.knowledge.rebuild()
        self.app = app
        app.dependency_overrides[get_accounts] = lambda: self.repo
        # current_user resolves the repository via the module getter, not another HTTP request.
        from unittest.mock import patch
        self.patch = patch("app.api.auth.get_accounts", return_value=self.repo)
        self.patch_routes = patch("app.api.account_routes.get_accounts", return_value=self.repo)
        self.patch.start(); self.patch_routes.start()
        app.dependency_overrides[get_knowledge] = lambda: self.knowledge
        self.clients = []

    async def asyncTearDown(self):
        for client in self.clients: await client.aclose()
        self.app.dependency_overrides.clear()
        self.patch.stop(); self.patch_routes.stop()
        self.temp.cleanup()

    def client(self, origin="http://localhost:8081"):
        client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://testserver", headers={"Origin": origin})
        self.clients.append(client)
        return client

    async def register(self, name, device="native"):
        client = self.client()
        result = await client.post("/api/v1/auth/register", json={"username": name, "password": "Test-password-2026", "device": device})
        self.assertEqual(result.status_code, 200, result.text)
        data = result.json()
        if device == "native": client.headers["Authorization"] = "Bearer " + data["token"]
        client.headers["X-Account-ID"] = data["user"]["id"]
        return client, data

    async def test_protected_api_rejects_anonymous(self):
        client = self.client()
        for method, path in (("GET", "/api/v1/account/state"), ("GET", "/api/v1/knowledge"), ("GET", "/api/v1/ai/status"), ("POST", "/api/v1/chat"), ("POST", "/api/v1/salary-delay/analysis"), ("POST", "/api/v1/salary-delay/documents/export")):
            response = await client.request(method, path, json={} if method == "POST" else None)
            self.assertEqual(response.status_code, 401, (path, response.text))
        self.assertEqual((await client.get("/health")).status_code, 200)

    async def test_web_http_only_cookie_and_logout(self):
        client, data = await self.register("webuser", "web")
        self.assertIsNone(data["token"])
        cookies = [cookie for cookie in client.cookies.jar]
        self.assertEqual(len(cookies), 1)
        self.assertIn("HttpOnly", cookies[0]._rest)
        self.assertEqual((await client.get("/api/v1/auth/me")).status_code, 200)
        self.assertEqual((await client.post("/api/v1/auth/logout", json={})).status_code, 200)
        self.assertEqual((await client.get("/api/v1/auth/me")).status_code, 401)

    async def test_two_users_cannot_read_or_replace_other_state(self):
        a, _ = await self.register("alice")
        b, data_b = await self.register("bob")
        state = empty_state(); state["newDraft"] = "alice-private"
        self.assertEqual((await a.post("/api/v1/account/state", json={"base_revision": 0, "state": state})).status_code, 200)
        self.assertIsNone((await b.get("/api/v1/account/state?user_id=alice")).json()["state"])
        self.assertEqual((await b.post("/api/v1/account/state", json={"base_revision": 0, "state": empty_state(), "user_id": "alice"})).status_code, 422)
        self.assertEqual((await a.get("/api/v1/account/state")).json()["state"], state)
        a.headers["X-Account-ID"] = data_b["user"]["id"]
        self.assertEqual((await a.get("/api/v1/account/state")).status_code, 401)

    async def test_other_tab_cookie_change_is_blocked(self):
        client, a = await self.register("alice", "web")
        b = await client.post("/api/v1/auth/register", json={"username": "bob", "password": "Test-password-2026", "device": "web"})
        self.assertEqual(b.status_code, 200)
        # The tab still claims Alice, while its shared browser cookie now belongs to Bob.
        self.assertEqual((await client.post("/api/v1/account/state", json={"base_revision": 0, "state": empty_state()})).status_code, 401)
        self.assertEqual((await client.post("/api/v1/auth/logout", json={})).status_code, 401)
        client.headers["X-Account-ID"] = b.json()["user"]["id"]
        self.assertEqual((await client.get("/api/v1/auth/me")).json()["username"], "bob")

    async def test_state_conflict_and_no_token_fields(self):
        client, _ = await self.register("tester")
        data = empty_state()
        response = await client.post("/api/v1/account/state", json={"base_revision": 0, "state": data})
        self.assertEqual(response.status_code, 200)
        self.assertEqual((await client.post("/api/v1/account/state", json={"base_revision": 0, "state": data})).status_code, 409)
        data["token"] = "must-not-be-stored"
        self.assertEqual((await client.post("/api/v1/account/state", json={"base_revision": 1, "state": data})).status_code, 422)

    async def test_forbidden_origin(self):
        client = self.client("https://untrusted.example")
        result = await client.post("/api/v1/auth/register", json={"username": "tester", "password": "Test-password-2026"})
        self.assertEqual(result.status_code, 403)

    async def test_browser_preflight_and_authenticated_document_download(self):
        client, _ = await self.register("tester", "web")
        preflight = await client.options("/api/v1/account/state", headers={
            "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Content-Type,X-Account-ID"})
        self.assertEqual(preflight.status_code, 200, preflight.text)
        self.assertEqual(preflight.headers.get("access-control-allow-credentials"), "true")
        self.assertEqual(preflight.headers.get("access-control-allow-origin"), "http://localhost:8081")
        response = await client.post("/api/v1/salary-delay/documents/export", json={
            "document_id": str(uuid4()), "template": "employer", "format": "pdf",
            "text": "Тестовое заявление о задержке заработной платы. " * 4, "reviewed": True})
        self.assertEqual(response.status_code, 200, response.text[:200] if response.status_code != 200 else "")
        self.assertTrue(response.content.startswith(b"%PDF-"))

    async def test_case_and_documents_round_trip_without_null_drift(self):
        from app.domain.cases.salary_delay import transition
        from app.api.document_schemas import LetterDetails
        from test_salary_analysis import state
        client, _ = await self.register("tester")
        case = transition(state(), {"kind": "refresh"})
        case["sources"], case["corpus"] = [], self.knowledge.status()
        now = "2026-11-23T10:00:00Z"
        doc = {"id": str(uuid4()), "template": "employer", "templateVersion": "test", "title": "Test", "text": "Edited test text", "details": LetterDetails(document_date="2026-11-23").model_dump(), "caseFingerprint": "test", "createdAt": now, "updatedAt": now, "reviewed": False, "warnings": [], "sources": []}
        data = empty_state(); cid = str(uuid4())
        data["activeId"] = cid
        data["conversations"] = [{"id": cid, "title": "Test", "createdAt": now, "updatedAt": now, "draft": "", "messages": [], "salaryCase": case, "documentDrafts": [doc]}]
        import json
        data = json.loads(json.dumps(data))
        response = await client.post("/api/v1/account/state", json={"base_revision": 0, "state": data})
        self.assertEqual(response.status_code, 200, response.text)
        restored = (await client.get("/api/v1/account/state")).json()["state"]
        self.assertEqual(restored, data)
        self.assertIsNone(restored["conversations"][0]["salaryCase"]["question"])

    async def test_authenticated_ai_flow_without_a_real_provider(self):
        import json
        from app.api.dependencies import get_ai_service
        from app.application.ai_service import AIService
        class FixtureModel:
            def __init__(self): self.calls = []
            def ensure_configured(self): pass
            async def generate(self, messages, schema):
                self.calls.append(schema.__name__)
                if schema.__name__ == "Extraction":
                    return schema.model_validate({"intent": "salary_delay", "message_kind": "facts", "facts": [
                        {"field": "jurisdiction", "value": "russia", "evidence": "в России"},
                        {"field": "employment_type", "value": "employment", "evidence": "по трудовому договору"},
                    ]})
                return schema.model_validate({"acknowledgement": "Проверим сведения о выплате.", "explanations": []})
        model = FixtureModel()
        self.app.dependency_overrides[get_ai_service] = lambda: AIService(model, self.knowledge)
        client, _ = await self.register("tester")
        cid = str(uuid4())
        first = await client.post("/api/v1/ai/turn", json={"conversation_id": cid, "client_message_id": str(uuid4()), "message": "Я работаю по трудовому договору в России. Задерживают зарплату.", "as_of_date": "2026-11-23"})
        self.assertEqual(first.status_code, 200, first.text)
        value = first.json()
        self.assertNotIn("jurisdiction", value["case"]["answers"])
        self.assertEqual(len(value["candidates"]), 2)
        state = {key: value["case"][key] for key in ("version", "description", "answers", "confirmed")}
        accepted = await client.post("/api/v1/ai/turn", json={"conversation_id": cid, "client_message_id": str(uuid4()), "message": "Сохранить сведения", "action": "accept", "state": state,
            "candidates": [{key: c[key] for key in ("field", "value", "evidence")} for c in value["candidates"]]})
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertEqual(accepted.json()["case"]["answers"]["jurisdiction"], "russia")
        self.assertEqual(model.calls, ["Extraction", "GroundedAnswer", "GroundedAnswer"])
