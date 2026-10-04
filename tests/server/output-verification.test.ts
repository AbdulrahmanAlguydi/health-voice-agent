import request from "supertest";
import { describe, it, expect } from "vitest";
import { createApp } from "../../src/server/app";

describe("output verification endpoint", () => {
  it("fails closed when verification is not configured", async () => {
    const result = await request(createApp()).post("/api/gemini/verify-output").send({ transcript: "Hello", language: "en" });
    expect(result.status).toBe(503);
    expect(result.headers["cache-control"]).toContain("no-store");
  });
  it("returns a validated verdict without provider metadata", async () => {
    const app = createApp({ outputVerifier: async () => ({ approved: true, conversational: true, reason: "supported" }) });
    const result = await request(app).post("/api/gemini/verify-output").send({ transcript: "Hello", language: "en" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ approved: true, conversational: true, reason: "supported" });
  });
  it("rejects invalid input before calling the provider", async () => {
    const app = createApp({ outputVerifier: async () => { throw new Error("must not be called"); } });
    const result = await request(app).post("/api/gemini/verify-output").send({ transcript: "", language: "fr" });
    expect(result.status).toBe(400);
  });
  it("does not expose provider errors", async () => {
    const app = createApp({ outputVerifier: async () => { throw new Error("secret key and raw text"); } });
    const result = await request(app).post("/api/gemini/verify-output").send({ transcript: "Hello", language: "en" });
    expect(result.status).toBe(502);
    expect(JSON.stringify(result.body)).not.toContain("secret");
  });

  it("fails closed on inconsistent approval and reason", async () => {
    const app = createApp({ outputVerifier: async () => ({ approved: true, conversational: true, reason: "out_of_scope" }) });
    const result = await request(app).post("/api/gemini/verify-output").send({ transcript: "Hello", language: "en" });
    expect(result.status).toBe(502);
  });
});
