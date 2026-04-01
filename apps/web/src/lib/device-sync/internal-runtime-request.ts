import type { DeviceSyncAccountStatus } from "@murphai/device-syncd";
import { sanitizeStoredDeviceSyncMetadata } from "@murphai/device-syncd";
import {
  type HostedExecutionDeviceSyncRuntimeApplyRequest as HostedDeviceSyncRuntimeApplyRequest,
  type HostedExecutionDeviceSyncRuntimeConnectionUpdate as HostedDeviceSyncRuntimeConnectionUpdate,
  type HostedExecutionDeviceSyncRuntimeSnapshotRequest as HostedDeviceSyncRuntimeSnapshotRequest,
  type HostedExecutionDeviceSyncRuntimeTokenBundle as HostedDeviceSyncRuntimeTokenBundle,
} from "@murphai/hosted-execution";

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
    ...(record.accessTokenExpiresAt === undefined
      ? {}
      : {
          accessTokenExpiresAt: readNullableIsoTimestamp(
            record.accessTokenExpiresAt,
            `updates[${index}].accessTokenExpiresAt`,
          ),
        }),
    ...(record.clearError === undefined
      ? {}
      : { clearError: requireBoolean(record.clearError, `updates[${index}].clearError`) }),
    connectionId: requireString(record.connectionId, `updates[${index}].connectionId`),
    ...(record.displayName === undefined
      ? {}
      : { displayName: readNullableString(record.displayName, `updates[${index}].displayName`) }),
    ...(record.lastErrorCode === undefined
      ? {}
      : { lastErrorCode: readNullableString(record.lastErrorCode, `updates[${index}].lastErrorCode`) }),
    ...(record.lastErrorMessage === undefined
      ? {}
      : { lastErrorMessage: readNullableString(record.lastErrorMessage, `updates[${index}].lastErrorMessage`) }),
    ...(record.lastSyncCompletedAt === undefined
      ? {}
      : {
          lastSyncCompletedAt: readNullableIsoTimestamp(
            record.lastSyncCompletedAt,
            `updates[${index}].lastSyncCompletedAt`,
          ),
        }),
    ...(record.lastSyncErrorAt === undefined
      ? {}
      : { lastSyncErrorAt: readNullableIsoTimestamp(record.lastSyncErrorAt, `updates[${index}].lastSyncErrorAt`) }),
    ...(record.lastSyncStartedAt === undefined
      ? {}
      : {
          lastSyncStartedAt: readNullableIsoTimestamp(
            record.lastSyncStartedAt,
            `updates[${index}].lastSyncStartedAt`,
          ),
        }),
    ...(record.lastWebhookAt === undefined
      ? {}
      : { lastWebhookAt: readNullableIsoTimestamp(record.lastWebhookAt, `updates[${index}].lastWebhookAt`) }),
    ...(record.metadata === undefined
      ? {}
      : { metadata: sanitizeStoredDeviceSyncMetadata(requireObject(record.metadata, `updates[${index}].metadata`)) }),
    ...(record.nextReconcileAt === undefined
      ? {}
      : { nextReconcileAt: readNullableIsoTimestamp(record.nextReconcileAt, `updates[${index}].nextReconcileAt`) }),
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
          observedTokenVersion: readNullableNumber(
            record.observedTokenVersion,
            `updates[${index}].observedTokenVersion`,
          ),
        }),
    ...(record.scopes === undefined
      ? {}
      : { scopes: requireStringArray(record.scopes, `updates[${index}].scopes`) }),
    ...(record.status === undefined
      ? {}
      : { status: parseDeviceSyncStatus(record.status, `updates[${index}].status`) }),
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

function parseHostedDeviceSyncRuntimeTokenBundle(
  value: unknown,
  label: string,
): HostedDeviceSyncRuntimeTokenBundle | null {
  if (value === null) {
    return null;
  }

  const record = requireObject(value, label);

  return {
    accessToken: requireString(record.accessToken, `${label}.accessToken`),
    accessTokenExpiresAt: readNullableIsoTimestamp(record.accessTokenExpiresAt, `${label}.accessTokenExpiresAt`),
    keyVersion: requireString(record.keyVersion, `${label}.keyVersion`),
    refreshToken: readNullableString(record.refreshToken, `${label}.refreshToken`),
    tokenVersion: requireNumber(record.tokenVersion, `${label}.tokenVersion`),
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

function readNullableNumber(value: unknown, label: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return requireNumber(value, label);
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
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
