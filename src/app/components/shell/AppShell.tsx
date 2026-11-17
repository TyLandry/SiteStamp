import Link from "next/link";
import LogoutButton from "../LogoutButton";
import { Avatar, BrandMark } from "../ui/Marks";
import { BottomNav, Crumb, SideNav, type NavItem } from "./NavLinks";

type Person = { id: string; name: string | null; role: string };

type Props = {
  /** Where the wordmark links to. */
  home: string;
  person: Person;
  org: string | null;
  /** Without nav items the shell is a single column under a top bar. */
  nav?: NavItem[];
  children: React.ReactNode;
};

function AccountMenu({ person, org }: { person: Person; org: string | null }) {
  return (
    <details className="account">
      <summary className="flex items-center" aria-label="Account">
        <Avatar id={person.id} name={person.name} />
      </summary>
      <div className="account-menu">
        <div>
          <div className="font-semibold">{person.name ?? "Signed in"}</div>
          <div className="small muted">{[person.role, org].filter(Boolean).join(" · ")}</div>
        </div>
        <LogoutButton block />
      </div>
    </details>
  );
}

export default function AppShell({ home, person, org, nav, children }: Props) {
  const roleLabel = person.role === "employer" ? "Owner" : "Crew";

  if (!nav) {
    return (
      <div className="app app-solo">
        <header className="top">
          <Link className="brand brand-phone" href={home}>
            <BrandMark />
            SiteStamp
          </Link>
          <div className="flex items-center gap-3 min-w-0">
            <div className="hidden sm:block text-right min-w-0">
              <div className="font-semibold truncate">{person.name ?? "Signed in"}</div>
              {org ? <div className="small muted truncate">{org}</div> : null}
            </div>
            <span className="hidden sm:inline-flex">
              <LogoutButton />
            </span>
            <span className="sm:hidden">
              <AccountMenu person={{ ...person, role: roleLabel }} org={org} />
            </span>
          </div>
        </header>
        <main className="main main-solo">{children}</main>
      </div>
    );
  }

  return (
    <>
      <div className="app">
        <aside className="side" aria-label="Sidebar">
          <Link className="brand" href={home}>
            <BrandMark />
            SiteStamp
          </Link>
          <SideNav items={nav} />
          <div className="me">
            <Avatar id={person.id} name={person.name} />
            <div className="min-w-0 flex-1">
              <div className="truncate">{person.name ?? "Signed in"}</div>
              <div className="small muted">{roleLabel}</div>
            </div>
          </div>
          <LogoutButton block />
        </aside>
        <header className="top">
          <Link className="brand brand-phone" href={home}>
            <BrandMark />
            SiteStamp
          </Link>
          <Crumb items={nav} org={org} />
          {org ? (
            <div className="org-tag">
              <span>{org}</span>
            </div>
          ) : null}
          <span className="account-phone">
            <AccountMenu person={{ ...person, role: roleLabel }} org={org} />
          </span>
        </header>
        <main className="main">{children}</main>
      </div>
      <BottomNav items={nav} />
    </>
  );
}
