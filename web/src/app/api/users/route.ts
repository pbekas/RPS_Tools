import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  linkProvisionalAgent,
  listUsers,
  remapCallsForExtension,
  setUserActive,
  setUserModules,
  upsertUser,
  getUser,
} from "@/lib/database";
import { normalizeModuleGrants } from "@/lib/permissions";
import { accessGrantCaps, constrainModuleGrants } from "@/lib/contractAccess";
import { apiRequireTeamManager } from "@/lib/requireAccess";
import { canViewTimeClockUser } from "@/lib/timeClockAccess";

function requireAdmin(session: { user?: { email?: string | null; role?: string } } | null) {
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if ((session.user.role || "").toLowerCase() !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  return null;
}

function allowedDomains(): string[] {
  const multi = (process.env.ALLOWED_EMAIL_DOMAINS || "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  if (multi.length) return multi;
  return [(process.env.ALLOWED_EMAIL_DOMAIN || "releviumpain.com").toLowerCase()];
}

export async function GET() {
  const { session, error, access } = await apiRequireTeamManager();
  if (error) return error;
  if (!session || !access) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = (await listUsers()).filter((user) =>
    access.isAdmin ? true : canViewTimeClockUser(access, user.email)
  );
  const caps = accessGrantCaps(session.user);
  return NextResponse.json({
    users,
    unmapped: [],
    toolsets: caps.toolsets,
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const denied = requireAdmin(session);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "upsert");
  const domains = allowedDomains();

  try {
    if (action === "upsert") {
      const email = String(body.email || "")
        .trim()
        .toLowerCase();
      const name = String(body.name || "").trim();
      const role = String(body.role || "Agent");
      if (!email || !name) {
        return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
      }
      if (!domains.some((d) => email.endsWith(`@${d}`))) {
        return NextResponse.json(
          { error: `Email must be one of: ${domains.map((d) => `@${d}`).join(", ")}` },
          { status: 400 }
        );
      }
      if (!["Agent", "Admin", "Supervisor"].includes(role)) {
        return NextResponse.json(
          { error: "Role must be Agent, Supervisor, or Admin" },
          { status: 400 }
        );
      }
      const extensionRaw =
        body.extension === undefined || body.extension === null
          ? undefined
          : String(body.extension);
      const user = await upsertUser({
        email,
        name,
        role,
        provisional: false,
        extension: extensionRaw,
      });
      if (role === "Supervisor") {
        const mods = normalizeModuleGrants(
          constrainModuleGrants(
            session!.user,
            user.modules || [],
            [...(user.modules || []), "time_clock"]
          )
        );
        if (mods.length) {
          const withClock = await setUserModules(email, mods);
          user.modules = withClock.modules;
        }
      }
      let remappedCalls = 0;
      if (extensionRaw !== undefined) {
        remappedCalls = await remapCallsForExtension({
          email,
          name,
          extension: extensionRaw,
        });
      }
      return NextResponse.json({ ok: true, user, remappedCalls });
    }

    if (action === "set_active") {
      const email = String(body.email || "")
        .trim()
        .toLowerCase();
      const active = !!body.active;
      const user = await setUserActive(email, active);
      return NextResponse.json({ ok: true, user });
    }

    if (action === "set_modules") {
      const email = String(body.email || "")
        .trim()
        .toLowerCase();
      const requested = Array.isArray(body.modules)
        ? body.modules.map((m: unknown) => String(m))
        : [];
      const existing = await getUser(email);
      const modules = normalizeModuleGrants(
        constrainModuleGrants(session!.user, existing?.modules || [], requested)
      );
      if (!modules.length) {
        return NextResponse.json(
          { error: "Grant at least one tool set (Call QA, Contracts, or Time Clock)" },
          { status: 400 }
        );
      }
      const user = await setUserModules(email, modules);
      return NextResponse.json({ ok: true, user });
    }

    if (action === "link_provisional") {
      const result = await linkProvisionalAgent({
        provisionalEmail: String(body.provisional_email || ""),
        realEmail: String(body.real_email || ""),
        name: body.name ? String(body.name) : undefined,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Save failed" },
      { status: 400 }
    );
  }
}
