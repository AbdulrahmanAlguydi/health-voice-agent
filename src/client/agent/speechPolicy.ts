import { normalizeTextForMatching } from "../../shared/textNormalization";
import { GEMINI_CLINIC_NAME_AR, GEMINI_CLINIC_NAME_EN } from "../../shared/geminiLiveConfig";
import type { OutputVerificationRequest } from "../../shared/outputVerification";

export type DirectorySpeechEvidence = NonNullable<OutputVerificationRequest["evidence"]>;

const relaxedEnglishReceptionWords = new Set("both all time feel free reach out proceed whenever decide decision comfortable not yet some more any other later anytime certainly happy gladly help happy support further questions need needs hesitate hesitation absolutely sounds good fine understandable understand take taking thinking whatever prefer preferences options choice choices choose choosing start begin pause wait waiting happy happy know explain explanation overview brief briefly short longer full entire list few couple variety various different departments welcome back lets go ahead ready really".split(" "));
for (const word of "if unless until while before after then than so because whether although though also however still even as once whenever whatever whichever whoever whenever yourself myself ourselves yours mine theirs its any every each several few another both together separately personally otherwise simply easily comfortably patiently".split(" ")) relaxedEnglishReceptionWords.add(word);
for (const word of "completely fully entirely totally perfectly definitely worries worry rush touch contact hesitate hesitation patiently patience certainly welcome anytime whenever absolutely course details clarification clarify further another else anything something whichever whichever first next initially afterwards meanwhile happy glad assist assisting assistance helping find finding generally general particular specifically briefly available".split(" ")) {
  if (word !== "available") relaxedEnglishReceptionWords.add(word);
}

const relaxedArabicReceptionWords = new Set(normalizeTextForMatching("خذ خذي وقتك وقتكم التفكير تفكر تفكرين فكر فكري انتظارك انتظر انتظرك قررت تقرر تقررين جاهز جاهزة مستعجل مستعجلة براحتك يعافيك يعافيكم عافية مشكلة ابدا حاب حابب حابة حابين تود تحبين مثلا مثل تشمل بينها منها تفاصيل اضافية اخرى ثانية اكثر نوضح نكمل").split(" "));
// Reception actions and qualifiers, not names, medical facts or booking statuses.
for (const word of normalizeTextForMatching("استفسار استفسارات تستفسر تستفسرين استفسر تسأل تسألين تسالون سؤال تساؤل توضح توضيح توضّح اذكر اذكرها اذكرهم اعرض اعرضها اشرح شرح اشرحها القائمة قائمة كاملة كامل بالكامل مختصر مختصرة اختصار سريع سريعة باختصار فكرة افكار نبذة لمحة بسيطة بسيط معلومة معلومات إضافية اضافية ثاني ثانية أخرى اخرى المزيد زيادة أكثر اكثر تحدد نحدد تحديد تختار اختار تختارين الاختيار اختيار ترجع تراجع مراجعة تشوفين تشوفوا لو وقت لاحق لاحقا بعدين قبل متى تريدين تفضلين تفضلوا رغبتك رغبتكم رغبتي تحتاجها تحتاجه تحتاجهم تساعدني اساعدكم توفّرها توفرها توافرها نكملها نكمله نتابع نتابعها نوضحها نوضحه متنوع متنوعة معين معينة أحد احد إحدى احدى معها معه معهم حسب بخصوص بالنسبة بشأن عمومًا عموما بشكل عام بوجه مبدئيا حاليا طبيعي الخيار الخيارات وقتها مناسب لك اية أي شيء شي").split(" ")) relaxedArabicReceptionWords.add(word);

// These are conversational words, not full reply templates. Unknown names,
// clinical instructions, contact details and scheduling claims need tool evidence.
const conversationWords = {
  en: new Set(normalizeTextForMatching(`hello hi hey there welcome good morning afternoon evening thanks thank you you're your welcome please sorry pardon excuse me sure okay ok of course no problem yes right alright absolutely happy glad help helping assist assistance can could would may i we our you me us it that this these the a an and or to for with about at in on is are be have do did does will want wanted need like prefer mind particular specific doctor doctors specialty specialties department departments directory information details appointment appointments book booking scheduling look up check checking find searching search tell ask asking question questions day which what when how who where let lets s d m t ll re ve just again repeat repeating say said hear heard hearing listen catch caught understand understood meant mean clarify clarification clear part last previous answer response reply one thing first next here continue go ahead together take work works working suits suit suitable best today anything something else also now back ready get got think looking speaking speak arabic english either slowly clearly little bit naturally calling calling reception receptionist clinic medical center hospital Afiyah` ).split(" ")),
  ar: new Set(normalizeTextForMatching(`السلام عليكم وعليكم سلام حياك حياكم الله هلا اهلين اهلا مرحبا صباح مساء الخير النور تفضل تفضلي تفضلوا اكيد تمام طيب حاضر نعم اي ايه لا ولا معليش ما عفوا شكرا شكر شكرًا تسلم يهمك يهمكم عليك لك لكم لي لنا انا احنا نحن انت انتي انتم هو هي هذا هذي هذه هذول كذا كذاك كيف وش ايش اي أي مين وين متى ليش هل فيه في فيك من عن على عند إلى او و واذا اذا بس اجل ان شاء اقدر نقدر تقدر تقدرين ممكن ابغى ابي تبي تبين ودك تريد تحتاج تحتاجين تحتاجون تحب احب اقدر اساعدك اساعدكم نساعدك اساعد اعاونك اخدمك اخدمكم خدمة مساعدة مساعدتك اسمعك سمعتك سمعت اسمع سمع فهمت فهمتك افهم افهمك فهمتني فهمنا اقصد تقصد تقصدين قلت تقول قل قلته اقول اعيد اعيدها اعيده تعيد تعيدها تعيده عيد عيدها عيده كرر نعيد سؤالك سؤالي سؤال اسئلة كلام كلامك واضح وضوح شوي زين جيد هنا الحين الان اليوم مرة ثانية ثاني اخر جزء اول خلنا خليني نكمل كمّل نبدأ نعرف تعرف تعرفين معلومات معلومة اشيك اشوف اشوفها تشيك نبحث ابحث تبحث ندور تدور تشوف تبحثين نطلع تطلع نلقى طبيب الطبيب اطباء الاطباء دكتور الدكتور دكتورة الدكتورة دكاترة اسم الاسم اسمه تخصص التخصص تخصصات التخصصات قسم اقسام الاقسام موعد الموعد مواعيد المواعيد حجز الحجز احجز تحجز تحجزين يحجز نحجز يوم اليوم ايام يناسبك يناسب يناسبكم يناسبني بالك عندك عندكم طلب طلبك طلبكِ الشي شيء شي التفاصيل التفاصيل الطبية الدليل مجمع عافية الطبي مستشفى عيادة العيادة استقبال موظف موظفة نساعد معلوماتهم عنها عنه لكلامك طريقة بطريقة بالعربي عربي العربية بالانجليزي انجليزي الانجليزية أوضح بوضوح براحة طبيعي طبيعية براحتك معي معك مع بعض بعد لسه باقي احتجت غيره بعدين`) .split(" ")),
};

const fieldWords = new Set(normalizeTextForMatching(`specialises specializes specialty located location clinic speaks speak languages listed lists directory found matching including names some few particular which one means her his she he they their them is has at in and we have name total doctor doctors تخصصها تخصصه عيادتها عيادته عيادة العيادة تخصص متخصص متخصصة يتكلم تتكلم ويتكلم وتتكلم يتحدث تتحدث لغات اللغات المسجلة مسجل مسجلة الدليل موجودة موجود عندنا عندي لقيت الاسم الاسماء بعض منهم يتكلمون يتحدثون المتوفرة المتاحة تطابق يطابقون يطابق طلبك اكثر واحد هو هي في و فيها`).split(" "));

export function canonicalizeSpeech(value: string, language: "en" | "ar"): string {
  const englishCounts = normalizeTextForMatching(value).replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|thirty) (?=(?:matching )?(?:doctors?|specialties)\b)/g, (_, number: string) => {
    const numbers: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, thirty: 30 };
    return `${numbers[number]} `;
  });
  const clinicCounts = englishCounts.replace(/\b(clinic|room)(?: number)? (one|two|three|four|five|six|seven|eight|nine|ten)\b/g, (_, label: string, number: string) => {
    const numbers: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    return `${label} ${numbers[number]}`;
  });
  const normalized = clinicCounts.replace(/العيادة رقم /g, "العيادة ").replace(/(?:^| )(رقم|العيادة) (واحد|واحدة|اثنين|اثنان|ثلاثة|اربعة|خمسة|ستة|سبعة|ثمانية|تسعة|عشرة)(?= |$)/g, (_, label: string, number: string) => {
    const numbers: Record<string, number> = { واحد: 1, واحدة: 1, اثنين: 2, اثنان: 2, ثلاثة: 3, اربعة: 4, خمسة: 5, ستة: 6, سبعة: 7, ثمانية: 8, تسعة: 9, عشرة: 10 };
    return ` ${label} ${numbers[number]}`;
  }).trim();
  const counted = normalized.replace(/(?:^| )(واحد|اثنين|ثلاثة|اربعة|خمسة|ستة|سبعة|ثمانية|تسعة|عشرة|ثلاثين|ثلاثون) (?=اطباء|طبيب|تخصصات|تخصص)/g, (_, number: string) => {
    const numbers: Record<string, number> = { واحد: 1, اثنين: 2, ثلاثة: 3, اربعة: 4, خمسة: 5, ستة: 6, سبعة: 7, ثمانية: 8, تسعة: 9, عشرة: 10, ثلاثين: 30, ثلاثون: 30 };
    return ` ${numbers[number]} `;
  }).trim();
  return counted.split(" ").map((word) => {
    if (language === "en" && word === "dr") return "doctor";
    if (language === "ar") {
      if (["ود", "ودكتور", "والدكتور", "ودكتورة", "والدكتورة"].includes(word)) return "و doctor";
      if (["د", "دكتور", "الدكتور", "دكتورة", "الدكتورة"].includes(word)) return "doctor";
      if (word === "هذي") return "هذه";
    }
    return word;
  }).join(" ");
}

function containsPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `) || ` ${text} `.includes(` و${phrase} `);
}

function conversationalWord(word: string, language: "en" | "ar"): boolean {
  const words = conversationWords[language];
  const descriptiveReceptionWords = new Set(["كثيرة", "كثير", "نوفر", "نركز", "موجودة", "موجود", "حبيت", "حبيتي", "بالخدمة", "نتكلم", "نتحدث", "نساعدكم", "اللغتين", "لغة", "المستقبل", "مستقبلا", "حاجة", "حاجات", "استفسارك", "تواصل", "تواصلك", "بالتأكيد", "ممتاز", "طيب", "اهتمام", "تفضل", "ابدأ", "ابدا", "تبدأ", "تبدا"]);
  const known = (value: string) => words.has(value) || (language === "en" && relaxedEnglishReceptionWords.has(value)) || (language === "ar" && (descriptiveReceptionWords.has(value) || relaxedArabicReceptionWords.has(value) || ["متنوعة", "متنوع", "معين", "معينة", "احد", "احدى", "معها", "معه", "معهم", "الخدمة", "الكاملة", "غيرها", "الكثير", "بالضبط", "بك", "مختلف", "مختلفة", "تسوي", "تسوين", "تماما"].includes(value)));
  const knownWithPronoun = (value: string) => known(value) || (language === "ar" && ["ها", "هم", "نا", "كم", "ك", "ه", "ين", "ون"].some((suffix) => value.length > suffix.length + 2 && value.endsWith(suffix) && known(value.slice(0, -suffix.length))));
  if (knownWithPronoun(word)) return true;
  if (language === "en" && word.endsWith("ing") && (known(word.slice(0, -3)) || known(`${word.slice(0, -3)}e`))) return true;
  return language === "ar" && ["و", "ب", "ل", "وب", "ول", "بال", "لل", "ال"].some((prefix) =>
    word.startsWith(prefix) && knownWithPronoun(word.slice(prefix.length)));
}

export function isNaturalReceptionDialogue(text: string, language: "en" | "ar"): boolean {
  let normalized = normalizeTextForMatching(text);
  for (const name of [GEMINI_CLINIC_NAME_AR, GEMINI_CLINIC_NAME_EN]) {
    normalized = normalized.replaceAll(normalizeTextForMatching(name), "");
  }
  const words = normalized.trim().split(/\s+/);
  if (!normalized.trim() || words.length > 80 || /\d/.test(normalized)) return false;
  // A request for patient details, or a concrete directory/schedule assertion,
  // must still go through its stateful function rather than conversational output.
  if (/\b(?:your|patient) (?:full )?(?:name|number|id|profile)\b|\bwe have\b|\bthere are\b/.test(normalized)) return false;
  if (/(?:^| )(?:اسمك|رقمك|جوالك|رقم المريض|رقم الجوال|اسم المريض)(?: |$)/.test(normalized)) return false;
  if (/\b(?:doctor|doctors|appointment|appointments) (?:is|are|work|works|has|have)\b/.test(normalized)) return false;
  if (/\b(?:book|reserve|confirm)\b.*\b(?:this|that|selected|chosen) (?:time|slot|appointment)\b/.test(normalized)) return false;
  if (/(?:^| )(?:الاطباء|الدكاترة|المواعيد) (?:موجودون|موجودين|متاحون|متاحين|متوفرة|متاحة)(?: |$)/.test(normalized)) return false;
  if (/\btoday\b/.test(normalized) && !/\b(?:help|assist|do)\b.*\btoday\b/.test(normalized)) return false;
  if (/\b(?:sure|okay|of course) (?:sure|okay|of course)\b/.test(normalized)) return false;
  if (/(?:^| )اليوم(?: |$)/.test(normalized) && !/(?:اساعدك|اساعدكم|اخدمك|اخدمكم|تحتاج).*اليوم/.test(normalized)) return false;
  return words.every((word) => conversationalWord(word, language));
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function createDirectorySpeechEvidence(
  toolName: string | undefined,
  response: Record<string, unknown>,
  language: "en" | "ar",
): DirectorySpeechEvidence | undefined {
  if (!["get_doctor_details", "search_doctors", "list_specialties"].includes(toolName ?? "")) return undefined;
  if (!["found", "ok", "ambiguous"].includes(String(response.status)) || typeof response.responseText !== "string") return undefined;
  const sourceText = response.responseText;
  const source = canonicalizeSpeech(sourceText, language);
  const records = [response.doctor, ...[response.doctors, response.candidates, response.specialties].flatMap((items) => Array.isArray(items) ? items : [])];
  const phrases: string[] = [];
  for (const value of records) {
    const record = object(value);
    const fields: unknown[] = [record.name, record.specialty, record.clinicLocation];
    if (Array.isArray(record.spokenLanguages)) {
      fields.push(...record.spokenLanguages.map((code) => language === "ar"
        ? code === "ar" ? "العربية" : "الإنجليزية"
        : code === "ar" ? "Arabic" : "English"));
    }
    for (const field of fields) {
      if (typeof field !== "string") continue;
      const phrase = canonicalizeSpeech(field, language).replace(/^doctor /, "");
      if (phrase) phrases.push(phrase);
    }
  }
  const groundedPhrases = [...new Set(phrases)];
  // Follow-ups may discuss one record/field from a returned list. Ground every
  // mentioned value, rather than forcing the caller to hear the whole list again.
  const requiredPhrases: string[] = [];
  const linkedRecords = records.map(object).filter((record) => typeof record.name === "string").map((record) => ({
    name: record.name as string,
    specialty: typeof record.specialty === "string" ? record.specialty : undefined,
    clinicLocation: typeof record.clinicLocation === "string" ? record.clinicLocation : undefined,
    spokenLanguages: Array.isArray(record.spokenLanguages) ? record.spokenLanguages.filter((value): value is string => typeof value === "string") : undefined,
  }));
  return phrases.length ? { sourceText, requiredPhrases, groundedPhrases, records: linkedRecords } : undefined;
}

export function createAvailabilitySpeechEvidence(toolName: string | undefined, response: Record<string, unknown>, language: "en" | "ar"): DirectorySpeechEvidence | undefined {
  if (toolName !== "get_available_slots" || !["ok", "unavailable"].includes(String(response.status)) || typeof response.responseText !== "string") return undefined;
  const slots = response.status === "unavailable" ? response.alternatives : response.slots;
  if (!Array.isArray(slots) || !slots.length) return undefined;
  const doctorName = object(response.doctor).name;
  if (typeof doctorName !== "string") return undefined;
  const dates = slots.map((slot) => object(slot).spokenDateTime);
  if (dates.some((date) => typeof date !== "string" || !date.trim())) return undefined;
  const phrases = [doctorName, ...dates as string[]].map((phrase) => canonicalizeSpeech(phrase, language).replace(/^doctor /, ""));
  const phraseVariants = (dates as string[]).map((date, index) => {
    const match = language === "en" ? /^(\w+), (\d+) (\w+) (\d{4}) at (\d{2}):(\d{2})$/.exec(date) : null;
    const slot = object(slots[index]);
    const variants: string[] = [slot.spokenHijriDateTime, slot.relativeDateTime].filter((value): value is string => typeof value === "string").map((value) => canonicalizeSpeech(value, language));
    if (match) {
      const [, dayName, day, month, year, hour, minute] = match;
      const suffix = [11, 12, 13].includes(Number(day) % 100) ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[Number(day) % 10] ?? "th";
      const hour12 = Number(hour) % 12 || 12;
      const period = Number(hour) >= 12 ? "PM" : "AM";
      const timeForms = [`${hour12}:${minute} ${period}`, ...(minute === "00" ? [`${hour12} ${period}`] : []), `${hour}:${minute}`];
      for (const dateForm of [`${month} ${day}${suffix}`, `${month} ${day}`, `${month} ${day}${suffix}, ${year}`, `${month} ${day}, ${year}`, `${day} ${month} ${year}`, `${day} ${month}`]) {
        for (const time of timeForms) variants.push(canonicalizeSpeech(`${dayName}, ${dateForm} at ${time}`, language));
      }
    }
    return { phrase: canonicalizeSpeech(date, language), variants };
  });
  // Do not infer which year was meant if two slots have the same short date/time.
  const variantTargets = new Map<string, Set<string>>();
  for (const entry of phraseVariants) for (const variant of entry.variants) variantTargets.set(variant, new Set([...(variantTargets.get(variant) ?? []), entry.phrase]));
  for (const entry of phraseVariants) entry.variants = entry.variants.filter((variant) => variantTargets.get(variant)?.size === 1);
  const appointmentDates = slots.map(object).filter((slot) => typeof slot.spokenDateTime === "string" && typeof slot.spokenHijriDateTime === "string").map((slot) => ({ gregorian: slot.spokenDateTime as string, hijri: slot.spokenHijriDateTime as string, ...(typeof slot.relativeDateTime === "string" ? { relative: slot.relativeDateTime } : {}) }));
  return { sourceText: response.responseText, requiredPhrases: phrases, groundedPhrases: phrases, phraseVariants, ...(appointmentDates.length ? { appointmentDates, allowRelativeDates: true } : {}) };
}

export function createBookingSpeechEvidence(response: Record<string, unknown>): DirectorySpeechEvidence | undefined {
  if (!["pending", "confirmed", "awaiting_guest_consent"].includes(String(response.status)) || typeof response.responseText !== "string") return undefined;
  const labels = object(response.slot ?? response.dateLabels);
  if (typeof labels.spokenDateTime !== "string" || typeof labels.spokenHijriDateTime !== "string") return undefined;
  const initialConsent = response.status === "awaiting_guest_consent";
  return { sourceText: response.responseText, requiredPhrases: [], allowRelativeDates: initialConsent, optionalAppointmentDates: initialConsent, appointmentDates: [{ gregorian: labels.spokenDateTime, hijri: labels.spokenHijriDateTime, ...(initialConsent && typeof labels.relativeDateTime === "string" ? { relative: labels.relativeDateTime } : {}) }] };
}

function canonicalizeWithEvidence(text: string, evidence: DirectorySpeechEvidence | undefined, language: "en" | "ar"): string {
  let remaining = ` ${canonicalizeSpeech(text, language)} `;
  for (const entry of evidence?.phraseVariants ?? []) {
    for (const variant of [...entry.variants].sort((left, right) => right.length - left.length)) remaining = remaining.replaceAll(` ${variant} `, ` ${entry.phrase} `);
  }
  return remaining.trim();
}

export function removeGroundedPhrases(text: string, evidence: DirectorySpeechEvidence | undefined, language: "en" | "ar"): string {
  let remaining = ` ${canonicalizeWithEvidence(text, evidence, language)} `;
  for (const phrase of evidence?.groundedPhrases ?? evidence?.requiredPhrases ?? []) {
    remaining = remaining.replaceAll(` ${phrase} `, " ").replaceAll(` و${phrase} `, " ");
  }
  return remaining.trim();
}

export function matchesDirectoryEvidence(text: string, evidence: DirectorySpeechEvidence, language: "en" | "ar"): boolean {
  const spoken = canonicalizeWithEvidence(text, evidence, language);
  const source = canonicalizeSpeech(evidence.sourceText, language);
  if (!evidence.requiredPhrases.every((phrase) => containsPhrase(spoken, phrase))) return false;
  if (evidence.requiredPhrases.length === 0 && !(evidence.groundedPhrases ?? []).some((phrase) => containsPhrase(spoken, phrase))) return false;
  const remainingSpoken = removeGroundedPhrases(spoken, evidence, language);
  const remainingSource = removeGroundedPhrases(source, evidence, language);
  const numbers = (value: string): string[] => value.match(/\b\d+\b/g) ?? [];
  const availableNumbers = numbers(remainingSource);
  for (const number of numbers(remainingSpoken)) {
    const index = availableNumbers.indexOf(number);
    if (index < 0) return false;
    availableNumbers.splice(index, 1);
  }
  const sourceWords = new Set(remainingSource.split(" "));
  const allSourceWords = new Set(source.split(" "));
  const semanticMarkers = new Set(normalizeTextForMatching("not no never without isnt today tomorrow yesterday monday tuesday wednesday thursday friday saturday sunday ما لا ليس مو مش بدون اليوم بكرة غدا امس السبت الاحد الاثنين الثلاثاء الاربعاء الخميس الجمعة").split(" "));
  const cleanSpoken = spoken.replace(/\bno problem\b/g, "").replace(/ولا يهمك/g, "");
  for (const word of cleanSpoken.split(" ")) {
    if (semanticMarkers.has(word) && !allSourceWords.has(word)) return false;
  }
  const isFieldWord = (word: string) => fieldWords.has(word) || (language === "en" && word.endsWith("ing") && [word.slice(0, -3), `${word.slice(0, -3)}s`, `${word.slice(0, -3)}es`].some((stem) => fieldWords.has(stem)));
  return remainingSpoken.split(" ").every((word) => !word || sourceWords.has(word) || word === "doctor" || isFieldWord(word) || conversationalWord(word, language));
}
