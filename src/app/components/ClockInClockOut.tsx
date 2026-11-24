"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { formatDay, formatDuration, formatTime } from "@/utils/format";
import { formatDistance, toLatLng } from "@/utils/geo";
import { PinIcon } from "./ui/Icons";
import { useNow } from "./useNow";

type ActiveEntry = {
  id: string;
  clock_in: string;
  job_site_id: string | null;
  clock_in_lat: number | null;
  clock_in_lng: number | null;
  clock_in_accuracy_m: number | null;
};

type Site = { id: string; name: string; active: boolean };

type Fix = { lat: number; lng: number; accuracy: number | null };

const LAST_SITE_KEY = "sitestamp:last-site";

function readLastSite() {
  try {
    return window.localStorage.getItem(LAST_SITE_KEY);
  } catch {
    return null;
  }
}

function rememberSite(id: string) {
  try {
    window.localStorage.setItem(LAST_SITE_KEY, id);
  } catch {
    // Private mode or blocked storage: the picker just won't remember
  }
}

// Asked only when clocking in or out. Never invents a position: any failure
// returns null with the reason.
function getLocation(): Promise<{ fix: Fix | null; problem: string | null }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ fix: null, problem: "This browser can't share its location" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const point = toLatLng(latitude, longitude);
        resolve(
          point
            ? {
                fix: {
                  ...point,
                  accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? Math.round(accuracy * 10) / 10 : null,
                },
                problem: null,
              }
            : { fix: null, problem: "Your phone reported an invalid location" }
        );
      },
      (err) => {
        const problem =
          err.code === err.PERMISSION_DENIED
            ? "Location is turned off for SiteStamp in your browser (you can allow it in your browser's site settings)"
            : err.code === err.TIMEOUT
              ? "Finding your location took too long"
              : "Your phone couldn't find its location";
        resolve({ fix: null, problem });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  });
}

export default function ClockInOut({ readOnly = false }: { readOnly?: boolean }) {
  const [loading, setLoading] = useState(false);
  // Until the first check returns we don't know if a shift is open, so the
  // clock-in button stays disabled (prevents a second open shift).
  const [checking, setChecking] = useState(true);
  const [activeEntry, setActiveEntry] = useState<ActiveEntry | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState("");
  const [locationError, setLocationError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();
  const now = useNow();

  async function checkActiveEntry() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setChecking(false);
      return;
    }

    const [entryRes, sitesRes] = await Promise.all([
      supabase
        .from("time_entries")
        .select("id, clock_in, job_site_id, clock_in_lat, clock_in_lng, clock_in_accuracy_m")
        .eq("profile_id", user.id)
        .is("clock_out", null)
        .order("clock_in", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("job_sites").select("id, name, active").order("name"),
    ]);

    const list = (sitesRes.data ?? []) as Site[];
    const activeSites = list.filter((s) => s.active);
    setSites(list);
    setActiveEntry(entryRes.data as ActiveEntry | null);
    setSiteId((current) => {
      if (current && activeSites.some((s) => s.id === current)) return current;
      if (activeSites.length === 1) return activeSites[0].id;
      const last = readLastSite();
      return last && activeSites.some((s) => s.id === last) ? last : "";
    });
    if (sitesRes.error) setError(sitesRes.error.message);
    setChecking(false);
  }

  useEffect(() => {
    // Start the load after the effect runs; the loading state already starts true
    void Promise.resolve().then(checkActiveEntry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeSites = sites.filter((s) => s.active);
  const needsSite = activeSites.length > 0;

  async function handleClockIn() {
    setLocationError(null);
    setError(null);
    if (needsSite && !activeSites.some((s) => s.id === siteId)) {
      setError("Pick the job site you're working at.");
      return;
    }
    setLoading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("You're not logged in.");
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .single();

    const { fix, problem } = await getLocation();
    if (!fix) setLocationError(`${problem}, so you were clocked in without a location.`);

    const { error: insertError } = await supabase.from("time_entries").insert({
      profile_id: user.id,
      org_id: profile?.org_id,
      clock_in: new Date().toISOString(),
      job_site_id: needsSite ? siteId : null,
      clock_in_lat: fix?.lat ?? null,
      clock_in_lng: fix?.lng ?? null,
      clock_in_accuracy_m: fix ? fix.accuracy : null,
    });

    if (insertError) {
      setError(insertError.message);
      setLocationError(null);
    } else {
      if (needsSite) rememberSite(siteId);
      await checkActiveEntry();
    }
    setLoading(false);
  }

  async function handleClockOut() {
    if (!activeEntry) return;
    setLoading(true);
    setLocationError(null);
    setError(null);

    const { fix, problem } = await getLocation();
    if (!fix) setLocationError(`${problem}, so you were clocked out without a location.`);

    const { error: updateError } = await supabase
      .from("time_entries")
      .update({
        clock_out: new Date().toISOString(),
        clock_out_lat: fix?.lat ?? null,
        clock_out_lng: fix?.lng ?? null,
        clock_out_accuracy_m: fix ? fix.accuracy : null,
      })
      .eq("id", activeEntry.id);

    if (updateError) {
      setError(updateError.message);
      setLocationError(null);
    } else {
      setActiveEntry(null);
    }
    setLoading(false);
  }

  const messages = (
    <>
      {locationError && (
        <p className="notice mt-3" role="status">
          {locationError}
        </p>
      )}
      {error && (
        <p className="msg-error mt-3" role="alert">
          {error}
        </p>
      )}
    </>
  );

  if (checking) {
    return (
      <section className="panel p-4 flex flex-col gap-3" aria-busy="true" aria-label="Clock">
        <span className="skeleton w-32" />
        <span className="skeleton h-10 w-40" />
        <span className="skeleton h-14 w-full" />
      </section>
    );
  }

  if (activeEntry) {
    const start = new Date(activeEntry.clock_in);
    const site = activeEntry.job_site_id ? sites.find((s) => s.id === activeEntry.job_site_id) : null;
    const recorded = toLatLng(activeEntry.clock_in_lat, activeEntry.clock_in_lng);
    return (
      <section className="panel p-4" aria-labelledby="clock-h">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="clock-h" className="text-base font-semibold">
            On the clock
          </h2>
          <span className="sheet-no">IN {formatTime(start).toUpperCase()}</span>
        </div>
        <p className="mt-4 text-4xl leading-10 font-semibold tracking-tight num text-left">
          {formatDuration(now.getTime() - start.getTime())}
        </p>
        <p className="small muted mt-1">
          Clocked in {formatTime(start)} · {formatDay(start)}
          {site ? ` · ${site.name}` : ""}
        </p>
        <p className="mt-3 flex items-start gap-2 small muted">
          <PinIcon />
          {recorded
            ? `Location recorded at clock-in${activeEntry.clock_in_accuracy_m != null ? ` (within about ${formatDistance(Number(activeEntry.clock_in_accuracy_m))})` : ""}.`
            : "Location unavailable for this clock-in."}
        </p>
        {!readOnly && (
          <>
            <button
              type="button"
              onClick={handleClockOut}
              disabled={loading}
              className="btn btn-primary btn-lg btn-block mt-5"
            >
              {loading ? "Clocking out…" : "Clock out"}
            </button>
            <p className="hint text-center mt-2">
              Your phone will ask to share your location when you clock out. Only that one reading is saved.
            </p>
          </>
        )}
        {messages}
      </section>
    );
  }

  return (
    <section className="panel p-4" aria-labelledby="clock-h">
      <h2 id="clock-h" className="text-base font-semibold">
        Off the clock
      </h2>
      {readOnly ? (
        <p className="muted mt-2">Clocked out</p>
      ) : (
        <>
          <p className="muted mt-1">Clock in when you start work on site.</p>
          {needsSite ? (
            <div className="field mt-4">
              <label htmlFor="clock-site">Job site</label>
              <select
                id="clock-site"
                className="select"
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                required
              >
                <option value="" disabled>
                  Pick a site
                </option>
                {activeSites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <button
            type="button"
            onClick={handleClockIn}
            disabled={loading || (needsSite && !siteId)}
            className="btn btn-primary btn-lg btn-block mt-5"
          >
            {loading ? "Clocking in…" : "Clock in"}
          </button>
          <p className="hint text-center mt-2">
            Your phone will ask to share your location when you clock in. Only that one reading is saved.
          </p>
        </>
      )}
      {messages}
    </section>
  );
}
