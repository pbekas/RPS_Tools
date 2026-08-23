import { requireModule } from "@/lib/requireAccess";
import {
  getTimeClockSettings,
  getWeeklyTimesheetDetail,
} from "@/lib/timeClockDb";
import { weekStartDate } from "@/lib/timeClockFormat";
import { WeeklyTimesheetPanel } from "@/components/WeeklyTimesheetPanel";

export default async function TimeClockHistoryPage() {
  const session = await requireModule("time_clock");
  const email = session.user.email!.toLowerCase();
  const settings = await getTimeClockSettings();
  const weekStart = weekStartDate(new Date(), settings.timezone);
  const timesheet = await getWeeklyTimesheetDetail(email, weekStart);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl text-ink">My hours</h1>
      <p className="mt-1 text-ink-soft">
        Review your weekly timesheet, add notes, and submit for manager approval.
      </p>
      <div className="mt-6">
        <WeeklyTimesheetPanel initialTimesheet={timesheet} settings={settings} />
      </div>
    </main>
  );
}
