import { GoogleGenAI } from "@google/genai";
import { GeminiLiveSessionController } from "../src/client/voice/session";
import { createApp } from "../src/server/app";
import { openDatabase } from "../src/server/db/connection";
import { writeFileSync } from "node:fs";

// Real Live model and native audio; ALL database operations use disposable memory.
const db = openDatabase(":memory:");
const server = createApp({ db }).listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Missing test server address");
const base = `http://127.0.0.1:${address.port}`;
const report: Array<Record<string, unknown>> = [];
let failures = 0;
const countBookings = () => (db.prepare("SELECT COUNT(*) AS count FROM appointments").get() as { count: number }).count;
const calendarTest = process.argv.includes("--calendar");
if (calendarTest) {
  const baseDay = new Date();
  baseDay.setUTCHours(9, 0, 0, 0);
  const weeks = new Date(baseDay); weeks.setUTCDate(weeks.getUTCDate() + 14);
  const month = new Date(baseDay); month.setUTCMonth(month.getUTCMonth() + 1);
  db.prepare("UPDATE slots SET starts_at_utc = ?, status = 'available' WHERE id = ?").run(weeks.toISOString(), "slot-doc-005-3");
  db.prepare("UPDATE slots SET starts_at_utc = ?, status = 'available' WHERE id = ?").run(month.toISOString(), "slot-doc-005-2");
}

async function episode(label: string, turns: string[]) {
  console.log(`\nSCENARIO: ${label}`);
  const record: Record<string, unknown> = { label, turns: [] };
  report.push(record);
  const dialogue = record.turns as Array<Record<string, unknown>>;
  let finished: (() => void) | undefined;
  let latest = "";
  let tools: Array<{ name: string; status?: string }> = [];
  const controller = new GeminiLiveSessionController({
    connectLive: async (token, model, config, callbacks) => new GoogleGenAI({ apiKey: token, apiVersion: "v1beta" }).live.connect({ model, config, callbacks: { ...callbacks, onmessage(message) {
      if (message.toolCall?.functionCalls) console.log("MODEL FUNCTIONS:", JSON.stringify(message.toolCall.functionCalls));
      if (message.serverContent?.outputTranscription?.text) process.stdout.write(message.serverContent.outputTranscription.text);
      callbacks.onmessage?.(message);
    } } }),
    fetch: async (input, init) => {
      const result = await globalThis.fetch(typeof input === "string" && input.startsWith("/") ? `${input.startsWith("/api/gemini/") ? "http://localhost:3001" : base}${input}` : input, init);
      if (typeof input === "string" && input.endsWith("/verify-output")) console.log("VERIFIER:", await result.clone().text());
      return result;
    },
    onApprovedOutput(output, complete) {
      latest = output.transcript;
      console.log(`AGENT: ${latest}`);
      const duration = output.audio.reduce((sum, chunk) => sum + Buffer.from(chunk.data, "base64").length / 48, 0);
      setTimeout(() => { complete(); finished?.(); }, duration + 350);
    },
    onToolResult(event) { tools.push({ name: event.toolName, status: event.status }); console.log(`FUNCTION: ${event.toolName} -> ${event.status}`); },
    onOutputRejected(event) { console.log(`REJECTED: ${event.reason}, retry=${Boolean(event.retrying)}`); if (!event.retrying && event.reason !== "interrupted") { failures++; finished?.(); } },
    onError(message) { console.error(message); failures++; finished?.(); },
  });
  async function reply(action: () => void | Promise<void>) {
    let timer: ReturnType<typeof setTimeout>;
    const done = new Promise<void>((resolve, reject) => { finished = resolve; timer = setTimeout(() => reject(new Error("Reply timed out")), 45_000); });
    try { await action(); await done; } finally { clearTimeout(timer!); finished = undefined; }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  try {
    await reply(() => controller.connect());
    for (const text of turns) {
      tools = []; latest = "";
      console.log(`CALLER: ${text}`);
      await reply(() => { if (!controller.sendText(text)) throw new Error("Session not ready"); });
      dialogue.push({ caller: text, agent: latest, tools, bookings: countBookings() });
      if (calendarTest && tools.some((tool) => tool.name === "prepare_booking" && tool.status === "pending") && !/ربيع|جمادى|هـ|AH|Rabi|Jumada/i.test(latest)) {
        failures++; console.error("Final readback lost the requested Hijri calendar");
      }
      if (/إيه أكدها/.test(text) && !dialogue.slice(0, -1).some((turn) => (turn.tools as Array<{ name: string; status?: string }>).some((tool) => tool.name === "prepare_booking" && tool.status === "pending"))) {
        failures++; console.error("Correction was not exercised after a prepared readback");
      }
      if (/إيه أكدها/.test(text) && /^أي يوم يناسبك؟$/.test(latest)) { failures++; console.error("Lost known appointment context"); }
      if (countBookings() !== 0) { failures++; throw new Error("Unexpected booking committed"); }
      if (/أبغى أحجز موعد\.$/.test(text) && /أقدر أساعدك|عشان أساعدك|يسعدني|أهلا|أهلاً/.test(latest)) { failures++; console.error("Redundant booking introduction"); }
      if (/2026|٢٠٢٦|ألفين وستة وعشرين|الفين وستة وعشرين/.test(latest)) { failures++; console.error("Unnecessary current year"); }
    }
    record.completed = true;
  } catch (error) { failures++; record.error = String(error); console.error(error); }
  finally { await controller.stop(false); }
}

try {
  const correction = process.argv.find((value) => value.startsWith("--correction="))?.split("=")[1];
  if (process.argv.includes("--identity-negative")) {
    await episode("Arabic uncertain identity preserves lookup without booking", [
      "أبي أحجز مع ندى الخطيب، وش مواعيدها؟",
      "الأول مناسب، احجزه لي. رقم المريض 123.",
      "مو متأكد إذا هذا ملفي أو ملف أخوي، لا تحجز شيء.",
      "لا، هذا مو ملفي. ما أبي أحجز الآن، مع السلامة.",
    ]);
    await episode("English rejected identity never becomes booking consent", [
      "What times does Dr Nada Al-Khatib have?",
      "The first one please. My patient ID is 123.",
      "No, that is my brother's profile, not mine. Don't book anything.",
      "I'm not booking today. Goodbye.",
    ]);
  } else if (calendarTest) {
    await episode("Arabic relative/Hijri availability and absolute Hijri readback", [
      "أبي أحجز مع نورة الشمري. متى أقرب المواعيد؟",
      "طيب وش تواريخها بالهجري؟",
      "الأول مناسب، أحجزه لي. رقم المريض 123.",
      "إيه، هذا ملفي، أنا مريض تجريبي.",
      "لا، لا تثبتين شيء الآن. بس كذا، مع السلامة.",
    ]);
    await episode("English relative and Hijri dates", [
      "What are the next available appointments with Dr Noura Al-Shammari? Tell me how many days, weeks or months away they are.",
      "Could you give me those appointment dates in the Hijri calendar instead? Don't book anything.",
      "Thanks, that's all. Goodbye.",
    ]);
  } else if (!correction) {
    await episode("unknown doctor, context and unavailable time", [
      "أبغى أحجز موعد.",
      "عند الدكتور وليد النمري، عنده موعد؟",
      "طيب خلنا مع نورة الشمري بدلًا منه. وش عندها أوقات؟",
      "أبي أول يوم قلتيه، بس الساعة أحد عشر بالليل بدل الظهر.",
      "طيب عندها يوم بكرة؟",
      "لا، ما يناسبني. بس كذا، مع السلامة.",
    ]);
  } else {
    const changed = correction === "doctor" ? "إيه أكدها مع ريم الدوسري" : correction === "day" ? "إيه أكدها يوم الاثنين بدل اليوم اللي قلتيه" : "إيه أكدها الساعة أحد عشر بالليل";
    await episode(`changed ${correction} is not confirmation`, [
      "أبغى أحجز مع نورة الشمري. وش عندها أوقات؟",
      "الأول مناسب، أحجزه لي. رقم المريض 123.",
      "إيه، هذا ملفي، أنا مريض تجريبي.",
      changed,
      "لا تحجزين أي شيء. بس كذا، مع السلامة.",
    ]);
  }
} finally {
  console.log(`RESULT: ${failures} failures; ${countBookings()} database bookings`);
  writeFileSync(new URL(`../docs/superpowers/booking-context-${process.argv.includes("--identity-negative") ? "identity-negative" : calendarTest ? "calendar" : process.argv.find((value) => value.startsWith("--correction="))?.split("=")[1] ?? "availability"}.json`, import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(), inputMode: "typed input into actual Gemini Live; simulated playback completion", failures, report }, null, 2));
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  db.close();
}
if (failures) process.exitCode = 1;
