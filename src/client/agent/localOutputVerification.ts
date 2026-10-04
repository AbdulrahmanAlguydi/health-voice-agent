import type { OutputVerifier } from "../../shared/outputVerification";
import { canonicalizeSpeech } from "./speechPolicy";
import { containsConcreteOutput } from "./outputVerificationPolicy";

/** Factual spot checks, not a semantic safety classifier. No network dependency. */
export const verifyOutputLocally: OutputVerifier = async (input, signal) => {
  signal?.throwIfAborted();
  const normalize = (value: string) => {
    // Normalize clock notation before punctuation is removed. Whole hours may
    // omit :00; 17:00 and 5 PM denote the same time, not different availability.
    const digits = value.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
    const clocks = digits.replace(/\b(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/gi, (match, hour: string, minute: string, period?: string) => {
      const numericHour = Number(hour);
      if (numericHour > 23 || Number(minute) > 59) return match;
      if (input.language === "ar") return minute === "00" ? hour : match;
      const suffix = period?.toLowerCase() ?? (numericHour >= 12 ? "pm" : "am");
      return `${numericHour % 12 || 12}${minute === "00" ? "" : `:${minute}`} ${suffix}`;
    });
    const normalized = canonicalizeSpeech(clocks, input.language);
    const durationNumbers: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
    return normalized.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) (?=days?\b|weeks?\b|months?\b)/g, (_, number: string) => `${durationNumbers[number]} `);
  };
  const has = (text: string, value: string) => ` ${text} `.includes(` ${value} `) || ` ${text} `.includes(` و${value} `);
  let spoken = normalize(input.transcript);
  let source = normalize(input.expectedText ?? input.evidence?.sourceText ?? "");
  const evidence = input.evidence;
  const deny = () => ({ approved: false, conversational: false, reason: "changed_details" as const });
  if (!spoken) return deny();
  if (evidence?.receptionIntent) {
    // Intake corrections are not doctor-directory answers. The authorized
    // conversation stage, not a stale list of doctor names, grounds the repair.
    // This does not authorize booking, identity verification or medical claims.
    if (/(?:حجزت|تم الحجز|تاكد الحجز|booked|confirmed|prescrib|تشخيص|علاج)/i.test(spoken)) return deny();
    return { approved: true, conversational: false, reason: "supported" };
  }
  if (!evidence && !input.expectedText && containsConcreteOutput(input.transcript)) return deny();

  // Whole supplied labels keep day/time associations intact. Do not infer a
  // Hijri conversion or silently round a relative duration in the browser.
  for (const [index, date] of (evidence?.appointmentDates ?? []).entries()) {
    // An initial consent question may simply say "this time". Final readbacks
    // still require the date. If a date/time is spoken here, check its value.
    if (evidence?.optionalAppointmentDates && !/\d|بكرة|غدا|tomorrow|today|السبت|الاحد|الاثنين|الثلاثاء|الاربعاء|الخميس|الجمعة/i.test(spoken)) continue;
    const dateForms: string[] = [];
    if (input.language === "en") {
      const parsed = /^(\w+),?\s+(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+(\d{4}))?\s+at\s+(.+)$/i.exec(date.gregorian);
      if (parsed) {
        const [, weekday, day, month, year, clock] = parsed;
        const numericDay = Number(day);
        const ordinal = numericDay % 100 >= 11 && numericDay % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[numericDay % 10] ?? "th";
        for (const suffix of ["", ordinal]) dateForms.push(`${weekday}, ${month} ${day}${suffix}${year ? `, ${year}` : ""} at ${clock}`);
      }
    }
    const alternatives = [date.gregorian, date.hijri, ...dateForms, ...(evidence?.allowRelativeDates ? [date.relative ?? ""] : [])]
      .filter(Boolean).map(normalize);
    if (!alternatives.some((value) => has(spoken, value))) return deny();
    for (const value of alternatives.sort((a, b) => b.length - a.length)) {
      spoken = spoken.replaceAll(value, `datealias${String.fromCharCode(97 + index)}`);
      source = source.replaceAll(value, `datealias${String.fromCharCode(97 + index)}`);
    }
  }

  const names = (evidence?.records ?? []).map((record) => normalize(record.name ?? "").replace(/^doctor /, "")).filter(Boolean);
  const nameAliases = names.map((name) => {
    const first = name.split(" ")[0];
    // A short name is usable only if it identifies one returned doctor.
    return names.filter((other) => other.split(" ")[0] === first).length === 1 ? [name, first] : [name];
  });
  const nameContinuations = new Set([
    "is", "has", "speaks", "specialises", "specializes", "works", "at", "in", "and", "for", "on", "with", "the",
    "هي", "هو", "تخصصها", "تخصصه", "عندها", "عنده", "مواعيدها", "مواعيده", "موعدها", "موعده", "في", "يوم", "بعد", "بكرة", "غدا", "متاحة", "متاح", "تتكلم", "يتكلم", "و", "عندنا",
  ]);
  // A title followed by a name must identify one of the returned doctors.
  // Untitled, unknown names and qualitative claims are an accepted limitation.
  if (names.length) {
    for (const match of spoken.matchAll(/(?:^| )doctor ([\p{L} ]+)/gu)) {
      const following = match[1].trim();
      if (!nameAliases.some((aliases) => aliases.some((name, index) => {
        if (following === name) return true;
        if (!following.startsWith(`${name} `)) return false;
        // A short name followed by an unknown surname must not become a match.
        return index === 0 || nameContinuations.has(following.slice(name.length).trim().split(" ")[0]);
      }))) return deny();
    }
    if (!nameAliases.flat().some((name) => has(spoken, name))) return deny();
    const mentioned = (evidence?.records ?? []).filter((_, index) => nameAliases[index]?.some((name) => has(spoken, name)));
    if (mentioned.length === 1) {
      for (const field of ["specialty", "clinicLocation"] as const) {
        for (const record of evidence?.records ?? []) {
          const value = record[field];
          if (value && has(spoken, normalize(value)) && value !== mentioned[0][field]) return deny();
        }
      }
    }
  }

  // Protected patient/guest and doctor names are extracted only from app copy,
  // never inferred from the model's reply. Wording around them remains free.
  const expected = input.expectedText ?? "";
  const protectedPatterns = [
    /ملف باسم ([^.؟]+)[.؟]/u, /profile for ([^.?!]+)[.?!]/i,
    /والاسم ([^،]+)،/u, /Just to confirm: ([^,]+),/i,
    /مع ((?:د\.\s*)?[^،.]+?) يوم /u, /with (.+?) is /i, /I have (.+?) available at /i,
  ];
  for (const pattern of protectedPatterns) {
    const value = pattern.exec(expected)?.[1];
    if (value && !has(spoken, normalize(value))) return deny();
  }
  // Normalize code-provided aliases before checking residual digits (counts,
  // mobile numbers, IDs and booking references). No extra digits are allowed.
  const availableNumbers: string[] = [...(source.match(/\d+/g) ?? [])];
  for (const number of spoken.match(/\d+/g) ?? []) {
    const index = availableNumbers.indexOf(number);
    if (index < 0) return deny();
    availableNumbers.splice(index, 1);
  }
  const directoryOnly = Boolean(evidence?.records?.length) && !evidence?.appointmentDates?.length;
  if (input.expectedText && !directoryOnly && availableNumbers.length) return deny();
  const reference = /(?:رقم الحجز|(?:booking )?reference)(?: is)?\s*:\s*([^\s.]+)/i.exec(expected)?.[1];
  if (reference && !has(spoken, normalize(reference))) return deny();
  if (evidence && !evidence.appointmentDates?.length && !names.length) {
    const phrases = evidence.groundedPhrases ?? evidence.requiredPhrases;
    if (phrases.length && !phrases.some((phrase) => has(spoken, normalize(phrase)))) return deny();
  }
  // Keep negative availability / lookup results and completed booking status
  // distinct. This intentionally does not attempt general claim verification.
  const negative = /(?:ما لقيت|ما فيه|غير متاح|مو متاح|couldn.t find|not available|unavailable|nothing was booked)/i;
  const success = /(?:حجزت لك|تم الحجز|is booked|has been booked|successfully booked)/i;
  if (negative.test(expected) && success.test(input.transcript)) return deny();
  if (success.test(expected) && !success.test(input.transcript)) return deny();
  return { approved: true, conversational: !evidence && !input.expectedText, reason: "supported" };
};
