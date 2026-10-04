import { normalizeTextForMatching } from "./textNormalization";

const digitWords: Record<string, string> = {
  zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  صفر: "0", واحد: "1", اثنين: "2", اثنان: "2", اتنين: "2", ثلاثة: "3", ثلاثه: "3", اربعة: "4", اربعه: "4",
  خمسة: "5", خمسه: "5", ستة: "6", سته: "6", سبعة: "7", سبعه: "7", ثمانية: "8", ثمانيه: "8", تسعة: "9", تسعه: "9",
};

/** Capture digit-by-digit contact dictation, not dates or general number arithmetic. */
export function extractContactDigits(text: string): string | undefined {
  const tokens = normalizeTextForMatching(text).split(" ");
  let current = "";
  const candidates: string[] = [];
  for (const token of tokens) {
    const digits = /^\d+$/.test(token) ? token : digitWords[token];
    if (digits !== undefined) current += digits;
    else { if (current.length >= 3) candidates.push(current); current = ""; }
  }
  if (current.length >= 3) candidates.push(current);
  const candidate = candidates.sort((a, b) => b.length - a.length)[0];
  if (!candidate) return undefined;
  const normalizedDigits = text.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
  // Preserve an explicitly supplied country-code plus, never infer one.
  return normalizedDigits.includes("+") ? `+${candidate}` : candidate;
}
