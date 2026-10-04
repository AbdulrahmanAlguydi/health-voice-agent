import { GoogleGenAI } from "@google/genai";
import { writeFileSync } from "node:fs";
import { createApp } from "../src/server/app";
import { openDatabase } from "../src/server/db/connection";
import { GeminiLiveSessionController } from "../src/client/voice/session";

// Real Gemini/audio, disposable database, synthetic contacts. Never writes to the demo DB.
const language = process.argv.includes("--english") ? "en" : "ar";
const registered = process.argv.includes("--registered");
const shortIdentityReply = process.argv.includes("--short-identity");
const latestIdentityReply = process.argv.includes("--latest-identity");
const identityRecovery = process.argv.includes("--identity-recovery");
const transcriptReplay = process.argv.includes("--last-transcript");
const transliterationRegression = process.argv.includes("--transliteration-regression");
let injectedTransliteration = false;
const db = openDatabase(":memory:");
if (transcriptReplay) {
  // Recreate the offered options from the user's session, not the newer seed.
  db.prepare("UPDATE slots SET starts_at_utc = ?, status = 'available' WHERE id = ?").run("2026-10-03T09:00:00.000Z", "slot-doc-028-1");
  db.prepare("UPDATE slots SET starts_at_utc = ?, status = 'available' WHERE id = ?").run("2026-10-04T14:00:00.000Z", "slot-doc-028-3");
}
const server = createApp({ db }).listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Missing test server");
const base = `http://127.0.0.1:${address.port}`;
const report: Array<Record<string, unknown>> = [];
let finish: (() => void) | undefined;
let latest = "";
let failures = 0;
let tools: Array<{ name: string; status?: string }> = [];
let voice: unknown;
const diagnostics: Array<Record<string, unknown>> = [];
const controller = new GeminiLiveSessionController({
  onDiagnostic(event) {
    if (["tool_result", "http_result", "output_unplayed", "booking_delivery_complete"].includes(event.event)) {
      diagnostics.push({ ...event });
    }
  },
  connectLive: async (token, model, config, callbacks) => {
    voice = config.speechConfig?.voiceConfig;
    return new GoogleGenAI({ apiKey: token, apiVersion: "v1beta" }).live.connect({ model, config, callbacks: { ...callbacks, onmessage(message) {
      // Force the observed function-argument error once to test actual model recovery.
      // Caller text/audio and database records remain unchanged.
      const call = message.toolCall?.functionCalls?.find((item) => item.name === "get_available_slots");
      if (transliterationRegression && !injectedTransliteration && call) {
        injectedTransliteration = true;
        call.args = { ...call.args, doctorIdentifier: "Nada Al Khateeb" };
      }
      callbacks.onmessage?.(message);
    } } });
  },
  fetch: async (input, init) => globalThis.fetch(typeof input === "string" && input.startsWith("/")
    ? `${input.startsWith("/api/gemini/") ? "http://localhost:3001" : base}${input}` : input, init),
  onApprovedOutput(output, complete) {
    latest = output.transcript;
    console.log(`AGENT: ${latest}`);
    const duration = output.audio.reduce((sum, chunk) => sum + Buffer.from(chunk.data, "base64").length / 48, 0);
    setTimeout(() => { complete(); finish?.(); }, duration + 250);
  },
  onToolResult(event) { tools.push({ name: event.toolName, status: event.status }); console.log(`FUNCTION: ${event.toolName} -> ${event.status}`); },
  onOutputRejected(event) { if (!event.retrying && event.reason !== "interrupted") { failures++; finish?.(); console.error(event.reason); } },
  onError(message) { failures++; console.error(message); finish?.(); },
});
async function reply(action: () => void | Promise<void>) {
  let timer: ReturnType<typeof setTimeout>;
  const done = new Promise<void>((resolve, reject) => { finish = resolve; timer = setTimeout(() => reject(new Error("Reply timeout")), 45000); });
  try { await action(); await done; } finally { clearTimeout(timer!); finish = undefined; }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
const turns = transcriptReplay ? [
  "وعليكم السلام", "شو عندك؟", "اعطيني التخصصات اللي عندكم.",
  "قسم الأسنان", // User explicitly clarified the logged “Nincs több”.
  "طيب يا دكتور ندى ايش متى مواعيدها؟", "Aha, fi shay ba'daha kaman.",
  "تحط لي المواعيد الساعه 5 اللي بعده وين؟ كم التاريخ هو بالضبط؟", "اي، احجز لي هنا.",
  "اسمى بدر. بدر الغامدي.", "معلش بس انديكيت لي اسمي. كيف سجلته؟",
  "لا لا بس بدر وغاد.", // Leave this ASR ambiguity visible; do not invent its intended name.
  "واحد رقم جوالي 1 3 3", "بس اكد لي رقم الجوال حقي.",
  "كيف كذا؟ انا قلت لك واحد اثنين ثلاثة.",
  "Mhm. طيب خلاص، دا يا جماعة ما فيه مشكلة. ايش ايش لازم نسوي دحين؟",
  "1 2 3 4 5 6 7 8", "اكيد للحجز.",
] : language === "ar" ? [
  "وش مواعيد ندى الخطيب؟", "الأول مناسب، احجزه لي.",
  ...(registered ? ["إيه عندي، رقم المريض 123.", ...(identityRecovery ? ["اي هذا ما في.", "ما سمعتك، تقصد اسمي؟"] : []), identityRecovery ? "اي هذا" : latestIdentityReply ? "اي، هذا الملف حقي." : shortIdentityReply ? "نعم، صحيح." : "إيه هذا ملفي، أنا مريض تجريبي."]
    : ["ما عندي رقم مريض.", "اسمي بدر الغامدي.", "رقم جوالي 1 2 3.", "رقم جوالي كامل 0 5 0 1 2 3 4 5 6 7."]),
  "أكيد للحجز.",
] : [
  "What appointments does Dr Nada Al-Khatib have?", "The first one works, please book it.",
  ...(registered ? ["Yes I have a patient ID, it is 123.", ...(identityRecovery ? ["I couldn't hear that", "What did you say?"] : []), identityRecovery ? "Yes, this one" : shortIdentityReply ? "Yes, correct." : "Yes that's my profile, Test Patient."]
    : ["I don't have a patient ID.", "My name is Alex Example.", "My mobile number is 1 2 3.", "The complete mobile number is 0 5 0 1 2 3 4 5 6 7."]),
  "Yes, confirm the booking.",
];
try {
  await reply(() => controller.connect());
  for (const [index, text] of turns.entries()) {
    console.log(`CALLER: ${text}`); tools = []; latest = "";
    await reply(() => { if (!controller.sendText(text)) throw new Error("Session unavailable"); });
    report.push({ caller: text, agent: latest, tools });
    if (transliterationRegression && index === 0 && tools.some((tool) => tool.status === "not_found") && !tools.some((tool) => tool.status === "ok")) {
      const clarification = "اسم الطبيبة ندى الخطيب، بالعربي. وش مواعيدها؟";
      console.log(`CALLER (name clarification): ${clarification}`); tools = []; latest = "";
      await reply(() => { controller.sendText(clarification); });
      report.push({ caller: clarification, agent: latest, tools, inserted: "Human clarification after failed transliteration; not an automatic recovery claim" });
      if (!tools.some((tool) => tool.name === "get_available_slots" && tool.status === "ok")) {
        failures++; throw new Error("Original-name clarification did not recover availability");
      }
    }
    if ((db.prepare("SELECT COUNT(*) AS count FROM appointments").get() as { count: number }).count === 0 && /(?:^|[\s،.:])(?:حجزنا\s*الموعد|تم\s*الحجز|حجزت\s*لك)|(?:is|has been|have)\s+(?:booked|reserved)/i.test(latest)) {
      failures++; console.error("Claimed a booking before successful confirmation");
    }
    if (!transcriptReplay && index === 1 && !/رقم\s*(?:ال)?مريض|patient\s*(?:ID|number)/i.test(latest)) {
      failures++; console.error("Did not ask if the caller already has a patient ID after selecting the time");
    }
    if (/1 2 3\.$/.test(text) && tools.some((tool) => tool.status === "pending")) { failures++; console.error("Prepared with a partial number"); }
    // A human answers the actual slot-consent question before giving a name.
    // Some model turns introduce the guest path first and ask about the slot next.
    if (!transcriptReplay && !registered && index === 3 && tools.some((tool) => tool.name === "confirm_guest_slot" && tool.status === "awaiting_guest_consent")) {
      const consent = language === "ar" ? "اي احجز لي هالموعد" : "Yes, please book that time.";
      console.log(`CALLER: ${consent}`); tools = []; latest = "";
      await reply(() => { controller.sendText(consent); });
      report.push({ caller: consent, agent: latest, tools });
    }
    if (transcriptReplay && index >= 7 && index < 9 && /رقم\s*(?:ال)?مريض/.test(latest)) {
      const answer = "ما عندي رقم مريض.";
      console.log(`CALLER (inserted answer to new ID question): ${answer}`); tools = []; latest = "";
      await reply(() => { controller.sendText(answer); });
      report.push({ caller: answer, agent: latest, tools, inserted: "Answer ID choice absent from the old broken conversation" });
      if (tools.some((tool) => tool.name === "confirm_guest_slot" && tool.status === "awaiting_guest_consent")) {
        tools = []; latest = "";
        await reply(() => { controller.sendText("اي، احجز لي هالموعد."); });
        report.push({ caller: "اي، احجز لي هالموعد.", agent: latest, tools, inserted: "Answer initial consent after new ID step" });
      }
    }
    if (transcriptReplay && index >= 11 && index < 15) {
      if (/1234567(?!8)|١٢٣٤٥٦٧(?!٨)/.test(latest) || tools.some((tool) => tool.status === "pending" || tool.status === "confirmed")) {
        failures++; console.error("Invented a complete mobile number or prepared before the caller supplied it");
      }
    }
    if (transcriptReplay && index === 12 && !/1\s*3\s*3|١\s*٣\s*٣|واحد[\s،]*ثلاث[ةه][\s،]*ثلاث[ةه]/.test(latest)) {
      failures++; console.error("Did not answer the caller's request to read back the heard partial number 133");
    }
    if (transcriptReplay && index === 13 && !/1\s*2\s*3|١\s*٢\s*٣|واحد[\s،]*اثنين[\s،]*ثلاث[ةه]/.test(latest)) {
      failures++; console.error("Did not acknowledge the corrected partial number 123");
    }
  }
  // If the last yes completed initial consent rather than the full final
  // readback, give fresh consent after hearing that final summary. Never write
  // directly or reuse the earlier yes to make the test pass.
  if (tools.some((tool) => tool.status === "pending")) {
    const consent = language === "ar" ? "اي احجز لي هالموعد" : "Yes, confirm the booking.";
    console.log(`CALLER: ${consent}`); tools = []; latest = "";
    await reply(() => { controller.sendText(consent); });
    report.push({ caller: consent, agent: latest, tools });
  }
  const appointments = db.prepare("SELECT patient_id, doctor_id, slot_id FROM appointments").all();
  if (identityRecovery) {
    const allTools = report.flatMap((turn) => turn.tools as typeof tools);
    if (allTools.some((tool) => tool.status === "invalid_patient") || allTools.filter((tool) => (tool.name === "lookup_patient" || tool.name === "begin_booking") && tool.status === "found").length !== 1) {
      failures++; console.error("Identity repair reset the successful lookup or repeated ID collection");
    }
  }
  const contacts = db.prepare("SELECT full_name_en, mobile_number FROM patients WHERE patient_id IN (SELECT patient_id FROM appointments)").all();
  if (transcriptReplay && (contacts[0] as { mobile_number?: string } | undefined)?.mobile_number !== "12345678") {
    failures++; console.error("Did not save the exact corrected mobile number 12345678");
  }
  if (appointments.length !== 1 || (registered && (appointments[0] as { patient_id: string }).patient_id !== "123")) {
    failures++; console.error("Expected exactly one completed booking for the correct caller");
  }
  if (!report.some((turn) => (turn.tools as typeof tools).some((tool) => tool.name === "confirm_booking" && tool.status === "confirmed"))) {
    failures++; console.error("No successful confirmation function");
  }
  console.log(`RESULT: ${failures} failures, ${appointments.length} saved test appointment(s)`);
  writeFileSync(new URL(`../docs/superpowers/${transcriptReplay ? "last-transcript-replay" : `completed-booking-${language}-${registered ? "registered" : "guest"}${transliterationRegression ? "-transliteration-recovery" : identityRecovery ? "-identity-recovery" : latestIdentityReply ? "-latest-identity" : shortIdentityReply ? "-short-identity" : ""}`}.json`, import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(), inputMode: "text into actual Gemini Live, PCM playback completion simulated; no microphone/pronunciation evaluation", injectedTransliteration, corrections: transcriptReplay ? { logged: "Nincs több", intended: "قسم الأسنان", source: "Explicit user clarification" } : undefined, voice, failures, appointments, contacts, report, diagnostics }, null, 2));
} catch (error) { failures++; console.error(error); }
finally {
  await controller.stop(false);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  db.close();
}
if (failures) process.exitCode = 1;
