"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { resolveContractAccess } from "@/lib/contractAccess";
import { ContractsSearch } from "@/components/ContractsSearch";
import {
  TOOLSETS,
  activeToolset,
  defaultHrefForUser,
  grantedToolsets,
  isAdmin,
  isSupervisor,
  type ToolsetId,
} from "@/lib/permissions";

function navClass(active: boolean) {
  return active ? "text-accent" : "hover:text-ink";
}

export function AppNav() {
  const { data } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  if (!data?.user || pathname === "/login") return null;

  const admin = isAdmin(data.user);
  const supervisor = isSupervisor(data.user);
  const teamManager = Boolean(data.user.teamManager) || admin || supervisor;
  const callQaManager = admin || teamManager;
  const timeClockManager =
    Boolean(data.user.timeClockManager) || admin || supervisor;
  const toolsets = grantedToolsets(data.user);
  const current = activeToolset(pathname);
  const contractAccess = resolveContractAccess(data.user);
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

          {toolsets.length === 1 ? (
            <span className="rounded-xl border border-line bg-white px-3 py-1.5 text-sm font-semibold text-accent">
              {TOOLSETS[toolsets[0]].label}
            </span>
          ) : toolsets.length > 1 ? (
            <label className="relative inline-flex shrink-0 items-center">
              <span className="sr-only">Tool set</span>
              <select
                aria-label="Tool set"
                value={current && toolsets.includes(current) ? current : ""}
                onChange={(e) => {
                  const next = TOOLSETS[e.target.value as ToolsetId];
                  if (next) router.push(next.href);
                }}
                className="cursor-pointer appearance-none rounded-xl border border-line bg-white py-1.5 pl-3 pr-8 text-sm font-semibold text-ink hover:border-accent/40 focus:border-accent focus:outline-none"
              >
                {current && toolsets.includes(current) ? null : (
                  <option value="" disabled>
                    Tools
                  </option>
                )}
                {toolsets.map((id) => (
                  <option key={id} value={id} title={TOOLSETS[id].description}>
                    {TOOLSETS[id].label}
                  </option>
                ))}
              </select>
              <span
                className="pointer-events-none absolute right-2.5 text-[10px] leading-none text-ink-soft"
                aria-hidden
              >
                ▾
              </span>
            </label>
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
              {callQaManager ? (
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
                  {admin ? (
                    <Link
                      href="/settings"
                      className={navClass(pathname.startsWith("/settings"))}
                    >
                      QA settings
                    </Link>
                  ) : null}
                </>
              ) : null}
            </nav>
          ) : null}

          {current === "time_clock" ? (
            <nav className="hidden items-center gap-4 text-sm font-semibold text-ink-soft md:flex">
              <Link
                href="/time-clock"
                className={navClass(pathname === "/time-clock")}
              >
                Clock
              </Link>
              <Link
                href="/time-clock/history"
                className={navClass(pathname.startsWith("/time-clock/history"))}
              >
                My hours
              </Link>
              {timeClockManager ? (
                <>
                  <Link
                    href="/time-clock/live"
                    className={navClass(pathname.startsWith("/time-clock/live"))}
                  >
                    Live
                  </Link>
                  <Link
                    href="/time-clock/team"
                    className={navClass(pathname.startsWith("/time-clock/team"))}
                  >
                    Team
                  </Link>
                  <Link
                    href="/time-clock/reports"
                    className={navClass(pathname.startsWith("/time-clock/reports"))}
                  >
                    Reports
                  </Link>
                  <Link
                    href="/time-clock/approvals"
                    className={navClass(pathname.startsWith("/time-clock/approvals"))}
                  >
                    Approvals
                  </Link>
                  <Link
                    href="/time-clock/time-off"
                    className={navClass(pathname.startsWith("/time-clock/time-off"))}
                  >
                    Time off
                  </Link>
                  <Link
                    href="/time-clock/banks"
                    className={navClass(pathname.startsWith("/time-clock/banks"))}
                  >
                    PTO banks
                  </Link>
                  {admin || Boolean(data.user.timeClockAdmin) ? (
                    <Link
                      href="/time-clock/audit"
                      className={navClass(pathname.startsWith("/time-clock/audit"))}
                    >
                      Audit
                    </Link>
                  ) : null}
                </>
              ) : null}
              <Link
                href="/time-clock/settings"
                className={navClass(pathname.startsWith("/time-clock/settings"))}
              >
                Settings
              </Link>
            </nav>
          ) : null}

          {current === "contracts" ? (
            <nav className="hidden items-center gap-4 text-sm font-semibold text-ink-soft md:flex">
              {contractAccess.canViewAgreements ? (
                <>
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
                </>
              ) : null}
              {contractAccess.canOpenVendors ? (
                <Link
                  href="/contracts/vendors"
                  className={navClass(pathname.startsWith("/contracts/vendors"))}
                >
                  Vendors
                </Link>
              ) : null}
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
          {current === "contracts" &&
          (contractAccess.canViewAgreements || contractAccess.canOpenVendors) ? (
            <ContractsSearch
              canViewAgreements={contractAccess.canViewAgreements}
              canOpenVendors={contractAccess.canOpenVendors}
            />
          ) : null}
          {admin || teamManager ? (
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
