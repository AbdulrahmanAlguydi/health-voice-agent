import { describe, expect, it } from "vitest";
import {
  isPatientIdentityAffirmation,
  isPatientIdentityDenial,
  isUnambiguousGuestSlotConsent,
  isUnambiguousAffirmative,
} from "../../src/shared/affirmative";

describe("explicit booking affirmatives", () => {
  it.each(["yes", "That's correct!", "نعم", "إيه أكيد", "ايوه، أكيد"])("accepts %s", (text) => {
    expect(isUnambiguousAffirmative(text)).toBe(true);
  });

  it.each(["yes, but later", "yes maybe", "I think so", "لا", "موافق بس بعدين"])("rejects %s", (text) => {
    expect(isUnambiguousAffirmative(text)).toBe(false);
  });

  it.each(["Okay, but check with me later.", "Yes, I don't know yet.", "That works if you can move it."])("rejects uncertain ordinary phrasing: %s", (text) => {
    expect(isUnambiguousAffirmative(text)).toBe(false);
  });
});

describe("patient identity confirmation", () => {
  it.each(["اي هذا", "إيه هذا هو", "نعم هذا", "Yes, this one"])("accepts contextual reference to the just-read patient record: %s", (text) => {
    expect(isPatientIdentityAffirmation(text, "مريض تجريبي")).toBe(true);
  });
  it.each(["اي صحيح.", "نعم، صحيح.", "إيه صح", "ايوه اكيد صحيح", "Yes, correct", "Yeah, sure"])("accepts ordinary compound agreement to the patient name: %s", (text) => {
    expect(isPatientIdentityAffirmation(text, "مريض تجريبي")).toBe(true);
  });
  it.each(["اي صحيح بس مو ملفي", "نعم صحيح يمكن", "اي صحيح ملف أمي", "Yes, correct, but not me", "Yes, book the appointment"])("does not confuse qualified agreement or booking intent with identity: %s", (text) => {
    expect(isPatientIdentityAffirmation(text, "مريض تجريبي")).toBe(false);
  });
  it.each([
    ["Yes, that's me. I want to book an appointment.", undefined],
    ["Correct, that's my profile.", undefined],
    ["ايه أنا مريم وأبي موعد", "مريم السالم"],
  ])("accepts a clear identity affirmation: %s", (text, name) => {
    expect(isPatientIdentityAffirmation(text, name)).toBe(true);
  });

  it.each([
    "No, that's not me.",
    "Yes, but that's the wrong person.",
    "Yes, I want to book, but I'm not the person in the profile.",
    "Yes, but that profile belongs to someone else.",
    "Yes, that's my mother's profile.",
    "Yes, I'm the patient's daughter.",
    "ايه هذا ملف أمي",
    "Yes, but I'm not Mariam.",
    "لا مو أنا",
    "ايه بس هذا مو ملفي",
  ])("rejects a denied or contradicted identity: %s", (text) => {
    expect(isPatientIdentityAffirmation(text)).toBe(false);
  });

  it("uses the looked-up patient name to catch a contradiction", () => {
    const text = "Yes, but I'm not Mariam.";
    expect(isPatientIdentityAffirmation(text, "Mariam Al-Salem")).toBe(false);
    expect(isPatientIdentityDenial(text, "Mariam Al-Salem")).toBe(true);
  });

  it("does not mistake a relationship to the named patient for self-identification", () => {
    expect(isPatientIdentityAffirmation("Yes, I'm Mariam's daughter.", "Mariam Al-Salem")).toBe(false);
  });

  it("rejects an explicit different name even when the reply starts with an affirmation", () => {
    expect(isPatientIdentityAffirmation("Yes, that is me. My name is Aisha.", "Mariam Al-Salem")).toBe(false);
    expect(isPatientIdentityAffirmation("Yes, that is me. I am Aisha.", "Mariam Al-Salem")).toBe(false);
    expect(isPatientIdentityAffirmation("Yes, that is me. My name is Mariam Aisha.", "Mariam Al-Salem")).toBe(false);
    expect(isPatientIdentityAffirmation("Yes, I am Mariam Al-Karim.", "Mariam Al-Salem")).toBe(false);
    expect(isPatientIdentityAffirmation("Yes, I am Mariam, not Al-Salem.", "Mariam Al-Salem")).toBe(false);
    expect(isPatientIdentityAffirmation("Yes, I am Mariam, but my surname is Al-Karim.", "Mariam Al-Salem")).toBe(false);
    expect(isPatientIdentityAffirmation("Yes, I am Al-Salem.", "Mariam Al-Salem")).toBe(false);
    expect(isPatientIdentityAffirmation("ايه هذا ملفي، اسمي عائشة", "مريم السالم")).toBe(false);
    expect(isPatientIdentityAffirmation("ايه هذا ملفي، انا عائشة", "مريم السالم")).toBe(false);
    expect(isPatientIdentityAffirmation("نعم أنا مريم سالم", "مريم السالم")).toBe(false);
    expect(isPatientIdentityAffirmation("نعم أنا مريم، مو السالم", "مريم السالم")).toBe(false);
    expect(isPatientIdentityAffirmation("نعم أنا مريم لكن اسم العائلة الكريم", "مريم السالم")).toBe(false);
  });

  it("accepts the returned name with ordinary booking intent", () => {
    expect(isPatientIdentityAffirmation("Yes, that's me. My name is Mariam and I want to book.", "Mariam Al-Salem")).toBe(true);
    expect(isPatientIdentityAffirmation("Yes, I am Mariam Al-Salem and I want to book.", "Mariam Al-Salem")).toBe(true);
    expect(isPatientIdentityAffirmation("Yes, that's me. My surname is Al-Salem.", "Mariam Al-Salem")).toBe(true);
    expect(isPatientIdentityAffirmation("ايه أنا مريم وأبي موعد", "مريم السالم")).toBe(true);
    expect(isPatientIdentityAffirmation("ايه أنا مريم السالم وأبي موعد", "مريم السالم")).toBe(true);
    expect(isPatientIdentityAffirmation("ايه هذا ملفي، اسم العائلة السالم", "مريم السالم")).toBe(true);
  });
});

describe("natural booking confirmation phrasing", () => {
  it.each(["Okay, go ahead.", "That works for me.", "Sounds good.", "Yep, that's fine.", "Perfect.", "ماشي احجزه", "طيب احجز", "خلاص احجزه", "ايه احجز الموعد"])("accepts ordinary clear agreement: %s", (text) => {
    expect(isUnambiguousAffirmative(text)).toBe(true);
  });

  it.each(["Yes, please confirm the appointment.", "Go ahead and book it.", "إيه، أكد الحجز", "موافق، احجز الموعد"])("accepts %s", (text) => {
    expect(isUnambiguousAffirmative(text)).toBe(true);
  });

  it.each(["Yes, if it is still available", "Sure, but make it later", "يمكن، خلني أفكر"])("does not treat a condition or hesitation as consent: %s", (text) => {
    expect(isUnambiguousAffirmative(text)).toBe(false);
  });

  it.each([
    "Yes, my name is Aisha and my number is 0501234567",
    "Okay, I'm Aisha and you can reach me at 0501234567",
    "إيه، اسمي عائشة ورقمي ٠٥٠١٢٣٤٥٦٧",
    "ايه أنا عائشة وهذا رقمي ٠٥٠١٢٣٤٥٦٧",
  ])("accepts guest details included with clear slot consent: %s", (text) => {
    expect(isUnambiguousGuestSlotConsent(text)).toBe(true);
  });

  it.each(["Yes, my name is Aisha, but make it later", "Maybe my number is 0501234567", "لا، اسمي عائشة"])("rejects guest details without clear slot consent: %s", (text) => {
    expect(isUnambiguousGuestSlotConsent(text)).toBe(false);
  });
});
