import { describe, expect, it } from "vitest";
import { AssistantOutputGate } from "../../src/client/agent/guardrails";
import { createAvailabilitySpeechEvidence, createDirectorySpeechEvidence } from "../../src/client/agent/speechPolicy";

function check(text: string, language: "ar" | "en", expected?: string, evidence?: ReturnType<typeof createDirectorySpeechEvidence>) {
  let approved = false;
  let reason: string | undefined;
  const gate = new AssistantOutputGate({
    onApproved: () => { approved = true; },
    onRejected: (event) => { reason = event.reason; },
  });
  gate.begin(expected, language, true, evidence);
  gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
  gate.addTranscript(text, true);
  gate.markGenerationComplete();
  gate.discard();
  return { approved, reason };
}

describe("natural reception speech with grounded facts", () => {
  it("accepts natural English hesitation without a booking claim", () => {
    expect(check("I can help you with finding information about our doctors or booking an appointment. What would you like to do?", "en").approved).toBe(true);
    expect(check("No problem at all. Take your time, and feel free to reach out when you're ready to proceed.", "en").approved).toBe(true);
    expect(check("I understand completely. Take your time, and just let me know when you're ready to proceed.", "en").approved).toBe(true);
    expect(check("Of course, take your time. I'll be right here if you need anything else or decide to book later.", "en").approved).toBe(true);
    expect(check("Take your time. Your appointment is confirmed.", "en").approved).toBe(false);
  });

  it("accepts both before the two returned spoken languages", () => {
    const result = { status: "found", doctor: { name: "Dr. Noura Al-Shammari", specialty: "Dermatology", spokenLanguages: ["ar", "en"] }, responseText: "Dr. Noura Al-Shammari, Dermatology, Arabic and English." };
    const evidence = createDirectorySpeechEvidence("get_doctor_details", result, "en");
    expect(check("Dr. Noura Al-Shammari specializes in Dermatology, and she speaks both Arabic and English.", "en", result.responseText, evidence).approved).toBe(true);
    expect(check("Dr. Noura Al-Shammari specializes in Dermatology, and she speaks both French and English.", "en", result.responseText, evidence).approved).toBe(false);
  });

  it("preserves English doctor counts expressed as words", () => {
    const result = { status: "ok", doctors: [{ name: "Dr. Reem Al-Dosari" }, { name: "Dr. Noura Al-Shammari" }, { name: "Dr. Ahmed Al-Zahrani" }], responseText: "I found 3 matching doctors, including Dr. Reem Al-Dosari, Dr. Noura Al-Shammari, and Dr. Ahmed Al-Zahrani." };
    const evidence = createDirectorySpeechEvidence("search_doctors", result, "en");
    expect(check(result.responseText.replace("3", "three"), "en", result.responseText, evidence).approved).toBe(true);
    expect(check(result.responseText.replace("3", "four"), "en", result.responseText, evidence).approved).toBe(false);
  });

  it("accepts the same English clinic number as a word while rejecting a different number", () => {
    const result = { status: "found", doctor: { name: "Dr. Reem Al-Dosari", clinicLocation: "Main Hospital, Clinic 1" }, responseText: "Dr. Reem Al-Dosari's clinic is in the Main Hospital, Clinic 1." };
    const evidence = createDirectorySpeechEvidence("get_doctor_details", result, "en");
    expect(check("Dr. Reem Al-Dosari's clinic is located in the Main Hospital, Clinic one.", "en", result.responseText, evidence).approved).toBe(true);
    expect(check("Dr. Reem Al-Dosari's clinic is located in the Main Hospital, Clinic two.", "en", result.responseText, evidence).approved).toBe(false);
  });

  it("allows conjunctions between complete available slots but rejects changed times or status", () => {
    const result = { status: "ok", doctor: { name: "Dr. Reem Al-Dosari" }, slots: [{ spokenDateTime: "Thursday, 1 October 2026 at 12:00" }, { spokenDateTime: "Sunday, 4 October 2026 at 17:00" }], responseText: "The available times with Dr. Reem Al-Dosari are Thursday, 1 October 2026 at 12:00, Sunday, 4 October 2026 at 17:00. Which works for you?" };
    const evidence = createAvailabilitySpeechEvidence("get_available_slots", result, "en");
    const text = "The available times with Dr. Reem Al-Dosari are Thursday, 1 October 2026 at 12:00, and Sunday, 4 October 2026 at 17:00. Which works for you?";
    expect(check(text, "en", result.responseText, evidence).approved).toBe(true);
    expect(check("The available times with Dr. Reem Al-Dosari are Thursday, October 1st at 12:00 PM, and Sunday, October 4th at 5:00 PM. Which works for you?", "en", result.responseText, evidence).approved).toBe(true);
    expect(check("The available times with Dr. Reem Al-Dosari are Thursday, October 1st at 12:00 PM, and Sunday, October 4th at 5:00 AM. Which works for you?", "en", result.responseText, evidence).approved).toBe(false);
    expect(check(text.replace("17:00", "18:00"), "en", result.responseText, evidence).approved).toBe(false);
    expect(check(text.replace("available", "not available"), "en", result.responseText, evidence).approved).toBe(false);
    expect(check(`${text} Your appointment is confirmed.`, "en", result.responseText, evidence).approved).toBe(false);
    expect(createAvailabilitySpeechEvidence("confirm_booking", result, "en")).toBeUndefined();
  });
  it("tolerates a duplicated letter in the welcome transcription without changing the clinic", () => {
    let approved = false;
    const gate = new AssistantOutputGate({ onApproved: () => { approved = true; } });
    gate.begin("السلام عليكم، أهلًا بك في مجمع عافية الطبي. كيف أقدر أساعدك؟", "ar", false);
    gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
    gate.addTranscript("اللسلام عليكم، أهلًا بك في مجمع عافية الطبي. كيف أقدر أساعدك؟", true);
    gate.markGenerationComplete();
    expect(approved).toBe(true);
  });
  it.each([
    "تمام، خذ وقتك في التفكير وأنا في انتظارك متى ما قررت.",
    "الله يعافيك، ما فيه مشكلة أبدًا.",
    "حابب تعرف معلومات ثانية أو عن حجز موعد؟",
    "أقدر أساعدك بمعلومات عن الأطباء أو بحجز موعد. حابب تستفسر عن شي معين؟",
    "تحب أذكر لك القائمة كاملة؟",
    "حابب تعرف مواعيد توفرها؟",
    "تمام، خذ وقتك بالتفكير. وأنا هنا لو احتجت أي استفسار أو حجز موعد في وقت لاحق.",
    "تمام، خذ وقتك بالتفكير. أنا في الخدمة لو احتجت أي معلومة ثانية أو قررت تحجز.",
    "أهلاً بك. أقدر أساعدك بمعلومات عن الأطباء في مختلف التخصصات أو بحجز موعد. وش تفضل تسوي؟",
    "حابب تعرف مواعيدها أو عندك استفسار ثاني؟",
    "براحتك تمامًا. خذي وقتك، ومتى ما قررتِ أنا هنا لأي استفسار. حياك الله.",
    "حياك الله. أقدر أساعدك بمعلومات عن الأطباء الموجودين أو بحجز موعد إذا تحب، وش تحتاج؟",
    "حياك الله. أقدر أساعدك بمعلومات عن الأطباء أو بحجز موعد. وش تحتاج تبدأ فيه؟",
  ])("allows ordinary hesitation and follow-up wording: %s", (text) => {
    expect(check(text, "ar").approved).toBe(true);
  });

  it("accepts a spoken clinic number but not a different clinic", () => {
    const result = { status: "found", doctor: { name: "د. ريم الدوسري", specialty: "الأمراض الجلدية", clinicLocation: "المستشفى الرئيسي، العيادة رقم 1", spokenLanguages: ["ar"] }, responseText: "د. ريم الدوسري، الأمراض الجلدية، المستشفى الرئيسي، العيادة رقم 1، العربية." };
    const evidence = createDirectorySpeechEvidence("get_doctor_details", result, "ar");
    expect(check("عيادة الدكتورة ريم الدوسري في المستشفى الرئيسي، العيادة رقم واحد.", "ar", result.responseText, evidence).approved).toBe(true);
    expect(check("عيادة الدكتورة ريم الدوسري في المستشفى الرئيسي، العيادة واحد.", "ar", result.responseText, evidence).approved).toBe(true);
    expect(check("عيادة الدكتورة ريم الدوسري في المستشفى الرئيسي، العيادة رقم اثنين.", "ar", result.responseText, evidence).approved).toBe(false);
  });

  it("allows a grounded doctor answer with a natural booking question", () => {
    const result = { status: "found", doctor: { name: "د. نورة الشمري", specialty: "الأمراض الجلدية", spokenLanguages: ["ar", "en"] }, responseText: "د. نورة الشمري، الأمراض الجلدية، العربية والإنجليزية." };
    expect(check("دكتورة نورة الشمري تخصصها الأمراض الجلدية، وتتكلم العربية والإنجليزية. هل تحب تحجز موعد معها؟", "ar", result.responseText, createDirectorySpeechEvidence("get_doctor_details", result, "ar")).approved).toBe(true);
    expect(check("دكتورة نورة الشمري متخصصة في الأمراض الجلدية وتتكلم اللغة العربية والإنجليزية.", "ar", result.responseText, createDirectorySpeechEvidence("get_doctor_details", result, "ar")).approved).toBe(true);
  });

  it("allows a short grounded specialty sample without inventing a specialty", () => {
    const result = { status: "ok", specialties: [{ name: "أمراض القلب" }, { name: "طب الأسنان" }, { name: "الأمراض الجلدية" }], responseText: "التخصصات المتوفرة عندنا: أمراض القلب، طب الأسنان، الأمراض الجلدية. فيه تخصص معيّن تدور عليه؟" };
    const evidence = createDirectorySpeechEvidence("list_specialties", result, "ar");
    expect(check("عندنا مثلًا طب الأسنان والأمراض الجلدية. فيه تخصص معيّن تدور عليه؟", "ar", result.responseText, evidence).approved).toBe(true);
    expect(check("عندنا تخصصات متنوعة مثل أمراض القلب، طب الأسنان، والأمراض الجلدية. تحب تعرف عن تخصص معين؟", "ar", result.responseText, evidence).approved).toBe(true);
    expect(check("عندنا طب الكلى. فيه تخصص معيّن تدور عليه؟", "ar", result.responseText, evidence).approved).toBe(false);
  });

  it("accepts Arabic conjunctions attached to doctor titles in a grounded list", () => {
    const result = { status: "ok", doctors: [{ name: "د. ريم الدوسري" }, { name: "د. نورة الشمري" }, { name: "د. أحمد الزهراني" }], responseText: "لقيت 3 أطباء: د. ريم الدوسري، د. نورة الشمري، د. أحمد الزهراني. تبي طبيب معيّن؟" };
    const evidence = createDirectorySpeechEvidence("search_doctors", result, "ar");
    expect(check("لقيت لك 3 أطباء: د. ريم الدوسري، د. نورة الشمري، ود. أحمد الزهراني. هل تفضل تعرف معلومات أكثر عن أحد منهم؟", "ar", result.responseText, evidence).approved).toBe(true);
    expect(check("لقيت ثلاثة أطباء: د. ريم الدوسري، د. نورة الشمري، ود. أحمد الزهراني. تبي طبيب معيّن؟", "ar", result.responseText, evidence).approved).toBe(true);
    expect(check("دكتورة نورة الشمري. تبي معلومات عنها؟", "ar", result.responseText, evidence).approved).toBe(true);
  });

  it("allows mentioning a full specialty present in returned records even when the response template lists only names", () => {
    const result = { status: "ok", doctors: [{ name: "د. ريم الدوسري", specialty: "الأمراض الجلدية" }], responseText: "لقيت د. ريم الدوسري. تبي معلومات عنها؟" };
    expect(check("في تخصص الأمراض الجلدية عندنا دكتورة ريم الدوسري. تبي معلومات عنها؟", "ar", result.responseText, createDirectorySpeechEvidence("search_doctors", result, "ar")).approved).toBe(true);
  });

  it("accepts conversational summaries of database specialties", () => {
    const result = { status: "ok", specialties: [{ name: "طب الأطفال" }, { name: "طب العيون" }, { name: "جراحة العظام" }], responseText: "عندنا طب الأطفال، طب العيون، جراحة العظام." };
    const evidence = createDirectorySpeechEvidence("list_specialties", result, "ar");
    expect(check("نوفر تخصصات متنوعة مثل طب الأطفال، طب العيون، وجراحة العظام. تبي نركز على واحد منها؟", "ar", result.responseText, evidence).approved).toBe(true);
  });
  it("updates a microphone turn's language without dropping buffered audio", () => {
    let approvedLanguage: string | undefined;
    const gate = new AssistantOutputGate({ onApproved: (output) => { approvedLanguage = output.language; } });
    gate.begin(undefined, "ar");
    gate.addAudio({ data: "AQID", mimeType: "audio/pcm;rate=24000" });
    gate.updateConversationLanguage("en");
    gate.addTranscript("Hello! How can I help you?", true);
    gate.markGenerationComplete();
    expect(approvedLanguage).toBe("en");
  });

  it("does not mistake a trusted directory field for medical advice", () => {
    const text = "Dr. Sara specialises in Internal Medicine.";
    expect(check(text, "en", text).approved).toBe(true);
    expect(check(`${text} You should take medicine.`, "en", text).approved).toBe(false);
  });
  it.each([
    ["وعليكم السلام، حياك الله. كيف أقدر أساعدك؟", "ar"],
    ["أقدر أساعدك بمعلومات عن الأطباء أو بحجز موعد. وش تحتاج؟", "ar"],
    ["معليش، ما فهمت آخر جزء. تقصد اسم الطبيب؟", "ar"],
    ["Hi there! How can I help you today?", "en"],
    ["I can help you look up our doctors or book an appointment. What would you like to do?", "en"],
    ["No problem, let me say that again. Which doctor do you have in mind?", "en"],
  ] as const)("accepts non-factual reception wording without a scripted tool turn: %s", (text, language) => {
    expect(check(text, language).approved).toBe(true);
  });

  it.each([
    ["Hello, Dr. Nora is available tomorrow at 4.", "en"],
    ["Hi, your appointment is confirmed.", "en"],
    ["I can help you. Drink warm water and rest.", "en"],
    ["Welcome. The earth is flat.", "en"],
    ["أهلًا، الدكتور خالد متاح بكرة.", "ar"],
    ["حياك الله، تم حجز موعدك.", "ar"],
    ["أقدر أساعدك، اشرب ماء دافي وارتاح.", "ar"],
    ["Can I get your name?", "en"],
    ["اعطيني اسمك ورقم الجوال.", "ar"],
  ] as const)("rejects facts, advice, and state-dependent intake disguised as small talk: %s", (text, language) => {
    expect(check(text, language).approved).toBe(false);
  });

  const response = {
    status: "found",
    doctor: { name: "د. سارة القحطاني", specialty: "الطب الباطني", clinicLocation: "عيادة الرياض", spokenLanguages: ["ar", "en"] },
    responseText: "تخصص د. سارة القحطاني هو الطب الباطني، والعيادة في عيادة الرياض. اللغات المسجلة في الدليل: العربية والإنجليزية.",
  };

  it("allows changing directory sentence structure while preserving every returned field", () => {
    const evidence = createDirectorySpeechEvidence("get_doctor_details", response, "ar");
    expect(check("الدكتورة سارة القحطاني تخصصها الطب الباطني. عيادتها في عيادة الرياض، وتتكلم العربية والإنجليزية.", "ar", response.responseText, evidence).approved).toBe(true);
  });

  it("allows a focused specialty answer without unnecessarily reading location and languages", () => {
    const evidence = createDirectorySpeechEvidence("get_doctor_details", response, "ar");
    expect(check("الدكتورة سارة القحطاني تخصصها الطب الباطني.", "ar", response.responseText, evidence).approved).toBe(true);
    expect(check("الدكتورة سارة القحطاني تخصصها الطب.", "ar", response.responseText, evidence).approved).toBe(false);
  });

  it.each([
    "الدكتورة نورة القحطاني تخصصها الطب الباطني. عيادتها في عيادة الرياض، وتتكلم العربية والإنجليزية.",
    "الدكتورة سارة القحطاني تخصصها الطب الباطني. عيادتها في عيادة جدة، وتتكلم العربية والإنجليزية.",
    "الدكتورة سارة القحطاني تخصصها الطب الباطني. عيادتها في عيادة الرياض، وتتكلم العربية والإنجليزية والفرنسية.",
    "الدكتورة سارة القحطاني مو تخصصها الطب الباطني. عيادتها في عيادة الرياض، وتتكلم العربية والإنجليزية.",
    "الدكتورة سارة القحطاني تخصصها الطب الباطني. عيادتها في عيادة الرياض، وتتكلم العربية والإنجليزية. موعدها بكرة.",
  ])("rejects altered directory facts in natural wording: %s", (text) => {
    expect(check(text, "ar", response.responseText, createDirectorySpeechEvidence("get_doctor_details", response, "ar")).approved).toBe(false);
  });

  it("does not mistake a database specialty containing Medicine for clinical advice", () => {
    const result = {
      status: "found",
      doctor: { name: "Dr. Sarah", specialty: "Internal Medicine", clinicLocation: "Riyadh Clinic", spokenLanguages: ["en"] },
      responseText: "We have Dr. Sarah in Internal Medicine at Riyadh Clinic. The directory lists English.",
    };
    const evidence = createDirectorySpeechEvidence("get_doctor_details", result, "en");
    expect(check("Doctor Sarah specialises in Internal Medicine. The clinic is Riyadh Clinic, and she speaks English.", "en", result.responseText, evidence).approved).toBe(true);
    expect(check(`${result.responseText} You should take medicine.`, "en", result.responseText, evidence).approved).toBe(false);
  });

  it("never enables directory rewording for appointment or identity results", () => {
    expect(createDirectorySpeechEvidence("prepare_booking", response, "ar")).toBeUndefined();
    expect(createDirectorySpeechEvidence("lookup_patient", response, "ar")).toBeUndefined();
  });
});
