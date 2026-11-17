import AppShell from "../components/shell/AppShell";
import { loadShellData } from "@/utils/shellData";

export default async function EmployeeLayout({ children }: LayoutProps<"/employee">) {
  const shell = await loadShellData();

  // The page checks access itself; employers are sent to /admin from there.
  if (!shell || shell.person.role === "employer") return <>{children}</>;

  return (
    <AppShell home="/employee" person={shell.person} org={shell.org}>
      {children}
    </AppShell>
  );
}
