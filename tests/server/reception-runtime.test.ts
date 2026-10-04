import { describe, expect, it, vi } from "vitest";
import { createGeminiTokenIssuer } from "../../src/server/services/geminiTokenService";
import request from "supertest";
import { createApp } from "../../src/server/app";
import { openReceptionDatabase } from "../../src/server/reception/database";
import { ReceptionService } from "../../src/server/reception/service";

describe("replacement runtime token constraints", () => {
  it("authorizes only the resource receptionist functions", async () => {
    const create = vi.fn().mockResolvedValue({ name: "synthetic-token" });
    await createGeminiTokenIssuer({ create })();
    const args = create.mock.calls[0]![0] as { config: { liveConnectConstraints: { config: { tools: Array<{ functionDeclarations: Array<{ name: string }> }>; systemInstruction: string } } } };
    const config = args.config.liveConnectConstraints.config;
    expect(config.tools.flatMap((tool) => tool.functionDeclarations.map(({ name }) => name))).toEqual([
      "clinic_information", "find_available_slots", "set_booking_details", "capture_contact", "confirm_contact",
      "accept_offer", "commit_request", "get_operation", "find_my_appointments", "select_appointment",
      "record_followup", "set_emergency", "end_session",
    ]);
    expect(config.systemInstruction).not.toContain("confirm_booking");
  });
});

it("locks Live token context to the selected persisted reception session", async () => {
  const db = openReceptionDatabase(":memory:");
  try {
    const clock=()=>new Date("2026-10-03T22:30:00Z");
    const service=new ReceptionService(db,{clock});
    const session=service.createSession("0501234567");
    service.execute(session.sessionId,{eventId:"name",expectedVersion:0,tool:"set_booking_details",args:{patientName:"Saved Synthetic Caller"},context:{connectionId:"c",inputTurnId:"i",inputSequence:1,eventSequence:1,inputStartedEventSequence:1,source:"text",attribution:"known"}});
    const create=vi.fn().mockResolvedValue({name:"synthetic-token"});
    const app=createApp({receptionService:service,geminiTokenIssuer:createGeminiTokenIssuer({create},clock)});
    const result=await request(app).post("/api/gemini/live-token").send({sessionId:session.sessionId});
    expect(result.status).toBe(200);
    const config=create.mock.calls[0]![0] as {config:{liveConnectConstraints:{config:{systemInstruction:string}}}};
    const instruction=config.config.liveConnectConstraints.config.systemInstruction;
    expect(instruction).toContain(session.sessionId);
    expect(instruction).toContain("Saved Synthetic Caller");
    expect(instruction).toContain("2026-10-04");
    expect(instruction).toContain("Asia/Riyadh");
    expect(instruction).toContain("doc-030");
    expect((await request(app).post("/api/gemini/live-token").send({sessionId:"missing"})).status).toBe(404);
  } finally {db.close();}
});
