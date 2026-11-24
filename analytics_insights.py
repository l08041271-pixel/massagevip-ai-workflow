"""Evidence-based business insights for the MassageVIP PostgreSQL CRM.

All projections are explicitly labeled as historical estimates. This module
never fabricates individual conversion probabilities or campaign ROI.
"""
from __future__ import annotations

import os
from collections import Counter, defaultdict
from datetime import date, timedelta, datetime, timezone
from typing import Any, Iterable, Mapping

CONVERTED_STATUSES = {"BOOKED", "COMPLETED"}
COMPLETED_STATUSES = {"COMPLETED"}


def score_lead(lead: Mapping[str, Any]) -> dict[str, Any]:
    """Classify the existing CRM score; missing scores remain unscored."""
    raw = lead.get("score")
    try:
        if raw is None or raw == "":
            raise ValueError
        score = max(0, min(100, int(float(raw))))
    except (TypeError, ValueError, OverflowError):
        return {"id": lead.get("id"), "score": None, "category": "UNSCORED"}
    category = "HOT" if score >= 75 else "WARM" if score >= 50 else "COLD"
    return {"id": lead.get("id"), "score": score, "category": category}


def score_leads(leads: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    scored = [score_lead(lead) for lead in leads]
    counts = Counter(item["category"] for item in scored)
    return {
        "status": "measured" if scored else "insufficient_data",
        "total": len(scored),
        "distribution": {key: counts.get(key, 0) for key in ("HOT", "WARM", "COLD", "UNSCORED")},
        "leads": scored,
        "method": "Existing CRM score: HOT >= 75, WARM 50-74, COLD < 50; missing scores are UNSCORED.",
    }


def _score_band(score: Any) -> str | None:
    try:
        value = int(float(score))
    except (TypeError, ValueError, OverflowError):
        return None
    if not 0 <= value <= 100:
        return None
    return "HOT" if value >= 75 else "WARM" if value >= 50 else "COLD"


def predict_conversion(
    outcomes: Iterable[Mapping[str, Any]], min_samples: int = 30, min_band_samples: int = 5
) -> dict[str, Any]:
    """Return observed conversion rates by score band, not individual probabilities."""
    valid = []
    for row in outcomes:
        band = _score_band(row.get("predicted_score"))
        actual = row.get("actual_booked")
        if band is not None and isinstance(actual, bool):
            valid.append((band, actual))
    if len(valid) < min_samples:
        return {
            "status": "insufficient_data",
            "available_outcomes": len(valid),
            "required_outcomes": min_samples,
        }
    booked = sum(1 for _, actual in valid if actual)
    groups: dict[str, list[bool]] = defaultdict(list)
    for band, actual in valid:
        groups[band].append(actual)
    rates = {}
    for band in ("HOT", "WARM", "COLD"):
        samples = groups.get(band, [])
        if len(samples) >= min_band_samples:
            rates[band] = {
                "sample_size": len(samples),
                "observed_conversion_rate_pct": round(sum(samples) / len(samples) * 100, 2),
            }
        else:
            rates[band] = {"status": "insufficient_data", "available_outcomes": len(samples)}
    return {
        "status": "historical_baseline",
        "sample_size": len(valid),
        "overall_conversion_rate_pct": round(booked / len(valid) * 100, 2),
        "score_bands": rates,
        "note": "Historical observed rates only; not an individual lead conversion probability or causal estimate.",
    }


def forecast_demand(
    daily_counts: Iterable[int], horizon_days: int = 7, min_history_days: int = 28
) -> dict[str, Any]:
    counts = list(daily_counts)
    if horizon_days < 1 or min_history_days < 1:
        raise ValueError("horizon_days and min_history_days must be positive")
    if any(not isinstance(value, (int, float)) or value < 0 for value in counts):
        raise ValueError("daily_counts must contain non-negative numbers")
    if len(counts) < min_history_days:
        return {
            "status": "insufficient_data",
            "available_days": len(counts),
            "required_days": min_history_days,
        }
    average = sum(counts[-min_history_days:]) / min_history_days
    return {
        "status": "historical_average_projection",
        "history_days": min_history_days,
        "average_daily_leads": round(average, 2),
        "horizon_days": horizon_days,
        "projected_leads": round(average * horizon_days, 2),
        "note": "Naive projection from the recent daily average; not a seasonal or causal forecast.",
    }


def retention_insights(
    bookings: Iterable[Mapping[str, Any]], min_customers: int = 10
) -> dict[str, Any]:
    completed_by_customer: Counter[str] = Counter()
    completed_bookings = 0
    for booking in bookings:
        status = str(booking.get("status", "")).strip().upper()
        phone = "".join(ch for ch in str(booking.get("customer_phone") or "") if ch.isdigit())
        if status in COMPLETED_STATUSES and phone:
            completed_by_customer[phone] += 1
            completed_bookings += 1
    unique_customers = len(completed_by_customer)
    repeat_customers = sum(1 for count in completed_by_customer.values() if count >= 2)
    if unique_customers < min_customers:
        return {
            "status": "insufficient_data",
            "unique_completed_customers": unique_customers,
            "completed_bookings": completed_bookings,
            "required_customers": min_customers,
        }
    return {
        "status": "measured",
        "unique_completed_customers": unique_customers,
        "completed_bookings": completed_bookings,
        "repeat_customers": repeat_customers,
        "repeat_customer_rate_pct": round(repeat_customers / unique_customers * 100, 2),
        "note": "Repeat rate uses distinct phone numbers with at least two completed bookings.",
    }


def campaign_analysis(leads: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    grouped: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for lead in leads:
        campaign = str(lead.get("campaign") or "Unattributed").strip() or "Unattributed"
        grouped[campaign].append(lead)
    if not grouped:
        return {"status": "insufficient_data", "campaigns": []}
    campaigns = []
    for campaign, rows in sorted(grouped.items()):
        converted = sum(
            1 for row in rows if str(row.get("status", "")).strip().upper() in CONVERTED_STATUSES
        )
        campaigns.append({
            "campaign": campaign,
            "leads": len(rows),
            "converted": converted,
            "conversion_rate_pct": round(converted / len(rows) * 100, 2),
        })
    return {
        "status": "descriptive",
        "campaigns": campaigns,
        "limitations": "ROI and return on ad spend are unavailable without campaign spend and attributable revenue data.",
    }


def build_business_insights(
    leads: list[Mapping[str, Any]],
    outcomes: list[Mapping[str, Any]],
    daily_counts: list[int],
    bookings: list[Mapping[str, Any]],
) -> dict[str, Any]:
    return {
        "status": "live",
        "lead_scoring": score_leads(leads),
        "conversion_prediction": predict_conversion(outcomes),
        "demand_forecast": forecast_demand(daily_counts),
        "retention": retention_insights(bookings),
        "campaign_analysis": campaign_analysis(leads),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def get_business_insights() -> dict[str, Any]:
    """Load only business fields from the configured PostgreSQL database."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        return {"status": "unavailable", "reason": "database_not_configured"}
    try:
        import psycopg2
        conn = psycopg2.connect(url, sslmode="require")
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT id, score, status, campaign FROM leads ORDER BY created_at DESC")
                lead_cols = [d[0] for d in cur.description]
                leads = [dict(zip(lead_cols, row)) for row in cur.fetchall()]
                cur.execute("SELECT predicted_score, actual_booked FROM outcomes WHERE actual_booked IS NOT NULL AND predicted_score IS NOT NULL")
                outcome_cols = [d[0] for d in cur.description]
                outcomes = [dict(zip(outcome_cols, row)) for row in cur.fetchall()]
                cur.execute("SELECT customer_phone, status FROM bookings WHERE customer_phone IS NOT NULL")
                booking_cols = [d[0] for d in cur.description]
                bookings = [dict(zip(booking_cols, row)) for row in cur.fetchall()]
                cur.execute("SELECT created_at::date, count(*) FROM leads WHERE created_at >= CURRENT_DATE - INTERVAL '27 days' GROUP BY 1")
                daily_rows = cur.fetchall()
        finally:
            conn.close()
        daily_by_date = {row[0]: int(row[1]) for row in daily_rows}
        today = date.today()
        daily_counts = [daily_by_date.get(today - timedelta(days=offset), 0) for offset in range(27, -1, -1)]
        return build_business_insights(leads, outcomes, daily_counts, bookings)
    except Exception as exc:
        return {"status": "unavailable", "reason": "analytics_query_failed", "detail": str(exc)[:300]}
