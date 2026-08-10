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
  const q = typeof params.q === "string" ? params.q : "";
  const groupId = typeof params.groupId === "string" ? params.groupId : "";
  const vendorId = typeof params.vendorId === "string" ? params.vendorId : "";
  const entityId = typeof params.entityId === "string" ? params.entityId : "";
  const status = typeof params.status === "string" ? params.status : "";
  const expiringSoon = params.expiringSoon === "1";
  const needsReview = params.needsReview === "1";
  const sort = typeof params.sort === "string" ? params.sort : "";
  const dir = params.dir === "asc" || params.dir === "desc" ? params.dir : "";
  const pageSize = 50;
  const page = Math.max(1, Number(params.page || 1) || 1);

  const [{ contracts, total }, groups, vendors, entities] = await Promise.all([
    listContracts({
      q: q || undefined,
      groupId: groupId || undefined,
      vendorId: vendorId || undefined,
      entityId: entityId || undefined,
      status: status || undefined,
      expiringSoon,
      needsReview,
      allowedGroupIds: access.allowedGroupIds,
      sort: sort || undefined,
      dir: dir || undefined,
      limit: pageSize,
      offset: (page - 1) * pageSize,
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
      pageSize={pageSize}
      initialFilters={{
        q,
        groupId,
        vendorId,
        entityId,
        status,
        expiringSoon,
        needsReview,
        sort,
        dir: dir || "desc",
        page,
      }}
      groups={visibleGroups}
      vendors={vendors}
      entities={entities}
    />
  );
}
