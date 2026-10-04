import type { AuthToken, CreateAuthTokenParameters, LiveConnectConfig } from "@google/genai";
import { GEMINI_LIVE_MODEL } from "../../shared/geminiLiveConfig";
import { createReceptionLiveConfig } from "../../shared/receptionPrompt";
import type { ReceptionSnapshot } from "../../shared/reception";

export type GeminiTokenIssueResult = { token: string; expiresAt: string; voiceName: string };

export type GeminiAuthTokenClient = {
  create(params: CreateAuthTokenParameters): Promise<AuthToken>;
};

export type GeminiTokenIssuer = (snapshot?: ReceptionSnapshot) => Promise<GeminiTokenIssueResult>;

const isoAfter = (now: Date, milliseconds: number) =>
  new Date(now.getTime() + milliseconds).toISOString();

export function createGeminiTokenIssuer(
  authTokens: GeminiAuthTokenClient,
  now: () => Date = () => new Date(),
  voiceName = process.env.GEMINI_VOICE ?? "Kore",
  createConfig: (voiceName: string, snapshot?: ReceptionSnapshot) => LiveConnectConfig = createReceptionLiveConfig,
): GeminiTokenIssuer {
  return async (snapshot) => {
    const issuedAt = now();
    const expiresAt = isoAfter(issuedAt, 10 * 60_000);
    const token = await authTokens.create({
      config: {
        uses: 1,
        expireTime: expiresAt,
        newSessionExpireTime: isoAfter(issuedAt, 60_000),
        httpOptions: { apiVersion: "v1beta" },
        liveConnectConstraints: {
          model: GEMINI_LIVE_MODEL,
          config: createConfig(voiceName, snapshot),
        },
      },
    });
    if (!token.name) throw new Error("Token provider returned no token name.");
    return { token: token.name, expiresAt: token.expireTime ?? expiresAt, voiceName };
  };
}
