"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import {
  MODULES,
  hasModule,
  isAdminRole,
  moduleForPath,
} from "@/lib/permissions";

const CALL_QA_LINKS: { href: string; label: string; adminOnly?: boolean }[] = [
  { href: "/", label: "Dashboard" },
  { href: "/coaching", label: "Coaching" },
  { href: "/ops", label: "Call ops", adminOnly: true },
  { href: "/reporting", label: "Reporting", adminOnly: true },
  { href: "/queue", label: "QA queue", adminOnly: true },
  { href: "/settings", label: "Settings", adminOnly: true },
];

function linkActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppNav() {
  const { data } = useSession();
  const pathname = usePathname();
  if (!data?.user || pathname === "/login") return null;

  const user = data.user;
  const admin = isAdminRole(user.role);
  const activeModule = moduleForPath(pathname);
  const showCallQa = hasModule(user, "call_qa");
  const showUsers = hasModule(user, "users");

  return (
    <header className="sticky top-0 z-20 border-b border-line/80 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-6">
          <Link
            href={showCallQa ? "/" : showUsers ? "/users" : "/"}
            className="shrink-0 font-display text-xl tracking-tight text-ink"
          >
            RPS <span className="text-accent">Tools</span>
          </Link>
          <nav className="hidden items-center gap-1 text-sm font-semibold sm:flex">
            {showCallQa ? (
              <ModuleTab
                href={MODULES.call_qa.href}
                label={MODULES.call_qa.label}
                active={activeModule === "call_qa"}
              />
            ) : null}
            {showUsers ? (
              <ModuleTab
                href={MODULES.users.href}
                label={MODULES.users.label}
                active={activeModule === "users"}
              />
            ) : null}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-ink-soft sm:inline">
            {user.name || user.email}
            {user.role ? ` · ${user.role}` : ""}
          </span>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="rounded-lg border border-line px-3 py-1.5 font-semibold text-ink-soft hover:bg-wash"
          >
            Sign out
          </button>
        </div>
      </div>

      {showCallQa && activeModule === "call_qa" ? (
        <div className="border-t border-line/70 bg-wash/40">
          <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 py-2 text-sm font-semibold sm:px-6">
            {CALL_QA_LINKS.filter((l) => !l.adminOnly || admin).map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 ${
                  linkActive(pathname, link.href)
                    ? "bg-white text-accent shadow-sm ring-1 ring-line"
                    : "text-ink-soft hover:bg-white/70 hover:text-ink"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      ) : null}

      {/* Mobile module switcher */}
      <nav className="flex gap-1 overflow-x-auto border-t border-line/70 px-4 py-2 text-sm font-semibold sm:hidden">
        {showCallQa ? (
          <ModuleTab
            href={MODULES.call_qa.href}
            label={MODULES.call_qa.label}
            active={activeModule === "call_qa"}
          />
        ) : null}
        {showUsers ? (
          <ModuleTab
            href={MODULES.users.href}
            label={MODULES.users.label}
            active={activeModule === "users"}
          />
        ) : null}
      </nav>
    </header>
  );
}

function ModuleTab({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-lg px-3 py-1.5 ${
        active
          ? "bg-wash text-accent"
          : "text-ink-soft hover:bg-wash/70 hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );
}
