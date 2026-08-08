import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { PollerError, pollerJson } from "@/lib/poller";

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

  try {
    const data = await pollerJson<Record<string, unknown>>("/ops/live-calls", {
      method: "GET",
    }, 30_000);
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof PollerError) {
      return NextResponse.json({ error: e.detail }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Live calls failed" },
      { status: 500 }
    );
  }
}
