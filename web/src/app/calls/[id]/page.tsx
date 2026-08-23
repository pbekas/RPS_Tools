import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getCall, listUsers } from "@/lib/database";
import { isMappedAgentUser } from "@/lib/qa";
import { resolveRecordingUrl } from "@/lib/s3";
import { CallReview } from "@/components/CallReview";
import { canViewCallAgent, resolveCallQaScope } from "@/lib/orgTeamAccess";

export default async function CallPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");

  const { id } = await params;
  const call = await getCall(id);
  if (!call) notFound();

  const scope = await resolveCallQaScope(session.user);
  if (!canViewCallAgent(scope, call.agent_email)) {
    redirect("/");
  }

  const [recording_url, agents] = await Promise.all([
    resolveRecordingUrl(call),
    scope.isAdmin
      ? listUsers().then((rows) => rows.filter(isMappedAgentUser))
      : Promise.resolve([]),
  ]);

  return (
    <CallReview
      call={{ ...call, recording_url }}
      isAdmin={scope.isAdmin}
      agents={agents}
    />
  );
}
