"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { Avatar } from "./ui/Marks";

type Employee = {
  id: string;
  full_name: string | null;
  hourly_wage: number | null;
  extra_tax_per_pay: number | null;
  td1_mode: "basic" | "zero" | "custom" | null;
  tax_claim_amount: number | null;
  tax_claim_provincial: number | null;
  employee_type: "employee" | "subcontractor";
  status: "active" | "terminated";
  terminated_at: string | null;
};

function money(n: number) {
  return Number(n).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

function td1Label(emp: Employee) {
  if (emp.td1_mode === "zero") return "No claim ($0)";
  if (emp.td1_mode === "custom") {
    const f = emp.tax_claim_amount != null ? money(emp.tax_claim_amount) : "basic";
    const p = emp.tax_claim_provincial != null ? money(emp.tax_claim_provincial) : "basic";
    return `Custom: ${f} fed / ${p} AB`;
  }
  return "Basic";
}

// One template for the header and every row; the actions column is fixed so the
// header (which has no buttons) and the rows resolve to the same column widths.
const GRID = "sm:grid sm:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,0.9fr)_minmax(0,1.2fr)_176px] sm:items-center sm:gap-3";

export default function EmployeeList() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [clockedIn, setClockedIn] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [wageInput, setWageInput] = useState("");
  const [extraInput, setExtraInput] = useState("");
  const [td1Mode, setTd1Mode] = useState<"basic" | "zero" | "custom">("basic");
  const [fedClaimInput, setFedClaimInput] = useState("");
  const [provClaimInput, setProvClaimInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showTerminated, setShowTerminated] = useState(false);
  const supabase = createClient();

  async function loadEmployees() {
    setLoading(true);

    const { data, error: loadError } = await supabase
      .from("profiles")
      .select(
        "id, full_name, hourly_wage, extra_tax_per_pay, td1_mode, tax_claim_amount, tax_claim_provincial, employee_type, status, terminated_at"
      )
      .eq("role", "employee")
      .order("full_name");

    if (loadError) setError(loadError.message);
    setEmployees((data as Employee[]) ?? []);

    // Who is currently clocked in (open shift = no clock_out yet)
    const { data: openShifts } = await supabase
      .from("time_entries")
      .select("profile_id")
      .is("clock_out", null);

    setClockedIn(new Set((openShifts ?? []).map((s) => s.profile_id)));
    setLoading(false);
  }

  useEffect(() => {
    // Start the load after the effect runs; the loading state already starts true
    void Promise.resolve().then(loadEmployees);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startEdit(employee: Employee) {
    setError(null);
    setEditingId(employee.id);
    setWageInput(employee.hourly_wage != null ? String(employee.hourly_wage) : "");
    setExtraInput(employee.extra_tax_per_pay != null ? String(Number(employee.extra_tax_per_pay)) : "0");
    setTd1Mode(employee.td1_mode ?? "basic");
    setFedClaimInput(employee.tax_claim_amount != null ? String(Number(employee.tax_claim_amount)) : "");
    setProvClaimInput(
      employee.tax_claim_provincial != null ? String(Number(employee.tax_claim_provincial)) : ""
    );
  }

  function cancelEdit() {
    setEditingId(null);
    setWageInput("");
    setExtraInput("");
    setError(null);
  }

  async function saveEdit(emp: Employee) {
    const wage = parseFloat(wageInput);
    if (wageInput.trim() === "" || Number.isNaN(wage) || wage < 0) {
      setError("Enter a valid wage (0 or more).");
      return;
    }

    // Subcontractors have no tax deductions, so extra tax doesn't apply
    const extra =
      emp.employee_type === "subcontractor"
        ? 0
        : extraInput.trim() === ""
          ? 0
          : parseFloat(extraInput);
    if (Number.isNaN(extra) || extra < 0) {
      setError("Extra tax must be 0 or more.");
      return;
    }

    // TD1: custom needs both totals from the paper forms
    let fedClaim: number | null = null;
    let provClaim: number | null = null;
    if (td1Mode === "custom") {
      fedClaim = parseFloat(fedClaimInput);
      provClaim = parseFloat(provClaimInput);
      if (Number.isNaN(fedClaim) || fedClaim < 0 || Number.isNaN(provClaim) || provClaim < 0) {
        setError("Enter both TD1 totals (federal and Alberta), 0 or more.");
        return;
      }
    }

    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase
      .from("profiles")
      .update({
        hourly_wage: wage,
        extra_tax_per_pay: extra,
        td1_mode: emp.employee_type === "subcontractor" ? "basic" : td1Mode,
        tax_claim_amount: fedClaim,
        tax_claim_provincial: provClaim,
      })
      .eq("id", emp.id);

    if (saveError) {
      setError(saveError.message);
    } else {
      setEditingId(null);
      await loadEmployees();
    }
    setSaving(false);
  }

  async function terminate(emp: Employee) {
    const ok = window.confirm(
      `Mark ${emp.full_name ?? "this person"} terminated? Their records are kept and they'll have read-only access.`
    );
    if (!ok) return;

    setBusyId(emp.id);
    setError(null);
    const { error: termError } = await supabase
      .from("profiles")
      .update({ status: "terminated", terminated_at: new Date().toISOString() })
      .eq("id", emp.id);

    if (termError) setError(termError.message);
    else await loadEmployees();
    setBusyId(null);
  }

  async function reactivate(emp: Employee) {
    setBusyId(emp.id);
    setError(null);
    const { error: reError } = await supabase
      .from("profiles")
      .update({ status: "active", terminated_at: null })
      .eq("id", emp.id);

    if (reError) setError(reError.message);
    else await loadEmployees();
    setBusyId(null);
  }

  const active = employees.filter((e) => e.status !== "terminated");
  const terminated = employees.filter((e) => e.status === "terminated");
  // Fall back to the active list once nobody is left on the terminated one
  const viewingTerminated = showTerminated && terminated.length > 0;
  const list = viewingTerminated ? terminated : active;

  function renderEditor(emp: Employee) {
    const isSub = emp.employee_type === "subcontractor";
    return (
      <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--red-50)] p-3 sm:col-span-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="field">
            <label htmlFor={`wage-${emp.id}`}>Hourly wage</label>
            <div className="money">
              <span>$</span>
              <input
                id={`wage-${emp.id}`}
                className="input"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={wageInput}
                onChange={(e) => setWageInput(e.target.value)}
              />
            </div>
          </div>
          {!isSub ? (
            <>
              <div className="field">
                <label htmlFor={`extra-${emp.id}`}>Extra tax per paycheque</label>
                <div className="money">
                  <span>$</span>
                  <input
                    id={`extra-${emp.id}`}
                    className="input"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={extraInput}
                    onChange={(e) => setExtraInput(e.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor={`td1-${emp.id}`}>TD1 claim</label>
                <select
                  id={`td1-${emp.id}`}
                  className="select"
                  value={td1Mode}
                  onChange={(e) => setTd1Mode(e.target.value as "basic" | "zero" | "custom")}
                >
                  <option value="basic">Basic (default)</option>
                  <option value="zero">No claim ($0) – second job</option>
                  <option value="custom">Custom (from TD1 forms)</option>
                </select>
              </div>
            </>
          ) : (
            <p className="hint sm:col-span-2 self-end pb-2">
              Subcontractors have no tax deductions, so extra tax and TD1 don&apos;t apply.
            </p>
          )}
          {!isSub && td1Mode === "custom" ? (
            <>
              <div className="field">
                <label htmlFor={`fed-${emp.id}`}>Federal TD1 total</label>
                <div className="money">
                  <span>$</span>
                  <input
                    id={`fed-${emp.id}`}
                    className="input"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={fedClaimInput}
                    onChange={(e) => setFedClaimInput(e.target.value)}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor={`prov-${emp.id}`}>Alberta TD1 total</label>
                <div className="money">
                  <span>$</span>
                  <input
                    id={`prov-${emp.id}`}
                    className="input"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={provClaimInput}
                    onChange={(e) => setProvClaimInput(e.target.value)}
                  />
                </div>
              </div>
            </>
          ) : null}
        </div>
        {error ? (
          <p className="msg-error mt-3" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary" onClick={() => saveEdit(emp)} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" className="btn btn-text" onClick={cancelEdit}>
            Cancel
          </button>
          <span className="hint">Only employers can change wages and tax setup.</span>
        </div>
      </div>
    );
  }

  return (
    <section className="panel" aria-labelledby="crew-h">
      <div className="panel-h">
        <h2 id="crew-h">Crew</h2>
        {!loading ? (
          <span className="small muted">
            {active.length} active{terminated.length > 0 ? ` · ${terminated.length} terminated` : ""}
          </span>
        ) : null}
      </div>

      {!loading && terminated.length > 0 ? (
        <div className="tabs px-4" role="tablist" aria-label="Crew status">
          <button
            type="button"
            role="tab"
            aria-selected={!viewingTerminated}
            onClick={() => setShowTerminated(false)}
          >
            Active <span className="faint font-normal">{active.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewingTerminated}
            onClick={() => setShowTerminated(true)}
          >
            Terminated <span className="faint font-normal">{terminated.length}</span>
          </button>
        </div>
      ) : null}

      {error && !editingId ? (
        <p className="msg-error px-4 pt-3" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="panel-body flex flex-col gap-3" aria-busy="true">
          <span className="skeleton w-full" />
          <span className="skeleton w-5/6" />
          <span className="skeleton w-2/3" />
        </div>
      ) : list.length === 0 ? (
        <div className="panel-body pt-3">
          <p className="empty">
            {viewingTerminated ? "No terminated crew." : "No active crew yet. Send an invite to get started."}
          </p>
        </div>
      ) : (
        <>
          <div className={`hidden ${GRID} px-4 pt-3 pb-1 small faint`} aria-hidden="true">
            <span>Name</span>
            <span className="text-right">Hourly wage</span>
            <span className="text-right">Extra tax / pay</span>
            <span className="sm:pl-4">TD1</span>
            <span />
          </div>
          <ul>
            {list.map((emp) => {
              const isClockedIn = clockedIn.has(emp.id);
              const isEditing = editingId === emp.id;
              const isSub = emp.employee_type === "subcontractor";
              const isTerminatedList = emp.status === "terminated";
              return (
                <li
                  key={emp.id}
                  className={`border-t border-[var(--rule)] px-4 py-3 ${GRID} ${isEditing ? "bg-[var(--red-50)]" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3 sm:block min-w-0">
                    <div className="person">
                      <Avatar id={emp.id} name={emp.full_name} />
                      <div className="n">
                        <span>{emp.full_name ?? "—"}</span>
                        <small>
                          {isSub ? "Subcontractor" : "Employee"} ·{" "}
                          {isTerminatedList
                            ? `Terminated${
                                emp.terminated_at ? ` ${new Date(emp.terminated_at).toLocaleDateString()}` : ""
                              }`
                            : isClockedIn
                              ? "On the clock"
                              : "Active"}
                        </small>
                      </div>
                    </div>
                    <div className="sm:hidden text-right font-semibold num whitespace-nowrap">
                      {emp.hourly_wage != null ? (
                        <>
                          {money(emp.hourly_wage)}
                          <span className="small faint font-normal"> /h</span>
                        </>
                      ) : (
                        <span className="pill pill-warn">Wage not set</span>
                      )}
                    </div>
                  </div>

                  <div className="hidden sm:block text-right font-semibold num whitespace-nowrap">
                    {emp.hourly_wage != null ? (
                      <>
                        {money(emp.hourly_wage)}
                        <span className="small faint font-normal"> /h</span>
                      </>
                    ) : (
                      <span className="pill pill-warn">Not set</span>
                    )}
                  </div>
                  <div className="hidden sm:block text-right num">
                    {isSub ? (
                      <span className="faint">—</span>
                    ) : Number(emp.extra_tax_per_pay ?? 0) > 0 ? (
                      money(Number(emp.extra_tax_per_pay))
                    ) : (
                      <span className="faint">None</span>
                    )}
                  </div>
                  <div className="hidden sm:block min-w-0 truncate sm:pl-4">
                    {isSub ? (
                      <span className="faint">—</span>
                    ) : (
                      <span className={emp.td1_mode && emp.td1_mode !== "basic" ? "" : "faint"}>
                        {td1Label(emp)}
                      </span>
                    )}
                  </div>

                  {/* Phone: tax setup as a second line */}
                  {!isSub ? (
                    <p className="sm:hidden small muted mt-1 pl-[38px]">
                      Extra tax{" "}
                      {Number(emp.extra_tax_per_pay ?? 0) > 0 ? money(Number(emp.extra_tax_per_pay)) : "none"} · TD1{" "}
                      {td1Label(emp)}
                    </p>
                  ) : null}

                  <div className="mt-2 sm:mt-0 flex flex-wrap items-center gap-1 sm:justify-end pl-[38px] sm:pl-0">
                    {!isEditing ? (
                      <button type="button" className="btn btn-text" onClick={() => startEdit(emp)}>
                        Edit
                      </button>
                    ) : null}
                    {isTerminatedList ? (
                      <button
                        type="button"
                        className="btn btn-text"
                        onClick={() => reactivate(emp)}
                        disabled={busyId === emp.id}
                      >
                        Reactivate
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-text btn-danger"
                        onClick={() => terminate(emp)}
                        disabled={isClockedIn || busyId === emp.id}
                        title={isClockedIn ? "Can't terminate while they're clocked in" : undefined}
                      >
                        Terminate
                      </button>
                    )}
                  </div>

                  {isEditing ? renderEditor(emp) : null}
                </li>
              );
            })}
          </ul>
          {!viewingTerminated && active.some((e) => clockedIn.has(e.id)) ? (
            <p className="title-block">People on the clock can&apos;t be terminated until they clock out.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
