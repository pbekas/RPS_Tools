import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { authOptions } from "@/lib/auth";
import { isFirestoreQuotaError, listCalls } from "@/lib/firestore";
import { buildIssueHeatmap } from "@/lib/qa";
import { Dashboard } from "@/components/Dashboard";
import { QuotaNotice } from "@/components/QuotaNotice";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  const role = (session.user.role || "Agent").toLowerCase();
  const isAdmin = role === "admin";
  const heatmapDays = 14;
  const sinceMs = Date.now() - heatmapDays * 24 * 60 * 60 * 1000;

  let calls;
  try {
    calls = await listCalls({
      agentEmail: isAdmin ? null : session.user.email.toLowerCase(),
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
