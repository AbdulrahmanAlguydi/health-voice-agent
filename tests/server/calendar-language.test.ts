import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "../helpers/testDatabase";
import { getAvailableSlots } from "../../src/server/services/slotService";
import { BookingService } from "../../src/server/services/bookingService";
let fixture: ReturnType<typeof createTestDatabase>;
beforeEach(() => {
  fixture = createTestDatabase();
  fixture.db.prepare("UPDATE slots SET starts_at_utc = ?, status = 'available' WHERE id = ?").run("2026-10-03T09:00:00.000Z", "slot-doc-005-1");
});
afterEach(() => fixture.dispose());

describe("availability versus confirmation date language", () => {
  it("offers app-computed relative labels and preserves both absolute calendars", () => {
    fixture.db.prepare("UPDATE slots SET starts_at_utc = ?, status = 'available' WHERE id = ?").run("2026-10-03T09:00:00.000Z", "slot-doc-005-1");
    const result = getAvailableSlots(fixture.db, { doctorIdentifier: "doc-005", requestedDate: "2026-10-03", language: "ar" }, new Date("2026-10-01T00:00:00Z"));
    if (result.status !== "ok") throw new Error("Expected availability");
    expect(result.responseText).toContain("بعد يومين");
    expect(result.slots[0].spokenDateTime).toContain("أكتوبر");
    expect(result.slots[0].spokenHijriDateTime).toContain("١٤٤٨");
    expect(result.slots[0].startsAtUtc).toBe("2026-10-03T09:00:00.000Z");
  });
  it("answers a Hijri request using the converted absolute calendar date", () => {
    const result = getAvailableSlots(fixture.db, { doctorIdentifier: "doc-005", requestedDate: "2026-10-03", language: "ar", dateStyle: "hijri" }, new Date("2026-10-01T00:00:00Z"));
    if (result.status !== "ok") throw new Error("Expected availability");
    expect(result.responseText).toContain(result.slots[0].spokenHijriDateTime);
    expect(result.responseText).not.toContain("بعد يومين");
  });
  it("prepares an absolute readback, not a relative-only confirmation", () => {
    const prepared = new BookingService(fixture.db, { now: () => new Date("2026-10-01T00:00:00Z") }).prepare({ patientId: "123", doctorIdentifier: "doc-005", slotId: "slot-doc-005-1", language: "ar" });
    if (prepared.status !== "pending") throw new Error("Expected preparation");
    expect(prepared.responseText).toContain("أكتوبر");
    expect(prepared.responseText).not.toContain("بعد يومين");
    expect(prepared.slot.spokenHijriDateTime).toContain("١٤٤٨");
    expect(prepared.slot).not.toHaveProperty("relativeDateTime");
  });
  it("retains an explicit Hijri choice through final consent and booking success", () => {
    const service = new BookingService(fixture.db, { now: () => new Date("2026-10-01T00:00:00Z") });
    const prepared = service.prepare({ patientId: "123", doctorIdentifier: "doc-005", slotId: "slot-doc-005-1", language: "ar", calendar: "hijri" });
    if (prepared.status !== "pending") throw new Error("Expected pending booking");
    expect(prepared.responseText).toContain("ربيع الآخر");
    expect(prepared.responseText).not.toContain("أكتوبر");
    const confirmed = service.confirm({ pendingId: prepared.pendingId, finalTranscript: "نعم", decision: "approve", language: "ar" });
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.responseText).toContain("ربيع الآخر");
    expect(confirmed.responseText).not.toContain("بعد يومين");
  });
});
