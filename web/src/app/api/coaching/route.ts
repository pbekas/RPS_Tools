import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { generateCoachingForAgent } from "@/lib/coaching";
import {
  getUser,
  listMetricsForAgent,
  listUsers,
} from "@/lib/database";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isAdmin = (session.user.role || "").toLowerCase() === "admin";
  const { searchParams } = new URL(req.url);
  const requested = (searchParams.get("agent") || "").toLowerCase();
  const email = isAdmin && requested ? requested : session.user.email.toLowerCase();

  if (!isAdmin && email !== session.user.email.toLowerCase()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const user = await getUser(email);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const metrics = await listMetricsForAgent(email, 8);
  const agents = isAdmin
    ? (await listUsers()).filter((u) => (u.role || "").toLowerCase() !== "admin")
    : [];
  return NextResponse.json({ user, metrics, agents });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if ((session.user.role || "").toLowerCase() !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const agent = String(body.agent || body.email || "").trim().toLowerCase();
  if (!agent) {
    return NextResponse.json({ error: "agent required" }, { status: 400 });
  }

  try {
    const result = await generateCoachingForAgent(agent);
    const metrics = await listMetricsForAgent(agent, 8);
    return NextResponse.json({ ok: true, ...result, metrics });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Coaching failed" },
      { status: 500 }
    );
  }
}
