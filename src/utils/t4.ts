import "server-only";
// Year-end summary of each employee's T4 amounts, for the employer's
// accountant. It is a preparation aid: SiteStamp does not file T4 slips or
// information returns with the CRA. Box rules: docs/payroll-rules.md
// (CRA RC4120 and "Filling out the T4 slip").
//
// Built only from FINALIZED pay runs, by pay date (CRA: income is reported for
// the year it is paid). Finalized stubs can't be edited or regenerated
// (database triggers), and each stub is counted once by id.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/utils/supabase/fetchAll";
import { round2, type FederalRates } from "@/utils/payroll";
import type { StubDeduction } from "@/utils/deductions";
import { DEDUCTION_KINDS } from "@/utils/deductions";
import { EMPLOYER_PROFILE_FIELDS, type EmployerProfile, loadRates } from "@/utils/payRun";

export type T4Row = {
  profile_id: string;
  name: string;
  province: string;
  stubs: number;
  first_pay_date: string;
  last_pay_date: string;
  box14: number;
  box16: number;
  box16a: number;
  box18: number;
  box22: number;
  box24: number;
  box26: number;
  box44: number;
  code85: number;
  /** After-tax deductions that have no T4 box (not reported). */
  unreported: { name: string; kind: string; amount: number }[];
  notes: string[];
};

export type T4Summary = {
  year: number;
  employer: {
    name: string | null;
    legal_name: string | null;
    address: string | null;
    payroll_account: string | null;
  };
  caps: { maxInsurable: number; yampe: number } | null;
  rows: T4Row[];
  subcontractors: { count: number; total: number };
  warnings: string[];
  checklist: string[];
};

type StubRow = {
  id: string;
  profile_id: string;
  employee_type: string;
  pay_date: string;
  period_start: string;
  period_end: string;
  gross: number;
  cpp: number;
  cpp2: number;
  ei: number;
  federal_tax: number;
  provincial_tax: number;
  other_deductions: StubDeduction[] | null;
  calc_version: number | null;
  full_name: string | null;
  province: string | null;
};

const num = (v: unknown) => (v == null ? 0 : Number(v));

export async function buildT4Summary(supabase: SupabaseClient, orgId: string, year: number): Promise<T4Summary> {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const warnings: string[] = [];

  const [stubs, profilesRes, employerRes, orgRes, draftsRes] = await Promise.all([
    fetchAll<StubRow>((a, b) =>
      supabase
        .from("pay_stubs")
        .select(
          "id, profile_id, employee_type, pay_date, period_start, period_end, gross, cpp, cpp2, ei, federal_tax, provincial_tax, other_deductions, calc_version, full_name:details->>full_name, province:details->>province, pay_runs!inner(status)"
        )
        .eq("org_id", orgId)
        .eq("pay_runs.status", "finalized")
        .gte("pay_date", from)
        .lte("pay_date", to)
        .order("id")
        .range(a, b)
    ),
    supabase.from("profiles").select("id, full_name").eq("org_id", orgId),
    supabase.from("employer_profiles").select(EMPLOYER_PROFILE_FIELDS).eq("org_id", orgId).maybeSingle(),
    supabase.from("orgs").select("name").eq("id", orgId).maybeSingle(),
    supabase
      .from("pay_runs")
      .select("id, period_start, period_end, pay_date")
      .eq("org_id", orgId)
      .eq("status", "draft")
      .gte("pay_date", from)
      .lte("pay_date", to),
  ]);
  const err = profilesRes.error ?? employerRes.error ?? orgRes.error ?? draftsRes.error;
  if (err) throw new Error(err.message);

  let caps: T4Summary["caps"] = null;
  try {
    const fed = (await loadRates(supabase, "CA", to)) as FederalRates;
    caps = { maxInsurable: Number(fed.ei.max_insurable), yampe: Number(fed.cpp.yampe) };
  } catch {
    warnings.push(
      `No federal rates are set up for ${year}, so boxes 24 and 26 are not capped at the year's maximums. Check them against the CRA's ${year} limits.`
    );
  }

  const employer = (employerRes.data as EmployerProfile | null) ?? null;
  const orgName = (orgRes.data as { name?: string | null } | null)?.name ?? null;
  const address = employer
    ? [employer.address_line1, employer.address_line2, employer.city, employer.province, employer.postal_code]
        .map((v) => v?.trim())
        .filter(Boolean)
        .join(", ") || null
    : null;

  if (!employer?.legal_name && !orgName) warnings.push("The employer's legal name is missing. Add it under Settings → Company details.");
  if (!address) warnings.push("The employer's address is missing. Add it under Settings → Company details.");
  if (!employer?.cra_payroll_account) {
    warnings.push("The CRA payroll account number (box 54, e.g. 123456789RP0001) is missing. Add it under Settings → Company details.");
  }

  const drafts = (draftsRes.data ?? []) as { pay_date: string }[];
  if (drafts.length > 0) {
    warnings.push(
      `${drafts.length} draft pay run${drafts.length === 1 ? " has a pay date" : "s have pay dates"} in ${year}. Drafts are not included. Finalize or delete ${drafts.length === 1 ? "it" : "them"} before giving this to your accountant.`
    );
  }

  const names = new Map(((profilesRes.data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name]));

  // One row per stub id, in case a query ever returns a duplicate
  const seen = new Set<string>();
  const unique = stubs.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));

  const subs = unique.filter((s) => s.employee_type === "subcontractor");
  const employees = unique.filter((s) => s.employee_type !== "subcontractor");

  const byPerson = new Map<string, StubRow[]>();
  for (const s of employees) byPerson.set(s.profile_id, [...(byPerson.get(s.profile_id) ?? []), s]);

  const rows: T4Row[] = [];
  for (const [profileId, list] of byPerson) {
    list.sort((a, b) => a.period_start.localeCompare(b.period_start));
    const name = names.get(profileId) ?? list[list.length - 1].full_name ?? "Unknown";
    const notes: string[] = [];

    // Two finalized stubs for overlapping periods would double-count pay
    for (let i = 1; i < list.length; i++) {
      if (list[i].period_start <= list[i - 1].period_end) {
        warnings.push(
          `${name} has finalized pay for overlapping periods (${list[i - 1].period_start} to ${list[i - 1].period_end} and ${list[i].period_start} to ${list[i].period_end}). Confirm both were really paid before using these totals.`
        );
      }
    }

    const provinces = new Set(list.map((s) => s.province ?? "AB"));
    if (provinces.size > 1) {
      notes.push(`Paid under more than one province (${[...provinces].join(", ")}). The CRA needs one slip per province.`);
    }

    let box44 = 0;
    let code85 = 0;
    const unreported = new Map<string, { name: string; kind: string; amount: number }>();
    for (const s of list) {
      for (const d of s.other_deductions ?? []) {
        const amount = num(d.amount);
        if (d.t4_box === "44") box44 += amount;
        else if (d.t4_box === "85") code85 += amount;
        else {
          const key = `${d.kind}:${d.name}`;
          const u = unreported.get(key) ?? { name: d.name, kind: DEDUCTION_KINDS[d.kind]?.label ?? d.kind, amount: 0 };
          u.amount += amount;
          unreported.set(key, u);
        }
      }
    }
    const legacy = list.filter((s) => s.calc_version == null).length;
    if (legacy > 0) {
      notes.push(`${legacy} stub${legacy === 1 ? " was" : "s were"} made before SiteStamp tracked custom deductions; any deductions taken outside SiteStamp then aren't included.`);
    }

    const box14 = round2(list.reduce((s, x) => s + num(x.gross), 0));
    rows.push({
      profile_id: profileId,
      name,
      province: [...provinces][0] ?? "AB",
      stubs: list.length,
      first_pay_date: list.reduce((m, x) => (x.pay_date < m ? x.pay_date : m), list[0].pay_date),
      last_pay_date: list.reduce((m, x) => (x.pay_date > m ? x.pay_date : m), list[0].pay_date),
      box14,
      box16: round2(list.reduce((s, x) => s + num(x.cpp), 0)),
      box16a: round2(list.reduce((s, x) => s + num(x.cpp2), 0)),
      box18: round2(list.reduce((s, x) => s + num(x.ei), 0)),
      box22: round2(list.reduce((s, x) => s + num(x.federal_tax) + num(x.provincial_tax), 0)),
      // All SiteStamp earnings are insurable and pensionable (wages, overtime,
      // vacation pay, holiday pay), capped at the year's maximums
      box24: round2(caps ? Math.min(box14, caps.maxInsurable) : box14),
      box26: round2(caps ? Math.min(box14, caps.yampe) : box14),
      box44: round2(box44),
      code85: round2(code85),
      unreported: [...unreported.values()].map((u) => ({ ...u, amount: round2(u.amount) })),
      notes,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));

  const checklist = [
    "This is a summary to help your accountant prepare T4 slips. SiteStamp does not file anything with the CRA and these are not official T4 slips.",
    "Box 12 (SIN) and each employee's home address are not stored in SiteStamp. Your accountant needs them from your employment records.",
    "Box 45 (employer-offered dental benefits, codes 1 to 5) is required on every T4 and is not tracked here.",
    "Box 44 should only be used if you and the union agreed the union won't issue receipts for dues.",
    "Code 85 (employee-paid private health premiums) is optional.",
    "Box 26 assumes all pay was pensionable. SiteStamp doesn't track ages, so CPP exemptions (under 18, over 70, CPT30 elections) aren't applied.",
    "Amounts are by pay date: vacation and holiday pay count in the year they were paid.",
  ];

  return {
    year,
    employer: {
      name: orgName,
      legal_name: employer?.legal_name ?? null,
      address,
      payroll_account: employer?.cra_payroll_account ?? null,
    },
    caps,
    rows,
    subcontractors: { count: new Set(subs.map((s) => s.profile_id)).size, total: round2(subs.reduce((s, x) => s + num(x.gross), 0)) },
    warnings,
    checklist,
  };
}

// CSV cells that start with = + - @ (or tab / CR) are formulas in spreadsheets
function csvCell(value: string | number | null | undefined) {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const amount = (n: number) => n.toFixed(2);

export function t4SummaryCsv(t: T4Summary) {
  const lines: string[][] = [
    ["SiteStamp T4 preparation summary (not a CRA filing and not official T4 slips)"],
    ["Tax year", String(t.year)],
    ["Employer", t.employer.legal_name ?? t.employer.name ?? "(not set)"],
    ["Employer address", t.employer.address ?? "(not set)"],
    ["Box 54 payroll account", t.employer.payroll_account ?? "(not set)"],
    ["Source", "Finalized SiteStamp pay runs with a pay date in the tax year"],
    [],
    [
      "Employee name",
      "Box 10 province",
      "Box 14 employment income",
      "Box 16 CPP",
      "Box 16A CPP2",
      "Box 18 EI",
      "Box 22 income tax",
      "Box 24 EI insurable earnings",
      "Box 26 CPP pensionable earnings",
      "Box 44 union dues",
      "Code 85 private health premiums",
      "Box 12 SIN",
      "Box 45 dental code",
      "Pay stubs",
      "First pay date",
      "Last pay date",
      "Not on T4 (after-tax deductions)",
      "Notes",
    ],
    ...t.rows.map((r) => [
      r.name,
      r.province,
      amount(r.box14),
      amount(r.box16),
      amount(r.box16a),
      amount(r.box18),
      amount(r.box22),
      amount(r.box24),
      amount(r.box26),
      amount(r.box44),
      amount(r.code85),
      "(from employee records)",
      "(employer to provide)",
      String(r.stubs),
      r.first_pay_date,
      r.last_pay_date,
      r.unreported.map((u) => `${u.name} ${amount(u.amount)}`).join("; "),
      r.notes.join(" "),
    ]),
    [],
  ];
  if (t.subcontractors.count > 0) {
    lines.push([
      `Not included: payments to ${t.subcontractors.count} subcontractor(s) totalling ${amount(t.subcontractors.total)}. They are not employment income; ask your accountant about any other reporting.`,
    ]);
  }
  if (t.warnings.length > 0) {
    lines.push(["Warnings"]);
    for (const w of t.warnings) lines.push([w]);
  }
  lines.push(["Notes for your accountant"]);
  for (const c of t.checklist) lines.push([c]);

  // BOM so spreadsheet apps read accents correctly
  return "﻿" + lines.map((l) => l.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
