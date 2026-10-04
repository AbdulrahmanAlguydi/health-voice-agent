function calendarDateInRiyadh(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addCalendarDays(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + amount));
  return value.toISOString().slice(0, 10);
}

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Resolve only common, unambiguous relative dates; callers handle anything else. */
export function normalizeCommonRelativeDate(value: string, now: Date = new Date()): string | undefined {
  const trimmed = value.trim();
  if (isIsoCalendarDate(trimmed)) return trimmed;

  const normalized = trimmed
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[.،,!?؟]/g, "")
    .replace(/\s+/g, " ");
  const today = calendarDateInRiyadh(now);

  if (["today", "اليوم"].includes(normalized)) return today;
  if (["tomorrow", "on tomorrow", "بكرة", "بكره", "غدا"].includes(normalized)) {
    return addCalendarDays(today, 1);
  }
  if (["the day after tomorrow", "day after tomorrow", "بعد غد", "بعد بكرة", "بعد بكره"].includes(normalized)) {
    return addCalendarDays(today, 2);
  }
  return undefined;
}
