import {
  normalizeHostedExecutionString,
} from "@murphai/hosted-execution/env";

export const HOSTED_R2_PRESIGN_ACCOUNT_ID_ENV = "HOSTED_R2_PRESIGN_ACCOUNT_ID";
export const HOSTED_R2_PRESIGN_ACCESS_KEY_ID_ENV = "HOSTED_R2_PRESIGN_ACCESS_KEY_ID";
export const HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT_ENV = "HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT";
export const HOSTED_R2_PRESIGN_BUCKET_NAME_ENV = "HOSTED_R2_PRESIGN_BUCKET_NAME";
export const HOSTED_R2_PRESIGN_CONTROL_ENDPOINT_ENV = "HOSTED_R2_PRESIGN_CONTROL_ENDPOINT";
export const HOSTED_R2_PRESIGN_ENDPOINT_ENV = "HOSTED_R2_PRESIGN_ENDPOINT";
export const HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY_ENV = "HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY";
export const MURPH_HOSTED_LOCAL_R2_DOCKER_BRIDGE_HOST_ENV = "MURPH_HOSTED_LOCAL_R2_DOCKER_BRIDGE_HOST";
export const HOSTED_R2_CHECKSUM_MODE_HEADER = "x-amz-checksum-mode";
export const HOSTED_R2_CHECKSUM_MODE_ENABLED = "ENABLED";

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
  controlEndpoint?: string | null;
  endpoint: string;
  localEndpointAllowed?: boolean;
  secretAccessKey: string;
}

export function readHostedR2PresignEnvironment(
  source: Readonly<Record<string, string | undefined>>,
): HostedR2PresignEnvironment {
  const accountId = requireHostedR2PresignString(
    source[HOSTED_R2_PRESIGN_ACCOUNT_ID_ENV],
    HOSTED_R2_PRESIGN_ACCOUNT_ID_ENV,
  );
  const localEndpointAllowed =
    source[HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT_ENV]?.trim() === "1";
  if (localEndpointAllowed && isHostedR2ProductionPresignSource(source)) {
    throw new TypeError(
      `${HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT_ENV} is not supported in production environments.`,
    );
  }
  if (localEndpointAllowed && !isHostedR2LocalPresignSource(source)) {
    throw new TypeError(
      `${HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT_ENV} requires a hosted-local profile or test isolation.`,
    );
  }
  const endpoint = normalizeHostedR2PresignEndpoint(
    source[HOSTED_R2_PRESIGN_ENDPOINT_ENV],
    accountId,
    {
      dockerBridgeHost: source[MURPH_HOSTED_LOCAL_R2_DOCKER_BRIDGE_HOST_ENV],
      label: HOSTED_R2_PRESIGN_ENDPOINT_ENV,
      localEndpointAllowed,
    },
  );
  const controlEndpoint = normalizeHostedR2PresignControlEndpoint(
    source[HOSTED_R2_PRESIGN_CONTROL_ENDPOINT_ENV],
    {
      dockerBridgeHost: source[MURPH_HOSTED_LOCAL_R2_DOCKER_BRIDGE_HOST_ENV],
      localEndpointAllowed,
    },
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
    controlEndpoint,
    endpoint,
    localEndpointAllowed,
    secretAccessKey: requireHostedR2PresignString(
      source[HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY_ENV],
      HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY_ENV,
    ),
  };
}

export async function createHostedR2PresignedPutUrl(input: {
  checksumSha256Base64?: string;
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
  const endpoint = new URL(input.environment.endpoint);
  const canonicalUri = `/${encodeR2PathSegment(input.environment.bucketName)}/${encodeR2ObjectKey(input.key)}`;
  const checksumSha256Base64 = input.checksumSha256Base64 === undefined
    ? null
    : normalizeHostedR2Sha256ChecksumBase64(input.checksumSha256Base64);
  const metadataHeaders = normalizeHostedR2PresignMetadataHeaders(input.metadata ?? {});
  const signedHeaders = [
    "content-type",
    "host",
    "if-none-match",
    ...(checksumSha256Base64 === null ? [] : ["x-amz-checksum-sha256"]),
    ...metadataHeaders.map(([key]) => key),
  ].join(";");
  const canonicalHeaders = [
    `content-type:${input.contentType}`,
    `host:${endpoint.host}`,
    "if-none-match:*",
    ...(checksumSha256Base64 === null ? [] : [`x-amz-checksum-sha256:${checksumSha256Base64}`]),
    ...metadataHeaders.map(([key, value]) => `${key}:${value}`),
    "",
  ].join("\n");
  return createHostedR2PresignedObjectUrl({
    canonicalHeaders,
    canonicalUri,
    endpoint,
    environment: input.environment,
    expiresSeconds,
    method: "PUT",
    now,
    signedHeaders,
  });
}

function normalizeHostedR2Sha256ChecksumBase64(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(normalized)) {
    throw new TypeError("Hosted R2 SHA-256 checksum must be base64.");
  }
  const decoded = Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
  if (decoded.byteLength !== 32) {
    throw new TypeError("Hosted R2 SHA-256 checksum must decode to 32 bytes.");
  }
  return normalized;
}

export async function createHostedR2PresignedGetUrl(input: {
  environment: HostedR2PresignEnvironment;
  expiresSeconds?: number;
  key: string;
  now?: Date;
}): Promise<{
  expiresAt: string;
  url: string;
}> {
  return createHostedR2PresignedReadLikeUrl({
    environment: input.environment,
    expiresSeconds: input.expiresSeconds,
    key: input.key,
    method: "GET",
    now: input.now,
  });
}

export async function createHostedR2PresignedHeadUrl(input: {
  checksumMode?: typeof HOSTED_R2_CHECKSUM_MODE_ENABLED;
  environment: HostedR2PresignEnvironment;
  expiresSeconds?: number;
  key: string;
  now?: Date;
}): Promise<{
  expiresAt: string;
  url: string;
}> {
  const signedHeaderValues = input.checksumMode === undefined
    ? []
    : [[HOSTED_R2_CHECKSUM_MODE_HEADER, input.checksumMode] as const];
  return createHostedR2PresignedReadLikeUrl({
    environment: input.environment,
    expiresSeconds: input.expiresSeconds,
    key: input.key,
    method: "HEAD",
    now: input.now,
    signedHeaderValues,
  });
}

export async function createHostedR2PresignedDeleteUrl(input: {
  environment: HostedR2PresignEnvironment;
  expiresSeconds?: number;
  key: string;
  now?: Date;
}): Promise<{
  expiresAt: string;
  url: string;
}> {
  return createHostedR2PresignedReadLikeUrl({
    environment: input.environment,
    expiresSeconds: input.expiresSeconds,
    key: input.key,
    method: "DELETE",
    now: input.now,
  });
}

function normalizeHostedR2PresignMetadataHeaders(
  metadata: Readonly<Record<string, string>>,
): [string, string][] {
  return Object.entries(metadata)
    .map(([key, value]) => {
      const normalizedKey = key.trim().toLowerCase();
      const normalizedValue = value.trim().replace(/[ \t]+/gu, " ");
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

function normalizeHostedR2PresignEndpoint(
  value: string | undefined,
  accountId: string,
  options: {
    dockerBridgeHost?: string | undefined;
    label: string;
    localEndpointAllowed: boolean;
  },
): string {
  const expectedHostname = `${accountId}.r2.cloudflarestorage.com`;
  const normalized = normalizeHostedExecutionString(value)
    ?? `https://${expectedHostname}`;
  const url = new URL(normalized);
  if (
    url.protocol === "https:"
    && url.hostname === expectedHostname
    && url.pathname === "/"
    && !url.search
    && !url.hash
  ) {
    return url.origin;
  }

  if (
    options.localEndpointAllowed
    && isHostedR2LocalPresignEndpoint(url, options)
  ) {
    return url.origin;
  }

  throw new TypeError(
    `${options.label} must be the account-level R2 HTTPS origin when configured.`,
  );
}

function normalizeHostedR2PresignControlEndpoint(
  value: string | undefined,
  options: {
    dockerBridgeHost?: string | undefined;
    localEndpointAllowed: boolean;
  },
): string | null {
  const normalized = normalizeHostedExecutionString(value);
  if (!normalized) {
    return null;
  }
  if (!options.localEndpointAllowed) {
    throw new TypeError(
      `${HOSTED_R2_PRESIGN_CONTROL_ENDPOINT_ENV} is only supported for hosted-local R2 presign endpoints.`,
    );
  }
  const url = new URL(normalized);
  if (!isHostedR2LocalPresignEndpoint(url, options)) {
    throw new TypeError(
      `${HOSTED_R2_PRESIGN_CONTROL_ENDPOINT_ENV} must be a hosted-local S3-compatible origin when configured.`,
    );
  }
  return url.origin;
}

function isHostedR2LocalPresignEndpoint(
  url: URL,
  options: {
    dockerBridgeHost?: string | undefined;
  } = {},
): boolean {
  if (
    url.pathname !== "/"
    || url.search
    || url.hash
    || (url.protocol !== "http:" && url.protocol !== "https:")
  ) {
    return false;
  }

  const hostname = url.hostname.toLowerCase();
  return hostname === "localhost"
    || hostname === "host.docker.internal"
    || hostname === "host.containers.internal"
    || hostname === "::1"
    || hostname === "[::1]"
    || isLoopbackIpv4Host(hostname)
    || isExplicitHostedLocalDockerBridgeHost(hostname, options.dockerBridgeHost);
}

function isHostedR2ProductionPresignSource(
  source: Readonly<Record<string, string | undefined>>,
): boolean {
  return normalizeHostedR2PresignMarker(source.NODE_ENV) === "production"
    || normalizeHostedR2PresignMarker(source.VERCEL_ENV) === "production"
    || normalizeHostedR2PresignMarker(source.HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT) === "production"
    || normalizeHostedR2PresignMarker(source.HOSTED_CRYPTO_ENV) === "production"
    || normalizeHostedR2PresignMarker(source.HOSTED_CRYPTO_ENV) === "prod";
}

function isHostedR2LocalPresignSource(
  source: Readonly<Record<string, string | undefined>>,
): boolean {
  const profile = normalizeHostedR2PresignMarker(source.MURPH_HOSTED_LOCAL_PROFILE);
  return normalizeHostedR2PresignMarker(source.MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED) === "1"
    || profile === "dev"
    || profile === "worker-only"
    || profile === "e2e:stub"
    || profile === "e2e:live";
}

function normalizeHostedR2PresignMarker(value: string | undefined): string | null {
  return value?.trim().toLowerCase() || null;
}

function isExplicitHostedLocalDockerBridgeHost(
  hostname: string,
  dockerBridgeHost: string | undefined,
): boolean {
  const normalizedBridgeHost = normalizeHostedR2PresignMarker(dockerBridgeHost);
  return normalizedBridgeHost !== null
    && hostname === normalizedBridgeHost
    && isPrivateIpv4Host(hostname);
}

function isLoopbackIpv4Host(hostname: string): boolean {
  const octets = parseIpv4Host(hostname);
  return octets !== null && octets[0] === 127;
}

function isPrivateIpv4Host(hostname: string): boolean {
  const octets = parseIpv4Host(hostname);
  if (octets === null) {
    return false;
  }
  const [first = -1, second = -1] = octets;
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function parseIpv4Host(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (
    octets.some((octet, index) =>
      !Number.isInteger(octet)
      || octet < 0
      || octet > 255
      || String(octet) !== parts[index])
  ) {
    return null;
  }

  return [octets[0] ?? 0, octets[1] ?? 0, octets[2] ?? 0, octets[3] ?? 0];
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

async function createHostedR2PresignedReadLikeUrl(input: {
  environment: HostedR2PresignEnvironment;
  expiresSeconds?: number;
  key: string;
  method: "DELETE" | "GET" | "HEAD";
  now?: Date;
  signedHeaderValues?: ReadonlyArray<readonly [string, string]>;
}): Promise<{
  expiresAt: string;
  url: string;
}> {
  const expiresSeconds = normalizeHostedR2PresignExpiresSeconds(input.expiresSeconds);
  const now = input.now ?? new Date();
  const endpoint = new URL(input.environment.endpoint);
  const canonicalUri = `/${encodeR2PathSegment(input.environment.bucketName)}/${encodeR2ObjectKey(input.key)}`;
  const signedHeaderValues = [...(input.signedHeaderValues ?? [])]
    .sort(([left], [right]) => left.localeCompare(right));
  const signedHeaders = [
    "host",
    ...signedHeaderValues.map(([key]) => key),
  ].join(";");
  const canonicalHeaders = [
    `host:${endpoint.host}`,
    ...signedHeaderValues.map(([key, value]) => `${key}:${value}`),
    "",
  ].join("\n");
  return createHostedR2PresignedObjectUrl({
    canonicalHeaders,
    canonicalUri,
    endpoint,
    environment: input.environment,
    expiresSeconds,
    method: input.method,
    now,
    signedHeaders,
  });
}

async function createHostedR2PresignedObjectUrl(input: {
  canonicalHeaders: string;
  canonicalUri: string;
  endpoint: URL;
  environment: HostedR2PresignEnvironment;
  expiresSeconds: number;
  method: "DELETE" | "GET" | "HEAD" | "PUT";
  now: Date;
  signedHeaders: string;
}): Promise<{
  expiresAt: string;
  url: string;
}> {
  const amzDate = formatAmzDate(input.now);
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${R2_REGION}/${R2_SERVICE}/${AWS4_REQUEST}`;
  const query = new URLSearchParams({
    "X-Amz-Algorithm": AWS4_ALGORITHM,
    "X-Amz-Content-Sha256": UNSIGNED_PAYLOAD,
    "X-Amz-Credential": `${input.environment.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(input.expiresSeconds),
    "X-Amz-SignedHeaders": input.signedHeaders,
  });
  const canonicalQuery = canonicalizeSearchParams(query);
  const canonicalRequest = [
    input.method,
    input.canonicalUri,
    canonicalQuery,
    input.canonicalHeaders,
    input.signedHeaders,
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
    expiresAt: new Date(input.now.getTime() + input.expiresSeconds * 1000).toISOString(),
    url: `${input.endpoint.origin}${input.canonicalUri}?${canonicalizeSearchParams(query)}`,
  };
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
