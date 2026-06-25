const HOSTED_PROVIDER_EGRESS_CREDENTIAL_PREFIX = "murph_provider_egress_v1";
const HOSTED_PROVIDER_EGRESS_CREDENTIAL_SCHEMA =
  "murph.hosted-provider-egress-credential.v1";
const HOSTED_PROVIDER_EGRESS_CREDENTIAL_SCOPE = "hosted_runner_provider_egress";
const HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_CONTEXT =
  "murph:hosted-provider-egress-credential:v1";
const HOSTED_PROVIDER_EGRESS_CREDENTIAL_TEXT_ENCODER = new TextEncoder();
const HOSTED_PROVIDER_EGRESS_CREDENTIAL_TEXT_DECODER = new TextDecoder();

export const HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET_ENV =
  "HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET";

export type HostedProviderEgressCredentialRejectReason =
  | "provider_egress_credential_invalid"
  | "provider_egress_credential_signature_mismatch";

export interface HostedProviderEgressCredentialClaims {
  providerKind: string;
  runnerContainerName: string;
  schema: typeof HOSTED_PROVIDER_EGRESS_CREDENTIAL_SCHEMA;
  scope: typeof HOSTED_PROVIDER_EGRESS_CREDENTIAL_SCOPE;
  userId: string;
}

export type HostedProviderEgressCredentialVerificationResult =
  | {
      claims: HostedProviderEgressCredentialClaims;
      ok: true;
    }
  | {
      ok: false;
      rejectReason: HostedProviderEgressCredentialRejectReason;
    };

export async function createHostedProviderEgressCredential(input: {
  providerKind: string;
  runnerContainerName: string;
  source: Readonly<Record<string, unknown>>;
  userId: string;
}): Promise<string> {
  const claims = normalizeHostedProviderEgressCredentialClaims({
    providerKind: input.providerKind,
    runnerContainerName: input.runnerContainerName,
    schema: HOSTED_PROVIDER_EGRESS_CREDENTIAL_SCHEMA,
    scope: HOSTED_PROVIDER_EGRESS_CREDENTIAL_SCOPE,
    userId: input.userId,
  });
  if (!claims) {
    throw new TypeError("Hosted provider egress credential claims are invalid.");
  }

  const payload = base64UrlEncodeJson(claims);
  const signingInput = `${HOSTED_PROVIDER_EGRESS_CREDENTIAL_PREFIX}.${payload}`;
  const signature = await signHostedProviderEgressCredential({
    signingInput,
    source: input.source,
  });
  return `${signingInput}.${signature}`;
}

export function isHostedProviderEgressCredential(value: string): boolean {
  return value.startsWith(`${HOSTED_PROVIDER_EGRESS_CREDENTIAL_PREFIX}.`);
}

export async function verifyHostedProviderEgressCredential(input: {
  credential: string;
  source: Readonly<Record<string, unknown>>;
}): Promise<HostedProviderEgressCredentialVerificationResult> {
  const segments = input.credential.split(".");
  if (segments.length !== 3 || segments[0] !== HOSTED_PROVIDER_EGRESS_CREDENTIAL_PREFIX) {
    return { ok: false, rejectReason: "provider_egress_credential_invalid" };
  }

  const [prefix, payload, signature] = segments;
  if (!payload || !signature) {
    return { ok: false, rejectReason: "provider_egress_credential_invalid" };
  }

  const expectedSignature = await signHostedProviderEgressCredential({
    signingInput: `${prefix}.${payload}`,
    source: input.source,
  });
  if (!timingSafeEqual(signature, expectedSignature)) {
    return {
      ok: false,
      rejectReason: "provider_egress_credential_signature_mismatch",
    };
  }

  const rawClaims = decodeBase64UrlJson(payload);
  const claims = normalizeHostedProviderEgressCredentialClaims(rawClaims);
  if (!claims) {
    return { ok: false, rejectReason: "provider_egress_credential_invalid" };
  }

  return { claims, ok: true };
}

function normalizeHostedProviderEgressCredentialClaims(
  value: unknown,
): HostedProviderEgressCredentialClaims | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record.schema !== HOSTED_PROVIDER_EGRESS_CREDENTIAL_SCHEMA
    || record.scope !== HOSTED_PROVIDER_EGRESS_CREDENTIAL_SCOPE
    || !isProviderKindValue(record.providerKind)
    || !isCredentialIdentityValue(record.userId)
    || !isCredentialIdentityValue(record.runnerContainerName)
  ) {
    return null;
  }
  return {
    providerKind: record.providerKind.trim(),
    runnerContainerName: record.runnerContainerName.trim(),
    schema: HOSTED_PROVIDER_EGRESS_CREDENTIAL_SCHEMA,
    scope: HOSTED_PROVIDER_EGRESS_CREDENTIAL_SCOPE,
    userId: record.userId.trim(),
  };
}

function isProviderKindValue(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(value.trim());
}

function isCredentialIdentityValue(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 1024;
}

async function signHostedProviderEgressCredential(input: {
  signingInput: string;
  source: Readonly<Record<string, unknown>>;
}): Promise<string> {
  const secret = readHostedProviderEgressCredentialSigningSecret(input.source);
  const key = await crypto.subtle.importKey(
    "raw",
    HOSTED_PROVIDER_EGRESS_CREDENTIAL_TEXT_ENCODER.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const payload = HOSTED_PROVIDER_EGRESS_CREDENTIAL_TEXT_ENCODER.encode(
    `${HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_CONTEXT}\0${input.signingInput}`,
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, payload));
  return bytesToBase64Url(signature);
}

function readHostedProviderEgressCredentialSigningSecret(
  source: Readonly<Record<string, unknown>>,
): string {
  const value = source[HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET_ENV];
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error(
      `Hosted provider egress credential signing requires ${HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET_ENV}.`,
    );
  }
  return normalized;
}

function base64UrlEncodeJson(value: HostedProviderEgressCredentialClaims): string {
  return bytesToBase64Url(
    HOSTED_PROVIDER_EGRESS_CREDENTIAL_TEXT_ENCODER.encode(JSON.stringify(value)),
  );
}

function decodeBase64UrlJson(value: string): unknown {
  const bytes = base64UrlToBytes(value);
  if (!bytes) {
    return null;
  }
  try {
    return JSON.parse(HOSTED_PROVIDER_EGRESS_CREDENTIAL_TEXT_DECODER.decode(bytes));
  } catch {
    return null;
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    return null;
  }
  const remainder = value.length % 4;
  if (remainder === 1) {
    return null;
  }
  const padded = `${value.replaceAll("-", "+").replaceAll("_", "/")}${
    remainder === 0 ? "" : "=".repeat(4 - remainder)
  }`;
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = HOSTED_PROVIDER_EGRESS_CREDENTIAL_TEXT_ENCODER.encode(left);
  const rightBytes = HOSTED_PROVIDER_EGRESS_CREDENTIAL_TEXT_ENCODER.encode(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    diff |= leftBytes[index] ^ rightBytes[index];
  }
  return diff === 0;
}
