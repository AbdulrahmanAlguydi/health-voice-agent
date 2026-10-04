import { describe, expect, it, vi } from "vitest";
import type { LiveCallbacks, LiveServerMessage } from "@google/genai";
import { GeminiLiveSessionController } from "../../src/client/voice/session";

describe("live greeting", () => {
  async function setup() {
    let callbacks: LiveCallbacks | undefined;
    const live = { sendRealtimeInput: vi.fn(), sendClientContent: vi.fn(), sendToolResponse: vi.fn(), close: vi.fn() };
    const approved = vi.fn();
    const rejected = vi.fn();
    const controller = new GeminiLiveSessionController({
      fetch: async () => new Response(JSON.stringify({ token: "test-token", model: "gemini-3.8-live", voiceName: "Fenrir", expiresAt: new Date(Date.now() + 600000).toISOString() })),
      connectLive: async (_token, _model, _config, cb) => { callbacks = cb; return live; },
      onApprovedOutput: approved, onOutputRejected: rejected,
    });
    await controller.connect();
    return { controller, live, approved, rejected, emit: (text: string, audio = true) => callbacks?.onmessage({ serverContent: {
      modelTurn: { parts: audio ? [{ inlineData: { data: "AQIDBA==", mimeType: "audio/pcm;rate=24000" } }] : [] },
      outputTranscription: { text, finished: true }, generationComplete: true, turnComplete: true,
    } } as unknown as LiveServerMessage) };
  }

  it("waits for generated audio and accepts natural opening wording", async () => {
    const s = await setup();
    expect(s.approved).not.toHaveBeenCalled();
    expect(s.live.sendClientContent.mock.calls[0][0].turns[0].role).toBe("user");
    s.emit("حياك الله في مجمع عافية الطبي، كيف أقدر أساعدك؟");
    expect(s.approved.mock.calls[0][0]).toMatchObject({ transcript: "حياك الله في مجمع عافية الطبي، كيف أقدر أساعدك؟", verification: "not_required" });
    s.approved.mock.calls[0][1]();
    await s.controller.stop(false);
  });

  it("uses normal Live recovery instead of prerecorded audio when opening generation fails", async () => {
    const s = await setup();
    s.emit("السلام عليكم", false);
    expect(s.approved).not.toHaveBeenCalled();
    expect(s.rejected).toHaveBeenCalledWith(expect.objectContaining({ reason: "missing_audio", retrying: true }));
    expect(s.live.sendClientContent.mock.calls.at(-1)?.[0].turns[0].role).toBe("user");
    s.emit("حياك الله في مجمع عافية الطبي، كيف أقدر أساعدك؟");
    expect(s.approved).toHaveBeenCalledOnce();
    s.approved.mock.calls[0][1]();
    await s.controller.stop(false);
  });
});
