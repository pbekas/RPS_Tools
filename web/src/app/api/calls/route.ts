import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { listCalls } from "@/lib/database";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = session.user.role || "Agent";
  const { searchParams } = new URL(req.url);
  const agent = searchParams.get("agent");

  const agentEmail =
    role.toLowerCase() === "admin"
      ? agent || null
      : session.user.email.toLowerCase();

  const calls = await listCalls({
    agentEmail,
    status: "complete",
    limit: 100,
  });
  return NextResponse.json({ calls });
}
