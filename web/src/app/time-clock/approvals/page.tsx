import { requireTimeClockManager } from "@/lib/requireAccess";
import {
  getTimeClockSettings,
  getWeeklyTimesheetDetail,
  listEditRequests,
  listSubmittedTimesheets,
} from "@/lib/timeClockDb";
import { ApprovalsHub } from "@/components/ApprovalsHub";

export default async function TimeClockApprovalsPage() {
  const { access } = await requireTimeClockManager();

  const [settings, requests, submitted] = await Promise.all([
    getTimeClockSettings(),
    listEditRequests({
      status: "pending",
      userEmails: access.visibleUserEmails,
      limit: 100,
    }),
    listSubmittedTimesheets(100, access.visibleUserEmails),
  ]);

  const timesheets = await Promise.all(
    submitted.map((sheet) =>
      getWeeklyTimesheetDetail(sheet.user_email, sheet.week_start)
    )
  );

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl text-ink">Approvals</h1>
      <p className="mt-1 text-ink-soft">
        Approve weekly timesheets and individual time edit requests.
      </p>
      <div className="mt-6">
        <ApprovalsHub
          initialEditRequests={requests}
          initialTimesheets={timesheets}
          settings={settings}
        />
      </div>
    </main>
  );
}
