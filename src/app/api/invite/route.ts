import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

export async function POST(request: Request) {
  const { email, fullName } = await request.json();

  if (!email || !fullName) {
    return NextResponse.json({ error: "Missing email or name" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: { user: currentUser } } = await supabase.auth.getUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: currentProfile } = await supabase
    .from("profiles")
    .select("role, org_id")
    .eq("id", currentUser.id)
    .single();

  if (!currentProfile || currentProfile.role !== "employer") {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data: invitedUser, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: "http://localhost:3000/update-password",
  });

  if (inviteError || !invitedUser?.user) {
    return NextResponse.json({ error: inviteError?.message ?? "Invite failed" }, { status: 500 });
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: invitedUser.user.id,
    org_id: currentProfile.org_id,
    role: "employee",
    full_name: fullName,
  });

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  await admin.from("invites").insert({
    org_id: currentProfile.org_id,
    email,
    role: "employee",
    invited_by: currentUser.id,
    status: "accepted",
  });

  return NextResponse.json({ success: true });
}