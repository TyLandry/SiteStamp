import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import PaySettingsForm from "../../components/PaySettingsForm";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
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
          <h1>Settings</h1>
          <p className="finding">How often your company pays its crew, and how overtime is handled.</p>
        </div>
      </div>
      <PaySettingsForm />
    </>
  );
}
