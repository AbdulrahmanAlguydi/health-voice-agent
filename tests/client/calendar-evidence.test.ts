import { describe, expect, it } from "vitest";
import { createAvailabilitySpeechEvidence, createBookingSpeechEvidence } from "../../src/client/agent/speechPolicy";
const date = { spokenDateTime: "Saturday, 3 October at noon", spokenHijriDateTime: "Saturday, 22 Rabiʻ II 1448 AH at noon", relativeDateTime: "in 2 days at noon", startsAtUtc: "2026-10-03T09:00:00Z" };
describe("paired calendar evidence", () => {
  it("grounds relative availability in the exact same slot's Gregorian/Hijri dates", () => {
    const evidence = createAvailabilitySpeechEvidence("get_available_slots", { status: "ok", doctor: { name: "Dr Noura" }, slots: [{ slotId: "slot-1", ...date }], responseText: "Dr Noura, in 2 days at noon." }, "en");
    expect(evidence?.appointmentDates?.[0]).toMatchObject({ gregorian: "Saturday, 3 October at noon", hijri: "Saturday, 22 Rabiʻ II 1448 AH at noon", relative: "in 2 days at noon" });
    expect(evidence?.allowRelativeDates).toBe(true);
  });
  it("supports only absolute calendar equivalents in final readback evidence", () => {
    const evidence = createBookingSpeechEvidence({ status: "pending", slot: date, responseText: "Dr Noura, Saturday, 3 October at noon. Shall I book it?" });
    expect(evidence?.allowRelativeDates).toBe(false);
    expect(evidence?.appointmentDates?.[0]?.hijri).toContain("1448");
    expect(evidence?.appointmentDates?.[0]).not.toHaveProperty("relative");
  });
});
