import { requireModule } from "@/lib/requireAccess";
import { ContractUploadDropzone } from "@/components/ContractUploadDropzone";

export default async function ContractsUploadPage() {
  await requireModule("contracts");
  return <ContractUploadDropzone />;
}
