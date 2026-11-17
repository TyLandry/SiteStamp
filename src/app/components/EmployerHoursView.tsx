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
import { formatTime, mapLink } from "@/utils/format";
import { Avatar } from "./ui/Marks";
import { ChevronLeftIcon, ChevronRightIcon } from "./ui/Icons";

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

function shortDateTime(value: string) {
  const d = new Date(value);
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}, ${formatTime(d)}`;
}

function Location({ value }: { value: string | null }) {
  if (!value) return <span className="faint">—</span>;
  const href = mapLink(value);
  return href ? (
    <a className="coord underline underline-offset-2" href={href} target="_blank" rel="noopener noreferrer">
      {value}
    </a>
  ) : (
    <span className="coord">{value}</span>
  );
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
    void Promise.resolve().then(loadData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, period.start.getTime()]);

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

  const overtimeRule = s.overtime_enabled
    ? `Overtime ${multiplier}× after ${
        [
          s.overtime_daily_hours != null ? `${Number(s.overtime_daily_hours)} h/day` : null,
          s.overtime_weekly_hours != null ? `${Number(s.overtime_weekly_hours)} h/week` : null,
        ]
          .filter(Boolean)
          .join(" or ") || "—"
      }`
    : "Overtime off";

  return (
    <>
      <div className="title-row">
        <div>
          <h1>Hours &amp; pay</h1>
          <p className="finding">
            {settings ? (
              <>
                {fmtDate(period.start)} – {fmtDate(period.end)}
                {isCurrent ? " · current period" : ""} · {overtimeRule}
              </>
            ) : (
              <span className="skeleton inline-block w-56 align-middle" />
            )}
          </p>
        </div>
        <div className="flex items-center gap-2" role="group" aria-label="Pay period">
          <button type="button" className="btn" onClick={() => setRefDate(addDays(period.start, -1))}>
            <ChevronLeftIcon />
            Previous
          </button>
          <button type="button" className="btn" onClick={() => setRefDate(new Date())} disabled={isCurrent}>
            Current
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setRefDate(addDays(period.end, 1))}
            disabled={isCurrent}
          >
            Next
            <ChevronRightIcon />
          </button>
        </div>
      </div>

      {error ? (
        <div className="panel panel-body pt-4 mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="msg-error">Couldn&apos;t load hours: {error}</p>
          <button type="button" className="btn" onClick={() => loadData()}>
            Retry
          </button>
        </div>
      ) : null}

      <div className="stack">
        <section
          className="panel stat-row grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-[var(--border)]"
          aria-label="Period totals"
        >
          <div className="stat">
            <span className="small muted">Regular</span>
            <span className="v num text-left">{loading ? "—" : `${totalRegular.toFixed(2)} h`}</span>
          </div>
          <div className="stat">
            <span className="small muted">Overtime</span>
            <span className="v num text-left">{loading ? "—" : `${totalOvertime.toFixed(2)} h`}</span>
          </div>
          <div className="stat">
            <span className="small muted">Gross pay</span>
            <span className="v num text-left">{loading ? "—" : money(totalGross)}</span>
          </div>
        </section>

        {anyOpen && !loading ? (
          <p className="notice">Open shifts aren&apos;t counted until the person clocks out.</p>
        ) : null}

        <section className="panel" aria-labelledby="people-h">
          <div className="panel-h">
            <h2 id="people-h">By person</h2>
            {!loading ? <span className="small muted">{rows.length} {rows.length === 1 ? "person" : "people"}</span> : null}
          </div>

          {loading ? (
            <div className="panel-body flex flex-col gap-3" aria-busy="true">
              <span className="skeleton w-full" />
              <span className="skeleton w-5/6" />
              <span className="skeleton w-2/3" />
            </div>
          ) : rows.length === 0 ? (
            <div className="panel-body">
              <p className="empty">No staff yet. Invite your crew from Crew &amp; wages.</p>
            </div>
          ) : (
            <>
              {/* Phone: two-line rows */}
              <ul className="sm:hidden">
                {rows.map((r) => (
                  <li key={r.id} className="list-row items-start">
                    <div className="person">
                      <Avatar id={r.id} name={r.full_name} />
                      <div className="n">
                        <span>{r.full_name ?? "—"}</span>
                        <small>
                          {r.employee_type === "subcontractor" ? "Subcontractor" : "Employee"}
                          {r.status === "terminated" ? " · terminated" : ""} · {r.regular.toFixed(2)} h
                          {r.overtime > 0 ? ` + ${r.overtime.toFixed(2)} h OT` : ""}
                        </small>
                        {r.open > 0 ? (
                          <span className="pill pill-warn mt-1">
                            {r.open} open shift{r.open > 1 ? "s" : ""}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="text-right">
                      {r.gross != null ? (
                        <div className="font-semibold num">{money(r.gross)}</div>
                      ) : (
                        <span className="pill pill-warn">Wage not set</span>
                      )}
                      {r.wage != null ? <div className="small faint num">{money(r.wage)} /h</div> : null}
                    </div>
                  </li>
                ))}
              </ul>

              {/* Tablet and desktop: table */}
              <div className="table-wrap hidden sm:block px-1 pb-2">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th className="num">Regular</th>
                      <th className="num">Overtime</th>
                      <th className="num">Wage</th>
                      <th className="num">Gross pay</th>
                      <th>
                        <span className="sr-only">Open shifts</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <div className="person">
                            <Avatar id={r.id} name={r.full_name} />
                            <div className="n">
                              <span>{r.full_name ?? "—"}</span>
                              {r.status === "terminated" ? <small>Terminated</small> : null}
                            </div>
                          </div>
                        </td>
                        <td>{r.employee_type === "subcontractor" ? "Subcontractor" : "Employee"}</td>
                        <td className="num">{r.regular.toFixed(2)}</td>
                        <td className="num">
                          {r.overtime > 0 ? r.overtime.toFixed(2) : <span className="faint">—</span>}
                        </td>
                        <td className="num">
                          {r.wage != null ? money(r.wage) : <span className="faint">—</span>}
                        </td>
                        <td className="num font-semibold">
                          {r.gross != null ? money(r.gross) : <span className="pill pill-warn">Wage not set</span>}
                        </td>
                        <td>
                          {r.open > 0 ? (
                            <span className="pill pill-warn">
                              {r.open} open shift{r.open > 1 ? "s" : ""}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    <tr className="total">
                      <td colSpan={2}>Total</td>
                      <td className="num">{totalRegular.toFixed(2)}</td>
                      <td className="num">{totalOvertime.toFixed(2)}</td>
                      <td />
                      <td className="num">{money(totalGross)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        {!loading && rows.length > 0 ? (
          <section className="panel" aria-labelledby="shifts-h">
            <div className="panel-h">
              <h2 id="shifts-h">Shifts</h2>
              <button
                type="button"
                className="btn btn-text"
                aria-expanded={showDetails}
                onClick={() => setShowDetails((v) => !v)}
              >
                {showDetails ? "Hide" : "Show"} shift details ({periodEntries.length})
              </button>
            </div>

            {showDetails ? (
              periodEntries.length === 0 ? (
                <div className="panel-body">
                  <p className="empty">No shifts in this period.</p>
                </div>
              ) : (
                <>
                  <ul className="sm:hidden">
                    {periodEntries.map((e) => (
                      <li key={e.id} className="list-row items-start">
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{nameById.get(e.profile_id) ?? "Unknown"}</div>
                          <div className="small muted">
                            {shortDateTime(e.clock_in)} –{" "}
                            {e.clock_out ? formatTime(e.clock_out) : "still clocked in"}
                          </div>
                          <div className="small mt-1 flex flex-col gap-0.5">
                            <span>
                              <span className="faint">In </span>
                              <Location value={e.clock_in_location} />
                            </span>
                            <span>
                              <span className="faint">Out </span>
                              <Location value={e.clock_out_location} />
                            </span>
                          </div>
                        </div>
                        <div className="num whitespace-nowrap">
                          {e.clock_out ? `${shiftHours(e).toFixed(2)} h` : <span className="pill pill-warn">Open</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="table-wrap hidden sm:block px-1 pb-2">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Clock in</th>
                          <th>Clock out</th>
                          <th className="num">Hours</th>
                          <th>In location</th>
                          <th>Out location</th>
                        </tr>
                      </thead>
                      <tbody>
                        {periodEntries.map((e) => (
                          <tr key={e.id}>
                            <td>{nameById.get(e.profile_id) ?? "Unknown"}</td>
                            <td className="whitespace-nowrap">{shortDateTime(e.clock_in)}</td>
                            <td className="whitespace-nowrap">
                              {e.clock_out ? (
                                shortDateTime(e.clock_out)
                              ) : (
                                <span className="pill pill-warn">Still clocked in</span>
                              )}
                            </td>
                            <td className="num">{e.clock_out ? shiftHours(e).toFixed(2) : <span className="faint">—</span>}</td>
                            <td>
                              <Location value={e.clock_in_location} />
                            </td>
                            <td>
                              <Location value={e.clock_out_location} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )
            ) : null}
          </section>
        ) : null}
      </div>
    </>
  );
}
