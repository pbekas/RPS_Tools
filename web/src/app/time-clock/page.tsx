import { requireModule } from "@/lib/requireAccess";
import {
  getEffectiveTimezone,
  getPunchStatus,
  getTimeClockProfile,
  getTimeClockSettings,
  listTimeEntries,
} from "@/lib/timeClockDb";
import { getTimeOffBank } from "@/lib/timeOffDb";
import { startOfDayIso, addDaysIso } from "@/lib/timeClockFormat";
import { TimeClockHome } from "@/components/TimeClockHome";
import { TimeClockProfilePanel } from "@/components/TimeClockProfilePanel";
import { TimeOffBankCard } from "@/components/TimeOffBankCard";

export default async function TimeClockPage() {
  const session = await requireModule("time_clock");
  const email = session.user.email!.toLowerCase();
  const [settings, profile, userTz] = await Promise.all([
    getTimeClockSettings(),
    getTimeClockProfile(email),
    getEffectiveTimezone(email),
  ]);
  const from = startOfDayIso(new Date(), userTz);
  const to = addDaysIso(from, 1, userTz);

  const [status, { entries }, bank] = await Promise.all([
    getPunchStatus(email),
    listTimeEntries({ userEmail: email, from, to, limit: 50 }),
    getTimeOffBank(email, new Date().getFullYear()),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl text-ink">Time clock</h1>
      <p className="mt-1 text-ink-soft">
        Clock in and out for your shift. Use clock out for breaks and lunches, then clock back in.
      </p>
      <div className="mt-6 space-y-6">
        <TimeClockHome
          initialStatus={status}
          initialEntries={entries}
          settings={settings}
          displayTimezone={userTz}
          from={from}
          to={to}
        />
        <TimeClockProfilePanel initialProfile={profile} />
        <TimeOffBankCard bank={bank} linkToHistory />
      </div>
    </main>
  );
}
