import { NextResponse } from "next/server";
import { apiRequireModule } from "@/lib/requireAccess";
import { isAdmin } from "@/lib/permissions";
import { listTimeEntries } from "@/lib/timeClockDb";

export async function GET(req: Request) {
  const { session, error } = await apiRequireModule("time_clock");
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const admin = isAdmin(session!.user);
  const requestedUser = searchParams.get("userEmail");
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;
  const limit = Number(searchParams.get("limit") || 100);
  const offset = Number(searchParams.get("offset") || 0);

  const userEmail = admin && requestedUser
    ? requestedUser
    : session!.user!.email!.toLowerCase();

  try {
    const result = await listTimeEntries({ userEmail, from, to, limit, offset });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list entries" },
      { status: 500 }
    );
  }
}
