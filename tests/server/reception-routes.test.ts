import express from "express";
import request from "supertest";
import { afterEach, expect, it } from "vitest";
import type Database from "better-sqlite3";
import { openReceptionDatabase } from "../../src/server/reception/database";
import { ReceptionService } from "../../src/server/reception/service";
import { createReceptionRouter } from "../../src/server/reception/routes";
const connections:Database.Database[]=[];
function app(){const db=openReceptionDatabase(":memory:");connections.push(db);const service=new ReceptionService(db,{clock:()=>new Date("2026-10-03T05:00:00Z")});const server=express();server.use(express.json());server.use("/api/reception",createReceptionRouter(service));return {server,service};}
afterEach(()=>{for(const db of connections.splice(0))db.close();});
it("creates/restores a validated session and rejects malformed command carriers",async()=>{
 const f=app();expect((await request(f.server).post("/api/reception/sessions").send({callingNumber:"123"})).status).toBe(400);
 const created=await request(f.server).post("/api/reception/sessions").send({callingNumber:"+966501234567"});expect(created.status).toBe(201);expect(created.body.callingNumber).toBe("0501234567");
 expect((await request(f.server).get(`/api/reception/sessions/${created.body.sessionId}`)).body.contact.confirmedVersion).toBe(1);
 expect((await request(f.server).post(`/api/reception/sessions/${created.body.sessionId}/tools`).send({tool:"commit_request"})).status).toBe(400);
 expect((await request(f.server).get("/api/reception/sessions/missing")).status).toBe(404);
});
it("records non-versioning media and exposes event recovery and persistent activity",async()=>{
 const f=app();const snapshot=f.service.createSession();const base=`/api/reception/sessions/${snapshot.sessionId}`;
 const media={eventId:"media",connectionId:"connection",outputId:"output",inputSequence:1,eventSequence:1,medium:"text",exposure:"started",offerIds:[]};
 expect((await request(f.server).post(`${base}/events`).send(media)).body.status).toBe("ok");expect(f.service.getSnapshot(snapshot.sessionId)?.version).toBe(0);
 expect((await request(f.server).get(`${base}/events/unknown`)).body.status).toBe("not_found");
 const closed=await request(f.server).post(`${base}/close`).send({eventId:"close",expectedVersion:0,outcome:"declined"});expect(closed.body.status).toBe("closed");
 expect((await request(f.server).get(`${base}/events/close`)).body.status).toBe("closed");expect((await request(f.server).get("/api/reception/activity")).body).toEqual({appointments:[],effects:[]});
});
