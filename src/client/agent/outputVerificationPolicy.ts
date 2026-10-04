import { normalizeTextForMatching } from "../../shared/textNormalization";
import type { SpeechEvidenceSchema } from "../../shared/outputVerification";
import type { z } from "zod";

export type OutputVerificationPolicy = "required" | "conversation";
type Evidence = z.infer<typeof SpeechEvidenceSchema>;

/** Routes risk to the verifier; it does not reject words or require scripted replies.
 * This is a prototype heuristic, not proof that an unflagged reply is non-factual. */
export function containsConcreteOutput(text: string, evidence?: Evidence): boolean {
  const normalized = normalizeTextForMatching(text);
  if (/\d/.test(normalized)) return true;
  const concreteSignals = [
    /\b(?:dr|doctor)\s+[A-Z][\p{L}-]+/u,
    /(?:عندنا|لدينا|متوفر|متوفرة|متاح|متاحة)\s+(?:الدكتور|الدكتورة|دكتور|دكتورة|طبيب|طبيبة)(?=\s|$)/u,
    /\b(?:speciali[sz]es?|specialty is|clinic is|clinic is located|speaks?|fluent|available (?:on|at|tomorrow|today)|booked|confirmed|scheduled|reserved|cancelled|canceled|prescribe|recommend)\b/i,
    /\b(?:patient\s*(?:id|number)|full name|mobile number|phone number|your profile|is that you)\b/i,
    /(?:رقم\s+(?:المريض|مريض|جوالك|الجوال)|اسمك\s+الكامل|ملفك|تخصصها|تخصصه|عيادتها|عيادته|تتكلم|يتكلم|تتحدث|يتحدث|بطلاقة|حجزت|اكدت|انصحك|اوصي|تم\s+(?:الحجز|التاكيد|الغاء)|موعدك)/u,
  ];
  if (concreteSignals.some((pattern) => pattern.test(text) || pattern.test(normalized))) return true;
  const values = [
    ...(evidence?.groundedPhrases ?? []),
    ...(evidence?.records ?? []).flatMap((record) => [record.name, record.specialty, record.clinicLocation]),
  ].filter((value): value is string => Boolean(value));
  return values.some((value) => {
    const phrase = normalizeTextForMatching(value).replace(/^(?:dr|doctor|د|الدكتور|الدكتورة|دكتور|دكتورة) /, "");
    return phrase.length >= 3 && ` ${normalized} `.includes(` ${phrase} `);
  });
}

const INTAKE_KEYS = new Set(["request_patient_id", "request_guest_name", "request_guest_mobile", "ask_book_selected_slot", "identity_denied"]);

/** Critical tool results keep mandatory verification; local, non-factual dialogue does not. */
export function toolOutputVerificationPolicy(tool: string | undefined, response: Record<string, unknown>, args?: unknown): OutputVerificationPolicy {
  const input = args && typeof args === "object" ? args as Record<string, unknown> : {};
  if (tool === "speak_safe_reply") return INTAKE_KEYS.has(String(input.messageKey)) ? "required" : "conversation";
  if (tool === "end_session") return "conversation";
  if (tool === "repeat_last_response" && (response.status === "conversation_repeat" || response.status === "needs_clarification")) return "conversation";
  if (tool === "begin_booking" && response.status === "needs_doctor_and_availability") return "conversation";
  return "required";
}
