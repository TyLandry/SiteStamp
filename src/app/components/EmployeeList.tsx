"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";

type Employee = {
  id: string;
  full_name: string | null;
  hourly_wage: number | null;
};

export default function EmployeeList() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [wageInput, setWageInput] = useState("");
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    loadEmployees();
  }, []);

  async function loadEmployees() {
    setLoading(true);
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, hourly_wage")
      .eq("role", "employee")
      .order("full_name");

    setEmployees(data ?? []);
    setLoading(false);
  }

  function startEdit(employee: Employee) {
    setEditingId(employee.id);
    setWageInput(employee.hourly_wage != null ? String(employee.hourly_wage) : "");
  }

  async function saveWage(id: string) {
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ hourly_wage: parseFloat(wageInput) })
      .eq("id", id);

    if (!error) {
      setEditingId(null);
      loadEmployees();
    }
    setSaving(false);
  }

  return (
    <div className="border border-gray-300 rounded p-4">
      <h2 className="font-semibold mb-4">Employees</h2>

      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : employees.length === 0 ? (
        <p className="text-sm text-gray-500">No employees yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-300">
              <th className="text-left py-2 font-medium">Name</th>
              <th className="text-left py-2 font-medium">Hourly Wage</th>
              <th className="text-left py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr key={emp.id} className="border-b border-gray-100">
                <td className="py-2">{emp.full_name ?? "—"}</td>
                <td className="py-2">
                  {editingId === emp.id ? (
                    <input
                      type="number"
                      step="0.01"
                      value={wageInput}
                      onChange={(e) => setWageInput(e.target.value)}
                      className="border border-gray-400 rounded px-2 py-1 w-24"
                    />
                  ) : emp.hourly_wage != null ? (
                    `$${emp.hourly_wage.toFixed(2)}`
                  ) : (
                    "Not set"
                  )}
                </td>
                <td className="py-2">
                  {editingId === emp.id ? (
                    <button
                      onClick={() => saveWage(emp.id)}
                      disabled={saving}
                      className="bg-gray-800 text-white rounded px-3 py-1 text-xs disabled:opacity-50"
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                  ) : (
                    <button
                      onClick={() => startEdit(emp)}
                      className="border border-gray-400 rounded px-3 py-1 text-xs hover:bg-gray-100"
                    >
                      Edit
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}