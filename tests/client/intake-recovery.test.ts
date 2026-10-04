import { describe, expect, it } from "vitest";
import { createAgentToolHandler } from "../../src/client/agent/tools";
import { verifyOutputLocally } from "../../src/client/agent/localOutputVerification";
import { TurnCoordinator } from "../../src/client/agent/turnCoordinator";
import { isUnambiguousGuestSlotConsent } from "../../src/shared/affirmative";

describe("intake repair", () => {
  it("allows guest detail intake without an extra preliminary slot confirmation", async () => {
    const handler = createAgentToolHandler();
    await handler({ name: "begin_booking", args: { continueWithoutPatientId: true, language: "en" } });
    const result = await handler({ name: "speak_safe_reply", args: { messageKey: "request_guest_name", language: "en" } });
    expect(result.response.status).toBe("safe_copy");
    expect(result.response.speechIntent).toMatchObject({ key: "request_guest_name" });
  });
  it("understands ordinary consent to the offered time without treating corrections as consent", () => {
    expect(isUnambiguousGuestSlotConsent("Yes, that time works for me.")).toBe(true);
    expect(isUnambiguousGuestSlotConsent("إيه، يناسبني هذا الموعد.")).toBe(true);
    expect(isUnambiguousGuestSlotConsent("Yes, but at 6 PM instead.")).toBe(false);
    expect(isUnambiguousGuestSlotConsent("إيه، بس يوم ثاني.")).toBe(false);
  });
  it("grounds a guest consent question in the selected, already heard slot", async () => {
    const handler = createAgentToolHandler({ fetch: async () => new Response(JSON.stringify({ status: "ok", doctor: { doctorId: "doc-1" }, slots: [{ slotId: "slot-1", spokenDateTime: "Saturday 3 October at 12:00", spokenHijriDateTime: "22 Rabi II at 12:00", relativeDateTime: "tomorrow at 12:00" }], responseText: "Tomorrow noon" })) });
    await handler({ name: "begin_booking", args: { continueWithoutPatientId: true } });
    await handler({ name: "get_available_slots", args: { doctorIdentifier: "Noura", language: "en" } });
    handler.markAvailabilityReadbackComplete();
    const result = await handler({ name: "confirm_guest_slot", args: { slotId: "slot-1", language: "en" } });
    expect(result.response.slot).toMatchObject({ slotId: "slot-1", relativeDateTime: "tomorrow at 12:00" });
  });
  it("preserves already-heard slots when an unrelated output is interrupted", async () => {
    const handler = createAgentToolHandler({ fetch: async () => new Response(JSON.stringify({ status: "ok", doctor: { doctorId: "doc-1" }, slots: [{ slotId: "slot-1" }], responseText: "Tomorrow noon" })) });
    await handler({ name: "begin_booking", args: { continueWithoutPatientId: true } });
    await handler({ name: "get_available_slots", args: { doctorIdentifier: "Noura", language: "en" } });
    handler.markAvailabilityReadbackComplete();
    handler.cancelGuestSlotConsentPrompt();
    expect((await handler({ name: "confirm_guest_slot", args: { slotId: "slot-1", language: "en" } })).response.status).toBe("awaiting_guest_consent");
  });
  it("keeps the guest's existing slot agreement through an interrupted contact question", async () => {
    const turns = new TurnCoordinator();
    const handler = createAgentToolHandler({ turns, fetch: async () => new Response(JSON.stringify({ status: "ok", doctor: { doctorId: "doc-1" }, slots: [{ slotId: "slot-1" }], responseText: "Tomorrow noon" })) });
    await handler({ name: "begin_booking", args: { continueWithoutPatientId: true } });
    await handler({ name: "get_available_slots", args: { doctorIdentifier: "Noura", language: "en" } });
    handler.markAvailabilityReadbackComplete();
    await handler({ name: "confirm_guest_slot", args: { slotId: "slot-1", language: "en" } });
    handler.markGuestSlotConsentPromptReadbackComplete("slot-1");
    turns.beginTypedTurn("Yes, that time works for me.");
    handler.cancelGuestSlotConsentPrompt();
    expect(handler.getBookingContext().guestConsentSlotId).toBe("slot-1");
    expect(handler.getReceptionIntent()).toBe("request_guest_name");
  });
  it("provides actionable mobile validation without losing previously given details", async () => {
    const handler = createAgentToolHandler({ turns: new TurnCoordinator() });
    const result = await handler({ name: "prepare_guest_booking", args: { fullName: "Badr Badr", mobileNumber: "123", doctorIdentifier: "Noura", slotId: "slot-1", language: "ar" } });
    expect(result.response).toMatchObject({ status: "needs_clarification", validation: { field: "mobileNumber", code: "invalid_mobile", minDigits: 7, maxDigits: 15 }, speechIntent: { key: "request_guest_mobile" } });
  });
  it("accepts a natural mobile repair instead of demanding a doctor name", async () => {
    const result = await verifyOutputLocally({ language: "ar", transcript: "الرقم ناقص، عطيني رقم جوالك كامل.", evidence: { sourceText: "Repair mobile number", requiredPhrases: [], records: [{ name: "د. ندى الخطيب" }], receptionIntent: "request_guest_mobile" } });
    expect(result.approved).toBe(true);
  });
});
