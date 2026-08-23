import { redirect } from "next/navigation";
import { requireModule } from "@/lib/requireAccess";
import { isAdmin } from "@/lib/permissions";
import {
  getTimeClockSettings,
  listTeamDaySummary,
} from "@/lib/timeClockDb";
import { addDaysIso, startOfDayIso } from "@/lib/timeClockFormat";
import { TeamTimesheet } from "@/components/TeamTimesheet";

export default async function TeamTimeClockPage() {
  const session = await requireModule("time_clock");
  if (!isAdmin(session.user)) redirect("/time-clock");

  const settings = await getTimeClockSettings();
  const to = addDaysIso(startOfDayIso(new Date(), settings.timezone), 1, settings.timezone);
  const from = addDaysIso(to, -14, settings.timezone);
  const rows = await listTeamDaySummary({ from, to });

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
