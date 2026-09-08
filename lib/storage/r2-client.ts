import "server-only";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Cloudflare R2 client for the platform's object storage — first use in
 * this project (logo upload, CTA-02). R2 is S3-API-compatible, so this is
 * a plain AWS SDK v3 `S3Client` pointed at R2's S3 endpoint instead of AWS.
 * Phase 12 (SIS-04, full asset library) builds on this same client.
 */

const ALLOWED_LOGO_CONTENT_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;

export type AllowedLogoContentType = keyof typeof ALLOWED_LOGO_CONTENT_TYPES;

export function isAllowedLogoContentType(
  value: string,
): value is AllowedLogoContentType {
  return Object.prototype.hasOwnProperty.call(
    ALLOWED_LOGO_CONTENT_TYPES,
    value,
  );
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See .env.example.`);
  }
  return value;
}

// Lazily constructed (not at module load) so this file can be imported by
// tooling/tests without R2 env vars set, and so a missing var surfaces as a
// clear error only when a logo upload is actually attempted.
let cachedClient: S3Client | null = null;

function getClient(): S3Client {
  if (cachedClient) return cachedClient;
  const accountId = requiredEnv("R2_ACCOUNT_ID");
  cachedClient = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requiredEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
  return cachedClient;
}

/** Fixed filename per agency — a new upload simply overwrites the previous
 * logo at the same key, which is what "uploading a new logo replaces the
 * old one" needs, with no separate delete/cleanup step. Keyed by agencyId
 * (the Clerk org id), never anything client-suppliable, so one agency can
 * never target another agency's key.
 */
function logoKey(agencyId: string, contentType: AllowedLogoContentType): string {
  const ext = ALLOWED_LOGO_CONTENT_TYPES[contentType];
  return `brand-logos/${agencyId}/logo.${ext}`;
}

const PRESIGNED_URL_EXPIRY_SECONDS = 300;

export async function getPresignedLogoUploadUrl(
  agencyId: string,
  contentType: string,
): Promise<{ uploadUrl: string; publicUrl: string }> {
  if (!isAllowedLogoContentType(contentType)) {
    throw new Error(`Unsupported content type: ${contentType}`);
  }

  const bucket = requiredEnv("R2_BUCKET_NAME");
  const publicBaseUrl = requiredEnv("R2_PUBLIC_URL").replace(/\/$/, "");
  const key = logoKey(agencyId, contentType);

  const uploadUrl = await getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: PRESIGNED_URL_EXPIRY_SECONDS },
  );

  return {
    uploadUrl,
    publicUrl: `${publicBaseUrl}/${key}`,
  };
}
