import { redirect } from "next/navigation";
import { requireModule } from "@/lib/requireAccess";
import { isAdmin } from "@/lib/permissions";
import { getTimeClockSettings, listEditRequests } from "@/lib/timeClockDb";
import { EditApprovals } from "@/components/EditApprovals";

export default async function TimeClockApprovalsPage() {
  const session = await requireModule("time_clock");
  if (!isAdmin(session.user)) redirect("/time-clock");

  const [settings, requests] = await Promise.all([
    getTimeClockSettings(),
    listEditRequests({ status: "pending", limit: 100 }),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl text-ink">Edit approvals</h1>
      <p className="mt-1 text-ink-soft">
        Review and approve manual time corrections submitted by team members.
      </p>
      <div className="mt-6">
        <EditApprovals initialRequests={requests} settings={settings} />
      </div>
    </main>
  );
}
