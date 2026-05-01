import {
  buildHostedStorageAad,
  decryptHostedStoragePayload,
  generateHostedUserRecipientKeyPair,
  parseHostedBrowserSessionKeyEnvelope,
  parseHostedCipherEnvelope,
  unwrapHostedBrowserSessionKey,
  type HostedBrowserSessionKeyEnvelope,
  type HostedCipherEnvelope,
} from "@murphai/runtime-state";
import {
  createBrowserVaultQueryClient,
  parseBrowserVaultReplica,
  type BrowserVaultQueryClient,
} from "@murphai/query/browser";
import {
  parseHostedBrowserVaultReplicaRef,
  type HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/browser-vault";

import { browserVaultReplicaRefsMatch } from "./ref";

export type BrowserVaultSessionLoadResult =
  | { state: "empty" }
  | { replicaRef: HostedBrowserVaultReplicaRef; state: "not_modified" }
  | { client: BrowserVaultQueryClient; replicaRef: HostedBrowserVaultReplicaRef; state: "ready" };

export interface LoadBrowserVaultReplicaInput {
  endpoint?: string;
  fetchImpl?: typeof fetch;
  knownReplicaRef: HostedBrowserVaultReplicaRef | null;
  signal?: AbortSignal;
}

const textDecoder = new TextDecoder();

export async function loadBrowserVaultReplica({
  endpoint = "/api/browser-vault/session",
  fetchImpl = fetch,
  knownReplicaRef,
  signal,
}: LoadBrowserVaultReplicaInput): Promise<BrowserVaultSessionLoadResult> {
  assertNotAborted(signal);

  const { privateKeyJwk, publicKeyJwk } = await generateHostedUserRecipientKeyPair();
  assertNotAborted(signal);

  const response = await fetchImpl(endpoint, {
    body: JSON.stringify({
      browserPublicKeyJwk: publicKeyJwk,
      knownReplicaRef,
    }),
    credentials: "same-origin",
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
    signal,
  });

  if (response.status === 401 || response.status === 403) {
    return { state: "empty" };
  }

  if (!response.ok) {
    throw new Error(await readJsonErrorMessage(response));
  }

  assertNotAborted(signal);
  const sessionValue: unknown = await response.json();
  assertNotAborted(signal);
  const session = parseBrowserVaultSessionResponse(sessionValue);

  if (session.state === "empty") {
    return { state: "empty" };
  }

  if (session.state === "not_modified") {
    assertBrowserVaultReplicaRefsMatch({
      actual: session.replicaRef,
      expected: knownReplicaRef,
      label: "Browser vault unchanged session",
    });

    return {
      replicaRef: session.replicaRef,
      state: "not_modified",
    };
  }

  assertBrowserVaultReplicaAadMatchesRef({
    aad: session.replicaAad,
    ref: session.replicaRef,
  });

  const replicaKey = await unwrapHostedBrowserSessionKey({
    envelope: session.replicaKeyEnvelope,
    recipientPrivateKeyJwk: privateKeyJwk,
  });
  assertNotAborted(signal);

  const plaintext = await decryptHostedStoragePayload({
    aad: buildHostedStorageAad({
      dataVersion: session.replicaAad.dataVersion,
      objectKey: session.replicaAad.objectKey,
      purpose: session.replicaAad.purpose,
      schema: session.replicaAad.schema,
      sourceBundleHash: session.replicaAad.sourceBundleHash,
      userId: session.replicaAad.userId,
    }),
    envelope: session.encryptedReplica,
    expectedKeyId: session.replicaRef.keyId,
    key: replicaKey,
    scope: "browser-vault-replica",
  });
  assertNotAborted(signal);

  const replica = parseBrowserVaultReplica(
    JSON.parse(textDecoder.decode(plaintext)),
  );

  if (replica.source.dataVersion !== session.replicaRef.dataVersion) {
    throw new Error("Browser vault replica dataVersion did not match its session ref.");
  }

  if (replica.source.sourceBundleHash !== session.replicaRef.sourceBundleHash) {
    throw new Error("Browser vault replica sourceBundleHash did not match its session ref.");
  }

  return {
    client: createBrowserVaultQueryClient(replica),
    replicaRef: session.replicaRef,
    state: "ready",
  };
}

export function normalizeBrowserVaultError(error: unknown): string {
  if (isBrowserVaultAbortError(error)) {
    return "Your dashboard data is not available right now.";
  }

  const message = error instanceof Error ? error.message : "";

  if (/HTTP 401|HTTP 403/u.test(message)) {
    return "Your dashboard session expired. Refresh and try again.";
  }

  if (/HTTP 404/u.test(message)) {
    return "Your dashboard data is not available yet.";
  }

  return "Your dashboard data is not available right now.";
}

export function isBrowserVaultAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  return Reflect.get(error, "name") === "AbortError";
}

export type BrowserVaultSessionResponse =
  | {
      encryptedReplica: null;
      replicaAad: null;
      replicaKeyEnvelope: null;
      replicaRef: null;
      state: "empty";
    }
  | {
      encryptedReplica: null;
      replicaAad: null;
      replicaKeyEnvelope: null;
      replicaRef: HostedBrowserVaultReplicaRef;
      state: "not_modified";
    }
  | {
      encryptedReplica: HostedCipherEnvelope;
      replicaAad: BrowserVaultReplicaAad;
      replicaKeyEnvelope: HostedBrowserSessionKeyEnvelope;
      replicaRef: HostedBrowserVaultReplicaRef;
      state: "ready";
    };

export function parseBrowserVaultSessionResponse(value: unknown): BrowserVaultSessionResponse {
  const record = requireRecord(value, "Browser vault session response");
  const state = requireNonEmptyString(record.state, "Browser vault session response state");

  if (state === "empty") {
    assertBrowserVaultSessionPayloadFieldsNull(record, "Browser vault session response");
    requireNull(record.replicaRef, "Browser vault session response.replicaRef");

    return {
      encryptedReplica: null,
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: null,
      state,
    };
  }

  if (state === "not_modified") {
    assertBrowserVaultSessionPayloadFieldsNull(record, "Browser vault session response");

    return {
      encryptedReplica: null,
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: parseRequiredReplicaRef(record.replicaRef, "Browser vault session response replicaRef"),
      state,
    };
  }

  if (state !== "ready") {
    throw new TypeError("Browser vault session response state must be empty, not_modified, or ready.");
  }

  return {
    encryptedReplica: parseHostedCipherEnvelope(
      record.encryptedReplica,
      "Browser vault session response encryptedReplica",
    ),
    replicaAad: parseBrowserVaultReplicaAad(
      record.replicaAad,
      "Browser vault session response replicaAad",
    ),
    replicaKeyEnvelope: parseHostedBrowserSessionKeyEnvelope(
      record.replicaKeyEnvelope,
      "Browser vault session response replicaKeyEnvelope",
    ),
    replicaRef: parseRequiredReplicaRef(record.replicaRef, "Browser vault session response replicaRef"),
    state,
  };
}

export interface BrowserVaultReplicaAad {
  dataVersion: string;
  objectKey: string;
  purpose: "browser-vault-replica";
  schema: "murph.browser-vault-replica.v1";
  sourceBundleHash: string;
  userId: string;
}

function assertBrowserVaultReplicaAadMatchesRef(input: {
  aad: BrowserVaultReplicaAad;
  ref: HostedBrowserVaultReplicaRef;
}): void {
  if (input.aad.dataVersion !== input.ref.dataVersion) {
    throw new Error("Browser vault replica AAD dataVersion did not match its session ref.");
  }

  if (input.aad.objectKey !== input.ref.objectKey) {
    throw new Error("Browser vault replica AAD objectKey did not match its session ref.");
  }

  if (input.aad.sourceBundleHash !== input.ref.sourceBundleHash) {
    throw new Error("Browser vault replica AAD sourceBundleHash did not match its session ref.");
  }
}

function assertBrowserVaultReplicaRefsMatch(input: {
  actual: HostedBrowserVaultReplicaRef;
  expected: HostedBrowserVaultReplicaRef | null;
  label: string;
}): void {
  if (!input.expected) {
    throw new Error(`${input.label} response did not have a known replica ref.`);
  }

  if (!browserVaultReplicaRefsMatch(input.actual, input.expected)) {
    throw new Error(`${input.label} ref did not match the known ref.`);
  }
}

function parseBrowserVaultReplicaAad(value: unknown, label: string): BrowserVaultReplicaAad {
  const record = requireRecord(value, label);
  const purpose = requireNonEmptyString(record.purpose, `${label}.purpose`);
  const schema = requireNonEmptyString(record.schema, `${label}.schema`);

  if (purpose !== "browser-vault-replica") {
    throw new TypeError(`${label}.purpose must be browser-vault-replica.`);
  }
  if (schema !== "murph.browser-vault-replica.v1") {
    throw new TypeError(`${label}.schema must be murph.browser-vault-replica.v1.`);
  }

  return {
    dataVersion: requireNonEmptyString(record.dataVersion, `${label}.dataVersion`),
    objectKey: requireNonEmptyString(record.objectKey, `${label}.objectKey`),
    purpose,
    schema,
    sourceBundleHash: requireNonEmptyString(record.sourceBundleHash, `${label}.sourceBundleHash`),
    userId: requireNonEmptyString(record.userId, `${label}.userId`),
  };
}

function parseRequiredReplicaRef(value: unknown, label: string): HostedBrowserVaultReplicaRef {
  const ref = parseHostedBrowserVaultReplicaRef(value, label);

  if (!ref) {
    throw new TypeError(`${label} must not be null.`);
  }

  return ref;
}

async function readJsonErrorMessage(response: Response): Promise<string> {
  try {
    const value = await response.json();
    const record = requireRecord(value, "Browser vault error response");
    const message = record.error;
    const nestedMessage = message && typeof message === "object" && !Array.isArray(message)
      ? (message as Record<string, unknown>).message
      : null;

    return typeof message === "string" && message.trim().length > 0
      ? message
      : typeof nestedMessage === "string" && nestedMessage.trim().length > 0
        ? nestedMessage
      : `Browser vault session failed with HTTP ${response.status}.`;
  } catch {
    return `Browser vault session failed with HTTP ${response.status}.`;
  }
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error("Browser vault load was aborted.");
  error.name = "AbortError";
  throw error;
}

function assertBrowserVaultSessionPayloadFieldsNull(
  record: Record<string, unknown>,
  label: string,
): void {
  requireNull(record.encryptedReplica, `${label}.encryptedReplica`);
  requireNull(record.replicaAad, `${label}.replicaAad`);
  requireNull(record.replicaKeyEnvelope, `${label}.replicaKeyEnvelope`);
}

function requireNull(value: unknown, label: string): null {
  if (value !== null) {
    throw new TypeError(`${label} must be null.`);
  }

  return null;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}
