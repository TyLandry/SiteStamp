import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import LoginForm from "./components/LoginForm";

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    // Without a profile, fall through to the form so there's no redirect loop
    if (profile) redirect(profile.role === "employer" ? "/admin" : "/employee");
  }

  return <LoginForm />;
}
