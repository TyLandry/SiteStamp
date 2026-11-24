"use client";

import { useState } from "react";
import { fmtDate, parseLocalDate } from "@/utils/payPeriods";
import { round2 } from "@/utils/payroll";
import { ES_CATEGORY_LABELS } from "@/utils/leave";
import { MINIMUM_WAGE, STUDENT_MINIMUM_WAGE, STUDENT_WEEKLY_HOURS } from "@/utils/minimumWage";
import type { EmployeeReview, HolidayOverride, HolidayResult, PayRun, PayRunInput } from "@/utils/payRun";

function money(n: number) {
  return Number(n).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

const day = (d: string) => fmtDate(parseLocalDate(d));

/** People this run's vacation / holiday decisions apply to. */
export function reviewNeeded(r: EmployeeReview) {
  const v = r.vacation;
  const h = r.holiday_pct;
  return (
    r.student != null ||
    r.holidays.length > 0 ||
    (v != null && (v.timing === "accrue" || v.balance_before > 0.004)) ||
    (h != null && (h.timing === "accrue" || h.balance_before > 0.004))
  );
}

type Props = {
  run: PayRun;
  review: EmployeeReview[];
  busy: boolean;
  onSave: (input: Omit<PayRunInput, "pay_run_id" | "org_id">) => Promise<void>;
};

/** Vacation pay, holiday pay and general holiday decisions for a draft run. */
export default function PayRunReview({ run, review, busy, onSave }: Props) {
  const people = review.filter(reviewNeeded);
  if (people.length === 0) return null;
  return (
    <section className="panel" aria-labelledby="leave-h">
      <div className="panel-h">
        <h2 id="leave-h">Vacation &amp; holiday pay</h2>
        <span className="small muted">{people.length}</span>
      </div>
      <p className="hint px-4 pb-2">
        Amounts owed come from finalized pay runs. Changes here are saved with this draft and applied when it
        recalculates.
      </p>
      <ul>
        {people.map((r) => (
          <PersonReview key={`${run.id}:${r.profile_id}`} r={r} busy={busy} onSave={onSave} />
        ))}
      </ul>
    </section>
  );
}

function PersonReview({ r, busy, onSave }: { r: EmployeeReview; busy: boolean; onSave: Props["onSave"] }) {
  const [vacPayout, setVacPayout] = useState(r.input ? String(Number(r.input.vacation_payout)) : "0");
  const [onLeave, setOnLeave] = useState(r.input?.vacation_payout_on_leave ?? true);
  const [holPayout, setHolPayout] = useState(r.input ? String(Number(r.input.holiday_payout)) : "0");
  const [overrides, setOverrides] = useState<Record<string, HolidayOverride>>(r.input?.holiday_overrides ?? {});
  const [schoolBreak, setSchoolBreak] = useState(r.input?.school_break ?? false);
  const [error, setError] = useState<string | null>(null);

  const v = r.vacation;
  const h = r.holiday_pct;
  const vacAvailable = v ? round2(v.timing === "accrue" ? v.balance_before + v.earned_on_wages : v.balance_before) : 0;
  const holAvailable = h ? round2(h.timing === "accrue" ? h.balance_before + h.earned : h.balance_before) : 0;

  function setOverride(date: string, patch: HolidayOverride) {
    setOverrides((o) => {
      const next = { ...(o[date] ?? {}), ...patch };
      // Drop "auto" values so the stored object only holds real decisions
      if (next.eligible == null) delete next.eligible;
      if (next.normal_work_day == null) delete next.normal_work_day;
      if (!next.not_entitled) delete next.not_entitled;
      const copy = { ...o };
      if (Object.keys(next).length === 0) delete copy[date];
      else copy[date] = next;
      return copy;
    });
  }

  async function save() {
    setError(null);
    const vp = vacPayout.trim() === "" ? 0 : Number(vacPayout);
    const hp = holPayout.trim() === "" ? 0 : Number(holPayout);
    if (!Number.isFinite(vp) || vp < 0 || round2(vp) !== vp || !Number.isFinite(hp) || hp < 0 || round2(hp) !== hp) {
      setError("Payouts must be $0 or more, in dollars and cents.");
      return;
    }
    await onSave({
      profile_id: r.profile_id,
      vacation_payout: vp,
      vacation_payout_on_leave: onLeave,
      holiday_payout: hp,
      holiday_overrides: overrides,
      school_break: schoolBreak,
    });
  }

  return (
    <li className="list-row flex-col items-stretch gap-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{r.name}</span>
        <span className="small muted">{r.category ? ES_CATEGORY_LABELS[r.category] : "Category not chosen"}</span>
      </div>

      {r.student ? (
        <div className="small muted">
          <b className="text-ink font-semibold">Student minimum wage.</b> Paid {money(r.student.wage)}/h, student rate
          until {day(r.student.rate_until)}. Alberta allows ${STUDENT_MINIMUM_WAGE.toFixed(2)}/h for the first{" "}
          {STUDENT_WEEKLY_HOURS} hours of a school week; hours past that are topped up to ${MINIMUM_WAGE.toFixed(2)}/h
          (Regulation s.9).
          <label className="check font-normal mt-2 text-[var(--text)]">
            <input type="checkbox" checked={schoolBreak} onChange={(e) => setSchoolBreak(e.target.checked)} />
            This whole pay period is a school break for them (spring, winter or summer break)
          </label>
          <span className="hint block mt-1">
            During a school break the student rate covers every hour. Leave it off if only part of the period was a
            break; that pays the higher rate, which is always allowed.
          </span>
        </div>
      ) : null}

      {v && (v.timing === "accrue" || v.balance_before > 0.004) ? (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px] md:items-end">
          <div className="small muted">
            <b className="text-ink font-semibold">Vacation pay.</b> Owed before this run {money(v.balance_before)}
            {v.timing === "accrue" ? ` · earned this period ${money(v.earned_on_wages)}` : " · this period's is on the cheque"}{" "}
            · can pay up to {money(vacAvailable)}
            <label className="check font-normal mt-2 text-[var(--text)]">
              <input type="checkbox" checked={onLeave} onChange={(e) => setOnLeave(e.target.checked)} />
              They&apos;re on vacation this period
            </label>
            <span className="hint block mt-1">
              The CRA taxes vacation pay paid with time off like regular pay, and vacation pay paid without time off
              with the bonus method.
            </span>
          </div>
          <div className="field">
            <label htmlFor={`vp-${r.profile_id}`}>Vacation pay to pay now</label>
            <div className="flex gap-2">
              <div className="money flex-1">
                <span>$</span>
                <input
                  id={`vp-${r.profile_id}`}
                  className="input"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={vacPayout}
                  onChange={(e) => setVacPayout(e.target.value)}
                />
              </div>
              <button type="button" className="btn" onClick={() => setVacPayout(vacAvailable.toFixed(2))}>
                All
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {h && (h.timing === "accrue" || h.balance_before > 0.004) ? (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px] md:items-end">
          <p className="small muted">
            <b className="text-ink font-semibold">General holiday pay (3.6%).</b> Owed before this run{" "}
            {money(h.balance_before)}
            {h.timing === "accrue" ? ` · earned this period ${money(h.earned)}` : " · this period's is on the cheque"} ·
            can pay up to {money(holAvailable)}. Must be paid by December 31.
          </p>
          <div className="field">
            <label htmlFor={`hp-${r.profile_id}`}>Holiday pay to pay now</label>
            <div className="flex gap-2">
              <div className="money flex-1">
                <span>$</span>
                <input
                  id={`hp-${r.profile_id}`}
                  className="input"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={holPayout}
                  onChange={(e) => setHolPayout(e.target.value)}
                />
              </div>
              <button type="button" className="btn" onClick={() => setHolPayout(holAvailable.toFixed(2))}>
                All
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {r.holidays.map((hol) => (
        <HolidayDecision
          key={hol.date}
          id={`${r.profile_id}-${hol.date}`}
          h={hol}
          value={overrides[hol.date] ?? {}}
          onChange={(patch) => setOverride(hol.date, patch)}
        />
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn" onClick={save} disabled={busy}>
          {busy ? "Working…" : "Save and recalculate"}
        </button>
        {error ? (
          <p className="msg-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function triState(v: boolean | null | undefined) {
  return v == null ? "auto" : v ? "yes" : "no";
}
function fromTriState(v: string) {
  return v === "auto" ? null : v === "yes";
}

function HolidayDecision({
  id,
  h,
  value,
  onChange,
}: {
  id: string;
  h: HolidayResult;
  value: HolidayOverride;
  onChange: (patch: HolidayOverride) => void;
}) {
  const weekday = parseLocalDate(h.date).toLocaleDateString(undefined, { weekday: "long" });
  const adw = h.average_daily_wage;
  return (
    <div className="note-box flex flex-col gap-3 text-[var(--text)]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">
          {h.name} · {day(h.date)}
        </span>
        <span className="font-semibold num">{h.pay > 0 ? money(h.pay) : "No holiday pay"}</span>
      </div>
      <ul className="small muted flex flex-col gap-1">
        <li>
          {h.work_days_12_months} work day{h.work_days_12_months === 1 ? "" : "s"} in the 12 months before ·{" "}
          {h.eligible ? "eligible" : "not eligible"} (needs 30, Code s.26(1)){h.eligible_overridden ? " · your decision" : ""}
        </li>
        <li>
          Worked {weekday}s in {h.weeks_worked_of_9} of the 9 weeks before ·{" "}
          {h.normal_work_day ? "a normal work day" : "not a normal work day"} (5 of 9, Code s.27)
          {h.normal_overridden ? " · your decision" : ""}
        </li>
        <li>Worked {h.worked_hours.toFixed(2)} h on the holiday</li>
        {adw ? (
          <li>
            Average daily wage {money(adw.amount)}: {money(adw.wages)} wages ({adw.regular_hours.toFixed(2)} regular h) ÷{" "}
            {adw.days} day{adw.days === 1 ? "" : "s"} worked, {day(adw.period_start)} – {day(adw.period_end)} (Code s.24.1)
          </li>
        ) : null}
        {h.premium ? (
          <li>
            Hours worked paid at 1.5×: {h.premium.hours.toFixed(2)} h × {money(h.premium.rate)} = {money(h.premium.amount)}{" "}
            (Code ss.29–30; not counted toward overtime, s.33)
          </li>
        ) : null}
        {h.not_entitled ? <li>Marked not entitled (Code s.26(2))</li> : null}
      </ul>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="field">
          <label htmlFor={`elig-${id}`}>Eligible</label>
          <select
            id={`elig-${id}`}
            className="select"
            value={triState(value.eligible)}
            onChange={(e) => onChange({ eligible: fromTriState(e.target.value) })}
          >
            <option value="auto">From clock records</option>
            <option value="yes">Yes: 30+ work days in the last 12 months</option>
            <option value="no">No</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={`normal-${id}`}>Normal work day for them</label>
          <select
            id={`normal-${id}`}
            className="select"
            value={triState(value.normal_work_day)}
            onChange={(e) => onChange({ normal_work_day: fromTriState(e.target.value) })}
          >
            <option value="auto">From clock records</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </div>
      </div>
      <label className="check font-normal items-start">
        <input
          type="checkbox"
          checked={value.not_entitled === true}
          onChange={(e) => onChange({ not_entitled: e.target.checked })}
        />
        <span>
          Not entitled: didn&apos;t work the holiday when scheduled, or missed their last scheduled day before or first
          after it without your OK (Code s.26(2))
        </span>
      </label>
      <p className="hint">
        If they work a normal work day holiday, SiteStamp pays the average daily wage plus 1.5× for hours worked
        (Code s.29(1)(a)). Giving a paid day off later instead (s.29(1)(b)) isn&apos;t supported.
      </p>
    </div>
  );
}
