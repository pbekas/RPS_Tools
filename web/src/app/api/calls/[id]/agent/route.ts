import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { assignCallAgent } from "@/lib/firestore";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if ((session.user.role || "").toLowerCase() !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  try {
    const call = await assignCallAgent({
      callId: id,
      agentEmail: body.agent_email,
      agentName: body.agent_name,
      createName: body.create_name,
      createEmail: body.create_email,
    });
    return NextResponse.json({ ok: true, call });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Assign failed" },
      { status: 400 }
    );
  }
}
