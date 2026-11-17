import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { fmtDate, parseLocalDate } from "@/utils/payPeriods";
import PrintButton from "../../components/PrintButton";
import { BrandMark } from "../../components/ui/Marks";
import { ChevronLeftIcon } from "../../components/ui/Icons";

function money(n: number) {
  return Number(n).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

type Totals = {
  gross: number;
  cpp: number;
  cpp2: number;
  ei: number;
  federal_tax: number;
  provincial_tax: number;
  gst: number;
  net_pay: number;
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
};

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
  const { data: ytdRows } = await supabase
    .from("pay_stubs")
    .select("id, gross, cpp, cpp2, ei, federal_tax, provincial_tax, gst, net_pay, pay_runs!inner(status)")
    .eq("profile_id", stub.profile_id)
    .eq("pay_runs.status", "finalized")
    .gte("pay_date", yearStart)
    .lte("pay_date", stub.pay_date);

  const ytd: Totals = { ...ZERO };
  const rows = [...(ytdRows ?? [])];
  if (isDraft) rows.push(stub); // a draft isn't in the finalized list yet
  for (const r of rows) {
    for (const k of Object.keys(ZERO) as (keyof Totals)[]) {
      ytd[k] += Number(r[k] ?? 0);
    }
  }

  const wage = Number(stub.hourly_wage);
  const multiplier = Number(stub.overtime_multiplier);
  const regularPay = Number(stub.regular_hours) * wage;
  const overtimePay = Number(stub.overtime_hours) * wage * multiplier;
  const totalDeductions =
    Number(stub.cpp) +
    Number(stub.cpp2) +
    Number(stub.ei) +
    Number(stub.federal_tax) +
    Number(stub.provincial_tax) +
    Number(stub.other_deductions_total);
  const ytdDeductions =
    ytd.cpp + ytd.cpp2 + ytd.ei + ytd.federal_tax + ytd.provincial_tax;

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
            <div className="brand mb-2">
              <BrandMark />
              SiteStamp
            </div>
            <h1>{isSub ? "Payment statement" : "Statement of earnings"}</h1>
          </div>
          <dl className="text-sm sm:text-right">
            <dt className="sr-only">Name</dt>
            <dd className="font-semibold">{name}</dd>
            <dt className="sr-only">Pay period</dt>
            <dd className="muted">
              Period {fmtDate(parseLocalDate(stub.period_start))} – {fmtDate(parseLocalDate(stub.period_end))}
            </dd>
            <dt className="sr-only">Pay date</dt>
            <dd className="muted">Paid {fmtDate(parseLocalDate(stub.pay_date))}</dd>
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
              <tr>
                <td>Regular</td>
                <td className="num">{Number(stub.regular_hours).toFixed(2)}</td>
                <td className="num">{money(wage)}</td>
                <td className="num">{money(regularPay)}</td>
                <td className="num" />
              </tr>
              {Number(stub.overtime_hours) > 0 && (
                <tr>
                  <td>Overtime ({multiplier}×)</td>
                  <td className="num">{Number(stub.overtime_hours).toFixed(2)}</td>
                  <td className="num">{money(wage * multiplier)}</td>
                  <td className="num">{money(overtimePay)}</td>
                  <td className="num" />
                </tr>
              )}
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
      </article>
    </main>
  );
}
