import { requireAdminSession } from "@/lib/requireAccess";
import { listUsers } from "@/lib/database";
import { listContractGroups } from "@/lib/contractsDb";
import { AgentSettings } from "@/components/AgentSettings";

function isPostgres() {
  return (
    (process.env.DB_BACKEND || process.env.DB_BACKEND || "").trim().toLowerCase() ===
    "postgres"
  );
}

export default async function UsersAccessPage() {
  await requireAdminSession();
  const postgres = isPostgres();
  const [users, groups] = await Promise.all([
    listUsers(),
    postgres ? listContractGroups().catch(() => []) : Promise.resolve([]),
  ]);
  const domain = process.env.ALLOWED_EMAIL_DOMAIN || "releviumpain.com";

  return (
    <AgentSettings
      initialUsers={users}
      domain={domain}
      contractGroups={groups}
      teamsEnabled={postgres}
    />
  );
}
