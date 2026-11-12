import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import LogoutButton from "../components/LogoutButton";
import EmployerHoursView from "../components/EmployerHoursView";
import TimeOffApprovals from "../components/TimeOffApprovals";

export default async function AdminDashboard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "employer") redirect("/employee");

  return (
    <div className="max-w-5xl mx-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Admin Dashboard</h1>
        <div className="flex items-center gap-3">
          <Link
            href="/admin/staff"
            className="border border-gray-400 rounded px-3 py-1.5 text-sm hover:bg-gray-100"
          >
            Staff
          </Link>
          <LogoutButton />
        </div>
      </div>
      <div className="flex flex-col gap-6">
        <TimeOffApprovals />
        <EmployerHoursView />
      </div>
    </div>
  );
}