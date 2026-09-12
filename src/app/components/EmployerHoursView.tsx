"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";

type Entry = {
  id: string;
  clock_in: string;
  clock_out: string | null;
  profile_id: string;
  full_name: string | null;
};

export default function EmployerHoursView() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<"7" | "30" | "all">("7");
  const supabase = createClient();

  useEffect(() => {
    loadEntries();
  }, [range]);

  async function loadEntries() {
    setLoading(true);

    let query = supabase
      .from("time_entries")
      .select("id, clock_in, clock_out, profile_id, profiles(full_name)")
      .order("clock_in", { ascending: false });

    if (range !== "all") {
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - parseInt(range));
      query = query.gte("clock_in", daysAgo.toISOString());
    }

    const { data, error } = await query;

    if (error || !data) {
      setEntries([]);
      setLoading(false);
      return;
    }

    const mapped = data.map((row: any) => ({
      id: row.id,
      clock_in: row.clock_in,
      clock_out: row.clock_out,
      profile_id: row.profile_id,
      full_name: row.profiles?.full_name ?? "Unknown",
    }));

    setEntries(mapped);
    setLoading(false);
  }

  return (
    <div className="border border-gray-300 rounded p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">Employee Time Entries</h2>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as "7" | "30" | "all")}
          className="border border-gray-400 rounded px-2 py-1 text-sm"
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="all">All time</option>
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-gray-500">No time entries in this range.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-300">
              <th className="text-left py-2 font-medium">Employee</th>
              <th className="text-left py-2 font-medium">Clock In</th>
              <th className="text-left py-2 font-medium">Clock Out</th>
              <th className="text-left py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-gray-100">
                <td className="py-2">{e.full_name}</td>
                <td className="py-2">{new Date(e.clock_in).toLocaleString()}</td>
                <td className="py-2">
                  {e.clock_out ? new Date(e.clock_out).toLocaleString() : "—"}
                </td>
                <td className="py-2">{e.clock_out ? "Complete" : "Active"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}