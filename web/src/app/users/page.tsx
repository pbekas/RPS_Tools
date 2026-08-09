import { requireAdminSession } from "@/lib/requireAccess";
import { discoverUnmappedAgents, listUsers } from "@/lib/database";
import { AgentSettings } from "@/components/AgentSettings";

export default async function UsersAccessPage() {
  await requireAdminSession();
  const [users, unmapped] = await Promise.all([
    listUsers(),
    discoverUnmappedAgents(),
  ]);
  const domain = process.env.ALLOWED_EMAIL_DOMAIN || "releviumpain.com";

  return (
    <AgentSettings
      initialUsers={users}
      initialUnmapped={unmapped}
      domain={domain}
    />
  );
}
