type ConversationLanguage = "en" | "ar";

const ENGLISH_CUES = new Set([
  "a", "an", "and", "are", "appointment", "available", "book", "can", "could", "do", "does", "for", "from", "have", "hello", "how",
  "i", "is", "list", "me", "my", "need", "please", "show", "specialty", "tell", "thank", "the", "there", "want", "what", "where",
  "which", "who", "with", "yes", "you", "about", "when", "yeah", "yep", "sure", "okay", "ok", "fine", "sounds", "good", "great",
  "perfect", "correct", "right", "works", "absolutely", "thanks", "definitely", "certainly",
]);

const ARABIC_CUES = new Set([
  "ابي", "أبي", "ابغى", "أبغى", "أريد", "أحتاج", "احتاج", "أقدر", "اقدر", "تقدر", "ممكن", "وش", "ايش", "إيش",
  "وين", "عندكم", "هل", "أحجز", "احجز", "موعد", "مع", "أشوف", "اشوف", "نعم", "ايه", "إيه", "لا", "متى", "كيف",
  "ليش", "ليه", "كم", "هذا", "هذي", "عند", "المواعيد", "التخصصات", "الأطباء", "الاطباء", "تمام", "ماشي", "خلاص", "حاضر",
  "اكيد", "أكيد", "ممتاز", "صحيح", "صح", "ابشر", "أبشر",
]);

/**
 * Prefer strong words from the utterance over the script used by a doctor's name.
 * Short names, IDs, and balanced mixed speech are language-neutral and keep the
 * current conversation language instead of causing a sudden voice switch.
 */
export function detectConversationLanguage(text: string, current: ConversationLanguage): ConversationLanguage {
  // Live ASR can caption Arabic ألو as English Hello. One attention check
  // cannot reliably establish a language switch; surrounding speech can.
  if (/^\s*(?:hello|hallo|allo|alo)[\s.!?،؟]*$/i.test(text)) return current;
  if (/^\s*[أإا]لو[\s.!?،؟]*$/.test(text)) return "ar";
  const englishWords = text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
  const arabicWords = text.match(/[\u0621-\u064a\u0660-\u0669]+/g) ?? [];
  if (!englishWords.length && !arabicWords.length) return current;

  const englishCues = englishWords.filter((word) => ENGLISH_CUES.has(word)).length;
  const arabicCues = arabicWords.filter((word) => ARABIC_CUES.has(word)).length;
  if (englishCues > arabicCues) return "en";
  if (arabicCues > englishCues) return "ar";

  if (arabicWords.length >= 2 && englishWords.length === 0) return "ar";
  if (englishWords.length >= 3 && arabicWords.length === 0) return "en";

  if (arabicWords.length && englishWords.length) {
    if (arabicWords.length > englishWords.length * 2) return "ar";
    if (englishWords.length > arabicWords.length * 2) return "en";
  }
  return current;
}
