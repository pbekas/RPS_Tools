import { NextResponse } from "next/server";
import { apiRequireAdmin, apiRequireModule } from "@/lib/requireAccess";
import {
  deleteContractEntity,
  listContractEntities,
  upsertContractEntity,
} from "@/lib/contractsDb";

export async function GET() {
  const { error } = await apiRequireModule("contracts");
  if (error) return error;
  try {
    const entities = await listContractEntities({ activeOnly: false });
    return NextResponse.json({ entities });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list companies" },
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
      await deleteContractEntity(String(body.id || ""));
      return NextResponse.json({ ok: true });
    }
    const aliases = Array.isArray(body.aliases)
      ? body.aliases.map((a: unknown) => String(a))
      : String(body.aliases || "")
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean);
    const entity = await upsertContractEntity({
      id: body.id ? String(body.id) : undefined,
      name: String(body.name || ""),
      slug: body.slug ? String(body.slug) : undefined,
      aliases,
      sort_order: body.sort_order != null ? Number(body.sort_order) : undefined,
      active: body.active != null ? !!body.active : undefined,
    });
    return NextResponse.json({ ok: true, entity });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Save failed" },
      { status: 400 }
    );
  }
}
