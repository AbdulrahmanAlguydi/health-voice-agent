export type ReceptionDateWindow = { fromDate: string; toDate: string };
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Explicit local date windows: upper bound exclusive; next week starts on Saudi Sunday. */
export function resolveRelativeReceptionWindow(expression: string, today: string, horizonDays: number): ReceptionDateWindow | undefined {
  const normalized = expression.normalize("NFKC").toLowerCase().replace(/[أإآ]/g, "ا").replace(/[\u064b-\u065f\u0670\u0640]/g, "").replace(/[.،,!?؟]/g, "").replace(/\s+/g, " ").trim();
  const weekdays: Record<string,number>={sunday:0,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6,الاحد:0,الاثنين:1,الثلاثاء:2,الاربعاء:3,الخميس:4,الجمعة:5,السبت:6};
  const weekday=normalized.match(/^next (\w+)$/)?.[1]??normalized.match(/^(\S+) (?:الجاي|القادم|المقبل)$/)?.[1];
  if(weekday!==undefined&&weekdays[weekday]!==undefined){
    const offset=(weekdays[weekday]-new Date(`${today}T00:00:00Z`).getUTCDay()+7)%7||7;
    const fromDate=addDays(today,offset);return {fromDate,toDate:addDays(fromDate,1)};
  }
  const numerals=normalized.replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-0x660));
  const dayCount=numerals.match(/^(?:in|after) (\d{1,3}) days?$/)?.[1]??numerals.match(/^بعد (\d{1,3}) (?:يوم|ايام)$/)?.[1];
  if(dayCount!==undefined&&Number(dayCount)<=365){const fromDate=addDays(today,Number(dayCount));return {fromDate,toDate:addDays(fromDate,1)};}
  if (["earliest", "soonest", "first available", "اقرب موعد", "اول موعد متاح", "في اقرب وقت"].includes(normalized)) {
    return { fromDate: today, toDate: addDays(today, horizonDays + 1) };
  }
  if (["next week", "the next week", "الاسبوع الجاي", "الاسبوع القادم", "الاسبوع المقبل"].includes(normalized)) {
    const weekDay = new Date(`${today}T00:00:00Z`).getUTCDay();
    const fromDate = addDays(today, 7 - weekDay);
    return { fromDate, toDate: addDays(fromDate, 7) };
  }
  if (["in two weeks", "after two weeks", "in 2 weeks", "after 2 weeks", "بعد اسبوعين"].includes(normalized)) {
    const fromDate = addDays(today, 14);
    return { fromDate, toDate: addDays(fromDate, 7) };
  }
  return undefined;
}
