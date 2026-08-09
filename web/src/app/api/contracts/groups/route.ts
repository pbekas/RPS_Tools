import { NextResponse } from "next/server";
import { apiRequireAdmin, apiRequireModule } from "@/lib/requireAccess";
import {
  deleteContractGroup,
  listContractGroups,
  upsertContractGroup,
} from "@/lib/contractsDb";

export async function GET() {
  const { error } = await apiRequireModule("contracts");
  if (error) return error;
  try {
    const groups = await listContractGroups();
    return NextResponse.json({ groups });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list groups" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const { error } = await apiRequireAdmin();
  if (error) return error;
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "upsert");
    if (action === "delete") {
      await deleteContractGroup(String(body.id || ""));
      return NextResponse.json({ ok: true });
    }
    const group = await upsertContractGroup({
      id: body.id ? String(body.id) : undefined,
      name: String(body.name || ""),
      slug: body.slug ? String(body.slug) : undefined,
      sort_order: body.sort_order != null ? Number(body.sort_order) : undefined,
    });
    return NextResponse.json({ ok: true, group });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Save failed" },
      { status: 400 }
    );
  }
}
