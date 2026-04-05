import {
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
} from "./contracts.ts";

const HMAC_ALGORITHM = "HMAC";
const HMAC_HASH = "SHA-256";
const ISO_UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export const DEFAULT_HOSTED_EXECUTION_MAX_TIMESTAMP_SKEW_MS = 5 * 60_000;

export async function createHostedExecutionSignature(input: {
  method?: string;
  payload: string;
  path?: string;
  search?: string;
  secret: string;
  timestamp: string;
  nonce?: string | null;
  userId?: string | null;
}): Promise<string> {
  const cryptoKey = await importHmacKey(input.secret, ["sign"]);
  const signature = await crypto.subtle.sign(
    HMAC_ALGORITHM,
    cryptoKey,
    encodeSignaturePayload({
      method: input.method,
      nonce: input.nonce,
      path: input.path,
      payload: input.payload,
      search: input.search,
      timestamp: input.timestamp,
      userId: input.userId,
    }),
  );

  return bytesToHex(signature);
}

export async function createHostedExecutionSignatureHeaders(input: {
  method?: string;
  payload: string;
  path?: string;
  search?: string;
  secret: string;
  timestamp: string;
  nonce?: string | null;
  userId?: string | null;
}): Promise<Record<string, string>> {
  const normalizedNonce = normalizeRequestNonce(input.nonce);
  const nonce = normalizedNonce.length > 0 ? normalizedNonce : createHostedExecutionNonce();

  return {
    [HOSTED_EXECUTION_SIGNATURE_HEADER]: await createHostedExecutionSignature({
      ...input,
      nonce,
    }),
    [HOSTED_EXECUTION_NONCE_HEADER]: nonce,
    [HOSTED_EXECUTION_TIMESTAMP_HEADER]: input.timestamp,
  };
}

export async function verifyHostedExecutionSignature(input: {
  method?: string;
  payload: string;
  path?: string;
  search?: string;
  secret: string;
  signature: string | null;
  timestamp: string | null;
  nonce?: string | null;
  userId?: string | null;
  nowMs?: number;
  maxTimestampSkewMs?: number;
}): Promise<boolean> {
  if (!input.signature || !input.timestamp) {
    return false;
  }

  const timestampMs = parseHostedExecutionTimestampMs(input.timestamp);

  if (timestampMs === null) {
    return false;
  }

  const nowMs = input.nowMs ?? Date.now();
  const maxTimestampSkewMs =
    input.maxTimestampSkewMs ?? DEFAULT_HOSTED_EXECUTION_MAX_TIMESTAMP_SKEW_MS;

  if (Math.abs(nowMs - timestampMs) > maxTimestampSkewMs) {
    return false;
  }

  const signatureBytes = parseHexToBytes(normalizeHex(input.signature));

  if (!signatureBytes) {
    return false;
  }

  const cryptoKey = await importHmacKey(input.secret, ["verify"]);

  return crypto.subtle.verify(
    HMAC_ALGORITHM,
    cryptoKey,
    signatureBytes,
    encodeSignaturePayload({
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

export function readHostedExecutionSignatureHeaders(headers: Headers): {
  nonce: string | null;
  signature: string | null;
  timestamp: string | null;
} {
  return {
    nonce: headers.get(HOSTED_EXECUTION_NONCE_HEADER),
    signature: headers.get(HOSTED_EXECUTION_SIGNATURE_HEADER),
    timestamp: headers.get(HOSTED_EXECUTION_TIMESTAMP_HEADER),
  };
}

async function importHmacKey(
  secret: string,
  usages: readonly KeyUsage[],
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encodeUtf8(secret),
    {
      hash: HMAC_HASH,
      name: HMAC_ALGORITHM,
    },
    false,
    [...usages],
  );
}

function encodeSignaturePayload(input: {
  method?: string;
  nonce?: string | null;
  path?: string;
  payload: string;
  search?: string;
  timestamp: string;
  userId?: string | null;
}): ArrayBuffer {
  const method = normalizeRequestMethod(input.method);
  const nonce = normalizeRequestNonce(input.nonce);
  const path = normalizeRequestPath(input.path);
  const search = normalizeRequestSearch(input.search);
  const userId = normalizeRequestUserId(input.userId);

  return encodeUtf8(JSON.stringify([
    input.timestamp,
    method,
    path,
    search,
    userId,
    nonce,
    input.payload,
  ]));
}

function normalizeRequestMethod(value: string | undefined): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().toUpperCase()
    : "POST";
}

function normalizeRequestPath(value: string | undefined): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "/";
  }

  const trimmed = value.trim();
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function normalizeRequestSearch(value: string | null | undefined): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "";
  }

  const trimmed = value.trim();
  return trimmed.startsWith("?") ? trimmed : `?${trimmed}`;
}

function normalizeRequestUserId(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function normalizeRequestNonce(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function createHostedExecutionNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeHex(value: string): string {
  return value.trim().replace(/^sha256=/iu, "").toLowerCase();
}

function parseHostedExecutionTimestampMs(value: string): number | null {
  if (value.trim() !== value || !ISO_UTC_TIMESTAMP_PATTERN.test(value)) {
    return null;
  }

  const parsedMs = Date.parse(value);

  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  return new Date(parsedMs).toISOString() === value ? parsedMs : null;
}

function bytesToHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseHexToBytes(value: string): ArrayBuffer | null {
  if (value.length === 0 || value.length % 2 !== 0 || /[^0-9a-f]/u.test(value)) {
    return null;
  }

  const buffer = new ArrayBuffer(value.length / 2);
  const bytes = new Uint8Array(buffer);

  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }

  return buffer;
}

function encodeUtf8(value: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(value);
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);
  return buffer;
}
