"""
Lead dashboard analytics: sources, conversion, funnel.
Degrades to a mock/empty result when DATABASE_URL is absent.
"""
import datetime
import json
import os
from datetime import timezone
from typing import Any, Optional

from middleware import log_event


def get_leads(limit: int = 100, status: Optional[str] = None) -> dict[str, Any]:
    url = os.environ.get("DATABASE_URL")
    if not url:
        return {"status": "mock", "leads": []}
    import psycopg2

    conn = psycopg2.connect(url, sslmode="require")
    try:
        with conn.cursor() as cur:
            if status:
                cur.execute(
                    "SELECT id, phone, email, name, source, campaign, landing_page, status, score, created_at FROM leads WHERE status = %s ORDER BY created_at DESC LIMIT %s",
                    (status, limit),
                )
            else:
                cur.execute(
                    "SELECT id, phone, email, name, source, campaign, landing_page, status, score, created_at FROM leads ORDER BY created_at DESC LIMIT %s",
                    (limit,),
                )
            cols = [desc[0] for desc in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
    finally:
        conn.close()
    return {"status": "live", "leads": rows}


def _build_weekly(all_weeks: list[str], rows_by_week: dict, booked_by_week: dict) -> list[dict[str, Any]]:
    weekly = []
    for wk in all_weeks:
        entry = rows_by_week.get(wk, {"leads": 0, "clicks": 0})
        weekly.append(
            {
                "week": wk,
                "leads": entry["leads"],
                "clicks": entry["clicks"],
                "booked": booked_by_week.get(wk, 0),
            }
        )
    return weekly


def get_lead_dashboard() -> dict[str, Any]:
    log_event("lead_dashboard_accessed", {})
    url = os.environ.get("DATABASE_URL")
    if not url:
        return {
            "status": "mock",
            "total_leads": 0,
            "whatsapp_clicks": 0,
            "new_leads": 0,
            "booked_customers": 0,
            "completed_bookings": 0,
            "conversion_rate_pct": 0.0,
            "lead_sources": [],
            "daily": [],
            "weekly": [],
            "generated_at": datetime.datetime.now(timezone.utc).isoformat(),
        }
    import psycopg2

    conn = psycopg2.connect(url, sslmode="require")
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM leads")
            total_leads = cur.fetchone()[0]

            cur.execute("SELECT count(*) FROM whatsapp_clicks")
            whatsapp_clicks = cur.fetchone()[0]

            cur.execute("SELECT count(*) FROM leads WHERE status = 'NEW'")
            new_leads = cur.fetchone()[0]

            cur.execute("SELECT count(*) FROM leads WHERE status = 'BOOKED'")
            booked_from_leads = cur.fetchone()[0]

            cur.execute("SELECT count(*) FROM bookings WHERE status = 'booked'")
            booked_from_bookings = cur.fetchone()[0]

            booked_customers = booked_from_leads + booked_from_bookings

            cur.execute("SELECT count(*) FROM leads WHERE status = 'COMPLETED'")
            completed_bookings = cur.fetchone()[0]

            if total_leads > 0:
                conversion_rate_pct = round(
                    (completed_bookings + booked_customers) / total_leads * 100, 1
                )
            else:
                conversion_rate_pct = 0.0

            cur.execute(
                "SELECT source, count(*) AS cnt FROM leads GROUP BY source ORDER BY cnt DESC"
            )
            lead_sources = [
                {"source": row[0], "count": row[1]} for row in cur.fetchall()
            ]

            cur.execute(
                """
                SELECT date_trunc('day', created_at) AS day, count(*) AS leads,
                       sum(CASE WHEN source = 'whatsapp_click' THEN 1 ELSE 0 END) AS clicks
                FROM leads
                WHERE created_at >= now() - interval '7 days'
                GROUP BY 1 ORDER BY 1
                """
            )
            rows_by_day = {row[0].date(): {"leads": row[1], "clicks": row[2]} for row in cur.fetchall()}

            cur.execute(
                """
                SELECT date_trunc('day', created_at) AS day, count(*) AS booked
                FROM leads
                WHERE status IN ('BOOKED', 'COMPLETED')
                  AND created_at >= now() - interval '7 days'
                GROUP BY 1 ORDER BY 1
                """
            )
            booked_by_day = {row[0].date(): row[1] for row in cur.fetchall()}

            today = datetime.datetime.now(timezone.utc).date()
            daily = []
            for i in range(6, -1, -1):
                d = today - datetime.timedelta(days=i)
                entry = rows_by_day.get(d, {"leads": 0, "clicks": 0})
                daily.append(
                    {
                        "day": d.isoformat(),
                        "leads": entry["leads"],
                        "clicks": entry["clicks"],
                        "booked": booked_by_day.get(d, 0),
                    }
                )

            cur.execute(
                """
                SELECT date_trunc('week', created_at) AS week, count(*) AS leads,
                       sum(CASE WHEN source = 'whatsapp_click' THEN 1 ELSE 0 END) AS clicks
                FROM leads
                WHERE created_at >= now() - interval '8 weeks'
                GROUP BY 1 ORDER BY 1
                """
            )
            rows_by_week = {
                row[0].strftime("%Y-W%V"): {"leads": row[1], "clicks": row[2]}
                for row in cur.fetchall()
            }

            cur.execute(
                """
                SELECT date_trunc('week', created_at) AS week, count(*) AS booked
                FROM leads
                WHERE status IN ('BOOKED', 'COMPLETED')
                  AND created_at >= now() - interval '8 weeks'
                GROUP BY 1 ORDER BY 1
                """
            )
            booked_by_week = {
                row[0].strftime("%Y-W%V"): row[1] for row in cur.fetchall()
            }

            all_weeks = []
            for i in range(7, -1, -1):
                d = today - datetime.timedelta(weeks=i)
                wk = d.strftime("%Y-W%V")
                if wk not in all_weeks:
                    all_weeks.append(wk)
            current_week = today.strftime("%Y-W%V")
            if current_week not in all_weeks:
                all_weeks.append(current_week)

            weekly = _build_weekly(all_weeks, rows_by_week, booked_by_week)
    finally:
        conn.close()

    return {
        "status": "live",
        "total_leads": total_leads,
        "whatsapp_clicks": whatsapp_clicks,
        "new_leads": new_leads,
        "booked_customers": booked_customers,
        "completed_bookings": completed_bookings,
        "conversion_rate_pct": conversion_rate_pct,
        "lead_sources": lead_sources,
        "daily": daily,
        "weekly": weekly,
        "generated_at": datetime.datetime.now(timezone.utc).isoformat(),
    }
