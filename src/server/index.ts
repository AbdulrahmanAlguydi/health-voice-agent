import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { createApp } from "./app";
import { getReceptionPool } from "./reception/database";
import { createGeminiTokenIssuer } from "./services/geminiTokenService";

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port between 1 and 65535.");
}

const pool = getReceptionPool();
const apiKey = process.env.GEMINI_API_KEY?.trim();
const tokenIssuer = apiKey
  ? createGeminiTokenIssuer(new GoogleGenAI({ apiKey, apiVersion: "v1beta" }).authTokens)
  : undefined;
const app = createApp({ receptionPool: pool, geminiTokenIssuer: tokenIssuer, exposeReceptionActivity: process.env.NODE_ENV === "development" });
const server = app.listen(port, () => {
  console.info(`Health voice agent server listening on http://localhost:${port}`);
  console.info("Reception database: Netlify Postgres");
  console.info("Reception runtime: resource API, native streaming Gemini Live speech");
});

function shutdown() {
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
