"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";

type Employee = {
  id: string;
  full_name: string | null;
  hourly_wage: number | null;
  employee_type: "employee" | "subcontractor";
  status: "active" | "terminated";
  terminated_at: string | null;
};

export default function EmployeeList() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [clockedIn, setClockedIn] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [wageInput, setWageInput] = useState("");
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
      .select("id, full_name, hourly_wage, employee_type, status, terminated_at")
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
  }

  function cancelEdit() {
    setEditingId(null);
    setWageInput("");
    setError(null);
  }

  async function saveWage(id: string) {
    const wage = parseFloat(wageInput);
    if (wageInput.trim() === "" || Number.isNaN(wage) || wage < 0) {
      setError("Enter a valid wage (0 or more).");
      return;
    }

    setSaving(true);
    setError(null);
    const { error: saveError } = await supabase
      .from("profiles")
      .update({ hourly_wage: wage })
      .eq("id", id);

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
            <th className="text-left py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {list.map((emp) => {
            const isClockedIn = clockedIn.has(emp.id);
            return (
              <tr key={emp.id} className="border-b border-gray-100">
                <td className="py-2">{emp.full_name ?? "—"}</td>
                <td className="py-2">
                  {emp.employee_type === "subcontractor" ? "Subcontractor" : "Employee"}
                </td>
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
                  {editingId === emp.id ? (
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={wageInput}
                      onChange={(e) => setWageInput(e.target.value)}
                      className="border border-gray-400 rounded px-2 py-1 w-24"
                    />
                  ) : emp.hourly_wage != null ? (
                    `$${Number(emp.hourly_wage).toFixed(2)}`
                  ) : (
                    "Not set"
                  )}
                </td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    {editingId === emp.id ? (
                      <>
                        <button
                          onClick={() => saveWage(emp.id)}
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
                        Edit wage
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