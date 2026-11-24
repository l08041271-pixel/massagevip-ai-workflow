from analytics_insights import (
    score_lead,
    predict_conversion,
    forecast_demand,
    retention_insights,
    campaign_analysis,
)


def test_score_lead_uses_existing_score_and_clear_thresholds():
    assert score_lead({"id": "1", "score": 80}) == {"id": "1", "score": 80, "category": "HOT"}
    assert score_lead({"id": "2", "score": 60})["category"] == "WARM"
    assert score_lead({"id": "3", "score": 20})["category"] == "COLD"


def test_score_lead_does_not_invent_missing_score():
    assert score_lead({"id": "4"})["category"] == "UNSCORED"


def test_conversion_prediction_requires_sufficient_labeled_outcomes():
    result = predict_conversion([{"predicted_score": 80, "actual_booked": True}] * 4)
    assert result["status"] == "insufficient_data"
    assert result["available_outcomes"] == 4


def test_conversion_prediction_reports_historical_rates_not_individual_probability():
    outcomes = ([{"predicted_score": 80, "actual_booked": True}] * 15
                + [{"predicted_score": 80, "actual_booked": False}] * 15)
    result = predict_conversion(outcomes)
    assert result["status"] == "historical_baseline"
    assert result["overall_conversion_rate_pct"] == 50.0
    assert "individual" in result["note"].lower()


def test_demand_forecast_requires_28_days():
    result = forecast_demand([1] * 7)
    assert result["status"] == "insufficient_data"
    assert result["available_days"] == 7


def test_demand_forecast_uses_zero_days_and_seven_day_horizon():
    result = forecast_demand([2] * 28)
    assert result["status"] == "historical_average_projection"
    assert result["average_daily_leads"] == 2.0
    assert result["projected_leads"] == 14.0


def test_retention_counts_unique_customers_with_multiple_completed_bookings():
    bookings = ([{"customer_phone": f"+9665000000{i:02d}", "status": "completed"} for i in range(10)]
                + [{"customer_phone": "+966500000000", "status": "completed"}])
    result = retention_insights(bookings)
    assert result["status"] == "measured"
    assert result["unique_completed_customers"] == 10
    assert result["repeat_customers"] == 1
    assert result["repeat_customer_rate_pct"] == 10.0


def test_retention_does_not_treat_pending_bookings_as_completed():
    result = retention_insights([{"customer_phone": "+966500000000", "status": "pending"}] * 12)
    assert result["status"] == "insufficient_data"
    assert result["unique_completed_customers"] == 0


def test_campaign_analysis_reports_conversion_without_claiming_roi():
    leads = ([{"campaign": "winter", "status": "BOOKED"}] * 2
             + [{"campaign": "winter", "status": "NEW"}]
             + [{"campaign": "spring", "status": "COMPLETED"}])
    result = campaign_analysis(leads)
    winter = next(x for x in result["campaigns"] if x["campaign"] == "winter")
    assert winter["leads"] == 3
    assert winter["converted"] == 2
    assert winter["conversion_rate_pct"] == 66.67
    assert "roi" in result["limitations"].lower()
