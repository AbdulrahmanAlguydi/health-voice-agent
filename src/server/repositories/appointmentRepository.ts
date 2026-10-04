import type Database from "better-sqlite3";

export type AppointmentInsert = {
  id: string;
  bookingReference: string;
  patientId: string;
  doctorId: string;
  slotId: string;
  createdAtUtc: string;
};

export type AppointmentRecord = AppointmentInsert;

export function insertAppointment(db: Database.Database, appointment: AppointmentInsert): AppointmentRecord {
  db.prepare(
    `INSERT INTO appointments (id, booking_reference, patient_id, doctor_id, slot_id, created_at_utc)
     VALUES (@id, @bookingReference, @patientId, @doctorId, @slotId, @createdAtUtc)`,
  ).run(appointment);
  return appointment;
}

export function bookingReferenceExists(db: Database.Database, bookingReference: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM appointments WHERE booking_reference = ?").get(bookingReference));
}
