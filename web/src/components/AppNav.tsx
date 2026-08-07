"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { usePathname } from "next/navigation";

export function AppNav() {
  const { data } = useSession();
  const pathname = usePathname();
  if (!data?.user || pathname === "/login") return null;

  return (
    <header className="sticky top-0 z-20 border-b border-line/80 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-display text-xl tracking-tight text-ink">
            Relevium <span className="text-accent">Call QA</span>
          </Link>
          <nav className="hidden items-center gap-4 text-sm font-semibold text-ink-soft sm:flex">
            <Link
              href="/"
              className={pathname === "/" ? "text-accent" : "hover:text-ink"}
            >
              Dashboard
            </Link>
            {(data.user.role || "").toLowerCase() === "admin" ? (
              <>
                <Link
                  href="/ops"
                  className={
                    pathname.startsWith("/ops") ? "text-accent" : "hover:text-ink"
                  }
                >
                  Call ops
                </Link>
                <Link
                  href="/queue"
                  className={
                    pathname.startsWith("/queue") ? "text-accent" : "hover:text-ink"
                  }
                >
                  QA queue
                </Link>
                <Link
                  href="/settings"
                  className={
                    pathname.startsWith("/settings") ? "text-accent" : "hover:text-ink"
                  }
                >
                  Settings
                </Link>
              </>
            ) : null}
          </nav>
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
