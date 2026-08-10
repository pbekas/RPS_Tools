import { redirect } from "next/navigation";
import { canAccessContractGroup } from "@/lib/contractAccess";
import { requireModule, contractAccessForUser } from "@/lib/requireAccess";
import { getContract } from "@/lib/contractsDb";
import { ContractUploadDropzone } from "@/components/ContractUploadDropzone";

export default async function ContractsUploadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireModule("contracts");
  const access = await contractAccessForUser(session.user);
  if (!access.canViewAgreements) redirect("/contracts/vendors");
  const params = await searchParams;
  const renewFromId =
    typeof params.renewFrom === "string" ? params.renewFrom : undefined;
  let renewFrom: { id: string; title: string } | null = null;
  if (renewFromId) {
    const source = await getContract(renewFromId);
    if (
      source &&
      canAccessContractGroup(access, source.group_slug)
    ) {
      renewFrom = {
        id: source.id,
        title: source.title || source.original_filename || "Agreement",
      };
    }
  }
  return <ContractUploadDropzone renewFrom={renewFrom} />;
}
