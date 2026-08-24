import { requireTimeClockManager } from "@/lib/requireAccess";
import { getTimeClockSettings } from "@/lib/timeClockDb";
import { dateToYmd } from "@/lib/timeClockPayPeriod";
import { listTeamTimeOff } from "@/lib/timeOffDb";
import { TimeOffSchedule } from "@/components/TimeOffSchedule";

function shiftYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export default async function TeamTimeOffPage() {
  const { access } = await requireTimeClockManager();
  const settings = await getTimeClockSettings();
  const today = dateToYmd(new Date(), settings.timezone);
  const from = shiftYmd(today, -180);
  const to = shiftYmd(today, 180);
  const entries = await listTeamTimeOff({
    from: today,
    to,
    userEmails: access.visibleUserEmails,
  });

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl text-ink">Team time off</h1>
      <p className="mt-1 text-ink-soft">
        Scheduled and past time off for your team. Pending requests are included
        so you can see coverage before you approve.
      </p>
      <div className="mt-6">
        <TimeOffSchedule
          initialEntries={entries}
          initialFrom={from}
          initialTo={to}
          today={today}
        />
      </div>
    </main>
  );
}
