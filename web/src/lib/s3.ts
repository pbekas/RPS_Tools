import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
      const region = process.env.AWS_REGION || "us-east-1";
      const client = new S3Client({ region });
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
