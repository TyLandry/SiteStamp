import { addDays, parseLocalDate, toDateInput } from "@/utils/payPeriods";

export type OvertimeSettings = {
  overtime_enabled: boolean;
  overtime_daily_hours: number | null;
  overtime_weekly_hours: number | null;
  overtime_multiplier: number;
  work_week_start: number; // 0 = Sunday, 1 = Monday ...
};

export const DEFAULT_OVERTIME_SETTINGS: OvertimeSettings = {
  overtime_enabled: true,
  overtime_daily_hours: 8,
  overtime_weekly_hours: 44,
  overtime_multiplier: 1.5,
  work_week_start: 1,
};

export type Shift = { clock_in: string; clock_out: string | null };

export function startOfWorkWeek(date: Date, weekStart: number) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = (day.getDay() - weekStart + 7) % 7;
  return addDays(day, -diff);
}

/**
 * Splits one person's completed shifts into regular and overtime hours,
 * counting only days inside [periodStart, periodEnd].
 *
 * Pass in shifts from the start of the work week that contains periodStart,
 * so weekly totals include days from the previous pay period.
 *
 * Going day by day, each day's regular hours are capped at the daily limit
 * and at whatever is left of the weekly limit. Everything else is overtime.
 * This works out to "daily or weekly overtime, whichever is greater."
 */
export function splitHours(
  shifts: Shift[],
  s: OvertimeSettings,
  periodStart: Date,
  periodEnd: Date
) {
  // Total hours per local day (a shift counts on the day it started)
  const byDay = new Map<string, number>();
  for (const sh of shifts) {
    if (!sh.clock_out) continue;
    const start = new Date(sh.clock_in);
    const hours = (new Date(sh.clock_out).getTime() - start.getTime()) / 3600000;
    const key = toDateInput(start);
    byDay.set(key, (byDay.get(key) ?? 0) + hours);
  }

  let regular = 0;
  let overtime = 0;
  let currentWeek = "";
  let weekRegular = 0;

  for (const key of [...byDay.keys()].sort()) {
    const day = parseLocalDate(key);
    const weekKey = toDateInput(startOfWorkWeek(day, s.work_week_start));
    if (weekKey !== currentWeek) {
      currentWeek = weekKey;
      weekRegular = 0;
    }

    const hours = byDay.get(key)!;
    let reg = hours;
    if (s.overtime_enabled) {
      if (s.overtime_daily_hours != null) {
        reg = Math.min(reg, Number(s.overtime_daily_hours));
      }
      if (s.overtime_weekly_hours != null) {
        reg = Math.min(reg, Math.max(0, Number(s.overtime_weekly_hours) - weekRegular));
      }
    }
    weekRegular += reg;

    if (day >= periodStart && day <= periodEnd) {
      regular += reg;
      overtime += hours - reg;
    }
  }

  return { regular, overtime };
}