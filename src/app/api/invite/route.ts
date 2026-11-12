import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

export async function POST(request: Request) {
  const { email, fullName, employeeType, hourlyWage, gstNumber } =
    await request.json();

  if (!email || !fullName) {
    return NextResponse.json({ error: "Missing email or name" }, { status: 400 });
  }
  if (!["employee", "subcontractor"].includes(employeeType ?? "employee")) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
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
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const { data: invitedUser, error: inviteError } =
    await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${siteUrl}/update-password`,
    });

  if (inviteError || !invitedUser?.user) {
    return NextResponse.json(
      { error: inviteError?.message ?? "Invite failed" },
      { status: 500 }
    );
  }

  const type = employeeType ?? "employee";

  const { error: profileError } = await admin.from("profiles").insert({
    id: invitedUser.user.id,
    org_id: currentProfile.org_id,
    role: "employee",
    full_name: fullName,
    employee_type: type,
    hourly_wage: hourlyWage ? Number(hourlyWage) : null,
    gst_number: type === "subcontractor" ? gstNumber || null : null,
  });

  if (profileError) {
    // Roll back so there's no login without a profile
    await admin.auth.admin.deleteUser(invitedUser.user.id);
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  const { error: logError } = await admin.from("invites").insert({
    org_id: currentProfile.org_id,
    email,
    role: "employee",
    invited_by: currentUser.id,
    status: "pending",
  });

  if (logError) console.error("Invite log failed:", logError.message);

  return NextResponse.json({ success: true });
}