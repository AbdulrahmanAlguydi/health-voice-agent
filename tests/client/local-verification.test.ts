import { describe, expect, it } from "vitest";
import { verifyOutputLocally } from "../../src/client/agent/localOutputVerification";

const evidence = {
  sourceText: "لقيت 3 أطباء: د. ندى الخطيب، د. سعود الأسمري، ود. غادة الأحمدي.", requiredPhrases: [],
  groundedPhrases: ["ندى الخطيب", "سعود الأسمري", "غادة الأحمدي"],
  records: [{ name: "د. ندى الخطيب" }, { name: "د. سعود الأسمري" }, { name: "د. غادة الأحمدي" }],
};
describe("local factual output checks", () => {
  it.each([
    ["ar", "د. ندى الخطيب", "الدكتورة ندى تخصصها طب الأسنان."],
    ["en", "Dr. Nada Al-Khatib", "Dr. Nada specialises in Dentistry."],
  ] as const)("allows the returned doctor's first name in a conversational follow-up in %s", async (language, name, transcript) => {
    expect((await verifyOutputLocally({ language, transcript, evidence: { sourceText: `${name}`, requiredPhrases: [], records: [{ name }] } })).approved).toBe(true);
  });
  it("still requires the complete doctor name in the final booking readback", async () => {
    expect((await verifyOutputLocally({ language: "ar", transcript: "مع الدكتورة ندى يوم الأحد، أحجز لك؟", expectedText: "مع د. ندى الخطيب يوم الأحد، أحجز لك؟" })).approved).toBe(false);
  });
  it("does not use a short-name alias to authorize a different surname or ambiguous doctor", async () => {
    expect((await verifyOutputLocally({ language: "ar", evidence, transcript: "الدكتورة ندى الزهراني تخصصها طب الأسنان." })).approved).toBe(false);
    expect((await verifyOutputLocally({ language: "ar", transcript: "الدكتورة ندى تخصصها طب الأسنان.", evidence: { sourceText: "ندى الخطيب وندى سالم", requiredPhrases: [], records: [{ name: "ندى الخطيب" }, { name: "ندى سالم" }] } })).approved).toBe(false);
  });
  it("accepts equivalent English twelve-hour clocks, but not a different hour", async () => {
    const evidence = { sourceText: "in 2 days at 17:00", requiredPhrases: [], allowRelativeDates: true, appointmentDates: [{ gregorian: "Sunday 4 October at 17:00", hijri: "23 Rabi II at 17:00", relative: "in 2 days at 17:00" }] };
    expect((await verifyOutputLocally({ language: "en", evidence, transcript: "In 2 days at 5:00 PM." })).approved).toBe(true);
    expect((await verifyOutputLocally({ language: "en", evidence, transcript: "In two days at 5:00 PM." })).approved).toBe(true);
    expect((await verifyOutputLocally({ language: "en", evidence, transcript: "In 2 days at 6:00 PM." })).approved).toBe(false);
  });
  it("accepts spoken Arabic whole hours without zero-zero minutes", async () => {
    expect((await verifyOutputLocally({ language: "ar", transcript: "بكرة الساعة ١٢ الظهر، وبعد يومين الساعة ٥ مساءً.", evidence: { sourceText: "بكرة الساعة ١٢:٠٠ الظهر، بعد يومين الساعة ٥:٠٠ مساءً.", requiredPhrases: [], allowRelativeDates: true, appointmentDates: [
      { gregorian: "السبت، ٣ أكتوبر في ١٢:٠٠ الظهر", hijri: "٢٢ ربيع الآخر في ١٢:٠٠ الظهر", relative: "بكرة الساعة ١٢:٠٠ الظهر" },
      { gregorian: "الأحد، ٤ أكتوبر في ٥:٠٠ مساءً", hijri: "٢٣ ربيع الآخر في ٥:٠٠ مساءً", relative: "بعد يومين الساعة ٥:٠٠ مساءً" },
    ] } })).approved).toBe(true);
  });
  it("allows fresh Arabic wording around the returned doctors", async () => {
    expect((await verifyOutputLocally({ language: "ar", evidence, transcript: "عندنا ثلاثة أطباء: ندى الخطيب وسعود الأسمري وغادة الأحمدي. من تفضل فيهم؟" })).approved).toBe(true);
  });
  it("rejects an unreturned titled doctor", async () => {
    expect((await verifyOutputLocally({ language: "ar", evidence, transcript: "عندنا دكتور محمد الزهراني وندى الخطيب." })).approved).toBe(false);
  });
  it("rejects a changed doctor count", async () => {
    expect((await verifyOutputLocally({ language: "ar", evidence, transcript: "عندنا 4 أطباء: ندى الخطيب وسعود الأسمري وغادة الأحمدي." })).approved).toBe(false);
  });
  it("permits English conversational wording without an external model", async () => {
    expect((await verifyOutputLocally({ language: "en", transcript: "Have you got a particular physician in mind?" })).approved).toBe(true);
  });
  it("does not demand unasked-for clinic numbers in a directory answer", async () => {
    expect((await verifyOutputLocally({ language: "ar", expectedText: "د. سارة القحطاني، أمراض القلب، العيادة 1.", evidence: { sourceText: "د. سارة القحطاني، أمراض القلب، العيادة 1.", requiredPhrases: [], records: [{ name: "د. سارة القحطاني", specialty: "أمراض القلب", clinicLocation: "العيادة 1" }] }, transcript: "تخصص الدكتورة سارة القحطاني هو أمراض القلب." })).approved).toBe(true);
  });
  it("preserves the patient's returned name", async () => {
    expect((await verifyOutputLocally({ language: "en", expectedText: "I found a profile for Test Patient. Is that you?", transcript: "The profile is under Different Person. Is that you?" })).approved).toBe(false);
    expect((await verifyOutputLocally({ language: "en", expectedText: "I found a profile for Test Patient. Is that you?", transcript: "The profile is under Test Patient. Is this yours?" })).approved).toBe(true);
  });
  it("rejects changed availability dates and relative-only final readbacks", async () => {
    const dates = { sourceText: "Noura, Saturday 3 October at 12:00 PM", requiredPhrases: ["noura", "saturday 3 october at 12 00 pm"], groundedPhrases: ["noura"], allowRelativeDates: true, appointmentDates: [{ gregorian: "Saturday 3 October at 12:00 PM", hijri: "Saturday 22 Rabi II 1448 at 12:00 PM", relative: "in 2 days at 12:00 PM" }] };
    expect((await verifyOutputLocally({ language: "en", evidence: dates, transcript: "Noura, Saturday 4 October at 12:00 PM" })).approved).toBe(false);
    expect((await verifyOutputLocally({ language: "en", evidence: dates, transcript: "Noura, Saturday, October 3rd at 12:00 PM" })).approved).toBe(true);
    expect((await verifyOutputLocally({ language: "en", evidence: dates, transcript: "Noura, in 2 days at 12:00 PM" })).approved).toBe(true);
    expect((await verifyOutputLocally({ language: "en", evidence: { ...dates, allowRelativeDates: false }, transcript: "Noura, in 2 days at 12:00 PM" })).approved).toBe(false);
  });
});
