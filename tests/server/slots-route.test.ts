import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app";
import { createTestDatabase } from "../helpers/testDatabase";

describe("doctor details and available-slot routes", () => {
  let fixture: ReturnType<typeof createTestDatabase>;
  beforeEach(() => {
    fixture = createTestDatabase();
  });
  afterEach(() => fixture.dispose());

  it("returns doctor details from the directory with no extra inferred fields", async () => {
    const response = await request(createApp({ db: fixture.db }))
      .post("/api/doctors/details")
      .send({ doctorIdentifier: "د. ريم الدوسري", language: "ar" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "found",
      doctor: {
        doctorId: "doc-004",
        name: "د. ريم الدوسري",
        specialty: "الأمراض الجلدية",
        clinicLocation: "المستشفى الرئيسي — العيادة 1",
        spokenLanguages: ["ar", "en"],
      },
      responseText: "تخصص د. ريم الدوسري هو الأمراض الجلدية، والعيادة في المستشفى الرئيسي — العيادة 1. يتكلم العربية والإنجليزية.",
    });
  });

  it("lists only database-approved available slots for a selected doctor", async () => {
    const response = await request(createApp({ db: fixture.db }))
      .post("/api/slots/search")
      .send({ doctorIdentifier: "doc-001", language: "en" });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.slots).toHaveLength(2);
    expect(response.body.slots.map((slot: { slotId: string }) => slot.slotId)).toEqual([
      "slot-doc-001-1",
      "slot-doc-001-3",
    ]);
    expect(response.body.responseText).toContain("available");
  });

  it("reports a requested day with no available slot and offers stored alternatives", async () => {
    const unavailable = fixture.db
      .prepare("SELECT starts_at_utc AS startsAtUtc FROM slots WHERE id = ?")
      .get("slot-doc-001-2") as { startsAtUtc: string };
    const localDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(
      new Date(unavailable.startsAtUtc),
    );

    const response = await request(createApp({ db: fixture.db }))
      .post("/api/slots/search")
      .send({ doctorIdentifier: "doc-001", requestedDate: localDay, language: "ar" });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("unavailable");
    expect(response.body.slots).toEqual([]);
    expect(response.body.alternatives).toHaveLength(2);
    expect(response.body.responseText).toContain("ما فيه موعد متاح");
  });

  it("rejects a slot request that includes an arbitrary query field", async () => {
    const response = await request(createApp({ db: fixture.db }))
      .post("/api/slots/search")
      .send({ doctorIdentifier: "doc-001", language: "en", sql: "SELECT * FROM slots" });

    expect(response.status).toBe(400);
    expect(response.body.status).toBe("invalid_request");
  });

  it("uses natural Arabic when a doctor cannot be found", async () => {
    for (const path of ["/api/doctors/details", "/api/slots/search"]) {
      const response = await request(createApp({ db: fixture.db })).post(path).send({ doctorIdentifier: "طبيب غير موجود", language: "ar" });
      expect(response.body.status).toBe("not_found");
      expect(response.body.responseText).not.toMatch(/دليل/);
      expect(response.body.responseText).toContain("عندنا");
    }
  });
});
