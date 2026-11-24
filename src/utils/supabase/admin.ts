import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Full database access that skips row level security. Server code only: the
// "server-only" import fails the build if a client component pulls this in,
// and the key must never be in a NEXT_PUBLIC_ variable.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set on the server.");
  }
  // A one-off privileged client: never store or refresh a session
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
