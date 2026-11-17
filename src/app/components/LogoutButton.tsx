"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export default function LogoutButton({ block = false }: { block?: boolean }) {
  const router = useRouter();
  const supabase = createClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/");
  }

  return (
    <button type="button" onClick={handleLogout} className={`btn${block ? " btn-block" : ""}`}>
      Log out
    </button>
  );
}
