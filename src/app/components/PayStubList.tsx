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
    <section className="panel" aria-labelledby="stubs-h">
      <div className="panel-h">
        <h2 id="stubs-h">Pay stubs</h2>
        {!loading && stubs.length > 0 ? <span className="small muted">{stubs.length}</span> : null}
      </div>

      {error && (
        <p className="msg-error px-4 pb-3" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <div className="panel-body flex flex-col gap-3" aria-busy="true">
          <span className="skeleton w-full" />
          <span className="skeleton w-2/3" />
        </div>
      ) : stubs.length === 0 ? (
        <div className="panel-body">
          <p className="empty">No pay stubs yet. They appear here once a pay run is finalized.</p>
        </div>
      ) : (
        <ul>
          {stubs.map((s) => (
            <li key={s.id} className="list-row">
              <div className="min-w-0">
                <div className="font-semibold">Paid {fmtDate(parseLocalDate(s.pay_date))}</div>
                <div className="small muted">
                  {fmtDate(parseLocalDate(s.period_start))} – {fmtDate(parseLocalDate(s.period_end))} · Gross{" "}
                  {money(s.gross)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold num">{money(s.net_pay)}</span>
                <Link href={`/paystub/${s.id}`} className="btn btn-text">
                  View
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
