import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { apiRequireContracts } from "@/lib/requireAccess";
import { clientIpFromRequest, writeAccessAudit } from "@/lib/accessAudit";
import {
  createVendorDocument,
  deleteVendorDocument,
  getVendor,
  getVendorDocument,
  listVendorDocuments,
} from "@/lib/contractsDb";
import { uploadContractObject } from "@/lib/s3";

const MAX_BYTES = 20 * 1024 * 1024;

export async function GET(req: Request) {
  const { access, error } = await apiRequireContracts();
  if (error) return error;
  if (!access?.canManageVendorFiles) {
    return NextResponse.json({ error: "No access to vendor files" }, { status: 403 });
  }
  const vendorId = new URL(req.url).searchParams.get("vendorId") || "";
  if (!vendorId) {
    return NextResponse.json({ error: "vendorId required" }, { status: 400 });
  }
  const documents = await listVendorDocuments(vendorId);
  return NextResponse.json({ documents });
}

export async function POST(req: Request) {
  const { session, access, error } = await apiRequireContracts();
  if (error) return error;
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    if (String(body.action || "") !== "delete") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    if (!access?.canManageVendorFiles) {
      return NextResponse.json({ error: "No access to vendor files" }, { status: 403 });
    }
    const id = String(body.id || "");
    const existing = await getVendorDocument(id);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await deleteVendorDocument(id);
    await writeAccessAudit({
      actorEmail: session!.user!.email,
      action: "vendor.document_delete",
      resourceType: "vendor",
      resourceId: existing.vendor_id,
      sourceIp: clientIpFromRequest(req),
      metadata: { document_id: id, filename: existing.original_filename },
    });
    return NextResponse.json({ ok: true });
  }

  if (!access?.canManageVendorFiles) {
    return NextResponse.json({ error: "No access to vendor files" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Could not read upload" }, { status: 400 });
  }
  const vendorId = String(form.get("vendor_id") || "");
  const vendor = await getVendor(vendorId);
  if (!vendor) return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
  const file = form.get("file");
  if (!(typeof File !== "undefined" && file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds 20MB limit" }, { status: 400 });
  }
  const filename = file.name || "document.pdf";
  const id = randomUUID();
  const safeName = filename.replace(/[^\w.\- ()]+/g, "_");
  const key = `vendors/${vendorId}/${id}/${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const uploaded = await uploadContractObject({
    key,
    body: buffer,
    contentType: file.type || "application/pdf",
  });
  const document = await createVendorDocument({
    vendor_id: vendorId,
    doc_kind: String(form.get("doc_kind") || "other"),
    title: String(form.get("title") || ""),
    s3_key: uploaded.key,
    s3_uri: uploaded.uri,
    original_filename: filename,
    content_type: file.type || "application/pdf",
    byte_size: file.size,
    uploaded_by: session!.user!.email,
  });
  await writeAccessAudit({
    actorEmail: session!.user!.email,
    action: "vendor.document_upload",
    resourceType: "vendor",
    resourceId: vendorId,
    sourceIp: clientIpFromRequest(req),
    metadata: { document_id: document.id, filename, kind: document.doc_kind },
  });
  return NextResponse.json({ ok: true, document });
}
