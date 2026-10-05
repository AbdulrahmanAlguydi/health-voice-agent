import express from "express";
import request from "supertest";
import { afterEach, expect, it, vi } from "vitest";
import { createReceptionTestDatabase } from "../helpers/receptionDatabase";
import { ReceptionService } from "../../src/server/reception/service";
import { createReceptionRouter } from "../../src/server/reception/routes";
import { createApp } from "../../src/server/app";
import type { Pool } from "pg";

const fixtures: Array<{ dispose: () => Promise<void> }> = [];
async function app() {
  const fixture = await createReceptionTestDatabase();
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
