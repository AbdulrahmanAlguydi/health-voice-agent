import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { createOutputVerifier } from "../src/server/services/outputVerificationService";
import { formatAppointmentDateTime } from "../src/shared/appointmentDateTime";
import type { OutputVerificationRequest } from "../src/shared/outputVerification";

// Real semantic verifier, simulated December clock; no Live session or database writes.
if (!process.env.GEMINI_API_KEY) throw new Error("Configure GEMINI_API_KEY locally before testing");
const december = new Date("2026-12-15T00:00:00Z");
const verify = createOutputVerifier(new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }).models, undefined, () => december);
const cases: Array<{ name: string; expected: boolean; input: OutputVerificationRequest }> = [
  { name: "Arabic explicit next-January year omitted", expected: true, input: { language: "ar", expectedText: "الموعد مع الدكتورة نورة الشمري يوم الأحد 3 يناير 2027 الساعة 12 الظهر. أأكد الحجز؟", transcript: "الموعد مع الدكتورة نورة الشمري يوم الأحد ثلاثة يناير الساعة اثنا عشر الظهر. أأكد الحجز؟" } },
  { name: "English explicit next-January year omitted", expected: true, input: { language: "en", expectedText: "Dr Noura, Sunday 3 January 2027 at noon. Shall I book it?", transcript: "Dr Noura, Sunday January third at noon. Should I book it?" } },
  { name: "Authored yearless January correctly grounded", expected: true, input: { language: "ar", expectedText: `الموعد مع الدكتورة نورة الشمري ${formatAppointmentDateTime("2027-01-03T09:00:00Z", "ar", december)}. أأكد الحجز؟`, transcript: "الموعد مع الدكتورة نورة الشمري يوم الأحد ثلاثة يناير الساعة اثنا عشر الظهر. أأكد الحجز؟" } },
  { name: "February next year still needs year", expected: false, input: { language: "en", expectedText: "Dr Noura, Wednesday 3 February 2027 at noon. Shall I book it?", transcript: "Dr Noura, Wednesday February third at noon. Shall I book it?" } },
  { name: "January two years later still needs year", expected: false, input: { language: "en", expectedText: "Dr Noura, Monday 3 January 2028 at noon. Shall I book it?", transcript: "Dr Noura, Monday January third at noon. Shall I book it?" } },
  { name: "Changed hour remains rejected", expected: false, input: { language: "ar", expectedText: "الموعد مع الدكتورة نورة الشمري يوم الأحد 3 يناير 2027 الساعة 12 الظهر. أأكد الحجز؟", transcript: "الموعد مع الدكتورة نورة الشمري يوم الأحد ثلاثة يناير الساعة أحد عشر بالليل. أأكد الحجز؟" } },
];
let failures = 0;
const requestedCase = process.argv.find((arg) => arg.startsWith("--case="))?.slice(7);
const selectedCases = requestedCase ? cases.filter((test) => test.name.includes(requestedCase)) : cases;
if (!selectedCases.length) throw new Error("No matching smoke case");
for (const test of selectedCases) {
  try {
    const verdict = await verify(test.input);
    console.log(JSON.stringify({ case: test.name, expected: test.expected, ...verdict }));
    if (verdict.approved !== test.expected) failures++;
  } catch { console.error(`Provider error: ${test.name}`); failures++; }
}
console.log(`RESULT: ${failures} failures / ${selectedCases.length} cases`);
if (failures) process.exitCode = 1;
