import { requireModule } from "@/lib/requireAccess";
import {
  getPunchStatus,
  getTimeClockSettings,
  listTimeEntries,
} from "@/lib/timeClockDb";
import { startOfDayIso, addDaysIso } from "@/lib/timeClockFormat";
import { TimeClockHome } from "@/components/TimeClockHome";

export default async function TimeClockPage() {
  const session = await requireModule("time_clock");
  const email = session.user.email!.toLowerCase();
  const settings = await getTimeClockSettings();
  const from = startOfDayIso(new Date(), settings.timezone);
  const to = addDaysIso(from, 1, settings.timezone);

  const [status, { entries }] = await Promise.all([
    getPunchStatus(email),
    listTimeEntries({ userEmail: email, from, to, limit: 50 }),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl text-ink">Time clock</h1>
      <p className="mt-1 text-ink-soft">
        Clock in and out for your shift. Use clock out for breaks and lunches, then clock back in.
      </p>
      <div className="mt-6">
        <TimeClockHome
          initialStatus={status}
          initialEntries={entries}
          settings={settings}
          from={from}
          to={to}
        />
      </div>
    </main>
  );
}
