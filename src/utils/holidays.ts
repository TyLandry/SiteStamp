// Alberta general holidays: Employment Standards Code s.25(a)–(i).
// Optional days (Easter Monday, Heritage Day, Boxing Day, Sept 30) are not
// general holidays unless an employer designates them (s.25(k)), so they are
// not listed here. Sources: docs/payroll-rules.md.

import { toDateInput } from "@/utils/payPeriods";

export type GeneralHoliday = { date: string; name: string };

// Anonymous Gregorian algorithm (Meeus/Jones/Butcher)
function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// nth (1-based) given weekday (0 = Sunday) of a month
function nthWeekday(year: number, month: number, weekday: number, n: number) {
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month, 1 + offset + (n - 1) * 7);
}

export function albertaGeneralHolidays(year: number): GeneralHoliday[] {
  const easter = easterSunday(year);
  const goodFriday = new Date(year, easter.getMonth(), easter.getDate() - 2);

  // Victoria Day: the Monday before May 25
  const may24 = new Date(year, 4, 24);
  const victoria = new Date(year, 4, 24 - ((may24.getDay() + 6) % 7));

  // Canada Day moves to July 2 when July 1 is a Sunday (Holidays Act, Canada)
  const july1 = new Date(year, 6, 1);
  const canadaDay = july1.getDay() === 0 ? new Date(year, 6, 2) : july1;

  return [
    { date: new Date(year, 0, 1), name: "New Year's Day" },
    { date: nthWeekday(year, 1, 1, 3), name: "Alberta Family Day" },
    { date: goodFriday, name: "Good Friday" },
    { date: victoria, name: "Victoria Day" },
    { date: canadaDay, name: "Canada Day" },
    { date: nthWeekday(year, 8, 1, 1), name: "Labour Day" },
    { date: nthWeekday(year, 9, 1, 2), name: "Thanksgiving Day" },
    { date: new Date(year, 10, 11), name: "Remembrance Day" },
    { date: new Date(year, 11, 25), name: "Christmas Day" },
  ].map((h) => ({ date: toDateInput(h.date), name: h.name }));
}

/** General holidays falling on or between two "YYYY-MM-DD" dates. */
export function holidaysBetween(start: string, end: string): GeneralHoliday[] {
  const years: number[] = [];
  for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) years.push(y);
  return years
    .flatMap(albertaGeneralHolidays)
    .filter((h) => h.date >= start && h.date <= end);
}
