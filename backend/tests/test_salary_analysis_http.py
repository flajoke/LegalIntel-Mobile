"""Real HTTP regression, isolated local backend with AI forcibly disabled."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
from tempfile import TemporaryDirectory
import time
import unittest
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(os.environ.get("LEGALINTEL_RUN_HTTP_TESTS") == "1", "Starts a local server; requires explicit permission and LEGALINTEL_RUN_HTTP_TESTS=1")
class HTTPWorkflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = TemporaryDirectory()
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        cls.base = f"http://127.0.0.1:{port}"
        env = {**os.environ, "LEGALINTEL_AI_PROVIDER": "disabled", "LEGALINTEL_AI_API_KEY": "",
               "LEGALINTEL_KNOWLEDGE_DB": str(Path(cls.temp.name) / "knowledge.sqlite3"),
               "LEGALINTEL_ACCOUNTS_DB": str(Path(cls.temp.name) / "accounts.sqlite3"),
               "LEGALINTEL_AI_USAGE_DB": str(Path(cls.temp.name) / "usage.sqlite3")}
        cls.process = subprocess.Popen([sys.executable, "-B", "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
                                       cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            for _ in range(100):
                try:
                    with urlopen(cls.base + "/health", timeout=0.2): pass
                    req = Request(cls.base + "/api/v1/auth/register", data=json.dumps({"username": "http_tester", "password": "Http-test-password-2026", "device": "native"}).encode(), headers={"Content-Type": "application/json"})
                    with urlopen(req, timeout=5) as response: cls.token = json.load(response)["token"]
                    return
                except (URLError, TimeoutError):
                    if cls.process.poll() is not None: raise RuntimeError("Test backend exited during startup")
                    time.sleep(0.1)
            raise RuntimeError("Test backend did not start")
        except BaseException:
            cls.process.terminate()
            cls.process.wait(timeout=5)
            cls.temp.cleanup()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=5)
        cls.temp.cleanup()

    def call(self, path, payload=None):
        request = Request(self.base + path, data=json.dumps(payload).encode() if payload is not None else None,
                          headers={"Content-Type": "application/json", "Origin": "http://localhost:8081", "Authorization": "Bearer " + self.token})
        with urlopen(request, timeout=5) as response:
            return json.load(response), response.headers

    def test_guided_to_analysis_and_edit(self):
        conversation_id, case = str(uuid4()), None
        answers = {"jurisdiction": "russia", "employment_type": "employment", "work_status": "working", "payment_type": "salary",
                   "period": "Synthetic November 2026", "due_date": "2026-11-10", "due_source": "contract", "expected_amount": "45000",
                   "payment_status": "none", "documents": "contract,bank", "employer_contact": "no"}

        def turn(action):
            nonlocal case
            result, _ = self.call("/api/v1/salary-delay/turn", {
                "conversation_id": conversation_id, "client_message_id": str(uuid4()), "message": "Synthetic test",
                "state": {k: case[k] for k in ("version", "description", "answers", "confirmed")} if case else None, "action": action})
            case = result["case"]
            self.assertEqual(result["mode"], "guided")

        turn({"kind": "start", "value": "2026-11-23"})
        while case["question"]:
            field = case["question"]["field"]
            turn({"kind": "answer", "field": field, "value": answers[field]})
        self.assertEqual(case["status"], "review")
        turn({"kind": "confirm"})
        state = {k: case[k] for k in ("version", "description", "answers", "confirmed")}
        result, headers = self.call("/api/v1/salary-delay/analysis", {"conversation_id": conversation_id, "state": state,
                                    "options": {"deadline_mode": "already_adjusted", "amount_basis": "accrued"}})
        self.assertEqual(result["analysis"]["status"], "possible_delay")
        self.assertEqual(result["analysis"]["compensation"]["amount"], "546.00")
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "http://localhost:8081")
        self.assertEqual(headers.get("Cache-Control"), "no-store")
        turn({"kind": "edit", "field": "due_date", "value": "2026-11-12"})
        self.assertFalse(case["confirmed"])
        self.assertEqual(case["question"]["field"], "due_source")
        state = {k: case[k] for k in ("version", "description", "answers", "confirmed")}
        result, _ = self.call("/api/v1/salary-delay/analysis", {"conversation_id": conversation_id, "state": state})
        self.assertEqual(result["analysis"]["status"], "needs_confirmation")

    def test_legacy_and_ai_disabled(self):
        health, _ = self.call("/health")
        self.assertIn("salary_analysis_v1", health["capabilities"])
        status, _ = self.call("/api/v1/ai/status")
        self.assertEqual(status["provider"], "disabled")
        result, _ = self.call("/api/v1/chat", {"conversation_id": str(uuid4()), "client_message_id": str(uuid4()), "message": "Synthetic test"})
        self.assertEqual(result["mode"], "stub")

    def test_strict_validation_and_error_envelope(self):
        with self.assertRaises(HTTPError) as caught:
            self.call("/api/v1/salary-delay/analysis", {"conversation_id": str(uuid4()), "state": {"version": 1, "answers": {}, "confirmed": False}, "options": {"deadline_mode": "invented"}})
        self.assertEqual(caught.exception.code, 422)
        result = json.load(caught.exception)
        self.assertEqual(result["error"]["code"], "validation_error")
        self.assertTrue(result["request_id"])


if __name__ == "__main__": unittest.main()
