import type { NextRequest } from "next/server";
import { getEmployer } from "@/utils/employerAuth";
import { buildT4Summary, t4SummaryCsv } from "@/utils/t4";

// Employer-only CSV of the year's T4 amounts for an accountant.
export async function GET(request: NextRequest) {
  const employer = await getEmployer();
  if (!employer) {
    return Response.json({ error: "Not authorized" }, { status: 403 });
  }

  const year = Number(request.nextUrl.searchParams.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return Response.json({ error: "Pick a tax year." }, { status: 400 });
  }

  try {
    const summary = await buildT4Summary(employer.supabase, employer.orgId, year);
    return new Response(t4SummaryCsv(summary), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="t4-summary-${year}.csv"`,
        // Pay and tax figures: never cache
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Could not build the summary." },
      { status: 500 }
    );
  }
}
