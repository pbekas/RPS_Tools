import { requireAdminSession } from "@/lib/requireAccess";
import { discoverUnmappedAgents, listUsers } from "@/lib/database";
import { listContractGroups } from "@/lib/contractsDb";
import { AgentSettings } from "@/components/AgentSettings";

export default async function UsersAccessPage() {
  await requireAdminSession();
  const [users, unmapped, groups] = await Promise.all([
    listUsers(),
    discoverUnmappedAgents(),
    process.env.DB_BACKEND?.trim().toLowerCase() === "postgres"
      ? listContractGroups().catch(() => [])
      : Promise.resolve([]),
  ]);
  const domain = process.env.ALLOWED_EMAIL_DOMAIN || "releviumpain.com";

  return (
    <AgentSettings
      initialUsers={users}
      initialUnmapped={unmapped}
      domain={domain}
      contractGroups={groups}
    />
  );
}
