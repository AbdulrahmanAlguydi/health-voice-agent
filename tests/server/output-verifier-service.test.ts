import { describe, expect, it } from "vitest";
import type { Models } from "@google/genai";
import { createOutputVerifier } from "../../src/server/services/outputVerificationService";

// Only the external SDK boundary is stubbed; exercise the real service's verdict handling.
const models = {
  generateContent: async () => ({ text: JSON.stringify({ approved: true, conversational: true, reason: "supported" }) }),
} as unknown as Pick<Models, "generateContent">;

describe("output verifier replay classification", () => {
  it("provides the December clock so next January is not mistaken for this January", async () => {
    let payload = "";
    const boundary = { generateContent: async (input: { contents: string }) => { payload = input.contents; return { text: JSON.stringify({ approved: true, conversational: false, reason: "supported" }) }; } } as unknown as Pick<Models, "generateContent">;
    await createOutputVerifier(boundary, undefined, () => new Date("2026-12-15T00:00:00Z"))({ language: "en", transcript: "Sunday, 3 January at noon. Shall I book it?", expectedText: "Sunday, 3 January at 12:00. Shall I book it?" });
    expect(JSON.parse(payload).currentRiyadhYear).toBe("2026");
    expect(JSON.parse(payload).currentRiyadhMonth).toBe("12");
  });
  it("supplies the authoritative Riyadh year for current-year readbacks", async () => {
    let payload = "";
    const boundary = { generateContent: async (input: { contents: string }) => { payload = input.contents; return { text: JSON.stringify({ approved: true, conversational: false, reason: "supported" }) }; } } as unknown as Pick<Models, "generateContent">;
    await createOutputVerifier(boundary)({ language: "en", transcript: "Saturday, 3 October at noon. Shall I book it?", expectedText: "Saturday, 3 October at 12:00 PM. Shall I book it?" });
    expect(JSON.parse(payload).currentRiyadhYear).toBe(new Intl.DateTimeFormat("en", { timeZone: "Asia/Riyadh", year: "numeric" }).format(new Date()));
  });
  it("never marks an expected identity-intake reply as conversational even if the provider does", async () => {
    const verdict = await createOutputVerifier(models)({ language: "ar", expectedText: "اعطيني رقم المريض.", transcript: "عطيني رقم المريض." });
    expect(verdict).toEqual({ approved: true, conversational: false, reason: "supported" });
  });

  it("never marks directory evidence as conversational even if the provider does", async () => {
    const verdict = await createOutputVerifier(models)({ language: "en", transcript: "Dr A specialises in Dermatology.", evidence: { sourceText: "Dr A, Dermatology", requiredPhrases: [] } });
    expect(verdict.conversational).toBe(false);
  });

  it("preserves conversational classification for context-free reception dialogue", async () => {
    const verdict = await createOutputVerifier(models)({ language: "en", transcript: "How can I help you?" });
    expect(verdict.conversational).toBe(true);
  });
});
