"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";

type DayGroup = { date: string; hours: number };

export default function HoursSummary() {
  const [days, setDays] = useState<DayGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<"7" | "30" | "all">("7");
  const supabase = createClient();

  useEffect(() => {
    calculateHours();
  }, [range]);

  async function calculateHours() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

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

    const grouped: Record<string, number> = {};
    entries.forEach((entry) => {
      const dateKey = new Date(entry.clock_in).toLocaleDateString();
      const hours =
        (new Date(entry.clock_out).getTime() - new Date(entry.clock_in).getTime()) /
        (1000 * 60 * 60);
      grouped[dateKey] = (grouped[dateKey] || 0) + hours;
    });

    const dayList = Object.entries(grouped)
      .map(([date, hours]) => ({ date, hours }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    setDays(dayList);
    setLoading(false);
  }

  const total = days.reduce((sum, d) => sum + d.hours, 0);

  return (
    <div className="border border-gray-300 rounded p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold">Hours Worked</h2>
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
      ) : days.length === 0 ? (
        <p className="text-sm text-gray-500">No completed shifts in this range.</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-300">
                <th className="text-left py-2 font-medium">Date</th>
                <th className="text-left py-2 font-medium">Hours</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date} className="border-b border-gray-100">
                  <td className="py-2">{d.date}</td>
                  <td className="py-2">{d.hours.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 font-semibold text-sm">Total: {total.toFixed(2)} hours</p>
        </>
      )}
    </div>
  );
}