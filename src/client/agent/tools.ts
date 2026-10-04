import { z } from "zod";
import {
  AvailableSlotsRequestSchema,
  DoctorDetailsRequestSchema,
  DoctorSearchRequestSchema,
  LanguageSchema,
  PatientLookupRequestSchema,
  PrepareBookingRequestSchema,
  PrepareGuestBookingRequestSchema,
  SpecialtyListRequestSchema,
} from "../../shared/contracts";
import {
  isUnambiguousGuestSlotConsent,
} from "../../shared/affirmative";
import { SAFE_REPLY_COPY, SAFE_REPLY_KEYS, scopeRedirectResponse } from "../../shared/safeReplyCopy";
import { normalizeCommonRelativeDate } from "../../shared/relativeDate";
import { RECEPTION_INTENTS } from "../../shared/receptionIntents";
import { extractContactDigits } from "../../shared/contactDigits";
import type { TurnCoordinator } from "./turnCoordinator";

type GeminiFunctionCall = {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
};

type RepeatableReadName = "list_specialties" | "search_doctors" | "get_doctor_details" | "get_available_slots";
type RepeatableReadCall = { name: RepeatableReadName; args: Record<string, unknown> };

const REPEATABLE_READ_TOOLS = new Set<RepeatableReadName>([
  "list_specialties",
  "search_doctors",
  "get_doctor_details",
  "get_available_slots",
]);

export type AgentFunctionResponse = {
  id?: string;
  name?: string;
  response: Record<string, unknown>;
};

type AgentToolHandlerOptions = {
  onDiagnostic?: (event: string, details: Record<string, unknown>, durationMs?: number) => void;
  fetch?: typeof globalThis.fetch;
  turns?: TurnCoordinator;
  onEndSession?: () => void;
  getLastApprovedQuestion?: () => string | undefined;
  getCurrentLanguage?: () => "en" | "ar";
  getLastConversationalReply?: (language: "en" | "ar") => string | undefined;
};

export type AgentToolHandler = ((call: GeminiFunctionCall) => Promise<AgentFunctionResponse>) & {
  getBookingContext: () => Record<string, unknown>;
  hasRepeatableResponse: () => boolean;
  getReceptionIntent: () => "request_guest_name" | undefined;
  cancelPending: (language?: "en" | "ar") => Promise<void>;
  markPatientIdentityReadbackComplete: (patientId: string) => boolean;
  markPendingReadbackComplete: (id: string) => boolean;
  markPendingSummaryPresented: (id: string) => boolean;
  markAvailabilityReadbackComplete: () => boolean;
  markGuestSlotConsentPromptReadbackComplete: (slotId: string) => boolean;
  cancelGuestSlotConsentPrompt: () => void;
};

const ConfirmArgumentsSchema = z
  .object({
    decision: z.enum(["approve", "decline", "change", "unclear"]),
    language: LanguageSchema,
  })
  .strict();
const EndSessionArgumentsSchema = z.object({}).strict();
const SafeReplyArgumentsSchema = z
  .object({ messageKey: z.enum(SAFE_REPLY_KEYS), language: LanguageSchema })
  .strict();
const BeginBookingArgumentsSchema = z.object({
  patientId: z.string().trim().min(1).max(60).optional(),
  continueWithoutPatientId: z.boolean().optional(),
  language: LanguageSchema,
}).strict().refine(
  ({ patientId, continueWithoutPatientId }) => !(patientId && continueWithoutPatientId),
  "Choose either a patient ID or the guest path.",
);
const PrepareBookingToolArgumentsSchema = z
  .object({
    doctorIdentifier: z.string().trim().min(1).max(120),
    slotId: z.string().trim().min(1).max(100),
    language: LanguageSchema,
  })
  .strict();
const ConfirmGuestSlotArgumentsSchema = z.object({
  slotId: z.string().trim().min(1).max(100),
  language: LanguageSchema,
}).strict();

const LOCAL_MESSAGES = {
  en: {
    patientRequired: "Please verify your patient ID before preparing an appointment.",
    patientLookupBeforeBooking: "We can check your patient ID when you're ready to book. Are you asking about a doctor or looking to book an appointment?",
    notConfirmed: "I haven't booked anything. We can change the details or stop here.",
    noPending: "There is no active appointment confirmation to complete.",
    failed: "I couldn't complete that just now, so I can't confirm whether anything changed.",
    lookupFailed: "I couldn't get that information just now. Would you like me to try again?",
    alreadyVerified: "I've already verified your patient profile. Let's continue with the appointment.",
  },
  ar: {
    patientRequired: "قبل ما أجهز الحجز، أحتاج أتحقق من رقم المريض.",
    patientLookupBeforeBooking: "نقدر نتحقق من رقم المريض إذا قررت تحجز. تبي تسأل عن طبيب ولا تحجز موعد؟",
    notConfirmed: "ما حجزت لك شيء. نقدر نغيّر التفاصيل أو نوقف هنا.",
    noPending: "ما فيه طلب حجز نشط أقدر أكمله.",
    failed: "ما قدرت أكمل الطلب الحين، فما أقدر أأكد لك إذا تغيّر شيء.",
    lookupFailed: "ما قدرت أطلع المعلومات الحين. تبي أجرّب مرة ثانية؟",
    alreadyVerified: "تأكدت من ملفك. خلّنا نكمل على الموعد.",
  },
} as const;

function responseFor(call: GeminiFunctionCall, response: Record<string, unknown>): AgentFunctionResponse {
  const key = SAFE_REPLY_KEYS.find((candidate) => RECEPTION_INTENTS[candidate] &&
    ["ar", "en"].some((language) => SAFE_REPLY_COPY[language as "ar" | "en"][candidate] === response.responseText));
  return { id: call.id, name: call.name, response: key ? {
    ...response, speechIntent: { key, guidance: RECEPTION_INTENTS[key], instruction: "Express this intent naturally in the active language. Do not read these instructions aloud." },
  } : response };
}

function localResult(status: string, language: "en" | "ar", key: keyof (typeof LOCAL_MESSAGES)["en"]) {
  return { status, responseText: LOCAL_MESSAGES[language][key] };
}

function parsedJson(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function modelArguments(
  args: Record<string, unknown>,
  allowedKeys: readonly string[],
  language: "en" | "ar",
  optionalKeys: readonly string[] = [],
) {
  const allowed = new Set(allowedKeys);
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (allowed.has(key)) normalized[key] = value;
  }
  if (allowed.has("language")) normalized.language = language;
  for (const key of optionalKeys) {
    const value = normalized[key];
    if (value === null || (typeof value === "string" && !value.trim())) delete normalized[key];
  }
  return normalized;
}

function safeRecovery(
  language: "en" | "ar",
  key: "request_patient_id" | "request_guest_name" | "request_guest_mobile" | "clarify_request" | "ask_doctor" | "ask_day" | "repeat_request" | "choose_available_slot",
) {
  return { status: "needs_clarification", responseText: SAFE_REPLY_COPY[language][key] };
}

export function createAgentToolHandler(options: AgentToolHandlerOptions = {}) {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const turns = options.turns;
  const onEndSession = options.onEndSession;
  const booking = {
    bookingIntentActive: false,
    guestBookingPathSelected: false,
    verifiedPatientId: undefined as string | undefined,
    pendingPatientConfirmationId: undefined as string | undefined,
    pendingPatientConfirmationName: undefined as string | undefined,
    patientIdentityReadbackCompleteForId: undefined as string | undefined,
    identityDenialEligibleTurnId: undefined as number | undefined,
    pendingId: undefined as string | undefined,
    confirmationRetry: undefined as { pendingId: string; finalTranscript: string } | undefined,
    readbackCompleteForPendingId: undefined as string | undefined,
    summaryPresentedForPendingId: undefined as string | undefined,
    pendingAvailableSlots: new Map<string, string>(),
    availableSlots: new Map<string, string>(),
    availableSlotLabels: new Map<string, Record<string, unknown>>(),
    pendingAvailabilityResponseText: undefined as string | undefined,
    pendingGuestConsentPromptSlotId: undefined as string | undefined,
    awaitingGuestConsentSlotId: undefined as string | undefined,
    guestConsentSlotId: undefined as string | undefined,
    repeatableReadCall: undefined as RepeatableReadCall | undefined,
    availabilityDoctorIdentifier: undefined as string | undefined,
    preferredCalendar: "gregorian" as "gregorian" | "hijri",
    pendingReadbackResponse: undefined as Record<string, unknown> | undefined,
    suppliedMobileNumber: undefined as string | undefined,
    completedBooking: undefined as Record<string, unknown> | undefined,
    lastResponseText: undefined as string | undefined,
    originalNameRepairTurnId: undefined as number | undefined,
  };

  turns?.onFinalTranscript(({ turnId, text }) => {
    if (booking.awaitingGuestConsentSlotId) {
      booking.guestConsentSlotId = isUnambiguousGuestSlotConsent(text) ? booking.awaitingGuestConsentSlotId : undefined;
      booking.awaitingGuestConsentSlotId = undefined;
    }
    // Contact evidence is local and bounded to guest intake. It checks function
    // data, never the style or wording of the generated audio.
    if (booking.guestBookingPathSelected) {
      const contact = extractContactDigits(text);
      if (contact) booking.suppliedMobileNumber = contact;
    }
    // Caption text is evidence that a fresh turn exists, not a language parser.
    // Gemini reports identity/appointment meaning through explicit functions.
  });

  async function post(
    path: string,
    body: unknown,
    language: "en" | "ar",
    readOnly = false,
  ): Promise<Record<string, unknown>> {
    const started = performance.now();
    try {
      const response = await fetcher(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = parsedJson(await response.json().catch(() => undefined));
      options.onDiagnostic?.("http_result", { path, status: response.status, result }, performance.now() - started);
      if (!response.ok && typeof result.responseText !== "string") {
        return localResult("error", language, readOnly ? "lookupFailed" : "failed");
      }
      return result;
    } catch {
      options.onDiagnostic?.("http_error", { path }, performance.now() - started);
      return localResult("error", language, readOnly ? "lookupFailed" : "failed");
    }
  }

  async function cancelActive(language: "en" | "ar"): Promise<Record<string, unknown> | undefined> {
    const activeId = booking.pendingId;
    booking.pendingId = undefined;
    booking.readbackCompleteForPendingId = undefined;
    booking.summaryPresentedForPendingId = undefined;
    booking.pendingReadbackResponse = undefined;
    if (!activeId) return undefined;
    try {
      return await post("/api/bookings/cancel", { pendingId: activeId, language }, language);
    } catch {
      return undefined;
    }
  }

  function identityClarification(language: "ar" | "en") {
    return {
      status: "needs_identity_confirmation",
      patient: { patientId: booking.pendingPatientConfirmationId, fullName: booking.pendingPatientConfirmationName },
      responseText: language === "ar"
        ? `لقيت ملف باسم ${booking.pendingPatientConfirmationName}. هذا ملفك؟`
        : `I found a profile for ${booking.pendingPatientConfirmationName}. Is that you?`,
      nextStep: "The patient ID lookup succeeded. Only identity confirmation is unclear; keep the doctor, time and found record. Clarify whether this is the caller's own profile, not their ID again. Do not claim a database error. No booking was prepared.",
    };
  }

  async function handle(call: GeminiFunctionCall): Promise<AgentFunctionResponse> {
    const name = call.name ?? "";
    const args = parsedJson(call.args);
    let language: "en" | "ar" = options.getCurrentLanguage?.() ?? (args.language === "ar" ? "ar" : "en");
    if (!REPEATABLE_READ_TOOLS.has(name as RepeatableReadName) && name !== "repeat_last_response") {
      booking.repeatableReadCall = undefined;
    }

    try {
      if (booking.confirmationRetry && !REPEATABLE_READ_TOOLS.has(name as RepeatableReadName) && name !== "confirm_booking") {
        return responseFor(call, { status: "outcome_unknown", pendingId: booking.confirmationRetry.pendingId,
          nextStep: "Resolve the already approved operation with confirm_booking approve before changing, cancelling, preparing another booking or ending. Reuse the same request; do not ask for another approval.",
          responseText: language === "ar" ? "خلني أتحقق من نتيجة الحجز أول." : "Let me check the booking result first." });
      }
      switch (name) {
        case "confirm_patient_identity": {
          const parsed = z.object({ decision: z.enum(["own_record", "not_mine", "unclear"]), language: LanguageSchema }).strict()
            .safeParse(modelArguments(args, ["decision", "language"], language));
          if (booking.verifiedPatientId) return responseFor(call, { status: "identity_confirmed", responseText: LOCAL_MESSAGES[language].alreadyVerified });
          if (!booking.pendingPatientConfirmationId || !booking.pendingPatientConfirmationName) return responseFor(call, localResult("invalid_patient", language, "patientRequired"));
          if (!parsed.success) return responseFor(call, identityClarification(language));
          if (booking.patientIdentityReadbackCompleteForId !== booking.pendingPatientConfirmationId) return responseFor(call, identityClarification(language));
          const evidence = await turns?.waitForConfirmationTranscript();
          if (!evidence || parsed.data.decision === "unclear") return responseFor(call, identityClarification(language));
          options.onDiagnostic?.("identity_confirmation", { decision: parsed.data.decision, evidence, patientId: booking.pendingPatientConfirmationId });
          if (parsed.data.decision === "not_mine") {
            booking.pendingPatientConfirmationId = undefined;
            booking.pendingPatientConfirmationName = undefined;
            booking.patientIdentityReadbackCompleteForId = undefined;
            booking.identityDenialEligibleTurnId = turns?.currentTranscript()?.id;
            return responseFor(call, { status: "identity_rejected", responseText: SAFE_REPLY_COPY[language].identity_denied });
          }
          booking.verifiedPatientId = booking.pendingPatientConfirmationId;
          booking.pendingPatientConfirmationId = undefined;
          booking.pendingPatientConfirmationName = undefined;
          booking.patientIdentityReadbackCompleteForId = undefined;
          return responseFor(call, { status: "identity_confirmed", nextStep: "Keep the selected doctor/time. Prepare the appointment draft next, then present it and ask for fresh final approval. Nothing is booked.", responseText: LOCAL_MESSAGES[language].alreadyVerified });
        }
        case "repeat_last_response": {
          const parsed = LanguageSchema.safeParse(modelArguments(args, ["language"], language).language ?? language);
          if (!parsed.success) return responseFor(call, safeRecovery(language, "repeat_request"));
          language = parsed.data;
          if (booking.pendingId && booking.pendingReadbackResponse) {
            // Repeat an uncommitted summary, never repeat a write.
            booking.readbackCompleteForPendingId = undefined;
            turns?.invalidateCurrentTurn();
            return responseFor(call, { ...booking.pendingReadbackResponse, repeatSource: "pending_booking" });
          }
          if (booking.pendingPatientConfirmationId && booking.pendingPatientConfirmationName) {
            booking.patientIdentityReadbackCompleteForId = undefined;
            turns?.invalidateCurrentTurn();
            return responseFor(call, identityClarification(language));
          }
          if (!booking.repeatableReadCall) {
            const previousConversation = options.getLastConversationalReply?.(language);
            if (previousConversation) {
              return responseFor(call, { status: "conversation_repeat", responseText: previousConversation });
            }
            return responseFor(call, {
              status: "needs_clarification",
              responseText: SAFE_REPLY_COPY[language].repeat_unavailable,
            });
          }
          const previous = booking.repeatableReadCall;
          const repeated = await handle({
            id: call.id,
            name: previous.name,
            args: { ...previous.args, language },
          });
          return responseFor(call, { ...repeated.response, repeatSource: previous.name });
        }
        case "speak_safe_reply": {
          const parsed = SafeReplyArgumentsSchema.safeParse(modelArguments(args, ["messageKey", "language"], language));
          if (!parsed.success) return responseFor(call, safeRecovery(language, "repeat_request"));
          language = parsed.data.language;
          let messageKey = parsed.data.messageKey;
          if (["request_guest_name", "request_guest_mobile"].includes(messageKey) && !booking.guestBookingPathSelected) {
            return handle({ ...call, name: "begin_booking", args: { language } }).then((result) => ({ ...result, name: call.name }));
          }
          if (messageKey === "request_patient_id" && !booking.bookingIntentActive) {
            return responseFor(call, safeRecovery(language, "clarify_request"));
          }
          if (messageKey === "request_patient_id" && booking.guestBookingPathSelected) {
            messageKey = "continue_without_patient_id";
          }
          if (messageKey === "request_patient_id" && !booking.verifiedPatientId && !booking.pendingPatientConfirmationId && booking.availableSlots.size === 0) {
            messageKey = "ask_doctor";
          }
          if (messageKey === "identity_denied") {
            const currentTurn = turns?.currentTranscript();
            const eligible = currentTurn?.final === true && currentTurn.id === booking.identityDenialEligibleTurnId;
            messageKey = eligible ? "identity_denied" : "request_patient_id";
            booking.identityDenialEligibleTurnId = undefined;
          }
          return responseFor(call, {
            status: "safe_copy",
            responseText: messageKey === "scope_redirect"
              ? scopeRedirectResponse(parsed.data.language, options.getLastApprovedQuestion?.())
              : SAFE_REPLY_COPY[parsed.data.language][messageKey],
          });
        }
        case "begin_booking": {
          booking.completedBooking = undefined;
          const parsed = BeginBookingArgumentsSchema.safeParse(modelArguments(
            args,
            ["patientId", "continueWithoutPatientId", "language"],
            language,
            ["patientId"],
          ));
          if (!parsed.success) return responseFor(call, safeRecovery(language, "repeat_request"));
          language = parsed.data.language;
          booking.bookingIntentActive = true;
          if (parsed.data.patientId) {
            booking.guestBookingPathSelected = false;
            const lookup = await handle({
              id: call.id,
              name: "lookup_patient",
              args: { patientId: parsed.data.patientId, language },
            });
            return { ...lookup, name: call.name };
          }
          if (parsed.data.continueWithoutPatientId || booking.guestBookingPathSelected) {
            booking.guestBookingPathSelected = true;
            return responseFor(call, {
              status: "guest_booking_path",
              responseText: SAFE_REPLY_COPY[language].continue_without_patient_id,
              nextStep: booking.availableSlots.size > 0
                ? "The caller has chosen to continue without a patient ID. Keep the chosen doctor/time and collect their full name and complete mobile number. Do not request another preliminary slot confirmation. Prepare a draft, then ask for one final confirmation after its summary."
                : "Find the caller's doctor and available time. Do not ask for patient ID again.",
            });
          }
          booking.guestBookingPathSelected = false;
          if (booking.verifiedPatientId) {
            return responseFor(call, {
              status: "patient_already_verified",
              responseText: LOCAL_MESSAGES[language].alreadyVerified,
            });
          }
          if (booking.availableSlots.size === 0) {
            return responseFor(call, {
              status: "needs_doctor_and_availability",
              responseText: SAFE_REPLY_COPY[language].ask_doctor,
              nextStep: "Find the caller's doctor or specialty, then show available times. Do not ask for patient ID yet.",
            });
          }
          return responseFor(call, {
            status: "needs_patient_id_or_guest",
            responseText: SAFE_REPLY_COPY[language].request_patient_id,
            nextStep: "Ask whether the caller already has a patient ID. Preserve their selected doctor and time. If they give an ID call begin_booking with patientId; only if they say they lack one call begin_booking with continueWithoutPatientId=true. Do not collect guest contact details yet.",
          });
        }
        case "lookup_patient": {
          if (!booking.bookingIntentActive) {
            return responseFor(call, {
              status: "booking_not_started",
              responseText: LOCAL_MESSAGES[language].patientLookupBeforeBooking,
            });
          }
          if (booking.guestBookingPathSelected) {
            return responseFor(call, {
              status: "guest_path_selected",
              responseText: SAFE_REPLY_COPY[language].continue_without_patient_id,
            });
          }
          const parsed = PatientLookupRequestSchema.safeParse(modelArguments(args, ["patientId", "language"], language));
          if (!parsed.success) return responseFor(call, safeRecovery(language, "request_patient_id"));
          language = parsed.data.language;
          // Identification does not change the doctor or the times already
          // offered. The server rechecks availability when preparing/saving.
          booking.pendingGuestConsentPromptSlotId = undefined;
          booking.awaitingGuestConsentSlotId = undefined;
          booking.guestConsentSlotId = undefined;
          booking.suppliedMobileNumber = undefined;
          booking.identityDenialEligibleTurnId = undefined;
          if (booking.pendingId && booking.pendingId !== undefined) await cancelActive(language);
          booking.patientIdentityReadbackCompleteForId = undefined;
          const result = await post("/api/patients/lookup", parsed.data, language, true);
          const patient = parsedJson(result.patient);
          booking.pendingPatientConfirmationId = result.status === "found" && typeof patient.patientId === "string"
            ? patient.patientId
            : undefined;
          booking.pendingPatientConfirmationName = result.status === "found" && typeof patient.fullName === "string"
            ? patient.fullName
            : undefined;
          booking.verifiedPatientId = undefined;
          // The ID lookup request itself cannot also count as confirmation that the returned name is theirs.
          turns?.invalidateCurrentTurn();
          return responseFor(call, result);
        }
        case "list_specialties": {
          const parsed = SpecialtyListRequestSchema.safeParse(modelArguments(args, ["language"], language));
          if (!parsed.success) return responseFor(call, safeRecovery(language, "repeat_request"));
          language = parsed.data.language;
          const result = await post("/api/doctors/specialties", parsed.data, language, true);
          booking.repeatableReadCall = { name: "list_specialties", args: { ...parsed.data } };
          return responseFor(call, result);
        }
        case "search_doctors": {
          const parsed = DoctorSearchRequestSchema.safeParse(modelArguments(
            args,
            ["query", "specialty", "spokenLanguage", "location", "language"],
            language,
            ["query", "specialty", "spokenLanguage", "location"],
          ));
          if (!parsed.success) return responseFor(call, safeRecovery(language, "repeat_request"));
          language = parsed.data.language;
          const result = await post("/api/doctors/search", parsed.data, language, true);
          booking.repeatableReadCall = { name: "search_doctors", args: { ...parsed.data } };
          return responseFor(call, result);
        }
        case "get_doctor_details": {
          const parsed = DoctorDetailsRequestSchema.safeParse(modelArguments(args, ["doctorIdentifier", "language"], language));
          if (!parsed.success) return responseFor(call, safeRecovery(language, "ask_doctor"));
          language = parsed.data.language;
          const result = await post("/api/doctors/details", parsed.data, language, true);
          booking.repeatableReadCall = { name: "get_doctor_details", args: { ...parsed.data } };
          return responseFor(call, result);
        }
        case "get_available_slots": {
          const normalized = modelArguments(
            args,
            ["doctorIdentifier", "requestedDate", "dateStyle", "language"],
            language,
            ["requestedDate", "dateStyle"],
          );
          if (typeof normalized.doctorIdentifier !== "string" || !normalized.doctorIdentifier.trim()) {
            return responseFor(call, safeRecovery(language, "ask_doctor"));
          }
          if (typeof normalized.requestedDate === "string") {
            normalized.requestedDate = normalizeCommonRelativeDate(normalized.requestedDate) ?? normalized.requestedDate;
          }
          const parsed = AvailableSlotsRequestSchema.safeParse(normalized);
          if (!parsed.success) {
            return responseFor(call, safeRecovery(language, normalized.requestedDate === undefined ? "ask_doctor" : "ask_day"));
          }
          language = parsed.data.language;
          const result = await post("/api/slots/search", parsed.data, language, true);
          if (parsed.data.dateStyle === "hijri" || parsed.data.dateStyle === "gregorian") booking.preferredCalendar = parsed.data.dateStyle;
          booking.pendingAvailableSlots = new Map();
          booking.availableSlots = new Map();
          booking.availableSlotLabels.clear();
          booking.pendingAvailabilityResponseText = typeof result.responseText === "string" ? result.responseText : undefined;
          booking.pendingGuestConsentPromptSlotId = undefined;
          booking.awaitingGuestConsentSlotId = undefined;
          booking.guestConsentSlotId = undefined;
          const doctorId = parsedJson(result.doctor).doctorId;
          if (typeof doctorId === "string") {
            booking.availabilityDoctorIdentifier = doctorId;
            const options = [
              ...(Array.isArray(result.slots) ? result.slots : []),
              ...(Array.isArray(result.alternatives) ? result.alternatives : []),
            ];
            for (const slot of options) {
              const slotId = parsedJson(slot).slotId;
              if (typeof slotId === "string") {
                booking.pendingAvailableSlots.set(slotId, doctorId);
                booking.availableSlotLabels.set(slotId, parsedJson(slot));
              }
            }
          }
          booking.repeatableReadCall = { name: "get_available_slots", args: { ...parsed.data } };
          const caller = turns?.currentTranscript();
          if (result.status === "not_found" && caller && /[\u0600-\u06ff]/.test(caller.text)
            && !/[\u0600-\u06ff]/.test(parsed.data.doctorIdentifier)
            && booking.originalNameRepairTurnId !== caller.id) {
            booking.originalNameRepairTurnId = caller.id;
            return responseFor(call, {
              ...result,
              originalCallerText: caller.text,
              nextStep: "The English lookup did not match. Retry once using the original Arabic doctor name in originalCallerText, not an invented transliteration. If that also fails, ask the caller to clarify; never guess another doctor or loop.",
            });
          }
          return responseFor(call, result);
        }
        case "prepare_booking": {
          const toolArgs = modelArguments(args, ["doctorIdentifier", "slotId", "language"], language);
          if (!toolArgs.doctorIdentifier) return responseFor(call, safeRecovery(language, "ask_doctor"));
          if (!toolArgs.slotId) return responseFor(call, safeRecovery(language, "ask_day"));
          const parsed = PrepareBookingToolArgumentsSchema.safeParse(toolArgs);
          if (!parsed.success) return responseFor(call, safeRecovery(language, "repeat_request"));
          language = parsed.data.language;
          if (!booking.verifiedPatientId) {
            if (booking.pendingPatientConfirmationId && booking.pendingPatientConfirmationName) {
              return responseFor(call, identityClarification(language));
            }
            return responseFor(call, localResult("invalid_patient", language, "patientRequired"));
          }
          const activeTurn = turns?.currentTranscript();
          if (activeTurn?.source === "microphone" && !activeTurn.final) {
            // Do not invalidate the booking request before its final ASR transcript arrives;
            // otherwise a late copy could be mistaken for consent after read-back.
            await turns?.waitForConfirmationTranscript();
          }
          await cancelActive(language);
          const bookingRequest = PrepareBookingRequestSchema.parse({ ...parsed.data, patientId: booking.verifiedPatientId, ...(booking.preferredCalendar === "hijri" ? { calendar: booking.preferredCalendar } : {}) });
          const result = await post("/api/bookings/prepare", bookingRequest, language);
          if (result.status === "pending" && typeof result.pendingId === "string") {
            booking.pendingId = result.pendingId;
            booking.pendingReadbackResponse = result;
            booking.readbackCompleteForPendingId = undefined;
            // The initial request to book cannot also be the later approval after a spoken read-back.
            turns?.invalidateCurrentTurn();
          }
          return responseFor(call, result);
        }
        case "confirm_guest_slot": {
          const parsed = ConfirmGuestSlotArgumentsSchema.safeParse(modelArguments(args, ["slotId", "language"], language));
          if (!parsed.success) return responseFor(call, safeRecovery(language, "choose_available_slot"));
          language = parsed.data.language;
          if (!booking.availableSlots.has(parsed.data.slotId)) {
            if (booking.pendingAvailableSlots.has(parsed.data.slotId) && booking.pendingAvailabilityResponseText) {
              return responseFor(call, {
                status: "availability_not_yet_heard",
                availabilityReadbackPending: true,
                responseText: booking.pendingAvailabilityResponseText,
              });
            }
            return responseFor(call, safeRecovery(language, "choose_available_slot"));
          }
          if (!booking.guestBookingPathSelected) {
            return handle({ ...call, name: "begin_booking", args: { language } }).then((result) => ({ ...result, name: call.name }));
          }
          booking.pendingGuestConsentPromptSlotId = parsed.data.slotId;
          booking.awaitingGuestConsentSlotId = undefined;
          booking.guestConsentSlotId = undefined;
          return responseFor(call, {
            status: "awaiting_guest_consent",
            guestSlotId: parsed.data.slotId,
            slot: booking.availableSlotLabels.get(parsed.data.slotId),
            responseText: SAFE_REPLY_COPY[language].ask_book_selected_slot,
            nextStep: "No booking draft exists yet. Ask about this exact time, wait for agreement, collect guest details, then call prepare_guest_booking. Never call confirm_booking until preparation returns pending.",
          });
        }
        case "prepare_guest_booking": {
          const toolArgs = modelArguments(
            args,
            ["fullName", "mobileNumber", "doctorIdentifier", "slotId", "language"],
            language,
          );
          if (!toolArgs.doctorIdentifier) return responseFor(call, safeRecovery(language, "ask_doctor"));
          if (!toolArgs.slotId) return responseFor(call, safeRecovery(language, "ask_day"));
          if (!PrepareGuestBookingRequestSchema.shape.fullName.safeParse(toolArgs.fullName).success) {
            return responseFor(call, safeRecovery(language, "request_guest_name"));
          }
          if (!PrepareGuestBookingRequestSchema.shape.mobileNumber.safeParse(toolArgs.mobileNumber).success) {
            return responseFor(call, { ...safeRecovery(language, "request_guest_mobile"),
              validation: { field: "mobileNumber", code: "invalid_mobile", minDigits: 7, maxDigits: 15, retryable: true },
              nextStep: "Keep the same doctor, slot and full name. Ask for the complete mobile number; do not prepare or confirm a booking until it is valid.",
            });
          }
          const parsed = PrepareGuestBookingRequestSchema.safeParse(toolArgs);
          if (!parsed.success) return responseFor(call, safeRecovery(language, "repeat_request"));
          language = parsed.data.language;
          const activeTurn = turns?.currentTranscript();
          if (activeTurn?.source === "microphone" && !activeTurn.final) {
            // Live may deliver the function call before its independent final ASR event.
            // Wait for the current utterance so clear slot consent is not mistaken for a no.
            await turns?.waitForConfirmationTranscript();
          }
          const doctorId = booking.availableSlots.get(parsed.data.slotId);
          if (!doctorId) return responseFor(call, safeRecovery(language, "choose_available_slot"));
          if (!booking.guestBookingPathSelected) {
            return handle({ ...call, name: "begin_booking", args: { language } }).then((result) => ({ ...result, name: call.name }));
          }
          if (booking.suppliedMobileNumber && parsed.data.mobileNumber !== booking.suppliedMobileNumber) {
            return responseFor(call, { ...safeRecovery(language, "request_guest_mobile"),
              validation: { field: "mobileNumber", code: "mobile_not_supplied", retryable: true },
              suppliedMobileNumber: booking.suppliedMobileNumber,
              nextStep: "The function's number differs from the caller's digits. Read back the digits actually supplied if they ask, even when incomplete. Never add or invent digits. Ask for the complete number, retaining the doctor, time, name and slot agreement. No draft was created.",
            });
          }
          booking.guestConsentSlotId = undefined;
          booking.pendingGuestConsentPromptSlotId = undefined;
          await cancelActive(language);
          const result = await post("/api/bookings/prepare-guest", {
            ...parsed.data,
            ...(booking.preferredCalendar === "hijri" ? { calendar: booking.preferredCalendar } : {}),
            doctorIdentifier: doctorId,
          }, language);
          if (result.status === "pending" && typeof result.pendingId === "string") {
            booking.pendingId = result.pendingId;
            booking.pendingReadbackResponse = result;
            booking.readbackCompleteForPendingId = undefined;
            turns?.invalidateCurrentTurn();
          }
          return responseFor(call, result);
        }
        case "confirm_booking": {
          if (booking.completedBooking) return responseFor(call, { ...booking.completedBooking, status: "already_confirmed", nextStep: "The appointment is already saved. State success, do not request confirmation again or write another booking." });
          const parsed = ConfirmArgumentsSchema.safeParse(modelArguments(args, ["decision", "language"], language));
          if (!parsed.success) {
            return responseFor(call, { status: "needs_clarification", nextStep: "Interpret the latest caller reply and provide decision approve, decline, change or unclear. No write occurred.", responseText: LOCAL_MESSAGES[language].notConfirmed });
          }
          language = parsed.data.language;
          if (!booking.pendingId || !turns) {
            if (booking.pendingPatientConfirmationId) return responseFor(call, identityClarification(language));
            if (booking.pendingId) await cancelActive(language);
            return responseFor(call, { ...localResult("not_confirmed", language, "noPending"),
              nextStep: !booking.guestBookingPathSelected && !booking.verifiedPatientId
                ? "No booking was prepared, not an expired appointment. Call begin_booking to resolve the patient ID or guest choice. Keep the selected doctor/time."
                : "No booking draft exists. Keep the selected doctor/time and caller details; call prepare_guest_booking for a guest or prepare_booking for a verified patient. Follow its returned nextStep; confirm_booking is only for a pending draft.",
            });
          }
          if (booking.readbackCompleteForPendingId !== booking.pendingId && booking.summaryPresentedForPendingId !== booking.pendingId) {
            turns.invalidateCurrentTurn();
            return responseFor(call, {
              ...booking.pendingReadbackResponse,
              status: "pending",
              pendingId: booking.pendingId,
              nextStep: "The complete final summary has not been presented. Present the pending summary once and ask for a fresh confirmation. Do not book yet.",
            });
          }

          if (booking.confirmationRetry && parsed.data.decision !== "approve") {
            return responseFor(call, { status: "outcome_unknown", nextStep: "The original approval was already sent. Reconcile it with confirm_booking approve before changing the request." });
          }
          const finalTranscript = booking.confirmationRetry?.finalTranscript ?? await turns.waitForConfirmationTranscript();
          if (!finalTranscript || parsed.data.decision === "unclear") {
            return responseFor(call, { ...booking.pendingReadbackResponse, status: "pending", nextStep: "Final approval is unclear or no fresh completed caller turn exists. Keep this draft; clarify approval only. Nothing is booked." });
          }
          if (parsed.data.decision !== "approve") {
            const cancelled = await cancelActive(language);
            return responseFor(call, {
              status: "not_confirmed",
              responseText: typeof cancelled?.responseText === "string"
                ? cancelled.responseText
                : LOCAL_MESSAGES[language].notConfirmed,
            });
          }

          const activeId = booking.pendingId;
          booking.confirmationRetry = { pendingId: activeId, finalTranscript };
          const result = await post("/api/bookings/confirm", {
              pendingId: activeId,
              language,
              finalTranscript,
              decision: "approve",
            }, language);
          if (!["confirmed", "expired", "not_found", "slot_unavailable", "not_confirmed"].includes(String(result.status))) {
            return responseFor(call, {
              status: "outcome_unknown",
              pendingId: activeId,
              responseText: language === "ar" ? "ما وصلني تأكيد نتيجة الحجز. خلني أتحقق من نفس الطلب." : "I haven't received the booking result. Let me check the same request.",
              nextStep: "The appointment may already be saved. Retry confirm_booking with approve for the same pending request; do not prepare another booking, claim failure/success, or change its details until the outcome is known.",
            });
          }
          booking.pendingId = undefined;
          booking.confirmationRetry = undefined;
          booking.readbackCompleteForPendingId = undefined;
          booking.summaryPresentedForPendingId = undefined;
          booking.pendingReadbackResponse = undefined;
          if (result.status === "confirmed") {
            booking.completedBooking = result;
            booking.bookingIntentActive = false;
            booking.guestBookingPathSelected = false;
          }
          return responseFor(call, result);
        }
        case "cancel_pending_booking": {
          language = modelArguments(args, ["language"], language).language as "en" | "ar";
          const result = booking.pendingId
            ? await cancelActive(language)
            : undefined;
          booking.pendingGuestConsentPromptSlotId = undefined;
          booking.awaitingGuestConsentSlotId = undefined;
          booking.guestConsentSlotId = undefined;
          booking.bookingIntentActive = false;
          booking.guestBookingPathSelected = false;
          turns?.invalidateCurrentTurn();
          if (result?.status === "cancelled" && booking.availabilityDoctorIdentifier) {
            // Recheck, do not reuse stale schedule facts when repairing a choice.
            const refreshed = await handle({ name: "get_available_slots", args: { doctorIdentifier: booking.availabilityDoctorIdentifier, language } });
            return responseFor(call, { ...result, availability: refreshed.response });
          }
          return responseFor(call, result ?? localResult("not_found", language, "noPending"));
        }
        case "end_session": {
          if (!EndSessionArgumentsSchema.safeParse(modelArguments(args, [], language)).success) {
            return responseFor(call, { status: "invalid_request", responseText: LOCAL_MESSAGES[language].failed });
          }
          await cancelActive(language);
          booking.pendingGuestConsentPromptSlotId = undefined;
          booking.awaitingGuestConsentSlotId = undefined;
          booking.guestConsentSlotId = undefined;
          booking.bookingIntentActive = false;
          booking.guestBookingPathSelected = false;
          turns?.invalidateCurrentTurn();
          onEndSession?.();
          return responseFor(call, {
            status: "ending",
            responseText: language === "ar" ? "شكرًا لتواصلك. يومك سعيد، مع السلامة." : "Thank you for calling. Goodbye.",
          });
        }
        default:
          return responseFor(call, { status: "unsupported_function", responseText: LOCAL_MESSAGES[language].failed });
      }
    } catch {
      return responseFor(call, localResult("error", language, "failed"));
    }
  }

  const inFlight = new Set<Promise<AgentFunctionResponse>>();
  const addProgress = async (call: GeminiFunctionCall): Promise<AgentFunctionResponse> => {
    const result = await handle(call);
    if (typeof result.response.responseText === "string") booking.lastResponseText = result.response.responseText;
    const bookingStage = booking.completedBooking ? "booked" : booking.pendingId ? "awaiting_final_approval"
      : booking.pendingPatientConfirmationId ? "awaiting_identity_confirmation"
      : booking.verifiedPatientId || booking.guestBookingPathSelected ? "ready_to_prepare"
      : booking.bookingIntentActive ? "choosing_patient_path" : "browsing";
    const allowedNextActions = bookingStage === "booked" ? ["end_session", "begin_booking"]
      : bookingStage === "awaiting_final_approval" ? ["confirm_booking", "cancel_pending_booking", "repeat_last_response"]
      : bookingStage === "awaiting_identity_confirmation" ? ["confirm_patient_identity", "repeat_last_response"]
      : bookingStage === "ready_to_prepare" ? [booking.guestBookingPathSelected ? "prepare_guest_booking" : "prepare_booking"]
      : ["search_doctors", "get_available_slots", "begin_booking"];
    return { ...result, response: { ...result.response, bookingStage, allowedNextActions } };
  };
  const withProgress = (call: GeminiFunctionCall): Promise<AgentFunctionResponse> => {
    const operation = addProgress(call);
    inFlight.add(operation);
    return operation.finally(() => { inFlight.delete(operation); });
  };
  return Object.assign(withProgress, {
    getBookingContext: () => ({
      bookingIntentActive: booking.bookingIntentActive,
      booked: Boolean(booking.completedBooking),
      lastResponseText: booking.lastResponseText,
      guestPath: booking.guestBookingPathSelected,
      verifiedPatientId: booking.verifiedPatientId,
      pendingIdentityId: booking.pendingPatientConfirmationId,
      pendingId: booking.pendingId,
      outcomeUnknown: Boolean(booking.confirmationRetry),
      pendingSummary: booking.pendingReadbackResponse,
      completedResult: booking.completedBooking,
      availableSlots: [...booking.availableSlotLabels.values()],
      readbackComplete: Boolean(booking.pendingId && booking.readbackCompleteForPendingId === booking.pendingId),
      summaryPresented: Boolean(booking.pendingId && booking.summaryPresentedForPendingId === booking.pendingId),
      availableSlotIds: [...booking.availableSlots.keys()],
      awaitingGuestConsentSlotId: booking.awaitingGuestConsentSlotId,
      guestConsentSlotId: booking.guestConsentSlotId,
    }),
    cancelPending: async (language: "en" | "ar" = "en") => {
      // Stop must observe any draft/result created by a response already in
      // flight; clearing first lets the late response revive abandoned state.
      await Promise.allSettled([...inFlight]);
      if (booking.confirmationRetry) {
        const recovered = await handle({ name: "confirm_booking", args: { decision: "approve", language } });
        if (recovered.response.status === "outcome_unknown" || recovered.response.status === "error") return;
      }
      turns?.invalidateCurrentTurn();
      booking.completedBooking = undefined;
      booking.lastResponseText = undefined;
      booking.repeatableReadCall = undefined;
      booking.bookingIntentActive = false;
      booking.guestBookingPathSelected = false;
      booking.verifiedPatientId = undefined;
      booking.pendingPatientConfirmationId = undefined;
      booking.pendingPatientConfirmationName = undefined;
      booking.patientIdentityReadbackCompleteForId = undefined;
      booking.identityDenialEligibleTurnId = undefined;
      booking.pendingAvailableSlots.clear();
      booking.availableSlots.clear();
      booking.availableSlotLabels.clear();
      booking.availabilityDoctorIdentifier = undefined;
      booking.preferredCalendar = "gregorian";
      booking.pendingAvailabilityResponseText = undefined;
      booking.pendingGuestConsentPromptSlotId = undefined;
      booking.awaitingGuestConsentSlotId = undefined;
      booking.guestConsentSlotId = undefined;
      const cancellation = cancelActive(language);
      await cancellation;
    },
    hasRepeatableResponse: () => Boolean(booking.pendingReadbackResponse) || booking.repeatableReadCall !== undefined || Boolean(options.getLastConversationalReply?.(options.getCurrentLanguage?.() ?? "en")),
    getReceptionIntent: () => booking.guestConsentSlotId ? "request_guest_name" as const : undefined,
    markPatientIdentityReadbackComplete: (patientId: string) => {
      if (!patientId || booking.pendingPatientConfirmationId !== patientId || !booking.pendingPatientConfirmationName) return false;
      booking.patientIdentityReadbackCompleteForId = patientId;
      return true;
    },
    markPendingReadbackComplete: (id: string) => {
      if (!booking.pendingId || booking.pendingId !== id) return false;
      booking.readbackCompleteForPendingId = id;
      return true;
    },
    markPendingSummaryPresented: (id: string) => {
      if (!booking.pendingId || booking.pendingId !== id) return false;
      booking.summaryPresentedForPendingId = id;
      return true;
    },
    markAvailabilityReadbackComplete: () => {
      if (booking.pendingAvailableSlots.size === 0) return false;
      booking.availableSlots = new Map(booking.pendingAvailableSlots);
      booking.pendingAvailableSlots.clear();
      booking.pendingAvailabilityResponseText = undefined;
      return true;
    },
    markGuestSlotConsentPromptReadbackComplete: (slotId: string) => {
      if (booking.pendingGuestConsentPromptSlotId !== slotId || !booking.availableSlots.has(slotId)) return false;
      booking.pendingGuestConsentPromptSlotId = undefined;
      booking.awaitingGuestConsentSlotId = slotId;
      booking.guestConsentSlotId = undefined;
      return true;
    },
    cancelGuestSlotConsentPrompt: () => {
      booking.pendingGuestConsentPromptSlotId = undefined;
      booking.pendingAvailableSlots.clear();
      // A media interruption cancels only an unfinished prompt. Agreement
      // already obtained belongs to the booking, not the next audio response.
      // Heard availability remains useful for a contact repair or interruption.
      // Preparation/commit revalidates it; cancelling a prompt is not cancelling
      // the directory result or forgetting the selected appointment.
    },
  });
}
