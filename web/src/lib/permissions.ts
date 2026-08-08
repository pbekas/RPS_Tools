/** Module ids for the RPS Tools product shell. */
export const MODULES = {
  call_qa: {
    id: "call_qa" as const,
    label: "Call QA",
    href: "/",
  },
  users: {
    id: "users" as const,
    label: "Users",
    href: "/users",
  },
} as const;

export type ModuleId = keyof typeof MODULES;

export const ALL_MODULE_IDS = Object.keys(MODULES) as ModuleId[];

const CALL_QA_PATH_PREFIXES = [
  "/",
  "/calls",
  "/coaching",
  "/ops",
  "/reporting",
  "/queue",
  "/settings",
] as const;

export type AccessUser = {
  role?: string | null;
  modules?: string[] | null;
};

export function isAdminRole(role?: string | null): boolean {
  return (role || "").trim().toLowerCase() === "admin";
}

/** Normalize stored module list; unknown ids dropped. */
export function normalizeModules(raw: unknown): ModuleId[] {
  if (!Array.isArray(raw)) return [];
  const out: ModuleId[] = [];
  for (const item of raw) {
    const id = String(item || "").trim().toLowerCase();
    if ((ALL_MODULE_IDS as string[]).includes(id) && !out.includes(id as ModuleId)) {
      out.push(id as ModuleId);
    }
  }
  return out;
}

/**
 * Effective modules for a user.
 * Admin ⇒ all modules. Otherwise use explicit modules, defaulting to call_qa.
 */
export function effectiveModules(user: AccessUser | null | undefined): ModuleId[] {
  if (!user) return [];
  if (isAdminRole(user.role)) return [...ALL_MODULE_IDS];
  const explicit = normalizeModules(user.modules);
  if (explicit.length) return explicit;
  return ["call_qa"];
}

export function hasModule(
  user: AccessUser | null | undefined,
  moduleId: ModuleId
): boolean {
  return effectiveModules(user).includes(moduleId);
}

/** Which top-level module a pathname belongs to (for highlighting). */
export function moduleForPath(pathname: string): ModuleId | null {
  if (pathname === "/users" || pathname.startsWith("/users/")) return "users";
  if (pathname === "/login") return null;
  for (const prefix of CALL_QA_PATH_PREFIXES) {
    if (prefix === "/") {
      if (pathname === "/") return "call_qa";
      continue;
    }
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return "call_qa";
  }
  return null;
}

export function defaultHrefForUser(user: AccessUser | null | undefined): string {
  const mods = effectiveModules(user);
  if (mods.includes("call_qa")) return MODULES.call_qa.href;
  if (mods.includes("users")) return MODULES.users.href;
  return "/login";
}
