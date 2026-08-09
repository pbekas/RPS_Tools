"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { hasModule, isAdmin } from "@/lib/permissions";

function navClass(active: boolean) {
  return active ? "text-accent" : "hover:text-ink";
}

export function AppNav() {
  const { data } = useSession();
  const pathname = usePathname();
  if (!data?.user || pathname === "/login") return null;

  const admin = isAdmin(data.user);
  const showContracts = hasModule(data.user, "contracts");
  const onContracts = pathname.startsWith("/contracts");

  return (
    <header className="sticky top-0 z-20 border-b border-line/80 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-6">
          <Link href="/" className="shrink-0 font-display text-xl tracking-tight text-ink">
            Relevium <span className="text-accent">Tools</span>
          </Link>
          <nav className="hidden items-center gap-1 text-sm font-semibold text-ink-soft sm:flex">
            <Link
              href="/"
              className={`rounded-lg px-2.5 py-1.5 ${
                !onContracts ? "bg-wash text-accent" : "hover:text-ink"
              }`}
            >
              Call QA
            </Link>
            {showContracts ? (
              <Link
                href="/contracts"
                className={`rounded-lg px-2.5 py-1.5 ${
                  onContracts ? "bg-wash text-accent" : "hover:text-ink"
                }`}
              >
                Contracts
              </Link>
            ) : null}
          </nav>
          {!onContracts ? (
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
                    Settings
                  </Link>
                </>
              ) : null}
            </nav>
          ) : (
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
                <Link
                  href="/contracts/groups"
                  className={navClass(pathname.startsWith("/contracts/groups"))}
                >
                  Groups
                </Link>
              ) : null}
            </nav>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-ink-soft sm:inline">
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
