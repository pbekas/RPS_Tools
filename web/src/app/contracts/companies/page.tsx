import { requireAdminSession } from "@/lib/requireAccess";
import { listContractEntities } from "@/lib/contractsDb";
import { CompaniesPanel } from "@/components/CompaniesPanel";

export default async function CompaniesPage() {
  await requireAdminSession();
  const entities = await listContractEntities({ activeOnly: false });
  return <CompaniesPanel initialEntities={entities} />;
}
