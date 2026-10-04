import { normalizeTextForMatching } from "../../shared/textNormalization";

// Deliberately narrow status check, not a language/identity/medical verifier.
export function contradictsBookingStatus(text: string, booked: boolean): boolean {
  const normalized = normalizeTextForMatching(text);
  if (booked) return /(?:هل|اكد لك|احجز لك|احجزه|نثبت|ااثبت).*?(?:الحجز|الموعد)|(?:should|shall|would you like me to).*?(?:confirm|book|reserve)/.test(normalized);
  const clauses = normalized.split(/(?:لكن|but)/);
  return clauses.some((clause) => {
    const negative = /(?:ما|مو|لم|ليس|لن|لا)\s+(?:صار\s+اي\s+|تم\s+)?(?:حجز|حجزت|حجزنا|تاكد)|(?:not|never|nothing|haven t|hasn t|isn t).*?(?:booked|reserved|confirmed)/.test(clause);
    return !negative && /(?:^|\s)(?:حجزنا|حجزت|حجزناه|حجزك مؤكد|تم الحجز|تاكد الحجز|تاكد حجزك)(?:\s|$)|\b(?:is|was|have|has|we|i)\b.*?\b(?:booked|reserved|confirmed)\b/.test(clause);
  });
}
