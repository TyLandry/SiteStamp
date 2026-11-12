import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import LogoutButton from "../components/LogoutButton";
import ClockInOut from "../components/ClockInClockOut";
import HoursSummary from "../components/HoursSummary";
import TimeOffRequests from "../components/TimeOffRequests";
import TaxInfo from "../components/TaxInfo";

export default async function EmployeeDashboard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .single();

  if (profile?.role === "employer") redirect("/admin");

  const readOnly = profile?.status === "terminated";

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Employee Dashboard</h1>
        <LogoutButton />
      </div>

      {readOnly && (
        <div className="mb-6 rounded border border-gray-300 bg-gray-100 px-4 py-3 text-sm text-gray-700">
          Your employment has ended. You can view your records but can&apos;t
          make changes.
        </div>
      )}

      <div className="flex flex-col gap-6">
        <ClockInOut readOnly={readOnly} />
        <HoursSummary />
        <TimeOffRequests readOnly={readOnly} />
        <TaxInfo readOnly={readOnly} />
      </div>
    </div>
  );
}