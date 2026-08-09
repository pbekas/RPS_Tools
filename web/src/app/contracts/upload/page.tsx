import { redirect } from "next/navigation";
import { requireModule, contractAccessForUser } from "@/lib/requireAccess";
import { ContractUploadDropzone } from "@/components/ContractUploadDropzone";

export default async function ContractsUploadPage() {
  const session = await requireModule("contracts");
  const access = await contractAccessForUser(session.user);
  if (!access.canViewAgreements) redirect("/contracts/vendors");
  return <ContractUploadDropzone />;
}
