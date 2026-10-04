import { describe, expect, it } from "vitest";
import { normalizeSimulatedCallingNumber } from "../../src/shared/simulatedCallingNumber";

describe("simulated calling number", () => {
  it.each(["0500000000", "٠٥٠ ٠٠٠ ٠٠٠٠", "+966 (50) 000-0000"])("normalizes %s", (input) => {
    expect(normalizeSimulatedCallingNumber(input)).toBe("0500000000");
  });
  it("allows an unknown caller number", () => {
    expect(normalizeSimulatedCallingNumber("  ")).toBeUndefined();
  });
  it.each(["123", "05000000000", "hello 0500000000", "0400000000"])("rejects %s without guessing", (input) => {
    expect(() => normalizeSimulatedCallingNumber(input)).toThrow();
  });
});
