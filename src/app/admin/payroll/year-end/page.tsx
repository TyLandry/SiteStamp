import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { buildT4Summary } from "@/utils/t4";
import PayrollTabs from "../../../components/PayrollTabs";

export const metadata: Metadata = { title: "Year-end T4" };

function money(n: number) {
  return Number(n).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

export default async function YearEndPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string | string[] }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, org_id")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "employer") redirect("/employee");

  // Default to last year in January and February (T4 season), else this year
  const now = new Date();
  const defaultYear = now.getMonth() <= 1 ? now.getFullYear() - 1 : now.getFullYear();
  const raw = (await searchParams).year;
  const asked = Number(Array.isArray(raw) ? raw[0] : raw);
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= now.getFullYear() ? asked : defaultYear;
  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - i);

  let summary: Awaited<ReturnType<typeof buildT4Summary>> | null = null;
  let error: string | null = null;
  try {
    summary = await buildT4Summary(supabase, profile.org_id, year);
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not build the summary.";
  }

  return (
    <>
      <div className="title-row">
        <div>
          <h1>Payroll</h1>
          <p className="finding">Each employee&apos;s T4 amounts for the year, ready for your accountant.</p>
        </div>
      </div>
      <PayrollTabs />

      <div className="stack">
        <section className="panel" aria-labelledby="t4-h">
          <div className="panel-h flex-wrap items-center">
            <h2 id="t4-h">T4 summary for {year}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <form className="flex items-center gap-2" method="get">
                <label htmlFor="t4-year" className="sr-only">
                  Tax year
                </label>
                <select id="t4-year" name="year" className="select w-28" defaultValue={String(year)}>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <button type="submit" className="btn">
                  Show
                </button>
              </form>
              {summary && summary.rows.length > 0 ? (
                <a className="btn btn-primary" href={`/admin/payroll/year-end/export?year=${year}`} download>
                  Download CSV
                </a>
              ) : null}
            </div>
          </div>
          <div className="panel-body flex flex-col gap-3">
            <p className="note-box">
              A preparation aid for your accountant, built from finalized pay runs with a pay date in {year}.
              SiteStamp doesn&apos;t file T4 slips or anything else with the CRA, and this is not an official
              T4 slip.
            </p>
            {error ? (
              <p className="msg-error" role="alert">
                {error}
              </p>
            ) : null}
            {summary && summary.warnings.length > 0 ? (
              <ul className="notice list-disc pl-8" aria-label="Warnings">
                {summary.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
          </div>

          {summary && summary.rows.length === 0 ? (
            <div className="panel-body">
              <p className="empty">No finalized pay for employees with a pay date in {year}.</p>
            </div>
          ) : null}

          {summary && summary.rows.length > 0 ? (
            <div className="table-wrap px-1 pb-2">
              <table className="data">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th className="num">14 Income</th>
                    <th className="num">16 CPP</th>
                    <th className="num">16A CPP2</th>
                    <th className="num">18 EI</th>
                    <th className="num">22 Tax</th>
                    <th className="num">24 EI earnings</th>
                    <th className="num">26 CPP earnings</th>
                    <th className="num">44 Union</th>
                    <th className="num">85 Health</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.map((r) => (
                    <tr key={r.profile_id}>
                      <td>
                        {r.name}
                        <small>
                          {r.province} · {r.stubs} stub{r.stubs === 1 ? "" : "s"}
                          {r.unreported.length > 0
                            ? ` · not on T4: ${r.unreported.map((u) => `${u.name} ${money(u.amount)}`).join(", ")}`
                            : ""}
                        </small>
                        {r.notes.map((n) => (
                          <small key={n}>{n}</small>
                        ))}
                      </td>
                      <td className="num">{money(r.box14)}</td>
                      <td className="num">{money(r.box16)}</td>
                      <td className="num">{money(r.box16a)}</td>
                      <td className="num">{money(r.box18)}</td>
                      <td className="num">{money(r.box22)}</td>
                      <td className="num">{money(r.box24)}</td>
                      <td className="num">{money(r.box26)}</td>
                      <td className="num">{r.box44 > 0 ? money(r.box44) : <span className="faint">—</span>}</td>
                      <td className="num">{r.code85 > 0 ? money(r.code85) : <span className="faint">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {summary ? (
            <div className="title-block flex-col">
              {summary.caps ? (
                <span>
                  Boxes 24 and 26 are capped at {year}&apos;s maximums: {money(summary.caps.maxInsurable)} insurable,{" "}
                  {money(summary.caps.yampe)} pensionable.
                </span>
              ) : null}
              {summary.subcontractors.count > 0 ? (
                <span>
                  Not included: {money(summary.subcontractors.total)} paid to {summary.subcontractors.count}{" "}
                  subcontractor{summary.subcontractors.count === 1 ? "" : "s"}. That isn&apos;t employment income; ask
                  your accountant about any other reporting.
                </span>
              ) : null}
            </div>
          ) : null}
        </section>

        {summary ? (
          <section className="panel" aria-labelledby="t4-notes-h">
            <div className="panel-h">
              <h2 id="t4-notes-h">Before you send it</h2>
            </div>
            <ul className="panel-body list-disc pl-9 flex flex-col gap-1.5 muted">
              {summary.checklist.map((c) => (
                <li key={c}>{c}</li>
              ))}
              <li>
                Company details come from{" "}
                <Link href="/admin/settings" className="underline underline-offset-2">
                  Settings
                </Link>
                .
              </li>
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
