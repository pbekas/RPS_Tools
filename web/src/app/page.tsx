import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { authOptions } from "@/lib/auth";
import { listCalls } from "@/lib/firestore";
import { buildIssueHeatmap } from "@/lib/qa";
import { Dashboard } from "@/components/Dashboard";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  const role = (session.user.role || "Agent").toLowerCase();
  const isAdmin = role === "admin";
  const heatmapDays = 14;
  const sinceMs = Date.now() - heatmapDays * 24 * 60 * 60 * 1000;

  const calls = await listCalls({
    agentEmail: isAdmin ? null : session.user.email.toLowerCase(),
    status: "complete",
    limit: isAdmin ? 400 : 150,
    sinceMs: isAdmin ? sinceMs : null,
  });

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
