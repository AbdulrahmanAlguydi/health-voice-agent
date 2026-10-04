import type Database from "better-sqlite3";
import type { Language } from "../../shared/contracts";

export type DoctorRecord = {
  id: string;
  nameEn: string;
  nameAr: string;
  specialtyId: string;
  specialtyEn: string;
  specialtyAr: string;
  clinicLocationEn: string;
  clinicLocationAr: string;
  aliasesEn: string[];
  aliasesAr: string[];
  spokenLanguages: Language[];
};

type DoctorRow = Omit<DoctorRecord, "aliasesEn" | "aliasesAr" | "spokenLanguages">;

export function listDoctors(db: Database.Database): DoctorRecord[] {
  const rows = db
    .prepare(
      `SELECT d.id, d.name_en AS nameEn, d.name_ar AS nameAr, d.specialty_id AS specialtyId,
              s.name_en AS specialtyEn, s.name_ar AS specialtyAr,
              d.clinic_location_en AS clinicLocationEn, d.clinic_location_ar AS clinicLocationAr
       FROM doctors d JOIN specialties s ON s.id = d.specialty_id
       ORDER BY d.id`,
    )
    .all() as DoctorRow[];
  const aliases = db
    .prepare("SELECT doctor_id AS doctorId, language_code AS languageCode, alias FROM doctor_aliases ORDER BY id")
    .all() as Array<{ doctorId: string; languageCode: Language; alias: string }>;
  const languages = db
    .prepare("SELECT doctor_id AS doctorId, language_code AS languageCode FROM doctor_languages ORDER BY language_code")
    .all() as Array<{ doctorId: string; languageCode: Language }>;

  return rows.map((row) => ({
    ...row,
    aliasesEn: aliases.filter((alias) => alias.doctorId === row.id && alias.languageCode === "en").map((a) => a.alias),
    aliasesAr: aliases.filter((alias) => alias.doctorId === row.id && alias.languageCode === "ar").map((a) => a.alias),
    spokenLanguages: languages.filter((language) => language.doctorId === row.id).map((l) => l.languageCode),
  }));
}

export type SpecialtyRecord = {
  id: string;
  nameEn: string;
  nameAr: string;
  aliasesEn: string[];
  aliasesAr: string[];
};

export function listSpecialties(db: Database.Database): SpecialtyRecord[] {
  const rows = db.prepare("SELECT id, name_en AS nameEn, name_ar AS nameAr FROM specialties ORDER BY id").all() as Array<
    Omit<SpecialtyRecord, "aliasesEn" | "aliasesAr">
  >;
  const aliases = db
    .prepare("SELECT specialty_id AS specialtyId, language_code AS languageCode, alias FROM specialty_aliases ORDER BY id")
    .all() as Array<{ specialtyId: string; languageCode: Language; alias: string }>;

  return rows.map((row) => ({
    ...row,
    aliasesEn: aliases.filter((alias) => alias.specialtyId === row.id && alias.languageCode === "en").map((a) => a.alias),
    aliasesAr: aliases.filter((alias) => alias.specialtyId === row.id && alias.languageCode === "ar").map((a) => a.alias),
  }));
}
