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
} from "@murphai/query/browser-replica-client";
import {
  getHostedBrowserVaultReplicaStorageKeyId,
  parseHostedBrowserVaultReplicaRef,
  type HostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/browser-vault";

import type { SensitiveActionAuthorization } from "@/src/lib/sensitive-actions/shared";

import { browserVaultReplicaRefsMatch } from "./ref";

export type BrowserVaultFreshness = "fresh" | "stale";

export interface BrowserVaultSessionMetadata {
  deviceSyncImportPending: boolean;
  freshness: BrowserVaultFreshness;
  refreshPending: boolean;
  workspaceVersion: string | null;
}

export type BrowserVaultSessionLoadResult =
  | (BrowserVaultSessionMetadata & { memberId: string | null; state: "empty" })
  | (BrowserVaultSessionMetadata & {
      memberId: string;
      replicaRef: HostedBrowserVaultReplicaRef;
      state: "not_modified";
    })
  | (BrowserVaultSessionMetadata & {
      client: BrowserVaultQueryClient;
      memberId: string;
      replicaRef: HostedBrowserVaultReplicaRef;
      state: "ready";
    })
  | { state: "identity_changed" };

export interface LoadBrowserVaultReplicaInput {
  authorization?: SensitiveActionAuthorization;
  emptyOnUnauthorized?: boolean;
  endpoint?: string;
  expectedMemberId?: string | null;
  fetchImpl?: typeof fetch;
  knownReplicaRef: HostedBrowserVaultReplicaRef | null;
  requestRefresh?: boolean;
  signal?: AbortSignal;
}

export class BrowserVaultUnauthorizedError extends Error {
  readonly status: 401 | 403;

  constructor(status: 401 | 403, message: string) {
    super(`Browser vault session failed with HTTP ${status}: ${message}`);
    this.name = "BrowserVaultUnauthorizedError";
    this.status = status;
  }
}

const textDecoder = new TextDecoder();

export async function loadBrowserVaultReplica({
  authorization,
  emptyOnUnauthorized = true,
  endpoint = "/api/browser-vault/session",
  expectedMemberId,
  fetchImpl = fetch,
  knownReplicaRef,
  requestRefresh = false,
  signal,
}: LoadBrowserVaultReplicaInput): Promise<BrowserVaultSessionLoadResult> {
  assertNotAborted(signal);

  const { privateKeyJwk, publicKeyJwk } = await generateHostedUserRecipientKeyPair();
  assertNotAborted(signal);

  const response = await fetchImpl(endpoint, {
    body: JSON.stringify({
      acceptStaleReplica: true,
      ...(authorization ? { authorization } : {}),
      browserPublicKeyJwk: publicKeyJwk,
      knownReplicaRef,
      ...(requestRefresh ? { requestRefresh: true } : {}),
    }),
    credentials: "same-origin",
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    method: "POST",
    signal,
  });

  if (response.status === 401 || response.status === 403) {
    if (emptyOnUnauthorized) {
      return createEmptyLoadResult();
    }

    const status = response.status === 401 ? 401 : 403;
    throw new BrowserVaultUnauthorizedError(
      status,
      await readJsonErrorMessage(response),
    );
  }

  if (!response.ok) {
    throw new Error(await readJsonErrorMessage(response));
  }

  assertNotAborted(signal);
  const sessionValue: unknown = await response.json();
  assertNotAborted(signal);
  const session = parseBrowserVaultSessionResponse(sessionValue);
  const responseMemberId = session.state === "ready"
    ? session.replicaAad.userId
    : session.memberId;

  if (
    expectedMemberId !== undefined
    && responseMemberId !== expectedMemberId
  ) {
    return { state: "identity_changed" };
  }

  if (session.state === "empty") {
    return {
      deviceSyncImportPending: session.deviceSyncImportPending,
      freshness: session.freshness,
      memberId: session.memberId,
      refreshPending: session.refreshPending,
      state: "empty",
      workspaceVersion: session.workspaceVersion,
    };
  }

  if (session.state === "not_modified") {
    if (!knownReplicaRef) {
      throw new Error("Browser vault unchanged session response did not have a known replica ref.");
    }

    const responseReplicaRef = session.replicaRef.generation === undefined
      && knownReplicaRef.generation !== undefined
      ? { ...session.replicaRef, generation: knownReplicaRef.generation }
      : session.replicaRef;
    if (!browserVaultReplicaRefsMatch(responseReplicaRef, knownReplicaRef)) {
      throw new Error("Browser vault unchanged session ref did not match the known ref.");
    }

    return {
      deviceSyncImportPending: session.deviceSyncImportPending,
      freshness: session.freshness,
      memberId: session.memberId,
      replicaRef: knownReplicaRef,
      refreshPending: session.refreshPending,
      state: "not_modified",
      workspaceVersion: session.workspaceVersion,
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
      dataKeyId: session.replicaAad.dataKeyId,
      dataKeyRootKeyId: session.replicaAad.dataKeyRootKeyId,
      dataVersion: session.replicaAad.dataVersion,
      objectKey: session.replicaAad.objectKey,
      purpose: session.replicaAad.purpose,
      runtimeRootKeyId: session.replicaAad.runtimeRootKeyId,
      schema: session.replicaAad.schema,
      sourceBundleHash: session.replicaAad.sourceBundleHash,
      userId: session.replicaAad.userId,
    }),
    envelope: session.encryptedReplica,
    expectedKeyId: getHostedBrowserVaultReplicaStorageKeyId(session.replicaRef),
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

  const replicaRef = session.replicaRef.generation === undefined
    && replica.generation !== undefined
    ? { ...session.replicaRef, generation: replica.generation }
    : session.replicaRef;

  if (replica.generation !== replicaRef.generation) {
    throw new Error("Browser vault replica generation did not match its session ref.");
  }

  if (replica.source.sourceBundleHash !== session.replicaRef.sourceBundleHash) {
    throw new Error("Browser vault replica sourceBundleHash did not match its session ref.");
  }

  return {
    client: createBrowserVaultQueryClient(replica),
    deviceSyncImportPending: session.deviceSyncImportPending,
    freshness: session.freshness,
    memberId: session.replicaAad.userId,
    replicaRef,
    refreshPending: session.refreshPending,
    state: "ready",
    workspaceVersion: session.workspaceVersion,
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

export function isBrowserVaultUnauthorizedError(
  error: unknown,
): error is BrowserVaultUnauthorizedError {
  return error instanceof BrowserVaultUnauthorizedError;
}

export type BrowserVaultSessionResponse =
  | {
      encryptedReplica: null;
      deviceSyncImportPending: boolean;
      freshness: BrowserVaultFreshness;
      memberId: string;
      replicaAad: null;
      replicaKeyEnvelope: null;
      replicaRef: null;
      refreshPending: boolean;
      state: "empty";
      workspaceVersion: string | null;
    }
  | {
      encryptedReplica: null;
      deviceSyncImportPending: boolean;
      freshness: BrowserVaultFreshness;
      memberId: string;
      replicaAad: null;
      replicaKeyEnvelope: null;
      replicaRef: HostedBrowserVaultReplicaRef;
      refreshPending: boolean;
      state: "not_modified";
      workspaceVersion: string | null;
    }
  | {
      encryptedReplica: HostedCipherEnvelope;
      deviceSyncImportPending: boolean;
      freshness: BrowserVaultFreshness;
      replicaAad: BrowserVaultReplicaAad;
      replicaKeyEnvelope: HostedBrowserSessionKeyEnvelope;
      replicaRef: HostedBrowserVaultReplicaRef;
      refreshPending: boolean;
      state: "ready";
      workspaceVersion: string | null;
    };

export function parseBrowserVaultSessionResponse(value: unknown): BrowserVaultSessionResponse {
  const record = requireRecord(value, "Browser vault session response");
  const state = requireNonEmptyString(record.state, "Browser vault session response state");

  if (state === "empty") {
    assertBrowserVaultSessionPayloadFieldsNull(record, "Browser vault session response");
    requireNull(record.replicaRef, "Browser vault session response.replicaRef");

    return {
      encryptedReplica: null,
      deviceSyncImportPending: readOptionalBoolean(
        record.deviceSyncImportPending,
        false,
        "deviceSyncImportPending",
      ),
      freshness: parseBrowserVaultFreshness(record.freshness, "stale"),
      memberId: requireNonEmptyString(
        record.memberId,
        "Browser vault session response.memberId",
      ),
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: null,
      refreshPending: readOptionalBoolean(record.refreshPending, false, "refreshPending"),
      state,
      workspaceVersion: readOptionalNullableString(record.workspaceVersion, "Browser vault session response.workspaceVersion"),
    };
  }

  if (state === "not_modified") {
    assertBrowserVaultSessionPayloadFieldsNull(record, "Browser vault session response");

    return {
      encryptedReplica: null,
      deviceSyncImportPending: readOptionalBoolean(
        record.deviceSyncImportPending,
        false,
        "deviceSyncImportPending",
      ),
      freshness: parseBrowserVaultFreshness(record.freshness, "fresh"),
      memberId: requireNonEmptyString(
        record.memberId,
        "Browser vault session response.memberId",
      ),
      replicaAad: null,
      replicaKeyEnvelope: null,
      replicaRef: parseRequiredReplicaRef(record.replicaRef, "Browser vault session response replicaRef"),
      refreshPending: readOptionalBoolean(record.refreshPending, false, "refreshPending"),
      state,
      workspaceVersion: readOptionalNullableString(record.workspaceVersion, "Browser vault session response.workspaceVersion"),
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
    deviceSyncImportPending: readOptionalBoolean(
      record.deviceSyncImportPending,
      false,
      "deviceSyncImportPending",
    ),
    freshness: parseBrowserVaultFreshness(record.freshness, "fresh"),
    replicaAad: parseBrowserVaultReplicaAad(
      record.replicaAad,
      "Browser vault session response replicaAad",
    ),
    replicaKeyEnvelope: parseHostedBrowserSessionKeyEnvelope(
      record.replicaKeyEnvelope,
      "Browser vault session response replicaKeyEnvelope",
    ),
    replicaRef: parseRequiredReplicaRef(record.replicaRef, "Browser vault session response replicaRef"),
    refreshPending: readOptionalBoolean(record.refreshPending, false, "refreshPending"),
    state,
    workspaceVersion: readOptionalNullableString(record.workspaceVersion, "Browser vault session response.workspaceVersion"),
  };
}

export interface BrowserVaultReplicaAad {
  dataKeyId?: string;
  dataKeyRootKeyId?: string;
  dataVersion: string;
  objectKey: string;
  purpose: "browser-vault-replica";
  runtimeRootKeyId: string;
  schema: "murph.browser-vault-replica";
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

  if (!input.ref.runtimeRootKeyId) {
    throw new Error("Browser vault replica ref is missing runtimeRootKeyId.");
  }

  if (input.aad.runtimeRootKeyId !== input.ref.runtimeRootKeyId) {
    throw new Error("Browser vault replica AAD runtimeRootKeyId did not match its session ref.");
  }

  const dataKeyEnvelope = input.ref.dataKeyEnvelope;
  if (!dataKeyEnvelope) {
    return;
  }

  if (input.aad.dataKeyId !== dataKeyEnvelope.dataKeyId) {
    throw new Error("Browser vault replica AAD dataKeyId did not match its session ref.");
  }

  if (input.aad.dataKeyRootKeyId !== dataKeyEnvelope.rootKeyId) {
    throw new Error("Browser vault replica AAD dataKeyRootKeyId did not match its session ref.");
  }
}

function parseBrowserVaultReplicaAad(value: unknown, label: string): BrowserVaultReplicaAad {
  const record = requireRecord(value, label);
  const purpose = requireNonEmptyString(record.purpose, `${label}.purpose`);
  const schema = requireNonEmptyString(record.schema, `${label}.schema`);

  if (purpose !== "browser-vault-replica") {
    throw new TypeError(`${label}.purpose must be browser-vault-replica.`);
  }
  if (schema !== "murph.browser-vault-replica") {
    throw new TypeError(`${label}.schema must be murph.browser-vault-replica.`);
  }

  return {
    ...(record.dataKeyId === undefined
      ? {}
      : { dataKeyId: requireNonEmptyString(record.dataKeyId, `${label}.dataKeyId`) }),
    ...(record.dataKeyRootKeyId === undefined
      ? {}
      : {
          dataKeyRootKeyId: requireNonEmptyString(
            record.dataKeyRootKeyId,
            `${label}.dataKeyRootKeyId`,
          ),
        }),
    dataVersion: requireNonEmptyString(record.dataVersion, `${label}.dataVersion`),
    objectKey: requireNonEmptyString(record.objectKey, `${label}.objectKey`),
    purpose,
    runtimeRootKeyId: requireNonEmptyString(record.runtimeRootKeyId, `${label}.runtimeRootKeyId`),
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

function createEmptyLoadResult(): Extract<BrowserVaultSessionLoadResult, { state: "empty" }> {
  return {
    deviceSyncImportPending: false,
    freshness: "stale",
    memberId: null,
    refreshPending: false,
    state: "empty",
    workspaceVersion: null,
  };
}

function parseBrowserVaultFreshness(
  value: unknown,
  fallback: BrowserVaultFreshness,
): BrowserVaultFreshness {
  if (value === undefined) {
    return fallback;
  }

  if (value === "fresh" || value === "stale") {
    return value;
  }

  throw new TypeError("Browser vault session response freshness must be fresh or stale.");
}

function readOptionalBoolean(value: unknown, fallback: boolean, fieldName: string): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "boolean") {
    throw new TypeError(`Browser vault session response ${fieldName} must be a boolean.`);
  }

  return value;
}

function readOptionalNullableString(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return requireNonEmptyString(value, label);
}
