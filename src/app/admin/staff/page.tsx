import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import InviteEmployee from "../../components/InviteEmployee";
import EmployeeList from "../../components/EmployeeList";

export const metadata: Metadata = { title: "Crew & wages" };

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
    <>
      <div className="title-row">
        <div>
          <h1>Crew &amp; wages</h1>
          <p className="finding">Wages, tax setup and who has access.</p>
        </div>
        <a className="btn btn-primary" href="#invite">
          Invite to crew
        </a>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_384px] items-start">
        <EmployeeList />
        <div id="invite" className="scroll-mt-20">
          <InviteEmployee />
        </div>
      </div>
    </>
  );
}
