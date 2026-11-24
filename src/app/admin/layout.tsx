import AppShell from "../components/shell/AppShell";
import type { NavItem } from "../components/shell/NavLinks";
import { loadShellData } from "@/utils/shellData";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const shell = await loadShellData();

  // Each admin page checks access itself; without an employer profile there
  // is no shell to draw.
  if (!shell || shell.person.role !== "employer") return <>{children}</>;

  const nav: NavItem[] = [
    { href: "/admin", label: "Today", icon: "today", exact: true, count: shell.pendingTimeOff },
    { href: "/admin/hours", label: "Hours & pay", shortLabel: "Hours", icon: "hours" },
    { href: "/admin/staff", label: "Crew & wages", shortLabel: "Crew", icon: "crew" },
    { href: "/admin/payroll", label: "Payroll", icon: "payroll" },
    { href: "/admin/sites", label: "Job sites", shortLabel: "Sites", icon: "sites" },
    { href: "/admin/settings", label: "Settings", icon: "settings" },
  ];

  return (
    <AppShell home="/admin" person={shell.person} org={shell.org} nav={nav}>
      {children}
    </AppShell>
  );
}
