import { redirect } from "next/navigation";
import { isFirestoreQuotaError } from "@/lib/database";
import { CallReporting } from "@/components/CallReporting";
import { QuotaNotice } from "@/components/QuotaNotice";
import { loadOpsWindowData, parseDaysParam } from "@/lib/opsWindow";
import { isAdminRole } from "@/lib/permissions";
import { requireModule } from "@/lib/requireAccess";

type Props = {
  searchParams?: Promise<{ days?: string }> | { days?: string };
};

export default async function ReportingPage({ searchParams }: Props) {
  const session = await requireModule("call_qa");
  if (!isAdminRole(session.user.role)) redirect("/");

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
