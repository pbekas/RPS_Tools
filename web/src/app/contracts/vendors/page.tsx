import { redirect } from "next/navigation";
import { contractAccessForUser, requireModule } from "@/lib/requireAccess";
import { listVendors } from "@/lib/contractsDb";
import { VendorsPanel } from "@/components/VendorsPanel";
import { defaultHrefForUser } from "@/lib/permissions";

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireModule("contracts");
  const access = await contractAccessForUser(session.user);
  if (!access.canOpenVendors) {
    redirect(defaultHrefForUser(session.user));
  }
  const params = await searchParams;
  const vendors = await listVendors({ activeOnly: false });
  return (
    <VendorsPanel
      initialVendors={vendors}
      initialSelectedId={typeof params.id === "string" ? params.id : undefined}
      initialQuery={typeof params.q === "string" ? params.q : ""}
      access={{
        canViewVendorContacts: access.canViewVendorContacts,
        canManageVendorFiles: access.canManageVendorFiles,
        canViewAgreements: access.canViewAgreements,
      }}
    />
  );
}
