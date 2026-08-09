import { NextResponse } from "next/server";
import { listResourceAudit } from "@/lib/accessAudit";
import { requireAgreement } from "@/lib/assertContractAgreement";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireAgreement(id);
  if (gate.error) return gate.error;
  try {
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
