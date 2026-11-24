import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { albertaToday, lowestAllowedWage, minimumWageMessage } from "@/utils/minimumWage";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  // JSON only: a plain cross-site form can't send this content type
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  const type = body.employeeType ?? "employee";
  const wageInput = body.hourlyWage;
  const gstInput = typeof body.gstNumber === "string" ? body.gstNumber.trim() : "";

  if (!email || !fullName) {
    return NextResponse.json({ error: "Missing email or name" }, { status: 400 });
  }
  if (email.length > 254 || !EMAIL.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  if (fullName.length > 120) {
    return NextResponse.json({ error: "The name is too long (120 characters at most)" }, { status: 400 });
  }
  if (type !== "employee" && type !== "subcontractor") {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  let hourlyWage: number | null = null;
  if (wageInput !== undefined && wageInput !== null && wageInput !== "") {
    const wage = Number(wageInput);
    if (!Number.isFinite(wage) || wage < 0 || wage > 1000) {
      return NextResponse.json({ error: "Enter an hourly wage from $0 to $1,000" }, { status: 400 });
    }
    hourlyWage = Math.round(wage * 100) / 100;
  }
  if (gstInput.length > 30) {
    return NextResponse.json({ error: "The GST number is too long" }, { status: 400 });
  }

  // Alberta minimum wage for employees ($15, or $13 for a student under 18).
  // The database enforces the same rule.
  let studentRateUntil: string | null = null;
  if (type === "employee") {
    const today = albertaToday();
    if (body.studentRateUntil != null && body.studentRateUntil !== "") {
      const until = String(body.studentRateUntil);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || until <= today) {
        return NextResponse.json({ error: "The student rate end date must be after today" }, { status: 400 });
      }
      studentRateUntil = until;
    }
    if (hourlyWage != null && hourlyWage < lowestAllowedWage(studentRateUntil, today)) {
      return NextResponse.json({ error: minimumWageMessage(studentRateUntil) }, { status: 400 });
    }
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

  if (!currentProfile || currentProfile.role !== "employer" || !currentProfile.org_id) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

  // Invite links must point at the real site, never at localhost in production
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.NODE_ENV === "production" ? null : "http://localhost:3000");
  if (!siteUrl) {
    return NextResponse.json({ error: "Invites aren't set up: NEXT_PUBLIC_SITE_URL is missing" }, { status: 500 });
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Invites aren't set up" }, { status: 500 });
  }

  const { data: invitedUser, error: inviteError } =
    await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${siteUrl.replace(/\/+$/, "")}/update-password`,
    });

  if (inviteError || !invitedUser?.user) {
    return NextResponse.json(
      { error: inviteError?.message ?? "Invite failed" },
      { status: 500 }
    );
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: invitedUser.user.id,
    org_id: currentProfile.org_id,
    role: "employee",
    full_name: fullName,
    employee_type: type,
    hourly_wage: hourlyWage,
    gst_number: type === "subcontractor" ? gstInput || null : null,
    student_rate_until: studentRateUntil,
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
