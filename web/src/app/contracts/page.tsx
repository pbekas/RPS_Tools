import { redirect } from "next/navigation";
import { requireModule, contractAccessForUser } from "@/lib/requireAccess";
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
  const session = await requireModule("contracts");
  const access = await contractAccessForUser(session.user);
  if (!access.canViewAgreements) redirect("/contracts/vendors");
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
      allowedGroupIds: access.allowedGroupIds,
      limit: 100,
    }),
    listContractGroups(),
    listVendors({ activeOnly: false }),
    listContractEntities({ activeOnly: true }),
  ]);
  const visibleGroups = access.allGroups
    ? groups
    : groups.filter((g) => access.groupSlugs.includes(g.slug));

  return (
    <ContractsLibrary
      initialContracts={contracts}
      initialTotal={total}
      groups={visibleGroups}
      vendors={vendors}
      entities={entities}
    />
  );
}
