import { requireAdminSession } from "@/lib/requireAccess";
import { listContractGroups } from "@/lib/contractsDb";
import { GroupsPanel } from "@/components/GroupsPanel";

export default async function GroupsPage() {
  await requireAdminSession();
  // Groups management is admin-only within the Contracts module.
  const groups = await listContractGroups();
  return <GroupsPanel initialGroups={groups} />;
}
