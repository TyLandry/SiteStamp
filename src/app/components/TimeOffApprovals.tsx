"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";

type Request = {
  id: string;
  start_date: string;
  end_date: string;
  status: string;
  profile_id: string;
  full_name: string | null;
};

export default function TimeOffApprovals() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    loadRequests();
  }, []);

  async function loadRequests() {
    setLoading(true);
    const { data } = await supabase
      .from("time_off_requests")
      .select("id, start_date, end_date, status, profile_id, profiles(full_name)")
      .order("created_at", { ascending: false });

    const mapped = (data ?? []).map((row: any) => ({
      id: row.id,
      start_date: row.start_date,
      end_date: row.end_date,
      status: row.status,
      profile_id: row.profile_id,
      full_name: row.profiles?.full_name ?? "Unknown",
    }));

    setRequests(mapped);
    setLoading(false);
  }

  async function updateStatus(id: string, status: "approved" | "denied") {
    setUpdatingId(id);
    await supabase.from("time_off_requests").update({ status }).eq("id", id);
    await loadRequests();
    setUpdatingId(null);
  }

  return (
    <div className="border border-gray-300 rounded p-4">
      <h2 className="font-semibold mb-4">Time Off Requests</h2>

      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : requests.length === 0 ? (
        <p className="text-sm text-gray-500">No requests.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-300">
              <th className="text-left py-2 font-medium">Employee</th>
              <th className="text-left py-2 font-medium">Start</th>
              <th className="text-left py-2 font-medium">End</th>
              <th className="text-left py-2 font-medium">Status</th>
              <th className="text-left py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-b border-gray-100">
                <td className="py-2">{r.full_name}</td>
                <td className="py-2">{new Date(r.start_date).toLocaleDateString()}</td>
                <td className="py-2">{new Date(r.end_date).toLocaleDateString()}</td>
                <td className="py-2 capitalize">{r.status}</td>
                <td className="py-2">
                  {r.status === "pending" && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => updateStatus(r.id, "approved")}
                        disabled={updatingId === r.id}
                        className="bg-gray-800 text-white rounded px-3 py-1 text-xs disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => updateStatus(r.id, "denied")}
                        disabled={updatingId === r.id}
                        className="border border-gray-400 rounded px-3 py-1 text-xs hover:bg-gray-100"
                      >
                        Deny
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}