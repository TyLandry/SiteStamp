// Builds the pay stubs for one pay run: hours → earnings (regular, overtime,
// general holiday, vacation) → deductions → net.
// Used by the PayRuns screen when a draft is created, opened or recalculated.
// Every input that decided an amount is saved on the stub (details) so the
// result can be reviewed later. Rules and sources: docs/payroll-rules.md.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type PaySettings,
  DEFAULT_PAY_SETTINGS,
  addDays,
  getPeriod,
  parseLocalDate,
  toDateInput,
} from "@/utils/payPeriods";
import {
  type OvertimeSettings,
  DEFAULT_OVERTIME_SETTINGS,
  splitHours,
  startOfWorkWeek,
} from "@/utils/overtime";
import {
  type FederalRates,
  type ProvincialRates,
  calculatePayroll,
  periodsPerYear,
  round2,
} from "@/utils/payroll";
import type { Deduction, StubDeduction } from "@/utils/deductions";
import { holidaysBetween } from "@/utils/holidays";
import {
  type AdwPeriod,
  type EsCategory,
  type PayTiming,
  CONSTRUCTION_HOLIDAY_RATE,
  CONSTRUCTION_VACATION_RATE,
  HOLIDAY_ELIGIBILITY_DAYS,
  HOLIDAY_PREMIUM,
  addMonths,
  adwWindow,
  averageDailyWage,
  generalVacationRate,
  holidayWorkDays,
  hoursOn,
  localDate,
  nextAnniversary,
  weeksWorkedSameDay,
} from "@/utils/leave";
import { fetchAll } from "@/utils/supabase/fetchAll";
import {
  MINIMUM_WAGE,
  STUDENT_MINIMUM_WAGE,
  minimumWageTopUp,
  studentRateApplies,
} from "@/utils/minimumWage";

/** Stubs built by this version of the rules. Older stubs have NULL. */
export const CALC_VERSION = 2;

export type OrgSettings = PaySettings & OvertimeSettings & { province: string };

export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  ...DEFAULT_PAY_SETTINGS,
  ...DEFAULT_OVERTIME_SETTINGS,
  province: "AB",
};

export type PayRun = {
  id: string;
  org_id: string;
  period_start: string; // "YYYY-MM-DD"
  period_end: string;
  pay_date: string;
  status: "draft" | "finalized";
  finalized_at: string | null;
};

export type StubRow = {
  pay_run_id: string;
  org_id: string;
  profile_id: string;
  employee_type: string;
  pay_date: string;
  period_start: string;
  period_end: string;
  regular_hours: number;
  overtime_hours: number;
  hourly_wage: number;
  overtime_multiplier: number;
  gross: number;
  cpp: number;
  cpp2: number;
  ei: number;
  federal_tax: number;
  provincial_tax: number;
  other_deductions: StubDeduction[];
  other_deductions_total: number;
  gst: number;
  net_pay: number;
  employer_cpp: number;
  employer_cpp2: number;
  employer_ei: number;
  calc_version: number;
  general_holiday_pay: number | null;
  holiday_pay_earned: number | null;
  holiday_pay_paid: number | null;
  vacation_pay_earned: number | null;
  vacation_pay_paid: number | null;
  details: Record<string, unknown>;
};

/** Employer decisions for one general holiday (pay_run_inputs.holiday_overrides). */
export type HolidayOverride = {
  eligible?: boolean | null;
  normal_work_day?: boolean | null;
  not_entitled?: boolean;
};

export type PayRunInput = {
  pay_run_id: string;
  profile_id: string;
  org_id: string;
  vacation_payout: number;
  vacation_payout_on_leave: boolean;
  holiday_payout: number;
  holiday_overrides: Record<string, HolidayOverride>;
  /** The whole period is a school break for a student (student minimum on every hour). */
  school_break: boolean;
};

export type EmployerProfile = {
  org_id: string;
  legal_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  phone: string | null;
  email: string | null;
  cra_payroll_account: string | null;
  default_es_category: EsCategory | null;
  holiday_average_period: AdwPeriod;
};

export type EmployeePaySettings = {
  profile_id: string;
  org_id: string;
  employment_start_date: string | null;
  es_category: EsCategory | null;
  vacation_pay_timing: PayTiming;
  holiday_pay_timing: PayTiming;
};

/** What a pay stub shows as the employer (no payroll account number). */
export type EmployerSnapshot = {
  name: string;
  trading_name: string | null;
  address: string[];
  phone: string | null;
  email: string | null;
};

export type HolidayResult = {
  date: string;
  name: string;
  work_days_12_months: number;
  eligible: boolean;
  eligible_overridden: boolean;
  weeks_worked_of_9: number;
  normal_work_day: boolean;
  normal_overridden: boolean;
  not_entitled: boolean;
  worked_hours: number;
  history_incomplete: boolean;
  average_daily_wage: {
    period_start: string;
    period_end: string;
    wages: number;
    regular_hours: number;
    days: number;
    amount: number;
  } | null;
  premium: { hours: number; rate: number; amount: number } | null;
  pay: number;
};

export type PercentPay = {
  timing: PayTiming;
  wages_base: number;
  earned: number;
  payout: number;
  paid: number;
  balance_before: number;
  balance_after: number;
};

export type VacationPay = PercentPay & {
  category: EsCategory;
  earned_on_wages: number; // this period's wages × rate, before the s.43 amount
  start_date: string | null;
  segments: { rate: number; wages: number }[];
  deemed_wages: number; // Code s.43
  deemed_rate: number | null;
};

/** Per-employee view the review screen needs, including people with no stub. */
export type EmployeeReview = {
  profile_id: string;
  name: string;
  category: EsCategory | null;
  vacation: VacationPay | null;
  holiday_pct: PercentPay | null;
  holidays: HolidayResult[];
  input: PayRunInput | null;
  has_stub: boolean;
  /** Set when the student minimum wage matters this period (wage under $15). */
  student: { rate_until: string; wage: number; school_break: boolean } | null;
};

export type BuildResult = { stubs: StubRow[]; warnings: string[]; review: EmployeeReview[] };

const GST_RATE = 0.05;

// TD1 claim amounts. Default is the basic personal amounts (null = basic).
// "zero" is for people with a second job who claim nothing here.
// "custom" uses the totals from their paper TD1 and TD1AB forms.
export function td1Claims(p: {
  td1_mode?: string | null;
  tax_claim_amount?: number | string | null;
  tax_claim_provincial?: number | string | null;
}): { mode: string; federal: number | null; provincial: number | null } {
  const mode = p.td1_mode ?? "basic";
  if (mode === "zero") return { mode, federal: 0, provincial: 0 };
  if (mode === "custom") {
    return {
      mode,
      federal: p.tax_claim_amount != null ? Number(p.tax_claim_amount) : null,
      provincial: p.tax_claim_provincial != null ? Number(p.tax_claim_provincial) : null,
    };
  }
  return { mode: "basic", federal: null, provincial: null };
}

export async function loadOrgSettings(supabase: SupabaseClient): Promise<OrgSettings> {
  const { data } = await supabase
    .from("org_settings")
    .select(
      "pay_frequency, period_anchor_date, overtime_enabled, overtime_daily_hours, overtime_weekly_hours, overtime_multiplier, work_week_start, province"
    )
    .maybeSingle();
  return data ? { ...DEFAULT_ORG_SETTINGS, ...data } : DEFAULT_ORG_SETTINGS;
}

export const EMPLOYER_PROFILE_FIELDS =
  "org_id, legal_name, address_line1, address_line2, city, province, postal_code, phone, email, cra_payroll_account, default_es_category, holiday_average_period";

export const PAY_SETTINGS_FIELDS =
  "profile_id, org_id, employment_start_date, es_category, vacation_pay_timing, holiday_pay_timing";

/** The employer block for stubs. Never invents anything that isn't saved. */
export function employerSnapshot(orgName: string | null, p: EmployerProfile | null): EmployerSnapshot | null {
  const legal = p?.legal_name?.trim() || null;
  const trading = orgName?.trim() || null;
  const name = legal ?? trading;
  if (!name) return null;
  const cityLine = [p?.city, p?.province].filter(Boolean).join(", ");
  const address = [
    p?.address_line1,
    p?.address_line2,
    [cityLine, p?.postal_code].filter(Boolean).join("  "),
  ]
    .map((l) => l?.trim())
    .filter((l): l is string => !!l);
  return {
    name,
    trading_name: legal && trading && trading !== legal ? trading : null,
    address,
    phone: p?.phone?.trim() || null,
    email: p?.email?.trim() || null,
  };
}

// Latest rates that took effect on or before the pay date
export async function loadRates(supabase: SupabaseClient, jurisdiction: string, payDate: string) {
  const { data, error } = await supabase
    .from("tax_rates")
    .select("data")
    .eq("jurisdiction", jurisdiction)
    .lte("effective_from", payDate)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`No ${jurisdiction} tax rates set up for ${payDate}.`);
  return data.data;
}

type Entry = { id: string; profile_id: string; clock_in: string; clock_out: string | null };

type BalanceRow = {
  profile_id: string;
  vacation_pay_earned: number | null;
  vacation_pay_paid: number | null;
  holiday_pay_earned: number | null;
  holiday_pay_paid: number | null;
  other_deductions: StubDeduction[] | null;
};

type YtdRow = {
  profile_id: string;
  gross: number;
  cpp: number;
  cpp2: number;
  ei: number;
  details: Record<string, unknown> | null;
};

const num = (v: unknown) => (v == null ? 0 : Number(v));

function money(n: number) {
  return n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

export async function buildStubs(
  supabase: SupabaseClient,
  run: PayRun,
  settings: OrgSettings
): Promise<BuildResult> {
  const warnings: string[] = [];
  const start = parseLocalDate(run.period_start);
  const end = parseLocalDate(run.period_end);
  const P = periodsPerYear(settings.pay_frequency);

  const fed = (await loadRates(supabase, "CA", run.pay_date)) as FederalRates;
  const prov = (await loadRates(supabase, settings.province, run.pay_date)) as ProvincialRates;

  const holidays = holidaysBetween(run.period_start, run.period_end);

  // Look back to the start of the work week so weekly overtime is right, and
  // far enough for holiday eligibility (Code s.26(1): 12 months), including for
  // earlier holidays inside a 4-week average daily wage window (so 14 months)
  const weekStart = startOfWorkWeek(start, settings.work_week_start);
  let from = weekStart < start ? weekStart : start;
  // Holidays in the overtime look-back days (end of the previous period): hours
  // paid at 1.5× there don't count toward this week's overtime either (s.33)
  const lookbackHolidays = holidaysBetween(toDateInput(from), toDateInput(addDays(start, -1)));
  const firstHoliday = lookbackHolidays[0] ?? holidays[0];
  if (firstHoliday) {
    const holidayFrom = startOfWorkWeek(parseLocalDate(addMonths(firstHoliday.date, -14)), settings.work_week_start);
    if (holidayFrom < from) from = holidayFrom;
  }
  const to = addDays(end, 1);

  const yearStart = `${run.pay_date.slice(0, 4)}-01-01`;

  const [peopleRes, payRes, employerRes, orgRes, deductionsRes, inputsRes, draftsRes, firstEntryRes] =
    await Promise.all([
      supabase
        .from("profiles")
        .select(
          "id, full_name, hourly_wage, employee_type, status, extra_tax_per_pay, gst_number, td1_mode, tax_claim_amount, tax_claim_provincial, student_rate_until"
        )
        .eq("role", "employee")
        .order("full_name"),
      supabase.from("employee_pay_settings").select(PAY_SETTINGS_FIELDS),
      supabase.from("employer_profiles").select(EMPLOYER_PROFILE_FIELDS).eq("org_id", run.org_id).maybeSingle(),
      supabase.from("orgs").select("name").eq("id", run.org_id).maybeSingle(),
      supabase
        .from("employee_deductions")
        .select("*")
        .eq("active", true)
        .order("created_at"),
      supabase
        .from("pay_run_inputs")
        .select("pay_run_id, profile_id, org_id, vacation_payout, vacation_payout_on_leave, holiday_payout, holiday_overrides, school_break")
        .eq("pay_run_id", run.id),
      supabase
        .from("pay_runs")
        .select("id, period_start, period_end")
        .eq("status", "draft")
        .neq("id", run.id),
      holidays.length > 0
        ? supabase.from("time_entries").select("clock_in").order("clock_in").limit(1).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

  const err =
    peopleRes.error ??
    payRes.error ??
    employerRes.error ??
    orgRes.error ??
    deductionsRes.error ??
    inputsRes.error ??
    draftsRes.error ??
    firstEntryRes.error;
  if (err) throw new Error(err.message);

  const [entries, ytdRows, balanceRows] = await Promise.all([
    fetchAll<Entry>((a, b) =>
      supabase
        .from("time_entries")
        .select("id, profile_id, clock_in, clock_out")
        .gte("clock_in", from.toISOString())
        .lt("clock_in", to.toISOString())
        .order("id")
        .range(a, b)
    ),
    // Year-to-date totals from other FINALIZED runs this calendar year
    fetchAll<YtdRow>((a, b) =>
      supabase
        .from("pay_stubs")
        .select("profile_id, gross, cpp, cpp2, ei, details, pay_runs!inner(status)")
        .eq("pay_runs.status", "finalized")
        .gte("pay_date", yearStart)
        .lte("pay_date", run.pay_date)
        .neq("pay_run_id", run.id)
        .order("id")
        .range(a, b)
    ),
    // Running balances (vacation pay, holiday pay, tool loans): all FINALIZED runs
    fetchAll<BalanceRow>((a, b) =>
      supabase
        .from("pay_stubs")
        .select(
          "profile_id, vacation_pay_earned, vacation_pay_paid, holiday_pay_earned, holiday_pay_paid, other_deductions, pay_runs!inner(status)"
        )
        .eq("pay_runs.status", "finalized")
        .neq("pay_run_id", run.id)
        .order("id")
        .range(a, b)
    ),
  ]);

  const employer = (employerRes.data as EmployerProfile | null) ?? null;
  const orgName = (orgRes.data as { name?: string | null } | null)?.name ?? null;
  const snapshot = employerSnapshot(orgName, employer);
  const adwPeriod: AdwPeriod = employer?.holiday_average_period ?? "preceding_4_weeks";
  const firstRecord = firstEntryRes.data ? localDate((firstEntryRes.data as { clock_in: string }).clock_in) : null;

  const paySettings = new Map(
    ((payRes.data ?? []) as EmployeePaySettings[]).map((s) => [s.profile_id, s])
  );
  const inputs = new Map(((inputsRes.data ?? []) as PayRunInput[]).map((i) => [i.profile_id, i]));
  const deductions = (deductionsRes.data ?? []) as Deduction[];

  const otherDrafts = (draftsRes.data ?? []) as { period_start: string; period_end: string }[];
  if (otherDrafts.length > 0) {
    warnings.push(
      `There ${otherDrafts.length === 1 ? "is another draft pay run" : `are ${otherDrafts.length} other draft pay runs`}. Vacation pay, holiday pay and tool loan balances only count finalized runs, so finalize runs in date order and recalculate the later ones.`
    );
  }

  if (holidays.length > 0) {
    warnings.push(
      `${holidays.map((h) => h.name).join(" and ")} ${holidays.length === 1 ? "is" : "are"} in this period. Holiday pay below was worked out from clock records. Under Code s.26(2) someone isn't entitled if they skipped work they were scheduled for on the holiday, or missed their last scheduled day before or first after it without your OK. Check each person under "Holiday pay".`
    );
  }

  // Finalized history per person
  const ytd = new Map<
    string,
    { gross: number; cpp: number; cpp2: number; ei: number; bonus: number; bonusF5: number; bonusCpp: number; bonusEi: number }
  >();
  for (const s of ytdRows) {
    const t = ytd.get(s.profile_id) ?? { gross: 0, cpp: 0, cpp2: 0, ei: 0, bonus: 0, bonusF5: 0, bonusCpp: 0, bonusEi: 0 };
    t.gross += num(s.gross);
    t.cpp += num(s.cpp);
    t.cpp2 += num(s.cpp2);
    t.ei += num(s.ei);
    const tax = (s.details?.tax ?? null) as Record<string, unknown> | null;
    if (tax) {
      t.bonus += num(tax.bonus_amount);
      t.bonusF5 += num(tax.bonus_f5);
      t.bonusCpp += num(tax.bonus_cpp);
      t.bonusEi += num(tax.bonus_ei);
    }
    ytd.set(s.profile_id, t);
  }

  const balances = new Map<string, { vacation: number; holiday: number }>();
  const loanPaid = new Map<string, number>();
  for (const s of balanceRows) {
    const b = balances.get(s.profile_id) ?? { vacation: 0, holiday: 0 };
    b.vacation += num(s.vacation_pay_earned) - num(s.vacation_pay_paid);
    b.holiday += num(s.holiday_pay_earned) - num(s.holiday_pay_paid);
    balances.set(s.profile_id, b);
    for (const d of s.other_deductions ?? []) {
      if (d?.deduction_id) loanPaid.set(d.deduction_id, (loanPaid.get(d.deduction_id) ?? 0) + num(d.amount));
    }
  }

  const stubs: StubRow[] = [];
  const review: EmployeeReview[] = [];

  for (const p of peopleRes.data ?? []) {
    const name = p.full_name ?? "Unknown";
    const mine = entries.filter((e) => e.profile_id === p.id);

    const openShifts = mine.filter((e) => {
      const t = new Date(e.clock_in);
      return !e.clock_out && t >= start && t < to;
    }).length;
    if (openShifts > 0) {
      warnings.push(`${name} has ${openShifts} open shift(s) not included. Close them, then recalculate.`);
    }

    const isSub = p.employee_type === "subcontractor";
    const rules = isSub ? { ...settings, overtime_enabled: false } : settings;
    const multiplier = Number(settings.overtime_multiplier);

    if (isSub) {
      const split = splitHours(mine, rules, start, end);
      const regular = round2(split.regular);
      const overtime = round2(split.overtime);
      if (regular + overtime === 0) continue; // didn't work this period
      if (p.hourly_wage == null) {
        warnings.push(`${name} worked ${round2(regular + overtime)} hours but has no wage set. Set it on the Staff page, then recalculate.`);
        continue;
      }
      const wage = Number(p.hourly_wage);
      const gross = round2(regular * wage + overtime * wage * multiplier);
      const gst = p.gst_number ? round2(gross * GST_RATE) : 0;
      stubs.push({
        pay_run_id: run.id,
        org_id: run.org_id,
        profile_id: p.id,
        employee_type: p.employee_type,
        pay_date: run.pay_date,
        period_start: run.period_start,
        period_end: run.period_end,
        regular_hours: regular,
        overtime_hours: overtime,
        hourly_wage: wage,
        overtime_multiplier: multiplier,
        gross,
        cpp: 0,
        cpp2: 0,
        ei: 0,
        federal_tax: 0,
        provincial_tax: 0,
        other_deductions: [],
        other_deductions_total: 0,
        gst,
        net_pay: round2(gross + gst),
        employer_cpp: 0,
        employer_cpp2: 0,
        employer_ei: 0,
        calc_version: CALC_VERSION,
        general_holiday_pay: null,
        holiday_pay_earned: null,
        holiday_pay_paid: null,
        vacation_pay_earned: null,
        vacation_pay_paid: null,
        details: { full_name: name, gst_number: p.gst_number ?? null, employer: snapshot },
      });
      continue;
    }

    // ---------- Employee ----------
    const ps = paySettings.get(p.id) ?? null;
    const category: EsCategory | null = ps?.es_category ?? employer?.default_es_category ?? null;
    const startDate = ps?.employment_start_date ?? null;
    const input = inputs.get(p.id) ?? null;
    const overrides = input?.holiday_overrides ?? {};
    const wage = p.hourly_wage != null ? Number(p.hourly_wage) : null;
    const balance = balances.get(p.id) ?? { vacation: 0, holiday: 0 };
    const studentUntil: string | null = p.student_rate_until ?? null;
    // Holiday pay never uses a rate under the full minimum wage. For a student
    // paid less, this can be slightly more than the law requires (the 28-hour
    // split isn't applied to holiday hours), never less.
    const holidayRate = wage != null ? Math.max(wage, MINIMUM_WAGE) : null;

    // ---------- General holidays (Code ss.24.1–33; not for construction, Reg. s.45) ----------
    const holidayResults: HolidayResult[] = [];
    const premiumDates = new Set<string>(); // hours paid as holiday pay, not wages (s.33)
    if (category === "general" && holidays.length > 0 && holidayRate != null) {
      for (const h of holidays) {
        const ov = overrides[h.date] ?? {};
        const workDays = holidayWorkDays(mine, h.date);
        const autoEligible = workDays >= HOLIDAY_ELIGIBILITY_DAYS;
        const eligible = ov.eligible ?? autoEligible;
        const weeks = weeksWorkedSameDay(mine, h.date, settings.work_week_start);
        const normal = ov.normal_work_day ?? weeks >= 5;
        const workedHours = round2(hoursOn(mine, h.date));
        const notEntitled = ov.not_entitled === true;
        const historyIncomplete =
          !autoEligible &&
          ov.eligible == null &&
          firstRecord != null &&
          firstRecord > addMonths(h.date, -12) &&
          (startDate == null || startDate < firstRecord);

        let adw: HolidayResult["average_daily_wage"] = null;
        let premium: HolidayResult["premium"] = null;
        let pay = 0;
        if (eligible && !notEntitled) {
          if (normal) {
            const payPeriodStart = toDateInput(getPeriod(settings, parseLocalDate(h.date)).start);
            const window = adwWindow(h.date, adwPeriod, payPeriodStart);
            // Earlier holidays in the window that were paid at the premium aren't wages
            const earlierPaid = new Set(
              holidaysBetween(window.start, window.end)
                .filter((x) => holidayWorkDays(mine, x.date) >= HOLIDAY_ELIGIBILITY_DAYS)
                .map((x) => x.date)
            );
            const a = averageDailyWage({
              shifts: mine,
              wage: holidayRate,
              windowStart: window.start,
              windowEnd: window.end,
              overtime: rules,
              holidayPaidDates: earlierPaid,
            });
            adw = { period_start: window.start, period_end: window.end, wages: a.wages, regular_hours: a.regularHours, days: a.days, amount: a.amount };
            pay += a.amount;
            if (a.days === 0) {
              warnings.push(
                `${name}: ${h.name} counts as a normal work day, but they worked no days from ${window.start} to ${window.end}, so the average daily wage is $0. Check the holiday decision.`
              );
            }
          }
          if (workedHours > 0) {
            premium = {
              hours: workedHours,
              rate: round2(holidayRate * HOLIDAY_PREMIUM),
              amount: round2(workedHours * holidayRate * HOLIDAY_PREMIUM),
            };
            pay += premium.amount;
            premiumDates.add(h.date);
          }
        }
        if (historyIncomplete) {
          warnings.push(
            `${name} has ${workDays} recorded work days in the 12 months before ${h.name}, but SiteStamp only has clock records from ${firstRecord}. If they worked 30 or more days for you in that time, mark them eligible under "Holiday pay".`
          );
        }
        holidayResults.push({
          date: h.date,
          name: h.name,
          work_days_12_months: workDays,
          eligible,
          eligible_overridden: ov.eligible != null,
          weeks_worked_of_9: weeks,
          normal_work_day: normal,
          normal_overridden: ov.normal_work_day != null,
          not_entitled: notEntitled,
          worked_hours: workedHours,
          history_incomplete: historyIncomplete,
          average_daily_wage: adw,
          premium,
          pay: round2(pay),
        });
      }
    }
    if (category === "general" && wage != null) {
      for (const h of lookbackHolidays) {
        if (hoursOn(mine, h.date) > 0 && holidayWorkDays(mine, h.date) >= HOLIDAY_ELIGIBILITY_DAYS) {
          premiumDates.add(h.date);
        }
      }
    }
    const generalHolidayPay = round2(holidayResults.reduce((s, h) => s + h.pay, 0));
    const premiumHours = round2(holidayResults.reduce((s, h) => s + (h.premium?.hours ?? 0), 0));

    // ---------- Hours (holiday hours paid at 1.5× don't count toward overtime, s.33) ----------
    const worked = mine.filter((e) => !premiumDates.has(localDate(e.clock_in)));
    const split = splitHours(worked, rules, start, end);
    const regular = round2(split.regular);
    const overtime = round2(split.overtime);

    if (regular + overtime > 0 && wage == null) {
      warnings.push(`${name} worked ${round2(regular + overtime)} hours but has no wage set. Set it on the Staff page, then recalculate.`);
      continue;
    }
    const rate = wage ?? 0;

    // ---------- Alberta minimum wage (Regulation s.9) ----------
    // Days from the start of the work week, so a student's 28 hours count from Monday (or
    // whichever day the work week starts), even when the pay period starts mid-week
    const weekSplit = splitHours(worked, rules, weekStart < start ? weekStart : start, end);
    const minimum = minimumWageTopUp({
      days: weekSplit.days,
      periodStart: run.period_start,
      periodEnd: run.period_end,
      wage: rate,
      overtimeMultiplier: multiplier,
      studentRateUntil: studentUntil,
      schoolBreak: input?.school_break === true,
      weekOf: (date) => toDateInput(startOfWorkWeek(parseLocalDate(date), settings.work_week_start)),
    });
    const studentInPeriod = studentRateApplies(studentUntil, run.period_start);
    if (wage != null && regular + overtime > 0 && wage < (studentInPeriod ? STUDENT_MINIMUM_WAGE : MINIMUM_WAGE)) {
      warnings.push(
        `${name}'s wage (${money(wage)}/h) is below Alberta's minimum, so this run tops it up (${money(minimum.amount)}). Update their wage under Crew & wages.`
      );
    }

    // "Wages" for vacation and holiday pay: regular hours only (Code s.1(1)(x)),
    // including any minimum-wage top-up on those hours
    const regularWages = round2(regular * rate + minimum.regularAmount);

    if (category == null && regular + overtime > 0) {
      warnings.push(
        `Vacation and holiday pay weren't calculated for ${name}: choose whether they're a construction employee under Payroll → Employee pay setup, then recalculate.`
      );
    }

    // ---------- Vacation pay ----------
    let vacation: VacationPay | null = null;
    let vacationBonusPart = 0; // taxed with the bonus method (CRA)
    if (category != null) {
      const timing: PayTiming = ps?.vacation_pay_timing ?? "each_pay";
      const segments = new Map<number, number>();
      if (category === "construction") {
        segments.set(CONSTRUCTION_VACATION_RATE, regularWages);
      } else {
        if (!startDate && regularWages > 0) {
          warnings.push(
            `${name} has no employment start date, so vacation pay is 4%. If they've worked for you 5 years or more it should be 6%. Add the date under Payroll → Employee pay setup.`
          );
        }
        for (const d of split.days) {
          const r = generalVacationRate(d.date, startDate);
          segments.set(r, (segments.get(r) ?? 0) + d.regular * rate + (minimum.regularByDate[d.date] ?? 0));
        }
      }
      const earnedOnWages = round2([...segments].reduce((s, [r, w]) => s + r * w, 0));
      let earned = earnedOnWages;
      const before = round2(balance.vacation);
      const requested = round2(num(input?.vacation_payout));
      // each_pay: this period's vacation pay goes out now; a payout can also
      // clear an older balance. accrue: only what the employer chooses to pay.
      const available = timing === "each_pay" ? Math.max(before, 0) : Math.max(before + earned, 0);
      const payout = round2(Math.min(requested, available));
      if (requested > payout) {
        warnings.push(`${name}: asked to pay ${money(requested)} of vacation pay, but only ${money(payout)} is owed. Paid ${money(payout)}.`);
      }
      // Code s.43: vacation pay paid out is wages for next year's vacation pay.
      // Not applied to pay-every-cheque amounts (alberta.ca/vacation-pay) or
      // construction employees (Reg. s.45 replaces Division 6).
      let deemedRate: number | null = null;
      if (category === "general" && payout > 0) {
        deemedRate = startDate
          ? generalVacationRate(nextAnniversary(startDate, run.pay_date), startDate)
          : generalVacationRate(run.pay_date, null);
        earned = round2(earned + payout * deemedRate);
      }
      const paid = round2(timing === "each_pay" ? earned + payout : payout);
      vacation = {
        category,
        timing,
        start_date: startDate,
        wages_base: regularWages,
        segments: [...segments].map(([r, w]) => ({ rate: r, wages: round2(w) })),
        deemed_wages: category === "general" ? payout : 0,
        deemed_rate: deemedRate,
        earned_on_wages: earnedOnWages,
        earned,
        payout,
        paid,
        balance_before: before,
        balance_after: round2(before + earned - paid),
      };
      // CRA: vacation pay paid continuously, or without taking leave → bonus method
      const continuous = timing === "each_pay" ? round2(paid - payout) : 0;
      const lumpBonus = input?.vacation_payout_on_leave === false ? payout : 0;
      vacationBonusPart = round2(continuous + lumpBonus);
    }

    // ---------- Construction general holiday pay: 3.6% (Reg. ss.46–47) ----------
    let holidayPct: PercentPay | null = null;
    let holidayBonusPart = 0;
    if (category === "construction") {
      const timing: PayTiming = ps?.holiday_pay_timing ?? "each_pay";
      const earned = round2(CONSTRUCTION_HOLIDAY_RATE * regularWages);
      const before = round2(balance.holiday);
      const requested = round2(num(input?.holiday_payout));
      const available = timing === "each_pay" ? Math.max(before, 0) : Math.max(before + earned, 0);
      const payout = round2(Math.min(requested, available));
      if (requested > payout) {
        warnings.push(`${name}: asked to pay ${money(requested)} of holiday pay, but only ${money(payout)} is owed. Paid ${money(payout)}.`);
      }
      const paid = round2(timing === "each_pay" ? earned + payout : payout);
      holidayPct = {
        timing,
        wages_base: regularWages,
        earned,
        payout,
        paid,
        balance_before: before,
        balance_after: round2(before + earned - paid),
      };
      // A lump payout of saved-up holiday pay is a non-periodic payment
      holidayBonusPart = payout;
    }

    // ---------- Deadlines for money that's still owed ----------
    const vacOwed = vacation?.balance_after ?? 0;
    const holOwed = holidayPct?.balance_after ?? 0;
    if (p.status === "terminated" && (vacOwed > 0 || holOwed > 0)) {
      warnings.push(
        `${name}'s employment has ended and ${money(vacOwed + holOwed)} of vacation/holiday pay is still owed. It must be paid within the time in Code s.8(2). Enter it as a payout.`
      );
    } else if (category === "construction" && (vacOwed > 0 || holOwed > 0) && run.pay_date.slice(5, 7) === "12") {
      warnings.push(
        `${name} is still owed ${money(vacOwed + holOwed)} of vacation/holiday pay. Construction employees must be paid it on or before December 31 (Regulation ss.47, 49).`
      );
    }

    const reviewEntry: EmployeeReview = {
      profile_id: p.id,
      name,
      category,
      vacation,
      holiday_pct: holidayPct,
      holidays: holidayResults,
      input,
      has_stub: false,
      student:
        wage != null && wage < MINIMUM_WAGE && studentRateApplies(studentUntil, run.period_start)
          ? { rate_until: studentUntil!, wage, school_break: input?.school_break === true }
          : null,
    };
    review.push(reviewEntry);

    // ---------- Gross ----------
    const base = round2(regular * rate + overtime * rate * multiplier);
    const vacationPaid = vacation?.paid ?? 0;
    const holidayPctPaid = holidayPct?.paid ?? 0;
    const gross = round2(base + minimum.amount + generalHolidayPay + holidayPctPaid + vacationPaid);
    if (gross <= 0) continue; // nothing earned or paid out this period

    const earnings: { code: string; label: string; hours?: number; rate?: number; amount: number }[] = [];
    const regularPay = round2(regular * rate);
    earnings.push({ code: "regular", label: "Regular", hours: regular, rate, amount: regularPay });
    if (overtime > 0) {
      earnings.push({
        code: "overtime",
        label: `Overtime (${multiplier}×)`,
        hours: overtime,
        rate: round2(rate * multiplier),
        amount: round2(base - regularPay),
      });
    }
    if (minimum.amount > 0) {
      earnings.push({
        code: "minimum_wage",
        label:
          minimum.studentHours > 0
            ? `Minimum wage top-up ($${STUDENT_MINIMUM_WAGE.toFixed(2)} student / $${MINIMUM_WAGE.toFixed(2)})`
            : `Minimum wage top-up (to $${MINIMUM_WAGE.toFixed(2)}/h)`,
        amount: minimum.amount,
      });
    }
    for (const h of holidayResults) {
      if (h.average_daily_wage && h.average_daily_wage.amount > 0) {
        earnings.push({ code: "holiday_adw", label: `${h.name}: holiday pay (average daily wage)`, amount: h.average_daily_wage.amount });
      }
      if (h.premium) {
        earnings.push({
          code: "holiday_worked",
          label: `${h.name}: hours worked (${HOLIDAY_PREMIUM}×)`,
          hours: h.premium.hours,
          rate: h.premium.rate,
          amount: h.premium.amount,
        });
      }
    }
    if (holidayPctPaid > 0) {
      earnings.push({ code: "holiday_pct", label: "General holiday pay (3.6%)", amount: holidayPctPaid });
    }
    if (vacationPaid > 0) {
      earnings.push({ code: "vacation", label: "Vacation pay", amount: vacationPaid });
    }

    // ---------- Deductions ----------
    const mineDeductions = deductions.filter(
      (d) =>
        d.profile_id === p.id &&
        (d.starts_on == null || d.starts_on <= run.period_end) &&
        (d.ends_on == null || d.ends_on >= run.period_start)
    );
    // Union dues first: they're the only ones that change the tax
    mineDeductions.sort((a, b) => Number(b.kind === "union_dues") - Number(a.kind === "union_dues"));
    const wanted: { d: Deduction; amount: number; remaining: number | null }[] = [];
    for (const d of mineDeductions) {
      let amount = round2(num(d.amount_per_pay));
      let remaining: number | null = null;
      if (d.kind === "tool_loan" && d.loan_total != null) {
        remaining = round2(num(d.loan_total) - (loanPaid.get(d.id) ?? 0));
        if (remaining <= 0) {
          warnings.push(`${name}'s ${d.name} is fully repaid. Deactivate it under Payroll → Employee pay setup.`);
          continue;
        }
        amount = Math.min(amount, remaining);
      }
      if (!d.authorization_on_file) {
        warnings.push(
          `${name}'s ${d.name} has no written authorization or collective agreement recorded. Alberta only allows it with one (Code s.12(2)).`
        );
      }
      wanted.push({ d, amount, remaining });
    }

    const y = ytd.get(p.id) ?? { gross: 0, cpp: 0, cpp2: 0, ei: 0, bonus: 0, bonusF5: 0, bonusCpp: 0, bonusEi: 0 };
    const extraTax = round2(Number(p.extra_tax_per_pay ?? 0));
    const claims = td1Claims(p);
    const bonusPart = round2(Math.min(vacationBonusPart + holidayBonusPart, gross));

    // Take what fits in net pay. Union dues lower tax, so if they don't all
    // fit, recalculate tax with what was actually taken (a few passes settle it).
    let unionDues = round2(wanted.filter((w) => w.d.kind === "union_dues").reduce((s, w) => s + w.amount, 0));
    let calc = calculatePayroll(
      {
        gross,
        bonus: bonusPart,
        periodsPerYear: P,
        federalClaim: claims.federal,
        provincialClaim: claims.provincial,
        taxDeductibleDeductions: unionDues,
        extraTax,
        ytd: {
          cpp: y.cpp,
          cpp2: y.cpp2,
          ei: y.ei,
          pensionableEarnings: y.gross,
          bonus: y.bonus,
          bonusF5: y.bonusF5,
          bonusCpp: y.bonusCpp,
          bonusEi: y.bonusEi,
        },
      },
      fed,
      prov
    );
    let taken: StubDeduction[] = [];
    for (let pass = 0; pass < 3; pass++) {
      let room = round2(gross - calc.cpp - calc.cpp2 - calc.ei - calc.incomeTax);
      taken = [];
      for (const w of wanted) {
        const amount = round2(Math.max(0, Math.min(w.amount, room)));
        room = round2(room - amount);
        if (amount <= 0) continue;
        taken.push({
          deduction_id: w.d.id,
          kind: w.d.kind,
          name: w.d.name,
          amount,
          tax_treatment: w.d.tax_treatment,
          t4_box: w.d.t4_box,
          ...(w.d.kind === "tool_loan" && w.d.loan_total != null
            ? { loan_total: num(w.d.loan_total), loan_remaining_after: round2((w.remaining ?? 0) - amount) }
            : {}),
        });
      }
      const takenDues = round2(taken.filter((t) => t.kind === "union_dues").reduce((s, t) => s + t.amount, 0));
      if (takenDues === unionDues) break;
      unionDues = takenDues;
      calc = calculatePayroll(
        {
          gross,
          bonus: bonusPart,
          periodsPerYear: P,
          federalClaim: claims.federal,
          provincialClaim: claims.provincial,
          taxDeductibleDeductions: unionDues,
          extraTax,
          ytd: {
            cpp: y.cpp,
            cpp2: y.cpp2,
            ei: y.ei,
            pensionableEarnings: y.gross,
            bonus: y.bonus,
            bonusF5: y.bonusF5,
            bonusCpp: y.bonusCpp,
            bonusEi: y.bonusEi,
          },
        },
        fed,
        prov
      );
    }
    for (const w of wanted) {
      const got = taken.find((t) => t.deduction_id === w.d.id)?.amount ?? 0;
      if (got < w.amount) {
        warnings.push(
          `${name}: only ${money(got)} of ${w.d.name} (${money(w.amount)}) could be taken without net pay going below $0.`
        );
      }
    }
    const deductionsTotal = round2(taken.reduce((s, t) => s + t.amount, 0));

    // Extra tax goes on the federal line; the provincial line is the remainder,
    // so federal + provincial always equals the rounded total exactly
    const federalTax = round2(calc.federalTax + extraTax);
    const provincialTax = round2(calc.incomeTax - federalTax);

    reviewEntry.has_stub = true;
    stubs.push({
      pay_run_id: run.id,
      org_id: run.org_id,
      profile_id: p.id,
      employee_type: p.employee_type,
      pay_date: run.pay_date,
      period_start: run.period_start,
      period_end: run.period_end,
      regular_hours: regular,
      overtime_hours: overtime,
      hourly_wage: rate,
      overtime_multiplier: multiplier,
      gross,
      cpp: calc.cpp,
      cpp2: calc.cpp2,
      ei: calc.ei,
      federal_tax: federalTax,
      provincial_tax: provincialTax,
      other_deductions: taken,
      other_deductions_total: deductionsTotal,
      gst: 0,
      net_pay: round2(gross - calc.cpp - calc.cpp2 - calc.ei - calc.incomeTax - deductionsTotal),
      employer_cpp: calc.employerCpp,
      employer_cpp2: calc.employerCpp2,
      employer_ei: calc.employerEi,
      calc_version: CALC_VERSION,
      general_holiday_pay: category === "general" ? generalHolidayPay : null,
      holiday_pay_earned: holidayPct ? holidayPct.earned : null,
      holiday_pay_paid: holidayPct ? holidayPct.paid : null,
      vacation_pay_earned: vacation ? vacation.earned : null,
      vacation_pay_paid: vacation ? vacation.paid : null,
      details: {
        full_name: name,
        employer: snapshot,
        province: settings.province,
        periods_per_year: P,
        td1_mode: claims.mode,
        federal_claim: claims.federal ?? "basic personal amount",
        provincial_claim: claims.provincial ?? "basic personal amount",
        extra_tax: extraTax,
        annual_taxable_income: calc.annualTaxableIncome,
        annual_federal_tax: calc.annualFederalTax,
        annual_provincial_tax: calc.annualProvincialTax,
        ytd_before: { gross: y.gross, cpp: y.cpp, cpp2: y.cpp2, ei: y.ei },
        es_category: category,
        minimum_wage: {
          student_rate_until: studentUntil,
          school_break: input?.school_break === true,
          regular_top_up: minimum.regularAmount,
          overtime_top_up: minimum.overtimeAmount,
          student_hours: minimum.studentHours,
          full_minimum_hours: minimum.fullHours,
        },
        earnings,
        holiday_hours_at_premium: premiumHours,
        holidays: holidayResults,
        vacation,
        holiday_pct: holidayPct,
        union_dues_for_tax: unionDues,
        tax: {
          bonus_amount: calc.bonus,
          bonus_tax: calc.bonusTax,
          bonus_f5: calc.bonusF5,
          bonus_cpp: calc.bonusCpp,
          bonus_ei: calc.bonusEi,
          bonus_flat_rate: calc.bonusFlatRate,
        },
      },
    });
  }

  return { stubs, warnings, review };
}
