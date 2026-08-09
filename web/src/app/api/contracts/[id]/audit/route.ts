import { NextResponse } from "next/server";
import { apiRequireModule } from "@/lib/requireAccess";
import { listResourceAudit } from "@/lib/accessAudit";
import { getContract } from "@/lib/contractsDb";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { error } = await apiRequireModule("contracts");
  if (error) return error;
  const { id } = await ctx.params;
  try {
    const contract = await getContract(id);
    if (!contract) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const events = await listResourceAudit({
      resourceType: "contract",
      resourceId: id,
      limit: 100,
    });
    return NextResponse.json({ events });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load audit trail" },
      { status: 500 }
    );
  }
}
