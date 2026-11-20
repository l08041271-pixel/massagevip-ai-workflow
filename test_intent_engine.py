import unittest
from intent_engine import classify_intent, INTENT_CATALOG, SUPPORTED_CHANNELS
class IntentEngineTests(unittest.TestCase):
 def test_booking_english(self):
  r=classify_intent({"source":"whatsapp","text":"I want to book tonight"}); self.assertEqual(r["intent"],"booking")
 def test_booking_arabic(self):
  r=classify_intent({"source":"instagram","text":"أريد حجز موعد اليوم"}); self.assertEqual(r["intent"],"booking"); self.assertEqual(r["language"],"ar")
 def test_pricing(self):
  self.assertEqual(classify_intent({"channel":"website","text":"How much is a session?"})["intent"],"pricing")
 def test_opt_out_precedes_booking(self):
  r=classify_intent({"source":"telegram","text":"Stop messaging me, don't book"}); self.assertEqual(r["intent"],"opt_out")
 def test_human_handoff(self):
  r=classify_intent({"source":"facebook","text":"I want to speak to a real person"}); self.assertEqual(r["intent"],"human_support"); self.assertTrue(r["human_handoff"])
 def test_cancellation(self):
  self.assertEqual(classify_intent({"source":"email","text":"Please cancel my appointment"})["intent"],"cancellation")
 def test_reschedule(self):
  self.assertEqual(classify_intent({"source":"whatsapp","text":"I need to reschedule my booking"})["intent"],"reschedule")
 def test_event_content_shape(self):
  self.assertEqual(classify_intent({"source":"tiktok","content":{"text":"What services do you offer?"}})["intent"],"services")
 def test_unknown_channel(self):
  self.assertEqual(classify_intent({"source":"new-channel","text":"Hello"})["source"],"unknown")
 def test_channels(self):
  for c in ("whatsapp","instagram","facebook","tiktok","website","telegram","email","phone","crm"): self.assertIn(c,SUPPORTED_CHANNELS)
 def test_catalog(self):
  self.assertIn("booking",INTENT_CATALOG); self.assertIn("opt_out",INTENT_CATALOG); self.assertIn("complaint",INTENT_CATALOG)
 def test_no_side_effects(self):
  self.assertFalse(classify_intent({"source":"whatsapp","text":"Book me"})["side_effects"])
if __name__=="__main__": unittest.main()
