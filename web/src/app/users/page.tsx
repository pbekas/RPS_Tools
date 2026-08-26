import { requireTeamManager } from "@/lib/requireAccess";
import { listUsers } from "@/lib/database";
import { listContractGroups } from "@/lib/contractsDb";
import { accessGrantCaps } from "@/lib/contractAccess";
import { AgentSettings } from "@/components/AgentSettings";
import { canViewTimeClockUser } from "@/lib/timeClockAccess";

function isPostgres() {
  return (
    (process.env.DB_BACKEND || process.env.DB_BACKEND || "").trim().toLowerCase() ===
    "postgres"
  );
}

export default async function UsersAccessPage() {
  const { session, access } = await requireTeamManager();
  const postgres = isPostgres();
  const [allUsers, groups] = await Promise.all([
    listUsers(),
    postgres && access.isAdmin
      ? listContractGroups().catch(() => [])
      : Promise.resolve([]),
  ]);
  const users = access.isAdmin
    ? allUsers
    : allUsers.filter((user) => canViewTimeClockUser(access, user.email));
  const domain = process.env.ALLOWED_EMAIL_DOMAIN || "releviumpain.com";

  return (
    <AgentSettings
      initialUsers={users}
      domain={domain}
      contractGroups={groups}
      teamsEnabled={postgres}
      grantCaps={accessGrantCaps(session.user)}
      canEditPeople={access.isAdmin}
    />
  );
}
