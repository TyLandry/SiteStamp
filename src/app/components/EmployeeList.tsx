"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";

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
  return `$${Number(n).toFixed(2)}`;
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

  useEffect(() => {
    loadEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  function renderTable(list: Employee[], isTerminatedList: boolean) {
    return (
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-300">
            <th className="text-left py-2 font-medium">Name</th>
            <th className="text-left py-2 font-medium">Type</th>
            <th className="text-left py-2 font-medium">Status</th>
            <th className="text-left py-2 font-medium">Hourly Wage</th>
            <th className="text-left py-2 font-medium">Extra Tax / Pay</th>
            <th className="text-left py-2 font-medium">TD1</th>
            <th className="text-left py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {list.map((emp) => {
            const isClockedIn = clockedIn.has(emp.id);
            const isEditing = editingId === emp.id;
            const isSub = emp.employee_type === "subcontractor";
            return (
              <tr key={emp.id} className="border-b border-gray-100">
                <td className="py-2">{emp.full_name ?? "—"}</td>
                <td className="py-2">{isSub ? "Subcontractor" : "Employee"}</td>
                <td className="py-2">
                  {isTerminatedList
                    ? `Terminated · ${
                        emp.terminated_at
                          ? new Date(emp.terminated_at).toLocaleDateString()
                          : ""
                      }`
                    : "Active"}
                </td>
                <td className="py-2">
                  {isEditing ? (
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={wageInput}
                      onChange={(e) => setWageInput(e.target.value)}
                      className="border border-gray-400 rounded px-2 py-1 w-24"
                    />
                  ) : emp.hourly_wage != null ? (
                    money(emp.hourly_wage)
                  ) : (
                    "Not set"
                  )}
                </td>
                <td className="py-2">
                  {isSub ? (
                    <span className="text-gray-400">—</span>
                  ) : isEditing ? (
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={extraInput}
                      onChange={(e) => setExtraInput(e.target.value)}
                      className="border border-gray-400 rounded px-2 py-1 w-24"
                    />
                  ) : Number(emp.extra_tax_per_pay ?? 0) > 0 ? (
                    money(Number(emp.extra_tax_per_pay))
                  ) : (
                    <span className="text-gray-400">None</span>
                  )}
                </td>
                <td className="py-2">
                  {isSub ? (
                    <span className="text-gray-400">—</span>
                  ) : isEditing ? (
                    <div className="flex flex-col gap-1">
                      <select
                        value={td1Mode}
                        onChange={(e) => setTd1Mode(e.target.value as "basic" | "zero" | "custom")}
                        className="border border-gray-400 rounded px-2 py-1 text-xs"
                      >
                        <option value="basic">Basic (default)</option>
                        <option value="zero">No claim ($0) – second job</option>
                        <option value="custom">Custom (from TD1 forms)</option>
                      </select>
                      {td1Mode === "custom" && (
                        <div className="flex gap-1">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="Federal"
                            value={fedClaimInput}
                            onChange={(e) => setFedClaimInput(e.target.value)}
                            className="border border-gray-400 rounded px-2 py-1 w-24 text-xs"
                          />
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="Alberta"
                            value={provClaimInput}
                            onChange={(e) => setProvClaimInput(e.target.value)}
                            className="border border-gray-400 rounded px-2 py-1 w-24 text-xs"
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className={emp.td1_mode && emp.td1_mode !== "basic" ? "" : "text-gray-400"}>
                      {td1Label(emp)}
                    </span>
                  )}
                </td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => saveEdit(emp)}
                          disabled={saving}
                          className="bg-gray-800 text-white rounded px-3 py-1 text-xs disabled:opacity-50"
                        >
                          {saving ? "Saving..." : "Save"}
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="border border-gray-400 rounded px-3 py-1 text-xs hover:bg-gray-100"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => startEdit(emp)}
                        className="border border-gray-400 rounded px-3 py-1 text-xs hover:bg-gray-100"
                      >
                        Edit
                      </button>
                    )}

                    {isTerminatedList ? (
                      <button
                        onClick={() => reactivate(emp)}
                        disabled={busyId === emp.id}
                        className="border border-gray-400 rounded px-3 py-1 text-xs hover:bg-gray-100 disabled:opacity-50"
                      >
                        Reactivate
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => terminate(emp)}
                          disabled={isClockedIn || busyId === emp.id}
                          className="text-red-600 text-xs px-2 py-1 hover:underline disabled:opacity-40 disabled:no-underline"
                        >
                          Terminate
                        </button>
                        {isClockedIn && (
                          <span className="text-xs text-gray-500">Clocked in</span>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  return (
    <div className="border border-gray-300 rounded p-4">
      <h2 className="font-semibold mb-4">Employees</h2>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : active.length === 0 ? (
        <p className="text-sm text-gray-500">No active employees.</p>
      ) : (
        renderTable(active, false)
      )}

      {!loading && terminated.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowTerminated((v) => !v)}
            className="text-sm text-gray-600 hover:underline"
          >
            {showTerminated ? "Hide" : "Show"} terminated ({terminated.length})
          </button>
          {showTerminated && (
            <div className="mt-3">
              <h3 className="font-medium text-sm mb-2">Terminated</h3>
              {renderTable(terminated, true)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}