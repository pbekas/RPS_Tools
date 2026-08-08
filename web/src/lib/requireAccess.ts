import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  defaultHrefForUser,
  hasModule,
  type ModuleId,
} from "@/lib/permissions";

export async function requireSession(): Promise<Session> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  return session;
}

export async function requireModule(moduleId: ModuleId): Promise<Session> {
  const session = await requireSession();
  if (!hasModule(session.user, moduleId)) {
    redirect(defaultHrefForUser(session.user));
  }
  return session;
}
