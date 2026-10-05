import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import serverless from "serverless-http";
import { createApp } from "../../src/server/app";
import { getReceptionPool } from "../../src/server/reception/database";
import { createGeminiTokenIssuer } from "../../src/server/services/geminiTokenService";

// Construct the shared Express app once per warm function instance. Netlify
// Database selects the production or local Postgres branch from its runtime.
const pool = getReceptionPool();
const apiKey = process.env.GEMINI_API_KEY?.trim();
const tokenIssuer = apiKey
  ? createGeminiTokenIssuer(new GoogleGenAI({ apiKey, apiVersion: "v1beta" }).authTokens)
  : undefined;
const app = createApp({ receptionPool: pool, geminiTokenIssuer: tokenIssuer, exposeReceptionActivity: false });

export const handler = serverless(app);
