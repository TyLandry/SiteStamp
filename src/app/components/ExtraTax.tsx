"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";

export default function ExtraTax({ readOnly = false }: { readOnly?: boolean }) {
  const [amount, setAmount] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  async function loadExtraTax() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from("profiles")
      .select("extra_tax_per_pay")
      .eq("id", user.id)
      .single();

    setAmount(data?.extra_tax_per_pay != null ? String(Number(data.extra_tax_per_pay)) : "0");
    setLoading(false);
  }

  useEffect(() => {
    // Start the load after the effect runs; the loading state already starts true
    void Promise.resolve().then(loadExtraTax);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const value = amount.trim() === "" ? 0 : parseFloat(amount);
    if (Number.isNaN(value) || value < 0) {
      setError("Enter an amount of 0 or more.");
      return;
    }

    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("You're not logged in.");
      setSaving(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ extra_tax_per_pay: value })
      .eq("id", user.id);

    if (updateError) {
      setError("Could not save. Try again.");
    } else {
      setAmount(String(value));
      setSaved(true);
    }
    setSaving(false);
  }

  return (
    <section className="panel" aria-labelledby="extratax-h">
      <div className="panel-h">
        <h2 id="extratax-h">Extra tax</h2>
      </div>
      <div className="panel-body flex flex-col gap-4">
        <p className="hint">
          Standard tax is taken off every paycheque automatically. If you&apos;d like extra taken off
          (so you don&apos;t owe at tax time), enter an amount per paycheque.
        </p>

        {loading ? (
          <span className="skeleton h-9 w-40" aria-busy="true" />
        ) : (
          <form onSubmit={handleSave} className="flex flex-wrap items-end gap-3">
            <div className="field w-44">
              <label htmlFor="extra-tax">Extra per paycheque</label>
              <div className="money">
                <span>$</span>
                <input
                  id="extra-tax"
                  className="input"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={readOnly}
                />
              </div>
            </div>
            {!readOnly && (
              <button type="submit" disabled={saving} className="btn btn-primary">
                {saving ? "Saving…" : "Save"}
              </button>
            )}
          </form>
        )}
        {saved && (
          <p className="msg-ok" role="status">
            Saved. This applies from your next pay run.
          </p>
        )}
        {error && (
          <p className="msg-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
