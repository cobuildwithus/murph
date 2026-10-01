import {
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
} from "./contracts.ts";

// Query material already participates in the callback signature. Using it keeps
// consumer-first deployment compatible with the existing signing protocol.
const RUNTIME_AUTHORITY_QUERY = "runtimeAuthority";
const RUNTIME_AUTHORITY_FIELDS = [
  ["runtimeAttempt", "x-hosted-runtime-attempt-id"],
  ["runtimeGeneration", "x-hosted-runtime-lease-generation"],
  ["runtimeWorkspaceVersion", "x-hosted-runtime-workspace-version"],
] as const;

export interface HostedExecutionRuntimeAuthority {
  attemptId: string;
  generation: string;
  workspaceVersion: string | null;
}

/** Read only after callback signature verification. Unsigned legacy headers
 * deliberately do not establish Postgres runtime authority.
 */
export function readHostedExecutionRuntimeAuthority(
  url: URL,
  headers: Headers,
): HostedExecutionRuntimeAuthority | null {
  const query = url.searchParams;
  if (!query.has(RUNTIME_AUTHORITY_QUERY)) {
    if (RUNTIME_AUTHORITY_FIELDS.some(([name]) => query.has(name))) {
      throw new TypeError("Hosted runtime authority is incomplete.");
    }
    return null;
  }
  if (query.getAll(RUNTIME_AUTHORITY_QUERY).length !== 1
    || query.get(RUNTIME_AUTHORITY_QUERY) !== "1") {
    throw new TypeError("Hosted runtime authority version is invalid.");
  }
  for (const [name, header] of RUNTIME_AUTHORITY_FIELDS) {
    if (query.getAll(name).length > 1
      || (headers.has(header) && headers.get(header) !== query.get(name))) {
      throw new TypeError("Hosted runtime authority identities conflict.");
    }
  }
  const attemptId = query.get("runtimeAttempt") ?? "";
  const generation = query.get("runtimeGeneration") ?? "";
  const workspaceVersion = query.get("runtimeWorkspaceVersion");
  if (!/^[A-Za-z0-9._:-]{1,200}$/u.test(attemptId)
    || !isRuntimeAuthorityCounter(generation)
    || (workspaceVersion !== null && !isRuntimeAuthorityCounter(workspaceVersion))) {
    throw new TypeError("Hosted runtime authority identity is invalid.");
  }
  return { attemptId, generation, workspaceVersion };
}

/** The Worker signs these values after deriving member/binding authority. */
export function addHostedExecutionRuntimeAuthority(
  url: URL,
  authority: HostedExecutionRuntimeAuthority,
): void {
  url.searchParams.set(RUNTIME_AUTHORITY_QUERY, "1");
  url.searchParams.set("runtimeAttempt", authority.attemptId);
  url.searchParams.set("runtimeGeneration", authority.generation);
  if (authority.workspaceVersion === null) url.searchParams.delete("runtimeWorkspaceVersion");
  else url.searchParams.set("runtimeWorkspaceVersion", authority.workspaceVersion);
  readHostedExecutionRuntimeAuthority(url, new Headers());
}

function isRuntimeAuthorityCounter(value: string): boolean {
  return /^(?:0|[1-9]\d{0,18})$/u.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n;
}

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
