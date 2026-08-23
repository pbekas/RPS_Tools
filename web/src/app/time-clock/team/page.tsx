import { requireTimeClockManager } from "@/lib/requireAccess";
import { getTimeClockSettings, listTeamDaySummary } from "@/lib/timeClockDb";
import { addDaysIso, startOfDayIso } from "@/lib/timeClockFormat";
import { TeamTimesheet } from "@/components/TeamTimesheet";

export default async function TeamTimeClockPage() {
  const { access } = await requireTimeClockManager();

  const settings = await getTimeClockSettings();
  const to = addDaysIso(startOfDayIso(new Date(), settings.timezone), 1, settings.timezone);
  const from = addDaysIso(to, -14, settings.timezone);
  const rows = await listTeamDaySummary({
    from,
    to,
    userEmails: access.visibleUserEmails,
  });

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl text-ink">Team hours</h1>
      <p className="mt-1 text-ink-soft">
        Manager view of team member hours by day for the last two weeks.
      </p>
      <div className="mt-6">
        <TeamTimesheet initialRows={rows} settings={settings} from={from} to={to} />
      </div>
    </main>
  );
}
