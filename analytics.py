"""
Analytics / CEO Dashboard.
Materialized metrics from event_store and outcomes.
"""
import json
import os
from datetime import datetime, timezone
from typing import Any, Optional

from middleware import log_event


def compute_daily_metrics() -> dict[str, Any]:
    url = os.environ.get("DATABASE_URL")
    if not url:
        return {"status": "mock", "metrics": {}}
    import psycopg2
    conn = psycopg2.connect(url, sslmode="require")
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM daily_metrics ORDER BY day DESC LIMIT 7")
            cols = [desc[0] for desc in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
            cur.execute("SELECT count(*) FROM event_store")
            total_events = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM events WHERE lead_score >= 75")
            qualified = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM outcomes WHERE actual_booked = true")
            bookings = cur.fetchone()[0]
    finally:
        conn.close()

    return {
        "status": "live",
        "daily": rows,
        "totals": {
            "total_events": total_events,
            "qualified_leads": qualified,
            "bookings": bookings,
            "conversion_rate": round(bookings / max(qualified, 1) * 100, 1),
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def get_executive_summary() -> dict[str, Any]:
    metrics = compute_daily_metrics()
    summary = {
        "title": "MassageVIP Automation - Executive Summary",
        "period": "last_7_days",
        "key_metrics": {
            "total_leads": metrics.get("totals", {}).get("total_events", 0),
            "qualified": metrics.get("totals", {}).get("qualified_leads", 0),
            "converted": metrics.get("totals", {}).get("bookings", 0),
            "conversion_rate_pct": metrics.get("totals", {}).get("conversion_rate", 0.0),
        },
        "daily_trends": metrics.get("daily", []),
        "recommendations": _generate_recommendations(metrics),
    }
    log_event("dashboard_accessed", {"totals": summary["key_metrics"]})
    return summary


def _generate_recommendations(metrics: dict[str, Any]) -> list[str]:
    recs = []
    conv = metrics.get("totals", {}).get("conversion_rate", 0.0)
    if conv < 10:
        recs.append("Conversion rate is below 10%. Review qualification thresholds and reply templates.")
    daily = metrics.get("daily", [])
    if daily:
        hot = sum(d.get("hot", 0) for d in daily)
        total = sum(d.get("total", 0) for d in daily)
        if total > 0 and hot / total < 0.2:
            recs.append("Hot lead ratio is below 20%. Consider tightening priority scoring weights.")
    if not recs:
        recs.append("System operating within expected parameters.")
    return recs
