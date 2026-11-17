import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import PayRuns from "../../components/PayRuns";

export const metadata: Metadata = { title: "Payroll" };

export default async function PayrollPage() {
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
          <h1>Payroll</h1>
          <p className="finding">Pay runs, deductions and what to send the CRA.</p>
        </div>
      </div>
      <PayRuns />
    </>
  );
}
