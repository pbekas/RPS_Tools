import { NextResponse } from "next/server";
import { apiRequireContracts } from "@/lib/requireAccess";
import { clientIpFromRequest, writeAccessAudit } from "@/lib/accessAudit";
import { getVendorDocument } from "@/lib/contractsDb";
import { resolveObjectUrl } from "@/lib/s3";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { session, access, error } = await apiRequireContracts();
  if (error) return error;
  if (!access?.canManageVendorFiles) {
    return NextResponse.json({ error: "No access to vendor files" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const document = await getVendorDocument(id);
  if (!document) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const url = await resolveObjectUrl({
    s3Uri: document.s3_uri,
    s3Key: document.s3_key,
    expiresIn: 60 * 5,
    downloadFilename: document.original_filename || document.title || "document.pdf",
  });
  if (!url) {
    return NextResponse.json({ error: "Document unavailable" }, { status: 404 });
  }
  await writeAccessAudit({
    actorEmail: session!.user!.email,
    action: "vendor.document_download",
    resourceType: "vendor",
    resourceId: document.vendor_id,
    sourceIp: clientIpFromRequest(req),
    metadata: { document_id: id, filename: document.original_filename || "" },
  });
  return NextResponse.redirect(url);
}
