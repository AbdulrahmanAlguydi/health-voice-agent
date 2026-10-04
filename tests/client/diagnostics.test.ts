import { describe, expect, it } from "vitest";
import { shouldEnablePrototypeDiagnostics } from "../../src/client/logging/diagnostics";

describe("prototype diagnostics visibility", () => {
  it("keeps diagnostics off in production even when explicitly requested", () => {
    expect(shouldEnablePrototypeDiagnostics("production", true)).toBe(false);
  });

  it("keeps diagnostics available for local development and tests", () => {
    expect(shouldEnablePrototypeDiagnostics("development")).toBe(true);
    expect(shouldEnablePrototypeDiagnostics("test")).toBe(true);
  });

  it("allows development diagnostics to be hidden explicitly", () => {
    expect(shouldEnablePrototypeDiagnostics("development", false)).toBe(false);
  });
});
