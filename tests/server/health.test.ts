import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app";

describe("GET /api/health", () => {
  it("returns a small healthy status without connecting to the Gemini API", async () => {
    const app = createApp();

    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});
