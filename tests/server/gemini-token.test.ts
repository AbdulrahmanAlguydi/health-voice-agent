import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { Behavior } from "@google/genai";
import { createApp } from "../../src/server/app";
import { createGeminiTokenIssuer } from "../../src/server/services/geminiTokenService";
import { createGeminiLiveConfig } from "../../src/shared/geminiLiveConfig";

describe("POST /api/gemini/live-token", () => {
  it("exposes only curated voice options and the configured default", async () => {
    const create = vi.fn().mockResolvedValue({ name: "token" });
    const issueToken = createGeminiTokenIssuer({ create }, undefined, "Fenrir");
    const response = await request(createApp({ geminiTokenIssuer: issueToken })).get("/api/gemini/voices");
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(["defaultVoice", "voices"]);
    expect(response.body.defaultVoice).toBe("Fenrir");
    expect(response.body.voices).toHaveLength(30);
    expect(new Set(response.body.voices.map((voice: any) => voice.name)).size).toBe(30);
    expect(response.body.voices).toContainEqual({ name: "Kore", descriptionEn: "Firm", descriptionAr: "حازم" });
    expect(create).not.toHaveBeenCalled();
  });

  it("uses the selected voice in the provider constraints and token response", async () => {
    const create = vi.fn().mockResolvedValue({ name: "token" });
    const issuer = createGeminiTokenIssuer({ create }, undefined, "Fenrir");
    const response = await request(createApp({ geminiTokenIssuer: issuer })).post("/api/gemini/live-token").send({ voiceName: "Aoede" });
    expect(response.status).toBe(200);
    expect(response.body.voiceName).toBe("Aoede");
    expect(create.mock.calls[0][0].config.liveConnectConstraints.config.speechConfig).toEqual({ voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } });
    const defaultResponse = await request(createApp({ geminiTokenIssuer: issuer })).post("/api/gemini/live-token").send({});
    expect(defaultResponse.body.voiceName).toBe("Fenrir");
  });

  it.each(["unknown", "", "kore", " Kore ", null, 42, { name: "Kore" }])("rejects unsupported or malformed voice %j before issuing a token", async (voiceName) => {
    const create = vi.fn().mockResolvedValue({ name: "token" });
    const response = await request(createApp({ geminiTokenIssuer: createGeminiTokenIssuer({ create }) })).post("/api/gemini/live-token").send({ voiceName });
    expect(response.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns only a short-lived token and never caches it", async () => {
    const issueToken = vi.fn().mockResolvedValue({
      token: "ephemeral-token-secret",
      expiresAt: "2026-09-29T12:05:00.000Z",
      voiceName: "Kore",
    });
    const app = createApp({ geminiTokenIssuer: issueToken });

    const response = await request(app).post("/api/gemini/live-token").send({});

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.body).toEqual({
      token: "ephemeral-token-secret",
      model: "gemini-3.8-live",
      expiresAt: "2026-09-29T12:05:00.000Z",
      voiceName: "Kore",
    });
  });

  it("returns a generic setup error if the server has no Gemini credentials", async () => {
    const response = await request(createApp()).post("/api/gemini/live-token").send({});

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: "Live voice is not configured on this server." });
    expect(response.headers["cache-control"]).toContain("no-store");
  });

  it("does not expose provider errors or credentials", async () => {
    const app = createApp({
      geminiTokenIssuer: vi.fn().mockRejectedValue(new Error("secret API key leaked by upstream")),
    });

    const response = await request(app).post("/api/gemini/live-token").send({});

    expect(response.status).toBe(502);
    expect(JSON.stringify(response.body)).not.toContain("secret API key");
  });

  it("rate-limits token creation and never caches rate-limit responses", async () => {
    const issueToken = vi.fn().mockResolvedValue({
      token: "ephemeral-token-secret",
      expiresAt: "2026-09-29T12:05:00.000Z",
      voiceName: "Kore",
    });
    const app = createApp({ geminiTokenIssuer: issueToken });
    for (let index = 0; index < 8; index += 1) {
      await request(app).post("/api/gemini/live-token").send({});
    }

    const limited = await request(app).post("/api/gemini/live-token").send({});

    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBeTruthy();
    expect(limited.headers["cache-control"]).toContain("no-store");
    expect(issueToken).toHaveBeenCalledTimes(8);
  });
});

describe("legacy Gemini Live token constraints (explicit fixture)", () => {
  it("requests a single-use, short-lived token locked to the approved Live session", async () => {
    const create = vi.fn().mockResolvedValue({
      name: "ephemeral-token-secret",
      expireTime: "2026-09-29T12:05:00.000Z",
    });
    const issueToken = createGeminiTokenIssuer({ create }, () => new Date("2026-09-29T12:00:00.000Z"), "Kore", (voice) => createGeminiLiveConfig(voice));

    await issueToken();

    const [{ config }] = create.mock.calls[0] as [{ config: Record<string, unknown> }];
    expect(config.uses).toBe(1);
    expect(config.expireTime).toBe("2026-09-29T12:10:00.000Z");
    expect(config.newSessionExpireTime).toBe("2026-09-29T12:01:00.000Z");
    expect(config.liveConnectConstraints).toMatchObject({ model: "gemini-3.8-live" });
    expect(config.lockAdditionalFields).toBeUndefined();
    const liveConfig = (config.liveConnectConstraints as { config: Record<string, unknown> }).config;
    expect(liveConfig.responseModalities).toEqual(["AUDIO"]);
    expect(liveConfig.inputAudioTranscription).toEqual({ languageCodes: ["ar-SA", "en-US"] });
    expect(liveConfig.outputAudioTranscription).toEqual({});
    expect(liveConfig.systemInstruction).toBeTruthy();
    expect(liveConfig.systemInstruction).toContain("ضغط المتصل");
    expect(liveConfig.systemInstruction).toContain("scope_redirect");
    expect(liveConfig.systemInstruction).toContain("آخر سؤال معتمد");
    const tools = liveConfig.tools as Array<{ functionDeclarations: Array<{ name: string; behavior?: Behavior }> }>;
    const declarations = tools.flatMap((tool) => tool.functionDeclarations);
    expect(declarations.map(({ name }) => name)).toEqual([
      "repeat_last_response",
      "speak_safe_reply",
      "lookup_patient",
      "confirm_patient_identity",
      "begin_booking",
      "list_specialties",
      "search_doctors",
      "get_doctor_details",
      "get_available_slots",
      "prepare_booking",
      "prepare_guest_booking",
      "confirm_booking",
      "cancel_pending_booking",
      "end_session",
    ]);
    expect(declarations.slice(0, -1).every(({ behavior }) => behavior === Behavior.BLOCKING)).toBe(true);
    expect(declarations.at(-1)?.name).toBe("end_session");
    expect(declarations.at(-1)?.behavior).toBe("BLOCKING");
    expect(declarations.some(({ name }) => name === "run_sql" || name === "google_search")).toBe(false);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      config: { httpOptions: { apiVersion: "v1beta" } },
    });
  });

  it("does not offer arbitrary query or booking-write fields to confirmation", async () => {
    const create = vi.fn().mockResolvedValue({ name: "token" });
    const issueToken = createGeminiTokenIssuer({ create }, () => new Date("2026-09-29T12:00:00.000Z"), "Kore", (voice) => createGeminiLiveConfig(voice));

    await issueToken();

    const [{ config }] = create.mock.calls[0] as [{ config: Record<string, unknown> }];
    const tools = (config.liveConnectConstraints as { config: { tools: Array<{ functionDeclarations: Array<{ name: string; parametersJsonSchema?: unknown }> }> } }).config.tools;
    const declarations = tools.flatMap((tool) => tool.functionDeclarations);
    const confirm = declarations.find(({ name }) => name === "confirm_booking");
    expect(confirm?.parametersJsonSchema).toMatchObject({
      properties: {},
      additionalProperties: false,
    });
    expect(JSON.stringify(confirm?.parametersJsonSchema)).not.toContain("finalTranscript");
  });
});
