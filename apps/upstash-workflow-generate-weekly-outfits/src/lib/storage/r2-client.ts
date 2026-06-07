import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"

function getR2Client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY

  if (!accessKeyId || !secretAccessKey || !process.env.R2_BUCKET) {
    throw new Error(
      "Missing R2 configuration — set R2_ACCOUNT_ID (or R2_ENDPOINT), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET",
    )
  }

  const endpoint =
    process.env.R2_ENDPOINT ??
    (accountId
      ? `https://${accountId}.r2.cloudflarestorage.com`
      : (() => {
          throw new Error("R2_ENDPOINT or R2_ACCOUNT_ID must be set")
        })())

  return new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: false,
  })
}

function getPublicUrl(key: string): string {
  if (process.env.R2_PUBLIC_URL) {
    return `${process.env.R2_PUBLIC_URL.replace(/\/$/, "")}/${key}`
  }
  const accountId = process.env.R2_ACCOUNT_ID
  const bucket = process.env.R2_BUCKET
  if (!accountId || !bucket) throw new Error("Missing R2 configuration to build public URL")
  return `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`
}

/**
 * Uploads a JPEG buffer to Cloudflare R2 using the S3-compatible API.
 * Returns the public URL for the uploaded object.
 */
export async function uploadImageToR2(buffer: Buffer, key: string): Promise<string> {
  const bucket = process.env.R2_BUCKET
  if (!bucket) throw new Error("R2_BUCKET environment variable is not set")

  const client = getR2Client()

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: "image/jpeg",
    }),
  )

  return getPublicUrl(key)
}
