import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/server/app";
import { openDatabase } from "../../src/server/db/connection";
import { createAgentToolHandler } from "../../src/client/agent/tools";
import { TurnCoordinator } from "../../src/client/agent/turnCoordinator";

function setup(loseConfirmResponse = false, holdPrepareResponse?: () => Promise<void>) {
  const db = openDatabase(":memory:");
  db.prepare("UPDATE slots SET starts_at_utc = '2099-10-04T14:00:00.000Z', status = 'available' WHERE id = 'slot-doc-028-3'").run();
  const app = createApp({ db });
  const turns = new TurnCoordinator();
  const handler = createAgentToolHandler({ turns, fetch: async (path, init) => {
    const result = await request(app).post(String(path)).send(JSON.parse(String(init?.body)));
    if (String(path) === "/api/bookings/prepare") await holdPrepareResponse?.();
    if (loseConfirmResponse && String(path) === "/api/bookings/confirm") {
      loseConfirmResponse = false;
      throw new Error("Response lost after commit");
    }
    return new Response(JSON.stringify(result.body), { status: result.status });
  } });
  const call = (name: string, args: Record<string, unknown> = {}) => handler({ name, args: { language: "ar", ...args } });
  const input = (text: string) => { const id = turns.beginTurn("microphone"); turns.updateTranscript(text, true, id); };
  const lookup = async () => { await call("get_available_slots", { doctorIdentifier: "doc-028" }); handler.markAvailabilityReadbackComplete(); await call("begin_booking", { patientId: "123" }); handler.markPatientIdentityReadbackComplete("123"); };
  return { db, turns, handler, call, input, lookup };
}

describe("explicit semantic decisions and authoritative booking progress", () => {
  it("reconciles a lost successful commit before explicitly stopping", async () => {
    const s = setup(true);
    try {
      await s.lookup(); s.input("هذا ملفي");
      await s.call("confirm_patient_identity", { decision: "own_record" });
      const prepared = await s.call("prepare_booking", { doctorIdentifier: "doc-028", slotId: "slot-doc-028-3" });
      s.handler.markPendingSummaryPresented(String(prepared.response.pendingId));
      s.input("موافق");
      expect((await s.call("confirm_booking", { decision: "approve" })).response.status).toBe("outcome_unknown");
      await s.handler.cancelPending("ar");
      expect(s.handler.getBookingContext().pendingId).toBeUndefined();
      expect(s.handler.getBookingContext().outcomeUnknown).toBe(false);
      expect(s.db.prepare("SELECT COUNT(*) AS count FROM appointments").get()).toEqual({ count: 1 });
    } finally { s.db.close(); }
  });
  it("waits for an in-flight preparation before explicitly stopping its draft", async () => {
    let release!: () => void;
    let started!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const arrived = new Promise<void>((resolve) => { started = resolve; });
    const s = setup(false, async () => { started(); await held; });
    try {
      await s.lookup(); s.input("هذا ملفي");
      await s.call("confirm_patient_identity", { decision: "own_record" });
      const preparation = s.call("prepare_booking", { doctorIdentifier: "doc-028", slotId: "slot-doc-028-3" });
      await arrived;
      const stopping = s.handler.cancelPending("ar");
      release();
      await preparation; await stopping;
      expect(s.handler.getBookingContext().pendingId).toBeUndefined();
      expect(s.handler.getBookingContext().bookingIntentActive).toBe(false);
      expect(s.db.prepare("SELECT COUNT(*) AS count FROM appointments").get()).toEqual({ count: 0 });
    } finally { release(); s.db.close(); }
  });
  it("retains the operation after a lost commit response and recovers it on retry", async () => {
    const s = setup(true);
    try {
      await s.lookup(); s.input("هذا ملفي");
      await s.call("confirm_patient_identity", { decision: "own_record" });
      const prepared = await s.call("prepare_booking", { doctorIdentifier: "doc-028", slotId: "slot-doc-028-3" });
      s.handler.markPendingSummaryPresented(String(prepared.response.pendingId));
      s.input("نعم أؤكد");
      const unknown = await s.call("confirm_booking", { decision: "approve" });
      expect(unknown.response.status).toBe("outcome_unknown");
      expect(s.handler.getBookingContext().pendingId).toBe(prepared.response.pendingId);
      expect(s.db.prepare("SELECT COUNT(*) AS count FROM appointments").get()).toEqual({ count: 1 });
      // A transport retry reuses the approval already given, not a new caller yes.
      expect((await s.call("confirm_booking", { decision: "approve" })).response.status).toBe("confirmed");
      expect(s.handler.getBookingContext().pendingId).toBeUndefined();
      expect(s.db.prepare("SELECT COUNT(*) AS count FROM appointments").get()).toEqual({ count: 1 });
    } finally { s.db.close(); }
  });
  it.each(["approve", "decline", "change", "unclear"])("cannot commit a booking before a draft exists: %s", async (decision) => {
    const s = setup();
    try {
      s.input("أبي موعد");
      expect((await s.call("confirm_booking", { decision })).response.status).not.toBe("confirmed");
      expect(s.db.prepare("SELECT COUNT(*) AS count FROM appointments").get()).toEqual({ count: 0 });
    } finally { s.db.close(); }
  });
  it("cannot confirm identity without a lookup or before its name has been delivered", async () => {
    const s = setup();
    try {
      s.input("اي هذا ملفي");
      expect((await s.call("confirm_patient_identity", { decision: "own_record" })).response.status).toBe("invalid_patient");
      expect((await s.call("confirm_patient_identity")).response.status).toBe("invalid_patient");
      await s.call("begin_booking", { patientId: "123" });
      s.input("اي هذا ملفي");
      expect((await s.call("confirm_patient_identity", { decision: "own_record" })).response.status).toBe("needs_identity_confirmation");
      expect(s.handler.getBookingContext().verifiedPatientId).toBeUndefined();
    } finally { s.db.close(); }
  });
  it.each(["unclear", "change", "decline", undefined])("does not write from missing or non-approval decisions: %s", async (decision) => {
    const s = setup();
    try {
      await s.lookup(); s.input("هذا ملفي");
      await s.call("confirm_patient_identity", { decision: "own_record" });
      const prepared = await s.call("prepare_booking", { doctorIdentifier: "doc-028", slotId: "slot-doc-028-3" });
      s.handler.markPendingSummaryPresented(String(prepared.response.pendingId));
      s.input("خلني أفكر، أو غير الوقت");
      await s.call("confirm_booking", decision ? { decision } : {});
      expect(s.db.prepare("SELECT COUNT(*) AS count FROM appointments").get()).toEqual({ count: 0 });
      if (!decision || decision === "unclear") {
        expect(s.handler.getBookingContext().pendingId).toBe(prepared.response.pendingId);
        s.input("موافق على نفس التفاصيل");
        expect((await s.call("confirm_booking", { decision: "approve" })).response.status).toBe("confirmed");
      } else expect(s.handler.getBookingContext().pendingId).toBeUndefined();
    } finally { s.db.close(); }
  });
  it("requires fresh post-lookup evidence and does not parse ordinary agreement on its own", async () => {
    const s = setup();
    try {
      await s.lookup();
      expect((await s.call("confirm_patient_identity", { decision: "own_record" })).response.status).toBe("needs_identity_confirmation");
      s.input("yes");
      expect(s.handler.getBookingContext().verifiedPatientId).toBeUndefined();
      expect((await s.call("prepare_booking", { doctorIdentifier: "doc-028", slotId: "slot-doc-028-3" })).response.status).toBe("needs_identity_confirmation");
      expect((await s.call("confirm_patient_identity", { decision: "own_record" })).response.status).toBe("identity_confirmed");
    } finally { s.db.close(); }
  });
  it.each(["اي، هذا ملفي.", "اي، هذا الملف حقي.", "Yes, that's my record."])("books from semantic decisions, not caption phrase matching: %s", async (text) => {
    const s = setup();
    try {
      await s.lookup(); s.input(text);
      expect((await s.call("confirm_patient_identity", { decision: "own_record" })).response.status).toBe("identity_confirmed");
      const prepared = await s.call("prepare_booking", { doctorIdentifier: "doc-028", slotId: "slot-doc-028-3" });
      expect(prepared.response).toMatchObject({ status: "pending", bookingStage: "awaiting_final_approval" });
      s.handler.markPendingSummaryPresented(String(prepared.response.pendingId));
      // Identity agreement must not also approve the later appointment summary.
      expect((await s.call("confirm_booking", { decision: "approve" })).response.status).not.toBe("confirmed");
      s.input("نعم، أؤكد الموعد.");
      const confirmed = await s.call("confirm_booking", { decision: "approve" });
      expect(confirmed.response).toMatchObject({ status: "confirmed", bookingStage: "booked" });
      s.input("نعم مرة ثانية");
      expect((await s.call("confirm_booking", { decision: "approve" })).response.status).toBe("already_confirmed");
      expect(s.db.prepare("SELECT COUNT(*) AS count FROM appointments").get()).toEqual({ count: 1 });
    } finally { s.db.close(); }
  });
  it("retains an unclear identity but rejects a record the caller says is not theirs", async () => {
    const s = setup();
    try {
      await s.lookup(); s.input("اي هذا ما في");
      expect((await s.call("confirm_patient_identity", { decision: "unclear" })).response.status).toBe("needs_identity_confirmation");
      s.input("أؤكد الموعد");
      expect((await s.call("confirm_booking", { decision: "approve" })).response.status).toBe("needs_identity_confirmation");
      s.input("مو ملفي");
      expect((await s.call("confirm_patient_identity", { decision: "not_mine" })).response.status).toBe("identity_rejected");
      expect(s.handler.getBookingContext().pendingIdentityId).toBeUndefined();
      expect(s.db.prepare("SELECT COUNT(*) AS count FROM appointments").get()).toEqual({ count: 0 });
    } finally { s.db.close(); }
  });
});
