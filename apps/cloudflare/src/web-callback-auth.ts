import {
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  encodeHostedExecutionSignedRequestPayload,
  readHostedExecutionSignatureHeaders,
} from "@murphai/hosted-execution/auth";

const DEFAULT_HOSTED_WEB_CALLBACK_SIGNING_KEY_ID = "v1";
const HOSTED_WEB_CALLBACK_SIGNING_IMPORT_ALGORITHM: EcKeyImportParams = {
  name: "ECDSA",
  namedCurve: "P-256",
};
const HOSTED_WEB_CALLBACK_SIGNING_ALGORITHM: EcdsaParams = {
  name: "ECDSA",
  hash: "SHA-256",
};
const DEFAULT_SIGNATURE_TIMESTAMP_TOLERANCE_MS = 60_000;
const HOSTED_WEB_CALLBACK_NONCE_MIN_LENGTH = 16;

type EnvSource = Readonly<Record<string, string | undefined>>;
type HostedWebCallbackNonceStoreConsumeInput = {
  expiresAt: number;
  keyId: string;
  method: string;
  nonceHash: string;
  now: number;
  path: string;
  search: string;
  userId: string | null;
};

export interface HostedWebCallbackNonceStore {
  consume(input: HostedWebCallbackNonceStoreConsumeInput): Promise<boolean>;
}

export interface HostedWebCallbackSigningEnvironment {
  keyId: string;
  privateKeyJwkJson: string;
}

const privateKeyCache = new Map<string, Promise<CryptoKey>>();
const publicKeyCache = new Map<string, Promise<CryptoKey>>();

export function readHostedWebCallbackSigningEnvironment(
  source: EnvSource = process.env,
): HostedWebCallbackSigningEnvironment {
  return {
    keyId:
      normalizeOptionalString(source.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID)
      ?? DEFAULT_HOSTED_WEB_CALLBACK_SIGNING_KEY_ID,
    privateKeyJwkJson: requireConfiguredString(
      source.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK,
      "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
    ),
  };
}

export async function createHostedWebCallbackSignatureHeaders(input: {
  environment: HostedWebCallbackSigningEnvironment;
  method?: string;
  nonce?: string | null;
  path?: string;
  payload: string;
  search?: string;
  timestamp?: string;
  userId?: string | null;
}): Promise<Record<string, string>> {
  const nonce = normalizeOptionalString(input.nonce) ?? createNonce();
  const timestamp = normalizeOptionalString(input.timestamp) ?? new Date().toISOString();
  const signature = await signHostedWebCallbackRequest({
    environment: input.environment,
    method: input.method,
    nonce,
    path: input.path,
    payload: input.payload,
    search: input.search,
    timestamp,
    userId: input.userId,
  });

  return {
    [HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER]: input.environment.keyId,
    [HOSTED_EXECUTION_NONCE_HEADER]: nonce,
    [HOSTED_EXECUTION_SIGNATURE_HEADER]: signature,
    [HOSTED_EXECUTION_TIMESTAMP_HEADER]: timestamp,
  };
}

export async function verifyHostedWebCallbackSignatureHeaders(input: {
  environment: HostedWebCallbackSigningEnvironment;
  method?: string;
  nonceStore?: HostedWebCallbackNonceStore;
  now?: () => Date;
  path?: string;
  payload: string;
  request: Request;
  search?: string;
  timestampToleranceMs?: number;
  userId?: string | null;
}): Promise<boolean> {
  const headers = readHostedExecutionSignatureHeaders(input.request.headers);

  if (headers.keyId !== input.environment.keyId) {
    return false;
  }

  const nonce = normalizeOptionalString(headers.nonce);

  if (!nonce || nonce.length < HOSTED_WEB_CALLBACK_NONCE_MIN_LENGTH) {
    return false;
  }

  const now = (input.now ?? (() => new Date()))();
  const timestampMs = parseCanonicalTimestampMs(headers.timestamp);
  const toleranceMs = input.timestampToleranceMs ?? DEFAULT_SIGNATURE_TIMESTAMP_TOLERANCE_MS;

  if (timestampMs === null || Math.abs(now.getTime() - timestampMs) > toleranceMs) {
    return false;
  }

  const signatureBytes = decodeBase64Url(headers.signature);

  if (!signatureBytes) {
    return false;
  }

  const signatureBuffer = new ArrayBuffer(signatureBytes.byteLength);
  new Uint8Array(signatureBuffer).set(signatureBytes);
  const publicKey = await importHostedWebCallbackPublicKey(
    input.environment.privateKeyJwkJson,
    input.environment.keyId,
  );

  const verified = await crypto.subtle.verify(
    HOSTED_WEB_CALLBACK_SIGNING_ALGORITHM,
    publicKey,
    signatureBuffer,
    encodeHostedExecutionSignedRequestPayload({
      method: input.method,
      nonce,
      path: input.path,
      payload: input.payload,
      search: input.search,
      timestamp: headers.timestamp ?? "",
      userId: input.userId,
    }),
  );

  if (!verified) {
    return false;
  }

  return await (input.nonceStore ?? defaultNonceStore).consume({
    expiresAt: timestampMs + toleranceMs,
    keyId: input.environment.keyId,
    method: input.method?.toUpperCase() ?? "",
    nonceHash: await sha256Hex(nonce),
    now: now.getTime(),
    path: input.path ?? "",
    search: input.search ?? "",
    userId: normalizeOptionalString(input.userId),
  });
}

async function signHostedWebCallbackRequest(input: {
  environment: HostedWebCallbackSigningEnvironment;
  method?: string;
  nonce: string;
  path?: string;
  payload: string;
  search?: string;
  timestamp: string;
  userId?: string | null;
}): Promise<string> {
  const key = await importHostedWebCallbackPrivateKey(
    input.environment.privateKeyJwkJson,
    input.environment.keyId,
  );
  const signature = await crypto.subtle.sign(
    HOSTED_WEB_CALLBACK_SIGNING_ALGORITHM,
    key,
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

  return encodeBase64Url(new Uint8Array(signature));
}

async function importHostedWebCallbackPrivateKey(
  privateKeyJwkJson: string,
  keyId: string,
): Promise<CryptoKey> {
  const cacheKey = `${keyId}:${privateKeyJwkJson}`;
  let existing = privateKeyCache.get(cacheKey);

  if (!existing) {
    const jwk = parseEcP256PrivateJwk(
      parseJsonObject(privateKeyJwkJson, "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK"),
      "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
    );
    existing = crypto.subtle.importKey(
      "jwk",
      jwk,
      HOSTED_WEB_CALLBACK_SIGNING_IMPORT_ALGORITHM,
      false,
      ["sign"],
    );
    privateKeyCache.set(cacheKey, existing);
  }

  return existing;
}

async function importHostedWebCallbackPublicKey(
  privateKeyJwkJson: string,
  keyId: string,
): Promise<CryptoKey> {
  const privateJwk = parseEcP256PrivateJwk(
    parseJsonObject(privateKeyJwkJson, "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK"),
    "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
  );
  const publicJwk: JsonWebKey = {
    crv: "P-256",
    ext: true,
    key_ops: ["verify"],
    kty: "EC",
    x: privateJwk.x,
    y: privateJwk.y,
  };
  const cacheKey = `${keyId}:${JSON.stringify(publicJwk)}`;
  let existing = publicKeyCache.get(cacheKey);

  if (!existing) {
    existing = crypto.subtle.importKey(
      "jwk",
      publicJwk,
      HOSTED_WEB_CALLBACK_SIGNING_IMPORT_ALGORITHM,
      false,
      ["verify"],
    );
    publicKeyCache.set(cacheKey, existing);
  }

  return existing;
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new TypeError(`${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }

  return parsed;
}

function parseEcP256PrivateJwk(value: unknown, label: string): JsonWebKey {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an EC P-256 private JWK.`);
  }

  const jwk = value as JsonWebKey;

  if (
    jwk.kty !== "EC"
    || jwk.crv !== "P-256"
    || typeof jwk.x !== "string"
    || typeof jwk.y !== "string"
    || typeof jwk.d !== "string"
  ) {
    throw new TypeError(`${label} must be an EC P-256 private JWK.`);
  }

  return {
    crv: "P-256",
    d: jwk.d,
    ext: true,
    key_ops: ["sign"],
    kty: "EC",
    x: jwk.x,
    y: jwk.y,
  };
}

function encodeBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string | null): Uint8Array | null {
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

class InMemoryHostedWebCallbackNonceStore implements HostedWebCallbackNonceStore {
  private readonly seenNonces = new Map<string, number>();

  async consume(input: HostedWebCallbackNonceStoreConsumeInput): Promise<boolean> {
    for (const [key, expiresAt] of this.seenNonces) {
      if (expiresAt <= input.now) {
        this.seenNonces.delete(key);
      }
    }

    const key = [
      input.keyId,
      input.method,
      input.path,
      input.search,
      input.userId ?? "",
      input.nonceHash,
    ].join("\u0000");
    if (this.seenNonces.has(key)) {
      return false;
    }

    this.seenNonces.set(key, input.expiresAt);
    return true;
  }
}

const defaultNonceStore = new InMemoryHostedWebCallbackNonceStore();

function parseCanonicalTimestampMs(value: string | null): number | null {
  if (typeof value !== "string" || value.trim() !== value) {
    return null;
  }

  const timestampMs = Date.parse(value);

  if (!Number.isFinite(timestampMs) || new Date(timestampMs).toISOString() !== value) {
    return null;
  }

  return timestampMs;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function requireConfiguredString(value: string | undefined, label: string): string {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    throw new TypeError(`${label} is required.`);
  }

  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
