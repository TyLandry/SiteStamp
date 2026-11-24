// Alberta minimum wage, Employment Standards Regulation (AR 14/1997) s.9,
// current as of January 1, 2026 (accessed 2026-11-23). The database repeats
// these two numbers in ss_minimum_wage(); change both together.
//  * s.9(1)(a)(iii): $15.00 per hour
//  * s.9(1)(a.1): $13.00 per hour for an employee under 18 enrolled in an
//    educational institution, for work during a school break and for the
//    first 28 hours of a work week outside a school break
//  * s.9(3): school-break hours don't count toward those 28 hours
// Subcontractors aren't employees, so none of this applies to them.

import { toDateInput } from "@/utils/payPeriods";

export const MINIMUM_WAGE = 15;
export const STUDENT_MINIMUM_WAGE = 13;
export const STUDENT_WEEKLY_HOURS = 28;

/** Today's date in Alberta, "YYYY-MM-DD", for server code (servers usually run in UTC). */
export function albertaToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Edmonton" });
}

/** The student rate can be used on this date ("YYYY-MM-DD"). */
export function studentRateApplies(studentRateUntil: string | null | undefined, date: string) {
  return !!studentRateUntil && date < studentRateUntil;
}

/** The lowest wage that can be saved for an employee today. */
export function lowestAllowedWage(studentRateUntil: string | null | undefined, today = toDateInput(new Date())) {
  return studentRateApplies(studentRateUntil, today) ? STUDENT_MINIMUM_WAGE : MINIMUM_WAGE;
}

export type DaySplit = { date: string; regular: number; overtime: number };

/**
 * Extra pay so every hour meets the minimum wage, for one employee and pay
 * period. `days` must start at the beginning of the work week containing the
 * period start (so the 28 hours count from the week's start) and be in date
 * order; only days inside the period are paid. Within a day, regular hours
 * come before overtime hours. Overtime hours are topped up at the overtime
 * multiplier, since overtime pay is a multiple of the wage rate.
 * `schoolBreak`: the employer marked this period as a school break, so the
 * student rate covers every hour and none count toward the 28 (s.9(3)).
 */
export function minimumWageTopUp(opts: {
  days: DaySplit[];
  periodStart: string;
  periodEnd: string;
  wage: number;
  overtimeMultiplier: number;
  studentRateUntil: string | null;
  schoolBreak: boolean;
  weekOf: (date: string) => string;
}) {
  const { days, periodStart, periodEnd, wage, overtimeMultiplier, studentRateUntil, schoolBreak, weekOf } = opts;
  let week = "";
  let counted = 0; // student hours so far this work week, outside school breaks
  let regularAmount = 0;
  let overtimeAmount = 0;
  let studentHours = 0; // hours paid at the student minimum
  let fullHours = 0; // hours that needed the full minimum
  // Regular-hour top-up per day: it's wages, so vacation pay is earned on it
  const regularByDate: Record<string, number> = {};

  for (const d of days) {
    const w = weekOf(d.date);
    if (w !== week) {
      week = w;
      counted = 0;
    }
    const inPeriod = d.date >= periodStart && d.date <= periodEnd;
    const student = studentRateApplies(studentRateUntil, d.date);
    for (const [hours, multiplier] of [
      [d.regular, 1],
      [d.overtime, overtimeMultiplier],
    ] as const) {
      if (hours <= 0) continue;
      let atStudent = 0;
      if (student && schoolBreak) {
        atStudent = hours;
      } else if (student) {
        atStudent = Math.min(hours, Math.max(0, STUDENT_WEEKLY_HOURS - counted));
        counted += hours;
      }
      const atFull = hours - atStudent;
      if (!inPeriod) continue;
      const extra =
        atStudent * Math.max(0, STUDENT_MINIMUM_WAGE - wage) * multiplier +
        atFull * Math.max(0, MINIMUM_WAGE - wage) * multiplier;
      if (multiplier === 1) {
        regularAmount += extra;
        regularByDate[d.date] = (regularByDate[d.date] ?? 0) + extra;
      } else {
        overtimeAmount += extra;
      }
      if (wage < STUDENT_MINIMUM_WAGE) studentHours += atStudent;
      if (wage < MINIMUM_WAGE) fullHours += atFull;
    }
  }

  const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const r = round(regularAmount);
  const o = round(overtimeAmount);
  return {
    regularAmount: r,
    overtimeAmount: o,
    amount: round(r + o),
    studentHours: round(studentHours),
    fullHours: round(fullHours),
    regularByDate,
  };
}

export function minimumWageMessage(studentRateUntil: string | null | undefined) {
  return studentRateApplies(studentRateUntil, toDateInput(new Date()))
    ? `The wage can't be below $${STUDENT_MINIMUM_WAGE.toFixed(2)}/h, Alberta's minimum for students under 18.`
    : `The wage can't be below $${MINIMUM_WAGE.toFixed(2)}/h, Alberta's minimum wage.`;
}
