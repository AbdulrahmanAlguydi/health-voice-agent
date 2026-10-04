import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  RECEPTION_AUDIO_SAMPLE_RATE,
  RECEPTION_CALLER_TURNS,
  receptionAudioFixtureDirectory,
  receptionAudioFixturePath,
  loadReceptionAudioFixture,
  parsePcm16MonoWav,
  parsePcm16Mono16kWav,
  resamplePcm16Mono,
  selectReceptionAudioFixtures,
  wrapPcm16MonoWav,
  type ReceptionAudioLanguage,
} from "./receptionAudio";

const TTS_MODEL = "gemini-3.8-flash-tts";
const TTS_VOICE = "Kore";
const force = process.argv.includes("--force");
const languageArgument = process.argv.find((argument) => argument.startsWith("--language="));
const requestedLanguage = languageArgument?.slice("--language=".length);
if (requestedLanguage && requestedLanguage !== "ar" && requestedLanguage !== "en") {
  throw new Error("--language must be either ar or en.");
}
const fixtureDirectory = receptionAudioFixtureDirectory();
const fixturePaths = Object.entries(RECEPTION_CALLER_TURNS).flatMap(([language, turns]) =>
  turns.map((turn) => ({ language: language as ReceptionAudioLanguage, ...turn, path: receptionAudioFixturePath(language as ReceptionAudioLanguage, turn.id) })),
);
const selectedFixtures = selectReceptionAudioFixtures(
  fixturePaths,
  requestedLanguage as ReceptionAudioLanguage | undefined,
);
if (!force) {
  for (const fixture of selectedFixtures.filter(({ path }) => existsSync(path))) {
    try {
      loadReceptionAudioFixture(fixture.path);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "invalid WAV fixture";
      throw new Error(`Cached fixture ${fixture.path} is invalid (${detail}); run with --force to regenerate it.`);
    }
  }
}
const pending = selectedFixtures.filter(({ path }) => force || !existsSync(path));

if (pending.length === 0) {
  for (const fixture of selectedFixtures) {
    try {
      loadReceptionAudioFixture(fixture.path);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "invalid WAV fixture";
      throw new Error(`Cached fixture ${fixture.path} is invalid (${detail}); run with --force to regenerate it.`);
    }
  }
  const languageLabel = requestedLanguage === "ar" ? "Arabic" : requestedLanguage === "en" ? "English" : "Arabic/English";
  console.info(`Reused ${selectedFixtures.length} cached ${languageLabel} caller WAV fixtures under ${fixtureDirectory}.`);
} else {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is required to generate missing caller audio fixtures.");

  const ai = new GoogleGenAI({ apiKey, apiVersion: "v1beta" });
  for (const fixture of pending) {
    mkdirSync(join(fixtureDirectory, fixture.language), { recursive: true });
    console.info(`Generating ${fixture.language}/${fixture.id}.wav with Gemini TTS...`);
    let response;
    try {
      response = await ai.interactions.create({
        model: TTS_MODEL,
        input: [{
          type: "user_input",
          content: [{
            type: "text",
            text: fixture.text,
            annotations: [{
              type: "speech_metadata",
              style: fixture.language === "ar"
                ? "Natural Saudi Hijazi caller voice, clear, conversational pace. Say exactly the supplied Arabic words and do not add or omit words."
                : "Natural conversational English caller voice, clear, moderate pace. Say exactly the supplied English words and do not add or omit words.",
            }],
          }],
        }],
        response_format: { type: "audio", mime_type: "audio/wav", sample_rate: RECEPTION_AUDIO_SAMPLE_RATE },
        generation_config: { speech_config: [{ voice: TTS_VOICE }] },
      });
    } catch (cause) {
      const error = cause as Error & { status?: number; code?: string };
      const detail = (error.message || "Provider request failed").replaceAll(apiKey, "[REDACTED]");
      const status = typeof error.status === "number" ? ` HTTP ${error.status}` : "";
      const code = typeof error.code === "string" ? ` (${error.code})` : "";
      throw new Error(`Gemini TTS generation failed for ${fixture.language}/${fixture.id}${status}${code}: ${detail}`);
    }

    const audio = response.output_audio;
    if (!audio?.data) throw new Error(`Gemini TTS returned no audio for ${fixture.language}/${fixture.id}.`);
    if (!/^audio\/wav(?:;|$)/i.test(audio.mime_type ?? "")) {
      throw new Error(`Gemini TTS returned an unsupported audio format for ${fixture.language}/${fixture.id}; expected WAV.`);
    }
    const responseWav = Buffer.from(audio.data, "base64");
    let wav: Buffer;
    try {
      const decoded = parsePcm16MonoWav(responseWav);
      wav = wrapPcm16MonoWav(resamplePcm16Mono(decoded.pcm, decoded.sampleRate));
      parsePcm16Mono16kWav(wav);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "invalid WAV payload";
      throw new Error(`Gemini TTS returned unsupported WAV audio for ${fixture.language}/${fixture.id}: ${detail}`);
    }
    writeFileSync(fixture.path, wav);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    model: TTS_MODEL,
    voice: TTS_VOICE,
    sampleRateHz: RECEPTION_AUDIO_SAMPLE_RATE,
    encoding: "mono PCM16 in RIFF/WAVE",
    fixtures: Object.fromEntries(Object.entries(RECEPTION_CALLER_TURNS).map(([language, turns]) => [language, turns.map(({ id, text }) => ({ id, text, path: join(language, `${id}.wav`) }))])),
  };
  writeFileSync(join(fixtureDirectory, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.info(`Generated ${pending.length} caller WAV fixtures under ${fixtureDirectory}.`);
}
