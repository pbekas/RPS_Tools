import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import {
  getUser,
  listMetricsForAgent,
  listUsers,
  upsertUser,
  isFirestoreQuotaError,
} from "@/lib/database";
import { CoachingPanel } from "@/components/CoachingPanel";
import { QuotaNotice } from "@/components/QuotaNotice";

export default async function CoachingPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  const email = session.user.email.toLowerCase();
  const isAdmin = (session.user.role || "").toLowerCase() === "admin";

  try {
    let user = await getUser(email);
    if (!user) {
      user = await upsertUser({
        email,
        name: session.user.name || email,
        role: session.user.role || "Agent",
      });
    }
    const metrics = await listMetricsForAgent(email, 8);
    const agents = isAdmin
      ? (await listUsers())
          .filter((u) => (u.role || "").toLowerCase() !== "admin")
          .map((u) => ({ email: u.email, name: u.name }))
      : [];

    return (
      <CoachingPanel
        isAdmin={isAdmin}
        initialUser={user}
        initialMetrics={metrics}
        agents={agents}
      />
    );
  } catch (err) {
    if (isFirestoreQuotaError(err)) {
      return <QuotaNotice detail={err instanceof Error ? err.message : undefined} />;
    }
    throw err;
  }
}
