import type { AuthToken, CreateAuthTokenParameters, LiveConnectConfig } from "@google/genai";
import { GEMINI_LIVE_MODEL } from "../../shared/geminiLiveConfig";
import { createReceptionLiveConfig } from "../../shared/receptionPrompt";
import type { ReceptionSnapshot } from "../../shared/reception";
import { isGeminiVoiceName, resolveGeminiVoiceDefault, type GeminiVoiceName } from "../../shared/geminiVoices";

export type GeminiTokenIssueResult = { token: string; expiresAt: string; voiceName: string };

export type GeminiAuthTokenClient = {
  create(params: CreateAuthTokenParameters): Promise<AuthToken>;
};

export type GeminiTokenIssuer = ((snapshot?: ReceptionSnapshot, voiceName?: GeminiVoiceName) => Promise<GeminiTokenIssueResult>) & { defaultVoiceName?: GeminiVoiceName };

const isoAfter = (now: Date, milliseconds: number) =>
  new Date(now.getTime() + milliseconds).toISOString();

export function createGeminiTokenIssuer(
  authTokens: GeminiAuthTokenClient,
  now: () => Date = () => new Date(),
  defaultVoiceName: string = resolveGeminiVoiceDefault(process.env.GEMINI_VOICE),
  createConfig: (voiceName: string, snapshot?: ReceptionSnapshot) => LiveConnectConfig = createReceptionLiveConfig,
): GeminiTokenIssuer {
  const configuredVoice = resolveGeminiVoiceDefault(defaultVoiceName);
  const issue: GeminiTokenIssuer = async (snapshot, selectedVoice) => {
    const voiceName = selectedVoice ?? configuredVoice;
    if (!isGeminiVoiceName(voiceName)) throw new Error("Unsupported Live voice.");
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
  issue.defaultVoiceName = configuredVoice;
  return issue;
}
