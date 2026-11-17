"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { formatDay, startOfDay } from "@/utils/format";
import { Axis, Track, dayWindow, type Span } from "./ui/DayScale";

type DayGroup = { dayStart: Date; hours: number; spans: Span[] };

export default function HoursSummary() {
  const [days, setDays] = useState<DayGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<"7" | "30" | "all">("7");
  const supabase = createClient();

  async function calculateHours() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    let query = supabase
      .from("time_entries")
      .select("clock_in, clock_out")
      .eq("profile_id", user.id)
      .not("clock_out", "is", null)
      .order("clock_in", { ascending: false });

    if (range !== "all") {
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - parseInt(range));
      query = query.gte("clock_in", daysAgo.toISOString());
    }

    const { data: entries } = await query;

    if (!entries) {
      setDays([]);
      setLoading(false);
      return;
    }

    // Group completed shifts by the local day they started on
    const grouped = new Map<number, DayGroup>();
    entries.forEach((entry) => {
      const start = new Date(entry.clock_in);
      const end = new Date(entry.clock_out);
      const dayStart = startOfDay(start);
      const key = dayStart.getTime();
      const hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      const group = grouped.get(key) ?? { dayStart, hours: 0, spans: [] };
      group.hours += hours;
      group.spans.push({ start, end });
      grouped.set(key, group);
    });

    setDays([...grouped.values()].sort((a, b) => b.dayStart.getTime() - a.dayStart.getTime()));
    setLoading(false);
  }

  useEffect(() => {
    // Start the load after the effect runs; the loading state already starts true
    void Promise.resolve().then(calculateHours);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const total = days.reduce((sum, d) => sum + d.hours, 0);
  // Completed shifts only, so no now-line is needed; the scale still fits every shift
  const reference = days.length > 0 ? days[0].dayStart : new Date(0);
  const scale = dayWindow(days, reference);

  return (
    <section className="panel" aria-labelledby="hours-h">
      <div className="panel-h items-center">
        <h2 id="hours-h">Hours worked</h2>
        <label className="sr-only" htmlFor="hours-range">
          Range
        </label>
        <select
          id="hours-range"
          className="select w-auto"
          value={range}
          onChange={(e) => setRange(e.target.value as "7" | "30" | "all")}
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="all">All time</option>
        </select>
      </div>

      {loading ? (
        <div className="panel-body flex flex-col gap-3" aria-busy="true">
          <span className="skeleton w-full" />
          <span className="skeleton w-5/6" />
        </div>
      ) : days.length === 0 ? (
        <div className="panel-body">
          <p className="empty">No completed shifts in this range.</p>
        </div>
      ) : (
        <>
          <div className="scale-compact">
            <Axis window={scale} />
            {days.map((d) => (
              <div className="lane" key={d.dayStart.getTime()}>
                <div className="n">
                  <span className="block">{formatDay(d.dayStart)}</span>
                  <small className="block small faint">{d.hours.toFixed(2)} h</small>
                </div>
                <Track
                  spans={d.spans}
                  dayStart={d.dayStart}
                  window={scale}
                  now={new Date(0)}
                  label={`${formatDay(d.dayStart)}: ${d.hours.toFixed(2)} hours`}
                />
              </div>
            ))}
          </div>
          <div className="title-block">
            <span>Completed shifts only</span>
            <span>
              Total <b>{total.toFixed(2)} h</b>
            </span>
          </div>
        </>
      )}
    </section>
  );
}
