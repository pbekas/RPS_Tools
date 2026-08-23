import { NextResponse } from "next/server";
import { apiRequireTimeClockManager } from "@/lib/requireAccess";
import { listTeamLiveStatus } from "@/lib/timeClockDb";

export async function GET() {
  const { error, access } = await apiRequireTimeClockManager();
  if (error) return error;

  try {
    const rows = await listTeamLiveStatus(access!.visibleUserEmails);
    return NextResponse.json({ rows, refreshed_at: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load live status" },
      { status: 500 }
    );
  }
}
