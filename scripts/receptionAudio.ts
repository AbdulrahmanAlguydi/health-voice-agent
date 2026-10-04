import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const RECEPTION_AUDIO_SAMPLE_RATE = 16_000;
export const RECEPTION_AUDIO_FRAME_MS = 100;
export const RECEPTION_AUDIO_FRAME_BYTES = RECEPTION_AUDIO_SAMPLE_RATE * 2 * RECEPTION_AUDIO_FRAME_MS / 1_000;
// Live's automatic turn detector needs sustained silence while the audio stream remains open.
// The browser keeps streaming microphone silence; replay must do the same rather than stop at speech end.
export const RECEPTION_AUDIO_TRAILING_SILENCE_MS = 1_500;

const PCM_FORMAT = 1;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;

export type MicrophoneAudioController = {
  beginMicrophoneTurn(): number;
  sendMicrophoneAudio(data: string): void;
  endMicrophoneStream(): void;
};

export type AudioWait = (milliseconds: number) => Promise<void>;
export type RecordedAgentReply = { outputId: string; transcript: string; audioBytes: number };
export type AcceptedOfferFacts = { doctorId: string; startsAtUtc: string };
export type SavedAppointmentFacts = {
  patientName: string;
  phone: string;
  doctorId: string;
  startsAtUtc: string;
  status: string;
};

export type ReceptionAudioLanguage = "ar" | "en";
export type ReceptionCallerTurn = { id: string; text: string };
export function selectReceptionAudioFixtures<T extends { language: ReceptionAudioLanguage }>(
  fixtures: readonly T[],
  language?: ReceptionAudioLanguage,
): T[] {
  return language ? fixtures.filter((fixture) => fixture.language === language) : [...fixtures];
}

export const RECEPTION_CALLER_TURNS: Record<ReceptionAudioLanguage, readonly ReceptionCallerTurn[]> = {
  ar: [
    { id: "specialties", text: "إيش تخصصات العيادة؟" },
    { id: "doctor-request", text: "أبغى موعد عند ندى الخطيب الأسبوع الجاي. إيش أقرب موعد؟" },
    { id: "accept-offer", text: "أول موعد عرضتيه مناسب، احجزيه لي." },
    { id: "patient-name", text: "اسمي أحمد." },
    { id: "partial-mobile", text: "رقم جوالي واحد ثلاثة ثلاثة." },
    { id: "partial-mobile-response", text: "إيه، هذا اللي قلته." },
    { id: "complete-mobile", text: "رقمي كامل صفر خمسة صفر واحد اثنين ثلاثة أربعة خمسة ستة سبعة." },
    { id: "confirm-mobile", text: "إيه، رقم الجوال اللي قريتيه صحيح." },
  ],
  en: [
    { id: "specialties", text: "What specialties are in your clinic?" },
    { id: "doctor-request", text: "What is Dr Nada Al-Khatib's earliest opening next week?" },
    { id: "accept-offer", text: "The first appointment you offered works. Please book that one." },
    { id: "patient-name", text: "My name is Ahmed." },
    { id: "partial-mobile", text: "My mobile is one three three." },
    { id: "partial-mobile-response", text: "Yes, that is what I said." },
    { id: "complete-mobile", text: "The full number is zero five zero one two three four five six seven." },
    { id: "confirm-mobile", text: "Yes, the phone number you read back is correct." },
  ],
};

export function receptionAudioFixtureDirectory(): string {
  return resolve("output/reception-live/fixtures");
}

export function receptionAudioFixturePath(language: ReceptionAudioLanguage, turnId: string): string {
  return join(receptionAudioFixtureDirectory(), language, `${turnId}.wav`);
}

function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function validatePcm16(pcm: Uint8Array): Buffer {
  const bytes = toBuffer(pcm);
  if (bytes.length === 0) throw new Error("Reception audio PCM is empty.");
  if (bytes.length % BYTES_PER_SAMPLE !== 0) throw new Error("Reception audio PCM ends with an incomplete 16-bit sample.");
  return bytes;
}

export function wrapPcm16MonoWav(pcm: Uint8Array, sampleRate = RECEPTION_AUDIO_SAMPLE_RATE): Buffer {
  const bytes = validatePcm16(pcm);
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new Error("Reception audio WAV sample rate must be a positive integer.");
  const riffSize = 36 + bytes.length;
  if (riffSize > 0xffff_ffff) throw new Error("Reception audio PCM is too large for a WAV fixture.");

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(riffSize, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(PCM_FORMAT, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * CHANNELS * BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(CHANNELS * BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(bytes.length, 40);
  return Buffer.concat([header, bytes]);
}

export function parsePcm16MonoWav(wav: Uint8Array): { pcm: Buffer; sampleRate: number } {
  const bytes = toBuffer(wav);
  if (bytes.length < 12) throw new Error("Reception audio fixture is too short to contain a WAV header.");
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Reception audio fixture must use a RIFF/WAVE header.");
  }

  const riffEnd = bytes.readUInt32LE(4) + 8;
  if (riffEnd < 12 || riffEnd > bytes.length) throw new Error("Reception audio fixture has a truncated RIFF payload.");

  let format: { code: number; channels: number; sampleRate: number; byteRate: number; blockAlign: number; bitsPerSample: number } | undefined;
  let audio: Buffer | undefined;
  let offset = 12;
  for (; offset + 8 <= riffEnd;) {
    const name = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > riffEnd) throw new Error(`Reception audio fixture has a truncated ${name.trim() || "WAV"} chunk.`);

    if (name === "fmt ") {
      if (size < 16) throw new Error("Reception audio fixture has a malformed WAV format chunk.");
      if (format) throw new Error("Reception audio fixture contains more than one WAV format chunk.");
      format = {
        code: bytes.readUInt16LE(start),
        channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4),
        byteRate: bytes.readUInt32LE(start + 8),
        blockAlign: bytes.readUInt16LE(start + 12),
        bitsPerSample: bytes.readUInt16LE(start + 14),
      };
    } else if (name === "data") {
      if (audio) throw new Error("Reception audio fixture contains more than one WAV data chunk.");
      audio = bytes.subarray(start, end);
    }

    offset = end + (size & 1);
    if (offset > riffEnd) throw new Error("Reception audio fixture has a truncated WAV chunk padding byte.");
  }
  if (offset !== riffEnd) throw new Error("Reception audio fixture has an incomplete trailing WAV chunk header.");

  if (!format || !audio) throw new Error("Reception audio fixture must contain WAV format and data chunks.");
  if (format.code !== PCM_FORMAT) throw new Error("Reception audio fixture must contain uncompressed PCM audio.");
  if (format.channels !== CHANNELS) throw new Error("Reception audio fixture must be mono.");
  if (format.sampleRate <= 0) throw new Error("Reception audio fixture must use a positive sample rate.");
  if (format.bitsPerSample !== BITS_PER_SAMPLE) throw new Error("Reception audio fixture must use 16-bit PCM samples.");
  if (format.blockAlign !== CHANNELS * BYTES_PER_SAMPLE || format.byteRate !== format.sampleRate * format.blockAlign) {
    throw new Error("Reception audio fixture has inconsistent PCM alignment or byte-rate fields.");
  }
  return { pcm: validatePcm16(audio), sampleRate: format.sampleRate };
}

export function parsePcm16Mono16kWav(wav: Uint8Array): Buffer {
  const parsed = parsePcm16MonoWav(wav);
  if (parsed.sampleRate !== RECEPTION_AUDIO_SAMPLE_RATE) throw new Error("Reception audio fixture must use a 16 kHz sample rate.");
  return parsed.pcm;
}

export function resamplePcm16Mono(pcm: Uint8Array, sourceRate: number, targetRate = RECEPTION_AUDIO_SAMPLE_RATE): Buffer {
  const bytes = validatePcm16(pcm);
  if (!Number.isInteger(sourceRate) || sourceRate <= 0 || !Number.isInteger(targetRate) || targetRate <= 0) {
    throw new Error("Reception audio resample rates must be positive integers.");
  }
  if (sourceRate === targetRate) return Buffer.from(bytes);

  const sampleCount = bytes.length / BYTES_PER_SAMPLE;
  const step = sourceRate / targetRate;
  const output: number[] = [];
  for (let position = 0; position + 1 < sampleCount; position += step) {
    const index = Math.floor(position);
    const fraction = position - index;
    const first = bytes.readInt16LE(index * BYTES_PER_SAMPLE);
    const second = bytes.readInt16LE((index + 1) * BYTES_PER_SAMPLE);
    output.push(Math.max(-0x8000, Math.min(0x7fff, Math.round(first * (1 - fraction) + second * fraction))));
  }
  const result = Buffer.alloc(output.length * BYTES_PER_SAMPLE);
  output.forEach((sample, index) => result.writeInt16LE(sample, index * BYTES_PER_SAMPLE));
  return result;
}

export function loadReceptionAudioFixture(path: string): Buffer {
  let wav: Buffer;
  try {
    wav = readFileSync(path);
  } catch (cause) {
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "ENOENT") {
      throw new Error(`Missing reception audio fixture: ${path}`);
    }
    throw new Error(`Unable to read reception audio fixture: ${path}`);
  }
  parsePcm16Mono16kWav(wav);
  return wav;
}

export function splitPcmIntoReceptionFrames(pcm: Uint8Array): Buffer[] {
  const bytes = validatePcm16(pcm);
  const frames: Buffer[] = [];
  for (let start = 0; start < bytes.length; start += RECEPTION_AUDIO_FRAME_BYTES) {
    frames.push(Buffer.from(bytes.subarray(start, Math.min(start + RECEPTION_AUDIO_FRAME_BYTES, bytes.length))));
  }
  return frames;
}

function waitForAudio(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function replayPcm16Mono16kWav(
  controller: MicrophoneAudioController,
  wav: Uint8Array,
  wait: AudioWait = waitForAudio,
  trailingSilenceMs = RECEPTION_AUDIO_TRAILING_SILENCE_MS,
): Promise<{ frames: number; pcmBytes: number; silenceFrames: number }> {
  if (!Number.isInteger(trailingSilenceMs) || trailingSilenceMs < 0) throw new Error("Reception audio trailing silence must be a non-negative whole number of milliseconds.");
  const pcm = parsePcm16Mono16kWav(wav);
  const frames = splitPcmIntoReceptionFrames(pcm);
  const silencePcm = Buffer.alloc(RECEPTION_AUDIO_SAMPLE_RATE * BYTES_PER_SAMPLE * trailingSilenceMs / 1_000);
  const silenceFrames = silencePcm.length ? splitPcmIntoReceptionFrames(silencePcm) : [];
  controller.beginMicrophoneTurn();
  try {
    for (const frame of [...frames, ...silenceFrames]) {
      controller.sendMicrophoneAudio(frame.toString("base64"));
      await wait(frame.length / (RECEPTION_AUDIO_SAMPLE_RATE * BYTES_PER_SAMPLE) * 1_000);
    }
  } catch (error) {
    controller.endMicrophoneStream();
    throw error;
  }
  return { frames: frames.length, pcmBytes: pcm.length, silenceFrames: silenceFrames.length };
}

export function assertRecordedAgentReply(stage: string, outputs: readonly RecordedAgentReply[]): void {
  if (outputs.length === 0) throw new Error(`No recorded agent reply for ${stage}.`);
  const transcripts = outputs.filter((output) => output.transcript.trim());
  if (transcripts.length === 0) throw new Error(`No agent transcript was recorded for ${stage}.`);
  const missingAudio = transcripts.find((output) => output.audioBytes < 1);
  if (missingAudio) throw new Error(`Agent reply for ${stage} has transcript but no recorded PCM audio (output ${missingAudio.outputId}).`);
}

export function assertSavedBookingMatchesAcceptedOffer(
  stage: string,
  appointments: readonly SavedAppointmentFacts[],
  offer: AcceptedOfferFacts,
  patientName: string,
  confirmedPhone: string,
): void {
  if (appointments.length !== 1) throw new Error(`${stage}: expected exactly one saved appointment; found ${appointments.length}.`);
  const saved = appointments[0];
  if (saved.status !== "active") throw new Error(`${stage}: the saved appointment is not active.`);
  if (saved.patientName !== patientName) throw new Error(`${stage}: saved patient identity does not match the supplied first name.`);
  if (saved.phone !== confirmedPhone) throw new Error(`${stage}: saved contact does not match the caller's confirmed phone number.`);
  if (saved.doctorId !== offer.doctorId) throw new Error(`${stage}: saved doctor does not match the accepted database offer.`);
  if (saved.startsAtUtc !== offer.startsAtUtc) throw new Error(`${stage}: saved time does not match the accepted database offer.`);
}
