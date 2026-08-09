import { NextResponse } from "next/server";
import { canAccessContractGroup } from "@/lib/contractAccess";
import { apiRequireContracts } from "@/lib/requireAccess";
import { clientIpFromRequest, writeAccessAudit } from "@/lib/accessAudit";
import {
  deleteContractObligation,
  getContract,
  listContractObligations,
  upsertContractObligation,
} from "@/lib/contractsDb";

export async function GET(req: Request) {
  const { access, error } = await apiRequireContracts();
  if (error) return error;
  if (!access?.canViewAgreements) {
    return NextResponse.json({ obligations: [] });
  }
  try {
    const { searchParams } = new URL(req.url);
    const obligations = await listContractObligations({
      contractId: searchParams.get("contractId") || undefined,
      kind: searchParams.get("kind") || undefined,
      entityId: searchParams.get("entityId") || undefined,
      ownerEmail: searchParams.get("ownerEmail") || undefined,
      status: (searchParams.get("status") || undefined) as
        | "open"
        | "done"
        | "dismissed"
        | "snoozed"
        | "overdue"
        | "upcoming"
        | undefined,
      from: searchParams.get("from") || undefined,
      to: searchParams.get("to") || undefined,
      allowedGroupIds: access.allowedGroupIds,
      limit: Number(searchParams.get("limit") || 250),
    });
    return NextResponse.json({ obligations });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list obligations" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const { session, access, error } = await apiRequireContracts();
  if (error) return error;
  if (!access?.canViewAgreements) {
    return NextResponse.json({ error: "No access to agreements" }, { status: 403 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "upsert");
    if (action === "delete") {
      const id = String(body.id || "");
      const contractId = String(body.contract_id || "");
      if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
      await deleteContractObligation(id, contractId || undefined);
      await writeAccessAudit({
        actorEmail: session!.user!.email,
        action: "contract.obligation_delete",
        resourceType: "contract",
        resourceId: contractId || id,
        sourceIp: clientIpFromRequest(req),
        metadata: { obligation_id: id },
      });
      return NextResponse.json({ ok: true });
    }

    const contractId = String(body.contract_id || "");
    if (!contractId) {
      return NextResponse.json({ error: "contract_id required" }, { status: 400 });
    }
    const contract = await getContract(contractId);
    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }
    if (!canAccessContractGroup(access, contract.group_slug)) {
      return NextResponse.json({ error: "No access to this agreement type" }, { status: 403 });
    }
    const obligation = await upsertContractObligation({
      id: body.id ? String(body.id) : undefined,
      contract_id: contractId,
      kind: String(body.kind || "other"),
      title: body.title != null ? String(body.title) : undefined,
      due_date: body.due_date ?? null,
      owner_email: body.owner_email ?? null,
      status: body.status != null ? String(body.status) : undefined,
      notes: body.notes != null ? String(body.notes) : undefined,
      source: "manual",
    });
    await writeAccessAudit({
      actorEmail: session!.user!.email,
      action: "contract.obligation_upsert",
      resourceType: "contract",
      resourceId: contractId,
      sourceIp: clientIpFromRequest(req),
      metadata: {
        obligation_id: obligation.id,
        kind: obligation.kind,
        due_date: obligation.due_date,
        status: obligation.status,
        owner_email: obligation.owner_email,
      },
    });
    return NextResponse.json({ ok: true, obligation });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Obligation update failed" },
      { status: 400 }
    );
  }
}
