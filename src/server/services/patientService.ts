import type Database from "better-sqlite3";
import type { Language, PatientLookupResult } from "../../shared/contracts";
import { findPatientById } from "../repositories/patientRepository";

export function lookupPatient(db: Database.Database, patientId: string, language: Language): PatientLookupResult {
  const patient = findPatientById(db, patientId);
  if (!patient) {
    return {
      status: "not_found",
      responseText:
        language === "ar"
          ? "ما لقيت ملف بهالرقم. إذا عندك رقم ثاني عطيني إياه، أو نكمل كضيف."
          : "I couldn't find that ID. Give me another one if you have it, or we can continue as a guest.",
    };
  }

  const fullName = language === "ar" ? patient.fullNameAr : patient.fullNameEn;
  return {
    status: "found",
    patient: { patientId: patient.patientId, fullName },
    responseText:
      language === "ar"
          ? `لقيت ملف باسم ${fullName}. هذا ملفك؟`
        : `I found a profile for ${fullName}. Is that you?`,
  };
}
