import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import ClockInOut from "../components/ClockInClockOut";
import HoursSummary from "../components/HoursSummary";
import TimeOffRequests from "../components/TimeOffRequests";
import PayStubList from "../components/PayStubList";
import ExtraTax from "../components/ExtraTax";

export const metadata: Metadata = { title: "Clock" };

export default async function EmployeeDashboard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status, full_name")
    .eq("id", user.id)
    .single();

  if (profile?.role === "employer") redirect("/admin");

  const readOnly = profile?.status === "terminated";
  const firstName = (profile?.full_name ?? "").trim().split(/\s+/)[0];

  return (
    <>
      <div className="title-row">
        <div>
          <h1>{firstName ? `Hi, ${firstName}` : "Your work"}</h1>
          <p className="finding">Clock in and out, see your hours and pay, and ask for time off.</p>
        </div>
      </div>

      {readOnly && (
        <p className="notice mb-4" role="status">
          Your employment has ended. You can view your records but can&apos;t make changes.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_384px] items-start">
        <div className="stack min-w-0">
          <ClockInOut readOnly={readOnly} />
          <HoursSummary />
        </div>
        <div className="stack min-w-0">
          <TimeOffRequests readOnly={readOnly} />
          <PayStubList />
          <ExtraTax readOnly={readOnly} />
        </div>
      </div>
    </>
  );
}
