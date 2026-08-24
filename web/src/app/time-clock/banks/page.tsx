import { requireTimeClockManager } from "@/lib/requireAccess";
import { getTimeClockSettings } from "@/lib/timeClockDb";
import { listTimeOffBanks } from "@/lib/timeOffDb";
import { TimeOffBanksPanel } from "@/components/TimeOffBanksPanel";

export default async function TimeOffBanksPage() {
  const { access } = await requireTimeClockManager();
  const year = new Date().getFullYear();
  const [settings, banks] = await Promise.all([
    getTimeClockSettings(),
    listTimeOffBanks(year, access.visibleUserEmails),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl text-ink">Time-off banks</h1>
      <p className="mt-1 text-ink-soft">
        Set annual time-off hours per employee. PTO and sick days deduct from the bank;
        holiday and unpaid do not. Admins are not assigned a PTO bank.
      </p>
      <div className="mt-6">
        <TimeOffBanksPanel
          initialBanks={banks}
          initialYear={year}
          defaultAnnualHours={settings.default_annual_pto_hours}
        />
      </div>
    </main>
  );
}
