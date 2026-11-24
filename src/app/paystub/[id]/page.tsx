import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { fmtDate, parseLocalDate } from "@/utils/payPeriods";
import type { StubDeduction } from "@/utils/deductions";
import type { EmployerSnapshot, HolidayResult, PercentPay, VacationPay } from "@/utils/payRun";
import PrintButton from "../../components/PrintButton";
import { ChevronLeftIcon } from "../../components/ui/Icons";

function money(n: number) {
  return Number(n).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

function pct(r: number) {
  return `${(r * 100).toFixed(r * 100 % 1 === 0 ? 0 : 1)}%`;
}

const day = (d: string) => fmtDate(parseLocalDate(d));

type Totals = {
  gross: number;
  cpp: number;
  cpp2: number;
  ei: number;
  federal_tax: number;
  provincial_tax: number;
  gst: number;
  net_pay: number;
  other_deductions_total: number;
  vacation_pay_paid: number;
  holiday: number;
};

const ZERO: Totals = {
  gross: 0,
  cpp: 0,
  cpp2: 0,
  ei: 0,
  federal_tax: 0,
  provincial_tax: 0,
  gst: 0,
  net_pay: 0,
  other_deductions_total: 0,
  vacation_pay_paid: 0,
  holiday: 0,
};

type EarningLine = { code: string; label: string; hours?: number; rate?: number; amount: number };

export default async function PayStubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const isEmployer = me?.role === "employer";

  // Security rules decide what comes back: employees only get their own
  // finalized stubs; employers get any stub in their company.
  const { data: stub } = await supabase
    .from("pay_stubs")
    .select("*, pay_runs(status)")
    .eq("id", id)
    .maybeSingle();

  if (!stub) notFound();

  const runStatus = (stub.pay_runs as { status: string } | null)?.status ?? "draft";
  const isDraft = runStatus !== "finalized";
  const isSub = stub.employee_type === "subcontractor";
  const name = String(stub.details?.full_name ?? "Employee");

  // Year-to-date: every finalized stub for this person this calendar year,
  // up to and including this pay date
  const yearStart = `${stub.pay_date.slice(0, 4)}-01-01`;
  const [{ data: ytdRows }, { data: org }] = await Promise.all([
    supabase
      .from("pay_stubs")
      .select(
        "id, gross, cpp, cpp2, ei, federal_tax, provincial_tax, gst, net_pay, other_deductions, other_deductions_total, vacation_pay_paid, general_holiday_pay, holiday_pay_paid, pay_runs!inner(status)"
      )
      .eq("profile_id", stub.profile_id)
      .eq("pay_runs.status", "finalized")
      .gte("pay_date", yearStart)
      .lte("pay_date", stub.pay_date),
    // Older stubs have no saved employer block; fall back to the company name
    stub.details?.employer
      ? Promise.resolve({ data: null })
      : supabase.from("orgs").select("name").eq("id", stub.org_id).maybeSingle(),
  ]);

  const ytd: Totals = { ...ZERO };
  const ytdOther = new Map<string, number>();
  const rows = [...(ytdRows ?? [])];
  if (isDraft) rows.push(stub); // a draft isn't in the finalized list yet
  for (const r of rows) {
    ytd.gross += Number(r.gross ?? 0);
    ytd.cpp += Number(r.cpp ?? 0);
    ytd.cpp2 += Number(r.cpp2 ?? 0);
    ytd.ei += Number(r.ei ?? 0);
    ytd.federal_tax += Number(r.federal_tax ?? 0);
    ytd.provincial_tax += Number(r.provincial_tax ?? 0);
    ytd.gst += Number(r.gst ?? 0);
    ytd.net_pay += Number(r.net_pay ?? 0);
    ytd.other_deductions_total += Number(r.other_deductions_total ?? 0);
    ytd.vacation_pay_paid += Number(r.vacation_pay_paid ?? 0);
    ytd.holiday += Number(r.general_holiday_pay ?? 0) + Number(r.holiday_pay_paid ?? 0);
    for (const d of (r.other_deductions ?? []) as StubDeduction[]) {
      const key = d.deduction_id ?? d.name;
      ytdOther.set(key, (ytdOther.get(key) ?? 0) + Number(d.amount ?? 0));
    }
  }

  const employer: EmployerSnapshot | null =
    (stub.details?.employer as EmployerSnapshot | null | undefined) ??
    ((org as { name?: string | null } | null)?.name
      ? { name: (org as { name: string }).name, trading_name: null, address: [], phone: null, email: null }
      : null);

  // Earnings lines: saved on stubs from calc version 2; worked out for older ones
  const wage = Number(stub.hourly_wage);
  const multiplier = Number(stub.overtime_multiplier);
  const saved = (stub.details?.earnings ?? null) as EarningLine[] | null;
  const earnings: EarningLine[] =
    saved && saved.length > 0
      ? saved
      : [
          { code: "regular", label: "Regular", hours: Number(stub.regular_hours), rate: wage, amount: Number(stub.regular_hours) * wage },
          ...(Number(stub.overtime_hours) > 0
            ? [
                {
                  code: "overtime",
                  label: `Overtime (${multiplier}×)`,
                  hours: Number(stub.overtime_hours),
                  rate: wage * multiplier,
                  amount: Number(stub.overtime_hours) * wage * multiplier,
                },
              ]
            : []),
        ];

  // Year-to-date holiday pay (all kinds) is shown once, on the first holiday line
  const firstHolidayLine = earnings.findIndex((e) => e.code.startsWith("holiday"));

  const other = (stub.other_deductions ?? []) as StubDeduction[];
  const vacation = (stub.details?.vacation ?? null) as VacationPay | null;
  const holidayPct = (stub.details?.holiday_pct ?? null) as PercentPay | null;
  const holidays = (stub.details?.holidays ?? []) as HolidayResult[];

  const totalDeductions =
    Number(stub.cpp) +
    Number(stub.cpp2) +
    Number(stub.ei) +
    Number(stub.federal_tax) +
    Number(stub.provincial_tax) +
    Number(stub.other_deductions_total);
  const ytdDeductions =
    ytd.cpp + ytd.cpp2 + ytd.ei + ytd.federal_tax + ytd.provincial_tax + ytd.other_deductions_total;

  const backHref = isEmployer ? "/admin/payroll" : "/employee";

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10 print:max-w-none print:p-0">
      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <Link href={backHref} className="btn btn-text -ml-2">
          <ChevronLeftIcon />
          Back
        </Link>
        <PrintButton />
      </div>

      <article className="panel p-5 sm:p-8 print:border-0 print:p-0">
        {isDraft && (
          <p className="notice mb-5" role="status">
            Draft: not finalized. Amounts may change.
          </p>
        )}

        {/* ---------- Header ---------- */}
        <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {employer ? (
              <div className="mb-2 text-sm">
                <div className="text-base font-semibold">{employer.name}</div>
                {employer.trading_name ? <div className="muted">Operating as {employer.trading_name}</div> : null}
                {employer.address.map((line) => (
                  <div key={line} className="muted">
                    {line}
                  </div>
                ))}
                {employer.phone || employer.email ? (
                  <div className="muted">{[employer.phone, employer.email].filter(Boolean).join(" · ")}</div>
                ) : null}
              </div>
            ) : isEmployer ? (
              <p className="notice mb-2 print:hidden">
                Your company details aren&apos;t set.{" "}
                <Link href="/admin/settings" className="underline underline-offset-2">
                  Add them in Settings
                </Link>{" "}
                and recalculate draft pay runs.
              </p>
            ) : null}
            <h1>{isSub ? "Payment statement" : "Statement of earnings"}</h1>
          </div>
          <dl className="text-sm sm:text-right">
            <dt className="sr-only">Name</dt>
            <dd className="font-semibold">{name}</dd>
            <dt className="sr-only">Pay period</dt>
            <dd className="muted">
              Period {day(stub.period_start)} – {day(stub.period_end)}
            </dd>
            <dt className="sr-only">Pay date</dt>
            <dd className="muted">Paid {day(stub.pay_date)}</dd>
          </dl>
        </header>

        {/* ---------- Earnings ---------- */}
        <div className="table-wrap mb-6">
          <table className="data">
            <thead>
              <tr>
                <th>Earnings</th>
                <th className="num">Hours</th>
                <th className="num">Rate</th>
                <th className="num">Current</th>
                <th className="num">Year to date</th>
              </tr>
            </thead>
            <tbody>
              {earnings.map((e, i) => (
                <tr key={`${e.code}-${i}`}>
                  <td>{e.label}</td>
                  <td className="num">{e.hours != null ? e.hours.toFixed(2) : ""}</td>
                  <td className="num">{e.rate != null ? money(e.rate) : ""}</td>
                  <td className="num">{money(e.amount)}</td>
                  <td className="num">
                    {e.code === "vacation"
                      ? money(ytd.vacation_pay_paid)
                      : i === firstHolidayLine
                        ? money(ytd.holiday)
                        : ""}
                  </td>
                </tr>
              ))}
              <tr className="total">
                <td colSpan={3}>Gross pay</td>
                <td className="num">{money(stub.gross)}</td>
                <td className="num">{money(ytd.gross)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ---------- Deductions / GST ---------- */}
        {isSub ? (
          <div className="table-wrap mb-6">
            <table className="data">
              <thead>
                <tr>
                  <th>GST</th>
                  <th className="num">Current</th>
                  <th className="num">Year to date</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    GST (5%){stub.details?.gst_number ? ` · GST #${stub.details.gst_number}` : ""}
                  </td>
                  <td className="num">{money(stub.gst)}</td>
                  <td className="num">{money(ytd.gst)}</td>
                </tr>
              </tbody>
            </table>
            <p className="hint mt-2 px-3">No deductions are taken from subcontractor payments.</p>
          </div>
        ) : (
          <div className="table-wrap mb-6">
            <table className="data">
              <thead>
                <tr>
                  <th>Deductions</th>
                  <th className="num">Current</th>
                  <th className="num">Year to date</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>CPP</td>
                  <td className="num">{money(stub.cpp)}</td>
                  <td className="num">{money(ytd.cpp)}</td>
                </tr>
                {ytd.cpp2 > 0 && (
                  <tr>
                    <td>CPP2</td>
                    <td className="num">{money(stub.cpp2)}</td>
                    <td className="num">{money(ytd.cpp2)}</td>
                  </tr>
                )}
                <tr>
                  <td>EI</td>
                  <td className="num">{money(stub.ei)}</td>
                  <td className="num">{money(ytd.ei)}</td>
                </tr>
                <tr>
                  <td>
                    Federal income tax
                    {Number(stub.details?.extra_tax ?? 0) > 0 && (
                      <small>Includes {money(Number(stub.details.extra_tax))} extra requested</small>
                    )}
                  </td>
                  <td className="num">{money(stub.federal_tax)}</td>
                  <td className="num">{money(ytd.federal_tax)}</td>
                </tr>
                <tr>
                  <td>Provincial income tax</td>
                  <td className="num">{money(stub.provincial_tax)}</td>
                  <td className="num">{money(ytd.provincial_tax)}</td>
                </tr>
                {other.map((d) => (
                  <tr key={d.deduction_id ?? d.name}>
                    <td>
                      {d.name}
                      <small>
                        {d.tax_treatment === "union_dues_u1" ? "Lowers income tax withheld" : "After tax"}
                        {d.loan_remaining_after != null ? ` · ${money(d.loan_remaining_after)} left to repay` : ""}
                      </small>
                    </td>
                    <td className="num">{money(d.amount)}</td>
                    <td className="num">{money(ytdOther.get(d.deduction_id ?? d.name) ?? d.amount)}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td>Total deductions</td>
                  <td className="num">{money(totalDeductions)}</td>
                  <td className="num">{money(ytdDeductions)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* ---------- Net ---------- */}
        <div className="flex items-end justify-between gap-4 border-t-2 border-[var(--text)] pt-4">
          <span className="text-lg font-semibold">{isSub ? "Total payment" : "Net pay"}</span>
          <span className="text-right">
            <span className="block text-2xl font-semibold num">{money(stub.net_pay)}</span>
            <span className="small muted">Year to date {money(ytd.net_pay)}</span>
          </span>
        </div>

        {/* ---------- Vacation and holiday pay ---------- */}
        {!isSub && (vacation || holidayPct || holidays.length > 0) ? (
          <section className="mt-6 flex flex-col gap-3 text-sm" aria-label="Vacation and holiday pay">
            {vacation ? (
              <div className="note-box">
                <p className="font-semibold text-ink">Vacation pay</p>
                <p>
                  Earned this period{" "}
                  {vacation.segments
                    .filter((s) => s.wages > 0)
                    .map((s) => `${pct(s.rate)} of ${money(s.wages)}`)
                    .join(" + ") || money(0)}
                  {vacation.deemed_wages > 0 && vacation.deemed_rate != null
                    ? ` + ${pct(vacation.deemed_rate)} of ${money(vacation.deemed_wages)} vacation pay paid out`
                    : ""}{" "}
                  = {money(vacation.earned)} · paid on this cheque {money(vacation.paid)}
                  {vacation.timing === "accrue" || vacation.balance_after > 0.004
                    ? ` · still owed to you ${money(vacation.balance_after)}`
                    : ""}
                </p>
              </div>
            ) : null}
            {holidayPct ? (
              <div className="note-box">
                <p className="font-semibold text-ink">General holiday pay</p>
                <p>
                  Earned this period 3.6% of {money(holidayPct.wages_base)} = {money(holidayPct.earned)} · paid on this
                  cheque {money(holidayPct.paid)}
                  {holidayPct.timing === "accrue" || holidayPct.balance_after > 0.004
                    ? ` · still owed to you ${money(holidayPct.balance_after)}`
                    : ""}
                </p>
              </div>
            ) : null}
            {holidays.map((h) => (
              <div key={h.date} className="note-box">
                <p className="font-semibold text-ink">
                  {h.name} · {day(h.date)}
                </p>
                <p>
                  {!h.eligible
                    ? `Not eligible: ${h.work_days_12_months} work days in the 12 months before (30 needed).`
                    : h.not_entitled
                      ? "Not entitled to holiday pay for this holiday."
                      : [
                          h.average_daily_wage
                            ? `Average daily wage ${money(h.average_daily_wage.amount)} (${money(h.average_daily_wage.wages)} ÷ ${h.average_daily_wage.days} days worked, ${day(h.average_daily_wage.period_start)} – ${day(h.average_daily_wage.period_end)})`
                            : "Not a normal work day for you, so no average daily wage",
                          h.premium
                            ? `${h.premium.hours.toFixed(2)} h worked at ${money(h.premium.rate)} (1.5×)`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                </p>
              </div>
            ))}
          </section>
        ) : null}
      </article>
    </main>
  );
}
