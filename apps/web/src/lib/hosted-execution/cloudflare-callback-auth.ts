import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  readHostedExecutionSignatureHeaders,
  encodeHostedExecutionSignedRequestPayload,
} from "@murphai/hosted-execution";

import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { getPrisma } from "../prisma";
import {
  PrismaHostedCallbackRequestNonceStore,
  type HostedCallbackRequestNonceStore,
} from "./internal-request-nonces";

const DEFAULT_HOSTED_CLOUDFLARE_CALLBACK_KEY_ID = "v1";
const HOSTED_CLOUDFLARE_CALLBACK_MAX_TIMESTAMP_SKEW_MS = 60_000;
const HOSTED_CLOUDFLARE_CALLBACK_NONCE_MIN_LENGTH = 16;
const HOSTED_CLOUDFLARE_CALLBACK_SIGNING_ALGORITHM: EcKeyImportParams = {
  name: "ECDSA",
  namedCurve: "P-256",
};
const HOSTED_CLOUDFLARE_CALLBACK_VERIFY_ALGORITHM: EcdsaParams = {
  name: "ECDSA",
  hash: "SHA-256",
};

type EnvSource = Readonly<Record<string, string | undefined>>;

interface HostedCloudflareCallbackVerificationEnvironment {
  currentKeyId: string;
  publicKeysById: Readonly<Record<string, JsonWebKey>>;
}

const publicKeyCache = new Map<string, Promise<CryptoKey>>();

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export async function requireHostedCloudflareCallbackRequest(
  request: Request,
  options: {
    maxTimestampSkewMs?: number;
    nonceStore?: HostedCallbackRequestNonceStore;
    nowMs?: number;
  } = {},
): Promise<string> {
  const verification = requireHostedCloudflareCallbackVerificationEnvironment(process.env);
  const userId = requireHostedExecutionUserId(request);
  const payload = await request.clone().text();
  const url = new URL(request.url);
  const { keyId, nonce, signature, timestamp } = readHostedExecutionSignatureHeaders(request.headers);
  const normalizedNonce = normalizeOptionalString(nonce);
  const normalizedKeyId = normalizeOptionalString(keyId);
  const maxTimestampSkewMs =
    options.maxTimestampSkewMs ?? HOSTED_CLOUDFLARE_CALLBACK_MAX_TIMESTAMP_SKEW_MS;

  if (!normalizedKeyId) {
    throw unauthorizedCloudflareCallbackError();
  }

  const publicJwk = verification.publicKeysById[normalizedKeyId];

  if (!publicJwk) {
    throw unauthorizedCloudflareCallbackError();
  }

  const verified = await verifyHostedCloudflareCallbackSignature({
    key: await importHostedCloudflareCallbackPublicKey(publicJwk, normalizedKeyId),
    method: request.method,
    nonce: normalizedNonce,
    path: url.pathname,
    payload,
    search: url.search,
    signature,
    timestamp,
    userId,
  });

  if (!verified) {
    throw unauthorizedCloudflareCallbackError();
  }

  if (!normalizedNonce || normalizedNonce.length < HOSTED_CLOUDFLARE_CALLBACK_NONCE_MIN_LENGTH) {
    throw unauthorizedCloudflareCallbackError();
  }

  const timestampMs = parseCanonicalTimestampMs(timestamp);
  if (timestampMs === null) {
    throw unauthorizedCloudflareCallbackError();
  }

  const nowMs = options.nowMs ?? Date.now();
  if (Math.abs(nowMs - timestampMs) > maxTimestampSkewMs) {
    throw unauthorizedCloudflareCallbackError();
  }

  const consumed = await (options.nonceStore
    ?? new PrismaHostedCallbackRequestNonceStore(getPrisma())
  ).consumeHostedCallbackRequestNonce({
    expiresAt: new Date(timestampMs + maxTimestampSkewMs).toISOString(),
    method: request.method.toUpperCase(),
    nonceHash: await sha256Hex(normalizedNonce),
    now: new Date(nowMs).toISOString(),
    path: url.pathname,
    search: url.search,
    userId,
  });

  if (!consumed) {
    throw hostedOnboardingError({
      code: "HOSTED_CLOUDFLARE_CALLBACK_REPLAYED",
      message: "Hosted Cloudflare callback was already used and cannot be replayed.",
      httpStatus: 401,
    });
  }

  return userId;
}

function requireHostedCloudflareCallbackVerificationEnvironment(
  source: EnvSource = process.env,
): HostedCloudflareCallbackVerificationEnvironment {
  const currentKeyId =
    normalizeOptionalString(source.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID)
    ?? DEFAULT_HOSTED_CLOUDFLARE_CALLBACK_KEY_ID;
  const currentPublicJwk = requirePublicJwk(
    normalizeOptionalString(source.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK),
    "HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK",
  );
  const publicKeysById = decodePublicKeyring(
    normalizeOptionalString(source.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON),
    "HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON",
  );

  const configuredCurrentKey = publicKeysById[currentKeyId];

  if (!configuredCurrentKey) {
    publicKeysById[currentKeyId] = currentPublicJwk;
  } else if (JSON.stringify(configuredCurrentKey) !== JSON.stringify(currentPublicJwk)) {
    throw new TypeError(
      `HOSTED_WEB_CALLBACK_SIGNING_KEY_ID ${currentKeyId} must match HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK.`,
    );
  }

  return {
    currentKeyId,
    publicKeysById,
  };
}

function decodePublicKeyring(value: string | null, label: string): Record<string, JsonWebKey> {
  if (!value) {
    return {};
  }

  const parsed = parseJsonObject(value, label);
  const result: Record<string, JsonWebKey> = {};

  for (const [rawKeyId, rawJwk] of Object.entries(parsed)) {
    const keyId = normalizeOptionalString(rawKeyId);

    if (!keyId) {
      throw new TypeError(`${label} contains a blank key id.`);
    }

    result[keyId] = parseEcP256PublicJwk(rawJwk, `${label}.${keyId}`);
  }

  return result;
}

function requirePublicJwk(value: string | null, label: string): JsonWebKey {
  if (!value) {
    throw new TypeError(`${label} is required for hosted Cloudflare callback verification.`);
  }

  return parseEcP256PublicJwk(parseJsonObject(value, label), label);
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    throw new TypeError(`${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }

  return parsed as Record<string, unknown>;
}

function parseEcP256PublicJwk(value: unknown, label: string): JsonWebKey {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an EC P-256 public JWK.`);
  }

  const jwk = value as JsonWebKey;

  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string") {
    throw new TypeError(`${label} must be an EC P-256 public JWK.`);
  }

  if ("d" in jwk) {
    throw new TypeError(`${label} must not include a private key component.`);
  }

  return {
    crv: "P-256",
    ext: true,
    key_ops: ["verify"],
    kty: "EC",
    x: jwk.x,
    y: jwk.y,
  };
}

async function verifyHostedCloudflareCallbackSignature(input: {
  key: CryptoKey;
  method?: string;
  nonce?: string | null;
  path?: string;
  payload: string;
  search?: string;
  signature: string | null;
  timestamp: string | null;
  userId?: string | null;
}): Promise<boolean> {
  if (!input.signature || !input.timestamp) {
    return false;
  }

  const signatureBytes = decodeBase64Url(input.signature);

  if (!signatureBytes) {
    return false;
  }

  const signatureBuffer = new ArrayBuffer(signatureBytes.byteLength);
  new Uint8Array(signatureBuffer).set(signatureBytes);

  return crypto.subtle.verify(
    HOSTED_CLOUDFLARE_CALLBACK_VERIFY_ALGORITHM,
    input.key,
    signatureBuffer,
    encodeHostedExecutionSignedRequestPayload({
      method: input.method,
      nonce: input.nonce,
      path: input.path,
      payload: input.payload,
      search: input.search,
      timestamp: input.timestamp,
      userId: input.userId,
    }),
  );
}

async function importHostedCloudflareCallbackPublicKey(
  jwk: JsonWebKey,
  keyId: string,
): Promise<CryptoKey> {
  const cacheKey = `${keyId}:${JSON.stringify(jwk)}`;
  let existing = publicKeyCache.get(cacheKey);

  if (!existing) {
    existing = crypto.subtle.importKey(
      "jwk",
      jwk,
      HOSTED_CLOUDFLARE_CALLBACK_SIGNING_ALGORITHM,
      false,
      ["verify"],
    );
    publicKeyCache.set(cacheKey, existing);
  }

  return existing;
}

function requireHostedExecutionUserId(request: Request): string {
  const userId = normalizeOptionalString(request.headers.get(HOSTED_EXECUTION_USER_ID_HEADER));

  if (!userId) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_USER_ID_REQUIRED",
      message: `${HOSTED_EXECUTION_USER_ID_HEADER} header is required for hosted Cloudflare callback routes.`,
      httpStatus: 400,
    });
  }

  return userId;
}

function parseCanonicalTimestampMs(value: string | null): number | null {
  if (typeof value !== "string" || value.trim() !== value) {
    return null;
  }

  const parsedMs = Date.parse(value);

  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  return new Date(parsedMs).toISOString() === value ? parsedMs : null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeBase64Url(value: string): Uint8Array | null {
  const normalized = normalizeOptionalString(value);

  if (!normalized || /[^A-Za-z0-9\-_]/u.test(normalized)) {
    return null;
  }

  const padded = normalized.replace(/-/gu, "+").replace(/_/gu, "/");
  const remainder = padded.length % 4;
  const withPadding = remainder === 0 ? padded : `${padded}${"=".repeat(4 - remainder)}`;

  try {
    return Uint8Array.from([...Buffer.from(withPadding, "base64")]);
  } catch {
    return null;
  }
}

function unauthorizedCloudflareCallbackError() {
  return hostedOnboardingError({
    code: "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
    message: "Unauthorized hosted Cloudflare callback.",
    httpStatus: 401,
  });
}
