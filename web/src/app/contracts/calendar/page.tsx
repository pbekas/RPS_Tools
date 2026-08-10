import { redirect } from "next/navigation";
import { requireModule, contractAccessForUser } from "@/lib/requireAccess";
import {
  listContractAssignees,
  listContractEntities,
  listContractObligations,
} from "@/lib/contractsDb";
import { ObligationsCalendar } from "@/components/ObligationsCalendar";

export default async function ContractsCalendarPage() {
  const session = await requireModule("contracts");
  const access = await contractAccessForUser(session.user);
  if (!access.canViewAgreements) redirect("/contracts/vendors");
  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 90);
  const to = new Date(today);
  to.setUTCMonth(to.getUTCMonth() + 18);

  const [obligations, entities, assignees] = await Promise.all([
    listContractObligations({
      status: "open",
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      allowedGroupIds: access.allowedGroupIds,
      limit: 400,
    }),
    listContractEntities({ activeOnly: true }),
    listContractAssignees(),
  ]);

  return (
    <ObligationsCalendar
      initialObligations={obligations}
      entities={entities}
      assignees={assignees}
    />
  );
}
