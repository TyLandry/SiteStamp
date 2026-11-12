"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";

export default function TaxInfo({ readOnly = false }: { readOnly?: boolean }) {
  const [claimAmount, setClaimAmount] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    loadTaxInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadTaxInfo() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from("profiles")
      .select("tax_claim_amount")
      .eq("id", user.id)
      .single();

    if (data?.tax_claim_amount != null) {
      setClaimAmount(String(data.tax_claim_amount));
    }
    setLoading(false);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const amount = parseFloat(claimAmount);
    if (claimAmount.trim() === "" || Number.isNaN(amount) || amount < 0) {
      setError("Enter a valid amount (0 or more).");
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
      .update({ tax_claim_amount: amount })
      .eq("id", user.id);

    if (updateError) {
      setError("Could not save. Try again.");
    } else {
      setSaved(true);
    }
    setSaving(false);
  }

  return (
    <div className="border border-gray-300 rounded p-4">
      <h2 className="font-semibold mb-1">Tax Information</h2>
      <p className="text-sm text-gray-500 mb-4">
        Enter your total tax claim amount from your TD1 form.
      </p>

      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : (
        <form onSubmit={handleSave} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Tax claim amount ($)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={claimAmount}
              onChange={(e) => setClaimAmount(e.target.value)}
              required
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
      {saved && <p className="text-green-600 text-sm mt-2">Saved.</p>}
      {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
    </div>
  );
}