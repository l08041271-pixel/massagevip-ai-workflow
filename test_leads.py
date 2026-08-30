"""
Standalone lead-capture tests for MassageVIP.
Runs without a database or external credentials using Mock providers everywhere.
"""
import json
import os
import sys
import unittest

os.environ.pop("DATABASE_URL", None)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from leads import (
    get_lead_store,
    Lead,
    LEAD_TRANSITIONS,
    MockLeadStore,
    normalize_phone,
)
from click_tracking import get_click_store, MockClickStore, handle_click_tracking
from typeform_client import get_typeform_provider, MockTypeformProvider
from analytics_leads import get_lead_dashboard

try:
    from google_sheets_client import get_sheets_provider, MockSheetsProvider

    HAS_GOOGLE_SHEETS = True
except ImportError:
    HAS_GOOGLE_SHEETS = False


class TestMockLeadStore(unittest.TestCase):
    def setUp(self):
        import leads

        leads._lead_store = None
        self.store = get_lead_store()

    def test_upsert_creates_lead_with_status_new(self):
        lead = Lead(
            id="l1", phone="+966500000000", email="test@example.com", name="Test User"
        )
        result = self.store.upsert_lead(lead)
        self.assertEqual(result.status, "NEW")
        fetched = self.store.get_lead("l1")
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched.status, "NEW")

    def test_dedup_by_phone_returns_existing_lead(self):
        lead1 = Lead(id="l1", phone="+966 50 123 4567", email="a@example.com")
        self.store.upsert_lead(lead1)
        lead2 = Lead(id="l2", phone="00966501234567", email="b@example.com")
        result = self.store.upsert_lead(lead2)
        self.assertEqual(result.id, "l1")
        self.assertEqual(len(self.store.list_leads()), 1)

    def test_dedup_by_email_returns_existing_lead(self):
        lead1 = Lead(id="l1", email="test@example.com", phone="+966500000001")
        self.store.upsert_lead(lead1)
        lead2 = Lead(id="l2", email="Test@Example.COM", phone="+966500000002")
        result = self.store.upsert_lead(lead2)
        self.assertEqual(result.id, "l1")
        self.assertEqual(result.email, "test@example.com")
        self.assertEqual(len(self.store.list_leads()), 1)

    def test_valid_transition_new_to_completed(self):
        lead = Lead(id="l1", phone="+966500000000")
        self.store.upsert_lead(lead)
        self.store.transition_status("l1", "CONTACTED")
        self.store.transition_status("l1", "QUALIFIED")
        self.store.transition_status("l1", "BOOKED")
        self.store.transition_status("l1", "COMPLETED")
        self.assertEqual(self.store.get_lead("l1").status, "COMPLETED")

    def test_invalid_transition_new_to_completed_raises_valueerror(self):
        lead = Lead(id="l1", phone="+966500000000")
        self.store.upsert_lead(lead)
        with self.assertRaises(ValueError):
            self.store.transition_status("l1", "COMPLETED")

    def test_lost_reachable_from_qualified(self):
        lead = Lead(id="l1", phone="+966500000000")
        self.store.upsert_lead(lead)
        self.store.transition_status("l1", "CONTACTED")
        self.store.transition_status("l1", "QUALIFIED")
        self.store.transition_status("l1", "LOST")
        self.assertEqual(self.store.get_lead("l1").status, "LOST")

    def test_terminal_statuses_reject_further_transitions(self):
        lead = Lead(id="l1", phone="+966500000000")
        self.store.upsert_lead(lead)
        self.store.transition_status("l1", "CONTACTED")
        self.store.transition_status("l1", "QUALIFIED")
        self.store.transition_status("l1", "BOOKED")
        self.store.transition_status("l1", "COMPLETED")
        with self.assertRaises(ValueError):
            self.store.transition_status("l1", "CONTACTED")


class TestMockClickStore(unittest.TestCase):
    def setUp(self):
        import click_tracking

        click_tracking._click_store = None
        self.store = get_click_store()

    def test_track_valid_click(self):
        result = self.store.track(
            {"source": "landing_page", "landing_page": "https://example.com"}
        )
        self.assertEqual(result["status"], "tracked")
        self.assertEqual(len(self.store._clicks), 1)

    def test_reject_payload_missing_source_and_landing_page(self):
        result = self.store.track({"timestamp": "2024-01-01T00:00:00Z"})
        self.assertEqual(result["status"], "rejected")
        self.assertEqual(result["error"], "missing_source_and_landing_page")

    def test_click_id_generated(self):
        result = self.store.track(
            {"source": "test", "landing_page": "https://example.com"}
        )
        self.assertIsInstance(result["click_id"], str)
        self.assertTrue(len(result["click_id"]) > 0)


class TestMockTypeformProvider(unittest.TestCase):
    def setUp(self):
        import leads
        import typeform_client

        typeform_client._typeform_provider = None
        leads._lead_store = None
        self.provider = get_typeform_provider()

    def test_handle_webhook_parses_form_response_into_lead(self):
        payload = {
            "form_response": {
                "answers": [
                    {"type": "email", "email": "user@example.com"},
                    {"type": "phone_number", "phone_number": "+966500000000"},
                    {
                        "type": "text",
                        "field": {"title": "Full Name"},
                        "text": "John Doe",
                    },
                ],
                "hidden": {"campaign": "summer2024"},
            }
        }
        body_bytes = json.dumps(payload).encode()
        status, data = self.provider.handle_typeform_webhook(body_bytes)
        self.assertEqual(status, 200)
        self.assertEqual(data["status"], "lead_created")
        self.assertIn("lead_id", data)

    def test_missing_secret_skips_verification(self):
        os.environ.pop("TYPEFORM_SECRET", None)
        payload = {"form_response": {"answers": []}}
        body_bytes = json.dumps(payload).encode()
        status, data = self.provider.handle_typeform_webhook(
            body_bytes, signature="sha256=dummy"
        )
        self.assertEqual(status, 200)

    def test_tampered_signature_returns_403(self):
        os.environ["TYPEFORM_SECRET"] = "mysecret"
        payload = {"form_response": {"answers": []}}
        body_bytes = json.dumps(payload).encode()
        tampered_sig = "sha256=" + "a" * 64
        status, data = self.provider.handle_typeform_webhook(
            body_bytes, signature=tampered_sig
        )
        self.assertEqual(status, 403)
        self.assertEqual(data["error"], "invalid_signature")
        del os.environ["TYPEFORM_SECRET"]


class TestGoogleSheetsProvider(unittest.TestCase):
    @unittest.skipUnless(
        HAS_GOOGLE_SHEETS, "google_sheets_client module not yet available"
    )
    def test_get_sheets_provider_returns_mock_with_no_creds(self):
        provider = get_sheets_provider()
        self.assertIsInstance(provider, MockSheetsProvider)

    @unittest.skipUnless(
        HAS_GOOGLE_SHEETS, "google_sheets_client module not yet available"
    )
    def test_append_lead_stores_row_in_memory(self):
        provider = get_sheets_provider()
        result = provider.append_lead({"name": "Test", "email": "test@example.com"})
        self.assertIn("status", result)


class TestAnalyticsLeads(unittest.TestCase):
    def test_get_lead_dashboard_returns_mock_status(self):
        dashboard = get_lead_dashboard()
        self.assertEqual(dashboard["status"], "mock")

    def test_get_lead_dashboard_has_all_required_keys(self):
        dashboard = get_lead_dashboard()
        required_keys = [
            "total_leads",
            "whatsapp_clicks",
            "new_leads",
            "booked_customers",
            "completed_bookings",
            "conversion_rate_pct",
            "lead_sources",
            "daily",
            "weekly",
        ]
        for key in required_keys:
            self.assertIn(key, dashboard, f"Missing key: {key}")


if __name__ == "__main__":
    runner = unittest.TextTestRunner(verbosity=2)
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    for cls in [
        TestMockLeadStore,
        TestMockClickStore,
        TestMockTypeformProvider,
        TestGoogleSheetsProvider,
        TestAnalyticsLeads,
    ]:
        suite.addTests(loader.loadTestsFromTestCase(cls))
    result = runner.run(suite)
    passed = result.testsRun - len(result.failures) - len(result.errors) - len(result.skipped)
    print(f"\nResults: {passed} passed, {len(result.failures)} failed, {len(result.skipped)} skipped")
    if not result.wasSuccessful():
        sys.exit(1)
    print("All lead-capture tests passed.")
