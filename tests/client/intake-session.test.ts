import { expect, it, vi } from "vitest";
import type { LiveCallbacks, LiveServerMessage } from "@google/genai";
import { GeminiLiveSessionController } from "../../src/client/voice/session";
import { GEMINI_OPENING_TEXT } from "../../src/shared/geminiLiveConfig";

it("uses finalized microphone slot consent to authorize a natural name question without an extra tool", async () => {
  let callbacks: LiveCallbacks | undefined;
  const live = { sendRealtimeInput: vi.fn(), sendClientContent: vi.fn(), sendToolResponse: vi.fn(), close: vi.fn() };
  const outputs: string[] = [];
  const controller = new GeminiLiveSessionController({
    fetch: async (input) => new Response(JSON.stringify(String(input).includes("token")
      ? { token: "test", model: "gemini-3.8-live", voiceName: "Kore", expiresAt: new Date(Date.now() + 600000).toISOString() }
      : { status: "ok", doctor: { doctorId: "doc-1" }, slots: [{ slotId: "slot-1", spokenDateTime: "Saturday 3 October at 12:00", spokenHijriDateTime: "22 Rabi II at 12:00", relativeDateTime: "tomorrow at 12:00" }], responseText: "tomorrow at 12:00" })),
    connectLive: async (_token, _model, _config, cb) => { callbacks = cb; return live; },
    onApprovedOutput: (output, complete) => { outputs.push(output.transcript); complete(); },
  });
  const emit = (text: string) => callbacks?.onmessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "AQIDBA==", mimeType: "audio/pcm;rate=24000" } }] }, outputTranscription: { text, finished: true }, generationComplete: true, turnComplete: true } } as unknown as LiveServerMessage);
  const tool = async (name: string, args: Record<string, unknown>, count: number) => {
    callbacks?.onmessage({ toolCall: { functionCalls: [{ id: String(count), name, args }] } } as unknown as LiveServerMessage);
    await vi.waitFor(() => expect(live.sendToolResponse).toHaveBeenCalledTimes(count));
  };
  await controller.connect(); emit(GEMINI_OPENING_TEXT);
  controller.sendText("What times does Noura have?");
  await tool("get_available_slots", { doctorIdentifier: "Noura", language: "en" }, 1);
  emit("Tomorrow at 12:00.");
  await vi.waitFor(() => expect(outputs.at(-1)).toBe("Tomorrow at 12:00."));
  controller.sendText("The first one.");
  await tool("begin_booking", { continueWithoutPatientId: true, language: "en" }, 2);
  await tool("confirm_guest_slot", { slotId: "slot-1", language: "en" }, 3);
  emit("Shall we book this time?");
  await vi.waitFor(() => expect(outputs.at(-1)).toBe("Shall we book this time?"));
  controller.beginMicrophoneTurn();
  callbacks?.onmessage({ serverContent: { inputTranscription: { text: "Yes, that time works for me." } } } as unknown as LiveServerMessage);
  emit("May I have your full name, please?");
  await vi.waitFor(() => expect(outputs.at(-1)).toBe("May I have your full name, please?"));
  await controller.stop(false);
});

it("speaks mobile repair after partial digits, ignores interruption bubbles, then accepts the next turn", async () => {
  let callbacks: LiveCallbacks | undefined;
  const live = { sendRealtimeInput: vi.fn(), sendClientContent: vi.fn(), sendToolResponse: vi.fn(), close: vi.fn() };
  const outputs: string[] = [];
  const rejected = vi.fn();
  const fallback = vi.fn();
  const controller = new GeminiLiveSessionController({
    fetch: async () => new Response(JSON.stringify({ token: "test", model: "gemini-3.8-live", voiceName: "Kore", expiresAt: new Date(Date.now() + 600000).toISOString() })),
    connectLive: async (_token, _model, _config, cb) => { callbacks = cb; return live; },
    onApprovedOutput: (output, complete) => { outputs.push(output.transcript); complete(); },
    onOutputRejected: rejected,
    onAssistantTranscript: (_text, _language, isFallback) => { if (isFallback) fallback(); },
  });
  const emit = (text: string) => callbacks?.onmessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "AQIDBA==", mimeType: "audio/pcm;rate=24000" } }] }, outputTranscription: { text, finished: true }, generationComplete: true, turnComplete: true } } as unknown as LiveServerMessage);
  await controller.connect(); emit(GEMINI_OPENING_TEXT);
  controller.sendText("هذا اسمي، بدر بدر");
  callbacks?.onmessage({ toolCall: { functionCalls: [{ id: "mobile", name: "speak_safe_reply", args: { messageKey: "request_guest_mobile", language: "ar" } }] } } as unknown as LiveServerMessage);
  await vi.waitFor(() => expect(live.sendToolResponse).toHaveBeenCalledOnce());
  const payload = live.sendToolResponse.mock.calls[0][0].functionResponses[0].response;
  expect(payload.responseText).toBeUndefined();
  expect(payload.speechIntent.key).toBe("ask_doctor");
  emit("عطني رقم جوالك");
  await vi.waitFor(() => expect(outputs.at(-1)).toBe("عطني رقم جوالك"));
  controller.sendText("1 2 3");
  emit("الرقم ناقص، عطيني رقم جوالك كامل.");
  await vi.waitFor(() => expect(outputs.at(-1)).toBe("الرقم ناقص، عطيني رقم جوالك كامل."));
  callbacks?.onmessage({ serverContent: { interrupted: true } } as unknown as LiveServerMessage);
  expect(fallback).not.toHaveBeenCalled();
  expect(controller.sendText("0501234567")).toBe(true);
  emit("تمام، وصلتني المعلومة.");
  await vi.waitFor(() => expect(outputs.at(-1)).toBe("تمام، وصلتني المعلومة."));
  expect(rejected).not.toHaveBeenCalled();
  await controller.stop(false);
});
