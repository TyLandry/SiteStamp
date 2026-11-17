"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";
import { addDays, daysBetween, parseLocalDate, toDateInput } from "@/utils/payPeriods";
import { startOfWorkWeek, DEFAULT_OVERTIME_SETTINGS } from "@/utils/overtime";
import { formatDay, formatDuration, formatTime, startOfDay } from "@/utils/format";
import { Avatar, Delta } from "./ui/Marks";
import { Axis, Track, dayWindow, type Span } from "./ui/DayScale";
import { useNow } from "./useNow";

type Person = {
  id: string;
  full_name: string | null;
  employee_type: string;
  status: string;
};

type Entry = {
  id: string;
  profile_id: string;
  clock_in: string;
  clock_out: string | null;
  clock_in_location: string | null;
};

type TimeOff = {
  id: string;
  profile_id: string;
  start_date: string;
  end_date: string;
  status: string;
  created_at: string;
  full_name: string | null;
};

type Board = {
  people: Person[];
  entries: Entry[];
  requests: TimeOff[];
  weekStart: Date;
  loadedAt: Date;
};

type TimeOffRow = Omit<TimeOff, "full_name"> & {
  profiles: { full_name: string | null } | { full_name: string | null }[] | null;
};

async function loadBoard(supabase: SupabaseClient, today: Date): Promise<Board> {
  const { data: settings } = await supabase
    .from("org_settings")
    .select("work_week_start")
    .maybeSingle();
  const weekStart = startOfWorkWeek(
    today,
    settings?.work_week_start ?? DEFAULT_OVERTIME_SETTINGS.work_week_start
  );

  const entryFields = "id, profile_id, clock_in, clock_out, clock_in_location";
  const [peopleRes, weekRes, openRes, requestsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, employee_type, status")
      .eq("role", "employee")
      .order("full_name"),
    supabase
      .from("time_entries")
      .select(entryFields)
      .gte("clock_in", weekStart.toISOString())
      .order("clock_in"),
    // Shifts still open from before this week would otherwise be missed
    supabase.from("time_entries").select(entryFields).is("clock_out", null),
    supabase
      .from("time_off_requests")
      .select("id, profile_id, start_date, end_date, status, created_at, profiles(full_name)")
      .order("created_at", { ascending: false }),
  ]);

  const failed = [peopleRes, weekRes, openRes, requestsRes].find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);

  const byId = new Map<string, Entry>();
  for (const e of [...(weekRes.data ?? []), ...(openRes.data ?? [])] as Entry[]) byId.set(e.id, e);

  const requests = ((requestsRes.data ?? []) as TimeOffRow[]).map(({ profiles, ...r }) => ({
    ...r,
    full_name: (Array.isArray(profiles) ? profiles[0]?.full_name : profiles?.full_name) ?? null,
  }));

  return {
    people: (peopleRes.data ?? []) as Person[],
    entries: [...byId.values()],
    requests,
    weekStart,
    loadedAt: new Date(),
  };
}

function dayCount(r: { start_date: string; end_date: string }) {
  return daysBetween(parseLocalDate(r.start_date), parseLocalDate(r.end_date)) + 1;
}

function dateRange(r: { start_date: string; end_date: string }) {
  const s = parseLocalDate(r.start_date);
  const e = parseLocalDate(r.end_date);
  return r.start_date === r.end_date ? formatDay(s) : `${formatDay(s)} – ${formatDay(e)}`;
}

/** Time a shift overlaps [from, to), counting an open shift up to now. */
function overlapMs(e: Entry, from: Date, to: Date, now: Date) {
  const start = Math.max(new Date(e.clock_in).getTime(), from.getTime());
  const end = Math.min((e.clock_out ? new Date(e.clock_out) : now).getTime(), to.getTime());
  return Math.max(0, end - start);
}

const HISTORY_CAP = 5;

export default function TodayBoard() {
  const supabase = createClient();
  const router = useRouter();
  const now = useNow();
  const today = startOfDay(now);
  const todayKey = toDateInput(today);

  const [board, setBoard] = useState<Board | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadBoard(supabase, startOfDay(new Date()))
      .then((data) => {
        if (cancelled) return;
        setBoard(data);
        setLoadError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load today.");
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, reloadKey, todayKey]);

  async function decide(id: string, status: "approved" | "denied") {
    setUpdatingId(id);
    setActionError(null);
    const { error } = await supabase.from("time_off_requests").update({ status }).eq("id", id);
    if (error) {
      setActionError(error.message);
    } else {
      setReloadKey((k) => k + 1);
      router.refresh(); // updates the waiting count in the navigation
    }
    setUpdatingId(null);
  }

  // Dates render only after the browser has loaded the data, so the server
  // (which runs in another time zone) never prints a different day.
  const titleRow = (finding: React.ReactNode, loadedAt?: Date) => (
    <div className="title-row">
      <div>
        <h1>Today</h1>
        <p className="finding">{finding}</p>
      </div>
      {loadedAt ? <span className="stamp-time">Updated {formatTime(loadedAt)}</span> : null}
    </div>
  );

  if (loadError) {
    return (
      <>
        {titleRow("Couldn't load today's crew.")}
        <div className="panel panel-body pt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="msg-error">Couldn&apos;t load today: {loadError}</p>
          <button type="button" className="btn" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </button>
        </div>
      </>
    );
  }

  if (!board) {
    return (
      <>
        {titleRow(<span className="skeleton inline-block w-56 align-middle" />)}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_384px] items-start" aria-busy="true">
          <div className="stack">
            <div className="panel p-4 flex flex-col gap-3">
              <span className="skeleton w-40" />
              <span className="skeleton w-full" />
              <span className="skeleton w-3/4" />
            </div>
            <div className="panel p-4 flex flex-col gap-3">
              <span className="skeleton w-48" />
              <span className="skeleton w-full" />
            </div>
          </div>
          <div className="panel p-4 flex flex-col gap-3">
            <span className="skeleton w-32" />
            <span className="skeleton w-full" />
          </div>
        </div>
      </>
    );
  }

  // ---------- derived from one load ----------
  const nameOf = new Map(board.people.map((p) => [p.id, p.full_name]));
  const active = board.people.filter((p) => p.status !== "terminated");
  const tomorrow = addDays(today, 1);

  const openShifts = board.entries.filter((e) => !e.clock_out);
  const staleOpen = openShifts.filter((e) => new Date(e.clock_in) < today);
  const pending = board.requests.filter((r) => r.status === "pending");
  const history = board.requests.filter((r) => r.status !== "pending");
  const decisions = pending.length + staleOpen.length;

  // Everyone who worked today or is on the clock now, in name order
  const todayEntries = board.entries.filter((e) => overlapMs(e, today, tomorrow, now) > 0 || !e.clock_out);
  const workedIds = new Set(todayEntries.map((e) => e.profile_id));
  const lanes = board.people
    .filter((p) => workedIds.has(p.id))
    .map((p) => {
      const mine = todayEntries.filter((e) => e.profile_id === p.id);
      const spans: Span[] = mine.map((e) => {
        const start = new Date(e.clock_in);
        return {
          start: start < today ? today : start,
          end: e.clock_out ? new Date(e.clock_out) : null,
          flagged: !e.clock_out && start < today,
        };
      });
      const open = mine.find((e) => !e.clock_out) ?? null;
      const ms = mine.reduce((sum, e) => sum + overlapMs(e, today, tomorrow, now), 0);
      const noLocation = mine.some((e) => !e.clock_in_location);
      return { person: p, spans, open, ms, noLocation };
    });
  // A shift left open from an earlier day is drawn from the left edge with its
  // flag (the cloud explains it); it doesn't stretch everyone's scale to midnight.
  const scale = dayWindow(
    lanes.map((l) => ({ dayStart: today, spans: l.spans.filter((s) => !s.flagged) })),
    now
  );
  const onClockCount = new Set(openShifts.map((e) => e.profile_id)).size;
  const todayTotalMs = lanes.reduce((sum, l) => sum + l.ms, 0);

  const onTimeOffToday = new Set(
    board.requests
      .filter((r) => r.status === "approved" && r.start_date <= todayKey && r.end_date >= todayKey)
      .map((r) => r.profile_id)
  );
  const notIn = active.filter((p) => !workedIds.has(p.id));

  const weekDays: { day: Date; ms: number }[] = [];
  for (let d = board.weekStart; d <= today; d = addDays(d, 1)) {
    const next = addDays(d, 1);
    weekDays.push({ day: d, ms: board.entries.reduce((sum, e) => sum + overlapMs(e, d, next, now), 0) });
  }
  const weekMs = weekDays.reduce((sum, d) => sum + d.ms, 0);

  const shownHistory = showAllHistory ? history : history.slice(0, HISTORY_CAP);

  return (
    <>
      {titleRow(
        <>
          {formatDay(today)} · {onClockCount} of {active.length} on the clock ·{" "}
          {decisions > 0 ? (
            <b>
              {decisions} need{decisions === 1 ? "s" : ""} your call
            </b>
          ) : (
            "nothing needs your call"
          )}
        </>,
        board.loadedAt
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_384px] items-start">
        <div className="stack">
          {decisions > 0 ? (
            <section className="cloud" aria-labelledby="needs-h">
              <div className="cloud-head">
                <h2 id="needs-h">Needs your call</h2>
                <span className="small muted">{decisions} open</span>
              </div>
              {staleOpen.map((e, i) => (
                <div className="rev" key={e.id}>
                  <Delta n={i + 1} />
                  <div className="min-w-0">
                    <div className="who">{nameOf.get(e.profile_id) ?? "Unknown"} is still clocked in</div>
                    <div className="what">
                      Since {formatDay(new Date(e.clock_in))}, {formatTime(e.clock_in)} ·{" "}
                      {formatDuration(now.getTime() - new Date(e.clock_in).getTime())}
                    </div>
                  </div>
                  <div className="acts">
                    <Link className="btn" href="/admin/hours">
                      Review hours
                    </Link>
                  </div>
                </div>
              ))}
              {pending.map((r, i) => (
                <div className="rev" key={r.id}>
                  <Delta n={staleOpen.length + i + 1} />
                  <div className="min-w-0">
                    <div className="who">{r.full_name ?? "Unknown"} · time off</div>
                    <div className="what">
                      {dateRange(r)} · {dayCount(r)} day{dayCount(r) === 1 ? "" : "s"} · asked{" "}
                      {formatDay(new Date(r.created_at))}
                    </div>
                  </div>
                  <div className="acts">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={updatingId === r.id}
                      onClick={() => decide(r.id, "approved")}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={updatingId === r.id}
                      onClick={() => decide(r.id, "denied")}
                    >
                      Deny
                    </button>
                  </div>
                </div>
              ))}
              {actionError ? <p className="msg-error px-1 pt-2">{actionError}</p> : null}
            </section>
          ) : (
            <section className="panel" aria-labelledby="needs-h">
              <div className="panel-h">
                <h2 id="needs-h">Needs your call</h2>
              </div>
              <div className="panel-body">
                <p className="empty">Nothing is waiting on you. New time-off requests show up here.</p>
              </div>
            </section>
          )}

          <section className="panel" aria-labelledby="clock-h">
            <div className="panel-h">
              <h2 id="clock-h">On the clock today</h2>
              <span className="sheet-no">
                {onClockCount} ON THE CLOCK · {lanes.length} WORKED
              </span>
            </div>
            {lanes.length === 0 ? (
              <div className="panel-body">
                <p className="empty">Nobody has clocked in today.</p>
              </div>
            ) : (
              <>
                <Axis window={scale} />
                {lanes.map((l) => (
                  <div className="lane" key={l.person.id}>
                    <div className="person">
                      <Avatar id={l.person.id} name={l.person.full_name} />
                      <div className="n">
                        <span>{l.person.full_name ?? "Unknown"}</span>
                        <small>
                          <span className="lane-detail">
                            {l.open
                              ? `In ${
                                  new Date(l.open.clock_in) < today
                                    ? `${formatDay(new Date(l.open.clock_in))}, `
                                    : ""
                                }${formatTime(l.open.clock_in)}`
                              : "Clocked out"}{" "}
                            ·{" "}
                          </span>
                          {formatDuration(l.ms)}
                          {l.noLocation ? <span className="lane-detail"> · no location</span> : null}
                        </small>
                      </div>
                    </div>
                    <Track
                      spans={l.spans}
                      dayStart={today}
                      window={scale}
                      now={now}
                      label={`${l.person.full_name ?? "Unknown"}: ${formatDuration(l.ms)} today`}
                    />
                  </div>
                ))}
                <div className="title-block">
                  <span>{formatDay(today)}</span>
                  <span>
                    So far today <b>{formatDuration(todayTotalMs)}</b>
                  </span>
                </div>
              </>
            )}
          </section>

          <section className="panel" aria-labelledby="history-h">
            <div className="panel-h">
              <h2 id="history-h">Time off</h2>
              <span className="small muted">
                {history.length} decided{pending.length > 0 ? ` · ${pending.length} waiting` : ""}
              </span>
            </div>
            {history.length === 0 ? (
              <div className="panel-body">
                <p className="empty">No time-off decisions yet.</p>
              </div>
            ) : (
              <>
                {shownHistory.map((r) => (
                  <div className="list-row" key={r.id}>
                    <div className="person">
                      <Avatar id={r.profile_id} name={r.full_name} />
                      <div className="n">
                        <span>{r.full_name ?? "Unknown"}</span>
                        <small>
                          {dateRange(r)} · {dayCount(r)} day{dayCount(r) === 1 ? "" : "s"}
                        </small>
                      </div>
                    </div>
                    <span className={`pill ${r.status === "approved" ? "pill-ok" : ""}`}>
                      {r.status === "approved" ? "Approved" : r.status === "denied" ? "Denied" : r.status}
                    </span>
                  </div>
                ))}
                {history.length > HISTORY_CAP ? (
                  <div className="title-block">
                    <span>
                      Showing {shownHistory.length} of {history.length}
                    </span>
                    <button
                      type="button"
                      className="btn btn-text"
                      onClick={() => setShowAllHistory((v) => !v)}
                    >
                      {showAllHistory ? "Show fewer" : "Show all"}
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="panel" aria-labelledby="notin-h">
            <div className="panel-h">
              <h2 id="notin-h">Not in today</h2>
              <span className="small muted">
                {notIn.length} of {active.length}
              </span>
            </div>
            {notIn.length === 0 ? (
              <div className="panel-body">
                <p className="empty">Everyone has clocked in today.</p>
              </div>
            ) : (
              notIn.map((p) => (
                <div className="list-row" key={p.id}>
                  <div className="person">
                    <Avatar id={p.id} name={p.full_name} />
                    <span className="name">{p.full_name ?? "Unknown"}</span>
                  </div>
                  {onTimeOffToday.has(p.id) ? (
                    <span className="pill pill-ok">Time off</span>
                  ) : (
                    <span className="pill">Not clocked in</span>
                  )}
                </div>
              ))
            )}
          </section>

          <section className="panel" aria-labelledby="week-h">
            <div className="panel-h">
              <h2 id="week-h">Hours this week</h2>
              <span className="small muted">since {formatDay(board.weekStart)}</span>
            </div>
            {weekDays.map(({ day, ms }) => (
              <div className="list-row" key={day.getTime()}>
                <span>
                  {formatDay(day)}
                  {day.getTime() === today.getTime() ? <span className="muted"> so far</span> : null}
                </span>
                <span className="num">{formatDuration(ms)}</span>
              </div>
            ))}
            <div className="list-row font-semibold">
              <span>Week so far</span>
              <span className="num">{formatDuration(weekMs)}</span>
            </div>
            <div className="title-block">
              <span>Pay is worked out per pay period</span>
              <Link href="/admin/hours" className="font-semibold text-ink">
                Hours &amp; pay
              </Link>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
