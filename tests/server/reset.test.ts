import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app";
import { resetDemoDatabase } from "../../src/server/services/bookingService";
import { createTestDatabase } from "../helpers/testDatabase";

describe("development database reset", () => {
  let fixture: ReturnType<typeof createTestDatabase>;
  beforeEach(() => {
    fixture = createTestDatabase();
  });
  afterEach(() => fixture.dispose());

  it("removes prototype bookings and restores each slot's original availability", async () => {
    const app = createApp({ db: fixture.db });
    const prepared = await request(app).post("/api/bookings/prepare").send({
      patientId: "P-1001",
      doctorIdentifier: "doc-001",
      slotId: "slot-doc-001-1",
      language: "en",
    });
    await request(app).post("/api/bookings/confirm").send({
      pendingId: prepared.body.pendingId,
      finalTranscript: "yes",
      language: "en",
    });
    fixture.db.prepare("UPDATE slots SET starts_at_utc = ? WHERE id = ?").run("2000-01-01T09:00:00.000Z", "slot-doc-001-1");

    resetDemoDatabase(fixture.db);

    expect((fixture.db.prepare("SELECT COUNT(*) AS count FROM appointments").get() as { count: number }).count).toBe(0);
    expect((fixture.db.prepare("SELECT status FROM slots WHERE id = ?").get("slot-doc-001-1") as { status: string }).status).toBe(
      "available",
    );
    const refreshed = fixture.db.prepare("SELECT starts_at_utc FROM slots WHERE id = ?").get("slot-doc-001-1") as
      | { starts_at_utc: string }
      | undefined;
    expect(Date.parse(refreshed?.starts_at_utc ?? "")).toBeGreaterThan(Date.now());
    expect((fixture.db.prepare("SELECT status FROM slots WHERE id = ?").get("slot-doc-001-2") as { status: string }).status).toBe(
      "unavailable",
    );
  });

  it("also removes synthetic guest profiles when resetting the demo", async () => {
    const app = createApp({ db: fixture.db });
    const prepared = await request(app).post("/api/bookings/prepare-guest").send({
      fullName: "Aisha Example",
      mobileNumber: "0501234567",
      doctorIdentifier: "doc-001",
      slotId: "slot-doc-001-1",
      language: "en",
    });
    await request(app).post("/api/bookings/confirm").send({
      pendingId: prepared.body.pendingId,
      finalTranscript: "Yes, please book it.",
      language: "en",
    });

    resetDemoDatabase(fixture.db);

    expect((fixture.db.prepare("SELECT COUNT(*) AS count FROM patients WHERE mobile_number IS NOT NULL").get() as { count: number }).count).toBe(0);
    expect((fixture.db.prepare("SELECT COUNT(*) AS count FROM appointments").get() as { count: number }).count).toBe(0);
  });
});
