"""
Google Sheets lead integration provider.
Provider-portable: business logic never imports google SDKs directly.
"""
import json
import os
from abc import ABC, abstractmethod
from typing import Any, Optional

from middleware import log_event, mask_secret
from monitoring import retry_with_backoff


COLUMNS = [
    "lead_id",
    "name",
    "phone",
    "email",
    "source",
    "campaign",
    "landing_page",
    "status",
    "score",
    "created_at",
]


class SheetsProvider(ABC):
    @abstractmethod
    def append_lead(self, lead: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def append_leads(self, leads: list[dict[str, Any]]) -> dict[str, Any]:
        raise NotImplementedError


class GoogleSheetsProvider(SheetsProvider):
    def __init__(self):
        self.spreadsheet_id = os.environ.get("GOOGLE_SHEETS_ID", "")
        self.tab = os.environ.get("GOOGLE_SHEETS_LEAD_TAB", "Leads")
        self.creds = None
        self._load_credentials()

    def _load_credentials(self):
        creds_json = os.environ.get("GOOGLE_SHEETS_CREDENTIALS")
        creds_path = os.environ.get("GOOGLE_CREDENTIALS_PATH")
        if creds_json:
            try:
                self.creds = json.loads(creds_json)
            except Exception as exc:
                log_event("sheets_creds_parse_failed", {"error": str(exc)}, level="error")
                self.creds = None
        elif creds_path and os.path.exists(creds_path):
            try:
                with open(creds_path, "r", encoding="utf-8") as fh:
                    self.creds = json.load(fh)
            except Exception as exc:
                log_event("sheets_creds_load_failed", {"error": str(exc)}, level="error")
                self.creds = None

    def _build_service(self):
        from google.oauth2.service_account import Credentials
        from googleapiclient.discovery import build

        scopes = ["https://www.googleapis.com/auth/spreadsheets"]
        if isinstance(self.creds, dict):
            creds = Credentials.from_service_account_info(self.creds, scopes=scopes)
        else:
            creds = Credentials.from_service_account_file(self.creds, scopes=scopes)
        return build("sheets", "v4", credentials=creds)

    def _ensure_header(self, service):
        try:
            result = (
                service.spreadsheets()
                .values()
                .get(spreadsheetId=self.spreadsheet_id, range=f"{self.tab}!A1:Z1")
                .execute()
            )
            values = result.get("values", [])
            if not values:
                service.spreadsheets().values().append(
                    spreadsheetId=self.spreadsheet_id,
                    range=f"{self.tab}!A1",
                    valueInputOption="RAW",
                    insertDataOption="INSERT_ROWS",
                    body={"values": [COLUMNS]},
                ).execute()
                log_event("sheets_header_created", {"tab": self.tab})
        except Exception as exc:
            log_event("sheets_header_check_failed", {"error": str(exc)}, level="warning")

    def _append_rows(self, rows: list[list[Any]]) -> dict[str, Any]:
        service = self._build_service()
        self._ensure_header(service)

        def _do_append():
            return (
                service.spreadsheets()
                .values()
                .append(
                    spreadsheetId=self.spreadsheet_id,
                    range=f"{self.tab}!A1",
                    valueInputOption="USER_ENTERED",
                    insertDataOption="INSERT_ROWS",
                    body={"values": rows},
                )
                .execute()
            )

        result = retry_with_backoff(_do_append)
        updated = result.get("updates", {}).get("updatedRows", len(rows))
        log_event("sheets_rows_appended", {"updated_rows": updated, "tab": self.tab})
        return {"status": "appended", "updated_rows": updated, "tab": self.tab}

    def append_lead(self, lead: dict[str, Any]) -> dict[str, Any]:
        row = [lead.get(col, "") for col in COLUMNS]
        return self._append_rows([row])

    def append_leads(self, leads: list[dict[str, Any]]) -> dict[str, Any]:
        rows = []
        for lead in leads:
            row = [lead.get(col, "") for col in COLUMNS]
            rows.append(row)
        return self._append_rows(rows)


class MockSheetsProvider(SheetsProvider):
    def __init__(self):
        self._rows: list[dict[str, Any]] = []

    def append_lead(self, lead: dict[str, Any]) -> dict[str, Any]:
        self._rows.append(lead)
        log_event("sheets_mock_append", {"lead_id": lead.get("lead_id"), "total_rows": len(self._rows)})
        return {"status": "appended", "total_rows": len(self._rows), "provider": "mock"}

    def append_leads(self, leads: list[dict[str, Any]]) -> dict[str, Any]:
        self._rows.extend(leads)
        log_event("sheets_mock_append_batch", {"count": len(leads), "total_rows": len(self._rows)})
        return {"status": "appended", "total_rows": len(self._rows), "provider": "mock"}


_sheets_provider: Optional[SheetsProvider] = None


def _has_credentials() -> bool:
    if not os.environ.get("GOOGLE_SHEETS_ID"):
        return False
    creds_json = os.environ.get("GOOGLE_SHEETS_CREDENTIALS")
    creds_path = os.environ.get("GOOGLE_CREDENTIALS_PATH")
    if creds_json:
        try:
            data = json.loads(creds_json)
            return isinstance(data, dict)
        except Exception:
            return False
    if creds_path:
        return os.path.exists(creds_path)
    return False


def _google_libs_available() -> bool:
    try:
        import google.oauth2.service_account  # noqa: F401
        import googleapiclient.discovery  # noqa: F401
        return True
    except ImportError:
        return False


def get_sheets_provider() -> SheetsProvider:
    global _sheets_provider
    if _sheets_provider is None:
        if _has_credentials() and _google_libs_available():
            _sheets_provider = GoogleSheetsProvider()
        else:
            _sheets_provider = MockSheetsProvider()
    return _sheets_provider


def sync_lead_to_sheets(lead: dict[str, Any]) -> None:
    try:
        provider = get_sheets_provider()
        result = provider.append_lead(lead)
        log_event("sheets_sync_ok", {"lead_id": lead.get("lead_id"), "result": result})
    except Exception as exc:
        log_event("sheets_sync_failed", {"lead_id": lead.get("lead_id"), "error": str(exc)}, level="error")
