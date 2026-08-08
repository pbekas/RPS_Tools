import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getCall, listUsers } from "@/lib/database";
import { resolveRecordingUrl } from "@/lib/s3";
import { CallReview } from "@/components/CallReview";

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

  const role = (session.user.role || "Agent").toLowerCase();
  const isAdmin = role === "admin";
  if (
    !isAdmin &&
    (call.agent_email || "").toLowerCase() !== session.user.email.toLowerCase()
  ) {
    redirect("/");
  }

  const [recording_url, agents] = await Promise.all([
    resolveRecordingUrl(call),
    isAdmin ? listUsers() : Promise.resolve([]),
  ]);

  return (
    <CallReview
      call={{ ...call, recording_url }}
      isAdmin={isAdmin}
      agents={agents}
    />
  );
}
