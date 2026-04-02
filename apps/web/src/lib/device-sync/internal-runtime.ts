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
      localState: normalizeHostedDeviceSyncRuntimeLocalState(
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

      const requestedAccessTokenExpiresAt = update.tokenBundle?.accessTokenExpiresAt;
      const connectionMutationRequested = hasHostedDeviceSyncRuntimeConnectionMutation(update);
      const localStateMutationRequested = hasHostedDeviceSyncRuntimeLocalStateMutation(update);
      const tokenMutationRequested = update.tokenBundle !== undefined && update.tokenBundle !== null;
      const authoritativeMutationRequested = connectionMutationRequested || tokenMutationRequested;
      const missingObservedUpdatedAt = authoritativeMutationRequested
        && (update.observedUpdatedAt === undefined || update.observedUpdatedAt === null);
      const connectionVersionMismatch = missingObservedUpdatedAt || hasHostedDeviceSyncRuntimeConnectionVersionMismatch(
        existing.updatedAt,
        update.observedUpdatedAt,
        authoritativeMutationRequested,
      );
      const tokenVersionMismatch = Boolean(
        tokenMutationRequested
        && existing.secret
        && (
          update.observedTokenVersion === undefined
          || update.observedTokenVersion === null
          || existing.secret.tokenVersion !== update.observedTokenVersion
        ),
      );
      const tokenBlockedByDisconnectedStatus = Boolean(
        update.tokenBundle
        && (existing.status === "disconnected" || update.connection?.status === "disconnected"),
      );

      if (connectionVersionMismatch && !localStateMutationRequested) {
        return {
          connection: normalizeHostedDeviceSyncRuntimeConnection(
            mapHostedInternalAccountRecord(existing),
          ),
          connectionId: update.connectionId,
          status: "updated",
          tokenUpdate: tokenMutationRequested
            ? "skipped_version_mismatch"
            : existing.secret
              ? "unchanged"
              : "missing",
        } satisfies HostedDeviceSyncRuntimeApplyEntry;
      }

      if (update.connection?.status === "disconnected" && !connectionVersionMismatch) {
        const disconnected = await store.markConnectionDisconnected({
          connectionId: update.connectionId,
          userId: request.userId,
          now: appliedAt,
          errorCode: update.localState?.lastErrorCode ?? null,
          errorMessage: update.localState?.lastErrorMessage ?? null,
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
              ...(update.localState?.lastErrorCode ? { lastErrorCode: update.localState.lastErrorCode } : {}),
              ...(update.localState?.lastErrorMessage ? { lastErrorMessage: update.localState.lastErrorMessage } : {}),
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
        ...(!connectionVersionMismatch && update.connection?.status
          ? { status: update.connection.status }
          : {}),
        ...(!connectionVersionMismatch && Object.prototype.hasOwnProperty.call(update.connection ?? {}, "displayName")
          ? { displayName: update.connection?.displayName ?? null }
          : {}),
        ...(!connectionVersionMismatch && Object.prototype.hasOwnProperty.call(update.connection ?? {}, "scopes")
          ? { scopes: update.connection?.scopes ?? [] }
          : {}),
        ...(!connectionVersionMismatch && Object.prototype.hasOwnProperty.call(update.connection ?? {}, "metadata")
          ? {
              metadataJson: sanitizeStoredDeviceSyncMetadata(update.connection?.metadata ?? {}),
            }
          : {}),
        ...(requestedAccessTokenExpiresAt !== undefined && !connectionVersionMismatch && !tokenVersionMismatch && !tokenBlockedByDisconnectedStatus
          ? {
              accessTokenExpiresAt: requestedAccessTokenExpiresAt
                ? new Date(requestedAccessTokenExpiresAt)
                : null,
            }
          : {}),
        ...buildHostedDeviceSyncRuntimeLocalStateData(existing, update.localState ?? null),
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
        } else if (connectionVersionMismatch) {
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

      if (
        update.connection?.status === "reauthorization_required"
        && !connectionVersionMismatch
        && existing.status !== "reauthorization_required"
      ) {
        await store.createSignal({
          userId: request.userId,
          connectionId: update.connectionId,
          provider: updatedRecord.provider,
          kind: "reauthorization_required",
          payload: {
            occurredAt: appliedAt,
            reason: "hosted_runtime",
            ...(update.localState?.lastErrorCode ? { lastErrorCode: update.localState.lastErrorCode } : {}),
            ...(update.localState?.lastErrorMessage ? { lastErrorMessage: update.localState.lastErrorMessage } : {}),
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
  if (!update.connection) {
    return false;
  }

  return update.connection.status !== undefined
    || Object.prototype.hasOwnProperty.call(update.connection, "displayName")
    || Object.prototype.hasOwnProperty.call(update.connection, "scopes")
    || Object.prototype.hasOwnProperty.call(update.connection, "metadata");
}

function hasHostedDeviceSyncRuntimeLocalStateMutation(
  update: HostedDeviceSyncRuntimeConnectionUpdate,
): boolean {
  if (!update.localState) {
    return false;
  }

  return Object.prototype.hasOwnProperty.call(update.localState, "lastWebhookAt")
    || Object.prototype.hasOwnProperty.call(update.localState, "lastSyncStartedAt")
    || Object.prototype.hasOwnProperty.call(update.localState, "lastSyncCompletedAt")
    || Object.prototype.hasOwnProperty.call(update.localState, "lastSyncErrorAt")
    || Object.prototype.hasOwnProperty.call(update.localState, "lastErrorCode")
    || Object.prototype.hasOwnProperty.call(update.localState, "lastErrorMessage")
    || Object.prototype.hasOwnProperty.call(update.localState, "nextReconcileAt")
    || update.localState.clearError === true;
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
    accessTokenExpiresAt: connection.accessTokenExpiresAt ?? null,
    connectedAt: connection.connectedAt,
    createdAt: connection.createdAt,
    displayName: connection.displayName,
    externalAccountId: connection.externalAccountId,
    id: connection.id,
    metadata: connection.metadata,
    provider: connection.provider,
    scopes: connection.scopes,
    status: connection.status,
    updatedAt: connection.updatedAt,
  };
}

function normalizeHostedDeviceSyncRuntimeLocalState(
  connection: PublicDeviceSyncAccount,
): HostedDeviceSyncRuntimeConnectionSnapshot["localState"] {
  return {
    lastErrorCode: connection.lastErrorCode,
    lastErrorMessage: connection.lastErrorMessage,
    lastSyncCompletedAt: connection.lastSyncCompletedAt,
    lastSyncErrorAt: connection.lastSyncErrorAt,
    lastSyncStartedAt: connection.lastSyncStartedAt,
    lastWebhookAt: connection.lastWebhookAt,
    nextReconcileAt: connection.nextReconcileAt,
  };
}

function buildHostedDeviceSyncRuntimeLocalStateData(
  existing: {
    lastWebhookAt?: Date | string | null;
    lastSyncStartedAt?: Date | string | null;
    lastSyncCompletedAt?: Date | string | null;
    lastSyncErrorAt?: Date | string | null;
  },
  patch: HostedDeviceSyncRuntimeConnectionUpdate["localState"] | null,
): Record<string, unknown> {
  if (!patch) {
    return {};
  }

  const data: Record<string, unknown> = {};

  assignMonotonicRuntimeLocalStateDate(
    data,
    "lastWebhookAt",
    normalizeNullableIsoTimestamp(existing.lastWebhookAt),
    patch.lastWebhookAt,
  );
  assignMonotonicRuntimeLocalStateDate(
    data,
    "lastSyncStartedAt",
    normalizeNullableIsoTimestamp(existing.lastSyncStartedAt),
    patch.lastSyncStartedAt,
  );
  assignMonotonicRuntimeLocalStateDate(
    data,
    "lastSyncCompletedAt",
    normalizeNullableIsoTimestamp(existing.lastSyncCompletedAt),
    patch.lastSyncCompletedAt,
  );

  if (patch.clearError) {
    data.lastSyncErrorAt = null;
    data.lastErrorCode = null;
    data.lastErrorMessage = null;
  } else {
    assignMonotonicRuntimeLocalStateDate(
      data,
      "lastSyncErrorAt",
      normalizeNullableIsoTimestamp(existing.lastSyncErrorAt),
      patch.lastSyncErrorAt,
    );

    if (Object.prototype.hasOwnProperty.call(patch, "lastErrorCode")) {
      data.lastErrorCode = patch.lastErrorCode ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(patch, "lastErrorMessage")) {
      data.lastErrorMessage = patch.lastErrorMessage ?? null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, "nextReconcileAt")) {
    data.nextReconcileAt = patch.nextReconcileAt ? new Date(patch.nextReconcileAt) : null;
  }

  return data;
}

function assignMonotonicRuntimeLocalStateDate(
  data: Record<string, unknown>,
  key: "lastWebhookAt" | "lastSyncStartedAt" | "lastSyncCompletedAt" | "lastSyncErrorAt",
  existingValue: string | null,
  nextValue: string | null | undefined,
): void {
  if (nextValue === undefined) {
    return;
  }

  if (nextValue === null) {
    data[key] = null;
    return;
  }

  if (existingValue && Date.parse(nextValue) <= Date.parse(existingValue)) {
    return;
  }

  data[key] = new Date(nextValue);
}
