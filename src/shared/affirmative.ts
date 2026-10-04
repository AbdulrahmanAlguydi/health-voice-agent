import { normalizeTextForMatching } from "./textNormalization";

const affirmativePhrases = new Set(
  [
    "yes",
    "yes please",
    "yes please book it",
    "yeah",
    "yep",
    "sure",
    "correct",
    "that's correct",
    "thats correct",
    "okay",
    "ok",
    "that works",
    "sounds good",
    "that's fine",
    "thats fine",
    "works for me",
    "perfect",
    "absolutely",
    "of course",
    "طيب",
    "خلاص",
    "حاضر",
    "ماشي",
    "please book it",
    "book it",
    "confirm",
    "نعم",
    "ايه",
    "ايه اكيد",
    "ايه احجزه",
    "ايوه",
    "ايوه اكيد",
    "ايوه احجزه",
    "اكيد",
    "تمام احجزه",
    "ابشر",
    "تمام",
    "موافق",
    "موافقة",
  ].map(normalizeTextForMatching),
);

const confirmationFillers = new Set([
  "اي", "ايه", "ايوه", "نعم", "صحيح", "صح", "yes",
  "and", "a", "an", "the", "this", "that", "it", "appointment", "booking", "slot", "time", "please", "now", "for", "me",
  "to", "i", "want", "you", "accept", "fine", "okay", "ok", "proceed", "confirm", "book", "الحجز", "للحجز", "الموعد", "هالموعد", "هذا", "لي", "هنا", "موعد", "احجز", "احجزي",
  "احجزه", "احجزيه", "اكد", "اكد", "اكدها", "اكدي", "اكده", "تمام", "ممتاز", "ابشر", "ابشري", "توكل", "توكلنا",
  "s", "works", "sounds", "good", "great", "perfect", "right", "absolutely", "definitely", "certainly", "go", "ahead", "do", "yeah", "yep", "sure",
].map(normalizeTextForMatching));

const confirmationStarts = [
  "yes", "yeah", "yep", "sure", "correct", "go ahead", "please", "book", "confirm", "do it", "i accept", "i want to book",
  "okay", "ok", "that works", "sounds good", "that's fine", "thats fine", "works for me", "perfect", "absolutely", "of course",
  "نعم", "اي", "ايه", "ايوه", "اكيد", "تمام", "موافق", "موافقه", "ابشر", "ابشري", "ممتاز", "ماشي", "طيب", "خلاص", "حاضر", "احجز", "احجزي", "اكد", "اكدي", "توكل",
].map(normalizeTextForMatching);

const confirmationBlockers = new Set([
  "but", "however", "if", "maybe", "perhaps", "think", "later", "change", "different", "instead", "except", "unless", "wait", "cancel", "stop", "not", "no",
  "بس", "لكن", "اذا", "لو", "يمكن", "احتمال", "بعد", "غير", "بدل", "انتظر", "الغ", "الغي", "لا", "مو", "خلني", "فكر", "افكر",
].map(normalizeTextForMatching));

export function isUnambiguousAffirmative(transcript: string): boolean {
  const normalized = normalizeTextForMatching(transcript);
  if (!normalized) return false;
  if (affirmativePhrases.has(normalized)) return true;

  const words = normalized.split(" ");
  if (words.some((word) => confirmationBlockers.has(word))) return false;
  const start = confirmationStarts.find((phrase) => normalized === phrase || normalized.startsWith(`${phrase} `));
  if (!start) return false;
  const remainder = normalized.slice(start.length).trim();
  return !remainder || remainder.split(" ").every((word) => confirmationFillers.has(word));
}

export function isUnambiguousGuestSlotConsent(transcript: string): boolean {
  const normalized = normalizeTextForMatching(transcript);
  if (isUnambiguousAffirmative(transcript)) return true;
  if (!normalized || normalized.split(" ").some((word) => confirmationBlockers.has(word))) return false;

  // Acceptance of the offered slot is not the final permission to write a
  // booking. These bounded phrases contain no new doctor/day/time details.
  const offeredTimeAcceptance = [
    "that time works for me", "this time works for me", "that appointment works for me",
    "يناسبني هذا الموعد", "هذا الموعد يناسبني", "هذا الوقت يناسبني", "يناسبني هذا الوقت",
  ].map(normalizeTextForMatching);
  const assent = /^(?:yes|yeah|sure|okay|ok|نعم|ايه|ايوه|تمام|اكيد) /;
  if (offeredTimeAcceptance.includes(normalized.replace(assent, ""))) return true;

  const clearYes = ["yes", "yeah", "yep", "sure", "go ahead", "نعم", "ايه", "ايوه", "اكيد", "تمام", "موافق", "موافقه", "ابشر"]
    .concat(["okay", "ok", "absolutely", "of course", "that works", "sounds good", "that's fine", "works for me", "perfect", "ماشي", "ممتاز", "طيب", "خلاص"])
    .map(normalizeTextForMatching)
    .some((phrase) => normalized === phrase || normalized.startsWith(`${phrase} `));
  const guestDetails = [
    "my name is", "my full name is", "my number is", "my mobile number is", "my phone number is", "name is", "number is",
    "my phone is", "my mobile is", "my number's", "here is my number", "here's my number", "you can reach me at", "reach me at",
    "i am", "i'm", "this is", "اسمي", "اسمي الكامل", "رقمي", "رقم جوالي", "رقم هاتفي", "انا", "هذا رقمي", "وهذا رقمي",
  ].some((phrase) => normalized.includes(normalizeTextForMatching(phrase)));
  return clearYes && guestDetails;
}

function identityDenialMarkers(personName?: string): string[] {
  const markers = [
    "no", "not me", "not mine", "wrong person", "wrong patient", "wrong profile",
    "not the person", "not the patient", "not this profile", "not the profile",
    "not my profile", "not my record", "not my account", "i m not", "i am not",
    "isn t me", "is not me", "isn t mine", "is not mine", "belongs to someone else",
    "belongs to somebody else", "i don t recognize", "doesn t belong to me",
    "لا", "مو انا", "ماني انا", "ليس انا", "لست انا", "غلط", "مو ملفي", "مو حسابي",
    "هذا مو ملفي", "هذا الملف مو لي", "الملف مو لي", "الاسم مو اسمي", "الاسم غلط",
    "اسمي مو", "ماني صاحب الملف", "مو صاحب الملف", "ماني صاحبة الملف", "مو صاحبة الملف",
    "ما يخصني",
  ];
  const normalizedName = personName ? normalizeTextForMatching(personName) : "";
  if (normalizedName) {
    const nameTokens = normalizedName.split(" ");
    markers.push(
      `not ${normalizedName}`,
      `wrong ${normalizedName}`,
      `مو ${normalizedName}`,
      `ماني ${normalizedName}`,
      `لست ${normalizedName}`,
      `ليس ${normalizedName}`,
    );
    for (const token of normalizedName.split(" ").filter((part) => part.length > 2)) {
      markers.push(
        `not ${token}`,
        `wrong ${token}`,
        `مو ${token}`,
        `ماني ${token}`,
        `لست ${token}`,
        `ليس ${token}`,
      );
    }
    // A denial may name only a compound surname, such as "not Al-Salem".
    for (let start = 0; start < nameTokens.length; start += 1) {
      for (let end = start + 1; end <= nameTokens.length; end += 1) {
        const namePart = nameTokens.slice(start, end).join(" ");
        if (namePart.length <= 2) continue;
        markers.push(
          `not ${namePart}`, `wrong ${namePart}`, `مو ${namePart}`, `ماني ${namePart}`,
          `لست ${namePart}`, `ليس ${namePart}`,
        );
      }
    }
  }
  return markers.map(normalizeTextForMatching);
}

function hasIdentityDenial(normalized: string, personName?: string): boolean {
  const padded = ` ${normalized} `;
  return identityDenialMarkers(personName).some((marker) => padded.includes(` ${marker} `));
}

const relationshipTerms = new Set([
  "mother", "mom", "father", "dad", "son", "daughter", "wife", "husband", "spouse",
  "sister", "brother", "parent", "grandmother", "grandfather", "aunt", "uncle", "cousin",
  "guardian", "child", "relative", "امي", "ابوي", "والدي", "والدة", "بنت", "ابن", "ولد",
  "اخت", "اخو", "زوج", "زوجة", "جدة", "جد", "عمة", "خالة", "عم", "خال", "قريب", "قريبة",
  "ولي", "وصي",
].map(normalizeTextForMatching));

function refersToANameRelation(normalized: string, matchedPrefix: string): boolean {
  const remaining = normalized.slice(matchedPrefix.length).trim();
  const tokens = remaining.split(" ");
  return tokens[0] === "s" || tokens.some((token) => relationshipTerms.has(token));
}

const nonNameIdentityDescriptors = new Set([
  "a", "an", "the", "my", "your", "our", "not", "patient", "person", "caller", "profile", "account", "owner",
  "ready", "sure", "happy", "fine", "okay", "ok", "here", "there", "calling", "speaking", "looking", "interested",
  "trying", "going", "booking", "hoping", "available", "from", "at", "just", "also", "still", "really", "currently",
  "ابغي", "ابغى", "ابي", "ابا", "بغيت", "حاب", "حابه", "اريد", "أريد", "هنا", "من", "المريض", "المريضة",
].map(normalizeTextForMatching));

function hasConflictingSelfName(normalized: string, personName?: string): boolean {
  const normalizedName = personName ? normalizeTextForMatching(personName) : "";
  if (!normalizedName) return false;
  const knownNameTokens = normalizedName.split(" ");
  const knownNameTokenSet = new Set(knownNameTokens);
  const words = normalized.split(" ");
  const nameIntroductionPrefixes = [
    ["my", "name", "is"],
    ["my", "name", "s"], // Normalized form of "my name's …"
    ["اسمي"],
  ];
  const selfIdentificationPrefixes = [
    ["i", "am"],
    ["i", "m"], // Normalized form of "I'm …"
    ["this", "is"],
    ["انا"],
  ];
  const surnameIntroductionPrefixes = [
    ["my", "last", "name", "is"],
    ["my", "surname", "is"],
    ["last", "name", "is"],
    ["surname", "is"],
    ["my", "family", "name", "is"],
    ["family", "name", "is"],
    ["اسم", "العائلة"],
    ["اسم", "العايلة"],
    ["اسم", "عائلتي"],
    ["لقبي"],
  ];
  const nameClauseContinuations = new Set([
    "and", "but", "because", "i", "im", "want", "would", "will", "can", "could", "please",
    "now", "today", "here", "for", "to", "looking", "calling", "booking", "need", "help",
    "that", "s", "is", "correct", "right", "yes", "sure", "okay", "ok", "this", "profile", "account",
    "appointment", "و", "ابي", "ابغى", "ابغي", "بغيت", "اريد", "أريد", "ابا", "حاب", "حابه",
    "وابي", "وابغى", "وابغي", "وبغيت", "واريد", "وابا", "وحاب", "وحابه", "وموعد", "واحجز",
    "لكن", "ولكن", "بس",
  ].map(normalizeTextForMatching));

  const nameSequenceMatches = (candidateTokens: string[]) => {
    if (candidateTokens.length === 1) return candidateTokens[0] === knownNameTokens[0];
    return knownNameTokens.some((_, start) =>
      candidateTokens.every((token, offset) => knownNameTokens[start + offset] === token),
    );
  };
  const hasConflictingNameAfter = (start: number) => {
    const first = words[start];
    if (!first || nonNameIdentityDescriptors.has(first) || relationshipTerms.has(first) || /^\p{N}+$/u.test(first)) {
      return false;
    }
    const candidateTokens: string[] = [];
    for (const token of words.slice(start)) {
      if (nameClauseContinuations.has(token) || nonNameIdentityDescriptors.has(token) || relationshipTerms.has(token) || /^\p{N}+$/u.test(token)) {
        break;
      }
      candidateTokens.push(token);
      if (!knownNameTokenSet.has(token)) return true;
    }
    return candidateTokens.length > 0 && !nameSequenceMatches(candidateTokens);
  };
  const hasConflictingSurnameAfter = (start: number) => {
    const surnameTokens = knownNameTokens.slice(1);
    const candidateTokens: string[] = [];
    for (const token of words.slice(start)) {
      if (nameClauseContinuations.has(token) || nonNameIdentityDescriptors.has(token) || relationshipTerms.has(token) || /^\p{N}+$/u.test(token)) {
        break;
      }
      candidateTokens.push(token);
      if (!surnameTokens.includes(token)) return true;
    }
    return candidateTokens.length === 0 || candidateTokens.join(" ") !== surnameTokens.join(" ");
  };

  for (let index = 0; index < words.length; index += 1) {
    for (const prefix of nameIntroductionPrefixes) {
      if (!prefix.every((word, offset) => words[index + offset] === word)) continue;
      if (hasConflictingNameAfter(index + prefix.length)) return true;
    }

    for (const prefix of selfIdentificationPrefixes) {
      if (!prefix.every((word, offset) => words[index + offset] === word)) continue;
      if (hasConflictingNameAfter(index + prefix.length)) return true;
    }

    for (const prefix of surnameIntroductionPrefixes) {
      if (!prefix.every((word, offset) => words[index + offset] === word)) continue;
      if (hasConflictingSurnameAfter(index + prefix.length)) return true;
    }
  }
  return false;
}

export function isPatientIdentityAffirmation(transcript: string, personName?: string): boolean {
  const normalized = normalizeTextForMatching(transcript);
  if (!normalized || hasIdentityDenial(normalized, personName) || hasConflictingSelfName(normalized, personName)) return false;

  const standaloneAffirmatives = [
    "yes", "yeah", "yep", "correct", "sure", "that's correct",
    "نعم", "اي", "ايه", "ايوه", "صح", "صحيح", "اكيد", "تمام", "موافق", "موافقة",
  ].map(normalizeTextForMatching);
  if (standaloneAffirmatives.includes(normalized)) return true;
  // Ordinary agreement often combines assent words ("اي صحيح", "yes correct").
  // Keep this narrower than booking consent: no changed details or booking verbs.
  const identityAssentWords = new Set(standaloneAffirmatives.filter((phrase) => !phrase.includes(" ")));
  if (normalized.split(" ").every((word) => identityAssentWords.has(word))) return true;
  // Short deictic replies refer to the record just read, not a new name.
  if (/^(?:اي|ايه|ايوه|نعم) هذا(?: هو)?$/.test(normalized) || /^(?:yes|yeah|yep) (?:this|that) one$/.test(normalized)) return true;

  const explicitIdentityPrefixes = [
    "that's me", "that is me", "yes that's me", "yes that is me", "yes this is me",
    "yes it is me", "yeah that's me", "yep that's me", "correct that's me",
    "that's my profile", "that is my profile", "yes that's my profile",
    "yes that is my profile", "yes this is my profile", "correct that's my profile",
    "this is my profile", "this is my account", "yes this is my account",
    "i am the patient", "yes i am the patient", "i am the person in the profile",
    "yes i am the person in the profile", "i am the profile owner", "yes i am the profile owner",
    "هذا ملفي", "هذا حسابي", "ايه هذا ملفي", "ايوه هذا ملفي", "نعم هذا ملفي",
    "انا صاحب الملف", "انا صاحبة الملف", "انا صاحب الحساب", "انا صاحبة الحساب",
  ].map(normalizeTextForMatching);
  const explicitIdentityPrefix = explicitIdentityPrefixes.find((prefix) =>
    normalized === prefix || normalized.startsWith(`${prefix} `),
  );
  if (explicitIdentityPrefix) {
    return !refersToANameRelation(normalized, explicitIdentityPrefix);
  }

  const normalizedName = personName ? normalizeTextForMatching(personName) : "";
  if (!normalizedName) return false;
  const firstNameToken = normalizedName.split(" ").find((token) => token.length > 2) ?? normalizedName.split(" ")[0];
  const namePrefixes = [firstNameToken].flatMap((token) => [
    `i am ${token}`,
    `i m ${token}`,
    `yes i am ${token}`,
    `yes i m ${token}`,
    `my name is ${token}`,
    `yes my name is ${token}`,
    `this is ${token}`,
    `yes this is ${token}`,
    `انا ${token}`,
    `نعم انا ${token}`,
    `ايه انا ${token}`,
    `ايوه انا ${token}`,
  ]).map(normalizeTextForMatching);
  return namePrefixes.some((prefix) => {
    if (normalized !== prefix && !normalized.startsWith(`${prefix} `)) return false;
    // "I'm [name]'s daughter" is not the same as "I'm [name]"; require a fresh, simpler confirmation.
    return !refersToANameRelation(normalized, prefix);
  });
}

export function isPatientIdentityDenial(transcript: string, personName?: string): boolean {
  const normalized = normalizeTextForMatching(transcript);
  return Boolean(normalized) && hasIdentityDenial(normalized, personName);
}

export function isPatientIdentityContradiction(transcript: string, personName?: string): boolean {
  const normalized = normalizeTextForMatching(transcript);
  return Boolean(normalized) && (hasIdentityDenial(normalized, personName)
    || hasConflictingSelfName(normalized, personName)
    || normalized.split(" ").some((word) => relationshipTerms.has(word)));
}
