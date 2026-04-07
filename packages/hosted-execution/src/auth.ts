import {
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
} from "./contracts.ts";

export function readHostedExecutionSignatureHeaders(headers: Headers): {
  keyId: string | null;
  nonce: string | null;
  signature: string | null;
  timestamp: string | null;
} {
  return {
    keyId: headers.get(HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER),
    nonce: headers.get(HOSTED_EXECUTION_NONCE_HEADER),
    signature: headers.get(HOSTED_EXECUTION_SIGNATURE_HEADER),
    timestamp: headers.get(HOSTED_EXECUTION_TIMESTAMP_HEADER),
  };
}

export function encodeHostedExecutionSignedRequestPayload(input: {
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

function encodeUtf8(value: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(value);
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);
  return buffer;
}
