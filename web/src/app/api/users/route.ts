import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  discoverUnmappedAgents,
  importAndMapAgent,
  linkProvisionalAgent,
  listUsers,
  listVonageExtensions,
  setUserActive,
  setUserExtension,
  upsertUser,
} from "@/lib/database";
import { hasModule, normalizeModules } from "@/lib/permissions";
import { PollerError, pollerJson } from "@/lib/poller";

function requireUsersModule(
  session: { user?: { email?: string | null; role?: string; modules?: string[] } } | null
) {
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasModule(session.user, "users")) {
    return NextResponse.json({ error: "Users module required" }, { status: 403 });
  }
  return null;
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const denied = requireUsersModule(session);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const includeUnmapped = searchParams.get("unmapped") !== "0";
  const includeExtensions = searchParams.get("extensions") === "1";
  const users = await listUsers();
  const unmapped = includeUnmapped ? await discoverUnmappedAgents() : [];
  const extensions = includeExtensions ? await listVonageExtensions() : undefined;
  return NextResponse.json({ users, unmapped, extensions });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const denied = requireUsersModule(session);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "upsert");
  const domain = (process.env.ALLOWED_EMAIL_DOMAIN || "releviumpain.com").toLowerCase();

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
      if (!email.endsWith(`@${domain}`)) {
        return NextResponse.json({ error: `Email must be @${domain}` }, { status: 400 });
      }
      if (!["Agent", "Admin"].includes(role)) {
        return NextResponse.json({ error: "Role must be Agent or Admin" }, { status: 400 });
      }
      const user = await upsertUser({
        email,
        name,
        role,
        provisional: false,
        modules: normalizeModules(body.modules),
      });
      return NextResponse.json({ ok: true, user });
    }

    if (action === "set_active") {
      const email = String(body.email || "")
        .trim()
        .toLowerCase();
      const active = !!body.active;
      const user = await setUserActive(email, active);
      return NextResponse.json({ ok: true, user });
    }

    if (action === "import_map") {
      const result = await importAndMapAgent({
        agentName: String(body.agent_name || ""),
        email: body.email ? String(body.email) : null,
        role: body.role ? String(body.role) : "Agent",
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "import_map_all") {
      const rows = await discoverUnmappedAgents();
      const results = [];
      for (const row of rows) {
        if (row.mapped) continue;
        try {
          const out = await importAndMapAgent({
            agentName: row.agent_name,
            email: row.suggested_email,
          });
          results.push({
            ok: true,
            name: out.name,
            email: out.email,
            remappedCalls: out.remappedCalls,
          });
        } catch (e) {
          results.push({
            ok: false,
            name: row.agent_name,
            error: e instanceof Error ? e.message : "failed",
          });
        }
      }
      return NextResponse.json({ ok: true, results });
    }

    if (action === "set_extension") {
      const email = String(body.email || "")
        .trim()
        .toLowerCase();
      const extension =
        body.extension == null ? "" : String(body.extension).trim();
      if (!email) {
        return NextResponse.json({ error: "Email is required" }, { status: 400 });
      }
      const user = await setUserExtension(email, extension);
      return NextResponse.json({ ok: true, user });
    }

    if (action === "sync_extensions") {
      try {
        const data = await pollerJson<{
          status: string;
          summary?: Record<string, unknown>;
        }>("/ops/sync-extensions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auto_map: body.auto_map !== false }),
        });
        const users = await listUsers();
        const extensions = await listVonageExtensions();
        return NextResponse.json({
          ok: true,
          summary: data.summary || {},
          users,
          extensions,
        });
      } catch (e) {
        if (e instanceof PollerError) {
          return NextResponse.json({ error: e.detail }, { status: e.status });
        }
        throw e;
      }
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
