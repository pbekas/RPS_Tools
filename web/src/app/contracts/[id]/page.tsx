import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { canAccessContractGroup } from "@/lib/contractAccess";
import { requireModule, contractAccessForUser } from "@/lib/requireAccess";
import { listResourceAudit, writeAccessAudit } from "@/lib/accessAudit";
import {
  getContract,
  listContractAssignees,
  listContractEntities,
  listContractGroups,
  listContractObligations,
  listFamilyMembers,
  listVendorSiblingContracts,
  listVendors,
} from "@/lib/contractsDb";
import { resolveObjectUrl } from "@/lib/s3";
import { ContractDetail } from "@/components/ContractDetail";

type Ctx = { params: Promise<{ id: string }> };

export default async function ContractDetailPage({ params }: Ctx) {
  const session = await requireModule("contracts");
  const access = await contractAccessForUser(session.user);
  const { id } = await params;
  const contract = await getContract(id);
  if (!contract) notFound();
  if (!access.canViewAgreements || !canAccessContractGroup(access, contract.group_slug)) {
    notFound();
  }

  const hdrs = await headers();
  const sourceIp =
    hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    hdrs.get("x-real-ip");
  await writeAccessAudit({
    actorEmail: session.user?.email,
    action: "contract.view",
    resourceType: "contract",
    resourceId: id,
    sourceIp,
    metadata: { via: "page" },
  });

  const [
    documentUrl,
    groups,
    vendors,
    entities,
    obligations,
    familyMembers,
    vendorSiblings,
    assignees,
    auditEvents,
  ] = await Promise.all([
    resolveObjectUrl({ s3Uri: contract.s3_uri, s3Key: contract.s3_key }),
    listContractGroups(),
    listVendors({ activeOnly: false }),
    listContractEntities({ activeOnly: true }),
    listContractObligations({ contractId: id, limit: 200 }),
    contract.family_id ? listFamilyMembers(contract.family_id) : Promise.resolve([]),
    listVendorSiblingContracts(contract.id, contract.vendor_id),
    listContractAssignees(),
    listResourceAudit({ resourceType: "contract", resourceId: id, limit: 80 }),
  ]);

  return (
    <ContractDetail
      initialContract={contract}
      documentUrl={documentUrl}
      groups={groups}
      vendors={vendors}
      entities={entities}
      obligations={obligations}
      familyMembers={familyMembers}
      vendorSiblings={vendorSiblings}
      assignees={assignees}
      auditEvents={auditEvents}
    />
  );
}
