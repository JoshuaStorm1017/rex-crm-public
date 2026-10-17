import type { ReactNode } from "react";
import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import type { PublicUser } from "@/lib/crm/users";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/accounts", label: "Accounts" },
  { href: "/contacts", label: "Contacts" },
  { href: "/leads", label: "Leads" },
  { href: "/opportunities", label: "Opportunities" },
  { href: "/products", label: "Products" },
  { href: "/tasks", label: "Tasks" },
  { href: "/reports", label: "Reports" },
  { href: "/recycle", label: "Recycle" },
  { href: "/setup", label: "Setup" },
];

export function AppShell({
  children,
  user,
  orgName,
  showSetup,
}: {
  children: ReactNode;
  user: PublicUser;
  orgName: string;
  showSetup: boolean;
}) {
  const nav = NAV.filter((item) => showSetup || item.href !== "/setup");
  return (
    <div className="min-h-full bg-[#f3efe6] text-[#1b2430]">
      <header className="bg-[#1b2430] text-[#f3efe6]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Rex CRM
          </Link>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-[#f3efe6]/80 hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <form
            action="/search"
            className="ml-auto flex min-w-[12rem] flex-1 items-center justify-end sm:max-w-xs"
          >
            <input
              name="q"
              type="search"
              placeholder="Search"
              aria-label="Search records"
              className="w-full rounded border border-[#3a4554] bg-[#121820] px-2 py-1 text-sm text-[#f3efe6] placeholder:text-[#f3efe6]/40"
            />
          </form>
          <div className="flex items-center gap-3 text-xs text-[#f3efe6]/70">
            <span className="text-[#f3efe6]">{orgName}</span>
            <span className="hidden sm:inline">
              {user.name} · @{user.username}
            </span>
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded border border-[#3a4554] px-2 py-1 text-[#f3efe6]/80 hover:text-white"
              >
                Log out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
    </div>
  );
}
