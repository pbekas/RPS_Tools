import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { authOptions } from "@/lib/auth";
import { isFirestoreQuotaError, listCalls, listUsers } from "@/lib/database";
import { buildIssueHeatmap, buildQaTeamRatings, filterMappedQaCalls } from "@/lib/qa";
import { Dashboard } from "@/components/Dashboard";
import { QuotaNotice } from "@/components/QuotaNotice";
import { canViewCallAgent, resolveCallQaScope } from "@/lib/orgTeamAccess";
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
  let teamRatings = null;
  try {
    const [rawCalls, users] = await Promise.all([
      listCalls({
        agentEmails: scope.agentEmails,
        status: "complete",
        limit: scope.canViewTeam ? 400 : 100,
        sinceMs: scope.canViewTeam ? sinceMs : null,
      }),
      scope.canViewTeam || scope.isManager
        ? listUsers()
        : Promise.resolve([]),
    ]);
    calls = scope.canViewTeam ? filterMappedQaCalls(rawCalls, users) : rawCalls;
    if (scope.canViewTeam) {
      const roster = scope.agentEmails
        ? users.filter((user) => canViewCallAgent(scope, user.email))
        : [];
      teamRatings = buildQaTeamRatings(calls, roster);
    }
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
        isAdmin={scope.isManager}
        canViewTeam={scope.canViewTeam}
        heatmap={heatmap}
        heatmapDays={heatmapDays}
        teamRatings={teamRatings}
      />
    </Suspense>
  );
}
