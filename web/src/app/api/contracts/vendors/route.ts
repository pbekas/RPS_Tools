import { NextResponse } from "next/server";
import { apiRequireContracts } from "@/lib/requireAccess";
import {
  deleteVendor,
  deleteVendorContact,
  getVendor,
  mergeVendors,
  listContracts,
  listVendorContacts,
  listVendorDocuments,
  listVendors,
  upsertVendor,
  upsertVendorContact,
} from "@/lib/contractsDb";

export async function GET(req: Request) {
  const { access, error } = await apiRequireContracts();
  if (error) return error;
  if (!access?.canOpenVendors) {
    return NextResponse.json({ error: "No vendor access" }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (id) {
      const vendor = await getVendor(id);
      if (!vendor) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const contacts = access.canViewVendorContacts
        ? await listVendorContacts(id)
        : [];
      const documents = access.canManageVendorFiles
        ? await listVendorDocuments(id)
        : [];
      const contracts = access.canViewAgreements
        ? (
            await listContracts({
              vendorId: id,
              allowedGroupIds: access.allowedGroupIds,
              limit: 50,
            })
          ).contracts
        : [];
      return NextResponse.json({ vendor, contacts, documents, contracts });
    }
    const vendors = await listVendors({
      q: searchParams.get("q") || undefined,
      activeOnly: searchParams.get("all") !== "1",
    });
    return NextResponse.json({
      vendors,
      access: {
        canViewVendorContacts: access.canViewVendorContacts,
        canManageVendorFiles: access.canManageVendorFiles,
        canViewAgreements: access.canViewAgreements,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to list vendors" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const { access, error } = await apiRequireContracts();
  if (error) return error;
  if (!access?.canOpenVendors) {
    return NextResponse.json({ error: "No vendor access" }, { status: 403 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "upsert_vendor");

    if (action === "upsert_vendor") {
      const vendor = await upsertVendor({
        id: body.id ? String(body.id) : undefined,
        name: String(body.name || ""),
        notes: body.notes != null ? String(body.notes) : undefined,
        active: body.active != null ? !!body.active : undefined,
      });
      return NextResponse.json({ ok: true, vendor });
    }

    if (action === "upsert_contact") {
      if (!access.canViewVendorContacts) {
        return NextResponse.json({ error: "No access to contacts" }, { status: 403 });
      }
      const contact = await upsertVendorContact({
        id: body.id ? String(body.id) : undefined,
        vendor_id: String(body.vendor_id || ""),
        name: String(body.name || ""),
        email: body.email != null ? String(body.email) : undefined,
        phone: body.phone != null ? String(body.phone) : undefined,
        title: body.title != null ? String(body.title) : undefined,
        is_primary: body.is_primary != null ? !!body.is_primary : undefined,
      });
      return NextResponse.json({ ok: true, contact });
    }

    if (action === "delete_contact") {
      if (!access.canViewVendorContacts) {
        return NextResponse.json({ error: "No access to contacts" }, { status: 403 });
      }
      await deleteVendorContact(String(body.id || ""));
      return NextResponse.json({ ok: true });
    }

    if (action === "delete_vendor") {
      await deleteVendor(String(body.id || ""));
      return NextResponse.json({ ok: true });
    }

    if (action === "merge_vendor") {
      const vendor = await mergeVendors(
        String(body.keep_id || body.id || ""),
        String(body.absorb_id || "")
      );
      return NextResponse.json({ ok: true, vendor });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Save failed" },
      { status: 400 }
    );
  }
}
