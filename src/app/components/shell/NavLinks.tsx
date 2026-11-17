"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClockIcon,
  CrewIcon,
  PayrollIcon,
  SettingsIcon,
  TodayIcon,
} from "../ui/Icons";

export type NavIcon = "today" | "hours" | "crew" | "payroll" | "settings";

export type NavItem = {
  href: string;
  label: string;
  shortLabel?: string;
  icon: NavIcon;
  /** A queue that needs action; shown only when greater than 0. */
  count?: number;
  /** Match only this exact path (used for section home pages). */
  exact?: boolean;
};

const ICONS: Record<NavIcon, React.ComponentType> = {
  today: TodayIcon,
  hours: ClockIcon,
  crew: CrewIcon,
  payroll: PayrollIcon,
  settings: SettingsIcon,
};

function isActive(pathname: string, item: NavItem) {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function SideNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="nav-item"
            aria-current={active ? "page" : undefined}
          >
            <Icon />
            {item.label}
            {item.count ? (
              <span className="count" aria-label={`${item.count} waiting`}>
                {item.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="bottom"
      style={{ "--tabs": items.length } as React.CSSProperties}
    >
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item);
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
            <Icon />
            {item.shortLabel ?? item.label}
            {item.count ? (
              <span className="dot" aria-label={`${item.count} waiting`}>
                {item.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** "Org / Page" in the desktop top bar. */
export function Crumb({ items, org }: { items: NavItem[]; org: string | null }) {
  const pathname = usePathname();
  const current = items.find((item) => isActive(pathname, item));
  return (
    <div className="crumb">
      {org ? `${org} / ` : null}
      <b>{current?.label ?? ""}</b>
    </div>
  );
}
