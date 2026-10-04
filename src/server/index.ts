import "dotenv/config";
import { resolve } from "node:path";
import { GoogleGenAI } from "@google/genai";
import { createApp } from "./app";
import { openReceptionDatabase } from "./reception/database";
import { createGeminiTokenIssuer } from "./services/geminiTokenService";

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port between 1 and 65535.");
}

const databasePath = resolve(process.env.RECEPTION_DATABASE_PATH ?? "./data/reception.sqlite");
const db = openReceptionDatabase(databasePath);
const apiKey = process.env.GEMINI_API_KEY?.trim();
const tokenIssuer = apiKey
  ? createGeminiTokenIssuer(new GoogleGenAI({ apiKey, apiVersion: "v1beta" }).authTokens)
  : undefined;
const app = createApp({ receptionDb: db, geminiTokenIssuer: tokenIssuer });
const server = app.listen(port, () => {
  console.info(`Health voice agent server listening on http://localhost:${port}`);
  console.info(`Prototype database: ${databasePath}`);
  console.info("Reception runtime: resource API, native streaming Gemini Live speech");
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
