"""
Execution Layer: retries, circuit breakers, monitoring, and alerts.
LEI-20 runs across the execution layer.
"""
import json
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from middleware import correlation_id, log_event


class CircuitBreaker:
    def __init__(self, failure_threshold: int = 5, recovery_timeout: float = 60.0):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.failures = 0
        self.last_failure_time: Optional[float] = None
        self.state = "closed"  # closed, open, half-open

    def allow_request(self) -> bool:
        if self.state == "closed":
            return True
        if self.state == "open":
            if self.last_failure_time and (time.time() - self.last_failure_time) > self.recovery_timeout:
                self.state = "half-open"
                return True
            return False
        return True  # half-open

    def record_success(self) -> None:
        self.failures = 0
        self.state = "closed"

    def record_failure(self) -> None:
        self.failures += 1
        self.last_failure_time = time.time()
        if self.failures >= self.failure_threshold:
            self.state = "open"
            log_event("circuit_breaker_opened", {"failures": self.failures}, level="warning")


def retry_with_backoff(
    func: Callable,
    max_retries: int = 3,
    wait_duration_ms: int = 1000,
    backoff_scaling: float = 2.0,
    circuit_breaker: Optional[CircuitBreaker] = None,
) -> Any:
    """Retry idempotent operations with exponential backoff."""
    cid = correlation_id()
    last_error: Optional[Exception] = None
    for attempt in range(1, max_retries + 1):
        if circuit_breaker and not circuit_breaker.allow_request():
            log_event("circuit_breaker_rejected", {"correlation_id": cid, "attempt": attempt}, level="warning")
            raise RuntimeError("Circuit breaker open")
        try:
            result = func()
            if circuit_breaker:
                circuit_breaker.record_success()
            return result
        except Exception as exc:
            last_error = exc
            log_retry(cid, attempt, str(exc), int(wait_duration_ms * (backoff_scaling ** (attempt - 1))))
            if circuit_breaker:
                circuit_breaker.record_failure()
            if attempt < max_retries:
                time.sleep(wait_duration_ms * (backoff_scaling ** (attempt - 1)) / 1000.0)
    raise last_error  # type: ignore


def log_retry(event_id: str, attempt: int, error: str, next_attempt_ms: int) -> None:
    log_event(
        "retry",
        {"event_id": event_id, "attempt": attempt, "error": error, "next_attempt_ms": next_attempt_ms},
        level="warning",
    )


class HealthCheck:
    @staticmethod
    def check_database() -> dict[str, Any]:
        url = os.environ.get("DATABASE_URL")
        if not url:
            return {"status": "skipped", "reason": "no_database_url"}
        try:
            import psycopg2
            conn = psycopg2.connect(url, sslmode="require")
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
                return {"status": "healthy"}
            finally:
                conn.close()
        except Exception as exc:
            return {"status": "unhealthy", "error": str(exc)}

    @staticmethod
    def check_ai() -> dict[str, Any]:
        base_url = os.environ.get("AI_BASE_URL")
        if not base_url:
            return {"status": "skipped", "reason": "no_ai_base_url"}
        return {"status": "configured", "url": base_url}

    @staticmethod
    def check_whatsapp() -> dict[str, Any]:
        if os.environ.get("WAHA_BASE_URL"):
            return {"status": "configured", "provider": "waha", "url": os.environ["WAHA_BASE_URL"]}
        if os.environ.get("WHATSAPP_ACCESS_TOKEN"):
            return {"status": "configured", "provider": "direct"}
        return {"status": "skipped", "reason": "no_whatsapp_credentials"}

    @staticmethod
    def full() -> dict[str, Any]:
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "service": "massagevip-automation",
            "checks": {
                "database": HealthCheck.check_database(),
                "ai": HealthCheck.check_ai(),
                "whatsapp": HealthCheck.check_whatsapp(),
            },
        }


class AlertManager:
    @staticmethod
    def send(subject: str, message: str, level: str = "info") -> None:
        log_event("alert", {"subject": subject, "message": message, "level": level})
        # In production: integrate with Telegram, Slack, email, etc.
        # For now, structured log is the alert channel.
