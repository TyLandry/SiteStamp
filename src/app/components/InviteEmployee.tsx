"use client";

import { useState } from "react";

export default function InviteEmployee() {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [employeeType, setEmployeeType] = useState<"employee" | "subcontractor">(
    "employee"
  );
  const [hourlyWage, setHourlyWage] = useState("");
  const [gstNumber, setGstNumber] = useState("");
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
      body: JSON.stringify({
        email,
        fullName,
        employeeType,
        hourlyWage,
        gstNumber,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
    } else {
      setMessage(`Invite sent to ${email}.`);
      setEmail("");
      setFullName("");
      setEmployeeType("employee");
      setHourlyWage("");
      setGstNumber("");
    }
    setLoading(false);
  }

  return (
    <section className="panel" aria-labelledby="invite-h">
      <div className="panel-h">
        <h2 id="invite-h">Invite to crew</h2>
      </div>
      <form onSubmit={handleInvite} className="panel-body flex flex-col gap-4">
        <p className="hint">
          We email them a link to set a password. There&apos;s no public sign-up.
        </p>
        <div className="field">
          <label htmlFor="invite-name">Full name</label>
          <input
            id="invite-name"
            className="input"
            type="text"
            autoComplete="off"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="invite-email">Email</label>
          <input
            id="invite-email"
            className="input"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="field">
            <label htmlFor="invite-type">Type</label>
            <select
              id="invite-type"
              className="select"
              value={employeeType}
              onChange={(e) =>
                setEmployeeType(e.target.value as "employee" | "subcontractor")
              }
            >
              <option value="employee">Employee</option>
              <option value="subcontractor">Subcontractor</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="invite-wage">Hourly wage</label>
            <div className="money">
              <span>$</span>
              <input
                id="invite-wage"
                className="input"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={hourlyWage}
                onChange={(e) => setHourlyWage(e.target.value)}
              />
            </div>
          </div>
        </div>
        {employeeType === "subcontractor" && (
          <div className="field">
            <label htmlFor="invite-gst">GST number</label>
            <input
              id="invite-gst"
              className="input"
              type="text"
              value={gstNumber}
              onChange={(e) => setGstNumber(e.target.value)}
            />
            <span className="hint">With a GST number, 5% GST is added to their payments.</span>
          </div>
        )}
        <button type="submit" disabled={loading} className="btn btn-primary btn-block">
          {loading ? "Sending…" : "Send invite"}
        </button>
        {message && (
          <p className="msg-ok" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="msg-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
