import { Router } from "express";
import type { GeminiTokenIssuer } from "../services/geminiTokenService";
import type { ReceptionSnapshot } from "../../shared/reception";

const WINDOW_MS = 60_000;
const MAX_TOKENS_PER_WINDOW = 8;

export function createGeminiRouter(issueToken?: GeminiTokenIssuer, getSnapshot?: (id: string) => ReceptionSnapshot | undefined) {
  const router = Router();
  const requests = new Map<string, { count: number; resetAt: number }>();

  router.post("/live-token", async (request, response) => {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.setHeader("Pragma", "no-cache");
    if (!issueToken) {
      response.status(503).json({ error: "Live voice is not configured on this server." });
      return;
    }
    let snapshot: ReceptionSnapshot | undefined;
    if (getSnapshot) {
      if (typeof request.body?.sessionId !== "string") { response.status(400).json({ error: "Reception session is required." }); return; }
      snapshot = getSnapshot(request.body.sessionId);
      if (!snapshot) { response.status(404).json({ error: "Reception session was not found." }); return; }
      if (snapshot.status === "closed") { response.status(409).json({ error: "Reception session is closed." }); return; }
    }

    const now = Date.now();
    for (const [ip, value] of requests) {
      if (value.resetAt <= now) requests.delete(ip);
    }
    const key = request.ip ?? "unknown";
    const bucket = requests.get(key);
    if (bucket && bucket.resetAt > now && bucket.count >= MAX_TOKENS_PER_WINDOW) {
      response.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      response.status(429).json({ error: "Please wait before starting another voice session." });
      return;
    }
    requests.set(
      key,
      bucket && bucket.resetAt > now
        ? { ...bucket, count: bucket.count + 1 }
        : { count: 1, resetAt: now + WINDOW_MS },
    );

    try {
      const token = await issueToken(snapshot);
      response.status(200).json({ ...token, model: "gemini-3.8-live" });
    } catch {
      // Never echo provider errors: SDK errors may contain request details or credentials.
      console.error("Gemini Live ephemeral token issuance failed.");
      response.status(502).json({ error: "Could not start a secure voice session. Please try again." });
    }
  });

  return router;
}
