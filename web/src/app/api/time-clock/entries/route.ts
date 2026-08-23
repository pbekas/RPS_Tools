import { NextResponse } from "next/server";
import { canViewTimeClockUser, resolveTimeClockAccess } from "@/lib/timeClockAccess";
import { apiRequireModule } from "@/lib/requireAccess";
import { listTimeEntries } from "@/lib/timeClockDb";

export async function GET(req: Request) {
  const { session, error } = await apiRequireModule("time_clock");
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const access = await resolveTimeClockAccess(session!.user);
  const requestedUser = searchParams.get("userEmail");
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;
  const limit = Number(searchParams.get("limit") || 100);
  const offset = Number(searchParams.get("offset") || 0);

  const userEmail =
    access.isManager && requestedUser
      ? requestedUser.toLowerCase()
      : session!.user!.email!.toLowerCase();

  if (!canViewTimeClockUser(access, userEmail)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
