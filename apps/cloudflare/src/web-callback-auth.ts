import {
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  encodeHostedExecutionSignedRequestPayload,
} from "@murphai/hosted-execution";

const DEFAULT_HOSTED_WEB_CALLBACK_SIGNING_KEY_ID = "v1";
const HOSTED_WEB_CALLBACK_SIGNING_IMPORT_ALGORITHM: EcKeyImportParams = {
  name: "ECDSA",
  namedCurve: "P-256",
};
const HOSTED_WEB_CALLBACK_SIGNING_ALGORITHM: EcdsaParams = {
  name: "ECDSA",
  hash: "SHA-256",
};

type EnvSource = Readonly<Record<string, string | undefined>>;

export interface HostedWebCallbackSigningEnvironment {
  keyId: string;
  privateKeyJwkJson: string;
}

const privateKeyCache = new Map<string, Promise<CryptoKey>>();

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

function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
