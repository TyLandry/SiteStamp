import "server-only";
import { createClient } from "@/utils/supabase/server";

export type ShellData = {
  person: { id: string; name: string | null; role: string };
  org: string | null;
  pendingTimeOff: number;
};

/**
 * Who is signed in, their company name and (for employers) how many time-off
 * requests are waiting. Returns null when nobody is signed in; the pages under
 * the layout keep their own access checks.
 */
export async function loadShellData(): Promise<ShellData | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, role, org_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile) return null;

  const [orgRes, pendingRes] = await Promise.all([
    profile.org_id
      ? supabase.from("orgs").select("name").eq("id", profile.org_id).maybeSingle()
      : Promise.resolve({ data: null }),
    profile.role === "employer"
      ? supabase
          .from("time_off_requests")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending")
      : Promise.resolve({ count: 0 }),
  ]);

  const orgName = (orgRes.data as { name?: string | null } | null)?.name ?? null;

  return {
    person: { id: user.id, name: profile.full_name ?? null, role: profile.role },
    org: orgName,
    pendingTimeOff: ("count" in pendingRes ? pendingRes.count : 0) ?? 0,
  };
}
