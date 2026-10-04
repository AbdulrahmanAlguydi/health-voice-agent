import { afterEach, describe, expect, it, vi } from "vitest";
import { decodePcm16, encodePcm16, MicrophoneCapture, PcmAudioPlayer } from "../../src/client/voice/audio";

afterEach(() => vi.unstubAllGlobals());

describe("PCM conversion for Gemini Live", () => {
  it("encodes mono Float32 microphone samples as little-endian PCM16", () => {
    const encoded = encodePcm16(new Float32Array([-1, -0.5, 0, 0.5, 1]));

    expect(decodePcm16(encoded)).toEqual(new Float32Array([-1, -0.5, 0, 0.5, 32767 / 32768]));
  });

  it("clips out-of-range samples and handles empty buffers", () => {
    expect(decodePcm16(encodePcm16(new Float32Array([-2, 2])))).toEqual(
      new Float32Array([-1, 32767 / 32768]),
    );
    expect(encodePcm16(new Float32Array())).toBe("");
    expect(decodePcm16("").length).toBe(0);
  });

  it("does not signal read-back completion when audio playback fails", async () => {
    const player = new PcmAudioPlayer();
    const onComplete = vi.fn();
    const onError = vi.fn();

    await player.play({
      transcript: "Read-back",
      language: "en",
      audio: [{ data: "AQID", mimeType: "audio/pcm;rate=24000" }],
    }, onComplete, onError);

    expect(onError).toHaveBeenCalledOnce();
    expect(onComplete).not.toHaveBeenCalled();
    await player.close();
  });

  it("stops microphone tracks if capture is cancelled while permission is pending", async () => {
    let resolveMedia: (stream: MediaStream) => void = () => undefined;
    const mediaPending = new Promise<MediaStream>((resolve) => { resolveMedia = resolve; });
    const trackStop = vi.fn();
    const onError = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(() => mediaPending) } });
    const capture = new MicrophoneCapture({
      onAudio: vi.fn(),
      onVoiceStart: vi.fn(),
      onVoiceEnd: vi.fn(),
      onError,
    });

    const starting = capture.start();
    await capture.stop();
    resolveMedia({ getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream);

    await expect(starting).rejects.toMatchObject({ name: "AbortError" });
    expect(trackStop).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });
});
