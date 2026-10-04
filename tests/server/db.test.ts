import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/server/db/connection";

const temporaryDirectories: string[] = [];
const openConnections: Database.Database[] = [];

function createDatabasePath() {
  const directory = mkdtempSync(join(tmpdir(), "health-agent-"));
  temporaryDirectories.push(directory);
  return join(directory, "prototype.sqlite");
}

function openTestDatabase(path: string) {
  const db = openDatabase(path);
  openConnections.push(db);
  return db;
}

function countRows(db: Database.Database, table: string) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
}

afterEach(() => {
  for (const db of openConnections.splice(0)) {
    if (db.open) db.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("persistent prototype database", () => {
  it("creates the synthetic directory and patient seed once", () => {
    const path = createDatabasePath();
    const db = openTestDatabase(path);

    expect(countRows(db, "specialties").count).toBe(10);
    expect(countRows(db, "doctors").count).toBe(30);
    expect(countRows(db, "patients").count).toBeGreaterThanOrEqual(3);
    expect(db.prepare("SELECT patient_id, full_name_en, full_name_ar FROM patients WHERE patient_id = ?").get("123")).toEqual({
      patient_id: "123",
      full_name_en: "Test Patient",
      full_name_ar: "مريض تجريبي",
    });

    db.close();
    const reopened = openTestDatabase(path);
    expect(countRows(reopened, "doctors").count).toBe(30);
    expect(countRows(reopened, "patients").count).toBeGreaterThanOrEqual(3);
    expect(reopened.prepare("SELECT patient_id, full_name_en, full_name_ar FROM patients WHERE patient_id = ?").get("123")).toEqual({
      patient_id: "123",
      full_name_en: "Test Patient",
      full_name_ar: "مريض تجريبي",
    });
    reopened.close();
  });

  it("adds the guest mobile field when opening an existing prototype database", () => {
    const path = createDatabasePath();
    const legacy = new Database(path);
    legacy.exec(`CREATE TABLE patients (
      patient_id TEXT PRIMARY KEY,
      full_name_en TEXT NOT NULL,
      full_name_ar TEXT NOT NULL
    )`);
    legacy.close();

    const migrated = openTestDatabase(path);
    const columns = migrated.pragma("table_info(patients)") as Array<{ name: string }>;
    expect(columns.map(({ name }) => name)).toContain("mobile_number");
    expect(countRows(migrated, "doctors").count).toBe(30);
  });

  it("preserves a changed slot when the server database is reopened", () => {
    const path = createDatabasePath();
    const db = openTestDatabase(path);
    const slot = db.prepare("SELECT id FROM slots WHERE status = 'available' ORDER BY id LIMIT 1").get() as
      | { id: string }
      | undefined;

    expect(slot).toBeDefined();
    db.prepare("UPDATE slots SET status = 'booked' WHERE id = ?").run(slot?.id);
    db.close();

    const reopened = openTestDatabase(path);
    const savedStatus = reopened.prepare("SELECT status FROM slots WHERE id = ?").get(slot?.id) as
      | { status: string }
      | undefined;

    expect(savedStatus?.status).toBe("booked");
    expect(countRows(reopened, "doctors").count).toBe(30);
    reopened.close();
  });

  it("refreshes expired seed slots while preserving booked appointment times", () => {
    const path = createDatabasePath();
    const db = openTestDatabase(path);
    const expiredSlotId = "slot-doc-001-1";
    const bookedSlotId = "slot-doc-001-3";
    const bookedTime = "2000-01-01T14:00:00.000Z";
    db.prepare("UPDATE slots SET starts_at_utc = ? WHERE id = ?").run("2000-01-01T09:00:00.000Z", expiredSlotId);
    db.prepare("UPDATE slots SET starts_at_utc = ?, status = 'booked' WHERE id = ?").run(bookedTime, bookedSlotId);
    db.prepare(
      `INSERT INTO appointments (id, booking_reference, patient_id, doctor_id, slot_id, created_at_utc)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("appointment-kept", "HA-KEEP01", "P-1001", "doc-001", bookedSlotId, "2000-01-01T00:00:00.000Z");
    db.close();

    const reopened = openTestDatabase(path);
    const refreshed = reopened.prepare("SELECT starts_at_utc, status FROM slots WHERE id = ?").get(expiredSlotId) as
      | { starts_at_utc: string; status: string }
      | undefined;
    const booked = reopened.prepare("SELECT starts_at_utc, status FROM slots WHERE id = ?").get(bookedSlotId) as
      | { starts_at_utc: string; status: string }
      | undefined;

    expect(Date.parse(refreshed?.starts_at_utc ?? "")).toBeGreaterThan(Date.now());
    expect(refreshed?.status).toBe("available");
    expect(booked).toEqual({ starts_at_utc: bookedTime, status: "booked" });
    expect(countRows(reopened, "appointments").count).toBe(1);
    reopened.close();
  });

  it("seeds varied doctor language support instead of marking every doctor bilingual", () => {
    const db = openTestDatabase(createDatabasePath());
    const languageOnlyDoctors = db
      .prepare(
        "SELECT COUNT(*) AS count FROM (SELECT doctor_id FROM doctor_languages GROUP BY doctor_id HAVING COUNT(*) = 1)",
      )
      .get() as { count: number };

    expect(languageOnlyDoctors.count).toBeGreaterThan(0);
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM doctor_languages WHERE language_code = 'ar'").get() as { count: number })
        .count,
    ).toBeGreaterThan(0);
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM doctor_languages WHERE language_code = 'en'").get() as { count: number })
        .count,
    ).toBeGreaterThan(0);

    db.close();
  });

  it("enforces foreign keys for database-owned records", () => {
    const db = openTestDatabase(createDatabasePath());

    expect(() => {
      db.prepare("INSERT INTO doctor_languages (doctor_id, language_code) VALUES (?, ?)").run(
        "missing-doctor",
        "ar",
      );
    }).toThrow(/FOREIGN KEY constraint failed/i);

    db.close();
  });
});
