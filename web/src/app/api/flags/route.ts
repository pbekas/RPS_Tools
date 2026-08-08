import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  getCallFlags,
  setCallFlagActive,
  upsertCallFlag,
} from "@/lib/database";

function requireAdmin(session: { user?: { email?: string | null; role?: string } } | null) {
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if ((session.user.role || "").toLowerCase() !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const denied = requireAdmin(session);
  if (denied) return denied;
  const flagset = await getCallFlags();
  return NextResponse.json({ flagset });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const denied = requireAdmin(session);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "upsert");

  try {
    if (action === "upsert") {
      const flagset = await upsertCallFlag({
        id: String(body.id || ""),
        label: String(body.label || ""),
        description: body.description ? String(body.description) : "",
        severity: body.severity ? String(body.severity) : "critical",
        active: body.active !== false,
      });
      return NextResponse.json({ ok: true, flagset });
    }
    if (action === "set_active") {
      const flagset = await setCallFlagActive(String(body.id || ""), !!body.active);
      return NextResponse.json({ ok: true, flagset });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Save failed" },
      { status: 400 }
    );
  }
}
