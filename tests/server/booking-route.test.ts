import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app";
import { openDatabase } from "../../src/server/db/connection";
import { createTestDatabase } from "../helpers/testDatabase";

describe("persistent appointment booking routes", () => {
  let fixture: ReturnType<typeof createTestDatabase>;
  beforeEach(() => {
    fixture = createTestDatabase();
  });
  afterEach(() => fixture.dispose());

  it("prepares an exact booking read-back without writing an appointment", async () => {
    const app = createApp({ db: fixture.db });
    const response = await request(app).post("/api/bookings/prepare").send({
      patientId: "P-1001",
      doctorIdentifier: "doc-001",
      slotId: "slot-doc-001-1",
      language: "en",
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("pending");
    expect(response.body.pendingId).toBeTruthy();
    expect(response.body.responseText).toContain("Dr. Khalid Al-Otaibi");
    expect((fixture.db.prepare("SELECT COUNT(*) AS count FROM appointments").get() as { count: number }).count).toBe(0);
    expect((fixture.db.prepare("SELECT status FROM slots WHERE id = ?").get("slot-doc-001-1") as { status: string }).status).toBe(
      "available",
    );
  });

  it("accepts a guest booking but writes the profile and appointment only after final confirmation", async () => {
    const app = createApp({ db: fixture.db });
    const prepared = await request(app).post("/api/bookings/prepare-guest").send({
      fullName: "ليان السالم",
      mobileNumber: "+966 50 123 4567",
      doctorIdentifier: "doc-001",
      slotId: "slot-doc-001-1",
      language: "ar",
    });

    expect(prepared.status).toBe(200);
    expect(prepared.body.status).toBe("pending");
    expect(prepared.body.responseText).toContain("ليان السالم");
    expect(prepared.body.responseText).toContain("+966501234567");
    expect((fixture.db.prepare("SELECT COUNT(*) AS count FROM patients").get() as { count: number }).count).toBe(4);

    const confirmed = await request(app).post("/api/bookings/confirm").send({
      pendingId: prepared.body.pendingId,
      finalTranscript: "إيه، أكيد", decision: "approve",
      language: "ar",
    });

    expect(confirmed.body.status).toBe("confirmed");
    expect(confirmed.body.appointment.patientId).toMatch(/^G-[A-F0-9]+$/);
    expect((fixture.db.prepare("SELECT mobile_number FROM patients WHERE patient_id = ?").get(confirmed.body.appointment.patientId) as { mobile_number: string }).mobile_number).toBe("+966501234567");
    expect((fixture.db.prepare("SELECT COUNT(*) AS count FROM appointments").get() as { count: number }).count).toBe(1);
  });

  it("rejects invalid guest contact details without creating profile data", async () => {
    const response = await request(createApp({ db: fixture.db })).post("/api/bookings/prepare-guest").send({
      fullName: "Aisha Example",
      mobileNumber: "call me",
      doctorIdentifier: "doc-001",
      slotId: "slot-doc-001-1",
      language: "en",
    });

    expect(response.status).toBe(400);
    expect((fixture.db.prepare("SELECT COUNT(*) AS count FROM patients").get() as { count: number }).count).toBe(4);
    expect((fixture.db.prepare("SELECT COUNT(*) AS count FROM appointments").get() as { count: number }).count).toBe(0);
  });

  it("can complete a booking for the seeded short numeric patient ID", async () => {
    const app = createApp({ db: fixture.db });
    const prepared = await request(app).post("/api/bookings/prepare").send({
      patientId: "123",
      doctorIdentifier: "doc-001",
      slotId: "slot-doc-001-1",
      language: "en",
    });

    expect(prepared.status).toBe(200);
    expect(prepared.body.status).toBe("pending");
    expect(prepared.body.responseText).toContain("Dr. Khalid Al-Otaibi");

    const confirmed = await request(app).post("/api/bookings/confirm").send({
      pendingId: prepared.body.pendingId,
      finalTranscript: "Yes, please.", decision: "approve",
      language: "en",
    });

    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe("confirmed");
    expect(fixture.db.prepare("SELECT patient_id FROM appointments WHERE patient_id = ?").get("123")).toEqual({
      patient_id: "123",
    });
  });

  it("commits one appointment only after an unambiguous current-turn affirmative", async () => {
    const app = createApp({ db: fixture.db });
    const prepared = await request(app).post("/api/bookings/prepare").send({
      patientId: "P-1001",
      doctorIdentifier: "doc-001",
      slotId: "slot-doc-001-1",
      language: "en",
    });

    const rejected = await request(app).post("/api/bookings/confirm").send({
      pendingId: prepared.body.pendingId,
      finalTranscript: "yes, but make it later", decision: "change",
      language: "en",
    });
    expect(rejected.body.status).toBe("not_confirmed");
    expect((fixture.db.prepare("SELECT COUNT(*) AS count FROM appointments").get() as { count: number }).count).toBe(0);

    const preparedAgain = await request(app).post("/api/bookings/prepare").send({
      patientId: "P-1001",
      doctorIdentifier: "doc-001",
      slotId: "slot-doc-001-1",
      language: "en",
    });
    const confirmed = await request(app).post("/api/bookings/confirm").send({
      pendingId: preparedAgain.body.pendingId,
      finalTranscript: "Yes, please.", decision: "approve",
      language: "en",
    });

    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe("confirmed");
    expect(confirmed.body.appointment.bookingReference).toMatch(/^HA-[A-Z0-9]{6}$/);
    expect((fixture.db.prepare("SELECT status FROM slots WHERE id = ?").get("slot-doc-001-1") as { status: string }).status).toBe(
      "booked",
    );
    expect((fixture.db.prepare("SELECT COUNT(*) AS count FROM appointments").get() as { count: number }).count).toBe(1);
  });

  it("accepts an explicit Saudi Arabic affirmation for the exact read-back", async () => {
    const app = createApp({ db: fixture.db });
    const prepared = await request(app).post("/api/bookings/prepare").send({
      patientId: "P-1001",
      doctorIdentifier: "doc-001",
      slotId: "slot-doc-001-3",
      language: "ar",
    });
    const confirmed = await request(app).post("/api/bookings/confirm").send({
      pendingId: prepared.body.pendingId,
      finalTranscript: "إيه، أكيد", decision: "approve",
      language: "ar",
    });

    expect(confirmed.body.status).toBe("confirmed");
  });

  it("accepts a complete English confirmation phrase with punctuation", async () => {
    const app = createApp({ db: fixture.db });
    const prepared = await request(app).post("/api/bookings/prepare").send({
      patientId: "P-1001",
      doctorIdentifier: "doc-001",
      slotId: "slot-doc-001-3",
      language: "en",
    });
    const confirmed = await request(app).post("/api/bookings/confirm").send({
      pendingId: prepared.body.pendingId,
      finalTranscript: "That's correct!", decision: "approve",
      language: "en",
    });

    expect(confirmed.body.status).toBe("confirmed");
  });

  it("preserves both the appointment and booked slot after the server database is reopened", async () => {
    const app = createApp({ db: fixture.db });
    const prepared = await request(app).post("/api/bookings/prepare").send({
      patientId: "P-1001",
      doctorIdentifier: "doc-001",
      slotId: "slot-doc-001-1",
      language: "en",
    });
    await request(app).post("/api/bookings/confirm").send({
      pendingId: prepared.body.pendingId,
      finalTranscript: "yes", decision: "approve",
      language: "en",
    });
    fixture.db.close();

    const reopened = openDatabase(fixture.path);
    expect((reopened.prepare("SELECT COUNT(*) AS count FROM appointments").get() as { count: number }).count).toBe(1);
    expect((reopened.prepare("SELECT status FROM slots WHERE id = ?").get("slot-doc-001-1") as { status: string }).status).toBe(
      "booked",
    );
    reopened.close();
  });

  it("does not accept a model-generated confirmation boolean or extra request fields", async () => {
    const app = createApp({ db: fixture.db });
    const response = await request(app).post("/api/bookings/confirm").send({
      pendingId: "anything",
      confirmed: true,
      language: "en",
    });

    expect(response.status).toBe(400);
    expect(response.body.status).toBe("invalid_request");
  });

  it("rechecks availability so two pending confirmations cannot book the same slot", async () => {
    const app = createApp({ db: fixture.db });
    const prepare = () =>
      request(app).post("/api/bookings/prepare").send({
        patientId: "P-1001",
        doctorIdentifier: "doc-001",
        slotId: "slot-doc-001-1",
        language: "en",
      });
    const [first, second] = await Promise.all([prepare(), prepare()]);

    const firstConfirmation = await request(app).post("/api/bookings/confirm").send({
      pendingId: first.body.pendingId,
      finalTranscript: "yes", decision: "approve",
      language: "en",
    });
    const secondConfirmation = await request(app).post("/api/bookings/confirm").send({
      pendingId: second.body.pendingId,
      finalTranscript: "yes", decision: "approve",
      language: "en",
    });

    expect(firstConfirmation.body.status).toBe("confirmed");
    expect(secondConfirmation.body.status).toBe("slot_unavailable");
    expect((fixture.db.prepare("SELECT COUNT(*) AS count FROM appointments").get() as { count: number }).count).toBe(1);
  });
});
