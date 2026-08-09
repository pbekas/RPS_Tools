"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import {
  TOOLSETS,
  activeToolset,
  defaultHrefForUser,
  grantedToolsets,
  isAdmin,
} from "@/lib/permissions";

function navClass(active: boolean) {
  return active ? "text-accent" : "hover:text-ink";
}

export function AppNav() {
  const { data } = useSession();
  const pathname = usePathname();
  if (!data?.user || pathname === "/login") return null;

  const admin = isAdmin(data.user);
  const toolsets = grantedToolsets(data.user);
  const current = activeToolset(pathname);
  const onUsers =
    pathname.startsWith("/users") || pathname.startsWith("/settings");
  const brandHref = defaultHrefForUser(data.user);

  return (
    <header className="sticky top-0 z-20 border-b border-line/80 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-4 sm:gap-6">
          <Link
            href={brandHref}
            className="shrink-0 font-display text-xl tracking-tight text-ink"
          >
            Relevium <span className="text-accent">Tools</span>
          </Link>

          {toolsets.length > 0 ? (
            <div
              className="flex items-center rounded-xl border border-line bg-paper/80 p-0.5 text-sm font-semibold"
              role="group"
              aria-label="Tool set"
            >
              {toolsets.map((id) => {
                const set = TOOLSETS[id];
                return (
                  <Link
                    key={id}
                    href={set.href}
                    className={`rounded-lg px-3 py-1.5 transition ${
                      current === id
                        ? "bg-accent text-white shadow-sm"
                        : "text-ink-soft hover:text-ink"
                    }`}
                    aria-current={current === id ? "page" : undefined}
                    title={set.description}
                  >
                    {set.label}
                  </Link>
                );
              })}
            </div>
          ) : null}

          {current === "call_qa" ? (
            <nav className="hidden items-center gap-4 text-sm font-semibold text-ink-soft lg:flex">
              <Link href="/" className={navClass(pathname === "/")}>
                Dashboard
              </Link>
              <Link
                href="/coaching"
                className={navClass(pathname.startsWith("/coaching"))}
              >
                Coaching
              </Link>
              {admin ? (
                <>
                  <Link href="/ops" className={navClass(pathname.startsWith("/ops"))}>
                    Call ops
                  </Link>
                  <Link
                    href="/queue"
                    className={navClass(pathname.startsWith("/queue"))}
                  >
                    QA queue
                  </Link>
                  <Link
                    href="/settings"
                    className={navClass(pathname.startsWith("/settings"))}
                  >
                    QA settings
                  </Link>
                </>
              ) : null}
            </nav>
          ) : null}

          {current === "contracts" ? (
            <nav className="hidden items-center gap-4 text-sm font-semibold text-ink-soft md:flex">
              <Link
                href="/contracts"
                className={navClass(
                  pathname === "/contracts" ||
                    /^\/contracts\/[0-9a-f-]{36}/i.test(pathname)
                )}
              >
                Library
              </Link>
              <Link
                href="/contracts/calendar"
                className={navClass(pathname.startsWith("/contracts/calendar"))}
              >
                Calendar
              </Link>
              <Link
                href="/contracts/upload"
                className={navClass(pathname.startsWith("/contracts/upload"))}
              >
                Upload
              </Link>
              <Link
                href="/contracts/vendors"
                className={navClass(pathname.startsWith("/contracts/vendors"))}
              >
                Vendors
              </Link>
              {admin ? (
                <>
                  <Link
                    href="/contracts/companies"
                    className={navClass(pathname.startsWith("/contracts/companies"))}
                  >
                    Companies
                  </Link>
                  <Link
                    href="/contracts/groups"
                    className={navClass(pathname.startsWith("/contracts/groups"))}
                  >
                    Groups
                  </Link>
                </>
              ) : null}
            </nav>
          ) : null}
        </div>

        <div className="flex items-center gap-3 text-sm">
          {admin ? (
            <Link
              href="/users"
              className={`hidden font-semibold sm:inline ${
                onUsers ? "text-accent" : "text-ink-soft hover:text-ink"
              }`}
            >
              Users & access
            </Link>
          ) : null}
          <span className="hidden text-ink-soft md:inline">
            {data.user.name || data.user.email}
            {data.user.role ? ` · ${data.user.role}` : ""}
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
    </header>
  );
}
