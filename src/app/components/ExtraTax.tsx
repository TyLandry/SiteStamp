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

  useEffect(() => {
    loadExtraTax();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <div className="border border-gray-300 rounded p-4">
      <h2 className="font-semibold mb-1">Extra Tax</h2>
      <p className="text-sm text-gray-500 mb-4">
        Standard tax is taken off every paycheque automatically. If you&apos;d like extra
        taken off (so you don&apos;t owe at tax time), enter an amount per paycheque.
      </p>

      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : (
        <form onSubmit={handleSave} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Extra tax per paycheque ($)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={readOnly}
              className="border border-gray-400 rounded px-3 py-2 w-40 disabled:bg-gray-100 disabled:text-gray-500"
            />
          </div>
          {!readOnly && (
            <button
              type="submit"
              disabled={saving}
              className="bg-gray-800 text-white rounded px-4 py-2 text-sm disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          )}
        </form>
      )}
      {saved && <p className="text-green-600 text-sm mt-2">Saved. This applies from your next pay run.</p>}
      {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
    </div>
  );
}