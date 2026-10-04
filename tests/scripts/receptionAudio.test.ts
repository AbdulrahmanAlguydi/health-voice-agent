import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  RECEPTION_AUDIO_FRAME_BYTES,
  assertRecordedAgentReply,
  assertSavedBookingMatchesAcceptedOffer,
  loadReceptionAudioFixture,
  parsePcm16MonoWav,
  parsePcm16Mono16kWav,
  resamplePcm16Mono,
  replayPcm16Mono16kWav,
  splitPcmIntoReceptionFrames,
  selectReceptionAudioFixtures,
  wrapPcm16MonoWav,
} from "../../scripts/receptionAudio";

const shortPcm = Buffer.from([0, 0, 1, 0, 0xff, 0x7f, 0, 0x80]);

describe("reception caller audio framing", () => {
  it("selects one language without disturbing the other cached fixtures", () => {
    const fixtures = [
      { language: "ar" as const, id: "ar-1" },
      { language: "en" as const, id: "en-1" },
      { language: "en" as const, id: "en-2" },
    ];

    expect(selectReceptionAudioFixtures(fixtures, "en")).toEqual(fixtures.slice(1));
    expect(selectReceptionAudioFixtures(fixtures)).toEqual(fixtures);
  });

  it("wraps raw PCM in a WAV header that round-trips as 16 kHz mono PCM16", () => {
    const wav = wrapPcm16MonoWav(shortPcm);

    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(parsePcm16Mono16kWav(wav)).toEqual(shortPcm);
  });

  it("resamples Gemini's 24 kHz TTS WAV to the Live API's 16 kHz mono PCM", () => {
    const source = Buffer.alloc(6 * 2);
    [0, 1_000, 2_000, 3_000, 4_000, 5_000].forEach((sample, index) => source.writeInt16LE(sample, index * 2));
    const decoded = parsePcm16MonoWav(wrapPcm16MonoWav(source, 24_000));
    const resampled = resamplePcm16Mono(decoded.pcm, decoded.sampleRate);
    const samples = Array.from({ length: resampled.length / 2 }, (_value, index) => resampled.readInt16LE(index * 2));

    expect(decoded.sampleRate).toBe(24_000);
    expect(samples).toEqual([0, 1_500, 3_000, 4_500]);
    expect(parsePcm16Mono16kWav(wrapPcm16MonoWav(resampled))).toHaveLength(8);
  });

  it("splits audio into 100 ms frames and keeps the final remainder", () => {
    const pcm = Buffer.alloc(RECEPTION_AUDIO_FRAME_BYTES * 2 + 100);

    expect(splitPcmIntoReceptionFrames(pcm).map((frame) => frame.length)).toEqual([
      RECEPTION_AUDIO_FRAME_BYTES,
      RECEPTION_AUDIO_FRAME_BYTES,
      100,
    ]);
  });

  it("uses one microphone turn and sends frames at their real audio durations", async () => {
    const events: Array<[string, number?]> = [];
    const controller = {
      beginMicrophoneTurn: () => { events.push(["begin"]); return 1; },
      sendMicrophoneAudio: (data: string) => { events.push(["frame", Buffer.from(data, "base64").length]); },
      endMicrophoneStream: () => { events.push(["end"]); },
    };
    const wait = vi.fn(async (milliseconds: number) => { events.push(["wait", milliseconds]); });

    await replayPcm16Mono16kWav(controller, wrapPcm16MonoWav(Buffer.alloc(RECEPTION_AUDIO_FRAME_BYTES + 100)), wait, 0);

    expect(events.map(([event]) => event)).toEqual(["begin", "frame", "wait", "frame", "wait"]);
    expect(events.filter(([event]) => event === "frame").map(([, bytes]) => bytes)).toEqual([RECEPTION_AUDIO_FRAME_BYTES, 100]);
    expect(wait.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([100, 3.125]);
  });

  it("sends a browser-like silence tail and keeps the Live microphone stream open between turns", async () => {
    const sent: Buffer[] = [];
    let ended = false;
    const controller = {
      beginMicrophoneTurn: () => 1,
      sendMicrophoneAudio: (data: string) => sent.push(Buffer.from(data, "base64")),
      endMicrophoneStream: () => { ended = true; },
    };
    const wait = vi.fn(async (_milliseconds: number) => undefined);

    await replayPcm16Mono16kWav(controller, wrapPcm16MonoWav(Buffer.alloc(RECEPTION_AUDIO_FRAME_BYTES)), wait);

    expect(sent).toHaveLength(16);
    expect(sent[0]).toHaveLength(RECEPTION_AUDIO_FRAME_BYTES);
    expect(sent.slice(1).every((frame) => frame.every((sample) => sample === 0))).toBe(true);
    expect(wait).toHaveBeenCalledTimes(16);
    expect(wait.mock.calls.every(([milliseconds]) => milliseconds === 100)).toBe(true);
    expect(ended).toBe(false);
  });

  it.each([
    ["non-RIFF header", (wav: Buffer) => wav.write("NOPE", 0)],
    ["non-PCM encoding", (wav: Buffer) => wav.writeUInt16LE(3, 20)],
    ["stereo audio", (wav: Buffer) => wav.writeUInt16LE(2, 22)],
    ["wrong sample rate", (wav: Buffer) => wav.writeUInt32LE(8_000, 24)],
    ["wrong bit depth", (wav: Buffer) => wav.writeUInt16LE(8, 34)],
  ])("rejects a fixture with %s", (_description, corrupt) => {
    const wav = Buffer.from(wrapPcm16MonoWav(shortPcm));
    corrupt(wav);

    expect(() => parsePcm16Mono16kWav(wav)).toThrow();
  });

  it("rejects an incomplete chunk header at the end of the RIFF payload", () => {
    const valid = wrapPcm16MonoWav(shortPcm);
    const malformed = Buffer.concat([valid, Buffer.from([0x78, 0x79, 0x7a])]);
    malformed.writeUInt32LE(malformed.length - 8, 4);

    expect(() => parsePcm16Mono16kWav(malformed)).toThrow(/incomplete.*chunk header/i);
  });

  it("reports a missing fixture path without starting a microphone turn", () => {
    const path = join(tmpdir(), `reception-audio-missing-${randomUUID()}.wav`);

    expect(() => loadReceptionAudioFixture(path)).toThrow(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("fails a transcript-only reply when the Live output has no PCM", () => {
    expect(() => assertRecordedAgentReply("booking turn 4", [{ outputId: "out-4", transcript: "I heard Ahmed.", audioBytes: 0 }]))
      .toThrow(/booking turn 4.*audio/i);
  });

  it("checks the saved patient, confirmed phone, accepted doctor and time", () => {
    const offer = { doctorId: "doctor-7", startsAtUtc: "2026-10-04T06:00:00.000Z" };
    const saved = [{ patientName: "Ahmed", phone: "0501234567", doctorId: offer.doctorId, startsAtUtc: offer.startsAtUtc, status: "active" }];

    expect(() => assertSavedBookingMatchesAcceptedOffer("English audio booking", saved, offer, "Ahmed", "0501234567")).not.toThrow();
    expect(() => assertSavedBookingMatchesAcceptedOffer("English audio booking", [{ ...saved[0], phone: "050123456" }], offer, "Ahmed", "0501234567"))
      .toThrow(/contact/i);
  });
});
