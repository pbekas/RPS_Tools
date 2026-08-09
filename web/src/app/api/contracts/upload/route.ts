import { NextResponse } from "next/server";
import { apiRequireModule } from "@/lib/requireAccess";
import { clientIpFromRequest, writeAccessAudit } from "@/lib/accessAudit";
import { createContractUpload } from "@/lib/contractsDb";
import { uploadContractObject } from "@/lib/s3";
import { pollerJson, PollerError } from "@/lib/poller";
import { randomUUID } from "crypto";

const MAX_BYTES = 40 * 1024 * 1024;
const ALLOWED = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/tiff",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function guessContentType(filename: string, provided: string): string {
  if (provided && provided !== "application/octet-stream") return provided;
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "image/tiff";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  return provided || "application/pdf";
}

export async function POST(req: Request) {
  const { session, error } = await apiRequireModule("contracts");
  if (error) return error;

  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch (parseErr) {
      const hint =
        parseErr instanceof Error ? parseErr.message : "Failed to parse body as FormData";
      return NextResponse.json(
        {
          error:
            hint.includes("FormData") || hint.includes("parse")
              ? "Could not read the upload. Try one PDF at a time (max 40MB)."
              : hint,
        },
        { status: 400 }
      );
    }
    const files = form
      .getAll("files")
      .concat(form.getAll("file"))
      .filter((f): f is File => typeof File !== "undefined" && f instanceof File);
    if (!files.length) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const created = [];
    const failures: Array<{ filename: string; error: string }> = [];

    for (const file of files) {
      const filename = file.name || "contract.pdf";
      try {
        if (file.size > MAX_BYTES) {
          throw new Error(`File exceeds ${MAX_BYTES / (1024 * 1024)}MB limit`);
        }
        const contentType = guessContentType(filename, file.type || "");
        if (!ALLOWED.has(contentType) && !filename.toLowerCase().endsWith(".pdf")) {
          throw new Error(`Unsupported file type: ${contentType || "unknown"}`);
        }
        const id = randomUUID();
        const safeName = filename.replace(/[^\w.\- ()]+/g, "_");
        const key = `contracts/${id}/${safeName}`;
        const buffer = Buffer.from(await file.arrayBuffer());
        const uploaded = await uploadContractObject({
          key,
          body: buffer,
          contentType,
        });
        const contract = await createContractUpload({
          id,
          original_filename: filename,
          content_type: contentType,
          s3_key: uploaded.key,
          s3_uri: uploaded.uri,
          created_by: session!.user!.email!,
          byte_size: file.size,
        });
        await writeAccessAudit({
          actorEmail: session!.user!.email,
          action: "contract.upload",
          resourceType: "contract",
          resourceId: contract.id,
          sourceIp: clientIpFromRequest(req),
          metadata: { filename, byte_size: file.size },
        });
        created.push(contract);
      } catch (e) {
        failures.push({
          filename,
          error: e instanceof Error ? e.message : "Upload failed",
        });
      }
    }

    if (created.length) {
      try {
        await pollerJson("/ops/contracts/process-pending", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ limit: Math.max(created.length, 10) }),
        });
      } catch (err) {
        if (!(err instanceof PollerError)) throw err;
      }
    }

    return NextResponse.json({
      ok: true,
      created,
      failures,
      count: created.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed" },
      { status: 500 }
    );
  }
}
