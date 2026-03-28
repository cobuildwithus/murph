import type {
  DeviceSyncAccountStatus,
  PublicDeviceSyncAccount,
} from "@murph/device-syncd";
import {
  type HostedExecutionDeviceSyncRuntimeApplyEntry as HostedDeviceSyncRuntimeApplyEntry,
  type HostedExecutionDeviceSyncRuntimeApplyRequest as HostedDeviceSyncRuntimeApplyRequest,
  type HostedExecutionDeviceSyncRuntimeApplyResponse as HostedDeviceSyncRuntimeApplyResponse,
  type HostedExecutionDeviceSyncRuntimeConnectionSnapshot as HostedDeviceSyncRuntimeConnectionSnapshot,
  type HostedExecutionDeviceSyncRuntimeConnectionUpdate as HostedDeviceSyncRuntimeConnectionUpdate,
  type HostedExecutionDeviceSyncRuntimeSnapshotRequest as HostedDeviceSyncRuntimeSnapshotRequest,
  type HostedExecutionDeviceSyncRuntimeSnapshotResponse as HostedDeviceSyncRuntimeSnapshotResponse,
  type HostedExecutionDeviceSyncRuntimeTokenBundle as HostedDeviceSyncRuntimeTokenBundle,
} from "@murph/hosted-execution";

import {
  hostedConnectionWithSecretArgs,
  mapHostedPublicAccountRecord,
  PrismaDeviceSyncControlPlaneStore,
  requireHostedConnectionBundleRecord,
} from "./prisma-store";
import { toIsoTimestamp, toJsonRecord } from "./shared";

export async function buildHostedDeviceSyncRuntimeSnapshot(
  store: PrismaDeviceSyncControlPlaneStore,
  request: HostedDeviceSyncRuntimeSnapshotRequest,
): Promise<HostedDeviceSyncRuntimeSnapshotResponse> {
  const records = await store.prisma.deviceConnection.findMany({
    where: {
      userId: request.userId,
      ...(request.connectionId ? { id: request.connectionId } : {}),
      ...(request.provider ? { provider: request.provider } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    ...hostedConnectionWithSecretArgs,
  });

  return {
    connections: records.map((record) => ({
      connection: normalizeHostedDeviceSyncRuntimeConnection(
        mapHostedPublicAccountRecord(record),
      ),
      tokenBundle: record.secret
        ? (() => {
            const bundle = requireHostedConnectionBundleRecord(record, store.codec);
            return {
              accessToken: bundle.account.accessToken,
              accessTokenExpiresAt: bundle.account.accessTokenExpiresAt ?? null,
              keyVersion: bundle.keyVersion,
              refreshToken: bundle.account.refreshToken ?? null,
              tokenVersion: bundle.tokenVersion,
            } satisfies HostedDeviceSyncRuntimeTokenBundle;
          })()
        : null,
    } satisfies HostedDeviceSyncRuntimeConnectionSnapshot)),
    generatedAt: toIsoTimestamp(new Date()),
    userId: request.userId,
  };
}

export async function applyHostedDeviceSyncRuntimeUpdates(
  store: PrismaDeviceSyncControlPlaneStore,
  request: HostedDeviceSyncRuntimeApplyRequest,
): Promise<HostedDeviceSyncRuntimeApplyResponse> {
  const appliedAt = request.occurredAt ?? toIsoTimestamp(new Date());
  const results: HostedDeviceSyncRuntimeApplyEntry[] = [];

  for (const update of request.updates) {
    const result = await store.withConnectionRefreshLock(update.connectionId, async (tx) => {
      const existing = await tx.deviceConnection.findFirst({
        where: {
          id: update.connectionId,
          userId: request.userId,
        },
        ...hostedConnectionWithSecretArgs,
      });

      if (!existing) {
        return {
          connection: null,
          connectionId: update.connectionId,
          status: "missing",
          tokenUpdate: "missing",
        } satisfies HostedDeviceSyncRuntimeApplyEntry;
      }

      if (update.status === "disconnected") {
        const disconnected = await store.markConnectionDisconnected({
          connectionId: update.connectionId,
          userId: request.userId,
          now: appliedAt,
          errorCode: update.lastErrorCode ?? null,
          errorMessage: update.lastErrorMessage ?? null,
          tx,
        });

        if (existing.status !== "disconnected") {
          await store.createSignal({
            userId: request.userId,
            connectionId: update.connectionId,
            provider: disconnected.provider,
            kind: "disconnected",
            payload: {
              occurredAt: appliedAt,
              reason: "hosted_runtime",
              ...(update.lastErrorCode ? { lastErrorCode: update.lastErrorCode } : {}),
              ...(update.lastErrorMessage ? { lastErrorMessage: update.lastErrorMessage } : {}),
            },
            createdAt: appliedAt,
            tx,
          });
        }

        return {
          connection: normalizeHostedDeviceSyncRuntimeConnection(disconnected),
          connectionId: update.connectionId,
          status: "updated",
          tokenUpdate: existing.secret ? "cleared" : "missing",
        } satisfies HostedDeviceSyncRuntimeApplyEntry;
      }

      const requestedAccessTokenExpiresAt = update.tokenBundle
        ? update.tokenBundle.accessTokenExpiresAt
        : Object.prototype.hasOwnProperty.call(update, "accessTokenExpiresAt")
          ? update.accessTokenExpiresAt ?? null
          : undefined;
      const tokenMutationRequested = update.tokenBundle !== undefined || requestedAccessTokenExpiresAt !== undefined;
      const tokenVersionMismatch = Boolean(
        tokenMutationRequested
        && existing.secret
        && typeof update.observedTokenVersion === "number"
        && update.observedTokenVersion > 0
        && existing.secret.tokenVersion !== update.observedTokenVersion,
      );

      const nextData: Record<string, unknown> = {
        ...(update.status ? { status: update.status } : {}),
        ...(Object.prototype.hasOwnProperty.call(update, "displayName")
          ? { displayName: update.displayName ?? null }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(update, "scopes")
          ? { scopes: update.scopes ?? [] }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(update, "metadata")
          ? { metadataJson: toJsonRecord(update.metadata ?? {}) }
          : {}),
        ...(requestedAccessTokenExpiresAt !== undefined && !tokenVersionMismatch
          ? {
              accessTokenExpiresAt: requestedAccessTokenExpiresAt
                ? new Date(requestedAccessTokenExpiresAt)
                : null,
            }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(update, "nextReconcileAt")
          ? {
              nextReconcileAt: update.nextReconcileAt
                ? new Date(update.nextReconcileAt)
                : null,
            }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(update, "lastWebhookAt")
          ? {
              lastWebhookAt: update.lastWebhookAt ? new Date(update.lastWebhookAt) : null,
            }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(update, "lastSyncStartedAt")
          ? {
              lastSyncStartedAt: update.lastSyncStartedAt
                ? new Date(update.lastSyncStartedAt)
                : null,
            }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(update, "lastSyncCompletedAt")
          ? {
              lastSyncCompletedAt: update.lastSyncCompletedAt
                ? new Date(update.lastSyncCompletedAt)
                : null,
            }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(update, "lastSyncErrorAt")
          ? {
              lastSyncErrorAt: update.lastSyncErrorAt
                ? new Date(update.lastSyncErrorAt)
                : null,
            }
          : {}),
        ...(update.clearError
          ? {
              lastSyncErrorAt: null,
              lastErrorCode: null,
              lastErrorMessage: null,
            }
          : {
              ...(Object.prototype.hasOwnProperty.call(update, "lastErrorCode")
                ? { lastErrorCode: update.lastErrorCode ?? null }
                : {}),
              ...(Object.prototype.hasOwnProperty.call(update, "lastErrorMessage")
                ? { lastErrorMessage: update.lastErrorMessage ?? null }
                : {}),
            }),
      };

      const updatedRecord = await tx.deviceConnection.update({
        where: {
          id: update.connectionId,
        },
        data: nextData,
      });
      let tokenUpdate: HostedDeviceSyncRuntimeApplyEntry["tokenUpdate"] = existing.secret
        ? "unchanged"
        : "missing";

      if (update.tokenBundle) {
        if (tokenVersionMismatch) {
          tokenUpdate = "skipped_version_mismatch";
        } else {
          const nextAccessTokenEncrypted = store.codec.encrypt(update.tokenBundle.accessToken);
          const nextRefreshTokenEncrypted = update.tokenBundle.refreshToken
            ? store.codec.encrypt(update.tokenBundle.refreshToken)
            : null;
          const tokenChanged = !existing.secret
            || existing.secret.accessTokenEncrypted !== nextAccessTokenEncrypted
            || existing.secret.refreshTokenEncrypted !== nextRefreshTokenEncrypted
            || normalizeNullableIsoTimestamp(updatedRecord.accessTokenExpiresAt)
              !== normalizeNullableIsoTimestamp(requestedAccessTokenExpiresAt);

          if (!existing.secret) {
            await tx.deviceConnectionSecret.create({
              data: {
                connectionId: update.connectionId,
                accessTokenEncrypted: nextAccessTokenEncrypted,
                refreshTokenEncrypted: nextRefreshTokenEncrypted,
                tokenVersion: 1,
                keyVersion: store.codec.keyVersion,
              },
            });
            tokenUpdate = "applied";
          } else if (tokenChanged) {
            await tx.deviceConnectionSecret.update({
              where: {
                connectionId: update.connectionId,
              },
              data: {
                accessTokenEncrypted: nextAccessTokenEncrypted,
                refreshTokenEncrypted: nextRefreshTokenEncrypted,
                tokenVersion: {
                  increment: 1,
                },
                keyVersion: store.codec.keyVersion,
              },
            });
            tokenUpdate = "applied";
          }
        }
      }

      if (update.status === "reauthorization_required" && existing.status !== "reauthorization_required") {
        await store.createSignal({
          userId: request.userId,
          connectionId: update.connectionId,
          provider: updatedRecord.provider,
          kind: "reauthorization_required",
          payload: {
            occurredAt: appliedAt,
            reason: "hosted_runtime",
            ...(update.lastErrorCode ? { lastErrorCode: update.lastErrorCode } : {}),
            ...(update.lastErrorMessage ? { lastErrorMessage: update.lastErrorMessage } : {}),
          },
          createdAt: appliedAt,
          tx,
        });
      }

      return {
        connection: normalizeHostedDeviceSyncRuntimeConnection(
          mapHostedPublicAccountRecord(updatedRecord),
        ),
        connectionId: update.connectionId,
        status: "updated",
        tokenUpdate,
      } satisfies HostedDeviceSyncRuntimeApplyEntry;
    });

    results.push(result);
  }

  return {
    appliedAt,
    updates: results,
    userId: request.userId,
  };
}

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
  return {
    ...(value.occurredAt === undefined
      ? {}
      : { occurredAt: readNullableString(value.occurredAt, "occurredAt") }),
    updates: requireArray(value.updates, "updates").map((entry, index) =>
      parseHostedDeviceSyncRuntimeConnectionUpdate(entry, index)
    ),
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
          accessTokenExpiresAt: readNullableString(
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
          lastSyncCompletedAt: readNullableString(
            record.lastSyncCompletedAt,
            `updates[${index}].lastSyncCompletedAt`,
          ),
        }),
    ...(record.lastSyncErrorAt === undefined
      ? {}
      : { lastSyncErrorAt: readNullableString(record.lastSyncErrorAt, `updates[${index}].lastSyncErrorAt`) }),
    ...(record.lastSyncStartedAt === undefined
      ? {}
      : {
          lastSyncStartedAt: readNullableString(
            record.lastSyncStartedAt,
            `updates[${index}].lastSyncStartedAt`,
          ),
        }),
    ...(record.lastWebhookAt === undefined
      ? {}
      : { lastWebhookAt: readNullableString(record.lastWebhookAt, `updates[${index}].lastWebhookAt`) }),
    ...(record.metadata === undefined
      ? {}
      : { metadata: requireObject(record.metadata, `updates[${index}].metadata`) }),
    ...(record.nextReconcileAt === undefined
      ? {}
      : { nextReconcileAt: readNullableString(record.nextReconcileAt, `updates[${index}].nextReconcileAt`) }),
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
    accessTokenExpiresAt: readNullableString(record.accessTokenExpiresAt, `${label}.accessTokenExpiresAt`),
    keyVersion: requireString(record.keyVersion, `${label}.keyVersion`),
    refreshToken: readNullableString(record.refreshToken, `${label}.refreshToken`),
    tokenVersion: requireNumber(record.tokenVersion, `${label}.tokenVersion`),
  };
}

function parseDeviceSyncStatus(value: unknown, label: string): DeviceSyncAccountStatus {
  const status = requireString(value, label);

  if (status === "active" || status === "reauthorization_required" || status === "disconnected") {
    return status;
  }

  throw new TypeError(`${label} must be an active, reauthorization_required, or disconnected status.`);
}

function normalizeNullableIsoTimestamp(
  value: Date | string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function normalizeHostedDeviceSyncRuntimeConnection(
  connection: PublicDeviceSyncAccount,
): HostedDeviceSyncRuntimeConnectionSnapshot["connection"] {
  return {
    ...connection,
    accessTokenExpiresAt: connection.accessTokenExpiresAt ?? null,
  };
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
