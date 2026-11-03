"""Unit tests for the Agents SDK adapter; no external API calls are made."""
import unittest
from types import SimpleNamespace
from unittest.mock import patch, MagicMock

from ai_orchestrator import (
    QualificationOutput,
    ReplyOutput,
    ai_chat,
    ai_structured,
    _agent_model,
)


class TestAgentsSDKAdapter(unittest.TestCase):
    @patch("ai_orchestrator.Runner.run_sync")
    @patch("ai_orchestrator.Agent")
    @patch("ai_orchestrator._configure_agents_client")
    def test_ai_chat_returns_text_final_output(self, configure, agent_cls, run_sync):
        configure.return_value = (MagicMock(), "test-model", "responses")
        run_sync.return_value = SimpleNamespace(final_output="  Hello lead  ")

        result = ai_chat("Reply safely.", "Customer says hello.")

        self.assertEqual(result, "Hello lead")
        agent_cls.assert_called_once()
        run_sync.assert_called_once()

    @patch("ai_orchestrator.Runner.run_sync")
    @patch("ai_orchestrator.Agent")
    @patch("ai_orchestrator._configure_agents_client")
    def test_ai_structured_returns_validated_model_dump(self, configure, agent_cls, run_sync):
        configure.return_value = (MagicMock(), "test-model", "responses")
        output = QualificationOutput(
            lead_score=82,
            intent="booking",
            urgency="high",
            recommended_action="human_review",
            reason="Customer explicitly asks to book",
        )
        run_sync.return_value = SimpleNamespace(final_output=output)

        result = ai_structured("Qualify.", "I want to book.", QualificationOutput)

        self.assertEqual(result["lead_score"], 82)
        self.assertEqual(result["intent"], "booking")
        self.assertEqual(result["urgency"], "high")
        self.assertEqual(agent_cls.call_args.kwargs["output_type"], QualificationOutput)

    @patch("ai_orchestrator.Runner.run_sync")
    @patch("ai_orchestrator.Agent")
    @patch("ai_orchestrator._configure_agents_client")
    def test_ai_structured_rejects_untyped_output(self, configure, agent_cls, run_sync):
        configure.return_value = (MagicMock(), "test-model", "responses")
        run_sync.return_value = SimpleNamespace(final_output="not a structured object")

        with self.assertRaises(RuntimeError):
            ai_structured("Draft.", "Customer asks about booking.", ReplyOutput)

    @patch("ai_orchestrator.OpenAIChatCompletionsModel")
    def test_chat_completions_model_is_selected_when_configured(self, model_cls):
        client = MagicMock()
        model_cls.return_value = "chat-model"
        selected = _agent_model(client, "compat-model", "chat_completions")
        self.assertEqual(selected, "chat-model")
        model_cls.assert_called_once_with(model="compat-model", openai_client=client)

    def test_responses_mode_uses_model_name(self):
        self.assertEqual(_agent_model(MagicMock(), "gpt-4.1-mini", "responses"), "gpt-4.1-mini")


if __name__ == "__main__":
    unittest.main()
