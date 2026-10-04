import type Database from "better-sqlite3";
import type { DoctorSearchRequest, DoctorSearchResult, DoctorSummary, Language, SpecialtyListRequest, SpecialtyListResult } from "../../shared/contracts";
import { listDoctors, listSpecialties as readSpecialties, type DoctorRecord } from "../repositories/doctorRepository";
import { normalizeAlias, resolveAlias } from "./aliasResolver";

function toSummary(record: DoctorRecord, language: Language): DoctorSummary {
  return {
    doctorId: record.id,
    name: language === "ar" ? record.nameAr : record.nameEn,
    specialty: language === "ar" ? record.specialtyAr : record.specialtyEn,
    clinicLocation: language === "ar" ? record.clinicLocationAr : record.clinicLocationEn,
    spokenLanguages: record.spokenLanguages,
  };
}

function languageNames(languages: Language[], language: Language) {
  const names = languages.map((code) => (language === "ar" ? (code === "ar" ? "العربية" : "الإنجليزية") : code === "ar" ? "Arabic" : "English"));
  if (names.length < 2) return names[0] ?? (language === "ar" ? "غير محددة" : "not listed");
  return language === "ar" ? `${names[0]} و${names[1]}` : `${names[0]} and ${names[1]}`;
}

function notFound(language: Language): DoctorSearchResult {
  return {
    status: "not_found",
    doctors: [],
    responseText:
      language === "ar"
        ? "ما لقيت طبيب يطابق طلبك. تقدر تعطيني الاسم أو التخصص بطريقة ثانية؟"
        : "I couldn't find an exact match in the doctor directory. Could you try the name or specialty another way?",
  };
}

function formatFound(
  doctors: DoctorSummary[],
  language: Language,
  totalMatches: number,
  broadDirectoryRequest = false,
): DoctorSearchResult {
  if (broadDirectoryRequest) {
    const names = doctors.slice(0, 3).map((doctor) => doctor.name);
    const responseText = language === "ar"
      ? `عندنا ${totalMatches} طبيب. منهم ${names.join("، ")}. تبي تخصص معيّن؟`
      : `We have ${totalMatches} doctors in the directory. Here are a few: ${names.join(", ")}. Are you looking for a specific doctor or specialty?`;
    return { status: "ok", doctors, responseText };
  }

  if (totalMatches === 1 && doctors.length === 1) {
    const doctor = doctors[0];
    const responseText =
      language === "ar"
        ? `تخصص ${doctor.name} هو ${doctor.specialty}، والعيادة في ${doctor.clinicLocation}. يتكلم ${languageNames(doctor.spokenLanguages, language)}.`
        : `I found ${doctor.name}, in ${doctor.specialty}, at ${doctor.clinicLocation}. They speak ${languageNames(doctor.spokenLanguages, language)}.`;
    return { status: "ok", doctors, responseText };
  }

  const names = doctors.slice(0, 5).map((doctor) => doctor.name);
  const responseText = totalMatches > doctors.length
    ? language === "ar"
      ? `عندي ${totalMatches} أطباء يطابقون طلبك. هذي بعض الأسماء: ${names.join("، ")}. تبي تحدد الاسم أو التخصص؟`
      : `I found ${totalMatches} matching doctors. Here are some: ${names.join(", ")}. Could you narrow it by name or specialty?`
    : language === "ar"
      ? `لقيت ${totalMatches} أطباء يطابقون طلبك، منهم: ${names.join("، ")}. تبي طبيب معيّن؟`
      : `I found ${totalMatches} matching doctors, including ${names.join(", ")}. Are you looking for a particular name?`;
  return { status: "ok", doctors, responseText };
}

export function getSpecialtyDirectory(db: Database.Database, input: SpecialtyListRequest): SpecialtyListResult {
  const specialties = readSpecialties(db).map((specialty) => ({
    specialtyId: specialty.id,
    name: input.language === "ar" ? specialty.nameAr : specialty.nameEn,
  }));
  const names = specialties.map(({ name }) => name);
  return {
    status: "ok",
    specialties,
    responseText: input.language === "ar"
      ? `التخصصات المتوفرة عندنا: ${names.join("، ")}. فيه تخصص معيّن تدور عليه؟`
      : `The specialties we have are ${names.join(", ")}. Are you looking for a particular one?`,
  };
}

export function searchDoctors(db: Database.Database, input: DoctorSearchRequest): DoctorSearchResult {
  const doctors = listDoctors(db);
  let matches = doctors;

  if (input.query) {
    const queryMatch = resolveAlias(
      input.query,
      doctors.map((doctor) => ({ id: doctor.id, aliases: [doctor.nameEn, doctor.nameAr, ...doctor.aliasesEn, ...doctor.aliasesAr], value: doctor })),
    );
    if (queryMatch.status === "not_found") return notFound(input.language);
    matches = queryMatch.status === "matched" ? [queryMatch.value] : queryMatch.values;
  }

  if (input.specialty) {
    const specialties = readSpecialties(db);
    const specialtyMatch = resolveAlias(
      input.specialty,
      specialties.map((specialty) => ({
        id: specialty.id,
        aliases: [specialty.nameEn, specialty.nameAr, ...specialty.aliasesEn, ...specialty.aliasesAr],
        value: specialty,
      })),
    );
    if (specialtyMatch.status !== "matched") return notFound(input.language);
    matches = matches.filter((doctor) => doctor.specialtyId === specialtyMatch.value.id);
  }

  if (input.spokenLanguage) {
    matches = matches.filter((doctor) => doctor.spokenLanguages.includes(input.spokenLanguage as Language));
  }

  if (input.location) {
    const location = normalizeAlias(input.location);
    matches = matches.filter(
      (doctor) =>
        normalizeAlias(doctor.clinicLocationEn) === location || normalizeAlias(doctor.clinicLocationAr) === location,
    );
  }

  if (matches.length === 0) return notFound(input.language);

  const summaries = matches.slice(0, 10).map((doctor) => toSummary(doctor, input.language));
  if (input.query && summaries.length > 1) {
    const names = summaries.map((doctor) => doctor.name);
    return {
      status: "ambiguous",
      candidates: summaries,
      responseText:
        input.language === "ar"
          ? `الاسم هذا يطابق أكثر من طبيب: ${names.join("، ")}. أي واحد تقصد؟`
          : `The name ${input.query} matches more than one doctor: ${names.join(", ")}. Which one did you mean?`,
    };
  }
  const broadDirectoryRequest = !input.query && !input.specialty && !input.spokenLanguage && !input.location;
  return formatFound(summaries, input.language, matches.length, broadDirectoryRequest);
}
