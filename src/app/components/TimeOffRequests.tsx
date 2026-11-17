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

// "2026-11-12" -> local date (avoids the off-by-one-day UTC shift)
function formatDate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusPill(status: string) {
  if (status === "approved") return <span className="pill pill-ok">Approved</span>;
  if (status === "denied") return <span className="pill">Denied</span>;
  if (status === "pending") return <span className="pill pill-warn">Waiting</span>;
  return <span className="pill capitalize">{status}</span>;
}

export default function TimeOffRequests({ readOnly = false }: { readOnly?: boolean }) {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  async function loadRequests() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from("time_off_requests")
      .select("id, start_date, end_date, status, created_at")
      .eq("profile_id", user.id)
      .order("created_at", { ascending: false });

    setRequests(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    // Start the load after the effect runs; the loading state already starts true
    void Promise.resolve().then(loadRequests);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!startDate || !endDate) return;
    if (endDate < startDate) {
      setError("End date must be on or after the start date.");
      return;
    }

    setSubmitting(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("You're not logged in.");
      setSubmitting(false);
      return;
    }

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
    <section className="panel" aria-labelledby="timeoff-h">
      <div className="panel-h">
        <h2 id="timeoff-h">Time off</h2>
        {!loading ? <span className="small muted">{requests.length} request{requests.length === 1 ? "" : "s"}</span> : null}
      </div>

      {!readOnly && (
        <form onSubmit={handleSubmit} className="panel-body grid grid-cols-2 gap-3">
          <div className="field">
            <label htmlFor="timeoff-start">First day off</label>
            <input
              id="timeoff-start"
              className="input"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="timeoff-end">Last day off</label>
            <input
              id="timeoff-end"
              className="input"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
          </div>
          <button type="submit" disabled={submitting} className="btn btn-primary col-span-2">
            {submitting ? "Sending…" : "Request time off"}
          </button>
          {error && (
            <p className="msg-error col-span-2" role="alert">
              {error}
            </p>
          )}
        </form>
      )}

      {loading ? (
        <div className="panel-body flex flex-col gap-3" aria-busy="true">
          <span className="skeleton w-full" />
          <span className="skeleton w-2/3" />
        </div>
      ) : requests.length === 0 ? (
        <div className="panel-body">
          <p className="empty">No requests yet.</p>
        </div>
      ) : (
        <ul className="border-t border-[var(--rule)]">
          {requests.map((r) => (
            <li key={r.id} className="list-row">
              <div className="min-w-0">
                {r.start_date === r.end_date
                  ? formatDate(r.start_date)
                  : `${formatDate(r.start_date)} – ${formatDate(r.end_date)}`}
              </div>
              {statusPill(r.status)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
