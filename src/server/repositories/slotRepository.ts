import type Database from "better-sqlite3";

export type SlotRecord = {
  id: string;
  doctorId: string;
  startsAtUtc: string;
  status: "available" | "unavailable" | "booked";
};

export function listSlotsForDoctor(db: Database.Database, doctorId: string): SlotRecord[] {
  return db
    .prepare(
      "SELECT id, doctor_id AS doctorId, starts_at_utc AS startsAtUtc, status FROM slots WHERE doctor_id = ? ORDER BY starts_at_utc",
    )
    .all(doctorId) as SlotRecord[];
}

export function findSlotById(db: Database.Database, slotId: string): SlotRecord | undefined {
  return db
    .prepare("SELECT id, doctor_id AS doctorId, starts_at_utc AS startsAtUtc, status FROM slots WHERE id = ?")
    .get(slotId) as SlotRecord | undefined;
}

export function markBookedIfAvailable(db: Database.Database, slotId: string): number {
  return db.prepare("UPDATE slots SET status = 'booked' WHERE id = ? AND status = 'available'").run(slotId).changes;
}
