import type { Language } from "./contracts";
import { formatAppointmentDateTime, expandArabicTimePeriod, riyadhMonth, riyadhYear } from "./appointmentDateTime";

const DAY = 86_400_000;
function civilDate(value: Date): Date {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Riyadh", calendar: "gregory", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(value);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
}
function addMonths(date: Date, months: number): Date {
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return first;
}
function unit(count: number, name: "day" | "week" | "month", language: Language): string {
  if (language === "en") return `${count} ${name}${count === 1 ? "" : "s"}`;
  const forms = { day: ["يوم", "يومين", "أيام"], week: ["أسبوع", "أسبوعين", "أسابيع"], month: ["شهر", "شهرين", "أشهر"] }[name];
  if (count === 1) return forms[0];
  if (count === 2) return forms[1];
  return `${new Intl.NumberFormat("ar-SA").format(count)} ${count <= 10 ? forms[2] : forms[0]}`;
}

export function appointmentLabels(value: string, language: Language, now = new Date()) {
  const date = new Date(value);
  const currentYear = Number(riyadhYear(now));
  const appointmentYear = Number(riyadhYear(date));
  const immediateJanuary = riyadhMonth(now) === "12" && riyadhMonth(date) === "01" && appointmentYear === currentYear + 1;
  const currentDay = civilDate(now);
  const targetDay = civilDate(date);
  const days = Math.round((targetDay.getTime() - currentDay.getTime()) / DAY);
  let relative: string;
  if (days === 0) relative = language === "ar" ? "اليوم" : "today";
  else if (days === 1) relative = language === "ar" ? "بكرة" : "tomorrow";
  else {
    let months = (targetDay.getUTCFullYear() - currentDay.getUTCFullYear()) * 12 + targetDay.getUTCMonth() - currentDay.getUTCMonth();
    if (addMonths(currentDay, months).getTime() > targetDay.getTime()) months--;
    const useMonths = days >= 28 && months > 0;
    const major = useMonths ? months : days >= 7 ? Math.floor(days / 7) : days;
    const remainder = useMonths ? Math.round((targetDay.getTime() - addMonths(currentDay, months).getTime()) / DAY) : days >= 7 ? days % 7 : 0;
    relative = `${language === "ar" ? "بعد" : "in"} ${unit(major, useMonths ? "month" : days >= 7 ? "week" : "day", language)}${remainder ? `${language === "ar" ? " و" : " and "}${unit(remainder, "day", language)}` : ""}`;
  }
  const hijri = new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en-GB", {
    timeZone: "Asia/Riyadh", calendar: "islamic-umalqura", weekday: "long", day: "numeric", month: "long", year: "numeric", era: "short", hour: "numeric", minute: "2-digit",
  });
  if (hijri.resolvedOptions().calendar !== "islamic-umalqura") throw new Error("Umm al-Qura calendar is unavailable");
  const time = expandArabicTimePeriod(new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en-GB", { timeZone: "Asia/Riyadh", hour: "numeric", minute: "2-digit" }).format(date), language);
  const spokenDate = new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en-GB", {
    timeZone: "Asia/Riyadh", calendar: "gregory", weekday: "long", day: "numeric", month: "long",
    ...(appointmentYear !== currentYear && !immediateJanuary ? { year: "numeric" as const } : {}),
  }).format(date);
  const spokenDateTime = formatAppointmentDateTime(value, language, now);
  return {
    spokenDateTime,
    spokenDate,
    spokenTime: time,
    spokenHijriDateTime: expandArabicTimePeriod(hijri.format(date), language),
    relativeDateTime: days < 0 ? spokenDateTime : `${relative}${language === "ar" ? " الساعة " : " at "}${time}`,
    relativeDays: days,
    relativeComputedOn: currentDay.toISOString().slice(0, 10),
  };
}
