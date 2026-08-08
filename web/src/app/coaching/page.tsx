import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import {
  getUser,
  listCalls,
  listMetricsForAgent,
  listUsers,
  upsertUser,
  isFirestoreQuotaError,
} from "@/lib/database";
import { pickReviewSampleIds } from "@/lib/coachingQueue";
import { CoachingPanel } from "@/components/CoachingPanel";
import { QuotaNotice } from "@/components/QuotaNotice";

type Props = {
  searchParams?: Promise<{ agent?: string }> | { agent?: string };
};

export default async function CoachingPage({ searchParams }: Props) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  const email = session.user.email.toLowerCase();
  const isAdmin = (session.user.role || "").toLowerCase() === "admin";
  const params = await Promise.resolve(searchParams || {});
  const requestedAgent = (params.agent || "").trim().toLowerCase();

  try {
    let user = await getUser(email);
    if (!user) {
      user = await upsertUser({
        email,
        name: session.user.name || email,
        role: session.user.role || "Agent",
      });
    }

    const agents = isAdmin
      ? (await listUsers())
          .filter((u) => (u.role || "").toLowerCase() !== "admin")
          .map((u) => ({ email: u.email, name: u.name }))
      : [];

    let focusEmail = email;
    if (isAdmin && requestedAgent) {
      const match = agents.find((a) => a.email.toLowerCase() === requestedAgent);
      if (match) {
        const focusUser = await getUser(match.email);
        if (focusUser) {
          user = focusUser;
          focusEmail = match.email;
        }
      }
    }

    const [metrics, focusCalls] = await Promise.all([
      listMetricsForAgent(focusEmail, 8),
      listCalls({
        agentEmail: focusEmail,
        status: "complete",
        limit: 40,
        requireMinDuration: true,
      }),
    ]);
    const sampleCallIds = pickReviewSampleIds(focusCalls, 3);

    return (
      <CoachingPanel
        isAdmin={isAdmin}
        initialUser={user}
        initialMetrics={metrics}
        agents={agents}
        sampleCallIds={sampleCallIds}
      />
    );
  } catch (err) {
    if (isFirestoreQuotaError(err)) {
      return <QuotaNotice detail={err instanceof Error ? err.message : undefined} />;
    }
    throw err;
  }
}
