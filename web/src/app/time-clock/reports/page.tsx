import { redirect } from "next/navigation";
import { requireModule } from "@/lib/requireAccess";
import { isAdmin } from "@/lib/permissions";
import { buildTimeClockReport, getTimeClockSettings } from "@/lib/timeClockDb";
import { addDaysIso, startOfDayIso } from "@/lib/timeClockFormat";
import { TimeClockReportPanel } from "@/components/TimeClockReportPanel";

export default async function TimeClockReportsPage() {
  const session = await requireModule("time_clock");
  if (!isAdmin(session.user)) redirect("/time-clock");

  const settings = await getTimeClockSettings();
  const to = addDaysIso(startOfDayIso(new Date(), settings.timezone), 1, settings.timezone);
  const from = addDaysIso(to, -7, settings.timezone);
  const report = await buildTimeClockReport({ from, to, team: true });

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl text-ink">Time reports</h1>
      <p className="mt-1 text-ink-soft">
        Export team hours by date range with weekly breakdown and period totals.
      </p>
      <div className="mt-6">
        <TimeClockReportPanel
          initialFrom={from}
          initialTo={to}
          initialReport={report}
          teamMode
        />
      </div>
    </main>
  );
}
