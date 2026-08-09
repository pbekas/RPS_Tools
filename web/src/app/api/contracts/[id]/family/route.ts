import { NextResponse } from "next/server";
import { requireAgreement } from "@/lib/assertContractAgreement";
import { clientIpFromRequest, writeAccessAudit } from "@/lib/accessAudit";
import {
  linkContractsIntoFamily,
  listFamilyMembers,
  renameContractFamily,
  searchContractsForLink,
  unlinkContractFromFamily,
  updateContractFamilyRole,
  getContract,
} from "@/lib/contractsDb";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireAgreement(id);
  if (gate.error) return gate.error;
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") || "";
    if (q) {
      const matches = await searchContractsForLink(q, id);
      return NextResponse.json({ matches });
    }
    const contract = await getContract(id);
    if (!contract) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const members = contract.family_id
      ? await listFamilyMembers(contract.family_id)
      : [];
    return NextResponse.json({ contract, members });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load family" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireAgreement(id);
  if (gate.error) return gate.error;
  const session = gate.session;
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    if (action === "link") {
      const otherId = String(body.other_id || "");
      if (!otherId) {
        return NextResponse.json({ error: "other_id required" }, { status: 400 });
      }
      const result = await linkContractsIntoFamily({
        contractId: id,
        otherContractId: otherId,
        thisRole: body.this_role ? String(body.this_role) : undefined,
        otherRole: body.other_role ? String(body.other_role) : undefined,
        familyName: body.family_name ? String(body.family_name) : undefined,
      });
      await writeAccessAudit({
        actorEmail: session!.user!.email,
        action: "contract.family_link",
        resourceType: "contract",
        resourceId: id,
        sourceIp: clientIpFromRequest(req),
        metadata: {
          other_id: otherId,
          family_id: result.family.id,
          family_name: result.family.name,
        },
      });
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "unlink") {
      const contract = await unlinkContractFromFamily(id);
      await writeAccessAudit({
        actorEmail: session!.user!.email,
        action: "contract.family_unlink",
        resourceType: "contract",
        resourceId: id,
        sourceIp: clientIpFromRequest(req),
        metadata: {},
      });
      return NextResponse.json({ ok: true, contract, members: [] });
    }
    if (action === "set_role") {
      const contract = await updateContractFamilyRole(id, String(body.family_role || ""));
      await writeAccessAudit({
        actorEmail: session!.user!.email,
        action: "contract.update",
        resourceType: "contract",
        resourceId: id,
        sourceIp: clientIpFromRequest(req),
        metadata: { changes: { family_role: { to: contract.family_role } } },
      });
      const members = contract.family_id
        ? await listFamilyMembers(contract.family_id)
        : [];
      return NextResponse.json({ ok: true, contract, members });
    }
    if (action === "rename") {
      const contract = await getContract(id);
      if (!contract?.family_id) {
        return NextResponse.json({ error: "Not in a family" }, { status: 400 });
      }
      const family = await renameContractFamily(
        contract.family_id,
        String(body.name || "")
      );
      return NextResponse.json({
        ok: true,
        family,
        members: await listFamilyMembers(family.id),
      });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Family update failed" },
      { status: 400 }
    );
  }
}
