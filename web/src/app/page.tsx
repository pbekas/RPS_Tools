import { Suspense } from "react";
import { redirect } from "next/navigation";
import { isFirestoreQuotaError, listCalls } from "@/lib/database";
import { buildIssueHeatmap } from "@/lib/qa";
import { Dashboard } from "@/components/Dashboard";
import { QuotaNotice } from "@/components/QuotaNotice";
import { defaultHrefForUser, hasModule, isAdminRole } from "@/lib/permissions";
import { requireSession } from "@/lib/requireAccess";

export default async function HomePage() {
  const session = await requireSession();
  if (!hasModule(session.user, "call_qa")) {
    redirect(defaultHrefForUser(session.user));
  }

  const isAdmin = isAdminRole(session.user.role);
  const heatmapDays = 14;
  const sinceMs = Date.now() - heatmapDays * 24 * 60 * 60 * 1000;

  let calls;
  try {
    calls = await listCalls({
      agentEmail: isAdmin ? null : session.user.email!.toLowerCase(),
      status: "complete",
      limit: isAdmin ? 200 : 100,
      sinceMs: isAdmin ? sinceMs : null,
    });
  } catch (err) {
    if (isFirestoreQuotaError(err)) {
      return <QuotaNotice detail={err instanceof Error ? err.message : undefined} />;
    }
    throw err;
  }

  const heatmap = isAdmin ? buildIssueHeatmap(calls) : null;

  return (
    <Suspense fallback={<div className="p-8 text-ink-soft">Loading…</div>}>
      <Dashboard
        calls={calls}
        isAdmin={isAdmin}
        heatmap={heatmap}
        heatmapDays={heatmapDays}
      />
    </Suspense>
  );
}
