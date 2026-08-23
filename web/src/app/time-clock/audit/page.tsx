import { requireTimeClockManager } from "@/lib/requireAccess";
import { listTimeClockAuditLog } from "@/lib/timeClockAudit";
import { TimeClockAuditLog } from "@/components/TimeClockAuditLog";

export default async function TimeClockAuditPage() {
  const { access } = await requireTimeClockManager();

  const { entries, total } = await listTimeClockAuditLog({
    limit: 100,
    teamIds: access.teamIds,
    allowedSubjectEmails: access.visibleUserEmails,
  });

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl text-ink">Audit trail</h1>
      <p className="mt-1 text-ink-soft">
        Immutable log of punches, edits, timesheet approvals, and team changes.
      </p>
      <div className="mt-6">
        <TimeClockAuditLog initialEntries={entries} initialTotal={total} />
      </div>
    </main>
  );
}
