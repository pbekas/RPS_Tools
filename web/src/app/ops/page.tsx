import { redirect } from "next/navigation";
import { isFirestoreQuotaError } from "@/lib/database";
import { CallOps } from "@/components/CallOps";
import { QuotaNotice } from "@/components/QuotaNotice";
import { loadOpsWindowData, parseDaysParam } from "@/lib/opsWindow";
import { isAdminRole } from "@/lib/permissions";
import { requireModule } from "@/lib/requireAccess";

type Props = {
  searchParams?:
    | Promise<{ days?: string; person?: string; missed?: string }>
    | { days?: string; person?: string; missed?: string };
};

export default async function OpsPage({ searchParams }: Props) {
  const session = await requireModule("call_qa");
  if (!isAdminRole(session.user.role)) redirect("/");

  const params = await Promise.resolve(searchParams || {});
  const days = parseDaysParam(params.days);
  const initialPerson = (params.person || "").trim();
  const missedRaw = (params.missed || "").trim().toLowerCase();
  const initialMissed =
    missedRaw === "1" || missedRaw === "true" || missedRaw === "yes";

  try {
    const data = await loadOpsWindowData(days);
    return (
      <CallOps
        logs={data.logs}
        days={data.days}
        initialPerson={initialPerson}
        initialMissed={initialMissed}
      />
    );
  } catch (err) {
    if (isFirestoreQuotaError(err)) {
      return <QuotaNotice detail={err instanceof Error ? err.message : undefined} />;
    }
    throw err;
  }
}
