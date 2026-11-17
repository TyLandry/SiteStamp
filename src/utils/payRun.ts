// Builds the pay stubs for one pay run: hours → gross → deductions → net.
// Used by the PayRuns screen when a draft is created or recalculated.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type PaySettings,
  DEFAULT_PAY_SETTINGS,
  addDays,
  parseLocalDate,
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
  other_deductions: unknown[];
  other_deductions_total: number;
  gst: number;
  net_pay: number;
  employer_cpp: number;
  employer_cpp2: number;
  employer_ei: number;
  details: Record<string, unknown>;
};

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

// Latest rates that took effect on or before the pay date
async function loadRates(supabase: SupabaseClient, jurisdiction: string, payDate: string) {
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

export async function buildStubs(
  supabase: SupabaseClient,
  run: PayRun,
  settings: OrgSettings
): Promise<{ stubs: StubRow[]; warnings: string[] }> {
  const warnings: string[] = [];
  const start = parseLocalDate(run.period_start);
  const end = parseLocalDate(run.period_end);
  const P = periodsPerYear(settings.pay_frequency);

  const fed = (await loadRates(supabase, "CA", run.pay_date)) as FederalRates;
  const prov = (await loadRates(supabase, settings.province, run.pay_date)) as ProvincialRates;

  // Look back to the start of the work week so weekly overtime is right
  const weekStart = startOfWorkWeek(start, settings.work_week_start);
  const from = weekStart < start ? weekStart : start;
  const to = addDays(end, 1);

  const yearStart = `${run.pay_date.slice(0, 4)}-01-01`;

  const [peopleRes, entriesRes, ytdRes] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, full_name, hourly_wage, employee_type, status, extra_tax_per_pay, gst_number, td1_mode, tax_claim_amount, tax_claim_provincial"
      )
      .eq("role", "employee")
      .order("full_name"),
    supabase
      .from("time_entries")
      .select("profile_id, clock_in, clock_out")
      .gte("clock_in", from.toISOString())
      .lt("clock_in", to.toISOString()),
    // Year-to-date totals from other FINALIZED runs this calendar year
    supabase
      .from("pay_stubs")
      .select("profile_id, gross, cpp, cpp2, ei, pay_runs!inner(status)")
      .eq("pay_runs.status", "finalized")
      .gte("pay_date", yearStart)
      .lte("pay_date", run.pay_date)
      .neq("pay_run_id", run.id),
  ]);

  const err = peopleRes.error ?? entriesRes.error ?? ytdRes.error;
  if (err) throw new Error(err.message);

  const ytd = new Map<string, { gross: number; cpp: number; cpp2: number; ei: number }>();
  for (const s of ytdRes.data ?? []) {
    const t = ytd.get(s.profile_id) ?? { gross: 0, cpp: 0, cpp2: 0, ei: 0 };
    t.gross += Number(s.gross);
    t.cpp += Number(s.cpp);
    t.cpp2 += Number(s.cpp2);
    t.ei += Number(s.ei);
    ytd.set(s.profile_id, t);
  }

  const entries = entriesRes.data ?? [];
  const stubs: StubRow[] = [];

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
    const split = splitHours(mine, rules, start, end);
    const regular = round2(split.regular);
    const overtime = round2(split.overtime);
    if (regular + overtime === 0) continue; // didn't work this period

    if (p.hourly_wage == null) {
      warnings.push(`${name} worked ${round2(regular + overtime)} hours but has no wage set. Set it on the Staff page, then recalculate.`);
      continue;
    }

    const wage = Number(p.hourly_wage);
    const multiplier = Number(settings.overtime_multiplier);
    const gross = round2(regular * wage + overtime * wage * multiplier);

    const base = {
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
      other_deductions: [],
      other_deductions_total: 0,
    };

    if (isSub) {
      const gst = p.gst_number ? round2(gross * GST_RATE) : 0;
      stubs.push({
        ...base,
        cpp: 0,
        cpp2: 0,
        ei: 0,
        federal_tax: 0,
        provincial_tax: 0,
        gst,
        net_pay: round2(gross + gst),
        employer_cpp: 0,
        employer_cpp2: 0,
        employer_ei: 0,
        details: { full_name: name, gst_number: p.gst_number ?? null },
      });
      continue;
    }

    const y = ytd.get(p.id) ?? { gross: 0, cpp: 0, cpp2: 0, ei: 0 };
    const extraTax = round2(Number(p.extra_tax_per_pay ?? 0));
    const claims = td1Claims(p);
    const calc = calculatePayroll(
      {
        gross,
        periodsPerYear: P,
        federalClaim: claims.federal,
        provincialClaim: claims.provincial,
        extraTax,
        ytd: { cpp: y.cpp, cpp2: y.cpp2, ei: y.ei, pensionableEarnings: y.gross },
      },
      fed,
      prov
    );

    // Extra tax goes on the federal line; the provincial line is the remainder,
    // so federal + provincial always equals the rounded total exactly
    const federalTax = round2(calc.federalTax + extraTax);
    const provincialTax = round2(calc.incomeTax - federalTax);

    stubs.push({
      ...base,
      cpp: calc.cpp,
      cpp2: calc.cpp2,
      ei: calc.ei,
      federal_tax: federalTax,
      provincial_tax: provincialTax,
      gst: 0,
      net_pay: round2(gross - calc.cpp - calc.cpp2 - calc.ei - calc.incomeTax),
      employer_cpp: calc.employerCpp,
      employer_cpp2: calc.employerCpp2,
      employer_ei: calc.employerEi,
      details: {
        full_name: name,
        province: settings.province,
        periods_per_year: P,
        td1_mode: claims.mode,
        federal_claim: claims.federal ?? "basic personal amount",
        provincial_claim: claims.provincial ?? "basic personal amount",
        extra_tax: extraTax,
        annual_taxable_income: calc.annualTaxableIncome,
        annual_federal_tax: calc.annualFederalTax,
        annual_provincial_tax: calc.annualProvincialTax,
        ytd_before: y,
      },
    });
  }

  return { stubs, warnings };
}