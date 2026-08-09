import { requireModule } from "@/lib/requireAccess";
import {
  listContractEntities,
  listContractGroups,
  listContracts,
  listVendors,
} from "@/lib/contractsDb";
import { ContractsLibrary } from "@/components/ContractsLibrary";

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModule("contracts");
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : undefined;
  const groupId = typeof params.groupId === "string" ? params.groupId : undefined;
  const vendorId = typeof params.vendorId === "string" ? params.vendorId : undefined;
  const entityId = typeof params.entityId === "string" ? params.entityId : undefined;
  const status = typeof params.status === "string" ? params.status : undefined;
  const expiringSoon = params.expiringSoon === "1";
  const needsReview = params.needsReview === "1";

  const [{ contracts, total }, groups, vendors, entities] = await Promise.all([
    listContracts({
      q,
      groupId,
      vendorId,
      entityId,
      status,
      expiringSoon,
      needsReview,
      limit: 100,
    }),
    listContractGroups(),
    listVendors({ activeOnly: false }),
    listContractEntities({ activeOnly: true }),
  ]);

  return (
    <ContractsLibrary
      initialContracts={contracts}
      initialTotal={total}
      groups={groups}
      vendors={vendors}
      entities={entities}
    />
  );
}
