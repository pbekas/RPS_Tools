import { listUsers } from "@/lib/database";
import { isMappedAgentUser } from "@/lib/qa";
import { SampleQueue } from "@/components/SampleQueue";
import { requireCallQaManager } from "@/lib/requireAccess";
import { canViewCallAgent } from "@/lib/orgTeamAccess";

export default async function QueuePage() {
  const { scope } = await requireCallQaManager();

  const users = await listUsers();
  const agents = users
    .filter(isMappedAgentUser)
    .filter((u) => canViewCallAgent(scope, u.email))
    .map((u) => ({
      email: u.email.toLowerCase(),
      name: u.name,
    }));

  return (
    <SampleQueue agents={agents} allowUnknown={scope.isAdmin} />
  );
}
