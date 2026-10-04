import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BookingService } from "../../src/server/services/bookingService";
import { createTestDatabase } from "../helpers/testDatabase";

describe("pending booking confirmation lifecycle", () => {
  let fixture: ReturnType<typeof createTestDatabase>;
  beforeEach(() => {
    fixture = createTestDatabase();
  });
  afterEach(() => fixture.dispose());

  it("recovers the saved result after restart without creating a second guest or appointment", () => {
    const service = new BookingService(fixture.db);
    const prepared = service.prepareGuest({ doctorIdentifier: "doc-001", slotId: "slot-doc-001-1", fullName: "Aisha Example", mobileNumber: "+966501234567", language: "ar" });
    if (prepared.status !== "pending") throw new Error("Expected pending booking");
    const approval = { pendingId: prepared.pendingId, finalTranscript: "نعم", decision: "approve" as const, language: "ar" as const };
    const first = service.confirm(approval);
    expect(first.status).toBe("confirmed");
    const restarted = new BookingService(fixture.db);
    expect(restarted.confirm(approval)).toEqual(first);
    expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM appointments").get()).toEqual({ count: 1 });
    expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM patients WHERE mobile_number = '+966501234567'").get()).toEqual({ count: 1 });
    expect(restarted.cancel(prepared.pendingId, "ar").status).toBe("not_found");
    expect(restarted.confirm({ ...approval, decision: "decline" }).status).toBe("not_confirmed");
    expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM appointments").get()).toEqual({ count: 1 });
  });

  it("rolls back a booking when its durable result cannot be saved", () => {
    const service = new BookingService(fixture.db);
    const prepared = service.prepareGuest({ doctorIdentifier: "doc-001", slotId: "slot-doc-001-1", fullName: "Aisha Example", mobileNumber: "+966501234567", language: "en" });
    if (prepared.status !== "pending") throw new Error("Expected pending booking");
    fixture.db.exec("CREATE TRIGGER reject_operation BEFORE INSERT ON booking_results BEGIN SELECT RAISE(ABORT, 'result storage failed'); END");
    expect(() => service.confirm({ pendingId: prepared.pendingId, finalTranscript: "yes", decision: "approve", language: "en" })).toThrow("result storage failed");
    expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM appointments").get()).toEqual({ count: 0 });
    expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM patients WHERE mobile_number = '+966501234567'").get()).toEqual({ count: 0 });
    expect(fixture.db.prepare("SELECT status FROM slots WHERE id = 'slot-doc-001-1'").get()).toEqual({ status: "available" });
  });

  it.each(["ar", "en"] as const)("keeps January's ISO year but omits it in December booking speech (%s)", (language) => {
    fixture.db.prepare("UPDATE slots SET starts_at_utc = ? WHERE id = ?").run("2027-01-03T09:00:00.000Z", "slot-doc-005-1");
    const service = new BookingService(fixture.db, { now: () => new Date("2026-12-15T00:00:00Z") });
    const prepared = service.prepare({ patientId: "123", doctorIdentifier: "doc-005", slotId: "slot-doc-005-1", language });
    if (prepared.status !== "pending") throw new Error("Expected pending booking");
    expect(prepared.slot.startsAtUtc).toBe("2027-01-03T09:00:00.000Z");
    expect(prepared.responseText).not.toMatch(/2027|٢٠٢٧/);
    const confirmed = service.confirm({ pendingId: prepared.pendingId, finalTranscript: "yes", decision: "approve", language });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.responseText).not.toMatch(/2027|٢٠٢٧/);
    if (confirmed.status === "confirmed") expect(confirmed.appointment.startsAtUtc).toBe("2027-01-03T09:00:00.000Z");
  });

  it.each(["ar", "en"] as const)("omits the current year in preparation and confirmation in %s", (language) => {
    const now = new Date("2026-10-01T00:00:00Z");
    fixture.db.prepare("UPDATE slots SET starts_at_utc = ? WHERE id = ?").run("2026-10-03T09:00:00.000Z", "slot-doc-005-1");
    const service = new BookingService(fixture.db, { now: () => now });
    const prepared = service.prepare({ patientId: "123", doctorIdentifier: "doc-005", slotId: "slot-doc-005-1", language });
    if (prepared.status !== "pending") throw new Error("Expected pending booking");
    expect(prepared.slot.startsAtUtc).toContain("2026");
    expect(prepared.responseText).not.toMatch(/2026|٢٠٢٦/);
    const confirmed = service.confirm({ pendingId: prepared.pendingId, finalTranscript: "yes", decision: "approve", language });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.responseText).not.toMatch(/2026|٢٠٢٦/);
  });

  it.each([
    "ايه أكدها الساعة أحد عشر بالليل",
    "ايه أكدها مع ريم الدوسري",
    "ايه أكدها يوم الاثنين",
    "Yes, confirm it at eleven PM",
    "Yes, confirm it with Dr Reem",
    "Yes, confirm it on Monday",
  ])("does not treat changed confirmation details as consent: %s", (finalTranscript) => {
    const service = new BookingService(fixture.db);
    const prepared = service.prepare({ patientId: "123", doctorIdentifier: "doc-005", slotId: "slot-doc-005-1", language: "ar" });
    if (prepared.status !== "pending") throw new Error("Expected pending booking");
    expect(service.confirm({ pendingId: prepared.pendingId, finalTranscript, decision: "change", language: "ar" }).status).toBe("not_confirmed");
    expect((fixture.db.prepare("SELECT COUNT(*) AS count FROM appointments").get() as { count: number }).count).toBe(0);
    expect((fixture.db.prepare("SELECT status FROM slots WHERE id = ?").get("slot-doc-005-1") as { status: string }).status).toBe("available");
  });

  it("expires a pending confirmation without writing an appointment", () => {
    let currentTime = new Date();
    const service = new BookingService(fixture.db, {
      now: () => currentTime,
      confirmationTtlMs: 1000,
    });
    const prepared = service.prepare({
      patientId: "P-1001",
      doctorIdentifier: "doc-001",
      slotId: "slot-doc-001-1",
      language: "en",
    });
    if (prepared.status !== "pending") throw new Error("Test setup expected a pending booking.");
    currentTime = new Date(currentTime.getTime() + 1001);

    const result = service.confirm({
      pendingId: prepared.pendingId,
      finalTranscript: "yes", decision: "approve",
      language: "en",
    });

    expect(result.status).toBe("expired");
    expect((fixture.db.prepare("SELECT COUNT(*) AS count FROM appointments").get() as { count: number }).count).toBe(0);
  });

  it("cancels pending data on explicit patient correction", () => {
    const service = new BookingService(fixture.db);
    const prepared = service.prepare({
      patientId: "P-1001",
      doctorIdentifier: "doc-001",
      slotId: "slot-doc-001-1",
      language: "en",
    });
    if (prepared.status !== "pending") throw new Error("Test setup expected a pending booking.");

    const result = service.cancel(prepared.pendingId, "en");
    const laterConfirmation = service.confirm({
      pendingId: prepared.pendingId,
      finalTranscript: "yes", decision: "approve",
      language: "en",
    });

    expect(result.status).toBe("cancelled");
    expect(laterConfirmation.status).toBe("not_found");
    expect((fixture.db.prepare("SELECT status FROM slots WHERE id = ?").get("slot-doc-001-1") as { status: string }).status).toBe(
      "available",
    );
  });

  it("creates a guest profile and appointment atomically only after final confirmation", () => {
    const service = new BookingService(fixture.db);
    const prepared = service.prepareGuest({
      doctorIdentifier: "doc-001",
      slotId: "slot-doc-001-1",
      fullName: "Aisha Example",
      mobileNumber: "+966501234567",
      language: "en",
    });
    if (prepared.status !== "pending") throw new Error("Test setup expected a pending guest booking.");

    expect((fixture.db.prepare("SELECT COUNT(*) AS count FROM patients").get() as { count: number }).count).toBe(4);
    expect((fixture.db.prepare("SELECT COUNT(*) AS count FROM appointments").get() as { count: number }).count).toBe(0);

    const confirmed = service.confirm({
      pendingId: prepared.pendingId,
      finalTranscript: "Yes, please book it.", decision: "approve",
      language: "en",
    });

    expect(confirmed.status).toBe("confirmed");
    const guest = fixture.db.prepare("SELECT patient_id, full_name_en, full_name_ar, mobile_number FROM patients WHERE mobile_number = ?")
      .get("+966501234567") as { patient_id: string; full_name_en: string; full_name_ar: string; mobile_number: string };
    expect(guest.patient_id).toMatch(/^G-[A-F0-9]+$/);
    expect(guest.full_name_en).toBe("Aisha Example");
    expect(guest.full_name_ar).toBe("Aisha Example");
    expect((fixture.db.prepare("SELECT COUNT(*) AS count FROM appointments WHERE patient_id = ?").get(guest.patient_id) as { count: number }).count).toBe(1);
  });

  it("does not save guest details when the caller cancels", () => {
    const service = new BookingService(fixture.db);
    const prepared = service.prepareGuest({
      doctorIdentifier: "doc-001",
      slotId: "slot-doc-001-1",
      fullName: "Aisha Example",
      mobileNumber: "+966501234567",
      language: "en",
    });
    if (prepared.status !== "pending") throw new Error("Test setup expected a pending guest booking.");

    service.cancel(prepared.pendingId, "en");

    expect((fixture.db.prepare("SELECT COUNT(*) AS count FROM patients").get() as { count: number }).count).toBe(4);
    expect((fixture.db.prepare("SELECT COUNT(*) AS count FROM patients WHERE mobile_number IS NOT NULL").get() as { count: number }).count).toBe(0);
    expect((fixture.db.prepare("SELECT status FROM slots WHERE id = ?").get("slot-doc-001-1") as { status: string }).status).toBe("available");
  });
});
