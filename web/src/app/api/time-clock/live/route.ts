import { NextResponse } from "next/server";
import { apiRequireAdmin, apiRequireModule } from "@/lib/requireAccess";
import { listTeamLiveStatus } from "@/lib/timeClockDb";

export async function GET() {
  const { error } = await apiRequireModule("time_clock");
  if (error) return error;

  const adminResult = await apiRequireAdmin();
  if (adminResult.error) return adminResult.error;

  try {
    const rows = await listTeamLiveStatus();
    return NextResponse.json({ rows, refreshed_at: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load live status" },
      { status: 500 }
    );
  }
}
