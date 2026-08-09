import { NextResponse } from "next/server";
import { apiRequireModule } from "@/lib/requireAccess";
import { clientIpFromRequest, writeAccessAudit } from "@/lib/accessAudit";
import { getContract } from "@/lib/contractsDb";
import { resolveObjectUrl } from "@/lib/s3";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { session, error } = await apiRequireModule("contracts");
  if (error) return error;
  const { id } = await ctx.params;
  try {
    const contract = await getContract(id);
    if (!contract) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const url = await resolveObjectUrl({
      s3Uri: contract.s3_uri,
      s3Key: contract.s3_key,
      expiresIn: 60 * 5,
      downloadFilename:
        contract.original_filename || `${contract.title || "contract"}.pdf`,
    });
    if (!url) {
      return NextResponse.json({ error: "Document unavailable" }, { status: 404 });
    }
    await writeAccessAudit({
      actorEmail: session!.user!.email,
      action: "contract.download",
      resourceType: "contract",
      resourceId: id,
      sourceIp: clientIpFromRequest(req),
      metadata: {
        filename: contract.original_filename || "",
        title: contract.title || "",
      },
    });
    return NextResponse.redirect(url);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Download failed" },
      { status: 500 }
    );
  }
}
