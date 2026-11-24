import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import PayrollTabs from "../../../components/PayrollTabs";
import PaySetup from "../../../components/PaySetup";

export const metadata: Metadata = { title: "Employee pay setup" };

export default async function PaySetupPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

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
          <p className="finding">Vacation pay, holiday pay and deductions for each employee.</p>
        </div>
      </div>
      <PayrollTabs />
      <PaySetup />
    </>
  );
}
