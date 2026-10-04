import type { Language } from "./contracts";

export function riyadhYear(value: Date): string {
  return new Intl.DateTimeFormat("en", { timeZone: "Asia/Riyadh", calendar: "gregory", year: "numeric" }).format(value);
}

export function riyadhMonth(value: Date): string {
  return new Intl.DateTimeFormat("en", { timeZone: "Asia/Riyadh", calendar: "gregory", month: "2-digit" }).format(value);
}

export function expandArabicTimePeriod(text: string, language: Language): string {
  return language === "ar" ? text
    .replace(/((?:12|١٢):[0-9٠-٩]{2})\s+م(?=\s|$)/g, "$1 الظهر")
    .replace(/(^|\s)م(?=\s|$)/g, "$1مساءً")
    .replace(/(^|\s)ص(?=\s|$)/g, "$1صباحًا") : text;
}

// ISO timestamps remain the source of truth; this is only the spoken presentation.
export function formatAppointmentDateTime(value: string, language: Language, now = new Date()): string {
  const date = new Date(value);
  const currentYear = Number(riyadhYear(now));
  const appointmentYear = Number(riyadhYear(date));
  const immediateJanuary = riyadhMonth(now) === "12" && riyadhMonth(date) === "01" && appointmentYear === currentYear + 1;
  return expandArabicTimePeriod(new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en-GB", {
    timeZone: "Asia/Riyadh",
    calendar: "gregory",
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(appointmentYear !== currentYear && !immediateJanuary ? { year: "numeric" as const } : {}),
    hour: "numeric",
    minute: "2-digit",
  }).format(date), language);
}
