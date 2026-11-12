"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";

export default function ClockInOut({ readOnly = false }: { readOnly?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [activeEntry, setActiveEntry] = useState<{ id: string; clock_in: string } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    checkActiveEntry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkActiveEntry() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("time_entries")
      .select("id, clock_in")
      .eq("profile_id", user.id)
      .is("clock_out", null)
      .order("clock_in", { ascending: false })
      .limit(1)
      .maybeSingle();

    setActiveEntry(data);
  }

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
    if (!location) setLocationError("Could not get location — clocked in without it.");

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
    if (!location) setLocationError("Could not get location — clocked out without it.");

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

  return (
    <div className="border border-gray-300 rounded p-4">
      <h2 className="font-semibold mb-3">Clock In / Out</h2>
      {activeEntry ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Clocked in since {new Date(activeEntry.clock_in).toLocaleTimeString()}
          </p>
          {!readOnly && (
            <button
              onClick={handleClockOut}
              disabled={loading}
              className="bg-gray-800 text-white rounded px-4 py-2 text-sm disabled:opacity-50"
            >
              {loading ? "..." : "Clock Out"}
            </button>
          )}
        </div>
      ) : readOnly ? (
        <p className="text-sm text-gray-600">Clocked out</p>
      ) : (
        <button
          onClick={handleClockIn}
          disabled={loading}
          className="bg-gray-800 text-white rounded px-4 py-2 text-sm disabled:opacity-50"
        >
          {loading ? "..." : "Clock In"}
        </button>
      )}
      {locationError && <p className="text-amber-600 text-sm mt-2">{locationError}</p>}
      {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
    </div>
  );
}