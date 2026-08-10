import { NextResponse } from "next/server";
import { apiRequireContracts } from "@/lib/requireAccess";
import { listContracts, listVendors } from "@/lib/contractsDb";

export async function GET(req: Request) {
  const { access, error } = await apiRequireContracts();
  if (error) return error;
  if (!access?.canOpenVendors && !access?.canViewAgreements) {
    return NextResponse.json({ error: "No access" }, { status: 403 });
  }

  const q = new URL(req.url).searchParams.get("q")?.trim() || "";
  if (q.length < 2) {
    return NextResponse.json({ contracts: [], vendors: [], q });
  }

  try {
    const [contractsResult, vendors] = await Promise.all([
      access.canViewAgreements
        ? listContracts({
            q,
            allowedGroupIds: access.allowedGroupIds,
            limit: 8,
            offset: 0,
          })
        : Promise.resolve({ contracts: [], total: 0 }),
      access.canOpenVendors
        ? listVendors({ q, activeOnly: false })
        : Promise.resolve([]),
    ]);
    return NextResponse.json({
      q,
      contracts: contractsResult.contracts,
      contractTotal: contractsResult.total,
      vendors: vendors.slice(0, 6),
      vendorTotal: vendors.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Search failed" },
      { status: 500 }
    );
  }
}
