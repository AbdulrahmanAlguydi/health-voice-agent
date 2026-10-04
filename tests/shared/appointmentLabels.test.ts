import { describe, expect, it } from "vitest";
import { appointmentLabels } from "../../src/shared/appointmentLabels";

describe("app-computed calendar language", () => {
  it("speaks Arabic periods in full rather than reading the letter م", () => {
    const labels = appointmentLabels("2026-10-03T14:00:00Z", "ar", new Date("2026-10-01T09:00:00Z"));
    for (const value of [labels.spokenDateTime, labels.spokenHijriDateTime, labels.relativeDateTime]) {
      expect(value).toContain("مساءً");
      expect(value).not.toMatch(/(?:^|\s)[مص](?:\s|$)/);
    }
  });
  it("calls noon الظهر rather than twelve مساء", () => {
    expect(appointmentLabels("2026-10-03T09:00:00Z", "ar", new Date("2026-10-01T09:00:00Z")).relativeDateTime).toContain("الظهر");
  });
  it("provides complete localized time labels for availability-window endpoints",()=>{
    const now=new Date("2026-10-01T09:00:00Z");
    expect(appointmentLabels("2026-10-03T06:00:00Z","ar",now).spokenTime).toBe("٩:٠٠ صباحًا");
    expect(appointmentLabels("2026-10-03T13:30:00Z","ar",now).spokenTime).toBe("٤:٣٠ مساءً");
    expect(appointmentLabels("2026-10-03T06:00:00Z","en",now).spokenTime).toBe("9:00");
  });
  it.each([
    ["2026-10-01T09:00:00Z", "today"],
    ["2026-10-02T09:00:00Z", "tomorrow"],
    ["2026-10-03T09:00:00Z", "in 2 days"],
    ["2026-10-08T09:00:00Z", "in 1 week"],
    ["2026-10-11T09:00:00Z", "in 1 week and 3 days"],
    ["2026-11-01T09:00:00Z", "in 1 month"],
    ["2026-11-04T09:00:00Z", "in 1 month and 3 days"],
    ["2026-12-01T09:00:00Z", "in 2 months"],
  ])("describes %s without rounding away days", (target, expected) => {
    expect(appointmentLabels(target, "en", new Date("2026-10-01T20:00:00Z")).relativeDateTime).toContain(expected);
  });
  it("counts Riyadh civil days, not elapsed 24-hour periods", () => {
    expect(appointmentLabels("2026-10-01T22:00:00Z", "en", new Date("2026-10-01T20:59:00Z")).relativeDateTime).toContain("tomorrow");
  });
  it.each([
    ["2026-01-31T09:00:00Z", "2026-02-28T09:00:00Z", "in 1 month"],
    ["2028-01-31T09:00:00Z", "2028-02-29T09:00:00Z", "in 1 month"],
    ["2026-12-31T09:00:00Z", "2027-01-02T09:00:00Z", "in 2 days"],
  ])("handles month/year boundaries %s → %s", (now, target, expected) => {
    expect(appointmentLabels(target, "en", new Date(now)).relativeDateTime).toContain(expected);
  });
  it("uses the independently documented Umm al-Qura reference: 14 October 2017 = 24 Muharram 1439", () => {
    const label = appointmentLabels("2017-10-14T09:00:00Z", "en", new Date("2017-10-01T09:00:00Z"));
    expect(label.spokenHijriDateTime).toMatch(/24 Muharram 1439/);
    expect(label.spokenHijriDateTime).toContain("12:00");
  });
  it("uses conversational Arabic duals", () => {
    expect(appointmentLabels("2026-10-03T09:00:00Z", "ar", new Date("2026-10-01T09:00:00Z")).relativeDateTime).toContain("بعد يومين");
  });
});
