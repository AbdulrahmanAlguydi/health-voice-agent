import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/server/app";
import { openDatabase } from "../../src/server/db/connection";
import { createAgentToolHandler } from "../../src/client/agent/tools";
import { TurnCoordinator } from "../../src/client/agent/turnCoordinator";
import { isUnambiguousAffirmative, isUnambiguousGuestSlotConsent } from "../../src/shared/affirmative";

describe("booking failures from the microphone session", () => {
  it.each(["ar", "en"] as const)("repairs unclear identity without discarding the found record or re-requesting ID in %s", async (language) => {
    const db = openDatabase(":memory:");
    db.prepare("UPDATE slots SET starts_at_utc = '2099-10-04T14:00:00.000Z', status = 'available' WHERE id = 'slot-doc-028-3'").run();
    const app = createApp({ db });
    const turns = new TurnCoordinator();
    const handler = createAgentToolHandler({ turns, fetch: async (path, init) => {
      const reply = await request(app).post(String(path)).send(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(reply.body), { status: reply.status });
    } });
    const call = (name: string, args: Record<string, unknown> = {}) => handler({ name, args: { ...args, language } });
    try {
      await call("get_available_slots", { doctorIdentifier: "doc-028" });
      handler.markAvailabilityReadbackComplete();
      await call("begin_booking", { patientId: "123" });
      handler.markPatientIdentityReadbackComplete("123");
      for (const caption of language === "ar" ? ["اي هذا ما في.", "ما سمعتك"] : ["I couldn't hear that", "What did you say?"]) {
        const turn = turns.beginTurn("microphone");
        turns.updateTranscript(caption, true, turn);
        const repair = await call("prepare_booking", { doctorIdentifier: "doc-028", slotId: "slot-doc-028-3" });
        expect(repair.response).toMatchObject({ status: "needs_identity_confirmation", patient: { patientId: "123" } });
        expect(handler.getBookingContext().pendingIdentityId).toBe("123");
        const replay = await call("repeat_last_response");
        expect(replay.response).toMatchObject({ status: "needs_identity_confirmation", patient: { patientId: "123" } });
        expect(db.prepare("SELECT COUNT(*) AS count FROM appointments").get()).toEqual({ count: 0 });
        handler.markPatientIdentityReadbackComplete("123");
      }
      turns.beginTypedTurn(language === "ar" ? "نعم هذا ملفي" : "Yes, that's my profile");
      await call("confirm_patient_identity", { decision: "own_record" });
      expect((await call("prepare_booking", { doctorIdentifier: "doc-028", slotId: "slot-doc-028-3" })).response.status).toBe("pending");
    } finally { db.close(); }
  });
  it.each(["ar", "en"] as const)("requires only one fresh confirmation after the final summary is presented in %s", async (language) => {
    const db = openDatabase(":memory:");
    db.prepare("UPDATE slots SET starts_at_utc = '2099-10-04T14:00:00.000Z', status = 'available' WHERE id = 'slot-doc-028-3'").run();
    const app = createApp({ db });
    const turns = new TurnCoordinator();
    const handler = createAgentToolHandler({ turns, fetch: async (path, init) => {
      const reply = await request(app).post(String(path)).send(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(reply.body), { status: reply.status });
    } });
    const call = (name: string, args: Record<string, unknown> = {}) => handler({ name, args: { ...args, language } });
    try {
      await call("get_available_slots", { doctorIdentifier: "doc-028" });
      handler.markAvailabilityReadbackComplete();
      await call("begin_booking", { continueWithoutPatientId: true });
      turns.beginTypedTurn(language === "ar" ? "اسمي بدر حمدان ورقم جوالي 12345678" : "My name is Alex Example and my mobile number is 12345678");
      const prepared = await call("prepare_guest_booking", { fullName: "Alex Example", mobileNumber: "12345678", doctorIdentifier: "doc-028", slotId: "slot-doc-028-3" });
      expect(prepared.response.status).toBe("pending");
      turns.beginTypedTurn(language === "ar" ? "اي تمام" : "Yes, confirm the booking");
      expect((await call("confirm_booking", { decision: "approve" })).response.status).toBe("pending");
      expect(db.prepare("SELECT COUNT(*) AS count FROM appointments").get()).toEqual({ count: 0 });
      handler.markPendingSummaryPresented(String(prepared.response.pendingId));
      // Playback can still be in progress; a new explicit caller confirmation is enough.
      turns.beginTypedTurn(language === "ar" ? "اي اي صحيح" : "Yes, confirm the booking");
      expect((await call("confirm_booking", { decision: "approve" })).response.status).toBe("confirmed");
      expect(db.prepare("SELECT COUNT(*) AS count FROM appointments").get()).toEqual({ count: 1 });
    } finally { db.close(); }
  });
  it.each(["واحد رقم جوالي 1 3 3", "كيف كذا؟ انا قلت لك واحد اثنين ثلاثة.", "I said one two three"])("retains incomplete caller digits during guest intake even before slot consent: %s", async (text) => {
    const turns = new TurnCoordinator();
    const handler = createAgentToolHandler({ turns, fetch: async () => new Response(JSON.stringify({ status: "ok", doctor: { doctorId: "doc-028" }, slots: [{ slotId: "slot-1" }] })) });
    await handler({ name: "begin_booking", args: { continueWithoutPatientId: true, language: "ar" } });
    await handler({ name: "get_available_slots", args: { doctorIdentifier: "ندى", language: "ar" } });
    handler.markAvailabilityReadbackComplete();
    turns.beginTypedTurn(text);
    const result = await handler({ name: "prepare_guest_booking", args: { doctorIdentifier: "doc-028", slotId: "slot-1", fullName: "بدر الغامدي", mobileNumber: "1234567", language: "ar" } });
    expect(result.response).toMatchObject({ status: "needs_clarification", validation: { code: "mobile_not_supplied" }, suppliedMobileNumber: text.includes("1 3 3") ? "133" : "123" });
  });
  it.each(["اي، احجز لي هنا.", "إيه احجز لي هالموعد", "أكيد للحجز.", "Yes, please book that time."])("recognizes ordinary booking consent: %s", (text) => {
    expect(isUnambiguousGuestSlotConsent(text)).toBe(true);
  });
  it("accepts a natural final confirmation without accepting a changed time", () => {
    expect(isUnambiguousAffirmative("أكيد للحجز.")).toBe(true);
    expect(isUnambiguousGuestSlotConsent("اي، احجز لي بس الساعة ستة بدل خمسة")).toBe(false);
  });
  it("redirects skipped ID choice instead of silently treating a caller as a guest", async () => {
    const handler = createAgentToolHandler({ fetch: async () => new Response(JSON.stringify({ status: "ok", doctor: { doctorId: "doc-028" }, slots: [{ slotId: "slot-1" }] })) });
    await handler({ name: "get_available_slots", args: { doctorIdentifier: "ندى", language: "ar" } });
    handler.markAvailabilityReadbackComplete();
    const result = await handler({ name: "confirm_guest_slot", args: { slotId: "slot-1", language: "ar" } });
    expect(result.response).toMatchObject({ status: "needs_patient_id_or_guest", speechIntent: { key: "request_patient_id" } });
    const name = await handler({ name: "speak_safe_reply", args: { messageKey: "request_guest_name", language: "ar" } });
    expect(name.response.status).toBe("needs_patient_id_or_guest");
  });
  it.each(["ar", "en"] as const)("completes a guest booking with contact repair in %s", async (language) => {
    const db = openDatabase(":memory:");
    db.prepare("UPDATE slots SET starts_at_utc = '2099-10-04T14:00:00.000Z', status = 'available' WHERE id = 'slot-doc-028-3'").run();
    const app = createApp({ db });
    const turns = new TurnCoordinator();
    const handler = createAgentToolHandler({ turns, fetch: async (path, init) => {
      const reply = await request(app).post(String(path)).send(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(reply.body), { status: reply.status });
    } });
    const call = (name: string, args: Record<string, unknown> = {}) => handler({ name, args: { ...args, language } });
    try {
      await call("get_available_slots", { doctorIdentifier: "doc-028" });
      handler.markAvailabilityReadbackComplete();
      expect((await call("begin_booking")).response.status).toBe("needs_patient_id_or_guest");
      turns.beginTypedTurn(language === "ar" ? "ما عندي رقم مريض" : "I don't have a patient ID");
      await call("begin_booking", { continueWithoutPatientId: true });
      await call("confirm_guest_slot", { slotId: "slot-doc-028-3" });
      handler.markGuestSlotConsentPromptReadbackComplete("slot-doc-028-3");
      turns.beginTypedTurn(language === "ar" ? "اي، احجز لي هنا." : "Yes, please book it");
      expect(handler.getBookingContext().guestConsentSlotId).toBe("slot-doc-028-3");
      turns.beginTypedTurn(language === "ar" ? "اسمي بدر الغامدي" : "My name is Badr Example");
      turns.beginTypedTurn(language === "ar" ? "رقم جوالي 1 2 3" : "My mobile number is 1 2 3");
      const details = { fullName: "Badr Example", mobileNumber: "1234567", doctorIdentifier: "doc-028", slotId: "slot-doc-028-3" };
      const invented = await call("prepare_guest_booking", details);
      expect(invented.response).toMatchObject({ status: "needs_clarification", validation: { field: "mobileNumber", code: "mobile_not_supplied" } });
      turns.beginTypedTurn(language === "ar" ? "٠ ٥ ٠ ١ ٢ ٣ ٤ ٥ ٦ ٧" : "0 5 0 1 2 3 4 5 6 7");
      const prepared = await call("prepare_guest_booking", { ...details, mobileNumber: "0501234567" });
      expect(prepared.response.status).toBe("pending");
      handler.markPendingReadbackComplete(String(prepared.response.pendingId));
      turns.beginTypedTurn(language === "ar" ? "أكيد للحجز." : "Yes, confirm the booking");
      expect((await call("confirm_booking", { decision: "approve" })).response.status).toBe("confirmed");
      expect(db.prepare("SELECT COUNT(*) AS count FROM appointments WHERE slot_id = 'slot-doc-028-3'").get()).toEqual({ count: 1 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM patients WHERE mobile_number = '0501234567'").get()).toEqual({ count: 1 });
    } finally { db.close(); }
  });
  it.each([
    ["ar", "اي صحيح."], ["ar", "نعم، صحيح."], ["ar", "إيه هذا ملفي"], ["en", "Yes, that's my profile"], ["en", "Yes, correct"],
  ] as const)("keeps the chosen slot through microphone identity verification in %s: %s", async (language, confirmation) => {
    const db = openDatabase(":memory:");
    db.prepare("UPDATE slots SET starts_at_utc = '2099-10-04T14:00:00.000Z', status = 'available' WHERE id = 'slot-doc-028-3'").run();
    const app = createApp({ db });
    const turns = new TurnCoordinator();
    const handler = createAgentToolHandler({ turns, fetch: async (path, init) => {
      const reply = await request(app).post(String(path)).send(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(reply.body), { status: reply.status });
    } });
    const call = (name: string, args: Record<string, unknown> = {}) => handler({ name, args: { ...args, language } });
    try {
      await call("get_available_slots", { doctorIdentifier: "doc-028" });
      handler.markAvailabilityReadbackComplete();
      await call("begin_booking");
      await call("begin_booking", { patientId: "123" });
      expect(handler.getBookingContext().availableSlotIds).toContain("slot-doc-028-3");
      handler.markPatientIdentityReadbackComplete("123");
      const microphoneTurn = turns.beginTurn("microphone");
      // Reproduce a tool arriving before final ASR, not just a completed typed turn.
      turns.updateTranscript(confirmation, false, microphoneTurn);
      const verifying = call("confirm_patient_identity", { decision: "own_record" });
      turns.updateTranscript(confirmation, true, microphoneTurn);
      expect((await verifying).response.status).toBe("identity_confirmed");
      const prepared = await call("prepare_booking", { doctorIdentifier: "doc-028", slotId: "slot-doc-028-3" });
      expect(prepared.response.status).toBe("pending");
      handler.markPendingReadbackComplete(String(prepared.response.pendingId));
      turns.beginTypedTurn(language === "ar" ? "اي احجز لي هالموعد" : "Yes please book it");
      expect((await call("confirm_booking", { decision: "approve" })).response.status).toBe("confirmed");
      expect(db.prepare("SELECT patient_id FROM appointments WHERE slot_id = 'slot-doc-028-3'").get()).toEqual({ patient_id: "123" });
    } finally { db.close(); }
  });
});
