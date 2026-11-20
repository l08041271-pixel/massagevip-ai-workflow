"""Approved, editable response and workflow macro catalog.

Templates are returned for review/rendering only. This module never sends messages,
books appointments, changes consent, or executes a workflow.
"""
from __future__ import annotations

MACROS = {
 "booking": {
  "workflow_macro":"booking_intake",
  "en":"Thanks for contacting MassageVIP Riyadh. Which service are you interested in, and what date and time would you prefer?",
  "ar":"شكراً لتواصلك مع MassageVIP Riyadh. ما الخدمة التي ترغب بها، وما اليوم والوقت المناسبان لك؟"
 },
 "availability": {
  "workflow_macro":"availability_check",
  "en":"I can check availability for you. What date and preferred time should I check?",
  "ar":"يمكنني التحقق من المواعيد المتاحة. ما اليوم والوقت المفضلان لديك؟"
 },
 "pricing": {
  "workflow_macro":"approved_price_lookup",
  "en":"I can share the current price for the service you choose. Which service are you asking about?",
  "ar":"يمكنني تزويدك بالسعر الحالي للخدمة التي تختارها. عن أي خدمة تستفسر؟"
 },
 "services": {
  "workflow_macro":"service_catalog_lookup",
  "en":"I can share the available services. Which type of session or information would you like?",
  "ar":"يمكنني مشاركة قائمة الخدمات المتاحة. ما نوع الجلسة أو المعلومات التي ترغب بها؟"
 },
 "location": {
  "workflow_macro":"approved_location_lookup",
  "en":"I can share the approved location and directions. Would you like the location details?",
  "ar":"يمكنني مشاركة الموقع المعتمد وطريقة الوصول. هل ترغب في تفاصيل الموقع؟"
 },
 "hours": {
  "workflow_macro":"operating_hours_lookup",
  "en":"I can confirm the current operating hours. What day are you planning to visit?",
  "ar":"يمكنني تأكيد ساعات العمل الحالية. في أي يوم تخطط للزيارة؟"
 },
 "payment": {
  "workflow_macro":"approved_payment_methods",
  "en":"I can confirm the accepted payment methods. Which payment option would you like to ask about?",
  "ar":"يمكنني تأكيد وسائل الدفع المقبولة. ما طريقة الدفع التي ترغب في الاستفسار عنها؟"
 },
 "cancellation": {
  "workflow_macro":"human_review_cancellation",
  "en":"I can pass your cancellation request to the team for review. Please share your booking reference; your cancellation is not confirmed yet.",
  "ar":"يمكنني إحالة طلب الإلغاء إلى الفريق للمراجعة. يرجى إرسال رقم الحجز؛ لم يتم تأكيد الإلغاء بعد."
 },
 "reschedule": {
  "workflow_macro":"human_review_reschedule",
  "en":"I can pass your change request to the team. Please share your booking reference and preferred new date and time; the change is not confirmed yet.",
  "ar":"يمكنني إحالة طلب تعديل الموعد إلى الفريق. يرجى إرسال رقم الحجز والموعد الجديد المفضل؛ لم يتم تأكيد التعديل بعد."
 },
 "follow_up": {
  "workflow_macro":"conversation_follow_up",
  "en":"Thanks for following up. Please tell me which inquiry or booking you are referring to so I can route it correctly.",
  "ar":"شكراً لمتابعتك. يرجى توضيح الاستفسار أو الحجز المقصود حتى أتمكن من توجيه طلبك بشكل صحيح."
 },
 "human_support": {
  "workflow_macro":"human_handoff",
  "en":"I’ll route your request to a team member. Please share a brief description of what you need help with.",
  "ar":"سأحيل طلبك إلى أحد أعضاء الفريق. يرجى توضيح ما تحتاج المساعدة بشأنه باختصار."
 },
 "complaint": {
  "workflow_macro":"priority_complaint_review",
  "en":"I’m sorry to hear there is a problem. I’ll flag this for team review. Please describe what happened; avoid sharing sensitive payment details.",
  "ar":"نأسف لوجود مشكلة. سأرفع طلبك للفريق للمراجعة. يرجى توضيح ما حدث، مع تجنب مشاركة بيانات الدفع الحساسة."
 },
 "privacy": {
  "workflow_macro":"privacy_policy_lookup",
  "en":"I can share the applicable privacy information. Please tell me what you would like to know about data handling or discretion.",
  "ar":"يمكنني مشاركة معلومات الخصوصية المعتمدة. ما الذي ترغب في معرفته حول التعامل مع البيانات أو الخصوصية؟"
 },
 "opt_out": {
  "workflow_macro":"marketing_suppression_review",
  "en":"Your request to stop marketing messages has been recorded for processing. A team member will verify the suppression request.",
  "ar":"تم تسجيل طلب إيقاف الرسائل التسويقية لمعالجته. سيتحقق أحد أعضاء الفريق من تنفيذ طلب الإيقاف."
 },
 "general": {
  "workflow_macro":"clarify_request",
  "en":"Thanks for contacting MassageVIP Riyadh. Could you tell me a little more about what you need?",
  "ar":"شكراً لتواصلك مع MassageVIP Riyadh. هل يمكنك توضيح ما تحتاج إليه more؟"
 },
 "spam": {
  "workflow_macro":"suppress_and_log",
  "en":"",
  "ar":""
 },
}

def get_macro(intent: str, language: str = "en") -> dict:
    item = MACROS.get(intent, MACROS["general"])
    lang = "ar" if language.startswith("ar") else "en"
    return {
        "macro_id": intent,
        "workflow_macro": item["workflow_macro"],
        "language": lang,
        "response_template": item[lang],
        "requires_review": intent in ("cancellation", "reschedule", "complaint", "opt_out"),
        "auto_send": False,
    }

def macro_catalog() -> dict:
    return {
        name: {
            "workflow_macro": item["workflow_macro"],
            "languages": ["en", "ar"],
            "auto_send": False,
        }
        for name, item in MACROS.items()
    }
