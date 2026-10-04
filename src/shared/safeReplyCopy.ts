export const SAFE_REPLY_KEYS = [
  "request_patient_id",
  "continue_without_patient_id",
  "request_guest_name",
  "request_guest_mobile",
  "clarify_request",
  "ask_doctor",
  "ask_day",
  "ask_book_selected_slot",
  "ask_one_thing_at_a_time",
  "choose_available_slot",
  "repeat_request",
  "repeat_unavailable",
  "scope_redirect",
  "acknowledge",
  "identity_denied",
] as const;

export type SafeReplyKey = (typeof SAFE_REPLY_KEYS)[number];
export type SafeReplyLanguage = "en" | "ar";

/** Fixed non-factual dialogue used when the assistant needs to ask or acknowledge without database facts. */
export const SAFE_REPLY_COPY: Record<SafeReplyLanguage, Record<SafeReplyKey, string>> = {
  en: {
    request_patient_id: "Okay. Do you have a patient ID?",
    continue_without_patient_id: "No problem. We can continue without a patient ID.",
    request_guest_name: "Can I get your full name?",
    request_guest_mobile: "And what's the best mobile number to reach you on?",
    clarify_request: "Just to make sure I understood, are you asking about a doctor or looking to book an appointment?",
    ask_doctor: "Is there a particular doctor you have in mind?",
    ask_day: "What day would work best for you?",
    ask_book_selected_slot: "Would you like me to book this time for you?",
    ask_one_thing_at_a_time: "I can help with that. Let's take one thing at a time—what would you like me to check first?",
    choose_available_slot: "Please choose one of the available times I just read to you.",
    repeat_request: "Sorry, I didn't catch that. Could you repeat it in English or Arabic?",
    repeat_unavailable: "Which reply would you like me to repeat?",
    scope_redirect: "I can't help with that.",
    acknowledge: "Of course, I can help with that.",
    identity_denied: "No problem. I won't use that profile. Could you give me the correct patient ID?",
  },
  ar: {
    request_patient_id: "تمام، عندك رقم مريض؟",
    continue_without_patient_id: "ولا يهمك، نكمل بدون رقم المريض.",
    request_guest_name: "وش اسمك الكامل؟",
    request_guest_mobile: "وش رقم جوالك؟",
    clarify_request: "بس أتأكد إني فهمتك: تبي تعرف عن طبيب، ولا تحجز موعد؟",
    ask_doctor: "فيه طبيب معيّن في بالك؟",
    ask_day: "أي يوم يناسبك؟",
    ask_book_selected_slot: "أحجز لك هالموعد؟",
    ask_one_thing_at_a_time: "أكيد، خلّنا ناخذها وحدة وحدة. وش تحب أشيك لك أول؟",
    choose_available_slot: "اختار لي وقت من المواعيد المتاحة اللي قلتها لك.",
    repeat_request: "معليش، ما سمعتك زين. تقدر تعيدها بالعربي أو بالإنجليزي؟",
    repeat_unavailable: "وش الرد اللي تبي أعيده لك؟",
    scope_redirect: "ما أقدر أساعدك بهالشي.",
    acknowledge: "أكيد، أساعدك.",
    identity_denied: "ولا يهمك. ما راح أستخدم هالملف. اعطيني رقم المريض الصحيح.",
  },
};

export function scopeRedirectResponse(language: SafeReplyLanguage, lastApprovedQuestion?: string) {
  const inquiry = lastApprovedQuestion?.trim() || SAFE_REPLY_COPY[language].clarify_request;
  return `${SAFE_REPLY_COPY[language].scope_redirect} ${inquiry}`;
}
