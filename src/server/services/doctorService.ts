import type Database from "better-sqlite3";
import type { DoctorDetailsRequest, DoctorDetailsResult, DoctorSummary, Language } from "../../shared/contracts";
import { listDoctors, type DoctorRecord } from "../repositories/doctorRepository";
import { resolveAlias } from "./aliasResolver";

export type DoctorResolution =
  | { status: "not_found" }
  | { status: "matched"; doctor: DoctorRecord }
  | { status: "ambiguous"; doctors: DoctorRecord[] };

export function resolveDoctorIdentifier(db: Database.Database, identifier: string): DoctorResolution {
  const doctors = listDoctors(db);
  const normalizedId = identifier.trim().toLowerCase();
  const byId = doctors.find((doctor) => doctor.id === normalizedId);
  if (byId) return { status: "matched", doctor: byId };

  const match = resolveAlias(
    identifier,
    doctors.map((doctor) => ({
      id: doctor.id,
      aliases: [doctor.nameEn, doctor.nameAr, ...doctor.aliasesEn, ...doctor.aliasesAr],
      value: doctor,
    })),
  );
  if (match.status === "not_found") return match;
  if (match.status === "ambiguous") return { status: "ambiguous", doctors: match.values };
  return { status: "matched", doctor: match.value };
}

export function toDoctorSummary(doctor: DoctorRecord, language: Language): DoctorSummary {
  return {
    doctorId: doctor.id,
    name: language === "ar" ? doctor.nameAr : doctor.nameEn,
    specialty: language === "ar" ? doctor.specialtyAr : doctor.specialtyEn,
    clinicLocation: language === "ar" ? doctor.clinicLocationAr : doctor.clinicLocationEn,
    spokenLanguages: doctor.spokenLanguages,
  };
}

function languageNames(languages: Language[], language: Language) {
  const names = languages.map((code) => (language === "ar" ? (code === "ar" ? "العربية" : "الإنجليزية") : code === "ar" ? "Arabic" : "English"));
  if (names.length < 2) return names[0] ?? (language === "ar" ? "غير محددة" : "not listed");
  return language === "ar" ? `${names[0]} و${names[1]}` : `${names[0]} and ${names[1]}`;
}

function formatDoctorDetails(doctor: DoctorSummary, language: Language) {
  return language === "ar"
    ? `تخصص ${doctor.name} هو ${doctor.specialty}، والعيادة في ${doctor.clinicLocation}. يتكلم ${languageNames(doctor.spokenLanguages, language)}.`
    : `We have ${doctor.name} in ${doctor.specialty} at ${doctor.clinicLocation}. The directory lists ${languageNames(doctor.spokenLanguages, language)}.`;
}

export function getDoctorDetails(db: Database.Database, request: DoctorDetailsRequest): DoctorDetailsResult {
  const result = resolveDoctorIdentifier(db, request.doctorIdentifier);
  if (result.status === "not_found") {
    return {
      status: "not_found",
      responseText:
        request.language === "ar"
          ? "ما لقيت هالاسم عندنا. تقدر تعطيني الاسم كامل أو التخصص؟"
          : "I couldn't find that name in the doctor directory. Could you give me the full name or specialty?",
    };
  }

  if (result.status === "ambiguous") {
    const candidates = result.doctors.map((doctor) => toDoctorSummary(doctor, request.language));
    const names = candidates.map((candidate) => candidate.name);
    return {
      status: "ambiguous",
      candidates,
      responseText:
        request.language === "ar"
          ? `الاسم هذا يطابق أكثر من طبيب: ${names.join("، ")}. أي واحد تقصد؟`
          : `That name matches more than one doctor: ${names.join(", ")}. Which one did you mean?`,
    };
  }

  const doctor = toDoctorSummary(result.doctor, request.language);
  return { status: "found", doctor, responseText: formatDoctorDetails(doctor, request.language) };
}
