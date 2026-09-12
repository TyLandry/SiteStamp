"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";

type Request = {
  id: string;
  start_date: string;
  end_date: string;
  status: string;
  created_at: string;
};

export default function TimeOffRequests() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    loadRequests();
  }, []);

  async function loadRequests() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("time_off_requests")
      .select("id, start_date, end_date, status, created_at")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: false });

    setRequests(data ?? []);
    setLoading(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!startDate || !endDate) return;
    if (new Date(endDate) < new Date(startDate)) {
      setError("End date must be on or after the start date.");
      return;
    }

    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .single();

    const { error: insertError } = await supabase.from("time_off_requests").insert({
      profile_id: user.id,
      org_id: profile?.org_id,
      start_date: startDate,
      end_date: endDate,
    });

    if (insertError) {
      setError("Could not submit request.");
      setSubmitting(false);
      return;
    }

    setStartDate("");
    setEndDate("");
    setSubmitting(false);
    loadRequests();
  }

  return (
    <div className="border border-gray-300 rounded p-4">
      <h2 className="font-semibold mb-4">Time Off Requests</h2>

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 mb-6">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Start date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
            className="border border-gray-400 rounded px-2 py-1 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">End date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
            className="border border-gray-400 rounded px-2 py-1 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="bg-gray-800 text-white rounded px-4 py-2 text-sm disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Request Time Off"}
        </button>
      </form>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : requests.length === 0 ? (
        <p className="text-sm text-gray-500">No requests yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-300">
              <th className="text-left py-2 font-medium">Start</th>
              <th className="text-left py-2 font-medium">End</th>
              <th className="text-left py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-b border-gray-100">
                <td className="py-2">{new Date(r.start_date).toLocaleDateString()}</td>
                <td className="py-2">{new Date(r.end_date).toLocaleDateString()}</td>
                <td className="py-2 capitalize">{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}