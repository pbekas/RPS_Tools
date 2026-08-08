import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getCall } from "@/lib/database";
import { resolveRecordingUrl } from "@/lib/s3";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const call = await getCall(id);
  if (!call) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const role = (session.user.role || "Agent").toLowerCase();
  if (
    role !== "admin" &&
    (call.agent_email || "").toLowerCase() !== session.user.email.toLowerCase()
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const recording_url = await resolveRecordingUrl(call);
  return NextResponse.json({ call: { ...call, recording_url } });
}
