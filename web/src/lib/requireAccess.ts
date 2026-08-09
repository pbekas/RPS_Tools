import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  resolveContractAccess,
  type ContractAccess,
} from "@/lib/contractAccess";
import {
  defaultHrefForUser,
  hasModule,
  isAdmin,
  type ModuleId,
} from "@/lib/permissions";
import { listContractGroups } from "@/lib/contractsDb";

export async function requireSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  return session;
}

export async function requireModule(moduleId: ModuleId) {
  const session = await requireSession();
  if (!hasModule(session.user, moduleId)) {
    redirect(defaultHrefForUser(session.user));
  }
  return session;
}

export async function requireAdminSession() {
  const session = await requireSession();
  if (!isAdmin(session.user)) redirect(defaultHrefForUser(session.user));
  return session;
}

export async function apiRequireModule(moduleId: ModuleId) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return {
      session: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (!hasModule(session.user, moduleId)) {
    return {
      session: null,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { session, error: null };
}

export async function apiRequireContracts() {
  const result = await apiRequireModule("contracts");
  if (result.error || !result.session) {
    return { session: null, error: result.error, access: null };
  }
  const access = await contractAccessForUser(result.session.user);
  return { session: result.session, error: null, access };
}

export async function contractAccessForUser(
  user: { email?: string | null; role?: string | null; modules?: string[] | null }
): Promise<ContractAccess & { allowedGroupIds: string[] | null }> {
  const access = resolveContractAccess(user);
  if (access.allGroups) return { ...access, allowedGroupIds: null };
  if (!access.groupSlugs.length) return { ...access, allowedGroupIds: [] };
  const groups = await listContractGroups();
  const allowed = new Set(access.groupSlugs);
  return {
    ...access,
    allowedGroupIds: groups.filter((g) => allowed.has(g.slug)).map((g) => g.id),
  };
}

export async function apiRequireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return {
      session: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (!isAdmin(session.user)) {
    return {
      session: null,
      error: NextResponse.json({ error: "Admin only" }, { status: 403 }),
    };
  }
  return { session, error: null };
}
