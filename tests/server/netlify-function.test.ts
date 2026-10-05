import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createReceptionTestDatabase } from "../helpers/receptionDatabase";

const { state } = vi.hoisted(() => ({ state: { pool: null as unknown } }));
vi.mock("../../src/server/reception/database", () => ({ getReceptionPool: () => state.pool }));

type FunctionResponse = { statusCode: number; body: string };
type FunctionHandler = (event: Record<string, unknown>, context: Record<string, unknown>) => Promise<unknown>;

let handler: FunctionHandler;
let disposeDatabase: (() => Promise<void>) | undefined;

beforeAll(async () => {
  const fixture = await createReceptionTestDatabase();
  state.pool = fixture.pool;
  disposeDatabase = fixture.dispose;
  vi.stubEnv("GEMINI_API_KEY", "");
  ({ handler } = await import("../../netlify/functions/api"));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await disposeDatabase?.();
});

async function invoke(path: string, method = "GET", body?: unknown): Promise<FunctionResponse> {
  const result = await handler({
    httpMethod: method,
    path,
    headers: { host: "localhost", "x-forwarded-proto": "http", "content-type": "application/json" },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    body: body === undefined ? null : JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: { identity: { sourceIp: "127.0.0.1" } },
  }, {});
  return result as FunctionResponse;
}

describe("configured Netlify API function", () => {
  it("preserves the rewritten /api path when dispatching to Express", async () => {
    const response = await invoke("/api/health");

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ status: "ok" });
  });

  it("does not expose cross-session reception activity from the public function", async () => {
    const response = await invoke("/api/reception/activity");

    expect(response.statusCode).toBe(404);
  });

  it("preserves the reception session JSON contract through the Netlify function", async () => {
    const response = await invoke("/api/reception/sessions", "POST", { callingNumber: "0501234567" });
    const body = JSON.parse(response.body) as Record<string, unknown>;

    expect(response.statusCode).toBe(201);
    expect(body.sessionId).toEqual(expect.any(String));
    expect(body.version).toBe(0);
    expect(body.status).toBe("active");
    expect(body).toMatchObject({
      callingNumber: "0501234567",
      clock: { timeZone: "Asia/Riyadh", localDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
      contact: { digits: "0501234567", version: 1, confirmedVersion: 1 },
      clinic: { synthetic: true },
      offers: [],
      operations: [],
    });
    expect(body.directory).toHaveLength(30);
    expect(body.directory).toEqual(expect.arrayContaining([expect.objectContaining({ doctorId: "doc-001" })]));

    const restored = await invoke(`/api/reception/sessions/${String(body.sessionId)}`);
    expect(restored.statusCode).toBe(200);
    expect(JSON.parse(restored.body)).toMatchObject({
      sessionId: body.sessionId,
      version: body.version,
      status: body.status,
      contact: body.contact,
    });
  });

  it("returns a controlled configuration failure when GEMINI_API_KEY is missing", async () => {
    const response = await invoke("/api/gemini/live-token", "POST");
    const body = JSON.parse(response.body) as Record<string, unknown>;

    expect(response.statusCode).toBe(503);
    expect(body.error).toBe("Live voice is not configured on this server.");
    expect(body).not.toHaveProperty("token");
    expect(response.body).not.toMatch(/GEMINI_API_KEY|stack|Error:|secret/i);
  });
});
