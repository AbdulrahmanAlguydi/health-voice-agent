import { describe, expect, it } from "vitest";
import { extractLastQuestion } from "../../src/shared/lastInquiry";

describe("extractLastQuestion", () => {
  it("returns the final English question sentence, not the preceding fact", () => {
    expect(extractLastQuestion("I found Dr. Sara in cardiology. Which day works for you?"))
      .toBe("Which day works for you?");
  });

  it("preserves abbreviations inside the question sentence", () => {
    expect(extractLastQuestion("I found one doctor. Are you asking about Dr. Sara?"))
      .toBe("Are you asking about Dr. Sara?");
  });

  it("preserves the Arabic doctor title inside the question sentence", () => {
    expect(extractLastQuestion("لدينا طبيبة متاحة. هل تسأل عن د. سارة؟"))
      .toBe("هل تسأل عن د. سارة؟");
  });

  it("returns the final Arabic question sentence", () => {
    expect(extractLastQuestion("عندنا مواعيد متاحة. أي يوم يناسبك؟")).toBe("أي يوم يناسبك؟");
  });

  it("returns undefined when the approved response asks no question", () => {
    expect(extractLastQuestion("I found Dr. Sara in cardiology.")).toBeUndefined();
  });
});
