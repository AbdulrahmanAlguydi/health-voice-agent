import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { openDatabase } from "../db/connection";
import { listDoctors, listSpecialties } from "../repositories/doctorRepository";

export type ReceptionOptions = { clock?: () => Date };
export function openReceptionDatabase(path: string, _options: ReceptionOptions = {}): Database.Database {
  const filename = path === ":memory:" ? path : resolve(path);
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  try {
    db.pragma("foreign_keys = ON"); db.pragma("busy_timeout = 5000");
    if (filename !== ":memory:") db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS reception_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reception_doctors (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reception_specialties (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reception_services (id TEXT PRIMARY KEY, duration_minutes INTEGER NOT NULL, lead_minutes INTEGER NOT NULL, horizon_days INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reception_sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reception_offers (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES reception_sessions(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reception_operations (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES reception_sessions(id), status TEXT NOT NULL CHECK(status IN ('ready','committed','rejected')), payload TEXT NOT NULL, result TEXT);
      CREATE TABLE IF NOT EXISTS reception_events (session_id TEXT NOT NULL REFERENCES reception_sessions(id), id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT, PRIMARY KEY(session_id,id));
      CREATE TABLE IF NOT EXISTS reception_media (session_id TEXT NOT NULL REFERENCES reception_sessions(id), id TEXT NOT NULL, fingerprint TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(session_id,id));
      CREATE TABLE IF NOT EXISTS reception_capacity (id TEXT PRIMARY KEY, doctor_id TEXT NOT NULL REFERENCES reception_doctors(id), starts_at_utc TEXT NOT NULL, UNIQUE(doctor_id,starts_at_utc));
      CREATE TABLE IF NOT EXISTS reception_subjects (id TEXT PRIMARY KEY, patient_name TEXT NOT NULL, phone TEXT NOT NULL, caller_name TEXT, relationship TEXT);
      CREATE TABLE IF NOT EXISTS reception_appointments (id TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES reception_subjects(id), doctor_id TEXT NOT NULL REFERENCES reception_doctors(id), service_id TEXT NOT NULL REFERENCES reception_services(id), starts_at_utc TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','cancelled')), classification TEXT, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reception_occupancy (slot_id TEXT PRIMARY KEY REFERENCES reception_capacity(id), appointment_id TEXT NOT NULL REFERENCES reception_appointments(id));
      CREATE TABLE IF NOT EXISTS reception_history (id INTEGER PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES reception_appointments(id), action TEXT NOT NULL, created_at_utc TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reception_effects (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES reception_sessions(id), kind TEXT NOT NULL, created_at_utc TEXT NOT NULL, data TEXT NOT NULL);
    `);
    if (!(db.prepare("SELECT key FROM reception_metadata WHERE key='clinic'").get())) {
      // Only copy the compatible fictional catalog; no legacy patients, bookings or slot lifecycle.
      const catalog = openDatabase(":memory:");
      try {
        db.transaction(() => {
          for (const doctor of listDoctors(catalog)) db.prepare("INSERT INTO reception_doctors VALUES (?,?)").run(doctor.id, JSON.stringify(doctor));
          for (const specialty of listSpecialties(catalog)) db.prepare("INSERT INTO reception_specialties VALUES (?,?)").run(specialty.id, JSON.stringify(specialty));
          const metadata = {
            nameAr: "مجمع عافية الطبي", nameEn: "Afiyah Medical Center", synthetic: true, catalogVersion: 1,
            locationAr: "جدة — حي الروضة (عنوان تجريبي)", locationEn: "Jeddah — Al Rawdah (fictional demo address)",
            hours: { from: "09:00", to: "17:00", timeZone: "Asia/Riyadh" }, insurance: { covered: false, note: "Synthetic self-pay demo; insurance coverage is unknown" },
            cancellationPolicy: { lateBelowHours: 24, classification: "late_no_show", simulated: true, financialPenalty: "unknown", feeInformationAvailable: false, classificationIsAdministrativeOnly: true },
            routing: [{ queryAr: "الجلد", queryEn: "skin", specialtyId: "dermatology" }, { queryAr: "الأسنان", queryEn: "teeth", specialtyId: "dentistry" }, { queryAr: "الأطفال", queryEn: "children", specialtyId: "pediatrics" }],
          };
          db.prepare("INSERT INTO reception_metadata VALUES ('clinic',?)").run(JSON.stringify(metadata));
          for (const service of [{ id: "consultation", nameEn: "Consultation", nameAr: "استشارة", duration: 30, priceSar: 150 }, { id: "extended_consultation", nameEn: "Extended consultation", nameAr: "استشارة مطولة", duration: 60, priceSar: 250 }]) {
            db.prepare("INSERT INTO reception_services VALUES (?,?,?,?,?)").run(service.id, service.duration, 60, 30, JSON.stringify({ ...service, synthetic: true }));
          }
        }).immediate();
      } finally { catalog.close(); }
    }
    const clinicRow=db.prepare("SELECT value FROM reception_metadata WHERE key='clinic'").get() as {value:string};
    const clinic=JSON.parse(clinicRow.value);
    if(clinic.cancellationPolicy?.financialPenalty===undefined){
      clinic.cancellationPolicy={...clinic.cancellationPolicy,financialPenalty:'unknown',feeInformationAvailable:false,classificationIsAdministrativeOnly:true};
      db.prepare("UPDATE reception_metadata SET value=? WHERE key='clinic'").run(JSON.stringify(clinic));
    }
    return db;
  } catch (error) { db.close(); throw error; }
}
