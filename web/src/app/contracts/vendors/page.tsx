import { redirect } from "next/navigation";
import { contractAccessForUser, requireModule } from "@/lib/requireAccess";
import { listVendors } from "@/lib/contractsDb";
import { VendorsPanel } from "@/components/VendorsPanel";
import { defaultHrefForUser } from "@/lib/permissions";

export default async function VendorsPage() {
  const session = await requireModule("contracts");
  const access = await contractAccessForUser(session.user);
  if (!access.canOpenVendors) {
    redirect(defaultHrefForUser(session.user));
  }
  const vendors = await listVendors({ activeOnly: false });
  return (
    <VendorsPanel
      initialVendors={vendors}
      access={{
        canViewVendorContacts: access.canViewVendorContacts,
        canManageVendorFiles: access.canManageVendorFiles,
        canViewAgreements: access.canViewAgreements,
      }}
    />
  );
}
