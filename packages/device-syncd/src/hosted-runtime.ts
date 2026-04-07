import { sanitizeStoredDeviceSyncMetadata } from "./shared.ts";

export const HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_SNAPSHOT_PATH =
  "/api/internal/device-sync/runtime/snapshot";
export const HOSTED_EXECUTION_DEVICE_SYNC_RUNTIME_APPLY_PATH =
  "/api/internal/device-sync/runtime/apply";

export interface HostedExecutionDeviceSyncConnectLinkResponse {
  authorizationUrl: string;
  expiresAt: string;
  provider: string;
  providerLabel: string;
}

export interface HostedExecutionDeviceSyncRuntimeTokenBundle {
  accessToken: string;
  accessTokenExpiresAt: string | null;
  keyVersion: string;
  refreshToken: string | null;
  tokenVersion: number;
}

export interface HostedExecutionDeviceSyncRuntimeConnectionStateSnapshot {
  accessTokenExpiresAt: string | null;
  connectedAt: string;
  createdAt: string;
  displayName: string | null;
  externalAccountId: string;
  id: string;
  metadata: Record<string, unknown>;
  provider: string;
  scopes: string[];
  status: "active" | "reauthorization_required" | "disconnected";
  updatedAt?: string;
}

export interface HostedExecutionDeviceSyncRuntimeLocalStateSnapshot {
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastSyncCompletedAt: string | null;
  lastSyncErrorAt: string | null;
  lastSyncStartedAt: string | null;
  lastWebhookAt: string | null;
  nextReconcileAt: string | null;
}

export interface HostedExecutionDeviceSyncRuntimeConnectionSnapshot {
  connection: HostedExecutionDeviceSyncRuntimeConnectionStateSnapshot;
  localState: HostedExecutionDeviceSyncRuntimeLocalStateSnapshot;
  tokenBundle: HostedExecutionDeviceSyncRuntimeTokenBundle | null;
}

export interface HostedExecutionDeviceSyncRuntimeConnectionSeed {
  connection: HostedExecutionDeviceSyncRuntimeConnectionStateSnapshot;
  localState: HostedExecutionDeviceSyncRuntimeLocalStateSnapshot;
  tokenBundle: HostedExecutionDeviceSyncRuntimeTokenBundle | null;
}

export interface HostedExecutionDeviceSyncRuntimeSnapshotRequest {
  connectionId?: string | null;
  provider?: string | null;
  userId: string;
}

export interface HostedExecutionDeviceSyncRuntimeSnapshotResponse {
  connections: HostedExecutionDeviceSyncRuntimeConnectionSnapshot[];
  generatedAt: string;
  userId: string;
}

export interface HostedExecutionDeviceSyncRuntimeConnectionStateUpdate {
  displayName?: string | null;
  metadata?: Record<string, unknown>;
  scopes?: string[];
  status?: "active" | "reauthorization_required" | "disconnected";
}

export interface HostedExecutionDeviceSyncRuntimeLocalStateUpdate {
  clearError?: boolean;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  lastSyncCompletedAt?: string | null;
  lastSyncErrorAt?: string | null;
  lastSyncStartedAt?: string | null;
  lastWebhookAt?: string | null;
  nextReconcileAt?: string | null;
}

export interface HostedExecutionDeviceSyncRuntimeConnectionUpdate {
  connectionId: string;
  connection?: HostedExecutionDeviceSyncRuntimeConnectionStateUpdate;
  localState?: HostedExecutionDeviceSyncRuntimeLocalStateUpdate;
  observedUpdatedAt?: string | null;
  observedTokenVersion?: number | null;
  seed?: HostedExecutionDeviceSyncRuntimeConnectionSeed;
  tokenBundle?: HostedExecutionDeviceSyncRuntimeTokenBundle | null;
}

export interface HostedExecutionDeviceSyncRuntimeApplyRequest {
  occurredAt?: string | null;
  updates: HostedExecutionDeviceSyncRuntimeConnectionUpdate[];
  userId: string;
}

export interface HostedExecutionDeviceSyncRuntimeApplyEntry {
  connection: HostedExecutionDeviceSyncRuntimeConnectionSnapshot["connection"] | null;
  connectionId: string;
  status: "created" | "missing" | "updated";
  tokenUpdate: "applied" | "cleared" | "missing" | "skipped_version_mismatch" | "unchanged";
}

export interface HostedExecutionDeviceSyncRuntimeApplyResponse {
  appliedAt: string;
  updates: HostedExecutionDeviceSyncRuntimeApplyEntry[];
  userId: string;
}

export interface HostedExecutionDeviceSyncJobHint {
  availableAt?: string;
  dedupeKey?: string | null;
  kind: string;
  maxAttempts?: number;
  payload?: Record<string, unknown>;
  priority?: number;
}

export interface HostedExecutionDeviceSyncWakeHint {
  eventType?: string | null;
  jobs?: HostedExecutionDeviceSyncJobHint[];
  nextReconcileAt?: string | null;
  occurredAt?: string | null;
  reason?: string | null;
  resourceCategory?: string | null;
  revokeWarning?: {
    code: string;
    message: string;
  } | null;
  scopes?: string[];
  traceId?: string | null;
}

export interface HostedExecutionDeviceSyncWakeEventLike {
  connectionId?: string | null;
  hint?: HostedExecutionDeviceSyncWakeHint | null;
  provider?: string | null;
}

export function buildHostedExecutionDeviceSyncConnectLinkPath(provider: string): string {
  return `/api/internal/device-sync/providers/${encodeURIComponent(provider)}/connect-link`;
}

export function buildHostedExecutionUserDeviceSyncRuntimePath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/device-sync/runtime`;
}

export function parseHostedExecutionDeviceSyncConnectLinkResponse(
  value: unknown,
): HostedExecutionDeviceSyncConnectLinkResponse {
  const record = requireObject(value, "Hosted device-sync connect link response");

  return {
    authorizationUrl: requireString(
      record.authorizationUrl,
      "Hosted device-sync connect link response authorizationUrl",
    ),
    expiresAt: requireString(
      record.expiresAt,
      "Hosted device-sync connect link response expiresAt",
    ),
    provider: requireString(record.provider, "Hosted device-sync connect link response provider"),
    providerLabel: requireString(
      record.providerLabel,
      "Hosted device-sync connect link response providerLabel",
    ),
  };
}

export function parseHostedExecutionDeviceSyncRuntimeSnapshotResponse(
  value: unknown,
): HostedExecutionDeviceSyncRuntimeSnapshotResponse {
  const record = requireObject(value, "Hosted device-sync runtime snapshot response");

  return {
    connections: requireArray(
      record.connections,
      "Hosted device-sync runtime snapshot response connections",
    ).map((entry, index) => parseHostedExecutionDeviceSyncRuntimeConnectionSnapshot(entry, index)),
    generatedAt: requireString(
      record.generatedAt,
      "Hosted device-sync runtime snapshot response generatedAt",
    ),
    userId: requireString(record.userId, "Hosted device-sync runtime snapshot response userId"),
  };
}

export function parseHostedExecutionDeviceSyncRuntimeSnapshotRequest(
  value: unknown,
  trustedUserId: string | null = null,
): HostedExecutionDeviceSyncRuntimeSnapshotRequest {
  const record = requireObject(value, "Hosted device-sync runtime snapshot request");

  return {
    ...(record.connectionId === undefined
      ? {}
      : { connectionId: readNullableStringValue(record.connectionId, "Hosted device-sync runtime snapshot request connectionId") }),
    ...(record.provider === undefined
      ? {}
      : { provider: readNullableStringValue(record.provider, "Hosted device-sync runtime snapshot request provider") }),
    userId: resolveHostedDeviceSyncRuntimeRequestUserId(record.userId, trustedUserId),
  };
}

export function parseHostedExecutionDeviceSyncRuntimeApplyRequest(
  value: unknown,
  trustedUserId: string | null = null,
): HostedExecutionDeviceSyncRuntimeApplyRequest {
  const record = requireObject(value, "Hosted device-sync runtime apply request");
  const updates = requireArray(
    record.updates,
    "Hosted device-sync runtime apply request updates",
  ).map((entry, index) => parseHostedExecutionDeviceSyncRuntimeConnectionUpdate(entry, index));

  assertUniqueHostedExecutionDeviceSyncRuntimeApplyConnectionIds(updates);

  return {
    ...(record.occurredAt === undefined
      ? {}
      : {
          occurredAt: readNullableIsoTimestamp(
            record.occurredAt,
            "Hosted device-sync runtime apply request occurredAt",
          ),
        }),
    updates,
    userId: resolveHostedDeviceSyncRuntimeRequestUserId(record.userId, trustedUserId),
  };
}

export function parseHostedExecutionDeviceSyncRuntimeApplyResponse(
  value: unknown,
): HostedExecutionDeviceSyncRuntimeApplyResponse {
  const record = requireObject(value, "Hosted device-sync runtime apply response");

  return {
    appliedAt: requireString(record.appliedAt, "Hosted device-sync runtime apply response appliedAt"),
    updates: requireArray(
      record.updates,
      "Hosted device-sync runtime apply response updates",
    ).map((entry, index) => parseHostedExecutionDeviceSyncRuntimeApplyEntry(entry, index)),
    userId: requireString(record.userId, "Hosted device-sync runtime apply response userId"),
  };
}

export function resolveHostedDeviceSyncWakeContext(
  event: HostedExecutionDeviceSyncWakeEventLike,
): {
  connectionId: string | null;
  hint: HostedExecutionDeviceSyncWakeEventLike["hint"];
  provider: string | null;
} {
  return {
    connectionId: event.connectionId ?? null,
    hint: event.hint ?? null,
    provider: event.provider ?? null,
  };
}

export function normalizeHostedDeviceSyncJobHints(
  value: HostedExecutionDeviceSyncWakeEventLike["hint"],
): HostedExecutionDeviceSyncJobHint[] {
  return Array.isArray(value?.jobs)
    ? value.jobs.map((job) => ({
        kind: job.kind,
        ...(job.availableAt ? { availableAt: job.availableAt } : {}),
        ...(job.dedupeKey !== undefined ? { dedupeKey: job.dedupeKey ?? null } : {}),
        ...(typeof job.maxAttempts === "number" ? { maxAttempts: job.maxAttempts } : {}),
        ...(job.payload ? { payload: { ...job.payload } } : {}),
        ...(typeof job.priority === "number" ? { priority: job.priority } : {}),
      }))
    : [];
}

function parseHostedExecutionDeviceSyncRuntimeConnectionSnapshot(
  value: unknown,
  index: number,
): HostedExecutionDeviceSyncRuntimeConnectionSnapshot {
  const record = requireObject(
    value,
    `Hosted device-sync runtime snapshot response connections[${index}]`,
  );

  return {
    connection: parseHostedExecutionDeviceSyncRuntimeConnection(
      record.connection,
      `Hosted device-sync runtime snapshot response connections[${index}].connection`,
    ),
    localState: parseHostedExecutionDeviceSyncRuntimeLocalState(
      record.localState,
      `Hosted device-sync runtime snapshot response connections[${index}].localState`,
    ),
    tokenBundle: parseHostedExecutionDeviceSyncRuntimeTokenBundle(
      record.tokenBundle,
      `Hosted device-sync runtime snapshot response connections[${index}].tokenBundle`,
    ),
  };
}

function parseHostedExecutionDeviceSyncRuntimeApplyEntry(
  value: unknown,
  index: number,
): HostedExecutionDeviceSyncRuntimeApplyResponse["updates"][number] {
  const record = requireObject(value, `Hosted device-sync runtime apply response updates[${index}]`);
  const status = requireString(
    record.status,
    `Hosted device-sync runtime apply response updates[${index}].status`,
  );
  const tokenUpdate = requireString(
    record.tokenUpdate,
    `Hosted device-sync runtime apply response updates[${index}].tokenUpdate`,
  );

  if (status !== "created" && status !== "missing" && status !== "updated") {
    throw new TypeError(`Hosted device-sync runtime apply response updates[${index}].status is invalid.`);
  }

  if (
    tokenUpdate !== "applied"
    && tokenUpdate !== "cleared"
    && tokenUpdate !== "missing"
    && tokenUpdate !== "skipped_version_mismatch"
    && tokenUpdate !== "unchanged"
  ) {
    throw new TypeError(`Hosted device-sync runtime apply response updates[${index}].tokenUpdate is invalid.`);
  }

  return {
    connection: record.connection === null
      ? null
      : parseHostedExecutionDeviceSyncRuntimeConnection(
          record.connection,
          `Hosted device-sync runtime apply response updates[${index}].connection`,
        ),
    connectionId: requireString(
      record.connectionId,
      `Hosted device-sync runtime apply response updates[${index}].connectionId`,
    ),
    status,
    tokenUpdate,
  };
}

function parseHostedExecutionDeviceSyncRuntimeConnection(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncRuntimeConnectionStateSnapshot {
  const record = requireObject(value, label);
  const status = requireString(record.status, `${label}.status`);

  if (status !== "active" && status !== "reauthorization_required" && status !== "disconnected") {
    throw new TypeError(`${label}.status is invalid.`);
  }

  return {
    accessTokenExpiresAt: readNullableIsoTimestamp(record.accessTokenExpiresAt, `${label}.accessTokenExpiresAt`),
    connectedAt: requireIsoTimestamp(record.connectedAt, `${label}.connectedAt`),
    createdAt: requireIsoTimestamp(record.createdAt, `${label}.createdAt`),
    displayName: readNullableStringValue(record.displayName, `${label}.displayName`),
    externalAccountId: requireString(record.externalAccountId, `${label}.externalAccountId`),
    id: requireString(record.id, `${label}.id`),
    metadata: sanitizeStoredDeviceSyncMetadata(
      requireObject(record.metadata, `${label}.metadata`),
    ),
    provider: requireString(record.provider, `${label}.provider`),
    scopes: requireStringArray(record.scopes, `${label}.scopes`),
    status,
    ...(record.updatedAt === undefined
      ? {}
      : { updatedAt: readNullableIsoTimestamp(record.updatedAt, `${label}.updatedAt`) ?? undefined }),
  };
}

function parseHostedExecutionDeviceSyncRuntimeLocalState(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncRuntimeLocalStateSnapshot {
  const record = requireObject(value, label);

  return {
    lastErrorCode: readNullableStringValue(record.lastErrorCode, `${label}.lastErrorCode`),
    lastErrorMessage: readNullableStringValue(record.lastErrorMessage, `${label}.lastErrorMessage`),
    lastSyncCompletedAt: readNullableIsoTimestamp(record.lastSyncCompletedAt, `${label}.lastSyncCompletedAt`),
    lastSyncErrorAt: readNullableIsoTimestamp(record.lastSyncErrorAt, `${label}.lastSyncErrorAt`),
    lastSyncStartedAt: readNullableIsoTimestamp(record.lastSyncStartedAt, `${label}.lastSyncStartedAt`),
    lastWebhookAt: readNullableIsoTimestamp(record.lastWebhookAt, `${label}.lastWebhookAt`),
    nextReconcileAt: readNullableIsoTimestamp(record.nextReconcileAt, `${label}.nextReconcileAt`),
  };
}

function parseHostedExecutionDeviceSyncRuntimeConnectionUpdate(
  value: unknown,
  index: number,
): HostedExecutionDeviceSyncRuntimeConnectionUpdate {
  const record = requireObject(value, `Hosted device-sync runtime apply request updates[${index}]`);

  return {
    connectionId: requireString(
      record.connectionId,
      `Hosted device-sync runtime apply request updates[${index}].connectionId`,
    ),
    ...(record.connection === undefined
      ? {}
      : {
          connection: parseHostedExecutionDeviceSyncRuntimeConnectionStateUpdate(
            record.connection,
            index,
          ),
        }),
    ...(record.localState === undefined
      ? {}
      : {
          localState: parseHostedExecutionDeviceSyncRuntimeLocalStateUpdate(record.localState, index),
        }),
    ...(record.observedUpdatedAt === undefined
      ? {}
      : {
          observedUpdatedAt: readNullableIsoTimestamp(
            record.observedUpdatedAt,
            `Hosted device-sync runtime apply request updates[${index}].observedUpdatedAt`,
          ),
        }),
    ...(record.observedTokenVersion === undefined
      ? {}
      : {
          observedTokenVersion: readNullablePositiveInteger(
            record.observedTokenVersion,
            `Hosted device-sync runtime apply request updates[${index}].observedTokenVersion`,
          ),
        }),
    ...(record.seed === undefined
      ? {}
      : {
          seed: parseHostedExecutionDeviceSyncRuntimeConnectionSeed(record.seed, index),
        }),
    ...(record.tokenBundle === undefined
      ? {}
      : {
          tokenBundle: parseHostedExecutionDeviceSyncRuntimeTokenBundle(
            record.tokenBundle,
            `Hosted device-sync runtime apply request updates[${index}].tokenBundle`,
          ),
        }),
  };
}

function parseHostedExecutionDeviceSyncRuntimeConnectionSeed(
  value: unknown,
  index: number,
): HostedExecutionDeviceSyncRuntimeConnectionSeed {
  const record = requireObject(value, `Hosted device-sync runtime apply request updates[${index}].seed`);

  return {
    connection: parseHostedExecutionDeviceSyncRuntimeConnection(
      record.connection,
      `Hosted device-sync runtime apply request updates[${index}].seed.connection`,
    ),
    localState: parseHostedExecutionDeviceSyncRuntimeLocalState(
      record.localState,
      `Hosted device-sync runtime apply request updates[${index}].seed.localState`,
    ),
    tokenBundle: parseHostedExecutionDeviceSyncRuntimeTokenBundle(
      record.tokenBundle,
      `Hosted device-sync runtime apply request updates[${index}].seed.tokenBundle`,
    ),
  };
}

function parseHostedExecutionDeviceSyncRuntimeConnectionStateUpdate(
  value: unknown,
  index: number,
): HostedExecutionDeviceSyncRuntimeConnectionStateUpdate {
  const record = requireObject(value, `Hosted device-sync runtime apply request updates[${index}].connection`);
  const next: HostedExecutionDeviceSyncRuntimeConnectionStateUpdate = {};

  if (record.displayName !== undefined) {
    next.displayName = readNullableStringValue(
      record.displayName,
      `Hosted device-sync runtime apply request updates[${index}].connection.displayName`,
    );
  }
  if (record.metadata !== undefined) {
    next.metadata = requireObject(
      record.metadata,
      `Hosted device-sync runtime apply request updates[${index}].connection.metadata`,
    );
  }
  if (record.scopes !== undefined) {
    next.scopes = requireStringArray(
      record.scopes,
      `Hosted device-sync runtime apply request updates[${index}].connection.scopes`,
    );
  }
  if (record.status !== undefined) {
    const status = requireString(
      record.status,
      `Hosted device-sync runtime apply request updates[${index}].connection.status`,
    );

    if (status !== "active" && status !== "reauthorization_required" && status !== "disconnected") {
      throw new TypeError(
        `Hosted device-sync runtime apply request updates[${index}].connection.status is invalid.`,
      );
    }

    next.status = status;
  }

  return next;
}

function parseHostedExecutionDeviceSyncRuntimeLocalStateUpdate(
  value: unknown,
  index: number,
): HostedExecutionDeviceSyncRuntimeLocalStateUpdate {
  const record = requireObject(value, `Hosted device-sync runtime apply request updates[${index}].localState`);
  const next: HostedExecutionDeviceSyncRuntimeLocalStateUpdate = {};

  if (record.clearError !== undefined) {
    next.clearError = requireBoolean(
      record.clearError,
      `Hosted device-sync runtime apply request updates[${index}].localState.clearError`,
    );
  }

  for (const field of [
    "lastErrorCode",
    "lastErrorMessage",
    "lastSyncCompletedAt",
    "lastSyncErrorAt",
    "lastSyncStartedAt",
    "lastWebhookAt",
    "nextReconcileAt",
  ] as const) {
    if (record[field] !== undefined) {
      next[field] = readNullableIsoTimestamp(
        record[field],
        `Hosted device-sync runtime apply request updates[${index}].localState.${field}`,
      );
    }
  }

  return next;
}

function parseHostedExecutionDeviceSyncRuntimeTokenBundle(
  value: unknown,
  label: string,
): HostedExecutionDeviceSyncRuntimeTokenBundle | null {
  if (value === null) {
    return null;
  }

  const record = requireObject(value, label);
  const tokenVersion = requirePositiveInteger(record.tokenVersion, `${label}.tokenVersion`);

  return {
    accessToken: requireString(record.accessToken, `${label}.accessToken`),
    accessTokenExpiresAt: readNullableIsoTimestamp(record.accessTokenExpiresAt, `${label}.accessTokenExpiresAt`),
    keyVersion: requireString(record.keyVersion, `${label}.keyVersion`),
    refreshToken: readNullableStringValue(record.refreshToken, `${label}.refreshToken`),
    tokenVersion,
  };
}

function assertUniqueHostedExecutionDeviceSyncRuntimeApplyConnectionIds(
  updates: readonly HostedExecutionDeviceSyncRuntimeConnectionUpdate[],
): void {
  const seen = new Set<string>();

  for (const update of updates) {
    if (seen.has(update.connectionId)) {
      throw new TypeError(
        `Hosted device-sync runtime apply request updates contain duplicate connectionId ${update.connectionId}.`,
      );
    }

    seen.add(update.connectionId);
  }
}

function resolveHostedDeviceSyncRuntimeRequestUserId(
  value: unknown,
  trustedUserId: string | null,
): string {
  if (trustedUserId) {
    if (value !== undefined && value !== trustedUserId) {
      throw new TypeError("userId must match the authenticated hosted execution user.");
    }

    return trustedUserId;
  }

  return requireString(value, "Hosted device-sync runtime request userId");
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  const array = requireArray(value, label);
  return array.map((entry, index) => requireString(entry, `${label}[${index}]`));
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

const ISO_8601_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function readNullableStringValue(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string or null.`);
  }

  return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }

  return value;
}

function readNullablePositiveInteger(value: unknown, label: string): number | null {
  if (value === null) {
    return null;
  }

  return requirePositiveInteger(value, label);
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}

function readNullableIsoTimestamp(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }

  return requireIsoTimestamp(value, label);
}

function requireIsoTimestamp(value: unknown, label: string): string {
  const parsed = requireString(value, label);

  if (!ISO_8601_TIMESTAMP_PATTERN.test(parsed)) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }

  const timestamp = Date.parse(parsed);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }

  return new Date(timestamp).toISOString();
}
