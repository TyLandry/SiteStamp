"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { formatDay, formatDuration, formatTime } from "@/utils/format";
import { PinIcon } from "./ui/Icons";
import { useNow } from "./useNow";

type ActiveEntry = { id: string; clock_in: string; clock_in_location: string | null };

export default function ClockInOut({ readOnly = false }: { readOnly?: boolean }) {
  const [loading, setLoading] = useState(false);
  // Until the first check returns we don't know if a shift is open, so the
  // clock-in button stays disabled (prevents a second open shift).
  const [checking, setChecking] = useState(true);
  const [activeEntry, setActiveEntry] = useState<ActiveEntry | null>(null);
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

    const { data } = await supabase
      .from("time_entries")
      .select("id, clock_in, clock_in_location")
      .eq("profile_id", user.id)
      .is("clock_out", null)
      .order("clock_in", { ascending: false })
      .limit(1)
      .maybeSingle();

    setActiveEntry(data);
    setChecking(false);
  }

  useEffect(() => {
    // Start the load after the effect runs; the loading state already starts true
    void Promise.resolve().then(checkActiveEntry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getLocation(): Promise<string | null> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          resolve(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
        },
        () => resolve(null),
        { timeout: 5000 }
      );
    });
  }

  async function handleClockIn() {
    setLoading(true);
    setLocationError(null);
    setError(null);

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

    const location = await getLocation();
    if (!location) setLocationError("Could not get your location, so you were clocked in without it.");

    const { error: insertError } = await supabase.from("time_entries").insert({
      profile_id: user.id,
      org_id: profile?.org_id,
      clock_in: new Date().toISOString(),
      clock_in_location: location,
    });

    if (insertError) {
      setError(insertError.message);
    } else {
      await checkActiveEntry();
    }
    setLoading(false);
  }

  async function handleClockOut() {
    if (!activeEntry) return;
    setLoading(true);
    setLocationError(null);
    setError(null);

    const location = await getLocation();
    if (!location) setLocationError("Could not get your location, so you were clocked out without it.");

    const { error: updateError } = await supabase
      .from("time_entries")
      .update({
        clock_out: new Date().toISOString(),
        clock_out_location: location,
      })
      .eq("id", activeEntry.id);

    if (updateError) {
      setError(updateError.message);
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
        </p>
        <p className="mt-3 flex items-start gap-2 small muted">
          <PinIcon />
          {activeEntry.clock_in_location
            ? `Location recorded at clock-in: ${activeEntry.clock_in_location}`
            : "No location was recorded at clock-in."}
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
            <p className="hint text-center mt-2">Your location is recorded again when you clock out.</p>
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
          <button
            type="button"
            onClick={handleClockIn}
            disabled={loading}
            className="btn btn-primary btn-lg btn-block mt-5"
          >
            {loading ? "Clocking in…" : "Clock in"}
          </button>
          <p className="hint text-center mt-2">Your location is recorded when you clock in.</p>
        </>
      )}
      {messages}
    </section>
  );
}
