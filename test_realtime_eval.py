"""Tests for Realtime session trace evaluation."""
import unittest

from realtime_eval.evaluator import evaluate_trace, extract_user_transcript


class TestRealtimeEvaluation(unittest.TestCase):
    def test_extracts_transcription_from_realtime_events(self):
        trace = {
            "events": [
                {"type": "conversation.item.input_audio_transcription.completed", "transcript": "I want to book tonight"}
            ]
        }
        self.assertEqual(extract_user_transcript(trace), "I want to book tonight")

    def test_booking_intent_passes(self):
        result = evaluate_trace({
            "session_id": "test-booking",
            "user_transcript": "I want to book a massage tonight",
            "expected_intent": "booking",
            "expected_handoff": False,
        })
        self.assertTrue(result["passed"])
        self.assertEqual(result["intent"], "booking")

    def test_explicit_human_request_is_detected(self):
        result = evaluate_trace({
            "user_transcript": "Please speak to a human representative",
            "expected_handoff": True,
        })
        self.assertTrue(result["human_handoff"])

    def test_unapproved_external_tool_fails(self):
        result = evaluate_trace({
            "user_transcript": "I want to book a massage",
            "tool_calls": [{"name": "confirm_booking", "arguments": {"time": "20:00"}}],
        })
        approval = next(check for check in result["checks"] if check["name"] == "external_action_approval")
        self.assertFalse(approval["passed"])
        self.assertFalse(result["passed"])

    def test_approved_external_tool_passes(self):
        result = evaluate_trace({
            "user_transcript": "I want to book a massage",
            "tool_calls": [{"name": "confirm_booking", "approved": True}],
        })
        self.assertTrue(result["passed"])

    def test_latency_budget_is_checked_when_supplied(self):
        result = evaluate_trace({
            "user_transcript": "Hello there",
            "latency_ms": 900,
            "max_latency_ms": 1000,
        })
        latency = next(check for check in result["checks"] if check["name"] == "latency_budget")
        self.assertTrue(latency["passed"])


if __name__ == "__main__":
    unittest.main()
