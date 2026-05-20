import {
  normalizeHostedExecutionString,
} from "@murphai/hosted-execution/env";

export const HOSTED_R2_PRESIGN_ACCOUNT_ID_ENV = "HOSTED_R2_PRESIGN_ACCOUNT_ID";
export const HOSTED_R2_PRESIGN_ACCESS_KEY_ID_ENV = "HOSTED_R2_PRESIGN_ACCESS_KEY_ID";
export const HOSTED_R2_PRESIGN_BUCKET_NAME_ENV = "HOSTED_R2_PRESIGN_BUCKET_NAME";
export const HOSTED_R2_PRESIGN_ENDPOINT_ENV = "HOSTED_R2_PRESIGN_ENDPOINT";
export const HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY_ENV = "HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY";

const AWS4_ALGORITHM = "AWS4-HMAC-SHA256";
const AWS4_REQUEST = "aws4_request";
const R2_REGION = "auto";
const R2_SERVICE = "s3";
const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";
const DEFAULT_R2_PRESIGN_EXPIRES_SECONDS = 10 * 60;
const MAX_R2_PRESIGN_EXPIRES_SECONDS = 7 * 24 * 60 * 60;

const textEncoder = new TextEncoder();

export interface HostedR2PresignEnvironment {
  accessKeyId: string;
  bucketName: string;
  endpoint: string;
  secretAccessKey: string;
}

export function readHostedR2PresignEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): HostedR2PresignEnvironment {
  const accountId = requireHostedR2PresignString(
    source[HOSTED_R2_PRESIGN_ACCOUNT_ID_ENV],
    HOSTED_R2_PRESIGN_ACCOUNT_ID_ENV,
  );
  const endpoint = normalizeHostedR2PresignEndpoint(
    source[HOSTED_R2_PRESIGN_ENDPOINT_ENV],
    accountId,
  );

  return {
    accessKeyId: requireHostedR2PresignString(
      source[HOSTED_R2_PRESIGN_ACCESS_KEY_ID_ENV],
      HOSTED_R2_PRESIGN_ACCESS_KEY_ID_ENV,
    ),
    bucketName: requireHostedR2PresignString(
      source[HOSTED_R2_PRESIGN_BUCKET_NAME_ENV],
      HOSTED_R2_PRESIGN_BUCKET_NAME_ENV,
    ),
    endpoint,
    secretAccessKey: requireHostedR2PresignString(
      source[HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY_ENV],
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY_ENV,
    ),
  };
}

export async function createHostedR2PresignedPutUrl(input: {
  contentType: string;
  environment: HostedR2PresignEnvironment;
  expiresSeconds?: number;
  key: string;
  metadata?: Readonly<Record<string, string>>;
  now?: Date;
}): Promise<{
  expiresAt: string;
  url: string;
}> {
  const expiresSeconds = normalizeHostedR2PresignExpiresSeconds(input.expiresSeconds);
  const now = input.now ?? new Date();
  const amzDate = formatAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${R2_REGION}/${R2_SERVICE}/${AWS4_REQUEST}`;
  const endpoint = new URL(input.environment.endpoint);
  const canonicalUri = `/${encodeR2PathSegment(input.environment.bucketName)}/${encodeR2ObjectKey(input.key)}`;
  const metadataHeaders = normalizeHostedR2PresignMetadataHeaders(input.metadata ?? {});
  const signedHeaders = [
    "content-type",
    "host",
    "if-none-match",
    ...metadataHeaders.map(([key]) => key),
  ].join(";");
  const query = new URLSearchParams({
    "X-Amz-Algorithm": AWS4_ALGORITHM,
    "X-Amz-Content-Sha256": UNSIGNED_PAYLOAD,
    "X-Amz-Credential": `${input.environment.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresSeconds),
    "X-Amz-SignedHeaders": signedHeaders,
  });
  const canonicalQuery = canonicalizeSearchParams(query);
  const canonicalHeaders = [
    `content-type:${input.contentType}`,
    `host:${endpoint.host}`,
    "if-none-match:*",
    ...metadataHeaders.map(([key, value]) => `${key}:${value}`),
    "",
  ].join("\n");
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    UNSIGNED_PAYLOAD,
  ].join("\n");
  const stringToSign = [
    AWS4_ALGORITHM,
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = await deriveAws4SigningKey({
    dateStamp,
    secretAccessKey: input.environment.secretAccessKey,
  });
  query.set("X-Amz-Signature", await hmacHex(signingKey, stringToSign));

  return {
    expiresAt: new Date(now.getTime() + expiresSeconds * 1000).toISOString(),
    url: `${endpoint.origin}${canonicalUri}?${canonicalizeSearchParams(query)}`,
  };
}

function normalizeHostedR2PresignMetadataHeaders(
  metadata: Readonly<Record<string, string>>,
): [string, string][] {
  return Object.entries(metadata)
    .map(([key, value]) => {
      const normalizedKey = key.trim().toLowerCase();
      const normalizedValue = value.trim();
      if (
        !/^[a-z0-9][a-z0-9-]*$/u.test(normalizedKey)
        || normalizedKey.startsWith("x-amz-meta-")
      ) {
        throw new TypeError("Hosted R2 presign metadata keys must be S3 metadata names without x-amz-meta-.");
      }
      if (normalizedValue.length === 0 || /[\r\n]/u.test(normalizedValue)) {
        throw new TypeError("Hosted R2 presign metadata values must be non-empty single-line strings.");
      }
      return [`x-amz-meta-${normalizedKey}`, normalizedValue] as [string, string];
    })
    .sort(([left], [right]) => left.localeCompare(right));
}

function normalizeHostedR2PresignEndpoint(value: string | undefined, accountId: string): string {
  const expectedHostname = `${accountId}.r2.cloudflarestorage.com`;
  const normalized = normalizeHostedExecutionString(value)
    ?? `https://${expectedHostname}`;
  const url = new URL(normalized);
  if (
    url.protocol !== "https:"
    || url.hostname !== expectedHostname
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new TypeError(
      `${HOSTED_R2_PRESIGN_ENDPOINT_ENV} must be the account-level R2 HTTPS origin when configured.`,
    );
  }
  return url.origin;
}

function normalizeHostedR2PresignExpiresSeconds(value: number | undefined): number {
  const expiresSeconds = value ?? DEFAULT_R2_PRESIGN_EXPIRES_SECONDS;
  if (
    !Number.isSafeInteger(expiresSeconds)
    || expiresSeconds <= 0
    || expiresSeconds > MAX_R2_PRESIGN_EXPIRES_SECONDS
  ) {
    throw new TypeError("Hosted R2 presign expiry must be a positive integer up to 7 days.");
  }
  return expiresSeconds;
}

function requireHostedR2PresignString(value: string | undefined, label: string): string {
  const normalized = normalizeHostedExecutionString(value);
  if (!normalized) {
    throw new TypeError(`${label} is required for hosted workspace snapshot direct R2 uploads.`);
  }
  return normalized;
}

function formatAmzDate(date: Date): string {
  return date.toISOString()
    .replace(/[:-]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
}

function encodeR2ObjectKey(key: string): string {
  return key.split("/").map(encodeR2PathSegment).join("/");
}

function encodeR2PathSegment(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/gu, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalizeSearchParams(params: URLSearchParams): string {
  return [...params.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${encodeR2PathSegment(key)}=${encodeR2PathSegment(value)}`)
    .join("&");
}

async function deriveAws4SigningKey(input: {
  dateStamp: string;
  secretAccessKey: string;
}): Promise<Uint8Array> {
  const dateKey = await hmacBytes(
    textEncoder.encode(`AWS4${input.secretAccessKey}`),
    input.dateStamp,
  );
  const regionKey = await hmacBytes(dateKey, R2_REGION);
  const serviceKey = await hmacBytes(regionKey, R2_SERVICE);
  return await hmacBytes(serviceKey, AWS4_REQUEST);
}

async function hmacBytes(keyBytes: Uint8Array, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, textEncoder.encode(value)));
}

async function hmacHex(keyBytes: Uint8Array, value: string): Promise<string> {
  return bytesToHex(await hmacBytes(keyBytes, value));
}

async function sha256Hex(value: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(value),
  )));
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
