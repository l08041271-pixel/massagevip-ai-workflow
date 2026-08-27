#!/usr/bin/env python3
"""
Smoke test for MassageVIP Automation go-live validation.
Run against a live WAHA instance to verify the full pipeline.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
from typing import Any

BASE_URL = os.environ.get("WAHA_BASE_URL", "http://localhost:3000")
API_KEY = os.environ.get("WAHA_API_KEY", "")
SESSION = os.environ.get("WAHA_SESSION", "default")
WEBHOOK_URL = os.environ.get("WEBHOOK_URL", "http://localhost:8080/webhook")
WEBHOOK_SECRET = os.environ.get("WAHA_WEBHOOK_SECRET", "")


def waha_get(path: str) -> dict[str, Any]:
    url = f"{BASE_URL}{path}"
    req = urllib.request.Request(url, headers={"X-Api-Key": API_KEY} if API_KEY else {})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def waha_post(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    url = f"{BASE_URL}{path}"
    data = json.dumps(payload).encode()
    headers = {"Content-Type": "application/json"}
    if API_KEY:
        headers["X-Api-Key"] = API_KEY
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def send_test_message(phone: str, text: str) -> dict[str, Any]:
    chat_id = phone.replace("+", "").replace(" ", "") + "@c.us"
    return waha_post("/api/sendText", {"session": SESSION, "chatId": chat_id, "text": text})


def check_webhook_health() -> bool:
    try:
        req = urllib.request.Request(f"{WEBHOOK_URL.replace('/webhook', '')}/health")
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status == 200
    except Exception:
        return False


def main() -> int:
    print("=" * 60)
    print("MassageVIP Automation - Go-Live Smoke Test")
    print("=" * 60)

    # 1. Check WAHA is running
    print("\n[1/5] Checking WAHA...")
    try:
        status = waha_get("/api/status")
        print(f"  WAHA status: {status.get('status', 'unknown')}")
        if status.get("status") not in ("STARTED", "WORKING"):
            print("  FAIL: WAHA not in STARTED/WORKING state")
            return 1
    except Exception as exc:
        print(f"  FAIL: Cannot reach WAHA at {BASE_URL}: {exc}")
        return 1

    # 2. Check webhook endpoint is healthy
    print("\n[2/5] Checking webhook endpoint...")
    if not check_webhook_health():
        print(f"  FAIL: Webhook at {WEBHOOK_URL} is not responding")
        return 1
    print("  Webhook endpoint: OK")

    # 3. Send test message
    print("\n[3/5] Sending test message...")
    test_phone = os.environ.get("TEST_PHONE", "966500000000")
    test_text = "Hi, I want to book a massage tonight"
    try:
        result = send_test_message(test_phone, test_text)
        print(f"  Message sent: {result.get('id', 'unknown')}")
    except Exception as exc:
        print(f"  FAIL: Could not send test message: {exc}")
        return 1

    # 4. Wait for processing and check event store
    print("\n[4/5] Waiting for event processing (5s)...")
    time.sleep(5)

    # 5. Check automation worker logs/output
    print("\n[5/5] Checking automation pipeline...")
    print("  Manual verification required:")
    print(f"    1. Verify event appeared in event_store (phone: {test_phone})")
    print(f"    2. Verify AI qualification was generated")
    print(f"    3. Verify decision engine produced an action")
    print(f"    4. Verify reply was sent back via WAHA")
    print(f"    5. Verify audit log entry was created")

    print("\n" + "=" * 60)
    print("Smoke test complete. Check dashboard for metrics:")
    print(f"  {WEBHOOK_URL.replace('/webhook', '')}/dashboard")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
