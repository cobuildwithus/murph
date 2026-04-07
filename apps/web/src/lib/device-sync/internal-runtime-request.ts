import type { DeviceSyncAccountStatus } from "@murphai/device-syncd/public-ingress";
import { sanitizeStoredDeviceSyncMetadata } from "@murphai/device-syncd/public-ingress";
import {
  type HostedExecutionDeviceSyncRuntimeApplyRequest as HostedDeviceSyncRuntimeApplyRequest,
  type HostedExecutionDeviceSyncRuntimeConnectionSeed as HostedDeviceSyncRuntimeConnectionSeed,
  type HostedExecutionDeviceSyncRuntimeConnectionUpdate as HostedDeviceSyncRuntimeConnectionUpdate,
  type HostedExecutionDeviceSyncRuntimeSnapshotRequest as HostedDeviceSyncRuntimeSnapshotRequest,
  type HostedExecutionDeviceSyncRuntimeTokenBundle as HostedDeviceSyncRuntimeTokenBundle,
} from "@murphai/device-syncd/hosted-runtime";

export function parseHostedDeviceSyncRuntimeSnapshotRequest(
  value: Record<string, unknown>,
  trustedUserId: string | null = null,
): HostedDeviceSyncRuntimeSnapshotRequest {
  return {
    ...(value.connectionId === undefined
      ? {}
      : { connectionId: readNullableString(value.connectionId, "connectionId") }),
    ...(value.provider === undefined
      ? {}
      : { provider: readNullableString(value.provider, "provider") }),
    userId: resolveHostedDeviceSyncRuntimeRequestUserId(value.userId, trustedUserId),
  };
}

export function parseHostedDeviceSyncRuntimeApplyRequest(
  value: Record<string, unknown>,
  trustedUserId: string | null = null,
): HostedDeviceSyncRuntimeApplyRequest {
  const updates = requireArray(value.updates, "updates").map((entry, index) =>
    parseHostedDeviceSyncRuntimeConnectionUpdate(entry, index)
  );
  assertUniqueHostedDeviceSyncRuntimeApplyConnectionIds(updates);

  return {
    ...(value.occurredAt === undefined
      ? {}
      : { occurredAt: readNullableIsoTimestamp(value.occurredAt, "occurredAt") }),
    updates,
    userId: resolveHostedDeviceSyncRuntimeRequestUserId(value.userId, trustedUserId),
  };
}

function resolveHostedDeviceSyncRuntimeRequestUserId(
  value: unknown,
  trustedUserId: string | null,
): string {
  if (typeof trustedUserId === "string" && trustedUserId.trim().length > 0) {
    if (value !== undefined && value !== trustedUserId) {
      throw new TypeError("userId must match the authenticated hosted execution user.");
    }

    return trustedUserId;
  }

  return requireString(value, "userId");
}

function parseHostedDeviceSyncRuntimeConnectionUpdate(
  value: unknown,
  index: number,
): HostedDeviceSyncRuntimeConnectionUpdate {
  const record = requireObject(value, `updates[${index}]`);

  return {
    connectionId: requireString(record.connectionId, `updates[${index}].connectionId`),
    ...(record.connection === undefined
      ? {}
      : { connection: parseHostedDeviceSyncRuntimeConnectionStateUpdate(record.connection, index) }),
    ...(record.localState === undefined
      ? {}
      : { localState: parseHostedDeviceSyncRuntimeLocalStateUpdate(record.localState, index) }),
    ...(record.observedUpdatedAt === undefined
      ? {}
      : {
          observedUpdatedAt: readNullableIsoTimestamp(
            record.observedUpdatedAt,
            `updates[${index}].observedUpdatedAt`,
          ),
        }),
    ...(record.observedTokenVersion === undefined
      ? {}
      : {
          observedTokenVersion: readNullablePositiveInteger(
            record.observedTokenVersion,
            `updates[${index}].observedTokenVersion`,
          ),
        }),
    ...(record.seed === undefined
      ? {}
      : { seed: parseHostedDeviceSyncRuntimeConnectionSeed(record.seed, index) }),
    ...(record.tokenBundle === undefined
      ? {}
      : {
          tokenBundle: parseHostedDeviceSyncRuntimeTokenBundle(
            record.tokenBundle,
            `updates[${index}].tokenBundle`,
          ),
        }),
  };
}

function parseHostedDeviceSyncRuntimeConnectionSeed(
  value: unknown,
  index: number,
): HostedDeviceSyncRuntimeConnectionSeed {
  const record = requireObject(value, `updates[${index}].seed`);

  return {
    connection: parseHostedDeviceSyncRuntimeConnectionStateSnapshot(
      record.connection,
      `updates[${index}].seed.connection`,
    ),
    localState: parseHostedDeviceSyncRuntimeLocalStateSnapshot(
      record.localState,
      `updates[${index}].seed.localState`,
    ),
    tokenBundle: parseHostedDeviceSyncRuntimeTokenBundle(
      record.tokenBundle,
      `updates[${index}].seed.tokenBundle`,
    ),
  };
}

function parseHostedDeviceSyncRuntimeConnectionStateUpdate(
  value: unknown,
  index: number,
): NonNullable<HostedDeviceSyncRuntimeConnectionUpdate["connection"]> {
  const record = requireObject(value, `updates[${index}].connection`);

  return {
    ...(record.displayName === undefined
      ? {}
      : { displayName: readNullableString(record.displayName, `updates[${index}].connection.displayName`) }),
    ...(record.metadata === undefined
      ? {}
      : {
          metadata: sanitizeStoredDeviceSyncMetadata(
            requireObject(record.metadata, `updates[${index}].connection.metadata`),
          ),
        }),
    ...(record.scopes === undefined
      ? {}
      : { scopes: requireStringArray(record.scopes, `updates[${index}].connection.scopes`) }),
    ...(record.status === undefined
      ? {}
      : { status: parseDeviceSyncStatus(record.status, `updates[${index}].connection.status`) }),
  };
}

function parseHostedDeviceSyncRuntimeLocalStateUpdate(
  value: unknown,
  index: number,
): NonNullable<HostedDeviceSyncRuntimeConnectionUpdate["localState"]> {
  const record = requireObject(value, `updates[${index}].localState`);

  return {
    ...(record.clearError === undefined
      ? {}
      : { clearError: requireBoolean(record.clearError, `updates[${index}].localState.clearError`) }),
    ...(record.lastErrorCode === undefined
      ? {}
      : {
          lastErrorCode: readNullableString(
            record.lastErrorCode,
            `updates[${index}].localState.lastErrorCode`,
          ),
        }),
    ...(record.lastErrorMessage === undefined
      ? {}
      : {
          lastErrorMessage: readNullableString(
            record.lastErrorMessage,
            `updates[${index}].localState.lastErrorMessage`,
          ),
        }),
    ...(record.lastSyncCompletedAt === undefined
      ? {}
      : {
          lastSyncCompletedAt: readNullableIsoTimestamp(
            record.lastSyncCompletedAt,
            `updates[${index}].localState.lastSyncCompletedAt`,
          ),
        }),
    ...(record.lastSyncErrorAt === undefined
      ? {}
      : {
          lastSyncErrorAt: readNullableIsoTimestamp(
            record.lastSyncErrorAt,
            `updates[${index}].localState.lastSyncErrorAt`,
          ),
        }),
    ...(record.lastSyncStartedAt === undefined
      ? {}
      : {
          lastSyncStartedAt: readNullableIsoTimestamp(
            record.lastSyncStartedAt,
            `updates[${index}].localState.lastSyncStartedAt`,
          ),
        }),
    ...(record.lastWebhookAt === undefined
      ? {}
      : {
          lastWebhookAt: readNullableIsoTimestamp(
            record.lastWebhookAt,
            `updates[${index}].localState.lastWebhookAt`,
          ),
        }),
    ...(record.nextReconcileAt === undefined
      ? {}
      : {
          nextReconcileAt: readNullableIsoTimestamp(
            record.nextReconcileAt,
            `updates[${index}].localState.nextReconcileAt`,
          ),
        }),
  };
}

function parseHostedDeviceSyncRuntimeConnectionStateSnapshot(
  value: unknown,
  label: string,
): HostedDeviceSyncRuntimeConnectionSeed["connection"] {
  const record = requireObject(value, label);

  return {
    accessTokenExpiresAt: readNullableIsoTimestamp(record.accessTokenExpiresAt, `${label}.accessTokenExpiresAt`),
    connectedAt: requireIsoTimestamp(record.connectedAt, `${label}.connectedAt`),
    createdAt: requireIsoTimestamp(record.createdAt, `${label}.createdAt`),
    displayName: readNullableString(record.displayName, `${label}.displayName`),
    externalAccountId: requireString(record.externalAccountId, `${label}.externalAccountId`),
    id: requireString(record.id, `${label}.id`),
    metadata: sanitizeStoredDeviceSyncMetadata(requireObject(record.metadata, `${label}.metadata`)),
    provider: requireString(record.provider, `${label}.provider`),
    scopes: requireStringArray(record.scopes, `${label}.scopes`),
    status: parseDeviceSyncStatus(record.status, `${label}.status`),
    ...(record.updatedAt === undefined
      ? {}
      : { updatedAt: readNullableIsoTimestamp(record.updatedAt, `${label}.updatedAt`) ?? undefined }),
  };
}

function parseHostedDeviceSyncRuntimeLocalStateSnapshot(
  value: unknown,
  label: string,
): HostedDeviceSyncRuntimeConnectionSeed["localState"] {
  const record = requireObject(value, label);

  return {
    lastErrorCode: readNullableString(record.lastErrorCode, `${label}.lastErrorCode`),
    lastErrorMessage: readNullableString(record.lastErrorMessage, `${label}.lastErrorMessage`),
    lastSyncCompletedAt: readNullableIsoTimestamp(record.lastSyncCompletedAt, `${label}.lastSyncCompletedAt`),
    lastSyncErrorAt: readNullableIsoTimestamp(record.lastSyncErrorAt, `${label}.lastSyncErrorAt`),
    lastSyncStartedAt: readNullableIsoTimestamp(record.lastSyncStartedAt, `${label}.lastSyncStartedAt`),
    lastWebhookAt: readNullableIsoTimestamp(record.lastWebhookAt, `${label}.lastWebhookAt`),
    nextReconcileAt: readNullableIsoTimestamp(record.nextReconcileAt, `${label}.nextReconcileAt`),
  };
}

function parseHostedDeviceSyncRuntimeTokenBundle(
  value: unknown,
  label: string,
): HostedDeviceSyncRuntimeTokenBundle | null {
  if (value === null || value === undefined) {
    return null;
  }

  const record = requireObject(value, label);

  return {
    accessToken: requireString(record.accessToken, `${label}.accessToken`),
    accessTokenExpiresAt: readNullableIsoTimestamp(record.accessTokenExpiresAt, `${label}.accessTokenExpiresAt`),
    keyVersion: requireString(record.keyVersion, `${label}.keyVersion`),
    refreshToken: readNullableString(record.refreshToken, `${label}.refreshToken`),
    tokenVersion: requirePositiveInteger(record.tokenVersion, `${label}.tokenVersion`),
  };
}

function assertUniqueHostedDeviceSyncRuntimeApplyConnectionIds(
  updates: readonly HostedDeviceSyncRuntimeConnectionUpdate[],
): void {
  const seen = new Set<string>();

  for (const [index, update] of updates.entries()) {
    if (seen.has(update.connectionId)) {
      throw new TypeError(
        `updates[${index}].connectionId must be unique within a single runtime apply request.`,
      );
    }

    seen.add(update.connectionId);
  }
}

function parseDeviceSyncStatus(value: unknown, label: string): DeviceSyncAccountStatus {
  const status = requireString(value, label);

  if (status === "active" || status === "reauthorization_required" || status === "disconnected") {
    return status;
  }

  throw new TypeError(`${label} must be an active, reauthorization_required, or disconnected status.`);
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

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function readNullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireString(value, label);
}

function readNullableIsoTimestamp(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireIsoTimestamp(value, label);
}

function readNullablePositiveInteger(value: unknown, label: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requirePositiveInteger(value, label);
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
  const parsed = requireNumber(value, label);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new TypeError(`${label} must be a positive integer.`);
  }

  return parsed;
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }

  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((entry, index) => requireString(entry, `${label}[${index}]`));
}

function requireIsoTimestamp(value: unknown, label: string): string {
  const candidate = requireString(value, label);
  const parsed = Date.parse(candidate);

  if (!Number.isFinite(parsed)) {
    throw new TypeError(`${label} must be an ISO-8601 timestamp.`);
  }

  return new Date(parsed).toISOString();
}
