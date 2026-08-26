import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  resolveContractAccess,
  type ContractAccess,
} from "@/lib/contractAccess";
import {
  canViewCallAgent,
  resolveCallQaScope,
  type CallQaScope,
} from "@/lib/orgTeamAccess";
import {
  resolveTimeClockAccess,
  type TimeClockAccess,
} from "@/lib/timeClockAccess";
import { getCall } from "@/lib/database";
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

export async function requireTimeClockManager() {
  const session = await requireModule("time_clock");
  const access = await resolveTimeClockAccess(session.user);
  if (!access.isManager) {
    redirect(defaultHrefForUser(session.user));
  }
  return { session, access };
}

export async function requireTimeClockAdmin() {
  const session = await requireModule("time_clock");
  if (!isAdmin(session.user)) {
    redirect(defaultHrefForUser(session.user));
  }
  const access = await resolveTimeClockAccess(session.user);
  return { session, access };
}

export async function apiRequireTimeClockManager() {
  const result = await apiRequireModule("time_clock");
  if (result.error || !result.session) {
    return { session: null, error: result.error, access: null };
  }
  const access = await resolveTimeClockAccess(result.session.user);
  if (!access.isManager) {
    return {
      session: null,
      error: NextResponse.json({ error: "Manager access required" }, { status: 403 }),
      access: null,
    };
  }
  return { session: result.session, error: null, access };
}

export async function apiRequireTimeClockAdmin() {
  const result = await apiRequireModule("time_clock");
  if (result.error || !result.session) {
    return { session: null, error: result.error, access: null };
  }
  const access = await resolveTimeClockAccess(result.session.user);
  if (!access.isAdmin || !access.canViewAudit) {
    return {
      session: null,
      error: NextResponse.json({ error: "Admin only" }, { status: 403 }),
      access: null,
    };
  }
  return { session: result.session, error: null, access };
}

export async function timeClockAccessForUser(
  user: { email?: string | null; role?: string | null; modules?: string[] | null }
): Promise<TimeClockAccess> {
  return resolveTimeClockAccess(user);
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

export async function requireCallQaManager() {
  const session = await requireModule("call_qa");
  const scope = await resolveCallQaScope(session.user);
  if (!scope.isManager) {
    redirect(defaultHrefForUser(session.user));
  }
  return { session, scope };
}

export async function apiRequireCallQaManager() {
  const result = await apiRequireModule("call_qa");
  if (result.error || !result.session) {
    return { session: null, error: result.error, scope: null as CallQaScope | null };
  }
  const scope = await resolveCallQaScope(result.session.user);
  if (!scope.isManager) {
    return {
      session: null,
      error: NextResponse.json(
        { error: "Manager access required" },
        { status: 403 }
      ),
      scope: null,
    };
  }
  return { session: result.session, error: null, scope };
}

export async function apiRequireCallQaManageCall(callId: string) {
  const result = await apiRequireCallQaManager();
  if (result.error || !result.session || !result.scope) {
    return { ...result, call: null };
  }
  const call = await getCall(callId);
  if (!call) {
    return {
      session: null,
      error: NextResponse.json({ error: "Not found" }, { status: 404 }),
      scope: null,
      call: null,
    };
  }
  if (!canViewCallAgent(result.scope, call.agent_email)) {
    return {
      session: null,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      scope: null,
      call: null,
    };
  }
  return {
    session: result.session,
    error: null,
    scope: result.scope,
    call,
  };
}

export async function requireTeamManager() {
  const session = await requireSession();
  const access = await resolveTimeClockAccess(session.user);
  if (!access.isAdmin && !access.isTeamSupervisor) {
    redirect(defaultHrefForUser(session.user));
  }
  return { session, access };
}

export async function apiRequireTeamManager() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return {
      session: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      access: null as TimeClockAccess | null,
    };
  }
  const access = await resolveTimeClockAccess(session.user);
  if (!access.isAdmin && !access.isTeamSupervisor) {
    return {
      session: null,
      error: NextResponse.json(
        { error: "Manager access required" },
        { status: 403 }
      ),
      access: null,
    };
  }
  return { session, error: null, access };
}
