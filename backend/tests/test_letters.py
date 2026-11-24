from copy import deepcopy
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from uuid import uuid4
from zipfile import ZipFile

from docx import Document
from pydantic import ValidationError
from starlette.requests import Request

from app.api.analysis_schemas import AnalysisOptions
from app.api.document_routes import document_draft, document_export
from app.api.document_schemas import DocumentDraftRequest, DocumentDraftResponse, DocumentExportRequest, LetterDetails
from app.application.analysis_service import AnalysisService
from app.application.letter_service import LetterService
from app.domain.cases.salary_delay import CaseInputError, transition
from app.domain.letters import build_letter, validate_export
from app.infrastructure.documents.exporter import export_document, MIME
from app.infrastructure.knowledge.repository import KnowledgeRepository
from test_salary_analysis import state

ROOT = Path(__file__).resolve().parents[1]
OPTIONS = AnalysisOptions(deadline_mode="already_adjusted", amount_basis="accrued").model_dump()


def details(**updates):
    return LetterDetails(document_date="2026-11-23", applicant_name="Иванов Иван Иванович", applicant_address="Тестовый город, ул. Примерная, д. 1",
                         employer_name='ООО "Пример"', employer_address="Тестовый город, ул. Рабочая, д. 2",
                         inspectorate_name="Государственная инспекция труда в тестовом регионе", **updates).model_dump()


class LetterCases(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = TemporaryDirectory()
        repo = KnowledgeRepository(Path(cls.temp.name) / "knowledge.sqlite3", ROOT / "knowledge")
        repo.rebuild()
        cls.service = LetterService(AnalysisService(repo))

    @classmethod
    def tearDownClass(cls): cls.temp.cleanup()

    def letter(self, template="employer", source=None, values=None):
        return self.service.draft(source or state(), values or details(), template, OPTIONS)

    def test_employer_uses_confirmed_facts(self):
        result = self.letter()
        self.assertIn("1 000,00 руб.", result["text"])
        self.assertIn("10.11.2026", result["text"])
        self.assertIn('ООО "Пример"', result["text"])
        self.assertNotIn("[Укажите", result["text"])

    def test_inspectorate_has_its_own_recipient(self):
        result = self.letter("labor_inspectorate")
        self.assertTrue(result["text"].startswith("Кому: Государственная инспекция"))
        self.assertIn("пределах компетенции", result["text"])
        self.assertTrue(any("идентификацией" in text for text in result["warnings"]))

    def test_missing_requisites_are_visible(self):
        result = self.letter(values=LetterDetails(document_date="2026-11-23").model_dump())
        self.assertIn("[Укажите ФИО заявителя]", result["text"])
        self.assertIn("наименование работодателя", result["missing"])
        for format in ("pdf", "docx"):
            with self.assertRaises(CaseInputError): export_document(result["text"], format)

    def test_unknown_inspectorate_not_guessed(self):
        d = details(); d["inspectorate_name"] = ""
        result = self.letter("labor_inspectorate", values=d)
        self.assertIn("[Укажите наименование территориальной инспекции труда]", result["text"])

    def test_unknown_amount_not_invented(self):
        result = self.letter(source=state(expected_amount=None))
        self.assertIn("Сумма к получению после удержаний требует уточнения", result["text"])
        self.assertNotIn("1 000,00", result["text"])

    def test_full_payment_not_described_as_unpaid(self):
        result = self.letter(source=state(payment_status="full", received_amount="1000.00", last_payment_date="2026-11-15"))
        self.assertIn("Основная сумма выплачена полностью", result["text"])
        self.assertNotIn("эта выплата не поступила", result["text"])
        self.assertNotIn("выплатить причитающиеся мне неполученные суммы", result["text"])

    def test_partial_amounts_reused(self):
        result = self.letter(source=state(expected_amount="45000", payment_status="partial", received_amount="10000", last_payment_date="2026-11-15"))
        self.assertIn("Получено: 10 000,00 руб.", result["text"])
        self.assertIn("остаток: 35 000,00 руб.", result["text"])

    def test_no_automatic_violation_without_deadline(self):
        result = self.letter(source=state(due_date=None))
        self.assertIn("срок выплаты мне необходимо уточнить", result["text"])
        self.assertNotIn("работодатель нарушил", result["text"])
        self.assertTrue(any("оценка не завершена" in text for text in result["warnings"]))

    def test_payment_history_does_not_get_invented(self):
        result = self.letter(source=state(payment_status="partial", received_amount="500", last_payment_date="2026-11-15"))
        self.assertNotIn("компенсацию в размере", result["text"])

    def test_confirmed_state_required(self):
        s = state(); s["confirmed"] = False
        with self.assertRaises(CaseInputError): self.letter(source=s)

    def test_incomplete_state_is_not_enough(self):
        s = state(); del s["answers"]["documents"]
        with self.assertRaises(CaseInputError): self.letter(source=s)

    def test_other_relations_or_country_blocked(self):
        for changes in ({"employment_type": "civil"}, {"employment_type": "unwritten"}, {"jurisdiction": "other"}):
            with self.subTest(changes=changes), self.assertRaises(CaseInputError): self.letter(source=state(**changes))

    def test_attachments_never_come_from_available_documents(self):
        self.assertNotIn("Приложения\n", self.letter()["text"])

    def test_manual_attachments_and_extras(self):
        d = details(); d.update(attachments="Копия договора на 2 л.", additional_facts="Дополнительные обстоятельства заявителя.")
        result = self.letter(values=d)
        self.assertIn("Приложения\nКопия договора на 2 л.", result["text"])
        self.assertIn(d["additional_facts"], result["text"])

    def test_optional_compensation(self):
        d = details(); d["request_compensation"] = False
        self.assertNotIn("статье 236", self.letter(values=d)["text"])

    def test_invalid_document_date(self):
        d = details(); d["document_date"] = "2026-02-30"
        with self.assertRaises(CaseInputError): self.letter(values=d)

    def test_no_mutation(self):
        s, d = state(), details()
        original = deepcopy((s, d))
        self.letter(source=s, values=d)
        self.assertEqual((s, d), original)

    def test_schema_uuid_and_response(self):
        request = DocumentDraftRequest.model_validate({"conversation_id": str(uuid4()), "document_id": str(uuid4()), "template": "employer", "state": state(), "details": details()})
        http_request = Request({"type": "http", "state": {"request_id": "offline-test"}})
        result = document_draft(request, http_request, self.service)
        response = DocumentDraftResponse.model_validate(result)
        self.assertEqual(response.document_id, request.document_id)
        self.assertEqual(response.request_id, "offline-test")

    def test_unreviewed_export_rejected(self):
        for review in (False, 1, "true"):
            with self.subTest(review=review), self.assertRaises(ValidationError):
                DocumentExportRequest.model_validate({"document_id": str(uuid4()), "template": "employer", "format": "pdf", "text": self.letter()["text"], "reviewed": review})

    def test_actual_edited_text_is_exported_to_docx(self):
        text = self.letter()["text"] + "\nРучная правка заявителя <текст & символы>."
        content = export_document(text, "docx")
        self.assertTrue(content.startswith(b"PK"))
        restored = Document(BytesIO(content))
        self.assertEqual("\n".join(p.text for p in restored.paragraphs), text)
        self.assertEqual(restored.core_properties.author, "")
        self.assertEqual(restored.styles["Normal"].font.name, "Times New Roman")
        self.assertTrue(any(p.style.name == "Title" for p in restored.paragraphs))
        self.assertAlmostEqual(restored.sections[0].page_width.mm, 210, delta=0.1)

    def test_pdf_signature_and_cyrillic(self):
        content = export_document(self.letter()["text"], "pdf")
        self.assertTrue(content.startswith(b"%PDF-"))
        self.assertIn(b"%%EOF", content[-20:])
        self.assertIn(b"/FontFile2", content)
        self.assertIn(b"/ToUnicode", content)

    def test_long_pdf_is_paginated(self):
        import re
        text = self.letter()["text"] + ("\n\nПодробные дополнительные обстоятельства заявителя. " * 120)
        content = export_document(text, "pdf")
        self.assertGreaterEqual(len(re.findall(rb"/Type /Page\b", content)), 2)

    def test_pdf_unsupported_glyph_is_not_silently_lost(self):
        with self.assertRaises(CaseInputError): export_document(self.letter()["text"] + "\n\U0001f680", "pdf")

    def test_html_injection_is_plain_text(self):
        text = self.letter()["text"] + '\n<script>alert("test")</script> & <b>обычный текст</b>'
        self.assertTrue(export_document(text, "pdf").startswith(b"%PDF-"))
        restored = Document(BytesIO(export_document(text, "docx")))
        self.assertEqual(restored.paragraphs[-1].text, text.splitlines()[-1])

    def test_controls_and_placeholders_are_blocked(self):
        for suffix in ("\x00", "\x1b", "\n[Укажите адрес]"):
            with self.subTest(suffix=suffix), self.assertRaises(CaseInputError): validate_export(self.letter()["text"] + suffix)

    def test_export_format_whitelist(self):
        with self.assertRaises(CaseInputError): export_document(self.letter()["text"], "html")

    def test_binary_response_headers(self):
        for format in ("pdf", "docx"):
            request = DocumentExportRequest(document_id=uuid4(), template="employer", format=format, text=self.letter()["text"], reviewed=True)
            response = document_export(request)
            self.assertEqual(response.media_type, MIME[format])
            self.assertIn('attachment; filename="legalintel-employer-', response.headers["content-disposition"])
            self.assertEqual(response.headers["x-content-type-options"], "nosniff")

    def test_contract_in_openapi_without_starting_server(self):
        from app.main import app
        schema = app.openapi()
        content = schema["paths"]["/api/v1/salary-delay/documents/export"]["post"]["responses"]["200"]["content"]
        self.assertIn(MIME["pdf"], content)
        self.assertIn(MIME["docx"], content)


if __name__ == "__main__": unittest.main()
