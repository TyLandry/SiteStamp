import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { fmtDate, parseLocalDate } from "@/utils/payPeriods";
import PrintButton from "../../components/PrintButton";

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
  if (!user) redirect("/login");

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
    <div className="max-w-3xl mx-auto p-8 print:p-0 print:max-w-none">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <Link href={backHref} className="text-sm text-gray-500 hover:underline">
          ← Back
        </Link>
        <PrintButton />
      </div>

      <div className="border border-gray-300 rounded p-8 print:border-0 print:p-0">
        {isDraft && (
          <p className="mb-4 rounded bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
            DRAFT — not finalized. Amounts may change.
          </p>
        )}

        {/* ---------- Header ---------- */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-2xl font-semibold">
              {isSub ? "Payment Statement" : "Statement of Earnings"}
            </h1>
            <p className="text-sm text-gray-500">Site Stamp</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-medium">{name}</p>
            <p>
              Period: {fmtDate(parseLocalDate(stub.period_start))} –{" "}
              {fmtDate(parseLocalDate(stub.period_end))}
            </p>
            <p>Pay date: {fmtDate(parseLocalDate(stub.pay_date))}</p>
          </div>
        </div>

        {/* ---------- Earnings ---------- */}
        <table className="w-full text-sm mb-6">
          <thead>
            <tr className="border-b border-gray-300">
              <th className="text-left py-2 font-medium">Earnings</th>
              <th className="text-right py-2 font-medium">Hours</th>
              <th className="text-right py-2 font-medium">Rate</th>
              <th className="text-right py-2 font-medium">Current</th>
              <th className="text-right py-2 font-medium">Year to date</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-100">
              <td className="py-2">Regular</td>
              <td className="py-2 text-right">{Number(stub.regular_hours).toFixed(2)}</td>
              <td className="py-2 text-right">{money(wage)}</td>
              <td className="py-2 text-right">{money(regularPay)}</td>
              <td className="py-2 text-right"></td>
            </tr>
            {Number(stub.overtime_hours) > 0 && (
              <tr className="border-b border-gray-100">
                <td className="py-2">Overtime ({multiplier}×)</td>
                <td className="py-2 text-right">{Number(stub.overtime_hours).toFixed(2)}</td>
                <td className="py-2 text-right">{money(wage * multiplier)}</td>
                <td className="py-2 text-right">{money(overtimePay)}</td>
                <td className="py-2 text-right"></td>
              </tr>
            )}
            <tr className="font-medium">
              <td className="py-2" colSpan={3}>
                Gross pay
              </td>
              <td className="py-2 text-right">{money(stub.gross)}</td>
              <td className="py-2 text-right">{money(ytd.gross)}</td>
            </tr>
          </tbody>
        </table>

        {/* ---------- Deductions / GST ---------- */}
        {isSub ? (
          <table className="w-full text-sm mb-6">
            <tbody>
              <tr className="border-b border-gray-100">
                <td className="py-2">
                  GST (5%){stub.details?.gst_number ? ` — GST #${stub.details.gst_number}` : ""}
                </td>
                <td className="py-2 text-right">{money(stub.gst)}</td>
                <td className="py-2 text-right w-32">{money(ytd.gst)}</td>
              </tr>
              <tr>
                <td className="py-2 text-gray-500" colSpan={3}>
                  No deductions are taken from subcontractor payments.
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm mb-6">
            <thead>
              <tr className="border-b border-gray-300">
                <th className="text-left py-2 font-medium">Deductions</th>
                <th className="text-right py-2 font-medium">Current</th>
                <th className="text-right py-2 font-medium">Year to date</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100">
                <td className="py-2">CPP</td>
                <td className="py-2 text-right">{money(stub.cpp)}</td>
                <td className="py-2 text-right">{money(ytd.cpp)}</td>
              </tr>
              {ytd.cpp2 > 0 && (
                <tr className="border-b border-gray-100">
                  <td className="py-2">CPP2</td>
                  <td className="py-2 text-right">{money(stub.cpp2)}</td>
                  <td className="py-2 text-right">{money(ytd.cpp2)}</td>
                </tr>
              )}
              <tr className="border-b border-gray-100">
                <td className="py-2">EI</td>
                <td className="py-2 text-right">{money(stub.ei)}</td>
                <td className="py-2 text-right">{money(ytd.ei)}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2">
                  Federal income tax
                  {Number(stub.details?.extra_tax ?? 0) > 0 && (
                    <span className="text-gray-500">
                      {" "}
                      (incl. {money(Number(stub.details.extra_tax))} extra requested)
                    </span>
                  )}
                </td>
                <td className="py-2 text-right">{money(stub.federal_tax)}</td>
                <td className="py-2 text-right">{money(ytd.federal_tax)}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2">Provincial income tax</td>
                <td className="py-2 text-right">{money(stub.provincial_tax)}</td>
                <td className="py-2 text-right">{money(ytd.provincial_tax)}</td>
              </tr>
              <tr className="font-medium">
                <td className="py-2">Total deductions</td>
                <td className="py-2 text-right">{money(totalDeductions)}</td>
                <td className="py-2 text-right">{money(ytdDeductions)}</td>
              </tr>
            </tbody>
          </table>
        )}

        {/* ---------- Net ---------- */}
        <div className="flex justify-between items-center border-t-2 border-gray-800 pt-3 text-lg font-semibold">
          <span>{isSub ? "Total payment" : "Net pay"}</span>
          <span className="flex gap-8">
            <span>{money(stub.net_pay)}</span>
            <span className="text-sm font-normal text-gray-500 self-end">
              YTD {money(ytd.net_pay)}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}