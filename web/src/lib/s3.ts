import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

function s3Client() {
  const region = process.env.AWS_REGION || "us-east-1";
  return new S3Client({ region });
}

function bucketName(): string {
  const bucket = (process.env.S3_BUCKET || "").trim();
  if (!bucket) throw new Error("S3_BUCKET is not configured");
  return bucket;
}

function parseS3Uri(uri: string): { bucket: string; key: string } | null {
  const m = uri.match(/^s3:\/\/([^/]+)\/(.+)$/);
  if (!m) return null;
  return { bucket: m[1], key: m[2] };
}

export async function resolveRecordingUrl(call: {
  recording_url?: string;
  recording_storage_uri?: string;
}): Promise<string> {
  const uri = call.recording_storage_uri || "";
  const parsed = uri.startsWith("s3://") ? parseS3Uri(uri) : null;
  if (parsed) {
    try {
      const client = s3Client();
      const command = new GetObjectCommand({
        Bucket: parsed.bucket,
        Key: parsed.key,
      });
      return await getSignedUrl(client, command, { expiresIn: 60 * 60 * 6 });
    } catch {
      // fall through to stored URL
    }
  }
  return call.recording_url || "";
}

export async function uploadContractObject(input: {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
}): Promise<{ bucket: string; key: string; uri: string }> {
  const bucket = bucketName();
  const client = s3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    })
  );
  return { bucket, key: input.key, uri: `s3://${bucket}/${input.key}` };
}

export async function resolveObjectUrl(input: {
  s3Uri?: string;
  s3Key?: string;
  expiresIn?: number;
  downloadFilename?: string;
}): Promise<string> {
  const parsed = input.s3Uri?.startsWith("s3://") ? parseS3Uri(input.s3Uri) : null;
  const bucket = parsed?.bucket || bucketName();
  const key = parsed?.key || input.s3Key || "";
  if (!key) return "";
  const client = s3Client();
  const filename = (input.downloadFilename || "").replace(/["\r\n]+/g, "_").trim();
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ...(filename
        ? { ResponseContentDisposition: `attachment; filename="${filename}"` }
        : {}),
    }),
    { expiresIn: input.expiresIn ?? 60 * 60 * 6 }
  );
}
