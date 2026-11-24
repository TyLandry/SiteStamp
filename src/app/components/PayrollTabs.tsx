"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/payroll", label: "Pay runs" },
  { href: "/admin/payroll/setup", label: "Employee pay setup" },
  { href: "/admin/payroll/year-end", label: "Year-end T4" },
];

/** Sub-navigation shared by the payroll pages. */
export default function PayrollTabs() {
  const pathname = usePathname();
  return (
    <nav className="tabs mb-5" aria-label="Payroll">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={pathname === t.href ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
