/** Demo caller metadata only; this is not identity verification or telephony. */
export function normalizeSimulatedCallingNumber(input: string): string | undefined {
  const normalized = input.trim().replace(/[٠-٩۰-۹]/g, (digit) =>
    String(digit.charCodeAt(0) - (digit >= "۰" ? 0x6f0 : 0x660)));
  if (!normalized) return undefined;
  const compact = normalized.replace(/[\s()\-]/g, "");
  const local = compact.startsWith("+966") ? `0${compact.slice(4)}` : compact;
  if (!/^05\d{8}$/.test(local)) {
    throw new Error("Enter a Saudi mobile with 10 digits starting with 05 (or +966 5…), or leave it blank.");
  }
  return local;
}
