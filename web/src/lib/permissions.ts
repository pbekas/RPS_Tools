export const MODULES = {
  call_qa: {
    id: "call_qa",
    label: "Call QA",
    href: "/",
  },
  contracts: {
    id: "contracts",
    label: "Contracts",
    href: "/contracts",
  },
  users: {
    id: "users",
    label: "Users",
    href: "/settings",
  },
} as const;

export type ModuleId = keyof typeof MODULES;

export const ALL_MODULE_IDS = Object.keys(MODULES) as ModuleId[];

export type SessionUserLike = {
  email?: string | null;
  role?: string | null;
  modules?: string[] | null;
};

export function isAdmin(user: SessionUserLike | null | undefined): boolean {
  return (user?.role || "").toLowerCase() === "admin";
}

export function hasModule(
  user: SessionUserLike | null | undefined,
  moduleId: ModuleId
): boolean {
  if (!user?.email) return false;
  if (isAdmin(user)) return true;
  const modules = user.modules || [];
  return modules.includes(moduleId);
}

export function moduleForPath(pathname: string): ModuleId | null {
  if (pathname.startsWith("/contracts")) return "contracts";
  if (pathname.startsWith("/settings")) return "users";
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
