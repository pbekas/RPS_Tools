import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  defaultHrefForUser,
  hasModule,
  isAdmin,
  type ModuleId,
} from "@/lib/permissions";

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
