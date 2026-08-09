/** Tool sets shown in the top-level product toggle. */
export const TOOLSETS = {
  call_qa: {
    id: "call_qa",
    label: "Call QA",
    href: "/",
    description: "Call review, coaching, and ops",
  },
  contracts: {
    id: "contracts",
    label: "Contracts",
    href: "/contracts",
    description: "Agreements, vendors, and renewals",
  },
} as const;

export type ToolsetId = keyof typeof TOOLSETS;

/** All grantable module ids (tool sets + admin surfaces). */
export const MODULES = {
  ...TOOLSETS,
  users: {
    id: "users",
    label: "Users & access",
    href: "/users",
  },
} as const;

export type ModuleId = keyof typeof MODULES;

export const ALL_TOOLSET_IDS = Object.keys(TOOLSETS) as ToolsetId[];
export const ALL_MODULE_IDS = Object.keys(MODULES) as ModuleId[];

export type SessionUserLike = {
  email?: string | null;
  role?: string | null;
  modules?: string[] | null;
};

export function isAdmin(user: SessionUserLike | null | undefined): boolean {
  return (user?.role || "").toLowerCase() === "admin";
}

/** Normalize stored modules; empty/legacy means Call QA only. */
export function effectiveModules(
  user: SessionUserLike | null | undefined
): string[] {
  if (!user?.email) return [];
  const modules = (user.modules || [])
    .map((m) => String(m).trim())
    .filter(Boolean)
    .filter((m) => m !== "users");
  const toolsets = modules.length ? Array.from(new Set(modules)) : ["call_qa"];
  if (isAdmin(user)) return Array.from(new Set([...toolsets, "users"]));
  return toolsets;
}

export function hasModule(
  user: SessionUserLike | null | undefined,
  moduleId: ModuleId
): boolean {
  if (!user?.email) return false;
  if (moduleId === "users") return isAdmin(user);
  if (moduleId === "contracts") {
    return effectiveModules(user).some(
      (m) => m === "contracts" || m.startsWith("contracts:")
    );
  }
  return effectiveModules(user).includes(moduleId);
}

export function grantedToolsets(
  user: SessionUserLike | null | undefined
): ToolsetId[] {
  return ALL_TOOLSET_IDS.filter((id) => hasModule(user, id));
}

export function moduleForPath(pathname: string): ModuleId | null {
  if (pathname.startsWith("/contracts")) return "contracts";
  if (pathname.startsWith("/users") || pathname.startsWith("/settings")) {
    return "users";
  }
  if (
    pathname === "/" ||
    pathname.startsWith("/calls") ||
    pathname.startsWith("/coaching") ||
    pathname.startsWith("/ops") ||
    pathname.startsWith("/queue")
  ) {
    return "call_qa";
  }
  return null;
}

export function activeToolset(pathname: string): ToolsetId | null {
  const mod = moduleForPath(pathname);
  if (mod === "contracts") return "contracts";
  if (mod === "call_qa") return "call_qa";
  return null;
}

export function defaultHrefForUser(
  user: SessionUserLike | null | undefined
): string {
  const sets = grantedToolsets(user);
  if (sets.includes("call_qa")) return TOOLSETS.call_qa.href;
  if (sets.includes("contracts")) {
    const mods = effectiveModules(user);
    const hasAgreementGrant =
      mods.includes("contracts") ||
      mods.some((m) => m.startsWith("contracts:group:"));
    if (!hasAgreementGrant) return "/contracts/vendors";
    return TOOLSETS.contracts.href;
  }
  return "/login";
}

export function normalizeToolsetGrants(modules: string[]): ToolsetId[] {
  const allowed = new Set(ALL_TOOLSET_IDS as string[]);
  const cleaned = modules
    .map((m) => String(m).trim())
    .filter((m): m is ToolsetId => allowed.has(m));
  return Array.from(new Set(cleaned));
}

export function normalizeModuleGrants(modules: string[]): string[] {
  const toolsets = normalizeToolsetGrants(modules);
  const extras = modules
    .map((m) => String(m).trim())
    .filter(
      (m) =>
        m.startsWith("contracts:group:") ||
        m === "contracts:vendor_contacts" ||
        m === "contracts:vendor_files"
    );
  return Array.from(new Set([...toolsets, ...extras]));
}
