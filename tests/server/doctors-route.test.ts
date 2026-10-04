import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app";
import { createTestDatabase } from "../helpers/testDatabase";

describe("POST /api/doctors/search", () => {
  let fixture: ReturnType<typeof createTestDatabase>;
  beforeEach(() => {
    fixture = createTestDatabase();
  });
  afterEach(() => fixture.dispose());

  it("resolves an exact Arabic doctor alias to the canonical English-backed record", async () => {
    const response = await request(createApp({ db: fixture.db }))
      .post("/api/doctors/search")
      .send({ query: "خالد العتيبي", language: "ar" });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.doctors).toEqual([
      {
        doctorId: "doc-001",
        name: "د. خالد العتيبي",
        specialty: "أمراض القلب",
        clinicLocation: "المستشفى الرئيسي — العيادة 1",
        spokenLanguages: ["ar"],
      },
    ]);
    expect(response.body.responseText).toContain("د. خالد العتيبي");
  });

  it("normalizes Arabic diacritics and alef variants without fuzzy doctor guessing", async () => {
    const response = await request(createApp({ db: fixture.db }))
      .post("/api/doctors/search")
      .send({ query: "خَالِد العتيبي", specialty: "امراض القلب", language: "ar" });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.doctors.map((doctor: { doctorId: string }) => doctor.doctorId)).toEqual(["doc-001"]);
  });

  it("asks for clarification when an authored alias matches more than one doctor", async () => {
    const response = await request(createApp({ db: fixture.db }))
      .post("/api/doctors/search")
      .send({ query: "Faisal", language: "en" });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ambiguous");
    expect(response.body.candidates.map((candidate: { doctorId: string }) => candidate.doctorId)).toEqual([
      "doc-003",
      "doc-023",
    ]);
  });

  it("resolves Arabic specialty names and filters by the requested spoken language", async () => {
    const response = await request(createApp({ db: fixture.db }))
      .post("/api/doctors/search")
      .send({ specialty: "طب الأطفال", spokenLanguage: "en", language: "ar" });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.doctors.map((doctor: { doctorId: string }) => doctor.doctorId)).toEqual([
      "doc-008",
      "doc-009",
    ]);
    expect(response.body.doctors[0].specialty).toBe("طب الأطفال");
  });

  it("does not report a truncated result list as the full directory count", async () => {
    const response = await request(createApp({ db: fixture.db }))
      .post("/api/doctors/search")
      .send({ spokenLanguage: "ar", language: "en" });

    expect(response.body.doctors).toHaveLength(10);
    expect(response.body.responseText).toContain("30 matching doctors");
  });

  it("lists database doctors when the caller asks for the directory without a filter", async () => {
    const response = await request(createApp({ db: fixture.db }))
      .post("/api/doctors/search")
      .send({ language: "en" });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.doctors).toHaveLength(10);
    expect(response.body.responseText).toContain("30 doctors in the directory");
    expect(response.body.responseText).toContain("doctor or specialty");
  });

  it("answers a broad Arabic directory request in Arabic and invites narrowing", async () => {
    const response = await request(createApp({ db: fixture.db }))
      .post("/api/doctors/search")
      .send({ language: "ar" });

    expect(response.status).toBe(200);
    expect(response.body.responseText).toContain("30 طبيب");
    expect(response.body.responseText).not.toContain("الدليل");
    expect(response.body.responseText).toContain("تخصص معيّن");
  });

  it("lists every specialty from the database in the requested language", async () => {
    const english = await request(createApp({ db: fixture.db })).post("/api/doctors/specialties").send({ language: "en" });
    const arabic = await request(createApp({ db: fixture.db })).post("/api/doctors/specialties").send({ language: "ar" });

    expect(english.status).toBe(200);
    expect(english.body.specialties).toHaveLength(10);
    expect(english.body.specialties.map((specialty: { name: string }) => specialty.name)).toContain("Cardiology");
    expect(english.body.responseText).toContain("Obstetrics and Gynecology");
    expect(arabic.status).toBe(200);
    expect(arabic.body.specialties).toHaveLength(10);
    expect(arabic.body.specialties.map((specialty: { name: string }) => specialty.name)).toContain("أمراض القلب");
    expect(arabic.body.responseText).toContain("النساء والولادة");
  });

  it("returns no match instead of guessing from an unknown doctor name", async () => {
    const response = await request(createApp({ db: fixture.db }))
      .post("/api/doctors/search")
      .send({ query: "Dr. Not In Directory", language: "en" });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("not_found");
    expect(response.body.doctors).toEqual([]);
  });

  it("rejects arbitrary query fields such as raw SQL", async () => {
    const response = await request(createApp({ db: fixture.db }))
      .post("/api/doctors/search")
      .send({ specialty: "cardiology", language: "en", sql: "DROP TABLE doctors" });

    expect(response.status).toBe(400);
    expect(response.body.status).toBe("invalid_request");
  });
});
