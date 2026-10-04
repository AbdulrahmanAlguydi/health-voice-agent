import type { SafeReplyKey } from "./safeReplyCopy";

/** Conversational objectives, not lines for the model to read aloud. */
export const RECEPTION_INTENTS: Partial<Record<SafeReplyKey, string>> = {
  request_patient_id: "Acknowledge the caller's CHOSEN time briefly, then ask if they already have a patient ID. بالعربية المقصود رقم المريض أو رقم ملفه عندنا، وليس رقم المجمع أو رقم جوال. استخدمي اسم الحقل الواضح «رقم مريض» بصياغتك الطبيعية. Nothing has been booked or reserved; never say it is booked at this stage. If they do not have an ID, offer guest booking naturally. One short question, no repeated service introduction.",
  continue_without_patient_id: "Acknowledge that the caller has no patient ID. Keep their chosen doctor/time and continue the guest flow without asking for the ID again.",
  request_guest_name: "Ask for the caller's full name, in your own conversational wording. Keep the chosen appointment and any other valid details.",
  request_guest_mobile: "Ask for the complete mobile number. If the latest input is incomplete, explain briefly what is missing and ask only for that field. Accept 7–15 digits, optional leading +, Arabic/English digits and spacing. Never pad or invent digits, ask for patient ID again, or claim the appointment is saved.",
  ask_doctor: "Ask only which doctor or specialty the caller wants; do not reintroduce the service.",
  ask_day: "Ask which day the caller wants while retaining the known doctor.",
  ask_book_selected_slot: "Ask whether the caller wants the selected offered slot booked. This is initial guest consent, not a completed booking.",
  clarify_request: "Ask one focused question to distinguish a directory inquiry from appointment booking.",
  acknowledge: "Briefly acknowledge the caller naturally; add no new facts or promises.",
  repeat_request: "Ask for just the unclear part again in Arabic or English, without restarting the flow.",
  choose_available_slot: "Ask the caller to choose from the offered database times, without selecting for them.",
};
