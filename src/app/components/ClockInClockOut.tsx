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
    <div style={{ marginTop: 20, padding: 16, border: "1px solid #ccc" }}>
      {activeEntry ? (
        <>
          <p>Clocked in since: {new Date(activeEntry.clock_in).toLocaleTimeString()}</p>
          <button onClick={handleClockOut} disabled={loading}>
            {loading ? "..." : "Clock Out"}
          </button>
        </>
      ) : (
        <button onClick={handleClockIn} disabled={loading}>
          {loading ? "..." : "Clock In"}
        </button>
      )}
    </div>
  );
}