import { requireModule } from "@/lib/requireAccess";
import { getTimeClockSettings, listTimeEntries } from "@/lib/timeClockDb";
import { addDaysIso, startOfDayIso } from "@/lib/timeClockFormat";
import { TimeClockHistoryClient } from "@/components/TimeClockHistoryClient";

export default async function TimeClockHistoryPage() {
  const session = await requireModule("time_clock");
  const email = session.user.email!.toLowerCase();
  const settings = await getTimeClockSettings();
  const toDate = new Date();
  const to = addDaysIso(startOfDayIso(toDate, settings.timezone), 1, settings.timezone);
  const from = addDaysIso(to, -14, settings.timezone);

  const { entries } = await listTimeEntries({
    userEmail: email,
    from,
    to,
    limit: 200,
  });

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl text-ink">My hours</h1>
      <p className="mt-1 text-ink-soft">
        Review your time entries, add notes, or request edits for manager approval.
      </p>
      <div className="mt-6">
        <TimeClockHistoryClient
          initialEntries={entries}
          settings={settings}
          initialFrom={from}
          initialTo={to}
        />
      </div>
    </main>
  );
}
