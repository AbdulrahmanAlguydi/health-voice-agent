import { GeminiLiveSessionController } from "../src/client/voice/session";
import { GoogleGenAI } from "@google/genai";
import { createInterface } from "node:readline";

// Read-only Live smoke test. Uses the running API; never reads or prints credentials.
let finished: (() => void) | undefined;
let failures = 0;
let awaitingRejectedTurnEnd = false;
const bookingStartRegression = process.argv.includes("--booking-start-regression");
let callerTurn = 0;
let verifierCalls = 0;
const verificationLatencies: number[] = [];
const controller = new GeminiLiveSessionController({
  connectLive: async (token, model, config, callbacks) => {
    const ai = new GoogleGenAI({ apiKey: token, apiVersion: "v1beta" });
    return ai.live.connect({ model, config, callbacks: { ...callbacks, onmessage(message) {
      if (message.serverContent?.outputTranscription?.text) process.stdout.write(message.serverContent.outputTranscription.text);
      if (message.toolCall?.functionCalls) console.log("SYNTHETIC TEST CALL:", JSON.stringify(message.toolCall.functionCalls));
      callbacks.onmessage?.(message);
      if (message.serverContent?.turnComplete && awaitingRejectedTurnEnd) {
        awaitingRejectedTurnEnd = false;
        finished?.();
      }
    } } });
  },
  fetch: async (input, init) => {
    const start = Date.now();
    const isVerification = typeof input === "string" && input.endsWith("/verify-output");
    if (isVerification) verifierCalls++;
    const result = await globalThis.fetch(typeof input === "string" && input.startsWith("/") ? `http://localhost:3001${input}` : input, init);
    if (isVerification) verificationLatencies.push(Date.now() - start);
    return result;
  },
  onApprovedOutput(output, complete) {
    console.log(`AGENT (${output.language}, ${output.audio.length} audio chunks): ${output.transcript}`);
    if (bookingStartRegression && callerTurn > 0 && /رقم المريض|رقم مريض|patient id/i.test(output.transcript)) {
      console.error("FLOW FAIL: asked for identity before caller selected a time.");
      failures++;
    }
    const durationMs = output.audio.reduce((total, chunk) => total + Buffer.from(chunk.data, "base64").length / 48, 0);
    setTimeout(() => { complete(); finished?.(); }, durationMs + 500);
  },
  onOutputRejected(event) {
    console.log(`AUDIO CHECK: ${event.reason}, retry=${Boolean(event.retrying)}`);
    if (!event.retrying && event.reason !== "interrupted") { failures += 1; awaitingRejectedTurnEnd = true; }
  },
  onToolResult(event) { console.log(`FUNCTION: ${event.toolName} -> ${event.status}`); },
  onState(state) { if (state === "ended") console.log("SESSION ENDED after closing playback"); },
  onError(message) { console.error(message); failures += 1; finished?.(); },
});
async function waitForReply(action: () => void | Promise<void>) {
  let timer: ReturnType<typeof setTimeout>;
  const result = new Promise<void>((resolve, reject) => {
    finished = resolve;
    timer = setTimeout(() => reject(new Error("No completed reply within 25 seconds")), 25_000);
  });
  try { await action(); await result; }
  finally { clearTimeout(timer!); finished = undefined; }
  // The controller waits for the separate model turnComplete event after audio.
  await new Promise((resolve) => setTimeout(resolve, 700));
}
try {
  await waitForReply(() => controller.connect());
  const turns = process.argv.includes("--interactive") ? createInterface({ input: process.stdin, crlfDelay: Infinity }) : process.argv.includes("--guest-recovery-ar") ? [
    "وعليكم السلام", "أبي أحجز مع ندى الخطيب. وش أقرب المواعيد؟",
    "أبي أول موعد، وما عندي رقم مريض.", "إيه، يناسبني هذا الموعد.",
    "اسمي بدر بدر.", "رقم جوالي 123.", "الرقم كامل 0501234567.",
    "لا، لا تثبت الحجز. هونت، مع السلامة.",
  ] : process.argv.includes("--guest-recovery-en") ? [
    "Hello. Which dentists do you have?", "Do you know where Dr. Nada Al-Khatib graduated?",
    "What times are available with Nada?", "The first one works. I don't have a patient ID.",
    "Yes, that time works for me.", "My full name is Alex Test.",
    "My mobile number is 123.", "The full mobile number is 0501234567.",
    "No, don't confirm or save the booking. I changed my mind. Goodbye.",
  ] : process.argv.includes("--selective-regression") ? [
    "هلا، أبي أسأل عن الأطباء بس، لا تحجز لي شي.",
    "خلني أفكر شوي، مو متأكد وش أبي أسأل.",
    "طيب سؤال خارج الموضوع: اشرح لي كيف أكتب برنامج بايثون.",
    "Thanks, I'm still deciding. Don't book anything.",
    "That's all for now. Goodbye.",
  ] : bookingStartRegression ? [
    "وعليكم السلام",
    "أبغى أحجز موعد.",
    "أبغى أحجز موعد، هذا اللي أبيه.",
    "طيب ما أعرف أسماء الأطباء. عندكم أي تخصصات؟ عطيني كم مثال بس.",
    "خلني أسأل عن ريم الدوسري. وش تخصصها؟",
    "لحظة، أقصد نورة الشمري مو ريم. وتتكلم إنجليزي؟",
    "طيب وش الأوقات المتاحة مع نورة؟ أبي أعرف قبل أقرر.",
    "لا، هونت، ما أبي أحجز شي الآن. يعطيك العافية، مع السلامة.",
  ] : process.argv.includes("--english-regression") ? [
    "Hi, I'm not really sure what I need yet. What can you help me with?",
    "Maybe dermatology. Don't book anything yet, I just want to know which doctors you have.",
    "What does Dr. Noura Al-Shammari specialise in? Does she speak English?",
    "Sorry, I meant Dr. Reem Al-Dosari, not Noura. Where is her clinic?",
    "I'd like to book with Reem, but I don't have a patient ID.",
    "I'm not ready to choose a time. Please don't book anything; I need to think about it.",
    "Actually, I've changed my mind. That's all for now. Thank you, goodbye.",
  ] : process.argv.includes("--natural-final") ? ["هلا، والله مدري بالضبط، بس كنت أبي أعرف وش عندكم.", "طيب نورة الشمري، وش تخصصها بالضبط؟ وتتكلم إنجليزي؟", "أبي أفكر شوي قبل أحجز، لا تثبت شي.", "يعطيك العافية، هونت عن الحجز اليوم. بس كذا، مع السلامة."] : process.argv.includes("--natural-regression") ? [
    "هلا، والله مدري بالضبط، بس كنت أبي أعرف وش عندكم.",
    "وش التخصصات عندكم؟ بس عطيني فكرة سريعة، ما أبي قائمة طويلة.",
    "يمكن الجلدية، بس مو متأكد. لا تحجز شي، أبي أعرف عن الأطباء أول.",
    "طيب نورة الشمري، وش تخصصها بالضبط؟ وتتكلم إنجليزي؟",
    "لا لحظة، أقصد ريم الدوسري مو نورة. وين عيادتها؟",
    "أبي أفكر شوي قبل أحجز، لا تثبت شي.",
    "يعطيك العافية، هونت عن الحجز اليوم. بس كذا، مع السلامة.",
  ] : process.argv.includes("--directory-only") ? ["وش تخصص الدكتورة سارة القحطاني؟"] : ["وعليكم السلام", "وش تقدر تساعدني فيه؟", "ما سمعتك، عيد آخر شي قلته", "وش تخصص الدكتورة سارة القحطاني؟", "Hello. How can you help me?"];
  if (process.argv.includes("--interactive")) console.log("READY: enter a synthetic caller turn, or /exit to finish.");
  for await (const text of turns) {
    if (text.trim() === "/exit") break;
    console.log(`CALLER: ${text}`);
    callerTurn++;
    await waitForReply(() => { if (!controller.sendText(text)) throw new Error("Session not ready for input"); });
  }
  console.log(`VERIFICATION: ${verifierCalls} requests across ${callerTurn} caller turns; checked reply latency ${verificationLatencies.length ? `${Math.min(...verificationLatencies)}–${Math.max(...verificationLatencies)}ms` : "none"}`);
  if (failures) process.exitCode = 1;
} finally { await controller.stop(false); }
