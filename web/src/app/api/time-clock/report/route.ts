import { NextResponse } from "next/server";
import {
  canViewTimeClockUser,
  resolveTimeClockAccess,
} from "@/lib/timeClockAccess";
import { apiRequireModule } from "@/lib/requireAccess";
import {
  buildTimeClockReport,
  entryHours,
  getTimeClockSettings,
  listTeamDaySummary,
} from "@/lib/timeClockDb";
import { buildTimeClockReportPdf } from "@/lib/timeClockPdf";
import {
  parseNamedRangeKind,
  parseRangeOffset,
  resolveNamedRange,
  resolvePayPeriod,
  type NamedRange,
} from "@/lib/timeClockPayPeriod";

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

  try {
    if (view === "team_days") {
      if (!from || !to) {
        return NextResponse.json({ error: "from and to are required" }, { status: 400 });
      }
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
    const settings = await getTimeClockSettings();
    const rangeKindRaw = searchParams.get("range");
    const payPeriodPreset = searchParams.get("pay_period");
    let payPeriodBounds;
    let namedRange: NamedRange | undefined;
    if (rangeKindRaw) {
      namedRange = resolveNamedRange(
        parseNamedRangeKind(rangeKindRaw),
        settings.timezone,
        new Date(),
        parseRangeOffset(searchParams.get("offset"))
      );
      payPeriodBounds = namedRange.payPeriod;
    } else if (payPeriodPreset === "current") {
      payPeriodBounds = resolvePayPeriod(settings.timezone, new Date(), 0);
    } else if (payPeriodPreset === "previous") {
      payPeriodBounds = resolvePayPeriod(settings.timezone, new Date(), -1);
    } else if (!from || !to) {
      return NextResponse.json({ error: "from and to are required" }, { status: 400 });
    }

    const reportFrom = namedRange?.from || payPeriodBounds?.from || from!;
    const reportTo = namedRange?.to || payPeriodBounds?.to || to!;
    const includeApproval = format === "pdf" || searchParams.get("approval") === "1";

    let reportUserEmail: string | null = null;
    let reportUserEmails: string[] | null = null;
    if (teamMode) {
      reportUserEmails = access.visibleUserEmails;
    } else {
      const target = (userEmail || session!.user!.email!).toLowerCase();
      if (!canViewTimeClockUser(access, target)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      reportUserEmail = target;
    }

    const report = await buildTimeClockReport({
      from: reportFrom,
      to: reportTo,
      userEmail: reportUserEmail,
      userEmails: reportUserEmails,
      team: teamMode,
      payPeriod: payPeriodBounds,
      includeApproval,
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
          "Content-Disposition": `attachment; filename="time-clock-${reportFrom.slice(0, 10)}-${reportTo.slice(0, 10)}.csv"`,
        },
      });
    }

    if (format === "pdf") {
      const pdf = await buildTimeClockReportPdf(report);
      const periodSlug = report.pay_period
        ? `pp${report.pay_period.period_number}-${report.pay_period.period_start}`
        : `${reportFrom.slice(0, 10)}-${reportTo.slice(0, 10)}`;
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="time-clock-${periodSlug}.pdf"`,
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
