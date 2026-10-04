import type Database from "better-sqlite3";

export type PatientRecord = {
  patientId: string;
  fullNameEn: string;
  fullNameAr: string;
};

export function findPatientById(db: Database.Database, patientId: string): PatientRecord | undefined {
  return db
    .prepare(
      "SELECT patient_id AS patientId, full_name_en AS fullNameEn, full_name_ar AS fullNameAr FROM patients WHERE patient_id = ?",
    )
    .get(patientId) as PatientRecord | undefined;
}

export function insertGuestPatient(
  db: Database.Database,
  patient: { patientId: string; fullName: string; mobileNumber: string },
) {
  db.prepare(
    "INSERT INTO patients (patient_id, full_name_en, full_name_ar, mobile_number) VALUES (?, ?, ?, ?)",
  ).run(patient.patientId, patient.fullName, patient.fullName, patient.mobileNumber);
}
