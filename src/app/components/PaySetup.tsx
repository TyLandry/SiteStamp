"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { fetchAll } from "@/utils/supabase/fetchAll";
import { round2 } from "@/utils/payroll";
import {
  type Deduction,
  type DeductionKind,
  type StubDeduction,
  DEDUCTION_KINDS,
  TAX_TREATMENT_LABELS,
} from "@/utils/deductions";
import {
  type AdwPeriod,
  type EsCategory,
  type PayTiming,
  ADW_PERIOD_LABELS,
  ES_CATEGORY_LABELS,
  fifthAnniversary,
} from "@/utils/leave";
import {
  type EmployeePaySettings,
  type EmployerProfile,
  EMPLOYER_PROFILE_FIELDS,
  PAY_SETTINGS_FIELDS,
} from "@/utils/payRun";
import { fmtDate, parseLocalDate, toDateInput } from "@/utils/payPeriods";
import { Avatar } from "./ui/Marks";

type Employee = {
  id: string;
  full_name: string | null;
  status: "active" | "terminated";
};

type Balance = { vacation: number; holiday: number };

function money(n: number) {
  return Number(n).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

function categoryOf(s: EmployeePaySettings | undefined, fallback: EsCategory | null) {
  return s?.es_category ?? fallback;
}

const TIMING_LABELS: Record<PayTiming, string> = {
  each_pay: "Pay it on every cheque",
  accrue: "Save it up and pay it when they take time off",
};

// ---------------------------------------------------------------------------

export default function PaySetup() {
  const supabase = createClient();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [employer, setEmployer] = useState<EmployerProfile | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [settings, setSettings] = useState<Map<string, EmployeePaySettings>>(new Map());
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [balances, setBalances] = useState<Map<string, Balance>>(new Map());
  const [loanPaid, setLoanPaid] = useState<Map<string, number>>(new Map());
  const [subCount, setSubCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showTerminated, setShowTerminated] = useState(false);

  async function load() {
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("You're not logged in.");
      const { data: me } = await supabase.from("profiles").select("org_id").eq("id", user.id).single();
      const org = (me?.org_id as string | undefined) ?? null;
      setOrgId(org);

      const [peopleRes, settingsRes, employerRes, deductionsRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, status, employee_type")
          .eq("role", "employee")
          .order("full_name"),
        supabase.from("employee_pay_settings").select(PAY_SETTINGS_FIELDS),
        org
          ? supabase.from("employer_profiles").select(EMPLOYER_PROFILE_FIELDS).eq("org_id", org).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase.from("employee_deductions").select("*").order("created_at"),
      ]);
      const err = peopleRes.error ?? settingsRes.error ?? employerRes.error ?? deductionsRes.error;
      if (err) throw new Error(err.message);

      // Owed balances and loan repayments come from finalized stubs only
      const rows = await fetchAll<{
        profile_id: string;
        vacation_pay_earned: number | null;
        vacation_pay_paid: number | null;
        holiday_pay_earned: number | null;
        holiday_pay_paid: number | null;
        other_deductions: StubDeduction[] | null;
      }>((a, b) =>
        supabase
          .from("pay_stubs")
          .select(
            "profile_id, vacation_pay_earned, vacation_pay_paid, holiday_pay_earned, holiday_pay_paid, other_deductions, pay_runs!inner(status)"
          )
          .eq("pay_runs.status", "finalized")
          .order("id")
          .range(a, b)
      );
      const bal = new Map<string, Balance>();
      const paid = new Map<string, number>();
      for (const r of rows) {
        const b = bal.get(r.profile_id) ?? { vacation: 0, holiday: 0 };
        b.vacation += Number(r.vacation_pay_earned ?? 0) - Number(r.vacation_pay_paid ?? 0);
        b.holiday += Number(r.holiday_pay_earned ?? 0) - Number(r.holiday_pay_paid ?? 0);
        bal.set(r.profile_id, b);
        for (const d of r.other_deductions ?? []) {
          if (d?.deduction_id) paid.set(d.deduction_id, (paid.get(d.deduction_id) ?? 0) + Number(d.amount ?? 0));
        }
      }

      const people = (peopleRes.data ?? []) as (Employee & { employee_type: string })[];
      setEmployees(people.filter((p) => p.employee_type !== "subcontractor"));
      setSubCount(people.filter((p) => p.employee_type === "subcontractor").length);
      setSettings(new Map(((settingsRes.data ?? []) as EmployeePaySettings[]).map((s) => [s.profile_id, s])));
      setEmployer((employerRes.data as EmployerProfile | null) ?? null);
      setDeductions((deductionsRes.data ?? []) as Deduction[]);
      setBalances(bal);
      setLoanPaid(paid);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load pay setup.");
    }
    setLoading(false);
  }

  useEffect(() => {
    // Start the load after the effect runs; the loading state already starts true
    void Promise.resolve().then(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="panel p-4 flex flex-col gap-3" aria-busy="true">
        <span className="skeleton w-48" />
        <span className="skeleton w-full" />
        <span className="skeleton w-2/3" />
      </div>
    );
  }

  const visible = employees.filter((e) => showTerminated || e.status !== "terminated");
  const terminatedCount = employees.filter((e) => e.status === "terminated").length;
  const defaultCategory = employer?.default_es_category ?? null;

  return (
    <div className="stack">
      {error ? (
        <div className="panel panel-body pt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="msg-error" role="alert">
            {error}
          </p>
          <button type="button" className="btn" onClick={() => load()}>
            Retry
          </button>
        </div>
      ) : null}

      {orgId ? <CompanyRules orgId={orgId} employer={employer} onSaved={load} /> : null}

      <section className="panel" aria-labelledby="people-h">
        <div className="panel-h">
          <h2 id="people-h">Employees</h2>
          {terminatedCount > 0 ? (
            <label className="check small font-normal">
              <input type="checkbox" checked={showTerminated} onChange={(e) => setShowTerminated(e.target.checked)} />
              Show {terminatedCount} terminated
            </label>
          ) : null}
        </div>
        {visible.length === 0 ? (
          <div className="panel-body">
            <p className="empty">No employees yet. Invite your crew from Crew &amp; wages.</p>
          </div>
        ) : (
          <ul>
            {visible.map((emp) => {
              const s = settings.get(emp.id);
              const category = categoryOf(s, defaultCategory);
              const b = balances.get(emp.id) ?? { vacation: 0, holiday: 0 };
              const mine = deductions.filter((d) => d.profile_id === emp.id);
              const active = mine.filter((d) => d.active);
              const open = openId === emp.id;
              return (
                <li key={emp.id} className="border-t border-[var(--rule)] first:border-t-0">
                  <div className="list-row items-start border-t-0">
                    <div className="person items-start">
                      <Avatar id={emp.id} name={emp.full_name} />
                      <div className="n">
                        <span className="font-semibold">{emp.full_name ?? "—"}</span>
                        <small>
                          {category ? ES_CATEGORY_LABELS[category] : "Category not chosen"}
                          {s?.employment_start_date
                            ? ` · since ${fmtDate(parseLocalDate(s.employment_start_date))}`
                            : " · no start date"}
                          {emp.status === "terminated" ? " · terminated" : ""}
                        </small>
                        <small>
                          Vacation: {TIMING_LABELS[s?.vacation_pay_timing ?? "each_pay"].toLowerCase()}
                          {b.vacation > 0.004 ? ` · ${money(b.vacation)} owed` : ""}
                          {category === "construction" && b.holiday > 0.004 ? ` · holiday pay ${money(b.holiday)} owed` : ""}
                        </small>
                        <small>
                          {active.length === 0
                            ? "No deductions"
                            : active.map((d) => `${d.name} ${money(Number(d.amount_per_pay))}`).join(" · ")}
                        </small>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {!category ? <span className="pill pill-warn">Needs setup</span> : null}
                      <button
                        type="button"
                        className="btn btn-text"
                        aria-expanded={open}
                        onClick={() => setOpenId(open ? null : emp.id)}
                      >
                        {open ? "Close" : "Edit"}
                      </button>
                    </div>
                  </div>
                  {open && orgId ? (
                    <div className="px-4 pb-4 flex flex-col gap-4">
                      <EmployeeSettingsForm
                        orgId={orgId}
                        employee={emp}
                        current={s}
                        defaultCategory={defaultCategory}
                        balance={b}
                        onSaved={load}
                      />
                      <DeductionList
                        orgId={orgId}
                        employee={emp}
                        deductions={mine}
                        loanPaid={loanPaid}
                        onSaved={load}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {subCount > 0 ? (
          <div className="title-block">
            <span>
              {subCount} subcontractor{subCount === 1 ? "" : "s"} not listed: vacation pay, holiday pay and payroll
              deductions only apply to employees.
            </span>
          </div>
        ) : null}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Company-wide rules
// ---------------------------------------------------------------------------

function CompanyRules({
  orgId,
  employer,
  onSaved,
}: {
  orgId: string;
  employer: EmployerProfile | null;
  onSaved: () => Promise<void>;
}) {
  const supabase = createClient();
  const [category, setCategory] = useState<string>(employer?.default_es_category ?? "");
  const [adw, setAdw] = useState<AdwPeriod>(employer?.holiday_average_period ?? "preceding_4_weeks");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    const { error: saveError } = await supabase.from("employer_profiles").upsert(
      {
        org_id: orgId,
        default_es_category: category === "" ? null : category,
        holiday_average_period: adw,
      },
      { onConflict: "org_id" }
    );
    if (saveError) setError(saveError.message);
    else {
      setMessage("Saved. Recalculate any draft pay runs to use it.");
      await onSaved();
    }
    setSaving(false);
  }

  return (
    <section className="panel" aria-labelledby="rules-h">
      <div className="panel-h">
        <h2 id="rules-h">Alberta rules for your crew</h2>
      </div>
      <form className="panel-body flex flex-col gap-4" onSubmit={save}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="field">
            <label htmlFor="es-default">Most of your employees are</label>
            <select id="es-default" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Not chosen yet</option>
              <option value="construction">Construction employees</option>
              <option value="general">Other employees</option>
            </select>
            <span className="hint">
              Construction employees work at a site building, repairing, renovating, painting or demolishing
              buildings, roads, pipelines and similar (Employment Standards Regulation s.44). They get 6% vacation pay
              and 3.6% general holiday pay from day one instead of the usual rules. Site maintenance and office staff
              aren&apos;t construction employees. You can change this per person below.
            </span>
          </div>
          <div className="field">
            <label htmlFor="adw-period">Average daily wage for holiday pay uses</label>
            <select id="adw-period" className="select" value={adw} onChange={(e) => setAdw(e.target.value as AdwPeriod)}>
              {(Object.keys(ADW_PERIOD_LABELS) as AdwPeriod[]).map((k) => (
                <option key={k} value={k}>
                  {ADW_PERIOD_LABELS[k]}
                </option>
              ))}
            </select>
            <span className="hint">
              Only for other employees. Employment Standards Code s.24.1 lets you choose either period: total wages
              in it ÷ days worked.
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save rules"}
          </button>
          {message ? (
            <p className="msg-ok" role="status">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className="msg-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// One employee's vacation and holiday pay settings
// ---------------------------------------------------------------------------

function EmployeeSettingsForm({
  orgId,
  employee,
  current,
  defaultCategory,
  balance,
  onSaved,
}: {
  orgId: string;
  employee: Employee;
  current: EmployeePaySettings | undefined;
  defaultCategory: EsCategory | null;
  balance: Balance;
  onSaved: () => Promise<void>;
}) {
  const supabase = createClient();
  const [startDate, setStartDate] = useState(current?.employment_start_date ?? "");
  const [category, setCategory] = useState<string>(current?.es_category ?? "");
  const [vacTiming, setVacTiming] = useState<PayTiming>(current?.vacation_pay_timing ?? "each_pay");
  const [holTiming, setHolTiming] = useState<PayTiming>(current?.holiday_pay_timing ?? "each_pay");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effective = (category === "" ? defaultCategory : (category as EsCategory)) ?? null;
  const today = toDateInput(new Date());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(null);
    if (startDate && startDate > today) {
      setError("The start date can't be in the future.");
      return;
    }
    setSaving(true);
    const { error: saveError } = await supabase.from("employee_pay_settings").upsert(
      {
        profile_id: employee.id,
        org_id: orgId,
        employment_start_date: startDate || null,
        es_category: category === "" ? null : category,
        vacation_pay_timing: vacTiming,
        holiday_pay_timing: holTiming,
      },
      { onConflict: "profile_id" }
    );
    if (saveError) setError(saveError.message);
    else {
      setMessage("Saved. Recalculate any draft pay runs to use it.");
      await onSaved();
    }
    setSaving(false);
  }

  return (
    <form className="note-box flex flex-col gap-4 text-[var(--text)]" onSubmit={save}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="field">
          <label htmlFor={`start-${employee.id}`}>Start of continuous employment</label>
          <input
            id={`start-${employee.id}`}
            className="input"
            type="date"
            max={today}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <span className="hint">
            {startDate
              ? `5 years on ${fmtDate(parseLocalDate(fifthAnniversary(startDate)))}. `
              : "Needed to know when vacation pay goes from 4% to 6%. "}
            A break of less than 90 days doesn&apos;t restart it (Code s.36).
          </span>
        </div>
        <div className="field">
          <label htmlFor={`cat-${employee.id}`}>Employment standards</label>
          <select
            id={`cat-${employee.id}`}
            className="select"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">
              Company default{defaultCategory ? ` (${ES_CATEGORY_LABELS[defaultCategory].toLowerCase()})` : " (not chosen)"}
            </option>
            <option value="construction">{ES_CATEGORY_LABELS.construction}</option>
            <option value="general">{ES_CATEGORY_LABELS.general}</option>
          </select>
          <span className="hint">
            {effective === "construction"
              ? "6% vacation pay and 3.6% general holiday pay on wages, from the start. Both must be paid by December 31 or when employment ends."
              : effective === "general"
                ? "4% vacation pay (6% from 5 years). Pay for the 9 Alberta general holidays after 30 work days in the last 12 months."
                : "Choose one so vacation and holiday pay can be calculated."}
          </span>
        </div>
        <div className="field">
          <label htmlFor={`vac-${employee.id}`}>Vacation pay</label>
          <select
            id={`vac-${employee.id}`}
            className="select"
            value={vacTiming}
            onChange={(e) => setVacTiming(e.target.value as PayTiming)}
          >
            {(Object.keys(TIMING_LABELS) as PayTiming[]).map((k) => (
              <option key={k} value={k}>
                {TIMING_LABELS[k]}
              </option>
            ))}
          </select>
          <span className="hint">
            {vacTiming === "accrue"
              ? "It builds up on each stub. Pay it from the pay run, no later than the next payday after their vacation starts."
              : "It's added to every stub, so nothing builds up to pay later."}
            {balance.vacation > 0.004 ? ` Owed now: ${money(round2(balance.vacation))}.` : ""}
          </span>
        </div>
        {effective === "construction" ? (
          <div className="field">
            <label htmlFor={`hol-${employee.id}`}>General holiday pay (3.6%)</label>
            <select
              id={`hol-${employee.id}`}
              className="select"
              value={holTiming}
              onChange={(e) => setHolTiming(e.target.value as PayTiming)}
            >
              <option value="each_pay">Pay it on every cheque</option>
              <option value="accrue">Save it up and pay it by December 31</option>
            </select>
            <span className="hint">
              Construction employees don&apos;t get days off for general holidays; they get this percentage instead.
              {balance.holiday > 0.004 ? ` Owed now: ${money(round2(balance.holiday))}.` : ""}
            </span>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        {message ? (
          <p className="msg-ok" role="status">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="msg-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// One employee's custom deductions
// ---------------------------------------------------------------------------

type Draft = {
  id: string | null;
  kind: DeductionKind;
  name: string;
  amount: string;
  loanTotal: string;
  report: boolean;
  authorized: boolean;
  startsOn: string;
  endsOn: string;
};

function emptyDraft(): Draft {
  return {
    id: null,
    kind: "union_dues",
    name: DEDUCTION_KINDS.union_dues.label,
    amount: "",
    loanTotal: "",
    report: DEDUCTION_KINDS.union_dues.t4BoxDefault,
    authorized: false,
    startsOn: "",
    endsOn: "",
  };
}

function DeductionList({
  orgId,
  employee,
  deductions,
  loanPaid,
  onSaved,
}: {
  orgId: string;
  employee: Employee;
  deductions: Deduction[];
  loanPaid: Map<string, number>;
  onSaved: () => Promise<void>;
}) {
  const supabase = createClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const active = deductions.filter((d) => d.active);
  const inactive = deductions.filter((d) => !d.active);

  function edit(d: Deduction) {
    setError(null);
    setDraft({
      id: d.id,
      kind: d.kind,
      name: d.name,
      amount: String(Number(d.amount_per_pay)),
      loanTotal: d.loan_total != null ? String(Number(d.loan_total)) : "",
      report: d.t4_box != null,
      authorized: d.authorization_on_file,
      startsOn: d.starts_on ?? "",
      endsOn: d.ends_on ?? "",
    });
  }

  function setKind(kind: DeductionKind) {
    if (!draft) return;
    const wasDefaultName = Object.values(DEDUCTION_KINDS).some((k) => k.label === draft.name) || draft.name.trim() === "";
    setDraft({
      ...draft,
      kind,
      name: wasDefaultName ? DEDUCTION_KINDS[kind].label : draft.name,
      report: DEDUCTION_KINDS[kind].t4BoxDefault,
      loanTotal: kind === "tool_loan" ? draft.loanTotal : "",
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setError(null);

    const name = draft.name.trim();
    const amount = Number(draft.amount);
    const loanTotal = draft.loanTotal.trim() === "" ? null : Number(draft.loanTotal);
    if (name.length < 1 || name.length > 60) {
      setError("Give it a name (up to 60 characters).");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000 || round2(amount) !== amount) {
      setError("Enter an amount per pay greater than $0, in dollars and cents.");
      return;
    }
    if (loanTotal != null && (!Number.isFinite(loanTotal) || loanTotal <= 0 || round2(loanTotal) !== loanTotal)) {
      setError("The amount lent must be greater than $0, or left blank.");
      return;
    }
    if (draft.startsOn && draft.endsOn && draft.endsOn < draft.startsOn) {
      setError("The end date can't be before the start date.");
      return;
    }

    const info = DEDUCTION_KINDS[draft.kind];
    const row = {
      org_id: orgId,
      profile_id: employee.id,
      kind: draft.kind,
      name,
      amount_per_pay: amount,
      loan_total: draft.kind === "tool_loan" ? loanTotal : null,
      tax_treatment: info.treatment,
      t4_box: info.t4Box && draft.report ? info.t4Box : null,
      authorization_on_file: draft.authorized,
      starts_on: draft.startsOn || null,
      ends_on: draft.endsOn || null,
    };

    setSaving(true);
    const { error: saveError } = draft.id
      ? await supabase.from("employee_deductions").update(row).eq("id", draft.id)
      : await supabase.from("employee_deductions").insert(row);
    if (saveError) setError(saveError.message);
    else {
      setDraft(null);
      await onSaved();
    }
    setSaving(false);
  }

  async function setActive(d: Deduction, value: boolean) {
    if (!value && !window.confirm(`Stop taking ${d.name} from ${employee.full_name ?? "this employee"}'s pay?`)) return;
    setBusyId(d.id);
    setError(null);
    const { error: saveError } = await supabase
      .from("employee_deductions")
      .update({ active: value, deactivated_at: value ? null : new Date().toISOString() })
      .eq("id", d.id);
    if (saveError) setError(saveError.message);
    else await onSaved();
    setBusyId(null);
  }

  const row = (d: Deduction) => {
    const paid = loanPaid.get(d.id) ?? 0;
    const remaining = d.loan_total != null ? round2(Number(d.loan_total) - paid) : null;
    const info = DEDUCTION_KINDS[d.kind];
    return (
      <li key={d.id} className="list-row items-start px-0">
        <div className="min-w-0">
          <div className="font-semibold">
            {d.name} <span className="font-normal num">{money(Number(d.amount_per_pay))} per pay</span>
          </div>
          <div className="small muted">
            {info.label} · {TAX_TREATMENT_LABELS[d.tax_treatment]} ·{" "}
            {d.t4_box ? (d.t4_box === "85" ? "T4 code 85" : `T4 box ${d.t4_box}`) : "not on T4"}
            {remaining != null ? ` · ${money(Math.max(remaining, 0))} of ${money(Number(d.loan_total))} left` : ""}
            {d.starts_on ? ` · from ${fmtDate(parseLocalDate(d.starts_on))}` : ""}
            {d.ends_on ? ` · until ${fmtDate(parseLocalDate(d.ends_on))}` : ""}
          </div>
          {!d.authorization_on_file && d.active ? (
            <span className="pill pill-warn mt-1">No written authorization recorded</span>
          ) : null}
          {remaining != null && remaining <= 0 && d.active ? <span className="pill pill-ok mt-1">Repaid</span> : null}
        </div>
        <div className="flex items-center gap-1">
          {d.active ? (
            <>
              <button type="button" className="btn btn-text" onClick={() => edit(d)}>
                Edit
              </button>
              <button
                type="button"
                className="btn btn-text btn-danger"
                disabled={busyId === d.id}
                onClick={() => setActive(d, false)}
              >
                Deactivate
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-text" disabled={busyId === d.id} onClick={() => setActive(d, true)}>
              Reactivate
            </button>
          )}
        </div>
      </li>
    );
  };

  const info = draft ? DEDUCTION_KINDS[draft.kind] : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-semibold">Deductions</h3>
        {!draft ? (
          <button type="button" className="btn btn-text" onClick={() => setDraft(emptyDraft())}>
            Add deduction
          </button>
        ) : null}
      </div>

      {active.length === 0 && !draft ? <p className="empty">No deductions.</p> : <ul>{active.map(row)}</ul>}

      {draft && info ? (
        <form className="note-box flex flex-col gap-4 text-[var(--text)]" onSubmit={save}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="field">
              <label htmlFor={`kind-${employee.id}`}>Type</label>
              <select
                id={`kind-${employee.id}`}
                className="select"
                value={draft.kind}
                onChange={(e) => setKind(e.target.value as DeductionKind)}
              >
                {(Object.keys(DEDUCTION_KINDS) as DeductionKind[]).map((k) => (
                  <option key={k} value={k}>
                    {DEDUCTION_KINDS[k].label}
                  </option>
                ))}
              </select>
              <span className="hint">{info.explain}</span>
            </div>
            <div className="field">
              <label htmlFor={`name-${employee.id}`}>Name on the pay stub</label>
              <input
                id={`name-${employee.id}`}
                className="input"
                maxLength={60}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor={`amount-${employee.id}`}>Amount per pay</label>
              <div className="money">
                <span>$</span>
                <input
                  id={`amount-${employee.id}`}
                  className="input"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  value={draft.amount}
                  onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                />
              </div>
            </div>
            {draft.kind === "tool_loan" ? (
              <div className="field">
                <label htmlFor={`loan-${employee.id}`}>Total lent (optional)</label>
                <div className="money">
                  <span>$</span>
                  <input
                    id={`loan-${employee.id}`}
                    className="input"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0.01"
                    value={draft.loanTotal}
                    onChange={(e) => setDraft({ ...draft, loanTotal: e.target.value })}
                  />
                </div>
                <span className="hint">
                  With a total, repayments stop when it&apos;s paid off (the last one is only what&apos;s left). Blank
                  means it continues until you deactivate it.
                </span>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor={`from-${employee.id}`}>First pay period (optional)</label>
              <input
                id={`from-${employee.id}`}
                className="input"
                type="date"
                value={draft.startsOn}
                onChange={(e) => setDraft({ ...draft, startsOn: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor={`until-${employee.id}`}>Last pay period (optional)</label>
              <input
                id={`until-${employee.id}`}
                className="input"
                type="date"
                value={draft.endsOn}
                onChange={(e) => setDraft({ ...draft, endsOn: e.target.value })}
              />
            </div>
          </div>
          {info.t4Question ? (
            <label className="check font-normal items-start">
              <input
                type="checkbox"
                checked={draft.report}
                onChange={(e) => setDraft({ ...draft, report: e.target.checked })}
              />
              <span>{info.t4Question}</span>
            </label>
          ) : null}
          <label className="check font-normal items-start">
            <input
              type="checkbox"
              checked={draft.authorized}
              onChange={(e) => setDraft({ ...draft, authorized: e.target.checked })}
            />
            <span>
              I have the employee&apos;s signed written authorization for this deduction, or it&apos;s required by a
              collective agreement. Alberta doesn&apos;t allow it otherwise (Employment Standards Code s.12), and
              never for faulty work, damage, or cash or property losses.
            </span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : draft.id ? "Save deduction" : "Add deduction"}
            </button>
            <button type="button" className="btn btn-text" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </button>
            <span className="hint">Changes apply to draft pay runs when you recalculate. Finalized stubs don&apos;t change.</span>
          </div>
        </form>
      ) : null}

      {error ? (
        <p className="msg-error" role="alert">
          {error}
        </p>
      ) : null}

      {inactive.length > 0 ? (
        <div>
          <button
            type="button"
            className="btn btn-text -ml-2"
            aria-expanded={showInactive}
            onClick={() => setShowInactive((v) => !v)}
          >
            {showInactive ? "Hide" : "Show"} {inactive.length} deactivated
          </button>
          {showInactive ? <ul className="opacity-80">{inactive.map(row)}</ul> : null}
        </div>
      ) : null}
    </div>
  );
}
