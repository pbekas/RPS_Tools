import { requireTimeClockManager } from "@/lib/requireAccess";
import {
  getTimeClockSettings,
  getWeeklyTimesheetDetail,
  listEditRequests,
  listSubmittedTimesheets,
  listTimeClockRoster,
} from "@/lib/timeClockDb";
import { dateToYmd } from "@/lib/timeClockPayPeriod";
import {
  listPendingTimeOffRequests,
  listReviewedTimeOff,
  listTeamTimeOff,
} from "@/lib/timeOffDb";
import { ApprovalsHub } from "@/components/ApprovalsHub";

function shiftYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export default async function TimeClockApprovalsPage() {
  const { access } = await requireTimeClockManager();

  const [settings, requests, submitted, timeOffRequests, people] =
    await Promise.all([
      getTimeClockSettings(),
      listEditRequests({
        status: "pending",
        userEmails: access.visibleUserEmails,
        limit: 100,
      }),
      listSubmittedTimesheets(100, access.visibleUserEmails),
      listPendingTimeOffRequests(access.visibleUserEmails),
      listTimeClockRoster(access.visibleUserEmails),
    ]);

  const today = dateToYmd(new Date(), settings.timezone);
  const approvedTimeOff = await listReviewedTimeOff({
    from: shiftYmd(today, -365),
    to: shiftYmd(today, 548),
    userEmails: access.visibleUserEmails,
    statuses: ["approved"],
    limit: 500,
  });

  const timesheets = await Promise.all(
    submitted.map((sheet) =>
      getWeeklyTimesheetDetail(sheet.user_email, sheet.week_start)
    )
  );

  const pendingDates = timeOffRequests.map((entry) => entry.entry_date).sort();
  const overlapEntries = pendingDates.length
    ? await listTeamTimeOff({
        from: pendingDates[0],
        to: pendingDates[pendingDates.length - 1],
        userEmails: access.visibleUserEmails,
      })
    : [];

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl text-ink">Approvals</h1>
      <p className="mt-1 text-ink-soft">
        Approve weekly timesheets, time edits, and time-off requests. New
        time-off and punch-edit requests email the team supervisor.
      </p>
      <div className="mt-6">
        <ApprovalsHub
          initialEditRequests={requests}
          initialTimesheets={timesheets}
          initialTimeOffRequests={timeOffRequests}
          initialApprovedTimeOff={approvedTimeOff}
          overlapEntries={overlapEntries}
          settings={settings}
          people={people}
        />
      </div>
    </main>
  );
}
