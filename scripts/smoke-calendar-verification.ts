import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { createOutputVerifier } from "../src/server/services/outputVerificationService";
import { appointmentLabels } from "../src/shared/appointmentLabels";
import type { OutputVerificationRequest } from "../src/shared/outputVerification";

if (!process.env.GEMINI_API_KEY) throw new Error("Configure the API locally");
const now = new Date("2026-10-01T09:00:00Z");
const verify = createOutputVerifier(new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }).models, undefined, () => now);
const ar = appointmentLabels("2026-10-03T09:00:00Z", "ar", now);
const en = appointmentLabels("2026-10-11T09:00:00Z", "en", now);
const evidence = (labels: typeof ar, relative: boolean) => ({ sourceText: `Dr Noura: ${labels.spokenDateTime}`, requiredPhrases: [], allowRelativeDates: relative, appointmentDates: [{ gregorian: labels.spokenDateTime, hijri: labels.spokenHijriDateTime, ...(relative ? { relative: labels.relativeDateTime } : {}) }] });
const cases: Array<{ name: string; approved: boolean; input: OutputVerificationRequest }> = [
  { name: "Arabic computed two-day availability", approved: true, input: { language: "ar", transcript: "المتاح مع د. نورة الشمري بعد يومين الساعة اثنا عشر الظهر. يناسبك؟", expectedText: `المتاح مع د. نورة الشمري ${ar.relativeDateTime}. يناسبك؟`, evidence: evidence(ar, true) } },
  { name: "English exact weeks and remainder", approved: true, input: { language: "en", transcript: "Dr Noura is available in one week and three days at noon. Does that work?", expectedText: `Dr Noura is available ${en.relativeDateTime}. Does that work?`, evidence: evidence(en, true) } },
  { name: "Rounded week is inaccurate", approved: false, input: { language: "en", transcript: "Dr Noura is available in one week at noon. Does that work?", expectedText: `Dr Noura is available ${en.relativeDateTime}. Does that work?`, evidence: evidence(en, true) } },
  { name: "Hijri final readback equivalent", approved: true, input: { language: "ar", transcript: `الموعد مع د. نورة الشمري ${ar.spokenHijriDateTime}. أأكد الحجز؟`, expectedText: `الموعد مع د. نورة الشمري ${ar.spokenDateTime}. أأكد الحجز؟`, evidence: evidence(ar, false) } },
  { name: "Relative-only final readback rejected", approved: false, input: { language: "ar", transcript: "الموعد مع د. نورة الشمري بعد يومين الساعة اثنا عشر الظهر. أأكد الحجز؟", expectedText: `الموعد مع د. نورة الشمري ${ar.spokenDateTime}. أأكد الحجز؟`, evidence: evidence(ar, false) } },
];
let failures = 0;
const requested = process.argv.find((arg) => arg.startsWith("--case="))?.slice(7);
const selected = requested ? cases.filter((test) => test.name.includes(requested)) : cases;
if (!selected.length) throw new Error("No matching case");
for (const test of selected) {
  try { const result = await verify(test.input); console.log(JSON.stringify({ case: test.name, expected: test.approved, ...result })); if (result.approved !== test.approved) failures++; }
  catch { failures++; console.error(`Provider error: ${test.name}`); }
}
console.log(`RESULT: ${failures} failures / ${selected.length} cases`);
if (failures) process.exitCode = 1;
