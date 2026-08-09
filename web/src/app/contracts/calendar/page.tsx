import { requireModule } from "@/lib/requireAccess";
import {
  listContractAssignees,
  listContractEntities,
  listContractObligations,
} from "@/lib/contractsDb";
import { ObligationsCalendar } from "@/components/ObligationsCalendar";

export default async function ContractsCalendarPage() {
  await requireModule("contracts");
  const today = new Date();
  const to = new Date(today);
  to.setUTCMonth(to.getUTCMonth() + 18);

  const [obligations, entities, assignees] = await Promise.all([
    listContractObligations({
      status: "open",
      to: to.toISOString().slice(0, 10),
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
