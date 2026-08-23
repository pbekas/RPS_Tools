import { requireModule } from "@/lib/requireAccess";
import {
  getEffectiveTimezone,
  getTimeClockSettings,
  getWeeklyTimesheetDetail,
} from "@/lib/timeClockDb";
import { weekStartDate } from "@/lib/timeClockFormat";
import { getTimeOffBank } from "@/lib/timeOffDb";
import { WeeklyTimesheetPanel } from "@/components/WeeklyTimesheetPanel";

export default async function TimeClockHistoryPage() {
  const session = await requireModule("time_clock");
  const email = session.user.email!.toLowerCase();
  const [settings, userTz] = await Promise.all([
    getTimeClockSettings(),
    getEffectiveTimezone(email),
  ]);
  const weekStart = weekStartDate(new Date(), userTz);
  const [timesheet, bank] = await Promise.all([
    getWeeklyTimesheetDetail(email, weekStart),
    getTimeOffBank(email, Number(weekStart.slice(0, 4))),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl text-ink">My hours</h1>
      <p className="mt-1 text-ink-soft">
        Review your weekly timesheet, log time off against your bank, and submit for
        manager approval.
      </p>
      <div className="mt-6">
        <WeeklyTimesheetPanel
          initialTimesheet={timesheet}
          settings={settings}
          displayTimezone={userTz}
          initialBank={bank}
        />
      </div>
    </main>
  );
}
