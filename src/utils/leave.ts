// Alberta vacation pay and general holiday pay rules, as pure functions.
// Every rule cites its source; the full notes are in docs/payroll-rules.md.
//
// Two sets of rules exist:
//  * "construction": Employment Standards Regulation Part 4 (ss.44–50) for
//    construction employees. 6% vacation pay and 3.6% general holiday pay
//    on wages from the start of employment; these replace Code ss.26–33 and
//    the Code's vacation pay division (Reg. s.45).
//  * "general": Employment Standards Code ss.24.1–34.2, 41–43 for everyone else.

import { addDays, parseLocalDate, toDateInput } from "@/utils/payPeriods";
import { type OvertimeSettings, type Shift, splitHours, startOfWorkWeek } from "@/utils/overtime";
import { round2 } from "@/utils/payroll";

export type EsCategory = "construction" | "general";
export type PayTiming = "each_pay" | "accrue";

export const ES_CATEGORY_LABELS: Record<EsCategory, string> = {
  construction: "Construction employee",
  general: "Other employee",
};

export const CONSTRUCTION_VACATION_RATE = 0.06; // Reg. s.48
export const CONSTRUCTION_HOLIDAY_RATE = 0.036; // Reg. s.46
export const GENERAL_VACATION_RATE = 0.04; // Code s.34.2(a)
export const GENERAL_VACATION_RATE_5_YEARS = 0.06; // Code s.34.2(b)
export const HOLIDAY_ELIGIBILITY_DAYS = 30; // Code s.26(1)
export const HOLIDAY_PREMIUM = 1.5; // Code ss.29(1)(a)(ii), 30

/** Local "YYYY-MM-DD" of a timestamp. */
export function localDate(iso: string) {
  return toDateInput(new Date(iso));
}

/** Same calendar day n months later (or earlier, if n < 0). */
export function addMonths(date: string, n: number) {
  const d = parseLocalDate(date);
  return toDateInput(new Date(d.getFullYear(), d.getMonth() + n, d.getDate()));
}

// ---------------------------------------------------------------------------
// Vacation pay, general rules
// ---------------------------------------------------------------------------

/**
 * The day an employee becomes entitled to 3 weeks' vacation: 5 consecutive
 * years after the start of continuous employment (Code s.34(1)(b), s.36).
 * From this day their wages earn 6% (s.34.2(b); s.42(2)(b) applies 6% to
 * wages "from the date the employee last became entitled" to 3 weeks).
 */
export function fifthAnniversary(employmentStart: string) {
  return addMonths(employmentStart, 60);
}

/** Vacation pay rate for wages earned on `date`. Unknown start date → 4%. */
export function generalVacationRate(date: string, employmentStart: string | null) {
  if (!employmentStart) return GENERAL_VACATION_RATE;
  return date >= fifthAnniversary(employmentStart) ? GENERAL_VACATION_RATE_5_YEARS : GENERAL_VACATION_RATE;
}

/** First employment anniversary strictly after `date`. */
export function nextAnniversary(employmentStart: string, date: string) {
  const start = parseLocalDate(employmentStart);
  const after = parseLocalDate(date);
  let years = after.getFullYear() - start.getFullYear();
  let candidate = toDateInput(new Date(start.getFullYear() + years, start.getMonth(), start.getDate()));
  while (candidate <= date) {
    years += 1;
    candidate = toDateInput(new Date(start.getFullYear() + years, start.getMonth(), start.getDate()));
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Clock data helpers
// ---------------------------------------------------------------------------

/** Distinct local dates with a completed shift, between two dates inclusive. */
export function workedDates(shifts: Shift[], from: string, to: string) {
  const days = new Set<string>();
  for (const s of shifts) {
    if (!s.clock_out) continue;
    const d = localDate(s.clock_in);
    if (d >= from && d <= to) days.add(d);
  }
  return days;
}

/** Hours of completed shifts that started on a local date. */
export function hoursOn(shifts: Shift[], date: string) {
  let hours = 0;
  for (const s of shifts) {
    if (!s.clock_out || localDate(s.clock_in) !== date) continue;
    hours += (new Date(s.clock_out).getTime() - new Date(s.clock_in).getTime()) / 3600000;
  }
  return hours;
}

// ---------------------------------------------------------------------------
// General holidays, general rules
// ---------------------------------------------------------------------------

/** Code s.26(1): 30 work days or more in the 12 months preceding the holiday. */
export function holidayWorkDays(shifts: Shift[], holiday: string) {
  return workedDates(shifts, addMonths(holiday, -12), toDateInput(addDays(parseLocalDate(holiday), -1))).size;
}

/**
 * Code s.27(2): a normal work day if, in at least 5 of the 9 weeks before the
 * work week containing the holiday, the employee worked on the same weekday.
 */
export function weeksWorkedSameDay(shifts: Shift[], holiday: string, workWeekStart: number) {
  const h = parseLocalDate(holiday);
  const weekStart = startOfWorkWeek(h, workWeekStart);
  const offset = Math.round((h.getTime() - weekStart.getTime()) / 86400000);
  const worked = workedDates(
    shifts,
    toDateInput(addDays(weekStart, -63)),
    toDateInput(addDays(weekStart, -1))
  );
  let weeks = 0;
  for (let k = 1; k <= 9; k++) {
    if (worked.has(toDateInput(addDays(weekStart, -7 * k + offset)))) weeks += 1;
  }
  return weeks;
}

export type AdwPeriod = "preceding_4_weeks" | "preceding_pay_period";

export const ADW_PERIOD_LABELS: Record<AdwPeriod, string> = {
  preceding_4_weeks: "The 4 weeks just before the holiday",
  preceding_pay_period: "The 4 weeks ending on the last day of the pay period before the holiday",
};

/**
 * Code s.24.1: average daily wage = total wages in a 4-week period ÷ days
 * worked in it. "Wages" (s.1(1)(x)) excludes overtime pay, vacation pay and
 * general holiday pay, so it is regular hours × wage rate, leaving out hours
 * already paid as general holiday pay.
 */
export function averageDailyWage(opts: {
  shifts: Shift[];
  wage: number;
  windowStart: string;
  windowEnd: string;
  overtime: OvertimeSettings;
  /** Dates whose hours were paid as general holiday pay (not wages). */
  holidayPaidDates: Set<string>;
}) {
  const { shifts, wage, windowStart, windowEnd, overtime, holidayPaidDates } = opts;
  const counted = shifts.filter((s) => !holidayPaidDates.has(localDate(s.clock_in)));
  const split = splitHours(counted, overtime, parseLocalDate(windowStart), parseLocalDate(windowEnd));
  const regularHours = round2(split.regular);
  const wages = round2(split.regular * wage);
  const days = workedDates(shifts, windowStart, windowEnd).size;
  return { regularHours, wages, days, amount: days > 0 ? round2(wages / days) : 0 };
}

/** The 4-week window for the average daily wage (Code s.24.1(a) or (b)). */
export function adwWindow(holiday: string, period: AdwPeriod, payPeriodStartContainingHoliday: string) {
  const end =
    period === "preceding_pay_period"
      ? toDateInput(addDays(parseLocalDate(payPeriodStartContainingHoliday), -1))
      : toDateInput(addDays(parseLocalDate(holiday), -1));
  return { start: toDateInput(addDays(parseLocalDate(end), -27)), end };
}
