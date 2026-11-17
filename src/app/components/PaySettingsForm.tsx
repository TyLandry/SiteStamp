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
    <section aria-label="Pay settings">
      {loading ? (
        <div className="panel p-4 flex flex-col gap-3" aria-busy="true">
          <span className="skeleton w-48" />
          <span className="skeleton w-full" />
          <span className="skeleton w-2/3" />
        </div>
      ) : (
        <form onSubmit={handleSave}>
          {/* ---------- Pay period ---------- */}
          <div className="setting">
            <div>
              <h2>Pay period</h2>
              <p className="hint mt-1">
                How often your company pays its crew. Hours and pay runs are grouped by this.
              </p>
            </div>
            <div className="panel panel-body pt-4 flex flex-col gap-4">
              <div className="field max-w-sm">
                <label htmlFor="pay-frequency">Pay frequency</label>
                <select
                  id="pay-frequency"
                  className="select"
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as PayFrequency)}
                >
                  {(Object.keys(PAY_FREQUENCY_LABELS) as PayFrequency[]).map((key) => (
                    <option key={key} value={key}>
                      {PAY_FREQUENCY_LABELS[key]}
                    </option>
                  ))}
                </select>
              </div>

              {needsAnchor && (
                <div className="field max-w-sm">
                  <label htmlFor="pay-anchor">First day of a pay period</label>
                  <input
                    id="pay-anchor"
                    className="input"
                    type="date"
                    value={anchor}
                    onChange={(e) => setAnchor(e.target.value)}
                  />
                  <span className="hint">
                    Any past or upcoming period start works. The app repeats the cycle from there.
                  </span>
                </div>
              )}

              <div className="note-box">
                <p>
                  Current period: <b className="text-ink font-semibold">{fmtDate(current.start)} – {fmtDate(current.end)}</b>
                </p>
                <p>
                  Next period: <b className="text-ink font-semibold">{fmtDate(next.start)} – {fmtDate(next.end)}</b>
                </p>
              </div>
            </div>
          </div>

          {/* ---------- Overtime ---------- */}
          <div className="setting">
            <div>
              <h2>Overtime</h2>
              <p className="hint mt-1">
                Most employees are legally entitled to overtime. Only turn this off if your company is
                exempt or has a written overtime agreement. Subcontractors never get overtime.
              </p>
            </div>
            <div className="panel panel-body pt-4 flex flex-col gap-4">
              <label className="check">
                <input
                  type="checkbox"
                  checked={otEnabled}
                  onChange={(e) => setOtEnabled(e.target.checked)}
                />
                Pay overtime
              </label>

              {otEnabled && (
                <>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="field">
                      <label htmlFor="ot-daily">Hours per day before overtime</label>
                      <input
                        id="ot-daily"
                        className="input"
                        type="number"
                        inputMode="decimal"
                        step="0.25"
                        min="0"
                        value={dailyHours}
                        onChange={(e) => setDailyHours(e.target.value)}
                        placeholder="No daily limit"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="ot-weekly">Hours per week before overtime</label>
                      <input
                        id="ot-weekly"
                        className="input"
                        type="number"
                        inputMode="decimal"
                        step="0.25"
                        min="0"
                        value={weeklyHours}
                        onChange={(e) => setWeeklyHours(e.target.value)}
                        placeholder="No weekly limit"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="ot-rate">Overtime rate (×)</label>
                      <input
                        id="ot-rate"
                        className="input"
                        type="number"
                        inputMode="decimal"
                        step="0.1"
                        min="1"
                        value={multiplier}
                        onChange={(e) => setMultiplier(e.target.value)}
                      />
                    </div>
                  </div>
                  <p className="hint">
                    Leave a limit blank to turn that rule off. Alberta default: 8 hours/day or 44
                    hours/week, whichever gives more overtime, at 1.5×.
                  </p>

                  <div className="field max-w-sm">
                    <label htmlFor="ot-week-start">Work week starts on</label>
                    <select
                      id="ot-week-start"
                      className="select"
                      value={weekStart}
                      onChange={(e) => setWeekStart(Number(e.target.value))}
                    >
                      {WEEK_DAYS.map((name, i) => (
                        <option key={name} value={i}>
                          {name}
                        </option>
                      ))}
                    </select>
                    <span className="hint">
                      Weekly overtime is counted per work week, even when a pay period ends mid-week.
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="setting">
            <div />
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={saving} className="btn btn-primary">
                {saving ? "Saving…" : "Save settings"}
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
            </div>
          </div>
        </form>
      )}
    </section>
  );
}
