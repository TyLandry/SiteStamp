import "server-only";
import { createClient } from "@/utils/supabase/server";

/**
 * The signed-in employer and their company, or null when the caller is not
 * signed in or is not an employer. Route handlers use this before reading
 * anything; queries are still also filtered by org and limited by RLS.
 */
export async function getEmployer() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, org_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.role !== "employer" || !profile.org_id) return null;

  return { supabase, userId: user.id, orgId: profile.org_id as string };
}
