"""Offline regression cases: python -m unittest discover -s tests -v."""
from copy import deepcopy
from decimal import Decimal
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from pydantic import ValidationError

from app.api.analysis_schemas import AnalysisOptions, AnalysisRequest, SalaryAnalysisOut
from app.application.analysis_service import AnalysisService
from app.domain.cases.salary_delay import CaseInputError, transition
from app.domain.rules.salary_analysis import evaluate, workday
from app.infrastructure.knowledge.repository import KnowledgeRepository

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = json.loads((ROOT / "app/domain/rules/reference_data.json").read_text(encoding="utf-8"))
OPTIONS = AnalysisOptions(deadline_mode="already_adjusted", amount_basis="accrued").model_dump()


def state(**changes):
    answers = {
        "jurisdiction": "russia", "employment_type": "employment", "work_status": "working",
        "payment_type": "salary", "period": "November 2026", "due_date": "2026-11-10", "due_source": "contract",
        "expected_amount": "1000.00", "payment_status": "none", "documents": "contract,bank",
        "employer_contact": "no", "as_of_date": "2026-11-20",
    }
    answers.update(changes)
    return {"version": 1, "description": "Synthetic case", "confirmed": True, "answers": answers}


def assess(changes=None, options=None, confirmed=True, reference=None):
    source = state(**(changes or {}))
    source["confirmed"] = confirmed
    case = transition(source, {"kind": "refresh"})
    ref = deepcopy(reference or REFERENCE)
    # Fixed fixture: 15%, independent of the live economic value.
    ref["rates"]["periods"] = [{"from": "2026-01-01", "percent": "15.00"}]
    return evaluate(case, {**OPTIONS, **(options or {})}, ref)


class RuleCases(unittest.TestCase):
    def test_unpaid_10_days(self):
        result = assess()
        self.assertEqual(result["status"], "possible_delay")
        self.assertEqual(result["deadline"]["delay_days"], 10)
        self.assertEqual(result["remaining_amount"], "1000.00")
        self.assertEqual(result["compensation"]["amount"], "10.00")

    def test_no_interest_on_due_date(self):
        result = assess({"as_of_date": "2026-11-10"})
        self.assertEqual(result["status"], "no_delay_detected")
        self.assertEqual(result["compensation"]["amount"], "0.00")

    def test_future_deadline(self):
        self.assertEqual(assess({"due_date": "2026-11-21"})["status"], "no_delay_detected")

    def test_unconfirmed_never_assessed(self):
        result = assess(confirmed=False)
        self.assertEqual(result["status"], "needs_confirmation")
        self.assertIsNone(result["compensation"]["amount"])
        self.assertIsNone(result["deadline"]["delay_days"])

    def test_incomplete_cannot_be_confirmed_by_client(self):
        raw = state()
        del raw["answers"]["documents"]
        result = evaluate(transition(raw, {"kind": "refresh"}), OPTIONS, REFERENCE)
        self.assertEqual(result["status"], "needs_confirmation")

    def test_other_country(self):
        result = assess({"jurisdiction": "other"})
        self.assertEqual(result["status"], "outside_scope")
        self.assertEqual(result["next_steps"], [])
        self.assertEqual(result["documents"], [])

    def test_unknown_country(self):
        self.assertEqual(assess({"jurisdiction": None})["status"], "needs_facts")

    def test_civil_and_unwritten_require_review(self):
        for value in ("civil", "unwritten", None):
            with self.subTest(value=value):
                result = assess({"employment_type": value})
                self.assertNotIn(result["status"], {"possible_delay", "no_delay_detected"})
                self.assertIsNone(result["compensation"]["amount"])

    def test_unknown_due_is_not_inferred_from_reported_delay(self):
        result = assess({"due_date": None, "reported_delay_days": "30"})
        self.assertEqual(result["status"], "needs_facts")
        self.assertIsNone(result["deadline"]["date"])

    def test_unverified_calendar_blocks_assessment(self):
        self.assertEqual(assess(options={"deadline_mode": "unverified"})["status"], "needs_facts")

    def test_assumed_or_notice_is_not_documented_deadline(self):
        for source in (None, "assumed", "notice"):
            self.assertEqual(assess({"due_source": source})["status"], "needs_facts")

    def test_federal_weekend_shift(self):
        result = assess({"due_date": "2026-11-15"}, {"deadline_mode": "federal_five_day"})
        self.assertEqual(result["deadline"]["date"], "2026-11-13")
        self.assertEqual(result["deadline"]["delay_days"], 7)

    def test_federal_holiday_shift(self):
        result = assess({"due_date": "2026-11-04"}, {"deadline_mode": "federal_five_day"})
        self.assertEqual(result["deadline"]["date"], "2026-11-03")

    def test_calendar_cross_year_does_not_apply_unsupported_edition(self):
        result = assess({"due_date": "2026-01-09"}, {"deadline_mode": "federal_five_day"})
        self.assertEqual(result["deadline"]["date"], "2025-12-30")
        self.assertEqual(result["status"], "needs_review")
        self.assertIsNone(result["compensation"]["amount"])

    def test_transferred_workday(self):
        from datetime import date
        self.assertIs(workday(date(2025, 11, 1), REFERENCE), True)
        self.assertIs(workday(date(2026, 3, 9), REFERENCE), False)

    def test_historical_case_needs_edition(self):
        result = assess({"due_date": "2025-12-25"})
        self.assertEqual(result["status"], "needs_review")
        self.assertIsNone(result["deadline"]["delay_days"])

    def test_court_term_alert_never_declares_expiration(self):
        result = assess({"due_date": "2025-11-01"})
        alert = next(f for f in result["findings"] if f["id"] == "court_term")
        self.assertIn("не объявляет срок пропущенным", alert["explanation"])

    def test_stale_reference_blocks_new_as_of(self):
        ref = deepcopy(REFERENCE)
        ref["checked_through"] = "2026-11-19"
        self.assertEqual(assess(reference=ref)["status"], "needs_review")

    def test_unknown_status(self):
        self.assertEqual(assess({"payment_status": None})["status"], "needs_facts")

    def test_partial_missing_amount_cannot_conclude(self):
        result = assess({"payment_status": "partial", "received_amount": None, "last_payment_date": "2026-11-15"})
        self.assertEqual(result["status"], "needs_facts")

    def test_paid_late_includes_repayment_day(self):
        result = assess({"payment_status": "full", "received_amount": "1000", "last_payment_date": "2026-11-15"},
                        {"payment_history_complete": True, "payments": [{"date": "2026-11-15", "amount": "1000"}]})
        self.assertEqual(result["status"], "paid_late")
        self.assertEqual(result["remaining_amount"], "0.00")
        self.assertEqual(result["compensation"]["amount"], "5.00")

    def test_paid_on_time(self):
        result = assess({"payment_status": "full", "received_amount": "1000", "last_payment_date": "2026-11-10"})
        self.assertEqual(result["status"], "no_delay_detected")

    def test_paid_full_but_unknown_date(self):
        result = assess({"payment_status": "full", "received_amount": "1000", "last_payment_date": None})
        self.assertEqual(result["status"], "needs_facts")

    def test_partial_aggregate_is_not_payment_ledger(self):
        result = assess({"payment_status": "partial", "received_amount": "700", "last_payment_date": "2026-11-15"})
        self.assertEqual(result["compensation"]["status"], "unavailable")

    def test_partial_and_pre_deadline_payments(self):
        result = assess({"payment_status": "partial", "received_amount": "700", "last_payment_date": "2026-11-15"},
                        {"payment_history_complete": True, "payments": [{"date": "2026-11-10", "amount": "200"}, {"date": "2026-11-15", "amount": "500"}]})
        self.assertEqual(result["compensation"]["amount"], "5.50")
        self.assertEqual(result["remaining_amount"], "300.00")

    def test_rate_change_is_segmented(self):
        case = transition(state(), {"kind": "refresh"})
        ref = deepcopy(REFERENCE)
        ref["rates"]["periods"] = [{"from": "2026-01-01", "percent": "15.00"}, {"from": "2026-11-16", "percent": "30.00"}]
        result = evaluate(case, OPTIONS, ref)
        self.assertEqual(result["compensation"]["amount"], "15.00")
        self.assertEqual([s["days"] for s in result["compensation"]["segments"]], [5, 5])

    def test_daily_rounding_is_not_accumulated(self):
        result = assess({"expected_amount": "1.00"})
        self.assertEqual(result["compensation"]["amount"], "0.01")

    def test_actual_reference_smoke(self):
        result = evaluate(transition(state(expected_amount="45000", as_of_date="2026-11-23"), {"kind": "refresh"}), OPTIONS, REFERENCE)
        self.assertEqual(result["compensation"]["amount"], "546.00")

    def test_unaccrued_sum_not_calculated(self):
        result = assess(options={"amount_basis": "unknown"})
        self.assertEqual(result["compensation"]["status"], "unavailable")
        self.assertTrue(result["lawyer_reasons"])

    def test_unknown_expected_amount(self):
        self.assertIsNone(assess({"expected_amount": None})["compensation"]["amount"])

    def test_rates_do_not_extrapolate(self):
        ref = deepcopy(REFERENCE)
        ref["rates"]["valid_through"] = "2026-11-15"
        self.assertIsNone(assess(reference=ref)["compensation"]["amount"])

    def test_inconsistent_ledger_rejected(self):
        for payments in ([{"date": "2026-11-15", "amount": "499"}], [{"date": "2026-11-14", "amount": "500"}]):
            with self.subTest(payments=payments), self.assertRaises(CaseInputError):
                assess({"payment_status": "partial", "received_amount": "500", "last_payment_date": "2026-11-15"},
                       {"payment_history_complete": True, "payments": payments})

    def test_ledger_conflicts_with_none(self):
        with self.assertRaises(CaseInputError):
            assess(options={"payments": [{"date": "2026-11-15", "amount": "500"}]})

    def test_invalid_payment_dates_and_amounts(self):
        for payment in ({"date": "2026-02-30", "amount": "10"}, {"date": "2026-11-21", "amount": "10"}, {"date": "2026-11-15", "amount": "0"}):
            with self.subTest(payment=payment), self.assertRaises(CaseInputError):
                assess({"payment_status": "partial", "received_amount": "500", "last_payment_date": "2026-11-15"}, {"payments": [payment]})

    def test_suspension_is_never_authorized(self):
        result = assess({"due_date": "2026-11-01"})
        self.assertTrue(any(f["id"] == "suspension" for f in result["findings"]))
        self.assertTrue(any("исключения" in text for text in result["lawyer_reasons"]))

    def test_state_not_mutated(self):
        raw = state()
        original = deepcopy(raw)
        evaluate(transition(raw, {"kind": "refresh"}), OPTIONS, REFERENCE)
        self.assertEqual(raw, original)


class SettlementCases(unittest.TestCase):
    def settlement(self, **changes):
        return {"work_status": "dismissed", "dismissal_date": "2026-11-10", "payment_type": "settlement", "worked_last_day": "yes", **changes}

    def test_worked_on_dismissal_day(self):
        result = assess(self.settlement(due_date=None, due_source=None), {"deadline_mode": "unverified"})
        self.assertEqual(result["deadline"]["date"], "2026-11-10")
        self.assertEqual(result["status"], "possible_delay")

    def test_conflicting_due_date_blocks(self):
        self.assertEqual(assess(self.settlement(due_date="2026-11-12"))["status"], "needs_facts")

    def test_no_work_day_requires_demand(self):
        self.assertEqual(assess(self.settlement(worked_last_day="no", settlement_requested="no"))["status"], "needs_facts")

    def test_day_after_demand(self):
        result = assess(self.settlement(worked_last_day="no", settlement_requested="yes", settlement_request_date="2026-11-11", due_date=None), {"deadline_mode": "federal_five_day"})
        self.assertEqual(result["deadline"]["date"], "2026-11-12")

    def test_demand_does_not_assume_calendar_or_a_missing_entered_date(self):
        for mode in ("unverified", "already_adjusted"):
            result = assess(self.settlement(worked_last_day="no", settlement_requested="yes", settlement_request_date="2026-11-11", due_date=None), {"deadline_mode": mode})
            self.assertIsNone(result["deadline"]["date"])

    def test_demand_before_dismissal(self):
        result = assess(self.settlement(worked_last_day="no", settlement_requested="yes", settlement_request_date="2026-11-09", due_date=None))
        self.assertEqual(result["status"], "needs_facts")

    def test_nonworking_day_after_demand_not_shifted_back(self):
        result = assess(self.settlement(worked_last_day="no", settlement_requested="yes", settlement_request_date="2026-11-13", due_date=None), {"deadline_mode": "federal_five_day"})
        self.assertIsNone(result["deadline"]["date"])


class ServiceAndContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = TemporaryDirectory()
        cls.repo = KnowledgeRepository(Path(cls.temp.name) / "knowledge.sqlite3", ROOT / "knowledge")
        cls.repo.rebuild()

    @classmethod
    def tearDownClass(cls): cls.temp.cleanup()

    def test_response_contract_and_sources(self):
        result = AnalysisService(self.repo).analyze(state(), OPTIONS)
        parsed = SalaryAnalysisOut.model_validate(result)
        self.assertEqual(parsed.status, "possible_delay")
        ids = {s.id for s in parsed.sources}
        self.assertTrue(all(s in ids for f in parsed.findings for s in f.source_ids))

    def test_changed_source_blocks_assessment(self):
        ref = deepcopy(REFERENCE)
        ref["norms"]["tk-236"]["sha256"] = "changed"
        result = AnalysisService(self.repo, ref).analyze(state(), OPTIONS)
        self.assertEqual(result["status"], "needs_review")
        self.assertIsNone(result["compensation"]["amount"])

    def test_same_input_same_output(self):
        service = AnalysisService(self.repo)
        self.assertEqual(service.analyze(state(), OPTIONS), service.analyze(state(), OPTIONS))

    def test_unknown_fields_are_not_accepted(self):
        for patch in ({"deadline_mode": "invented"}, {"amount_basis": "court_awarded"}, {"rate": "99"}, {"payment_history_complete": "true"}):
            with self.subTest(patch=patch), self.assertRaises(ValidationError): AnalysisOptions.model_validate({**OPTIONS, **patch})

    def test_request_does_not_accept_ai_candidates(self):
        with self.assertRaises(ValidationError):
            AnalysisRequest.model_validate({"conversation_id": "39e0de28-d217-4cea-a102-19025135ad40", "state": state(), "candidates": []})

    def test_http_uuid_string_is_accepted(self):
        request = AnalysisRequest.model_validate({"conversation_id": "39e0de28-d217-4cea-a102-19025135ad40", "state": state()})
        self.assertEqual(str(request.conversation_id), "39e0de28-d217-4cea-a102-19025135ad40")


if __name__ == "__main__": unittest.main()
