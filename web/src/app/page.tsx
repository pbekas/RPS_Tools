import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { authOptions } from "@/lib/auth";
import { isFirestoreQuotaError, listCalls, listUsers } from "@/lib/database";
import { buildIssueHeatmap, filterMappedQaCalls } from "@/lib/qa";
import { Dashboard } from "@/components/Dashboard";
import { QuotaNotice } from "@/components/QuotaNotice";
import { resolveCallQaScope } from "@/lib/orgTeamAccess";
import {
  defaultHrefForUser,
  hasModule,
} from "@/lib/permissions";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  if (!hasModule(session.user, "call_qa")) {
    redirect(defaultHrefForUser(session.user));
  }

  const scope = await resolveCallQaScope(session.user);
  const heatmapDays = 14;
  const sinceMs = Date.now() - heatmapDays * 24 * 60 * 60 * 1000;

  let calls;
  try {
    const [rawCalls, users] = await Promise.all([
      listCalls({
        agentEmails: scope.agentEmails,
        status: "complete",
        limit: scope.canViewTeam ? 200 : 100,
        sinceMs: scope.canViewTeam ? sinceMs : null,
      }),
      scope.canViewTeam ? listUsers() : Promise.resolve([]),
    ]);
    calls = scope.canViewTeam ? filterMappedQaCalls(rawCalls, users) : rawCalls;
  } catch (err) {
    if (isFirestoreQuotaError(err)) {
      return <QuotaNotice detail={err instanceof Error ? err.message : undefined} />;
    }
    throw err;
  }

  const heatmap = scope.canViewTeam ? buildIssueHeatmap(calls) : null;

  return (
    <Suspense fallback={<div className="p-8 text-ink-soft">Loading…</div>}>
      <Dashboard
        calls={calls}
        isAdmin={scope.isAdmin}
        canViewTeam={scope.canViewTeam}
        heatmap={heatmap}
        heatmapDays={heatmapDays}
      />
    </Suspense>
  );
}
