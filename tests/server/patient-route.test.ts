import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app";
import { createTestDatabase } from "../helpers/testDatabase";

describe("POST /api/patients/lookup", () => {
  let fixture: ReturnType<typeof createTestDatabase>;
  beforeEach(() => {
    fixture = createTestDatabase();
  });
  afterEach(() => fixture.dispose());

  it("confirms only the synthetic patient's localized name for a valid ID", async () => {
    const response = await request(createApp({ db: fixture.db }))
      .post("/api/patients/lookup")
      .send({ patientId: "P-1001", language: "ar" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "found",
      patient: { patientId: "P-1001", fullName: "مريم السالم" },
      responseText: "لقيت ملف باسم مريم السالم. هذا ملفك؟",
    });
  });

  it("does not return patient details for an unknown ID", async () => {
    const response = await request(createApp({ db: fixture.db }))
      .post("/api/patients/lookup")
      .send({ patientId: "P-9999", language: "en" });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      status: "not_found",
      responseText: "I couldn't find that ID. Give me another one if you have it, or we can continue as a guest.",
    });
  });

  it("normalizes spoken spacing and finds demo patient 123 in either language", async () => {
    const response = await request(createApp({ db: fixture.db }))
      .post("/api/patients/lookup")
      .send({ patientId: "1 2 3", language: "en" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "found",
      patient: { patientId: "123", fullName: "Test Patient" },
      responseText: "I found a profile for Test Patient. Is that you?",
    });

    const arabic = await request(createApp({ db: fixture.db }))
      .post("/api/patients/lookup")
      .send({ patientId: "123", language: "ar" });

    expect(arabic.status).toBe(200);
    expect(arabic.body).toEqual({
      status: "found",
      patient: { patientId: "123", fullName: "مريض تجريبي" },
      responseText: "لقيت ملف باسم مريض تجريبي. هذا ملفك؟",
    });
  });

  it("rejects fields the patient lookup does not support", async () => {
    const response = await request(createApp({ db: fixture.db }))
      .post("/api/patients/lookup")
      .send({ patientId: "P-1001", language: "en", sql: "SELECT * FROM patients" });

    expect(response.status).toBe(400);
    expect(response.body.status).toBe("invalid_request");
  });
});
