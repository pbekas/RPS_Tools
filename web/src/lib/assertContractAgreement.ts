import { NextResponse } from "next/server";
import { canAccessContractGroup } from "@/lib/contractAccess";
import { getContract, type Contract } from "@/lib/contractsDb";
import { apiRequireContracts } from "@/lib/requireAccess";

export async function requireAgreement(contractId: string): Promise<
  | {
      error: NextResponse;
      session?: undefined;
      access?: undefined;
      contract?: undefined;
    }
  | {
      error: null;
      session: NonNullable<Awaited<ReturnType<typeof apiRequireContracts>>["session"]>;
      access: NonNullable<Awaited<ReturnType<typeof apiRequireContracts>>["access"]>;
      contract: Contract;
    }
> {
  const auth = await apiRequireContracts();
  if (auth.error || !auth.session || !auth.access) {
    return {
      error:
        auth.error ||
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (!auth.access.canViewAgreements) {
    return {
      error: NextResponse.json({ error: "No access to agreements" }, { status: 403 }),
    };
  }
  const contract = await getContract(contractId);
  if (!contract) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  if (!canAccessContractGroup(auth.access, contract.group_slug)) {
    return {
      error: NextResponse.json(
        { error: "No access to this agreement type" },
        { status: 403 }
      ),
    };
  }
  return { error: null, session: auth.session, access: auth.access, contract };
}
