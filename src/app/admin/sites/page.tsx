import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import JobSites from "../../components/JobSites";
import ClockMap from "../../components/ClockMap";

export const metadata: Metadata = { title: "Job sites" };

export default async function SitesPage() {
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
          <h1>Job sites</h1>
          <p className="finding">Where your crew works, and where they clocked in and out.</p>
        </div>
      </div>
      <div className="stack">
        <ClockMap />
        <JobSites />
      </div>
    </>
  );
}
