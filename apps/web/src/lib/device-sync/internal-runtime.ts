import type { PublicDeviceSyncAccount } from "@murphai/device-syncd/public-ingress";
import { sanitizeStoredDeviceSyncMetadata } from "@murphai/device-syncd/public-ingress";
import {
  type HostedExecutionDeviceSyncRuntimeApplyEntry as HostedDeviceSyncRuntimeApplyEntry,
  type HostedExecutionDeviceSyncRuntimeApplyRequest as HostedDeviceSyncRuntimeApplyRequest,
  type HostedExecutionDeviceSyncRuntimeApplyResponse as HostedDeviceSyncRuntimeApplyResponse,
  type HostedExecutionDeviceSyncRuntimeConnectionSnapshot as HostedDeviceSyncRuntimeConnectionSnapshot,
  type HostedExecutionDeviceSyncRuntimeConnectionUpdate as HostedDeviceSyncRuntimeConnectionUpdate,
  type HostedExecutionDeviceSyncRuntimeSnapshotRequest as HostedDeviceSyncRuntimeSnapshotRequest,
  type HostedExecutionDeviceSyncRuntimeSnapshotResponse as HostedDeviceSyncRuntimeSnapshotResponse,
  type HostedExecutionDeviceSyncRuntimeTokenBundle as HostedDeviceSyncRuntimeTokenBundle,
} from "@murphai/hosted-execution";

import {
  hostedConnectionWithSecretArgs,
  mapHostedInternalAccountRecord,
  PrismaDeviceSyncControlPlaneStore,
  requireHostedConnectionBundleRecord,
} from "./prisma-store";
import { toIsoTimestamp } from "./shared";

export {
  parseHostedDeviceSyncRuntimeApplyRequest,
  parseHostedDeviceSyncRuntimeSnapshotRequest,
} from "./internal-runtime-request";

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
        mapHostedInternalAccountRecord(record),
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

      const requestedAccessTokenExpiresAt = update.tokenBundle
        ? update.tokenBundle.accessTokenExpiresAt
        : Object.prototype.hasOwnProperty.call(update, "accessTokenExpiresAt")
          ? update.accessTokenExpiresAt ?? null
          : undefined;
      const connectionMutationRequested = hasHostedDeviceSyncRuntimeConnectionMutation(update);
      const tokenMutationRequested = update.tokenBundle !== undefined || requestedAccessTokenExpiresAt !== undefined;
      const connectionVersionMismatch = hasHostedDeviceSyncRuntimeConnectionVersionMismatch(
        existing.updatedAt,
        update.observedUpdatedAt,
        connectionMutationRequested || tokenMutationRequested,
      );
      const tokenVersionMismatch = Boolean(
        tokenMutationRequested
        && existing.secret
        && typeof update.observedTokenVersion === "number"
        && update.observedTokenVersion > 0
        && existing.secret.tokenVersion !== update.observedTokenVersion,
      );
      const tokenBlockedByDisconnectedStatus = Boolean(
        update.tokenBundle
        && (existing.status === "disconnected" || update.status === "disconnected"),
      );

      if (connectionVersionMismatch) {
        return {
          connection: normalizeHostedDeviceSyncRuntimeConnection(
            mapHostedInternalAccountRecord(existing),
          ),
          connectionId: update.connectionId,
          status: "updated",
          tokenUpdate: existing.secret ? "unchanged" : "missing",
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

      const nextData: Record<string, unknown> = {
        ...(update.status ? { status: update.status } : {}),
        ...(Object.prototype.hasOwnProperty.call(update, "displayName")
          ? { displayName: update.displayName ?? null }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(update, "scopes")
          ? { scopes: update.scopes ?? [] }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(update, "metadata")
          ? { metadataJson: sanitizeStoredDeviceSyncMetadata(update.metadata ?? {}) }
          : {}),
        ...(requestedAccessTokenExpiresAt !== undefined && !tokenVersionMismatch && !tokenBlockedByDisconnectedStatus
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

      const updatedRecord = Object.keys(nextData).length === 0
        ? existing
        : await tx.deviceConnection.update({
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
        } else if (tokenBlockedByDisconnectedStatus) {
          tokenUpdate = existing.secret ? "unchanged" : "missing";
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
          mapHostedInternalAccountRecord(updatedRecord),
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

function normalizeNullableIsoTimestamp(
  value: Date | string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function hasHostedDeviceSyncRuntimeConnectionMutation(
  update: HostedDeviceSyncRuntimeConnectionUpdate,
): boolean {
  return update.status !== undefined
    || Object.prototype.hasOwnProperty.call(update, "displayName")
    || Object.prototype.hasOwnProperty.call(update, "scopes")
    || Object.prototype.hasOwnProperty.call(update, "metadata")
    || Object.prototype.hasOwnProperty.call(update, "nextReconcileAt")
    || Object.prototype.hasOwnProperty.call(update, "lastWebhookAt")
    || Object.prototype.hasOwnProperty.call(update, "lastSyncStartedAt")
    || Object.prototype.hasOwnProperty.call(update, "lastSyncCompletedAt")
    || Object.prototype.hasOwnProperty.call(update, "lastSyncErrorAt")
    || Object.prototype.hasOwnProperty.call(update, "lastErrorCode")
    || Object.prototype.hasOwnProperty.call(update, "lastErrorMessage")
    || update.clearError === true;
}

function hasHostedDeviceSyncRuntimeConnectionVersionMismatch(
  existingUpdatedAt: Date | string | null | undefined,
  observedUpdatedAt: string | null | undefined,
  mutationRequested: boolean,
): boolean {
  if (!mutationRequested || observedUpdatedAt === undefined || observedUpdatedAt === null) {
    return false;
  }

  return normalizeNullableIsoTimestamp(existingUpdatedAt) !== normalizeNullableIsoTimestamp(observedUpdatedAt);
}

function normalizeHostedDeviceSyncRuntimeConnection(
  connection: PublicDeviceSyncAccount,
): HostedDeviceSyncRuntimeConnectionSnapshot["connection"] {
  return {
    ...connection,
    accessTokenExpiresAt: connection.accessTokenExpiresAt ?? null,
  };
}
