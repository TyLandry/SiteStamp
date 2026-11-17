"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { fmtDate, parseLocalDate } from "@/utils/payPeriods";

type StubSummary = {
  id: string;
  pay_date: string;
  period_start: string;
  period_end: string;
  gross: number;
  net_pay: number;
};

function money(n: number) {
  return Number(n).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

export default function PayStubList() {
  const supabase = createClient();
  const [stubs, setStubs] = useState<StubSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      // Security rules only return this employee's FINALIZED stubs
      const { data, error: loadError } = await supabase
        .from("pay_stubs")
        .select("id, pay_date, period_start, period_end, gross, net_pay")
        .eq("profile_id", user.id)
        .order("pay_date", { ascending: false });

      if (loadError) setError(loadError.message);
      setStubs((data as StubSummary[]) ?? []);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="border border-gray-300 rounded p-4">
      <h2 className="font-semibold mb-4">Pay Stubs</h2>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : stubs.length === 0 ? (
        <p className="text-sm text-gray-500">No pay stubs yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-300">
              <th className="text-left py-2 font-medium">Pay date</th>
              <th className="text-left py-2 font-medium">Period</th>
              <th className="text-right py-2 font-medium">Gross</th>
              <th className="text-right py-2 font-medium">Net</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody>
            {stubs.map((s) => (
              <tr key={s.id} className="border-b border-gray-100">
                <td className="py-2">{fmtDate(parseLocalDate(s.pay_date))}</td>
                <td className="py-2">
                  {fmtDate(parseLocalDate(s.period_start))} – {fmtDate(parseLocalDate(s.period_end))}
                </td>
                <td className="py-2 text-right">{money(s.gross)}</td>
                <td className="py-2 text-right font-medium">{money(s.net_pay)}</td>
                <td className="py-2 text-right">
                  <Link
                    href={`/paystub/${s.id}`}
                    className="border border-gray-400 rounded px-3 py-1 text-xs hover:bg-gray-100"
                  >
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}