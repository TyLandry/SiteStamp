"use client";

import { useState, useEffect } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "./ui/Icons";
import { createClient } from "@/utils/supabase/client";
import { addDays, getPeriod, fmtDate, parseLocalDate, toDateInput } from "@/utils/payPeriods";
import {
  type EmployeeReview,
  type OrgSettings,
  type PayRun,
  type PayRunInput,
  type StubRow,
  CALC_VERSION,
  DEFAULT_ORG_SETTINGS,
  loadOrgSettings,
  buildStubs,
} from "@/utils/payRun";
import PayRunReview from "./PayRunReview";

type Stub = StubRow & { id: string };

// A saved draft no longer matches what the current hours and settings produce
function draftIsStale(saved: Stub[], fresh: StubRow[]) {
  if (saved.length !== fresh.length) return true;
  // Calculated by older rules (e.g. before vacation and holiday pay existed)
  if (saved.some((s) => s.calc_version !== CALC_VERSION)) return true;
  const byPerson = new Map(saved.map((s) => [s.profile_id, s]));
  return fresh.some((f) => {
    const s = byPerson.get(f.profile_id);
    return (
      !s ||
      Number(s.gross) !== f.gross ||
      Number(s.net_pay) !== f.net_pay ||
      Number(s.other_deductions_total) !== f.other_deductions_total
    );
  });
}

function money(n: number) {
  return Number(n).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

function periodLabel(r: { period_start: string; period_end: string }) {
  return `${fmtDate(parseLocalDate(r.period_start))} – ${fmtDate(parseLocalDate(r.period_end))}`;
}

export default function PayRuns() {
  const supabase = createClient();
  const [settings, setSettings] = useState<OrgSettings>(DEFAULT_ORG_SETTINGS);
  const [runs, setRuns] = useState<PayRun[]>([]);
  const [selected, setSelected] = useState<PayRun | null>(null);
  const [stubs, setStubs] = useState<Stub[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [review, setReview] = useState<EmployeeReview[]>([]);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New pay run form: defaults to the most recent period that has ended
  const [refDate, setRefDate] = useState(() => addDays(new Date(), -1));
  // The pay date defaults to the period's last day; an edit only sticks to the
  // period it was made for, so changing the period resets it.
  const [payDateEdit, setPayDateEdit] = useState<{ period: string; value: string } | null>(null);

  const newPeriod = getPeriod(settings, refDate);
  const newPeriodStart = toDateInput(newPeriod.start);
  const newPeriodEnd = toDateInput(newPeriod.end);
  const payDate = payDateEdit?.period === newPeriodEnd ? payDateEdit.value : newPeriodEnd;
  const setPayDate = (value: string) => setPayDateEdit({ period: newPeriodEnd, value });

  useEffect(() => {
    (async () => {
      const s = await loadOrgSettings(supabase);
      setSettings(s);
      // Start on the last period that has fully ended
      const current = getPeriod(s, new Date());
      setRefDate(addDays(current.start, -1));
      await loadRuns();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRuns() {
    const { data, error: loadError } = await supabase
      .from("pay_runs")
      .select("id, org_id, period_start, period_end, pay_date, status, finalized_at")
      .order("period_start", { ascending: false });
    if (loadError) setError(loadError.message);
    setRuns((data as PayRun[]) ?? []);
  }

  async function loadStubs(run: PayRun) {
    const { data, error: loadError } = await supabase
      .from("pay_stubs")
      .select("*")
      .eq("pay_run_id", run.id);
    if (loadError) setError(loadError.message);
    const list = ((data as Stub[]) ?? []).sort((a, b) =>
      String(a.details?.full_name ?? "").localeCompare(String(b.details?.full_name ?? ""))
    );
    setStubs(list);
    return list;
  }

  async function openRun(run: PayRun) {
    setError(null);
    setWarnings([]);
    setReview([]);
    setStale(false);
    setSelected(run);
    const saved = await loadStubs(run);
    if (run.status !== "draft") return;
    // Work the draft out again without saving, to show its warnings and
    // decisions and to spot hours or settings that changed since it was saved
    setBusy(true);
    try {
      const preview = await buildStubs(supabase, run, settings);
      setWarnings(preview.warnings);
      setReview(preview.review);
      setStale(draftIsStale(saved, preview.stubs));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check this draft.");
    }
    setBusy(false);
  }

  // Save one person's vacation / holiday decisions for this draft, then rebuild it
  async function saveInput(run: PayRun, input: Omit<PayRunInput, "pay_run_id" | "org_id">) {
    setError(null);
    const { error: saveError } = await supabase
      .from("pay_run_inputs")
      .upsert({ ...input, pay_run_id: run.id, org_id: run.org_id }, { onConflict: "pay_run_id,profile_id" });
    if (saveError) {
      setError(saveError.message);
      return;
    }
    await calculate(run);
  }

  // Delete this run's draft stubs and rebuild them from current hours and rates
  async function calculate(run: PayRun) {
    setBusy(true);
    setError(null);
    try {
      const { stubs: built, warnings: w, review: r } = await buildStubs(supabase, run, settings);
      setWarnings(w);
      setReview(r);
      setStale(false);

      const { error: delError } = await supabase.from("pay_stubs").delete().eq("pay_run_id", run.id);
      if (delError) throw new Error(delError.message);

      if (built.length > 0) {
        const { error: insError } = await supabase.from("pay_stubs").insert(built);
        if (insError) throw new Error(insError.message);
      }
      await loadStubs(run);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not calculate pay.");
    }
    setBusy(false);
  }

  async function createRun() {
    setBusy(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("You're not logged in.");
      setBusy(false);
      return;
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .single();

    const { data, error: insError } = await supabase
      .from("pay_runs")
      .insert({
        org_id: profile?.org_id,
        period_start: newPeriodStart,
        period_end: newPeriodEnd,
        pay_date: payDate || newPeriodEnd,
        created_by: user.id,
      })
      .select("id, org_id, period_start, period_end, pay_date, status, finalized_at")
      .single();

    if (insError || !data) {
      setError(
        insError?.code === "23505"
          ? "A pay run for this period already exists. Open it from the list below."
          : insError?.message ?? "Could not create pay run."
      );
      setBusy(false);
      return;
    }

    await loadRuns();
    setSelected(data as PayRun);
    setBusy(false);
    await calculate(data as PayRun);
  }

  async function finalize(run: PayRun) {
    const extra = warnings.length > 0 ? "\n\nThere are warnings above that you haven't fixed." : "";
    const ok = window.confirm(
      `Finalize the pay run for ${periodLabel(run)}?\n\nStubs will be locked and visible to employees. This can't be undone.${extra}`
    );
    if (!ok) return;

    setBusy(true);
    setError(null);
    const { data, error: updError } = await supabase
      .from("pay_runs")
      .update({ status: "finalized", finalized_at: new Date().toISOString() })
      .eq("id", run.id)
      .select("id, org_id, period_start, period_end, pay_date, status, finalized_at")
      .single();

    if (updError) setError(updError.message);
    else {
      setSelected(data as PayRun);
      await loadRuns();
    }
    setBusy(false);
  }

  async function deleteDraft(run: PayRun) {
    if (!window.confirm(`Delete the draft pay run for ${periodLabel(run)}?`)) return;
    setBusy(true);
    setError(null);
    const { error: delError } = await supabase.from("pay_runs").delete().eq("id", run.id);
    if (delError) setError(delError.message);
    else {
      setSelected(null);
      setStubs([]);
      setWarnings([]);
      setReview([]);
      setStale(false);
      await loadRuns();
    }
    setBusy(false);
  }

  // ---------- totals ----------
  const sum = (key: keyof StubRow) => stubs.reduce((s, x) => s + Number(x[key] ?? 0), 0);
  const totalGross = sum("gross");
  const totalNet = sum("net_pay");
  const employeeCpp = sum("cpp") + sum("cpp2");
  const employerCpp = sum("employer_cpp") + sum("employer_cpp2");
  const employeeEi = sum("ei");
  const employerEi = sum("employer_ei");
  const tax = sum("federal_tax") + sum("provincial_tax");
  const remittance = employeeCpp + employerCpp + employeeEi + employerEi + tax;
  const otherDeductions = sum("other_deductions_total");
  const vacationPaid = sum("vacation_pay_paid");
  const holidayPaid = sum("general_holiday_pay") + sum("holiday_pay_paid");

  // Withheld custom deductions, grouped by name, to pass on to unions / plans
  const withheld = new Map<string, number>();
  for (const s of stubs) {
    for (const d of s.other_deductions ?? []) {
      withheld.set(d.name, (withheld.get(d.name) ?? 0) + Number(d.amount));
    }
  }

  if (loading) {
    return (
      <div className="panel p-4 flex flex-col gap-3" aria-busy="true">
        <span className="skeleton w-48" />
        <span className="skeleton w-full" />
        <span className="skeleton w-2/3" />
      </div>
    );
  }

  const statusPill = (status: PayRun["status"]) =>
    status === "finalized" ? (
      <span className="pill pill-ok">Finalized</span>
    ) : (
      <span className="pill pill-warn">Draft</span>
    );

  return (
    <div className="stack">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_384px] items-start">
        {/* ---------- New pay run ---------- */}
        <section className="panel" aria-labelledby="new-run-h">
          <div className="panel-h">
            <h2 id="new-run-h">New pay run</h2>
          </div>
          <div className="panel-body flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-end">
              <div className="field">
                <span className="label" id="period-label">
                  Pay period
                </span>
                <div className="flex items-center gap-2" role="group" aria-labelledby="period-label">
                  <button
                    type="button"
                    className="btn px-3"
                    onClick={() => setRefDate(addDays(newPeriod.start, -1))}
                    aria-label="Previous period"
                  >
                    <ChevronLeftIcon />
                  </button>
                  <span className="flex-1 text-center font-semibold whitespace-nowrap">
                    {fmtDate(newPeriod.start)} – {fmtDate(newPeriod.end)}
                  </span>
                  <button
                    type="button"
                    className="btn px-3"
                    onClick={() => setRefDate(addDays(newPeriod.end, 1))}
                    aria-label="Next period"
                  >
                    <ChevronRightIcon />
                  </button>
                </div>
              </div>
              <div className="field">
                <label htmlFor="pay-date">Pay date</label>
                <input
                  id="pay-date"
                  className="input"
                  type="date"
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                />
              </div>
              <button type="button" onClick={createRun} disabled={busy} className="btn btn-primary">
                {busy ? "Working…" : "Create pay run"}
              </button>
            </div>
            <p className="hint">
              The pay date decides which tax year and rates apply, and counts toward that year&apos;s CPP
              and EI maximums.
            </p>
          </div>
        </section>

        {/* ---------- Past runs ---------- */}
        <section className="panel" aria-labelledby="runs-h">
          <div className="panel-h">
            <h2 id="runs-h">Pay runs</h2>
            <span className="small muted">{runs.length}</span>
          </div>
          {runs.length === 0 ? (
            <div className="panel-body">
              <p className="empty">No pay runs yet. Create one for the last period that ended.</p>
            </div>
          ) : (
            <ul>
              {runs.map((r) => {
                const isOpen = selected?.id === r.id;
                return (
                  <li key={r.id} className={`list-row ${isOpen ? "bg-[var(--active)]" : ""}`}>
                    <div className="min-w-0">
                      <div className="font-semibold">{periodLabel(r)}</div>
                      <div className="small muted">Pay date {fmtDate(parseLocalDate(r.pay_date))}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {statusPill(r.status)}
                      <button
                        type="button"
                        onClick={() => openRun(r)}
                        className="btn btn-text"
                        aria-current={isOpen ? "true" : undefined}
                      >
                        Open
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {error && (
        <p className="msg-error" role="alert">
          {error}
        </p>
      )}

      {/* ---------- Selected run ---------- */}
      {selected && (
        <section className="panel" aria-labelledby="run-h">
          <div className="panel-h flex-wrap items-center">
            <div className="min-w-0">
              <h2 id="run-h">{periodLabel(selected)}</h2>
              <p className="small muted mt-0.5 flex items-center gap-2">
                Pay date {fmtDate(parseLocalDate(selected.pay_date))} {statusPill(selected.status)}
              </p>
            </div>
            {selected.status === "draft" && (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => calculate(selected)} disabled={busy} className="btn">
                  Recalculate
                </button>
                <button
                  type="button"
                  onClick={() => deleteDraft(selected)}
                  disabled={busy}
                  className="btn btn-text btn-danger"
                >
                  Delete draft
                </button>
                <button
                  type="button"
                  onClick={() => finalize(selected)}
                  disabled={busy || stubs.length === 0 || stale}
                  title={stale ? "Recalculate first" : undefined}
                  className="btn btn-primary"
                >
                  Finalize
                </button>
              </div>
            )}
          </div>

          {stale && selected.status === "draft" && (
            <p className="notice mx-4 mb-4" role="status">
              Hours, wages or pay settings changed since this draft was calculated. Recalculate before finalizing.
            </p>
          )}

          {warnings.length > 0 && (
            <ul className="notice mx-4 mb-4 list-disc pl-8">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}

          {stubs.length === 0 ? (
            <div className="panel-body">
              <p className="empty">No one worked in this period.</p>
            </div>
          ) : (
            <>
              {/* Phone: one row per person, net pay first */}
              <ul className="xl:hidden">
                {stubs.map((s) => (
                  <li key={s.id} className="list-row items-start">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">
                        {String(s.details?.full_name ?? "Unknown")}
                        {s.employee_type === "subcontractor" && (
                          <span className="small faint font-normal"> · sub</span>
                        )}
                      </div>
                      <div className="small muted">
                        {Number(s.regular_hours).toFixed(2)} h
                        {Number(s.overtime_hours) > 0 ? ` + ${Number(s.overtime_hours).toFixed(2)} h OT` : ""} ·
                        Gross {money(s.gross)}
                      </div>
                      <div className="small faint">
                        CPP {money(Number(s.cpp) + Number(s.cpp2))} · EI {money(s.ei)} · Tax{" "}
                        {money(Number(s.federal_tax) + Number(s.provincial_tax))}
                        {Number(s.other_deductions_total) > 0 ? ` · Other ${money(s.other_deductions_total)}` : ""}
                        {Number(s.gst) > 0 ? ` · GST ${money(s.gst)}` : ""}
                      </div>
                      {Number(s.vacation_pay_paid ?? 0) + Number(s.general_holiday_pay ?? 0) + Number(s.holiday_pay_paid ?? 0) > 0 ? (
                        <div className="small faint">
                          Includes
                          {Number(s.general_holiday_pay ?? 0) + Number(s.holiday_pay_paid ?? 0) > 0
                            ? ` holiday pay ${money(Number(s.general_holiday_pay ?? 0) + Number(s.holiday_pay_paid ?? 0))}`
                            : ""}
                          {Number(s.vacation_pay_paid ?? 0) > 0 ? ` vacation pay ${money(Number(s.vacation_pay_paid))}` : ""}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="font-semibold num">{money(s.net_pay)}</span>
                      <a className="btn btn-text" href={`/paystub/${s.id}`} target="_blank" rel="noopener noreferrer">
                        View
                      </a>
                    </div>
                  </li>
                ))}
              </ul>

              {/* Tablet and desktop: full breakdown */}
              <div className="table-wrap hidden xl:block px-1 pb-2">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th className="num">Reg hrs</th>
                      <th className="num">OT hrs</th>
                      <th className="num">Holiday</th>
                      <th className="num">Vacation</th>
                      <th className="num">Gross</th>
                      <th className="num">CPP</th>
                      <th className="num">EI</th>
                      <th className="num">Tax</th>
                      <th className="num">Other</th>
                      <th className="num">GST</th>
                      <th className="num">Net pay</th>
                      <th>
                        <span className="sr-only">Pay stub</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {stubs.map((s) => (
                      <tr key={s.id}>
                        <td className="whitespace-nowrap">
                          {String(s.details?.full_name ?? "Unknown")}
                          {s.employee_type === "subcontractor" && <small>Subcontractor</small>}
                        </td>
                        <td className="num">{Number(s.regular_hours).toFixed(2)}</td>
                        <td className="num">{Number(s.overtime_hours).toFixed(2)}</td>
                        <td className="num">
                          {Number(s.general_holiday_pay ?? 0) + Number(s.holiday_pay_paid ?? 0) > 0 ? (
                            money(Number(s.general_holiday_pay ?? 0) + Number(s.holiday_pay_paid ?? 0))
                          ) : (
                            <span className="faint">—</span>
                          )}
                        </td>
                        <td className="num">
                          {Number(s.vacation_pay_paid ?? 0) > 0 ? money(Number(s.vacation_pay_paid)) : <span className="faint">—</span>}
                        </td>
                        <td className="num">{money(s.gross)}</td>
                        <td className="num">{money(Number(s.cpp) + Number(s.cpp2))}</td>
                        <td className="num">{money(s.ei)}</td>
                        <td className="num">{money(Number(s.federal_tax) + Number(s.provincial_tax))}</td>
                        <td className="num">
                          {Number(s.other_deductions_total) > 0 ? money(s.other_deductions_total) : <span className="faint">—</span>}
                        </td>
                        <td className="num">{Number(s.gst) > 0 ? money(s.gst) : <span className="faint">—</span>}</td>
                        <td className="num font-semibold">{money(s.net_pay)}</td>
                        <td className="num">
                          <a className="btn btn-text" href={`/paystub/${s.id}`} target="_blank" rel="noopener noreferrer">
                            View
                          </a>
                        </td>
                      </tr>
                    ))}
                    <tr className="total">
                      <td colSpan={3}>Total</td>
                      <td className="num">{money(holidayPaid)}</td>
                      <td className="num">{money(vacationPaid)}</td>
                      <td className="num">{money(totalGross)}</td>
                      <td className="num">{money(employeeCpp)}</td>
                      <td className="num">{money(employeeEi)}</td>
                      <td className="num">{money(tax)}</td>
                      <td className="num">{money(otherDeductions)}</td>
                      <td className="num">{money(sum("gst"))}</td>
                      <td className="num">{money(totalNet)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="grid sm:grid-cols-2 border-t border-[var(--border)] sm:divide-x divide-[var(--border)]">
                <div className="stat">
                  <span className="small muted">To pay staff (e-transfer)</span>
                  <span className="v">{money(totalNet)}</span>
                </div>
                <div className="stat border-t sm:border-t-0 border-[var(--border)]">
                  <span className="small muted">To remit to CRA</span>
                  <span className="v">{money(remittance)}</span>
                  <span className="small faint">
                    CPP {money(employeeCpp)} + employer {money(employerCpp)} · EI {money(employeeEi)} +
                    employer {money(employerEi)} · Tax {money(tax)}
                  </span>
                </div>
              </div>
              {withheld.size > 0 ? (
                <div className="title-block flex-col">
                  <span>
                    <b>Other deductions withheld {money(otherDeductions)}</b>: not a CRA remittance. Send union dues and
                    plan premiums on to the union or plan; loan repayments stay with the company.
                  </span>
                  <span>
                    {[...withheld].map(([name, amount]) => `${name} ${money(amount)}`).join(" · ")}
                  </span>
                </div>
              ) : null}
            </>
          )}
        </section>
      )}

      {selected?.status === "draft" && review.length > 0 ? (
        <PayRunReview
          run={selected}
          review={review}
          busy={busy}
          onSave={(input) => saveInput(selected, input)}
        />
      ) : null}
    </div>
  );
}
