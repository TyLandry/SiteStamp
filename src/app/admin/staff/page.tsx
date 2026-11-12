import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import LogoutButton from "../../components/LogoutButton";
import InviteEmployee from "../../components/InviteEmployee";
import EmployeeList from "../../components/EmployeeList";

export default async function StaffPage() {
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
        <div>
          <Link href="/admin" className="text-sm text-gray-500 hover:underline">
            ← Back to dashboard
          </Link>
          <h1 className="text-2xl font-semibold mt-1">Staff</h1>
        </div>
        <LogoutButton />
      </div>
      <div className="flex flex-col gap-6">
        <InviteEmployee />
        <EmployeeList />
      </div>
    </div>
  );
}