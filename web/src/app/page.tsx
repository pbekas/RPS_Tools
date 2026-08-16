import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { authOptions } from "@/lib/auth";
import { isFirestoreQuotaError, listCalls, listUsers } from "@/lib/database";
import { buildIssueHeatmap, filterMappedQaCalls } from "@/lib/qa";
import { Dashboard } from "@/components/Dashboard";
import { QuotaNotice } from "@/components/QuotaNotice";
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

  const role = (session.user.role || "Agent").toLowerCase();
  const isAdmin = role === "admin";
  const heatmapDays = 14;
  const sinceMs = Date.now() - heatmapDays * 24 * 60 * 60 * 1000;

  let calls;
  try {
    const [rawCalls, users] = await Promise.all([
      listCalls({
        agentEmail: isAdmin ? null : session.user.email.toLowerCase(),
        status: "complete",
        limit: isAdmin ? 200 : 100,
        sinceMs: isAdmin ? sinceMs : null,
      }),
      isAdmin ? listUsers() : Promise.resolve([]),
    ]);
    calls = isAdmin ? filterMappedQaCalls(rawCalls, users) : rawCalls;
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
