"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import {
  type PayFrequency,
  DEFAULT_PAY_SETTINGS,
  PAY_FREQUENCY_LABELS,
  addDays,
  getPeriod,
  fmtDate,
} from "@/utils/payPeriods";
import { DEFAULT_OVERTIME_SETTINGS } from "@/utils/overtime";

const WEEK_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// "" in an input means "no limit"
function toInput(n: number | null) {
  return n == null ? "" : String(Number(n));
}

export default function PaySettingsForm() {
  const supabase = createClient();

  // Pay period
  const [frequency, setFrequency] = useState<PayFrequency>(DEFAULT_PAY_SETTINGS.pay_frequency);
  const [anchor, setAnchor] = useState(DEFAULT_PAY_SETTINGS.period_anchor_date);

  // Overtime
  const [otEnabled, setOtEnabled] = useState(DEFAULT_OVERTIME_SETTINGS.overtime_enabled);
  const [dailyHours, setDailyHours] = useState(toInput(DEFAULT_OVERTIME_SETTINGS.overtime_daily_hours));
  const [weeklyHours, setWeeklyHours] = useState(toInput(DEFAULT_OVERTIME_SETTINGS.overtime_weekly_hours));
  const [multiplier, setMultiplier] = useState(String(DEFAULT_OVERTIME_SETTINGS.overtime_multiplier));
  const [weekStart, setWeekStart] = useState(DEFAULT_OVERTIME_SETTINGS.work_week_start);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const needsAnchor = frequency === "weekly" || frequency === "biweekly";

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("org_settings")
        .select(
          "pay_frequency, period_anchor_date, overtime_enabled, overtime_daily_hours, overtime_weekly_hours, overtime_multiplier, work_week_start"
        )
        .maybeSingle();

      if (data) {
        setFrequency(data.pay_frequency);
        setAnchor(data.period_anchor_date);
        setOtEnabled(data.overtime_enabled);
        setDailyHours(toInput(data.overtime_daily_hours));
        setWeeklyHours(toInput(data.overtime_weekly_hours));
        setMultiplier(String(Number(data.overtime_multiplier)));
        setWeekStart(data.work_week_start);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Returns a number, null for blank, or undefined if invalid
  function parseHours(value: string): number | null | undefined {
    if (value.trim() === "") return null;
    const n = parseFloat(value);
    return Number.isNaN(n) || n <= 0 ? undefined : n;
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (needsAnchor && !anchor) {
      setError("Pick the first day of a pay period.");
      return;
    }

    const daily = parseHours(dailyHours);
    const weekly = parseHours(weeklyHours);
    const rate = parseFloat(multiplier);

    if (otEnabled) {
      if (daily === undefined || weekly === undefined) {
        setError("Overtime hours must be a number greater than 0, or left blank.");
        return;
      }
      if (daily === null && weekly === null) {
        setError("Set a daily limit, a weekly limit, or both.");
        return;
      }
      if (Number.isNaN(rate) || rate < 1) {
        setError("Overtime rate must be at least 1.");
        return;
      }
    }

    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError("You're not logged in.");
      setSaving(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .single();

    const { error: saveError } = await supabase.from("org_settings").upsert(
      {
        org_id: profile?.org_id,
        pay_frequency: frequency,
        period_anchor_date: anchor,
        overtime_enabled: otEnabled,
        // When overtime is off, keep whatever was there so turning it back on restores it
        overtime_daily_hours: otEnabled ? daily : parseHours(dailyHours) ?? null,
        overtime_weekly_hours: otEnabled ? weekly : parseHours(weeklyHours) ?? null,
        overtime_multiplier: Number.isNaN(rate) || rate < 1 ? 1.5 : rate,
        work_week_start: weekStart,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id" }
    );

    if (saveError) setError(saveError.message);
    else setMessage("Settings saved.");
    setSaving(false);
  }

  // Live preview of the current and next period
  const previewSettings = {
    pay_frequency: frequency,
    period_anchor_date: anchor || DEFAULT_PAY_SETTINGS.period_anchor_date,
  };
  const current = getPeriod(previewSettings, new Date());
  const next = getPeriod(previewSettings, addDays(current.end, 1));

  return (
    <div className="border border-gray-300 rounded p-4">
      <h2 className="font-semibold mb-1">Pay Settings</h2>
      <p className="text-sm text-gray-500 mb-4">
        How often your company pays its staff, and how overtime is handled.
      </p>

      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : (
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          {/* ---------- Pay period ---------- */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Pay frequency</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as PayFrequency)}
              className="border border-gray-400 rounded px-3 py-2 w-72"
            >
              {(Object.keys(PAY_FREQUENCY_LABELS) as PayFrequency[]).map((key) => (
                <option key={key} value={key}>
                  {PAY_FREQUENCY_LABELS[key]}
                </option>
              ))}
            </select>
          </div>

          {needsAnchor && (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium">First day of a pay period</label>
              <input
                type="date"
                value={anchor}
                onChange={(e) => setAnchor(e.target.value)}
                className="border border-gray-400 rounded px-3 py-2 w-48"
              />
              <p className="text-xs text-gray-500">
                Any past or upcoming period start works. The app repeats the cycle from there.
              </p>
            </div>
          )}

          <div className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded px-3 py-2">
            <p>Current period: {fmtDate(current.start)} – {fmtDate(current.end)}</p>
            <p>Next period: {fmtDate(next.start)} – {fmtDate(next.end)}</p>
          </div>

          {/* ---------- Overtime ---------- */}
          <div className="border-t border-gray-200 pt-4 flex flex-col gap-4">
            <h3 className="font-medium">Overtime</h3>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={otEnabled}
                onChange={(e) => setOtEnabled(e.target.checked)}
              />
              Pay overtime
            </label>
            <p className="text-xs text-gray-500 -mt-2">
              Most employees are legally entitled to overtime. Only turn this off if your
              company is exempt or has a written overtime agreement. Subcontractors never
              get overtime.
            </p>

            {otEnabled && (
              <>
                <div className="flex flex-wrap gap-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium">Hours per day before overtime</label>
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      value={dailyHours}
                      onChange={(e) => setDailyHours(e.target.value)}
                      placeholder="No daily limit"
                      className="border border-gray-400 rounded px-3 py-2 w-40"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium">Hours per week before overtime</label>
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      value={weeklyHours}
                      onChange={(e) => setWeeklyHours(e.target.value)}
                      placeholder="No weekly limit"
                      className="border border-gray-400 rounded px-3 py-2 w-40"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium">Overtime rate (×)</label>
                    <input
                      type="number"
                      step="0.1"
                      min="1"
                      value={multiplier}
                      onChange={(e) => setMultiplier(e.target.value)}
                      className="border border-gray-400 rounded px-3 py-2 w-28"
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-500 -mt-2">
                  Leave a limit blank to turn that rule off. Alberta default: 8 hours/day or 44
                  hours/week, whichever gives more overtime, at 1.5×.
                </p>

                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Work week starts on</label>
                  <select
                    value={weekStart}
                    onChange={(e) => setWeekStart(Number(e.target.value))}
                    className="border border-gray-400 rounded px-3 py-2 w-48"
                  >
                    {WEEK_DAYS.map((name, i) => (
                      <option key={name} value={i}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500">
                    Weekly overtime is counted per work week, even when a pay period ends mid-week.
                  </p>
                </div>
              </>
            )}
          </div>

          <div>
            <button
              type="submit"
              disabled={saving}
              className="bg-gray-800 text-white rounded px-4 py-2 text-sm disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      )}
      {message && <p className="text-green-600 text-sm mt-3">{message}</p>}
      {error && <p className="text-red-600 text-sm mt-3">{error}</p>}
    </div>
  );
}