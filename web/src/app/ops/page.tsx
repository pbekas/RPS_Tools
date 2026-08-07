import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { isFirestoreQuotaError, listCallLogs } from "@/lib/firestore";
import { CallOps } from "@/components/CallOps";
import { QuotaNotice } from "@/components/QuotaNotice";

type Props = {
  searchParams?: Promise<{ days?: string }> | { days?: string };
};

export default async function OpsPage({ searchParams }: Props) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  if ((session.user.role || "").toLowerCase() !== "admin") redirect("/");

  const params = await Promise.resolve(searchParams || {});
  const daysRaw = Number(params.days || "7");
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 90) : 7;

  let logs;
  try {
    logs = await listCallLogs({ limit: 400, days });
  } catch (err) {
    if (isFirestoreQuotaError(err)) {
      return <QuotaNotice detail={err instanceof Error ? err.message : undefined} />;
    }
    throw err;
  }

  return <CallOps logs={logs} days={days} />;
}
