import { Router } from "express";
import { OutputVerificationRequestSchema, OutputVerificationVerdictSchema, type OutputVerifier } from "../../shared/outputVerification";

export function createOutputVerificationRouter(verify?: OutputVerifier) {
  const router = Router();
  router.post("/verify-output", async (request, response) => {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    const input = OutputVerificationRequestSchema.safeParse(request.body);
    if (!input.success) { response.status(400).json({ error: "Invalid verification request." }); return; }
    if (!verify) { response.status(503).json({ error: "Output verification is not configured." }); return; }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 11000);
    const disconnect = () => { if (!response.writableEnded) abort.abort(); };
    response.on("close", disconnect);
    try {
      const verdict = OutputVerificationVerdictSchema.parse(await verify(input.data, abort.signal));
      if (!abort.signal.aborted) response.json(verdict);
      else if (!response.destroyed) response.status(504).json({ error: "Output verification timed out." });
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error ? Number(error.status) : undefined;
      console.warn(`Output verification failed: ${status ?? "invalid provider response"}`);
      if (!response.destroyed) response.status(status === 429 || status === 503 ? status : 502).json({ error: "Could not verify output." });
    } finally { clearTimeout(timer); response.off("close", disconnect); }
  });
  return router;
}
