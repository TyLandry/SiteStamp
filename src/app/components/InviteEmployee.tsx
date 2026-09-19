"use client";

import { useState } from "react";

export default function InviteEmployee() {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    const res = await fetch("/api/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, fullName }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
    } else {
      setMessage(`Invite sent to ${email}.`);
      setEmail("");
      setFullName("");
    }
    setLoading(false);
  }

  return (
    <div className="border border-gray-300 rounded p-4">
      <h2 className="font-semibold mb-4">Invite Employee</h2>
      <form onSubmit={handleInvite} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Full name</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className="border border-gray-400 rounded px-3 py-2"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="border border-gray-400 rounded px-3 py-2"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="bg-gray-800 text-white rounded px-4 py-2 text-sm disabled:opacity-50"
        >
          {loading ? "Sending..." : "Send Invite"}
        </button>
      </form>
      {message && <p className="text-green-600 text-sm mt-3">{message}</p>}
      {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
    </div>
  );
}