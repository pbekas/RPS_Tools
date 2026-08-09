import { NextResponse } from "next/server";
import { clientIpFromRequest, writeAccessAudit } from "@/lib/accessAudit";
import { requireAgreement } from "@/lib/assertContractAgreement";
import {
  diffContractFields,
  getContract,
  markContractForReprocess,
  softDeleteContract,
  updateContract,
} from "@/lib/contractsDb";
import { pollerJson, PollerError } from "@/lib/poller";
import { resolveObjectUrl } from "@/lib/s3";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireAgreement(id);
  if (gate.error) return gate.error;
  try {
    const contract = gate.contract;
    const documentUrl = await resolveObjectUrl({
      s3Uri: contract.s3_uri,
      s3Key: contract.s3_key,
    });
    return NextResponse.json({ contract, documentUrl });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load contract" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireAgreement(id);
  if (gate.error) return gate.error;
  const session = gate.session;
  try {
    const before = gate.contract;
    const body = await req.json().catch(() => ({}));
    const contract = await updateContract(id, body);
    const changes = diffContractFields(before, contract);
    if (Object.keys(changes).length) {
      await writeAccessAudit({
        actorEmail: session!.user!.email,
        action: "contract.update",
        resourceType: "contract",
        resourceId: id,
        sourceIp: clientIpFromRequest(req),
        metadata: { changes },
      });
    }
    return NextResponse.json({ ok: true, contract });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Update failed" },
      { status: 400 }
    );
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireAgreement(id);
  if (gate.error) return gate.error;
  const session = gate.session;
  try {
    await softDeleteContract(id);
    await writeAccessAudit({
      actorEmail: session!.user!.email,
      action: "contract.delete",
      resourceType: "contract",
      resourceId: id,
      sourceIp: clientIpFromRequest(req),
      metadata: {},
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Delete failed" },
      { status: 400 }
    );
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireAgreement(id);
  if (gate.error) return gate.error;
  const session = gate.session;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");

  try {
    if (action === "reprocess") {
      const contract = await markContractForReprocess(id);
      try {
        await pollerJson("/ops/contracts/process-pending", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ limit: 25 }),
        });
      } catch (err) {
        if (!(err instanceof PollerError)) throw err;
        // Contract is pending; poller may pick it up later.
      }
      await writeAccessAudit({
        actorEmail: session!.user!.email,
        action: "contract.reprocess",
        resourceType: "contract",
        resourceId: id,
        sourceIp: clientIpFromRequest(req),
        metadata: {},
      });
      return NextResponse.json({ ok: true, contract });
    }
    if (action === "accept") {
      const before = await getContract(id);
      const contract = await updateContract(id, { accept_review: true });
      await writeAccessAudit({
        actorEmail: session!.user!.email,
        action: "contract.accept",
        resourceType: "contract",
        resourceId: id,
        sourceIp: clientIpFromRequest(req),
        metadata: {
          changes: before ? diffContractFields(before, contract) : {},
        },
      });
      return NextResponse.json({ ok: true, contract });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Action failed" },
      { status: 400 }
    );
  }
}
