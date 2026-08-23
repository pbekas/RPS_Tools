import { requireModule } from "@/lib/requireAccess";
import {
  getEffectiveTimezone,
  getTimeClockSettings,
  getWeeklyTimesheetDetail,
} from "@/lib/timeClockDb";
import { weekStartDate } from "@/lib/timeClockFormat";
import { WeeklyTimesheetPanel } from "@/components/WeeklyTimesheetPanel";

export default async function TimeClockHistoryPage() {
  const session = await requireModule("time_clock");
  const email = session.user.email!.toLowerCase();
  const [settings, userTz] = await Promise.all([
    getTimeClockSettings(),
    getEffectiveTimezone(email),
  ]);
  const weekStart = weekStartDate(new Date(), userTz);
  const timesheet = await getWeeklyTimesheetDetail(email, weekStart);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl text-ink">My hours</h1>
      <p className="mt-1 text-ink-soft">
        Review your weekly timesheet, log time off, and submit for manager approval.
      </p>
      <div className="mt-6">
        <WeeklyTimesheetPanel
          initialTimesheet={timesheet}
          settings={settings}
          displayTimezone={userTz}
        />
      </div>
    </main>
  );
}
