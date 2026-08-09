import { notFound } from "next/navigation";
import { requireModule } from "@/lib/requireAccess";
import {
  getContract,
  listContractGroups,
  listVendors,
} from "@/lib/contractsDb";
import { resolveObjectUrl } from "@/lib/s3";
import { ContractDetail } from "@/components/ContractDetail";

type Ctx = { params: Promise<{ id: string }> };

export default async function ContractDetailPage({ params }: Ctx) {
  await requireModule("contracts");
  const { id } = await params;
  const contract = await getContract(id);
  if (!contract) notFound();

  const [documentUrl, groups, vendors] = await Promise.all([
    resolveObjectUrl({ s3Uri: contract.s3_uri, s3Key: contract.s3_key }),
    listContractGroups(),
    listVendors({ activeOnly: false }),
  ]);

  return (
    <ContractDetail
      initialContract={contract}
      documentUrl={documentUrl}
      groups={groups}
      vendors={vendors}
    />
  );
}
