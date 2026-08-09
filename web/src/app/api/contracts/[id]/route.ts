import { NextResponse } from "next/server";
import { apiRequireModule } from "@/lib/requireAccess";
import {
  getContract,
  markContractForReprocess,
  softDeleteContract,
  updateContract,
} from "@/lib/contractsDb";
import { pollerJson, PollerError } from "@/lib/poller";
import { resolveObjectUrl } from "@/lib/s3";

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
  const { error } = await apiRequireModule("contracts");
  if (error) return error;
  const { id } = await ctx.params;
  try {
    const body = await req.json().catch(() => ({}));
    const contract = await updateContract(id, body);
    return NextResponse.json({ ok: true, contract });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Update failed" },
      { status: 400 }
    );
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { error } = await apiRequireModule("contracts");
  if (error) return error;
  const { id } = await ctx.params;
  try {
    await softDeleteContract(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Delete failed" },
      { status: 400 }
    );
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { error } = await apiRequireModule("contracts");
  if (error) return error;
  const { id } = await ctx.params;
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
      return NextResponse.json({ ok: true, contract });
    }
    if (action === "accept") {
      const contract = await updateContract(id, { accept_review: true });
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
