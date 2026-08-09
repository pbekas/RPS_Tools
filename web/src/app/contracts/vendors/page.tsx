import { requireModule } from "@/lib/requireAccess";
import { listVendors } from "@/lib/contractsDb";
import { VendorsPanel } from "@/components/VendorsPanel";

export default async function VendorsPage() {
  await requireModule("contracts");
  const vendors = await listVendors({ activeOnly: false });
  return <VendorsPanel initialVendors={vendors} />;
}
