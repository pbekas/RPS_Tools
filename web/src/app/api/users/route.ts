import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  discoverUnmappedAgents,
  importAndMapAgent,
  linkProvisionalAgent,
  listUsers,
  setUserActive,
  upsertUser,
} from "@/lib/firestore";

function requireAdmin(session: { user?: { email?: string | null; role?: string } } | null) {
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if ((session.user.role || "").toLowerCase() !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  return null;
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const denied = requireAdmin(session);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const includeUnmapped = searchParams.get("unmapped") !== "0";
  const users = await listUsers();
  const unmapped = includeUnmapped ? await discoverUnmappedAgents() : [];
  return NextResponse.json({ users, unmapped });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const denied = requireAdmin(session);
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
