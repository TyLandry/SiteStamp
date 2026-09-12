"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";

export default function ClockInOut() {
  const [loading, setLoading] = useState(false);
  const [activeEntry, setActiveEntry] = useState<{ id: string; clock_in: string } | null>(null);
  const supabase = createClient();

  useEffect(() => {
    checkActiveEntry();
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

  async function handleClockIn() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .single();

    await supabase.from("time_entries").insert({
      profile_id: user.id,
      org_id: profile?.org_id,
      clock_in: new Date().toISOString(),
    });

    await checkActiveEntry();
    setLoading(false);
  }

  async function handleClockOut() {
    if (!activeEntry) return;
    setLoading(true);

    await supabase
      .from("time_entries")
      .update({ clock_out: new Date().toISOString() })
      .eq("id", activeEntry.id);

    setActiveEntry(null);
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
          <button
            onClick={handleClockOut}
            disabled={loading}
            className="bg-gray-800 text-white rounded px-4 py-2 text-sm disabled:opacity-50"
          >
            {loading ? "..." : "Clock Out"}
          </button>
        </div>
      ) : (
        <button
          onClick={handleClockIn}
          disabled={loading}
          className="bg-gray-800 text-white rounded px-4 py-2 text-sm disabled:opacity-50"
        >
          {loading ? "..." : "Clock In"}
        </button>
      )}
    </div>
  );
}