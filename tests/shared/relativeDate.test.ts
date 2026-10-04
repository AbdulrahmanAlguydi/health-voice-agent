import { describe, expect, it } from "vitest";
import { normalizeCommonRelativeDate } from "../../src/shared/relativeDate";

describe("normalizing common appointment dates", () => {
  const now = new Date("2026-09-29T12:00:00.000Z");

  it("resolves common English and Arabic relative days in Riyadh time", () => {
    expect(normalizeCommonRelativeDate("tomorrow", now)).toBe("2026-09-30");
    expect(normalizeCommonRelativeDate("بعد بكرة", now)).toBe("2026-10-01");
    expect(normalizeCommonRelativeDate("غداً", now)).toBe("2026-09-30");
    expect(normalizeCommonRelativeDate("اليوم", now)).toBe("2026-09-29");
  });

  it("leaves ISO dates intact and refuses to guess unclear dates", () => {
    expect(normalizeCommonRelativeDate("2026-10-04", now)).toBe("2026-10-04");
    expect(normalizeCommonRelativeDate("next Friday", now)).toBeUndefined();
    expect(normalizeCommonRelativeDate("sometime soon", now)).toBeUndefined();
    expect(normalizeCommonRelativeDate("", now)).toBeUndefined();
  });

  it("uses the Riyadh calendar date near UTC midnight", () => {
    expect(normalizeCommonRelativeDate("tomorrow", new Date("2026-09-29T22:00:00.000Z"))).toBe("2026-10-01");
  });
});
