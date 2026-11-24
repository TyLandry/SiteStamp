"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/utils/supabase/client";
import { fetchAll } from "@/utils/supabase/fetchAll";
import { addDays, fmtDate } from "@/utils/payPeriods";
import { formatTime, startOfDay } from "@/utils/format";
import { mapLinkFor, toLatLng } from "@/utils/geo";
import {
  type ClockEntry,
  type SiteRef,
  CLOCK_ENTRY_FIELDS,
  checkEvent,
  clockPoint,
  describeCheck,
} from "@/utils/clockEvents";
import type { MapPoint, MapSite } from "./map/SiteMap";
import { ChevronLeftIcon, ChevronRightIcon } from "./ui/Icons";

const SiteMap = dynamic(() => import("./map/SiteMap"), {
  ssr: false,
  loading: () => <div className="map-box" style={{ height: 380 }} aria-busy="true" />,
});

type Site = SiteRef & { active: boolean };

const PILL: Record<string, string> = { ok: "pill pill-ok", warn: "pill pill-warn", bad: "pill pill-red", neutral: "pill" };

function shortDateTime(value: string) {
  const d = new Date(value);
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}, ${formatTime(d)}`;
}

/** Employer map of job sites and the week's clock-in / clock-out locations. */
export default function ClockMap() {
  const supabase = createClient();
  // The 7 days ending on `end` (inclusive)
  const [end, setEnd] = useState(() => startOfDay(new Date()));
  const [sites, setSites] = useState<Site[]>([]);
  const [entries, setEntries] = useState<ClockEntry[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const start = addDays(end, -6);
  const isCurrent = end.getTime() === startOfDay(new Date()).getTime();

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [sitesRes, peopleRes, list] = await Promise.all([
        supabase.from("job_sites").select("id, name, latitude, longitude, radius_m, active").order("name"),
        supabase.from("profiles").select("id, full_name").eq("role", "employee"),
        fetchAll<ClockEntry>((a, b) =>
          supabase
            .from("time_entries")
            .select(CLOCK_ENTRY_FIELDS)
            .gte("clock_in", start.toISOString())
            .lt("clock_in", addDays(end, 1).toISOString())
            .order("id")
            .range(a, b)
        ),
      ]);
      const err = sitesRes.error ?? peopleRes.error;
      if (err) throw new Error(err.message);
      setSites((sitesRes.data ?? []) as Site[]);
      setNames(new Map(((peopleRes.data ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? "Unknown"])));
      setEntries(list.sort((a, b) => b.clock_in.localeCompare(a.clock_in)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load clock locations.");
    }
    setLoading(false);
  }

  useEffect(() => {
    void Promise.resolve().then(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end.getTime()]);

  const siteMap = useMemo(() => new Map(sites.map((s) => [s.id, s])), [sites]);

  const events = useMemo(
    () =>
      entries.flatMap((e) => {
        const out = [{ e, which: "in" as const, at: e.clock_in }];
        return e.clock_out ? [...out, { e, which: "out" as const, at: e.clock_out }] : out;
      }),
    [entries]
  );

  const checked = useMemo(
    () =>
      events.map((ev) => {
        const check = checkEvent(ev.e, ev.which, siteMap);
        return { ...ev, check, info: describeCheck(check) };
      }),
    [events, siteMap]
  );

  const mapSites: MapSite[] = useMemo(
    () =>
      sites.flatMap((s) => {
        const p = toLatLng(s.latitude, s.longitude);
        return p ? [{ id: s.id, name: s.name, lat: p.lat, lng: p.lng, radius: s.radius_m, active: s.active }] : [];
      }),
    [sites]
  );

  const points: MapPoint[] = useMemo(
    () =>
      checked.flatMap(({ e, which, at, info }) => {
        const { point, accuracy } = clockPoint(e, which);
        if (!point) return [];
        const site = e.job_site_id ? siteMap.get(e.job_site_id)?.name : null;
        return [
          {
            id: `${e.id}:${which}`,
            lat: point.lat,
            lng: point.lng,
            accuracy,
            tone: info.tone,
            label: `${names.get(e.profile_id) ?? "Unknown"} · clock ${which} ${shortDateTime(at)}${site ? ` · ${site}` : ""} · ${info.text}`,
          },
        ];
      }),
    [checked, siteMap, names]
  );

  const flagged = checked.filter((c) => c.check.status === "outside" || c.check.status === "uncertain");
  const unavailable = checked.filter((c) => c.check.status === "no_location").length;

  return (
    <section className="panel" aria-labelledby="clockmap-h">
      <div className="panel-h flex-wrap items-center">
        <div>
          <h2 id="clockmap-h">Clock-in map</h2>
          <p className="small muted">
            {fmtDate(start)} – {fmtDate(end)}
          </p>
        </div>
        <div className="flex items-center gap-2" role="group" aria-label="Week">
          <button type="button" className="btn px-3" aria-label="Previous 7 days" onClick={() => setEnd(addDays(end, -7))}>
            <ChevronLeftIcon />
          </button>
          <button type="button" className="btn" disabled={isCurrent} onClick={() => setEnd(startOfDay(new Date()))}>
            Last 7 days
          </button>
          <button
            type="button"
            className="btn px-3"
            aria-label="Next 7 days"
            disabled={isCurrent}
            onClick={() => setEnd(addDays(end, 7))}
          >
            <ChevronRightIcon />
          </button>
        </div>
      </div>

      <div className="panel-body flex flex-col gap-3">
        {error ? (
          <p className="msg-error" role="alert">
            {error}
          </p>
        ) : null}
        <SiteMap
          label="Map of job sites and clock-in and clock-out locations"
          sites={mapSites}
          points={points}
          fitKey={`${end.getTime()}:${loading ? "loading" : "ready"}`}
          height={380}
        />
        <p className="hint">
          Squares are sites with their allowed distance; dots are clock events (green within, amber maybe outside
          given the phone&apos;s GPS accuracy, red outside). Phone GPS is self-reported and can be off or faked, so treat
          a flag as something to ask about, not proof.
        </p>

        {!loading ? (
          <div className="small muted">
            {checked.length} clock event{checked.length === 1 ? "" : "s"} · {flagged.length} flagged
            {unavailable > 0 ? ` · ${unavailable} without a location` : ""}
          </div>
        ) : null}
      </div>

      {!loading && flagged.length > 0 ? (
        <ul aria-label="Flagged clock events">
          {flagged.map(({ e, which, at, info }) => {
            const { point } = clockPoint(e, which);
            const site = e.job_site_id ? siteMap.get(e.job_site_id)?.name : null;
            return (
              <li key={`${e.id}:${which}`} className="list-row items-start">
                <div className="min-w-0">
                  <div className="font-semibold">
                    {names.get(e.profile_id) ?? "Unknown"} · clock {which}
                  </div>
                  <div className="small muted">
                    {shortDateTime(at)}
                    {site ? ` · ${site}` : ""}
                  </div>
                  {point ? (
                    <a
                      className="coord underline underline-offset-2"
                      href={mapLinkFor(point)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
                    </a>
                  ) : null}
                </div>
                <span className={`${PILL[info.tone]} whitespace-normal h-auto py-0.5 text-right`}>{info.text}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
