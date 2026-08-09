import { NextResponse } from "next/server";
import { apiRequireModule } from "@/lib/requireAccess";
import { acceptContractsReview, listContracts } from "@/lib/contractsDb";

export async function GET(req: Request) {
  const { error } = await apiRequireModule("contracts");
  if (error) return error;

  try {
    const { searchParams } = new URL(req.url);
    const result = await listContracts({
      q: searchParams.get("q") || undefined,
      groupId: searchParams.get("groupId") || undefined,
      vendorId: searchParams.get("vendorId") || undefined,
      status: searchParams.get("status") || undefined,
      expiringSoon: searchParams.get("expiringSoon") === "1",
      needsReview: searchParams.get("needsReview") === "1",
      limit: Number(searchParams.get("limit") || 100),
      offset: Number(searchParams.get("offset") || 0),
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list contracts" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const { error } = await apiRequireModule("contracts");
  if (error) return error;
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    if (action === "accept_all") {
      const count = await acceptContractsReview(
        Array.isArray(body.ids) ? body.ids.map(String) : undefined
      );
      return NextResponse.json({ ok: true, count });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Action failed" },
      { status: 400 }
    );
  }
}
