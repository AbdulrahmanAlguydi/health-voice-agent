import { describe, expect, it } from "vitest";
import { formatAppointmentDateTime } from "../../src/shared/appointmentDateTime";

const latinDigits = (value: string) => value.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));

describe("spoken appointment dates", () => {
  it.each(["ar", "en"] as const)("omits next January's year when now is December (%s)", (language) => {
    const result = latinDigits(formatAppointmentDateTime("2027-01-03T09:00:00Z", language, new Date("2026-12-01T00:00:00Z")));
    expect(result).not.toContain("2027");
    expect(result).toMatch(language === "ar" ? /يناير/ : /January/);
    expect(result).toContain("12");
  });
  it.each([
    ["2026-11-30T20:59:59Z", "2027-01-03T09:00:00Z", "2027"],
    ["2026-12-01T00:00:00Z", "2027-02-03T09:00:00Z", "2027"],
    ["2026-12-01T00:00:00Z", "2028-01-03T09:00:00Z", "2028"],
  ])("keeps the year outside the immediate rollover (%s → %s)", (now, appointment, year) => {
    expect(formatAppointmentDateTime(appointment, "en", new Date(now))).toContain(year);
  });
  it("uses Riyadh's December boundary for next-January omission", () => {
    expect(formatAppointmentDateTime("2027-01-03T09:00:00Z", "en", new Date("2026-11-30T21:00:00Z"))).not.toContain("2027");
  });
  it.each(["ar", "en"] as const)("omits the current Riyadh year in %s", (language) => {
    const result = latinDigits(formatAppointmentDateTime("2026-10-03T09:00:00Z", language, new Date("2026-10-01T00:00:00Z")));
    expect(result).not.toContain("2026");
    expect(result).toMatch(language === "ar" ? /أكتوبر/ : /October/);
    expect(result).toContain("12");
  });
  it.each(["ar", "en"] as const)("keeps a different year in %s", (language) => {
    expect(latinDigits(formatAppointmentDateTime("2027-10-03T09:00:00Z", language, new Date("2026-10-01T00:00:00Z")))).toContain("2027");
  });
  it("compares years in Riyadh rather than UTC", () => {
    const now = new Date("2026-12-31T22:00:00Z");
    expect(formatAppointmentDateTime("2027-01-02T09:00:00Z", "en", now)).not.toContain("2027");
    expect(formatAppointmentDateTime("2026-12-31T19:00:00Z", "en", now)).toContain("2026");
  });
});
