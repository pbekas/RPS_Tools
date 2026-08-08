import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { isFirestoreQuotaError } from "@/lib/database";
import { CallReporting } from "@/components/CallReporting";
import { QuotaNotice } from "@/components/QuotaNotice";
import { loadOpsWindowData, parseDaysParam } from "@/lib/opsWindow";

type Props = {
  searchParams?: Promise<{ days?: string }> | { days?: string };
};

export default async function ReportingPage({ searchParams }: Props) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  if ((session.user.role || "").toLowerCase() !== "admin") redirect("/");

  const params = await Promise.resolve(searchParams || {});
  const days = parseDaysParam(params.days);

  try {
    const data = await loadOpsWindowData(days);
    return (
      <CallReporting
        logs={data.logs}
        days={data.days}
        scorecardRows={data.scorecardRows}
        scorecardTeam={data.scorecardTeam}
        coachingQueue={data.coachingQueue}
        qaAnswerSecondsByCallId={data.qaAnswerSecondsByCallId}
      />
    );
  } catch (err) {
    if (isFirestoreQuotaError(err)) {
      return <QuotaNotice detail={err instanceof Error ? err.message : undefined} />;
    }
    throw err;
  }
}
