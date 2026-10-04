import { describe, expect, it, vi } from "vitest";
import type { LiveCallbacks, LiveServerMessage } from "@google/genai";
import { GeminiLiveSessionController } from "../../src/client/voice/session";
import { GEMINI_OPENING_TEXT } from "../../src/shared/geminiLiveConfig";

const response = (value: unknown) => new Response(JSON.stringify(value));
function emit(cb: LiveCallbacks | undefined, text: string) {
  cb?.onmessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "AQIDBA==", mimeType: "audio/pcm;rate=24000" } }] }, outputTranscription: { text, finished: true }, generationComplete: true, turnComplete: true } } as unknown as LiveServerMessage);
}

describe("selective session routing", () => {
  it("lets a batched directory answer use the requested facts instead of reading every responseText field", async () => {
    let cb: LiveCallbacks | undefined;
    const live = { sendRealtimeInput: vi.fn(), sendClientContent: vi.fn(), sendToolResponse: vi.fn(), close: vi.fn() };
    const approved = vi.fn();
    const fetch = vi.fn().mockResolvedValueOnce(response({ token: "test", model: "gemini-3.8-live", voiceName: "Kore", expiresAt: new Date(Date.now() + 600000).toISOString() }))
      .mockResolvedValueOnce(response({ status: "found", doctor: { name: "د. ريم الدوسري", specialty: "الأمراض الجلدية", clinicLocation: "العيادة 1" }, responseText: "د. ريم الدوسري، الأمراض الجلدية، العيادة 1." }))
      .mockResolvedValueOnce(response({ status: "found", doctor: { name: "د. نورة الشمري", specialty: "الأمراض الجلدية", clinicLocation: "العيادة 2" }, responseText: "د. نورة الشمري، الأمراض الجلدية، العيادة 2." }));
    const controller = new GeminiLiveSessionController({ fetch, onApprovedOutput: approved,
      verifyOutput: async (input) => { expect(input.evidence?.records).toHaveLength(2); return { approved: true, conversational: false, reason: "supported" }; },
      connectLive: async (_token, _model, _config, callbacks) => { cb = callbacks; return live; } });
    await controller.connect(); emit(cb, GEMINI_OPENING_TEXT); approved.mock.calls.at(-1)?.[1]();
    controller.sendText("وش تخصص ريم ونورة؟");
    cb?.onmessage({ toolCall: { functionCalls: [
      { id: "a", name: "get_doctor_details", args: { doctorIdentifier: "ريم الدوسري", language: "ar" } },
      { id: "b", name: "get_doctor_details", args: { doctorIdentifier: "نورة الشمري", language: "ar" } },
    ] } } as unknown as LiveServerMessage);
    await vi.waitFor(() => expect(live.sendToolResponse).toHaveBeenCalledOnce());
    emit(cb, "ريم الدوسري ونورة الشمري تخصصهم الأمراض الجلدية.");
    await vi.waitFor(() => expect(approved.mock.calls.at(-1)?.[0].transcript).toBe("ريم الدوسري ونورة الشمري تخصصهم الأمراض الجلدية."));
    await controller.stop(false);
  });
  it.each(["ask_doctor", "scope_redirect", "acknowledge", "repeat_request"])("does not require a canned %s reply or a second model for a non-factual tool result", async (messageKey) => {
    let cb: LiveCallbacks | undefined;
    const live = { sendRealtimeInput: vi.fn(), sendClientContent: vi.fn(), sendToolResponse: vi.fn(), close: vi.fn() };
    const approved = vi.fn();
    const verify = vi.fn(async () => { throw new Error("offline"); });
    const controller = new GeminiLiveSessionController({ fetch: vi.fn(async () => response({ token: "test", model: "gemini-3.8-live", voiceName: "Kore", expiresAt: new Date(Date.now() + 600000).toISOString() })),
      verifyOutput: verify, onApprovedOutput: approved, connectLive: async (_token, _model, _config, callbacks) => { cb = callbacks; return live; } });
    await controller.connect(); emit(cb, GEMINI_OPENING_TEXT); approved.mock.calls.at(-1)?.[1]();
    controller.sendText("هلا");
    cb?.onmessage({ toolCall: { functionCalls: [{ id: "safe", name: "speak_safe_reply", args: { messageKey, language: "ar" } }] } } as unknown as LiveServerMessage);
    await vi.waitFor(() => expect(live.sendToolResponse).toHaveBeenCalledOnce());
    const text = messageKey === "scope_redirect" ? "ما أقدر أساعدك بهالشي. وش تحتاج من خدمات المواعيد؟" : "حياك الله، وش تحب أشيك لك أول؟";
    emit(cb, text);
    expect(approved.mock.calls.at(-1)?.[0].transcript).toBe(text);
    expect(verify).not.toHaveBeenCalled();
    await controller.stop(false);
  });
});
