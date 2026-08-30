import { requireTimeClockManager } from "@/lib/requireAccess";
import { buildTimeClockReport, getTimeClockSettings } from "@/lib/timeClockDb";
import { resolvePayPeriod } from "@/lib/timeClockPayPeriod";
import { TimeClockReportPanel } from "@/components/TimeClockReportPanel";

export default async function TimeClockReportsPage() {
  const { access } = await requireTimeClockManager();

  const settings = await getTimeClockSettings();
  const currentPeriod = resolvePayPeriod(settings.timezone);
  const report = await buildTimeClockReport({
    from: currentPeriod.from,
    to: currentPeriod.to,
    team: true,
    userEmails: access.visibleUserEmails,
    payPeriod: currentPeriod,
    includeApproval: true,
  });

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl text-ink">Time reports</h1>
      <p className="mt-1 text-ink-soft">
        Hours worked by pay period. Expand a person to see daily punches, and
        edit a punch when it needs a correction. Edited punches stay marked.
      </p>
      <div className="mt-6">
        <TimeClockReportPanel
          initialFrom={currentPeriod.period_start}
          initialTo={currentPeriod.period_end}
          initialReport={report}
          teamMode
          initialPreset="current"
          scopeLabel={
            access.isAdmin ? "All Time Clock users" : "Your team"
          }
          payPeriodConfig={{
            timezone: settings.timezone,
          }}
        />
      </div>
    </main>
  );
}
