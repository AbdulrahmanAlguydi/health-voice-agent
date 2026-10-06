import express from "express";
import request from "supertest";
import { afterEach, expect, it, vi } from "vitest";
import { createReceptionTestDatabase } from "../helpers/receptionDatabase";
import { ReceptionService } from "../../src/server/reception/service";
import { createReceptionRouter } from "../../src/server/reception/routes";
import { createApp } from "../../src/server/app";
import type { Pool } from "pg";

const fixtures: Array<{ dispose: () => Promise<void> }> = [];
async function app(beforeQuery?: (sql: string) => void) {
  const fixture = await createReceptionTestDatabase({ beforeQuery });
  fixtures.push(fixture);
  const service = new ReceptionService(fixture.pool, { clock: () => new Date("2026-10-03T05:00:00Z") });
  const server = express();
  server.use(express.json());
  server.use("/api/reception", createReceptionRouter(service, { exposeActivity: true }));
  return { server, service };
}

afterEach(async () => { await Promise.all(fixtures.splice(0).map(fixture => fixture.dispose())); });

it("creates/restores a validated session and rejects malformed command carriers", async () => {
  const f = await app();
  expect((await request(f.server).post("/api/reception/sessions").send({ callingNumber: "123" })).status).toBe(400);
  const created = await request(f.server).post("/api/reception/sessions").send({ callingNumber: "+966501234567" });
  expect(created.status).toBe(201);
  expect(created.body.callingNumber).toBe("0501234567");
  expect((await request(f.server).get(`/api/reception/sessions/${created.body.sessionId}`)).body.contact.confirmedVersion).toBe(1);
  expect((await request(f.server).post(`/api/reception/sessions/${created.body.sessionId}/tools`).send({ tool: "commit_request" })).status).toBe(400);
  expect((await request(f.server).get("/api/reception/sessions/missing")).status).toBe(404);
});

it("builds one snapshot for GET and uses one existence query for guarded validation and missing sessions", async () => {
  const queries: string[] = [];
  const f = await app(sql => { queries.push(sql); });
  const snapshot = await f.service.createSession();
  queries.length = 0;
  const response = await request(f.server).get(`/api/reception/sessions/${snapshot.sessionId}`);
  expect(response.status).toBe(200);
  expect(queries.filter(sql => sql.includes("FROM reception_doctors"))).toHaveLength(1);
  expect(queries.filter(sql => sql.includes("FROM reception_offers"))).toHaveLength(1);
  expect(queries.filter(sql => sql.includes("FROM reception_operations"))).toHaveLength(1);
  expect(queries.filter(sql => sql.includes("FROM reception_metadata"))).toHaveLength(1);
  queries.length = 0;
  const information = await request(f.server).post(`/api/reception/sessions/${snapshot.sessionId}/tools`).send({
    eventId: "directory", expectedVersion: 0, tool: "clinic_information", args: {},
    context: { connectionId: "c", inputTurnId: "i", inputSequence: 1, eventSequence: 1, inputStartedEventSequence: 1, source: "text", attribution: "known" },
  });
  expect(information.status).toBe(200);
  expect(information.body.facts.doctors.length).toBeGreaterThan(0);
  expect(queries[0]).toBe("SELECT 1 FROM reception_sessions WHERE id=$1");
  // The tool reads directory facts and builds its result snapshot; the guard
  // contributes no extra catalog, offers, operations, or clinic reads.
  expect(queries.filter(sql => sql.includes("FROM reception_doctors"))).toHaveLength(2);
  expect(queries.filter(sql => sql.includes("FROM reception_offers"))).toHaveLength(1);
  expect(queries.filter(sql => sql.includes("FROM reception_operations"))).toHaveLength(1);
  expect(queries.filter(sql => sql.includes("FROM reception_metadata"))).toHaveLength(2);
  for (const sessionId of [snapshot.sessionId, "missing"]) {
    queries.length = 0;
    const invalid = await request(f.server).post(`/api/reception/sessions/${sessionId}/tools`).send({});
    expect(invalid.status).toBe(sessionId === "missing" ? 404 : 400);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/^SELECT (?:1|EXISTS).*reception_sessions/);
    expect(queries[0]).not.toMatch(/data|doctors|offers|operations|metadata/);
  }
});

it("logs only normalized route timing fields for successful, invalid, missing and unmatched requests", async () => {
  const f = await app();
  const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const created = await request(f.server).post("/api/reception/sessions").send({ callingNumber: "0501234567" });
  const base = `/api/reception/sessions/${created.body.sessionId}`;
  await request(f.server).post(`${base}/tools?name=private-name`).send({ transcript: "private-transcript" });
  await request(f.server).get("/api/reception/sessions/private-session/events/private-event");
  await request(f.server).get("/api/reception/private-path?number=0501234567");
  expect(log.mock.calls).toHaveLength(4);
  const expected = [
    { method: "POST", route: "/api/reception/sessions", status: 201 },
    { method: "POST", route: "/api/reception/sessions/:id/tools", status: 400 },
    { method: "GET", route: "/api/reception/sessions/:id/events/:eventId", status: 404 },
    { method: "GET", route: "/api/reception/unmatched", status: 404 },
  ];
  log.mock.calls.forEach((args, index) => {
    expect(args).toHaveLength(1);
    expect(args[0]).toEqual({ ...expected[index], durationMs: expect.any(Number) });
    expect(args[0].durationMs).toBeGreaterThanOrEqual(0);
  });
});

it("keeps serving reception requests when the timing logger throws", async () => {
  const f = await app();
  vi.spyOn(console, "info").mockImplementation(() => { throw new Error("logging failed"); });
  const response = await request(f.server).get("/api/reception/sessions/missing");
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ error: "session_not_found" });
});

it("logs exactly once before JSON parsing for malformed bodies and normal app responses", async () => {
  const f = await app();
  const snapshot = await f.service.createSession();
  const server = createApp({ receptionService: f.service });
  const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const base = `/api/reception/sessions/${snapshot.sessionId}`;
  const malformed = await request(server).post(`${base}/tools?name=private-name`)
    .set("Content-Type", "application/json").send('{"transcript":"private-transcript"');
  expect(malformed.status).toBe(503);
  expect(malformed.body).toEqual({ error: "service_unavailable" });
  expect(log.mock.calls).toEqual([[{ method: "POST", route: "/api/reception/sessions/:id/tools", status: 503, durationMs: expect.any(Number) }]]);

  const restored = await request(server).get(base);
  expect(restored.status).toBe(200);
  await request(server).post(`${base}/tools`).send({});
  await request(server).get("/api/reception/private-path?number=0501234567");
  expect(log.mock.calls).toHaveLength(4);
  expect(log.mock.calls.slice(1)).toEqual([
    [{ method: "GET", route: "/api/reception/sessions/:id", status: 200, durationMs: expect.any(Number) }],
    [{ method: "POST", route: "/api/reception/sessions/:id/tools", status: 400, durationMs: expect.any(Number) }],
    [{ method: "GET", route: "/api/reception/unmatched", status: 404, durationMs: expect.any(Number) }],
  ]);
  log.mock.calls.forEach(([record]) => expect(record.durationMs).toBeGreaterThanOrEqual(0));
});

it("rejects an unsupported voice without reading or mutating an existing session", async () => {
  const queries: string[] = [];
  const fixture = await createReceptionTestDatabase({ beforeQuery: sql => { queries.push(sql); } });
  fixtures.push(fixture);
  const service = new ReceptionService(fixture.pool, { clock: () => new Date("2026-10-03T05:00:00Z") });
  const snapshot = await service.createSession("0501234567");
  queries.length = 0;
  const issuer = vi.fn();
  const response = await request(createApp({ receptionService: service, geminiTokenIssuer: issuer })).post("/api/gemini/live-token").send({ sessionId: snapshot.sessionId, voiceName: "unsupported" });
  expect(response.status).toBe(400);
  expect(issuer).not.toHaveBeenCalled();
  expect(queries).toEqual([]);
  expect(await service.getSnapshot(snapshot.sessionId)).toEqual(snapshot);
});

it("records non-versioning media and exposes event recovery and persistent activity", async () => {
  const f = await app();
  const snapshot = await f.service.createSession();
  const base = `/api/reception/sessions/${snapshot.sessionId}`;
  const media = { eventId: "media", connectionId: "connection", outputId: "output", inputSequence: 1, eventSequence: 1, medium: "text", exposure: "started", offerIds: [] };
  expect((await request(f.server).post(`${base}/events`).send(media)).body.status).toBe("ok");
  expect((await f.service.getSnapshot(snapshot.sessionId))?.version).toBe(0);
  expect((await request(f.server).get(`${base}/events/unknown`)).body.status).toBe("not_found");
  const closed = await request(f.server).post(`${base}/close`).send({ eventId: "close", expectedVersion: 0, outcome: "declined" });
  expect(closed.body.status).toBe("closed");
  expect((await request(f.server).get(`${base}/events/close`)).body.status).toBe("closed");
  expect((await request(f.server).get("/api/reception/activity")).body).toEqual({ appointments: [], effects: [] });
});

it("returns a controlled API error when a Postgres query fails", async () => {
  const failure = new Error("connect ECONNREFUSED postgres://private-host/secret-db; stack details");
  const pool = { query: vi.fn().mockRejectedValue(failure) } as unknown as Pool;
  const response = await request(createApp({ receptionPool: pool })).get("/api/reception/sessions/missing");

  expect(response.status).toBe(503);
  expect(response.body).toEqual({ error: "service_unavailable" });
  expect(response.text).not.toContain("private-host");
  expect(response.text).not.toContain("secret-db");
  expect(response.text).not.toContain("stack details");
});
