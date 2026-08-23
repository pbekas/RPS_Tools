import { NextResponse } from "next/server";
import { resolveTimeClockAccess } from "@/lib/timeClockAccess";
import { apiRequireModule } from "@/lib/requireAccess";
import {
  buildTimeClockReport,
  entryHours,
  listTeamDaySummary,
} from "@/lib/timeClockDb";
import { buildTimeClockReportPdf } from "@/lib/timeClockPdf";

export async function GET(req: Request) {
  const { session, error } = await apiRequireModule("time_clock");
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const format = searchParams.get("format");
  const view = searchParams.get("view");
  const userEmail = searchParams.get("userEmail");
  const access = await resolveTimeClockAccess(session!.user);

  if (!from || !to) {
    return NextResponse.json({ error: "from and to are required" }, { status: 400 });
  }

  try {
    if (view === "team_days") {
      if (!access.isManager) {
        return NextResponse.json({ error: "Manager access required" }, { status: 403 });
      }
      const rows = await listTeamDaySummary({
        from,
        to,
        userEmails: access.visibleUserEmails,
      });
      return NextResponse.json({ rows });
    }

    const teamMode = access.isManager && searchParams.get("team") === "1";
    const report = await buildTimeClockReport({
      from,
      to,
      userEmail: teamMode ? null : userEmail || session!.user!.email!,
      userEmails: teamMode ? access.visibleUserEmails : null,
      team: teamMode,
    });

    if (format === "csv") {
      const lines = [
        "user_email,user_name,clock_in,clock_out,hours,notes",
        ...report.entries.map((entry) => {
          const hours = entryHours(entry).toFixed(2);
          const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
          return [
            esc(entry.user_email),
            esc(entry.user_name || ""),
            esc(entry.clock_in),
            esc(entry.clock_out || ""),
            hours,
            esc(entry.notes || ""),
          ].join(",");
        }),
      ];
      return new NextResponse(lines.join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="time-clock-${from.slice(0, 10)}-${to.slice(0, 10)}.csv"`,
        },
      });
    }

    if (format === "pdf") {
      const pdf = await buildTimeClockReportPdf(report);
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="time-clock-${from.slice(0, 10)}-${to.slice(0, 10)}.pdf"`,
        },
      });
    }

    return NextResponse.json({ report });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Report failed" },
      { status: 500 }
    );
  }
}
