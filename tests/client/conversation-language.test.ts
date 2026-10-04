import { describe, expect, it } from "vitest";
import { detectConversationLanguage } from "../../src/client/voice/language";

describe("conversation language selection", () => {
  it("keeps an ambiguous attention greeting in the active language", () => {
    expect(detectConversationLanguage("Hello.", "ar")).toBe("ar");
    expect(detectConversationLanguage("hello!", "en")).toBe("en");
    expect(detectConversationLanguage("alo", "ar")).toBe("ar");
    expect(detectConversationLanguage("Hello, can you hear me?", "ar")).toBe("en");
  });

  it("recognizes an explicit Arabic attention greeting without requiring a sentence", () => {
    expect(detectConversationLanguage("ألو؟", "en")).toBe("ar");
    expect(detectConversationLanguage("الو", "en")).toBe("ar");
  });

  it("does not let a doctor name override the language of the surrounding sentence", () => {
    expect(detectConversationLanguage("Can I see Dr. أحمد?", "ar")).toBe("en");
    expect(detectConversationLanguage("أبي موعد مع Dr. Sara", "en")).toBe("ar");
  });

  it("keeps the current language when the caller only says a doctor name", () => {
    expect(detectConversationLanguage("Dr. أحمد", "en")).toBe("en");
    expect(detectConversationLanguage("Dr. Sara", "ar")).toBe("ar");
  });

  it("retains the current language for balanced mixed speech and numeric IDs", () => {
    expect(detectConversationLanguage("yes، نعم", "ar")).toBe("ar");
    expect(detectConversationLanguage("1 2 3", "ar")).toBe("ar");
  });

  it("switches for clear single-language utterances", () => {
    expect(detectConversationLanguage("Could you list the cardiologists?", "ar")).toBe("en");
    expect(detectConversationLanguage("أبي أشوف أطباء القلب", "en")).toBe("ar");
  });

  it("recognizes short natural confirmation replies as language switches", () => {
    expect(detectConversationLanguage("Sounds good.", "ar")).toBe("en");
    expect(detectConversationLanguage("Okay.", "ar")).toBe("en");
    expect(detectConversationLanguage("تمام.", "en")).toBe("ar");
    expect(detectConversationLanguage("ماشي احجزه", "en")).toBe("ar");
  });
});
