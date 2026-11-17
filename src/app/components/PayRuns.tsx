"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { addDays, getPeriod, fmtDate, parseLocalDate, toDateInput } from "@/utils/payPeriods";
import {
  type OrgSettings,
  type PayRun,
  type StubRow,
  DEFAULT_ORG_SETTINGS,
  loadOrgSettings,
  buildStubs,
} from "@/utils/payRun";

type Stub = StubRow & { id: string };

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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New pay run form: defaults to the most recent period that has ended
  const [refDate, setRefDate] = useState(() => addDays(new Date(), -1));
  const [payDate, setPayDate] = useState("");

  const newPeriod = getPeriod(settings, refDate);
  const newPeriodStart = toDateInput(newPeriod.start);
  const newPeriodEnd = toDateInput(newPeriod.end);

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

  // Default the pay date to the period's last day whenever the period changes
  useEffect(() => {
    setPayDate(newPeriodEnd);
  }, [newPeriodEnd]);

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
  }

  async function openRun(run: PayRun) {
    setError(null);
    setWarnings([]);
    setSelected(run);
    await loadStubs(run);
  }

  // Delete this run's draft stubs and rebuild them from current hours and rates
  async function calculate(run: PayRun) {
    setBusy(true);
    setError(null);
    try {
      const { stubs: built, warnings: w } = await buildStubs(supabase, run, settings);
      setWarnings(w);

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

  if (loading) {
    return (
      <div className="border border-gray-300 rounded p-4">
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ---------- New pay run ---------- */}
      <div className="border border-gray-300 rounded p-4">
        <h2 className="font-semibold mb-3">New Pay Run</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Pay period</label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setRefDate(addDays(newPeriod.start, -1))}
                className="border border-gray-400 rounded px-2 py-1 text-xs hover:bg-gray-100"
              >
                ←
              </button>
              <span className="text-sm w-56 text-center">
                {fmtDate(newPeriod.start)} – {fmtDate(newPeriod.end)}
              </span>
              <button
                onClick={() => setRefDate(addDays(newPeriod.end, 1))}
                className="border border-gray-400 rounded px-2 py-1 text-xs hover:bg-gray-100"
              >
                →
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Pay date</label>
            <input
              type="date"
              value={payDate}
              onChange={(e) => setPayDate(e.target.value)}
              className="border border-gray-400 rounded px-3 py-1.5 text-sm"
            />
          </div>
          <button
            onClick={createRun}
            disabled={busy}
            className="bg-gray-800 text-white rounded px-4 py-2 text-sm disabled:opacity-50"
          >
            {busy ? "Working..." : "Create pay run"}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          The pay date decides which tax year and rates apply, and counts toward that year&apos;s CPP and EI maximums.
        </p>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {/* ---------- Selected run ---------- */}
      {selected && (
        <div className="border border-gray-300 rounded p-4">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="font-semibold">Pay Run: {periodLabel(selected)}</h2>
              <p className="text-sm text-gray-500">
                Pay date {fmtDate(parseLocalDate(selected.pay_date))} ·{" "}
                {selected.status === "finalized" ? (
                  <span className="text-green-700">Finalized</span>
                ) : (
                  <span className="text-amber-600">Draft</span>
                )}
              </p>
            </div>
            {selected.status === "draft" && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => calculate(selected)}
                  disabled={busy}
                  className="border border-gray-400 rounded px-3 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-50"
                >
                  Recalculate
                </button>
                <button
                  onClick={() => deleteDraft(selected)}
                  disabled={busy}
                  className="text-red-600 text-sm px-2 py-1.5 hover:underline disabled:opacity-50"
                >
                  Delete draft
                </button>
                <button
                  onClick={() => finalize(selected)}
                  disabled={busy || stubs.length === 0}
                  className="bg-gray-800 text-white rounded px-4 py-1.5 text-sm disabled:opacity-50"
                >
                  Finalize
                </button>
              </div>
            )}
          </div>

          {warnings.length > 0 && (
            <ul className="mb-4 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 list-disc list-inside">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}

          {stubs.length === 0 ? (
            <p className="text-sm text-gray-500">No one worked in this period.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-300">
                      <th className="text-left py-2 font-medium">Name</th>
                      <th className="text-right py-2 font-medium">Reg hrs</th>
                      <th className="text-right py-2 font-medium">OT hrs</th>
                      <th className="text-right py-2 font-medium">Gross</th>
                      <th className="text-right py-2 font-medium">CPP</th>
                      <th className="text-right py-2 font-medium">EI</th>
                      <th className="text-right py-2 font-medium">Tax</th>
                      <th className="text-right py-2 font-medium">GST</th>
                      <th className="text-right py-2 font-medium">Net Pay</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {stubs.map((s) => (
                      <tr key={s.id} className="border-b border-gray-100">
                        <td className="py-2">
                          {String(s.details?.full_name ?? "Unknown")}
                          {s.employee_type === "subcontractor" && (
                            <span className="text-xs text-gray-500"> (sub)</span>
                          )}
                        </td>
                        <td className="py-2 text-right">{Number(s.regular_hours).toFixed(2)}</td>
                        <td className="py-2 text-right">{Number(s.overtime_hours).toFixed(2)}</td>
                        <td className="py-2 text-right">{money(s.gross)}</td>
                        <td className="py-2 text-right">{money(Number(s.cpp) + Number(s.cpp2))}</td>
                        <td className="py-2 text-right">{money(s.ei)}</td>
                        <td className="py-2 text-right">
                          {money(Number(s.federal_tax) + Number(s.provincial_tax))}
                        </td>
                        <td className="py-2 text-right">{Number(s.gst) > 0 ? money(s.gst) : "—"}</td>
                        <td className="py-2 text-right font-medium">{money(s.net_pay)}</td>
                        <td className="py-2 text-right">
                          <a
                            href={`/paystub/${s.id}`}
                            target="_blank"
                            className="border border-gray-400 rounded px-3 py-1 text-xs hover:bg-gray-100"
                          >
                            View
                          </a>
                        </td>
                      </tr>
                    ))}
                    <tr className="font-medium">
                      <td className="py-2" colSpan={3}>Total</td>
                      <td className="py-2 text-right">{money(totalGross)}</td>
                      <td className="py-2 text-right">{money(employeeCpp)}</td>
                      <td className="py-2 text-right">{money(employeeEi)}</td>
                      <td className="py-2 text-right">{money(tax)}</td>
                      <td className="py-2 text-right">{money(sum("gst"))}</td>
                      <td className="py-2 text-right">{money(totalNet)}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div className="bg-gray-50 border border-gray-200 rounded px-3 py-2">
                  <p className="font-medium mb-1">To pay staff (e-transfer)</p>
                  <p>{money(totalNet)}</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded px-3 py-2">
                  <p className="font-medium mb-1">To remit to CRA</p>
                  <p>{money(remittance)}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    CPP {money(employeeCpp)} + employer {money(employerCpp)} · EI {money(employeeEi)} +
                    employer {money(employerEi)} · Tax {money(tax)}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------- Past runs ---------- */}
      <div className="border border-gray-300 rounded p-4">
        <h2 className="font-semibold mb-3">Pay Runs</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-gray-500">No pay runs yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-300">
                <th className="text-left py-2 font-medium">Period</th>
                <th className="text-left py-2 font-medium">Pay date</th>
                <th className="text-left py-2 font-medium">Status</th>
                <th className="text-left py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-gray-100">
                  <td className="py-2">{periodLabel(r)}</td>
                  <td className="py-2">{fmtDate(parseLocalDate(r.pay_date))}</td>
                  <td className="py-2">
                    {r.status === "finalized" ? (
                      <span className="text-green-700">Finalized</span>
                    ) : (
                      <span className="text-amber-600">Draft</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => openRun(r)}
                      className="border border-gray-400 rounded px-3 py-1 text-xs hover:bg-gray-100"
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}