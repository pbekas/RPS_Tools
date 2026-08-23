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
        Export pay-period hours by employee with manager approval stamps for Plane
        reimbursement.
      </p>
      <div className="mt-6">
        <TimeClockReportPanel
          initialFrom={currentPeriod.period_start}
          initialTo={currentPeriod.period_end}
          initialReport={report}
          teamMode
          initialPreset="current"
          payPeriodConfig={{
            timezone: settings.timezone,
          }}
        />
      </div>
    </main>
  );
}
