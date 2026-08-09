import { NextResponse } from "next/server";
import { clientIpFromRequest, writeAccessAudit } from "@/lib/accessAudit";
import { requireAgreement } from "@/lib/assertContractAgreement";
import { resolveObjectUrl } from "@/lib/s3";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const gate = await requireAgreement(id);
  if (gate.error) return gate.error;
  const { session, contract } = gate;
  try {
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
