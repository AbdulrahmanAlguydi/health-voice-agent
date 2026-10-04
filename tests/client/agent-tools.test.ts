import { describe, expect, it, vi } from "vitest";
import { TurnCoordinator } from "../../src/client/agent/turnCoordinator";
import { createAgentToolHandler } from "../../src/client/agent/tools";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const startBooking = (handler: ReturnType<typeof createAgentToolHandler>, language: "en" | "ar" = "en") =>
  handler({ id: "begin-booking", name: "begin_booking", args: { language } });

describe("Gemini application function handling", () => {
  it("offers one original-name retry after an invented English transliteration fails", async () => {
    const fetch = vi.fn().mockImplementation(async () => jsonResponse({ status: "not_found", responseText: "ما لقيت الطبيب عندنا" }));
    const turns = new TurnCoordinator();
    turns.beginTypedTurn("وش مواعيد ندى الخطيب؟");
    const handler = createAgentToolHandler({ fetch, turns });
    const call = { name: "get_available_slots", args: { doctorIdentifier: "Nada Al Khateeb", language: "ar" } };
    const result = await handler(call);
    expect(result.response).toMatchObject({ status: "not_found", originalCallerText: "وش مواعيد ندى الخطيب؟" });
    expect(result.response.nextStep).toContain("Retry once");
    expect((await handler(call)).response.originalCallerText).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2); // No automatic guessed query or write.
  });
  it("refreshes the known doctor's availability on cancellation without losing verified identity", async () => {
    const availability = { status: "ok", doctor: { doctorId: "doc-005", name: "Dr Noura" }, slots: [{ slotId: "slot-1", startsAtUtc: "2026-10-03T09:00:00Z", spokenDateTime: "Saturday, 3 October at noon" }], responseText: "Dr Noura is available Saturday, 3 October at noon." };
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "found", patient: { patientId: "123", fullName: "Test Patient" }, responseText: "Is this your profile?" }))
      .mockResolvedValueOnce(jsonResponse(availability))
      .mockResolvedValueOnce(jsonResponse({ status: "pending", pendingId: "a-pending-id-that-is-long-enough-123", responseText: "Shall I book it?" }))
      .mockResolvedValueOnce(jsonResponse({ status: "cancelled", responseText: "Nothing was booked." }))
      .mockResolvedValueOnce(jsonResponse(availability))
      .mockResolvedValueOnce(jsonResponse({ status: "pending", pendingId: "a-new-pending-id-that-is-long-enough", responseText: "Shall I book it?" }));
    const turns = new TurnCoordinator();
    const handler = createAgentToolHandler({ fetch, turns });
    await startBooking(handler);
    await handler({ name: "lookup_patient", args: { patientId: "123" } });
    handler.markPatientIdentityReadbackComplete("123");
    turns.beginTypedTurn("Yes, that's me.");
    await handler({ name: "confirm_patient_identity", args: { decision: "own_record", language: "en" } });
    await handler({ name: "get_available_slots", args: { doctorIdentifier: "Dr Noura" } });
    handler.markAvailabilityReadbackComplete();
    await handler({ name: "prepare_booking", args: { doctorIdentifier: "Dr Noura", slotId: "slot-1" } });
    turns.beginTypedTurn("Yes, confirm it at eleven PM.");
    const cancelled = await handler({ name: "cancel_pending_booking", args: {} });
    expect(cancelled.response.availability).toMatchObject(availability);
    expect(fetch.mock.calls[4]?.[0]).toBe("/api/slots/search");
    handler.markAvailabilityReadbackComplete();
    turns.beginTypedTurn("The noon appointment, then.");
    expect((await handler({ name: "prepare_booking", args: { doctorIdentifier: "Dr Noura", slotId: "slot-1" } })).response.status).toBe("pending");
  });
  it("repeats the last played conversational reply without querying a database", async () => {
    const fetch = vi.fn();
    const handler = createAgentToolHandler({ fetch, getLastConversationalReply: (language) => language === "ar" ? "أقدر أساعدك بمعلومات عن الأطباء أو بحجز موعد. وش تحتاج؟" : undefined });
    const result = await handler({ id: "repeat", name: "repeat_last_response", args: { language: "ar" } });
    expect(result.response.status).toBe("conversation_repeat");
    expect(result.response.responseText).toContain("وش تحتاج؟");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("asks for a doctor instead of ID when booking starts or the caller repeats the request", async () => {
    const fetch = vi.fn();
    const handler = createAgentToolHandler({ fetch });

    const prematureIdRequest = await handler({
      id: "safe-copy",
      name: "speak_safe_reply",
      args: { messageKey: "request_patient_id", language: "en" },
    });

    expect(prematureIdRequest.response).toMatchObject({
      status: "needs_clarification",
      responseText: "Just to make sure I understood, are you asking about a doctor or looking to book an appointment?",
    });
    expect(fetch).not.toHaveBeenCalled();

    const bookingPrompt = await handler({
      id: "begin-booking-en",
      name: "begin_booking",
      args: { language: "en" },
    });
    expect(bookingPrompt.response).toMatchObject({
      status: "needs_doctor_and_availability",
      responseText: "Is there a particular doctor you have in mind?",
    });

    const arabicBookingPrompt = await handler({
      id: "begin-booking-ar",
      name: "begin_booking",
      args: { language: "ar" },
    });
    expect(arabicBookingPrompt.response).toMatchObject({
      status: "needs_doctor_and_availability",
      responseText: "فيه طبيب معيّن في بالك؟",
    });

    const arabic = await handler({
      id: "safe-copy-ar",
      name: "speak_safe_reply",
      args: { messageKey: "repeat_request", language: "ar" },
    });
    expect(arabic.response).toMatchObject({ status: "safe_copy", responseText: "معليش، ما سمعتك زين. تقدر تعيدها بالعربي أو بالإنجليزي؟" });
    const askGuestName = await handler({ id: "guest-name", name: "speak_safe_reply", args: { messageKey: "request_guest_name", language: "ar" } });
    const askSlotApproval = await handler({ id: "slot-approval", name: "speak_safe_reply", args: { messageKey: "ask_book_selected_slot", language: "ar" } });
    expect(askGuestName.response.status).toBe("needs_doctor_and_availability");
    expect(askSlotApproval.response.responseText).toBe("أحجز لك هالموعد؟");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not let a safe-reply call skip doctor and availability selection", async () => {
    const handler = createAgentToolHandler({ fetch: vi.fn() });
    await startBooking(handler, "ar");
    const result = await handler({ name: "speak_safe_reply", args: { messageKey: "request_patient_id", language: "ar" } });
    expect(result.response.responseText).toBe("فيه طبيب معيّن في بالك؟");
  });

  it.each(["ar", "en"] as const)("defers ID until available times have actually been heard (%s)", async (language) => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ status: "ok", doctor: { doctorId: "doc-001" }, slots: [{ slotId: "slot-1" }], responseText: "Available time." }));
    const handler = createAgentToolHandler({ fetch });
    await startBooking(handler, language);
    await handler({ name: "get_available_slots", args: { doctorIdentifier: "doc-001", language } });
    const beforePlayback = await startBooking(handler, language);
    expect(beforePlayback.response.status).toBe("needs_doctor_and_availability");
    handler.markAvailabilityReadbackComplete();
    const afterPlayback = await startBooking(handler, language);
    expect(afterPlayback.response.status).toBe("needs_patient_id_or_guest");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retains the guest path when a caller repeats their booking request", async () => {
    const handler = createAgentToolHandler({ fetch: vi.fn() });
    await handler({ name: "begin_booking", args: { continueWithoutPatientId: true, language: "ar" } });
    const repeated = await startBooking(handler, "ar");
    expect(repeated.response.status).toBe("guest_booking_path");
    const question = await handler({ name: "speak_safe_reply", args: { messageKey: "request_patient_id", language: "ar" } });
    expect(question.response.responseText).not.toContain("إذا عندك رقم المريض");
  });

  it("does not query a patient profile before booking intent is explicitly started", async () => {
    const fetch = vi.fn();
    const handler = createAgentToolHandler({ fetch });

    const result = await handler({
      id: "premature-lookup",
      name: "lookup_patient",
      args: { patientId: "123", language: "en" },
    });

    expect(result.response).toMatchObject({
      status: "booking_not_started",
      responseText: "We can check your patient ID when you're ready to book. Are you asking about a doctor or looking to book an appointment?",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("looks up an ID already supplied with an explicit booking request without asking for it again", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({
      status: "found",
      patient: { patientId: "123", fullName: "Test Patient" },
      responseText: "I found a profile for Test Patient. Is that you?",
    }));
    const handler = createAgentToolHandler({ fetch });

    const result = await handler({
      id: "begin-booking-with-id",
      name: "begin_booking",
      args: { patientId: "123", language: "en" },
    });

    expect(fetch).toHaveBeenCalledWith("/api/patients/lookup", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ patientId: "123", language: "en" }),
    }));
    expect(result.response).toMatchObject({
      status: "found",
      responseText: "I found a profile for Test Patient. Is that you?",
    });
    expect(result.response.responseText).not.toContain("give me your patient ID");
  });

  it("keeps a caller who has no ID on the guest path without looking up a patient", async () => {
    const fetch = vi.fn();
    const handler = createAgentToolHandler({ fetch });

    const guestPath = await handler({
      id: "begin-booking-as-guest",
      name: "begin_booking",
      args: { continueWithoutPatientId: true, language: "en" },
    });
    const prematureLookup = await handler({
      id: "guest-patient-lookup",
      name: "lookup_patient",
      args: { patientId: "123", language: "en" },
    });

    expect(guestPath.response).toMatchObject({
      status: "guest_booking_path",
      responseText: "No problem. We can continue without a patient ID.",
    });
    expect(prematureLookup.response).toMatchObject({
      status: "guest_path_selected",
      responseText: "No problem. We can continue without a patient ID.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses an out-of-scope English request and repeats the last approved question", async () => {
    const fetch = vi.fn();
    const handler = createAgentToolHandler({
      fetch,
      getLastApprovedQuestion: () => "Which day works for you?",
    });

    const result = await handler({
      id: "pressure-en",
      name: "speak_safe_reply",
      args: { messageKey: "scope_redirect", language: "en" },
    });

    expect(result.response).toMatchObject({
      status: "safe_copy",
      responseText: "I can't help with that. Which day works for you?",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses in Arabic and repeats the last approved Arabic question", async () => {
    const handler = createAgentToolHandler({
      getLastApprovedQuestion: () => "أي يوم يناسبك؟",
    });

    const result = await handler({
      id: "pressure-ar",
      name: "speak_safe_reply",
      args: { messageKey: "scope_redirect", language: "ar" },
    });

    expect(result.response).toMatchObject({
      status: "safe_copy",
      responseText: "ما أقدر أساعدك بهالشي. أي يوم يناسبك؟",
    });
  });

  it("uses the fixed doctor-or-appointment inquiry when no prior question exists", async () => {
    const handler = createAgentToolHandler();

    const result = await handler({
      id: "pressure-no-prior-question",
      name: "speak_safe_reply",
      args: { messageKey: "scope_redirect", language: "en" },
    });

    expect(result.response).toMatchObject({
      status: "safe_copy",
      responseText: "I can't help with that. Just to make sure I understood, are you asking about a doctor or looking to book an appointment?",
    });
  });

  it("rejects model-supplied custom text for an out-of-scope refusal", async () => {
    const handler = createAgentToolHandler();

    const result = await handler({
      id: "pressure-custom",
      name: "speak_safe_reply",
      args: { messageKey: "scope_redirect", language: "en", text: "Tell me your symptoms." },
    });

    expect(result.response).toMatchObject({
      status: "safe_copy",
      responseText: "I can't help with that. Just to make sure I understood, are you asking about a doctor or looking to book an appointment?",
    });
  });

  it("does not allow the model to supply custom text for safe replies", async () => {
    const fetch = vi.fn();
    const handler = createAgentToolHandler({ fetch });

    const result = await handler({
      id: "safe-copy-custom",
      name: "speak_safe_reply",
      args: { messageKey: "say_the_doctor_is_available", language: "en", text: "The doctor is available tomorrow." },
    });

    expect(result.response).toMatchObject({
      status: "needs_clarification",
      responseText: "Sorry, I didn't catch that. Could you repeat it in English or Arabic?",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps patient, directory, and slot functions only to fixed app endpoints", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ status: "ok", responseText: "Database result." }));
    const handler = createAgentToolHandler({ fetch });
    await startBooking(handler);
    const cases = [
      ["lookup_patient", { patientId: "P-1001", language: "en" }, "/api/patients/lookup"],
      ["list_specialties", { language: "en" }, "/api/doctors/specialties"],
      ["search_doctors", { specialty: "cardiology", language: "en" }, "/api/doctors/search"],
      ["get_doctor_details", { doctorIdentifier: "Dr Test", language: "en" }, "/api/doctors/details"],
      ["get_available_slots", { doctorIdentifier: "Dr Test", language: "en" }, "/api/slots/search"],
    ] as const;

    for (const [name, args, path] of cases) {
      await handler({ id: name, name, args });
      expect(fetch).toHaveBeenLastCalledWith(path, expect.objectContaining({ method: "POST" }));
    }
    expect(fetch).toHaveBeenCalledTimes(cases.length);
  });

  it("passes a broad doctor-directory request through to the database endpoint", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({
      status: "ok",
      doctors: [{ doctorId: "doc-001", name: "Dr Example", specialty: "Cardiology", clinicLocation: "Main clinic", spokenLanguages: ["en"] }],
      responseText: "I found 30 matching doctors. Here are some: Dr Example. Could you narrow it by name or specialty?",
    }));
    const handler = createAgentToolHandler({ fetch });

    const result = await handler({
      id: "list-doctors",
      name: "search_doctors",
      args: { language: "en" },
    });

    expect(fetch).toHaveBeenCalledWith("/api/doctors/search", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ language: "en" }),
    }));
    expect(result.response).toMatchObject({ status: "ok" });
  });

  it("uses the active conversation language when the model omits language and drops unknown arguments", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ status: "found", responseText: "لقيت الملف." }));
    const handler = createAgentToolHandler({ fetch, getCurrentLanguage: () => "ar" });

    await startBooking(handler, "ar");
    await handler({
      id: "lookup-active-language",
      name: "lookup_patient",
      args: { patientId: "123", sql: "select * from patients" },
    });

    expect(fetch).toHaveBeenCalledWith("/api/patients/lookup", expect.objectContaining({
      body: JSON.stringify({ patientId: "123", language: "ar" }),
    }));
  });

  it("treats blank optional directory filters as omitted instead of failing the whole turn", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ status: "ok", responseText: "Here are some doctors." }));
    const handler = createAgentToolHandler({ fetch });

    await handler({
      id: "search-empty-filters",
      name: "search_doctors",
      args: { query: "", specialty: "   ", spokenLanguage: null, location: "", language: "en", includeAll: true },
    });

    expect(fetch).toHaveBeenCalledWith("/api/doctors/search", expect.objectContaining({
      body: JSON.stringify({ language: "en" }),
    }));
  });

  it("repeats the last database-backed directory answer in the current conversation language", async () => {
    let language: "ar" | "en" = "ar";
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "ok", responseText: "عندنا طبيب في الدليل." }))
      .mockResolvedValueOnce(jsonResponse({ status: "ok", responseText: "We have one doctor in the directory." }));
    const handler = createAgentToolHandler({ fetch, getCurrentLanguage: () => language });

    await handler({
      id: "initial-search",
      name: "search_doctors",
      args: { specialty: "طب القلب", language: "ar" },
    });
    language = "en";
    const repeated = await handler({ id: "repeat", name: "repeat_last_response", args: {} });

    expect(fetch).toHaveBeenNthCalledWith(2, "/api/doctors/search", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ specialty: "طب القلب", language: "en" }),
    }));
    expect(repeated.response).toMatchObject({
      status: "ok",
      responseText: "We have one doctor in the directory.",
    });
  });

  it("asks what to repeat when no database-backed directory answer exists", async () => {
    const fetch = vi.fn();
    const handler = createAgentToolHandler({ fetch, getCurrentLanguage: () => "ar" });

    const repeated = await handler({ id: "repeat-empty", name: "repeat_last_response", args: {} });

    expect(repeated.response).toMatchObject({
      status: "needs_clarification",
      responseText: "وش الرد اللي تبي أعيده لك؟",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks for the specific missing doctor instead of restarting with a generic failure", async () => {
    const fetch = vi.fn();
    const handler = createAgentToolHandler({ fetch });

    const result = await handler({ id: "missing-doctor", name: "get_doctor_details", args: { language: "en" } });

    expect(result.response).toMatchObject({
      status: "needs_clarification",
      responseText: "Is there a particular doctor you have in mind?",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks only for a date when a supplied appointment day cannot be safely understood", async () => {
    const fetch = vi.fn();
    const handler = createAgentToolHandler({ fetch });

    const result = await handler({
      id: "invalid-requested-date",
      name: "get_available_slots",
      args: { doctorIdentifier: "Dr Test", requestedDate: "sometime soon", language: "en" },
    });

    expect(result.response).toMatchObject({
      status: "needs_clarification",
      responseText: "What day would work best for you?",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("localizes a read-only request failure using the active Arabic conversation language", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("not json", { status: 503 }));
    const handler = createAgentToolHandler({ fetch, getCurrentLanguage: () => "ar" });

    const result = await handler({ id: "search-failed-ar", name: "search_doctors", args: {} });

    expect(result.response.responseText).toBe("ما قدرت أطلع المعلومات الحين. تبي أجرّب مرة ثانية؟");
  });

  it("normalizes a spoken numeric patient ID before looking it up", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({
      status: "found",
      patient: { patientId: "123", fullName: "Test Patient" },
      responseText: "I found a profile for Test Patient. Is that you?",
    }));
    const handler = createAgentToolHandler({ fetch });

    await startBooking(handler);
    const result = await handler({
      id: "lookup-numeric-id",
      name: "lookup_patient",
      args: { patientId: "1 2 3", language: "en" },
    });

    expect(fetch).toHaveBeenCalledWith("/api/patients/lookup", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ patientId: "123", language: "en" }),
    }));
    expect(result.response).toMatchObject({
      status: "found",
      patient: { patientId: "123", fullName: "Test Patient" },
      responseText: "I found a profile for Test Patient. Is that you?",
    });
  });

  it("rejects unknown functions but ignores extra model fields after allowlisting", async () => {
    const fetch = vi.fn();
    const handler = createAgentToolHandler({ fetch });

    const unknown = await handler({ id: "x", name: "run_sql", args: { query: "select *" } });
    fetch.mockResolvedValueOnce(jsonResponse({ status: "found", responseText: "I found the profile." }));
    await startBooking(handler);
    const known = await handler({ id: "y", name: "lookup_patient", args: { patientId: "P-1001", language: "en", sql: "select *" } });

    expect(unknown.response).toMatchObject({ status: "unsupported_function" });
    expect(known.response).toMatchObject({ status: "found" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/patients/lookup", expect.objectContaining({
      body: JSON.stringify({ patientId: "P-1001", language: "en" }),
    }));
  });

  it("requires a database-verified patient before preparing a booking", async () => {
    const fetch = vi.fn();
    const handler = createAgentToolHandler({ fetch });

    const result = await handler({
      id: "prepare",
      name: "prepare_booking",
      args: { patientId: "P-1001", doctorIdentifier: "Dr Test", slotId: "slot-1", language: "en" },
    });

    expect(result.response).toMatchObject({ status: "invalid_patient" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("prepares a guest booking without requesting or inventing a patient ID", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: "ok",
        doctor: { doctorId: "doc-001" },
        slots: [{ slotId: "slot-1" }],
        responseText: "Dr Example is available at 9.",
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: "pending",
        pendingId: "a-guest-pending-id-that-is-long-enough-123",
        responseText: "Read-back for Aisha Example.",
      }));
    const turns = new TurnCoordinator();
    const handler = createAgentToolHandler({ fetch, turns });
    await handler({ id: "slots", name: "get_available_slots", args: { doctorIdentifier: "Dr Example", language: "en" } });
    await handler({ name: "begin_booking", args: { continueWithoutPatientId: true } });
    handler.markAvailabilityReadbackComplete();
    await handler({ id: "guest-consent", name: "confirm_guest_slot", args: { slotId: "slot-1" } });
    handler.markGuestSlotConsentPromptReadbackComplete("slot-1");
    turns.beginTypedTurn("Yes, please book it.");

    const result = await handler({
      id: "guest-prepare",
      name: "prepare_guest_booking",
      args: {
        fullName: "  Aisha Example  ",
        mobileNumber: "+966 ٥٠ ١٢٣ ٤٥٦٧",
        doctorIdentifier: "doc-001",
        slotId: "slot-1",
        language: "en",
        patientId: "must-be-ignored",
      },
    });

    expect(fetch).toHaveBeenCalledWith("/api/bookings/prepare-guest", expect.objectContaining({
      body: JSON.stringify({
        fullName: "Aisha Example",
        mobileNumber: "+966501234567",
        doctorIdentifier: "doc-001",
        slotId: "slot-1",
        language: "en",
      }),
    }));
    expect(result.response).toMatchObject({ status: "pending" });
  });

  it("asks for the missing guest contact detail instead of dropping the booking intent", async () => {
    const fetch = vi.fn();
    const handler = createAgentToolHandler({ fetch });

    const result = await handler({
      id: "guest-missing-mobile",
      name: "prepare_guest_booking",
      args: { fullName: "Aisha Example", doctorIdentifier: "Dr Example", slotId: "slot-1", language: "en" },
    });

    expect(result.response).toMatchObject({
      status: "needs_clarification",
      responseText: "And what's the best mobile number to reach you on?",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires the guest slot to be read back and separately accepted before collecting details", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: "ok",
        doctor: { doctorId: "doc-001" },
        slots: [{ slotId: "slot-doc-001-1" }],
        responseText: "Dr. Khalid is available Wednesday at 9.",
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: "pending",
        pendingId: "a-guest-pending-id-that-is-long-enough-123",
        responseText: "Final read-back.",
      }));
    const turns = new TurnCoordinator();
    const handler = createAgentToolHandler({ fetch, turns });

    await handler({ id: "slots", name: "get_available_slots", args: { doctorIdentifier: "Dr Khalid", language: "en" } });
    await handler({ name: "begin_booking", args: { continueWithoutPatientId: true } });
    const prematureConsent = await handler({
      id: "premature-slot-consent",
      name: "confirm_guest_slot",
      args: { slotId: "slot-doc-001-1" },
    });
    expect(prematureConsent.response).toMatchObject({
      status: "availability_not_yet_heard",
      responseText: "Dr. Khalid is available Wednesday at 9.",
    });
    expect(handler.markAvailabilityReadbackComplete()).toBe(true);
    const consentPrompt = await handler({
      id: "slot-consent",
      name: "confirm_guest_slot",
      args: { slotId: "slot-doc-001-1" },
    });
    expect(consentPrompt.response).toMatchObject({
      status: "awaiting_guest_consent",
      responseText: "Would you like me to book this time for you?",
    });
    expect(handler.markGuestSlotConsentPromptReadbackComplete("slot-doc-001-1")).toBe(true);
    turns.beginTypedTurn("Yes, please book it.");

    const prepared = await handler({
      id: "guest-prepare-after-consent",
      name: "prepare_guest_booking",
      args: {
        fullName: "Aisha Example",
        mobileNumber: "0501234567",
        doctorIdentifier: "another doctor guessed by the model",
        slotId: "slot-doc-001-1",
        language: "en",
      },
    });

    expect(prepared.response).toMatchObject({ status: "pending" });
    expect(fetch).toHaveBeenLastCalledWith("/api/bookings/prepare-guest", expect.objectContaining({
      body: JSON.stringify({
        fullName: "Aisha Example",
        mobileNumber: "0501234567",
        doctorIdentifier: "doc-001",
        slotId: "slot-doc-001-1",
        language: "en",
      }),
    }));
  });

  it("requires a separate affirmative after the database lookup confirms the patient identity", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: "found",
        patient: { patientId: "P-1001", fullName: "Mariam" },
        responseText: "I found a profile for Mariam. Is this you?",
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: "found",
        patient: { patientId: "P-1002", fullName: "Omar" },
        responseText: "I found a profile for Omar. Is this you?",
      }));
    const turns = new TurnCoordinator();
    const handler = createAgentToolHandler({ fetch, turns });
    turns.beginTypedTurn("My ID is P-1001. Book Dr Smith.");
    await startBooking(handler);
    await handler({ id: "lookup", name: "lookup_patient", args: { patientId: "P-1001", language: "en" } });

    const result = await handler({
      id: "prepare",
      name: "prepare_booking",
      args: { patientId: "P-1001", doctorIdentifier: "Dr Smith", slotId: "slot-1", language: "en" },
    });

    expect(result.response).toMatchObject({ status: "needs_identity_confirmation" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("remembers a confirmed identity across multiple directory turns without reusing that turn as booking consent", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "found", patient: { patientId: "P-1001", fullName: "Mariam" }, responseText: "I found a profile for Mariam. Is this you?" }))
      .mockResolvedValueOnce(jsonResponse({ status: "ok", responseText: "I found cardiology doctors." }))
      .mockResolvedValueOnce(jsonResponse({ status: "pending", pendingId: "a-pending-id-that-is-long-enough-123", responseText: "Read-back." }));
    const turns = new TurnCoordinator();
    const handler = createAgentToolHandler({ fetch, turns });
    await startBooking(handler);
    await handler({ id: "lookup", name: "lookup_patient", args: { patientId: "P-1001", language: "en" } });
    handler.markPatientIdentityReadbackComplete("P-1001");
    turns.beginTypedTurn("Yes, that's me.");
    await handler({ name: "confirm_patient_identity", args: { decision: "own_record", language: "en" } });
    await handler({ id: "search", name: "search_doctors", args: { specialty: "cardiology", language: "en" } });
    turns.beginTypedTurn("Book Dr Example at the first available slot.");

    const result = await handler({
      id: "prepare",
      name: "prepare_booking",
      args: { doctorIdentifier: "Dr Example", slotId: "slot-1", language: "en" },
    });

    expect(result.response).toMatchObject({ status: "pending" });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(turns.completedConfirmationTranscript()).toBeUndefined();
  });

  it("does not verify a profile after an explicit identity denial", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(jsonResponse({
      status: "found", patient: { patientId: "P-1001", fullName: "Mariam" }, responseText: "I found a profile for Mariam. Is this you?",
    }));
    const turns = new TurnCoordinator();
    const handler = createAgentToolHandler({ fetch, turns });
    await startBooking(handler);
    await handler({ id: "lookup", name: "lookup_patient", args: { patientId: "P-1001", language: "en" } });
    handler.markPatientIdentityReadbackComplete("P-1001");
    turns.beginTypedTurn("No, that's not me.");
    await handler({ name: "confirm_patient_identity", args: { decision: "not_mine", language: "en" } });
    turns.beginTypedTurn("Yes, that's me.");
    await handler({ name: "confirm_patient_identity", args: { decision: "own_record", language: "en" } });

    const result = await handler({
      id: "prepare",
      name: "prepare_booking",
      args: { patientId: "P-1001", doctorIdentifier: "Dr Example", slotId: "slot-1", language: "en" },
    });

    expect(result.response).toMatchObject({ status: "invalid_patient" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses identity denial only once for a patient challenge and then asks for an ID", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: "found",
        patient: { patientId: "P-1001", fullName: "Mariam" },
        responseText: "I found a profile for Mariam. Is this you?",
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: "found",
        patient: { patientId: "P-1002", fullName: "Omar" },
        responseText: "I found a profile for Omar. Is this you?",
      }));
    const turns = new TurnCoordinator();
    const handler = createAgentToolHandler({ fetch, turns });
    await startBooking(handler);
    await handler({ id: "lookup", name: "lookup_patient", args: { patientId: "P-1001", language: "en" } });
    handler.markPatientIdentityReadbackComplete("P-1001");
    handler.markPatientIdentityReadbackComplete("P-1001");
    turns.beginTypedTurn("No, that is not my profile.");
    await handler({ name: "confirm_patient_identity", args: { decision: "not_mine", language: "en" } });

    const first = await handler({
      id: "first-denial",
      name: "speak_safe_reply",
      args: { messageKey: "identity_denied", language: "en" },
    });
    const repeated = await handler({
      id: "repeated-denial",
      name: "speak_safe_reply",
      args: { messageKey: "identity_denied", language: "ar" },
    });

    expect(first.response).toMatchObject({
      status: "safe_copy",
      responseText: "No problem. I won't use that profile. Could you give me the correct patient ID?",
    });
    expect(repeated.response).toMatchObject({
      status: "safe_copy",
      responseText: "تمام، عندك رقم مريض؟",
      speechIntent: expect.objectContaining({ key: "request_patient_id" }),
    });

    await handler({ id: "new-lookup", name: "lookup_patient", args: { patientId: "P-1002", language: "en" } });
    handler.markPatientIdentityReadbackComplete("P-1002");
    handler.markPatientIdentityReadbackComplete("P-1002");
    turns.beginTypedTurn("No, that is not my profile either.");
    await handler({ name: "confirm_patient_identity", args: { decision: "not_mine", language: "en" } });
    const newChallenge = await handler({
      id: "new-challenge-denial",
      name: "speak_safe_reply",
      args: { messageKey: "identity_denied", language: "en" },
    });

    expect(newChallenge.response).toMatchObject({
      status: "safe_copy",
      responseText: "No problem. I won't use that profile. Could you give me the correct patient ID?",
    });
  });

  it("does not accept an identity affirmation before the patient read-back finishes", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(jsonResponse({
      status: "found",
      patient: { patientId: "P-1001", fullName: "Mariam Al-Salem" },
      responseText: "I found a profile for Mariam Al-Salem. Is this you?",
    }));
    const turns = new TurnCoordinator();
    const handler = createAgentToolHandler({ fetch, turns });
    await startBooking(handler);
    await handler({ id: "lookup", name: "lookup_patient", args: { patientId: "P-1001", language: "en" } });
    turns.beginTypedTurn("Yes, that's me.");
    await handler({ name: "confirm_patient_identity", args: { decision: "own_record", language: "en" } });

    const result = await handler({
      id: "prepare",
      name: "prepare_booking",
      args: { patientId: "P-1001", doctorIdentifier: "Dr Example", slotId: "slot-1", language: "en" },
    });

    expect(result.response).toMatchObject({ status: "needs_identity_confirmation" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not verify a profile when the patient contradicts the returned identity", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(jsonResponse({
      status: "found",
      patient: { patientId: "P-1001", fullName: "Mariam Al-Salem" },
      responseText: "I found a profile for Mariam Al-Salem. Is this you?",
    }));
    const turns = new TurnCoordinator();
    const handler = createAgentToolHandler({ fetch, turns });
    await startBooking(handler);
    await handler({ id: "lookup", name: "lookup_patient", args: { patientId: "P-1001", language: "en" } });
    handler.markPatientIdentityReadbackComplete("P-1001");
    turns.beginTypedTurn("Yes, but that profile belongs to someone else. I want to book.");
    await handler({ name: "confirm_patient_identity", args: { decision: "not_mine", language: "en" } });

    const result = await handler({
      id: "prepare",
      name: "prepare_booking",
      args: { patientId: "P-1001", doctorIdentifier: "Dr Example", slotId: "slot-1", language: "en" },
    });

    expect(result.response).toMatchObject({ status: "invalid_patient" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not verify a named patient's profile when the caller identifies as their relative", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(jsonResponse({
      status: "found",
      patient: { patientId: "P-1001", fullName: "Mariam Al-Salem" },
      responseText: "I found a profile for Mariam Al-Salem. Is this you?",
    }));
    const turns = new TurnCoordinator();
    const handler = createAgentToolHandler({ fetch, turns });
    await startBooking(handler);
    await handler({ id: "lookup", name: "lookup_patient", args: { patientId: "P-1001", language: "en" } });
    handler.markPatientIdentityReadbackComplete("P-1001");
    handler.markPatientIdentityReadbackComplete("P-1001");
    turns.beginTypedTurn("Yes, I'm Mariam's daughter.");
    await handler({ name: "confirm_patient_identity", args: { decision: "not_mine", language: "en" } });

    const result = await handler({
      id: "prepare",
      name: "prepare_booking",
      args: { patientId: "P-1001", doctorIdentifier: "Dr Example", slotId: "slot-1", language: "en" },
    });

    expect(result.response).toMatchObject({ status: "invalid_patient" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not verify a profile when the caller explicitly gives a different name", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: "found",
        patient: { patientId: "P-1001", fullName: "Mariam Al-Salem" },
        responseText: "I found a profile for Mariam Al-Salem. Is this you?",
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: "pending",
        pendingId: "a-pending-id-that-is-long-enough-123",
        responseText: "Read-back.",
      }));
    const turns = new TurnCoordinator();
    const handler = createAgentToolHandler({ fetch, turns });
    await startBooking(handler);
    await handler({ id: "lookup", name: "lookup_patient", args: { patientId: "P-1001", language: "en" } });
    handler.markPatientIdentityReadbackComplete("P-1001");
    handler.markPatientIdentityReadbackComplete("P-1001");
    turns.beginTypedTurn("Yes, that is me. My name is Aisha.");
    await handler({ name: "confirm_patient_identity", args: { decision: "not_mine", language: "en" } });

    const result = await handler({
      id: "prepare",
      name: "prepare_booking",
      args: { patientId: "P-1001", doctorIdentifier: "Dr Example", slotId: "slot-1", language: "en" },
    });

    expect(result.response).toMatchObject({ status: "invalid_patient" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not verify a same-first-name profile with a different surname", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: "found",
        patient: { patientId: "P-1001", fullName: "Mariam Al-Salem" },
        responseText: "I found a profile for Mariam Al-Salem. Is this you?",
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: "pending",
        pendingId: "a-pending-id-that-is-long-enough-123",
        responseText: "Read-back.",
      }));
    const turns = new TurnCoordinator();
    const handler = createAgentToolHandler({ fetch, turns });
    await startBooking(handler);
    await handler({ id: "lookup", name: "lookup_patient", args: { patientId: "P-1001", language: "en" } });
    handler.markPatientIdentityReadbackComplete("P-1001");
    handler.markPatientIdentityReadbackComplete("P-1001");
    turns.beginTypedTurn("Yes, I am Mariam Al-Karim.");
    await handler({ name: "confirm_patient_identity", args: { decision: "not_mine", language: "en" } });

    const result = await handler({
      id: "prepare",
      name: "prepare_booking",
      args: { patientId: "P-1001", doctorIdentifier: "Dr Example", slotId: "slot-1", language: "en" },
    });

    expect(result.response).toMatchObject({ status: "invalid_patient" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not verify a matching first name when the caller denies the returned surname", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: "found",
        patient: { patientId: "P-1001", fullName: "Mariam Al-Salem" },
        responseText: "I found a profile for Mariam Al-Salem. Is this you?",
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: "pending",
        pendingId: "a-pending-id-that-is-long-enough-123",
        responseText: "Read-back.",
      }));
    const turns = new TurnCoordinator();
    const handler = createAgentToolHandler({ fetch, turns });
    await startBooking(handler);
    await handler({ id: "lookup", name: "lookup_patient", args: { patientId: "P-1001", language: "en" } });
    handler.markPatientIdentityReadbackComplete("P-1001");
    handler.markPatientIdentityReadbackComplete("P-1001");
    turns.beginTypedTurn("Yes, I am Mariam, not Al-Salem.");
    await handler({ name: "confirm_patient_identity", args: { decision: "not_mine", language: "en" } });

    const result = await handler({
      id: "prepare",
      name: "prepare_booking",
      args: { patientId: "P-1001", doctorIdentifier: "Dr Example", slotId: "slot-1", language: "en" },
    });

    expect(result.response).toMatchObject({ status: "invalid_patient" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not verify a matching first name when the caller gives a different surname", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        status: "found",
        patient: { patientId: "P-1001", fullName: "Mariam Al-Salem" },
        responseText: "I found a profile for Mariam Al-Salem. Is this you?",
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: "pending",
        pendingId: "a-pending-id-that-is-long-enough-123",
        responseText: "Read-back.",
      }));
    const turns = new TurnCoordinator();
    const handler = createAgentToolHandler({ fetch, turns });
    await startBooking(handler);
    await handler({ id: "lookup", name: "lookup_patient", args: { patientId: "P-1001", language: "en" } });
    handler.markPatientIdentityReadbackComplete("P-1001");
    handler.markPatientIdentityReadbackComplete("P-1001");
    turns.beginTypedTurn("Yes, I am Mariam, but my surname is Al-Karim.");
    await handler({ name: "confirm_patient_identity", args: { decision: "not_mine", language: "en" } });

    const result = await handler({
      id: "prepare",
      name: "prepare_booking",
      args: { patientId: "P-1001", doctorIdentifier: "Dr Example", slotId: "slot-1", language: "en" },
    });

    expect(result.response).toMatchObject({ status: "invalid_patient" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses the verified patient and exact completed current-turn transcript for confirmation", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "found", patient: { patientId: "P-1001", fullName: "Mariam" }, responseText: "Verified." }))
      .mockResolvedValueOnce(jsonResponse({ status: "pending", pendingId: "a-pending-id-that-is-long-enough-123", responseText: "Read-back." }))
      .mockResolvedValueOnce(jsonResponse({ status: "confirmed", responseText: "Booked." }));
    const turns = new TurnCoordinator();
    const handler = createAgentToolHandler({ fetch, turns });
    await startBooking(handler);
    await handler({ id: "lookup", name: "lookup_patient", args: { patientId: "P-1001", language: "en" } });
    handler.markPatientIdentityReadbackComplete("P-1001");
    turns.beginTypedTurn("Yes, that's me.");
    await handler({ name: "confirm_patient_identity", args: { decision: "own_record", language: "en" } });
    await handler({
      id: "prepare",
      name: "prepare_booking",
      args: { patientId: "P-1001", doctorIdentifier: "Dr Test", slotId: "slot-1", language: "en" },
    });
    expect(handler.markPendingReadbackComplete("a-pending-id-that-is-long-enough-123")).toBe(true);
    turns.beginTypedTurn("Yes, please book it.");

    const result = await handler({
      id: "confirm",
      name: "confirm_booking",
      args: { decision: "approve", language: "en" },
    });

    expect(result.response).toMatchObject({ status: "confirmed" });
    expect(fetch).toHaveBeenLastCalledWith("/api/bookings/confirm", expect.objectContaining({
      body: JSON.stringify({
        pendingId: "a-pending-id-that-is-long-enough-123",
        language: "en",
        finalTranscript: "Yes, please book it.",
        decision: "approve",
      }),
    }));
  });

  it("cancels instead of booking when the semantic decision is a correction", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "found", patient: { patientId: "P-1001", fullName: "Mariam" }, responseText: "Verified." }))
      .mockResolvedValueOnce(jsonResponse({ status: "pending", pendingId: "a-pending-id-that-is-long-enough-123", responseText: "Read-back." }))
      .mockResolvedValueOnce(jsonResponse({ status: "cancelled", responseText: "Nothing booked." }));
    const turns = new TurnCoordinator();
    const handler = createAgentToolHandler({ fetch, turns });
    await startBooking(handler);
    await handler({ id: "lookup", name: "lookup_patient", args: { patientId: "P-1001", language: "en" } });
    handler.markPatientIdentityReadbackComplete("P-1001");
    turns.beginTypedTurn("Yes, that's me.");
    await handler({ name: "confirm_patient_identity", args: { decision: "own_record", language: "en" } });
    await handler({ id: "prepare", name: "prepare_booking", args: { patientId: "P-1001", doctorIdentifier: "Dr Test", slotId: "slot-1", language: "en" } });
    handler.markPendingReadbackComplete("a-pending-id-that-is-long-enough-123");
    turns.beginTypedTurn("Yes, but make it later.");

    const result = await handler({ id: "confirm", name: "confirm_booking", args: { decision: "change", pendingId: "a-pending-id-that-is-long-enough-123", language: "en" } });

    expect(result.response).toMatchObject({ status: "not_confirmed" });
    expect(fetch).toHaveBeenLastCalledWith("/api/bookings/cancel", expect.anything());
    expect(fetch).not.toHaveBeenCalledWith("/api/bookings/confirm", expect.anything());
  });

  it("retains the draft but refuses to commit before booking read-back audio completes", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "found", patient: { patientId: "P-1001", fullName: "Mariam" }, responseText: "Verified." }))
      .mockResolvedValueOnce(jsonResponse({ status: "pending", pendingId: "a-pending-id-that-is-long-enough-123", responseText: "Read-back." }))
      .mockResolvedValueOnce(jsonResponse({ status: "cancelled", responseText: "Nothing booked." }));
    const turns = new TurnCoordinator();
    const handler = createAgentToolHandler({ fetch, turns });
    await startBooking(handler);
    await handler({ id: "lookup", name: "lookup_patient", args: { patientId: "P-1001", language: "en" } });
    handler.markPatientIdentityReadbackComplete("P-1001");
    turns.beginTypedTurn("Yes, that's me.");
    await handler({ name: "confirm_patient_identity", args: { decision: "own_record", language: "en" } });
    await handler({ id: "prepare", name: "prepare_booking", args: { patientId: "P-1001", doctorIdentifier: "Dr Test", slotId: "slot-1", language: "en" } });
    turns.beginTypedTurn("Yes please");

    const result = await handler({ id: "confirm", name: "confirm_booking", args: { decision: "approve", pendingId: "a-pending-id-that-is-long-enough-123", language: "en" } });

    expect(result.response).toMatchObject({ status: "pending", pendingId: "a-pending-id-that-is-long-enough-123" });
    expect(fetch).not.toHaveBeenCalledWith("/api/bookings/cancel", expect.anything());
    expect(fetch).not.toHaveBeenCalledWith("/api/bookings/confirm", expect.anything());
  });

  it("ends locally without contacting a backend", async () => {
    const fetch = vi.fn();
    const onEndSession = vi.fn();
    const handler = createAgentToolHandler({ fetch, onEndSession });

    const result = await handler({ id: "end", name: "end_session", args: {} });

    expect(result.response).toMatchObject({ status: "ending" });
    expect(onEndSession).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
});
