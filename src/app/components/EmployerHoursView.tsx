"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import {
  type PaySettings,
  DEFAULT_PAY_SETTINGS,
  addDays,
  getPeriod,
  fmtDate,
} from "@/utils/payPeriods";
import {
  type OvertimeSettings,
  DEFAULT_OVERTIME_SETTINGS,
  splitHours,
  startOfWorkWeek,
} from "@/utils/overtime";

type Settings = PaySettings & OvertimeSettings;

const DEFAULT_SETTINGS: Settings = {
  ...DEFAULT_PAY_SETTINGS,
  ...DEFAULT_OVERTIME_SETTINGS,
};

type Person = {
  id: string;
  full_name: string | null;
  hourly_wage: number | null;
  employee_type: string;
  status: string;
};

type Entry = {
  id: string;
  clock_in: string;
  clock_out: string | null;
  clock_in_location: string | null;
  clock_out_location: string | null;
  profile_id: string;
};

function money(n: number) {
  return n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

function shiftHours(e: Entry) {
  if (!e.clock_out) return 0;
  return (new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime()) / 3600000;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export default function EmployerHoursView() {
  const supabase = createClient();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [refDate, setRefDate] = useState(() => new Date());
  const [people, setPeople] = useState<Person[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const s = settings ?? DEFAULT_SETTINGS;
  const period = getPeriod(s, refDate);
  const today = new Date();
  const isCurrent = today >= period.start && today < addDays(period.end, 1);

  // Load the company's pay + overtime settings once
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("org_settings")
        .select(
          "pay_frequency, period_anchor_date, overtime_enabled, overtime_daily_hours, overtime_weekly_hours, overtime_multiplier, work_week_start"
        )
        .maybeSingle();
      setSettings(data ? { ...DEFAULT_SETTINGS, ...data } : DEFAULT_SETTINGS);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!settings) return;
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, period.start.getTime()]);

  async function loadData() {
    setLoading(true);
    setError(null);

    // Start from the beginning of the work week containing the period start,
    // so weekly overtime includes days from the previous pay period.
    const weekStart = startOfWorkWeek(period.start, s.work_week_start);
    const from = weekStart < period.start ? weekStart : period.start;
    const to = addDays(period.end, 1);

    const [peopleRes, entriesRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, hourly_wage, employee_type, status")
        .eq("role", "employee")
        .order("full_name"),
      supabase
        .from("time_entries")
        .select("id, clock_in, clock_out, clock_in_location, clock_out_location, profile_id")
        .gte("clock_in", from.toISOString())
        .lt("clock_in", to.toISOString())
        .order("clock_in", { ascending: false }),
    ]);

    if (peopleRes.error || entriesRes.error) {
      setError(peopleRes.error?.message ?? entriesRes.error?.message ?? "Could not load hours.");
    }
    setPeople((peopleRes.data as Person[]) ?? []);
    setEntries((entriesRes.data as Entry[]) ?? []);
    setLoading(false);
  }

  // Entries that actually belong to this period (for display + open shifts)
  const periodEnd = addDays(period.end, 1);
  const periodEntries = entries.filter((e) => {
    const t = new Date(e.clock_in);
    return t >= period.start && t < periodEnd;
  });

  const multiplier = Number(s.overtime_multiplier);

  const rows = people
    .map((p) => {
      const mine = entries.filter((e) => e.profile_id === p.id);
      const open = periodEntries.filter((e) => e.profile_id === p.id && !e.clock_out).length;

      // Subcontractors never get overtime
      const rules =
        p.employee_type === "subcontractor" ? { ...s, overtime_enabled: false } : s;

      const split = splitHours(mine, rules, period.start, period.end);
      const regular = round2(split.regular);
      const overtime = round2(split.overtime);
      const wage = p.hourly_wage != null ? Number(p.hourly_wage) : null;
      const gross = wage != null ? regular * wage + overtime * wage * multiplier : null;
      const worked = regular + overtime > 0 || open > 0;

      return { ...p, regular, overtime, open, wage, gross, worked };
    })
    // Active people, plus terminated people who worked this period
    .filter((r) => r.status !== "terminated" || r.worked);

  const totalRegular = rows.reduce((sum, r) => sum + r.regular, 0);
  const totalOvertime = rows.reduce((sum, r) => sum + r.overtime, 0);
  const totalGross = rows.reduce((sum, r) => sum + (r.gross ?? 0), 0);
  const anyOpen = rows.some((r) => r.open > 0);
  const nameById = new Map(people.map((p) => [p.id, p.full_name ?? "Unknown"]));

  return (
    <div className="border border-gray-300 rounded p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="font-semibold">Hours &amp; Pay</h2>
          <p className="text-sm text-gray-500">
            {fmtDate(period.start)} – {fmtDate(period.end)}
            {isCurrent && " (current period)"}
          </p>
          <p className="text-xs text-gray-500">
            {s.overtime_enabled
              ? `Overtime: ${multiplier}× after ${
                  [
                    s.overtime_daily_hours != null ? `${Number(s.overtime_daily_hours)}h/day` : null,
                    s.overtime_weekly_hours != null ? `${Number(s.overtime_weekly_hours)}h/week` : null,
                  ]
                    .filter(Boolean)
                    .join(" or ") || "—"
                }`
              : "Overtime: off"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRefDate(addDays(period.start, -1))}
            className="border border-gray-400 rounded px-3 py-1 text-xs hover:bg-gray-100"
          >
            ← Previous
          </button>
          <button
            onClick={() => setRefDate(new Date())}
            disabled={isCurrent}
            className="border border-gray-400 rounded px-3 py-1 text-xs hover:bg-gray-100 disabled:opacity-40"
          >
            Current
          </button>
          <button
            onClick={() => setRefDate(addDays(period.end, 1))}
            disabled={isCurrent}
            className="border border-gray-400 rounded px-3 py-1 text-xs hover:bg-gray-100 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      </div>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">No staff yet.</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-300">
                <th className="text-left py-2 font-medium">Name</th>
                <th className="text-left py-2 font-medium">Type</th>
                <th className="text-right py-2 font-medium">Regular</th>
                <th className="text-right py-2 font-medium">Overtime</th>
                <th className="text-right py-2 font-medium">Wage</th>
                <th className="text-right py-2 font-medium">Gross Pay</th>
                <th className="text-left py-2 pl-4 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-gray-100">
                  <td className="py-2">
                    {r.full_name ?? "—"}
                    {r.status === "terminated" && (
                      <span className="text-xs text-gray-500"> (terminated)</span>
                    )}
                  </td>
                  <td className="py-2">
                    {r.employee_type === "subcontractor" ? "Subcontractor" : "Employee"}
                  </td>
                  <td className="py-2 text-right">{r.regular.toFixed(2)}</td>
                  <td className="py-2 text-right">
                    {r.overtime > 0 ? r.overtime.toFixed(2) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="py-2 text-right">
                    {r.wage != null ? money(r.wage) : <span className="text-gray-500">—</span>}
                  </td>
                  <td className="py-2 text-right">
                    {r.gross != null ? (
                      money(r.gross)
                    ) : (
                      <span className="text-amber-600 text-xs">Wage not set</span>
                    )}
                  </td>
                  <td className="py-2 pl-4">
                    {r.open > 0 && (
                      <span className="text-amber-600 text-xs">
                        {r.open} open shift{r.open > 1 ? "s" : ""}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="py-2" colSpan={2}>Total</td>
                <td className="py-2 text-right">{totalRegular.toFixed(2)}</td>
                <td className="py-2 text-right">{totalOvertime.toFixed(2)}</td>
                <td></td>
                <td className="py-2 text-right">{money(totalGross)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>

          {anyOpen && (
            <p className="text-amber-600 text-xs mt-2">
              Open shifts aren&apos;t counted until the person clocks out.
            </p>
          )}

          <button
            onClick={() => setShowDetails((v) => !v)}
            className="text-sm text-gray-600 hover:underline mt-4"
          >
            {showDetails ? "Hide" : "Show"} shift details ({periodEntries.length})
          </button>

          {showDetails && periodEntries.length > 0 && (
            <table className="w-full text-sm mt-3">
              <thead>
                <tr className="border-b border-gray-300">
                  <th className="text-left py-2 font-medium">Name</th>
                  <th className="text-left py-2 font-medium">Clock In</th>
                  <th className="text-left py-2 font-medium">Clock Out</th>
                  <th className="text-right py-2 font-medium">Hours</th>
                  <th className="text-left py-2 pl-4 font-medium">In Location</th>
                  <th className="text-left py-2 font-medium">Out Location</th>
                </tr>
              </thead>
              <tbody>
                {periodEntries.map((e) => (
                  <tr key={e.id} className="border-b border-gray-100">
                    <td className="py-2">{nameById.get(e.profile_id) ?? "Unknown"}</td>
                    <td className="py-2">{new Date(e.clock_in).toLocaleString()}</td>
                    <td className="py-2">
                      {e.clock_out ? (
                        new Date(e.clock_out).toLocaleString()
                      ) : (
                        <span className="text-amber-600">Still clocked in</span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      {e.clock_out ? shiftHours(e).toFixed(2) : "—"}
                    </td>
                    <td className="py-2 pl-4 text-xs">{e.clock_in_location ?? "—"}</td>
                    <td className="py-2 text-xs">{e.clock_out_location ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}