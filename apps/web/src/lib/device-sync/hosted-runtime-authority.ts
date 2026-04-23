import {
  sanitizeStoredDeviceSyncMetadata,
  type PublicDeviceSyncAccount,
} from "@murphai/device-syncd/public-ingress";
import {
  parseHostedExecutionDeviceSyncRuntimeApplyRequest,
  parseHostedExecutionDeviceSyncRuntimeSnapshotRequest,
  type HostedExecutionDeviceSyncRuntimeApplyEntry,
  type HostedExecutionDeviceSyncRuntimeApplyResponse,
  type HostedExecutionDeviceSyncRuntimeConnectionSnapshot,
  type HostedExecutionDeviceSyncRuntimeSnapshotResponse,
  type HostedExecutionDeviceSyncRuntimeTokenBundle,
} from "@murphai/device-syncd/hosted-runtime";

import { createHostedDeviceSyncControlPlane } from "./control-plane";
import { buildHostedPublicDeviceSyncAccount } from "./internal-runtime";
import {
  hostedConnectionRecordArgs,
  mapHostedConnectionRecord,
  type HostedConnectionRecord,
  type HostedStoredDeviceSyncAccount,
} from "./prisma-store";

export async function readHostedDeviceSyncRuntimeState(input: {
  request: Request;
  trustedUserId: string;
}): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse> {
  const parsed = parseHostedExecutionDeviceSyncRuntimeSnapshotRequest(
    await input.request.json(),
    input.trustedUserId,
  );
  const controlPlane = createHostedDeviceSyncControlPlane(input.request);
  const records = await controlPlane.store.prisma.deviceConnection.findMany({
    where: {
      userId: input.trustedUserId,
      ...(parsed.connectionId ? { id: parsed.connectionId } : {}),
      ...(parsed.provider ? { provider: parsed.provider } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    ...hostedConnectionRecordArgs,
  });

  const connections = await Promise.all(
    records.map(async (record) => {
      const storedAccount = await controlPlane.store.getStoredConnectionAccountForUser(
        input.trustedUserId,
        record.id,
      );
      const durableConnection = storedAccount
        ? null
        : await controlPlane.store.getConnectionForUser(input.trustedUserId, record.id);

      return buildHostedRuntimeConnectionSnapshot(
        record,
        storedAccount,
        storedAccount?.externalAccountId ?? durableConnection?.externalAccountId ?? null,
      );
    }),
  );

  return {
    connections: sortHostedRuntimeConnectionSnapshots(connections),
    generatedAt: new Date().toISOString(),
    userId: input.trustedUserId,
  };
}

export async function applyHostedDeviceSyncRuntimeResult(input: {
  request: Request;
  trustedUserId: string;
}): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
  const parsed = parseHostedExecutionDeviceSyncRuntimeApplyRequest(
    await input.request.json(),
    input.trustedUserId,
  );
  const controlPlane = createHostedDeviceSyncControlPlane(input.request);
  const appliedAt = parsed.occurredAt ?? new Date().toISOString();

  for (const update of parsed.updates) {
    if (update.seed !== undefined) {
      throw new TypeError("Hosted device-sync runtime callbacks must not seed Cloudflare-owned state.");
    }
  }

  const updates = await Promise.all(
    parsed.updates.map(async (update) =>
      controlPlane.store.withConnectionRefreshLock(update.connectionId, async (tx) => {
        const record = await tx.deviceConnection.findFirst({
          where: {
            id: update.connectionId,
            userId: input.trustedUserId,
          },
          ...hostedConnectionRecordArgs,
        });

        if (!record) {
          return {
            connection: null,
            connectionId: update.connectionId,
            status: "missing",
            tokenUpdate: "missing",
            writeUpdate: "missing",
          } satisfies HostedExecutionDeviceSyncRuntimeApplyEntry;
        }

        const storedAccount = await controlPlane.store.getStoredConnectionAccountForUser(
          input.trustedUserId,
          update.connectionId,
          tx,
        );
        const durableConnection = storedAccount
          ? null
          : await controlPlane.store.getConnectionForUser(input.trustedUserId, update.connectionId);
        const durableExternalAccountId =
          storedAccount?.externalAccountId ?? durableConnection?.externalAccountId ?? null;
        const baseline = buildHostedRuntimeConnectionSnapshot(
          record,
          storedAccount,
          durableExternalAccountId,
        );
        const disconnectClearsTokens = update.connection?.status === "disconnected";
        const stateMutationRequested = update.connection !== undefined || update.localState !== undefined;
        const tokenMutationRequested = update.tokenBundle !== undefined || disconnectClearsTokens;
        const connectionWriteRequested = stateMutationRequested || tokenMutationRequested;
        const connectionVersionMismatch = stateMutationRequested
          && (baseline.connection.updatedAt ?? null) !== update.observedUpdatedAt;
        const tokenVersionMismatch = update.tokenBundle !== undefined
          && (baseline.tokenBundle?.tokenVersion ?? null) !== update.observedTokenVersion;
        const versionMismatch = connectionVersionMismatch || tokenVersionMismatch;
        const nextAccount = buildPublicConnectionFromRuntimeSnapshot(baseline);
        let tokenBundleToPersist: HostedExecutionDeviceSyncRuntimeTokenBundle | null | undefined;

        if (!versionMismatch && update.connection) {
          if (Object.prototype.hasOwnProperty.call(update.connection, "displayName")) {
            nextAccount.displayName = update.connection.displayName ?? null;
          }
          if (Object.prototype.hasOwnProperty.call(update.connection, "metadata")) {
            nextAccount.metadata = sanitizeStoredDeviceSyncMetadata(update.connection.metadata ?? {});
          }
          if (Object.prototype.hasOwnProperty.call(update.connection, "scopes")) {
            nextAccount.scopes = [...(update.connection.scopes ?? [])];
          }
          if (Object.prototype.hasOwnProperty.call(update.connection, "status") && update.connection.status) {
            nextAccount.status = update.connection.status;
          }
        }

        if (!versionMismatch && update.localState) {
          if (update.localState.clearError) {
            nextAccount.lastErrorCode = null;
            nextAccount.lastErrorMessage = null;
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
            if (Object.prototype.hasOwnProperty.call(update.localState, field)) {
              nextAccount[field] = update.localState[field] ?? null;
            }
          }
        }

        let tokenUpdate: HostedExecutionDeviceSyncRuntimeApplyEntry["tokenUpdate"];
        if (versionMismatch) {
          tokenUpdate = "skipped_version_mismatch";
        } else if (disconnectClearsTokens || update.tokenBundle === null) {
          tokenBundleToPersist = null;
          nextAccount.accessTokenExpiresAt = null;
          tokenUpdate = baseline.tokenBundle ? "cleared" : "missing";
        } else if (update.tokenBundle === undefined) {
          tokenUpdate = baseline.tokenBundle ? "unchanged" : "missing";
        } else {
          tokenBundleToPersist = {
            ...update.tokenBundle,
            tokenVersion: computeNextHostedTokenVersion(
              baseline.tokenBundle,
              update.tokenBundle,
            ),
          };
          nextAccount.accessTokenExpiresAt = tokenBundleToPersist.accessTokenExpiresAt;
          tokenUpdate = "applied";
        }

        const writeUpdate: HostedExecutionDeviceSyncRuntimeApplyEntry["writeUpdate"] = versionMismatch
          ? "skipped_version_mismatch"
          : connectionWriteRequested
            ? "applied"
            : "unchanged";

        if (!versionMismatch && connectionWriteRequested) {
          await controlPlane.store.syncDurableConnectionState(nextAccount, tx);
        }

        if (!versionMismatch && tokenMutationRequested) {
          await controlPlane.store.persistStoredConnectionTokenBundle({
            connectionId: update.connectionId,
            externalAccountId: storedAccount?.externalAccountId,
            provider: record.provider,
            tokenBundle: tokenBundleToPersist ?? null,
            tx,
          });
        }

        const refreshedRecord = await tx.deviceConnection.findFirst({
          where: {
            id: update.connectionId,
            userId: input.trustedUserId,
          },
          ...hostedConnectionRecordArgs,
        });
        const refreshedStoredAccount = refreshedRecord
          ? await controlPlane.store.getStoredConnectionAccountForUser(
              input.trustedUserId,
              update.connectionId,
              tx,
            )
          : null;

        return {
          connection: refreshedRecord
            ? buildHostedRuntimeConnectionSnapshot(
                refreshedRecord,
                refreshedStoredAccount,
                durableExternalAccountId,
              ).connection
            : null,
          connectionId: update.connectionId,
          status: "updated",
          tokenUpdate,
          writeUpdate,
        } satisfies HostedExecutionDeviceSyncRuntimeApplyEntry;
      })),
  );

  return {
    appliedAt,
    updates,
    userId: input.trustedUserId,
  };
}

function buildHostedRuntimeConnectionSnapshot(
  record: HostedConnectionRecord,
  storedAccount: HostedStoredDeviceSyncAccount | null,
  fallbackExternalAccountId: string | null = null,
): HostedExecutionDeviceSyncRuntimeConnectionSnapshot {
  const publicConnection = storedAccount
    ? storedAccount
    : buildHostedPublicDeviceSyncAccount({
        record: mapHostedConnectionRecord(record),
        fallback: {
          externalAccountId: fallbackExternalAccountId,
        },
      });

  return {
    connection: {
      accessTokenExpiresAt: publicConnection.accessTokenExpiresAt ?? null,
      connectedAt: publicConnection.connectedAt,
      createdAt: publicConnection.createdAt,
      displayName: publicConnection.displayName,
      externalAccountId: publicConnection.externalAccountId,
      id: publicConnection.id,
      metadata: sanitizeStoredDeviceSyncMetadata(publicConnection.metadata ?? {}),
      provider: publicConnection.provider,
      scopes: [...publicConnection.scopes],
      status: publicConnection.status,
      updatedAt: publicConnection.updatedAt,
    },
    localState: {
      lastErrorCode: publicConnection.lastErrorCode,
      lastErrorMessage: publicConnection.lastErrorMessage,
      lastSyncCompletedAt: publicConnection.lastSyncCompletedAt,
      lastSyncErrorAt: publicConnection.lastSyncErrorAt,
      lastSyncStartedAt: publicConnection.lastSyncStartedAt,
      lastWebhookAt: publicConnection.lastWebhookAt,
      nextReconcileAt: publicConnection.nextReconcileAt,
    },
    tokenBundle: storedAccount
      ? {
          accessToken: storedAccount.accessToken,
          accessTokenExpiresAt: storedAccount.accessTokenExpiresAt ?? null,
          keyVersion: storedAccount.keyVersion,
          refreshToken: storedAccount.refreshToken,
          tokenVersion: storedAccount.tokenVersion,
        }
      : null,
  };
}

function buildPublicConnectionFromRuntimeSnapshot(
  snapshot: HostedExecutionDeviceSyncRuntimeConnectionSnapshot,
): PublicDeviceSyncAccount {
  return {
    accessTokenExpiresAt: snapshot.connection.accessTokenExpiresAt,
    connectedAt: snapshot.connection.connectedAt,
    createdAt: snapshot.connection.createdAt,
    displayName: snapshot.connection.displayName,
    externalAccountId: snapshot.connection.externalAccountId,
    id: snapshot.connection.id,
    lastErrorCode: snapshot.localState.lastErrorCode,
    lastErrorMessage: snapshot.localState.lastErrorMessage,
    lastSyncCompletedAt: snapshot.localState.lastSyncCompletedAt,
    lastSyncErrorAt: snapshot.localState.lastSyncErrorAt,
    lastSyncStartedAt: snapshot.localState.lastSyncStartedAt,
    lastWebhookAt: snapshot.localState.lastWebhookAt,
    metadata: sanitizeStoredDeviceSyncMetadata(snapshot.connection.metadata ?? {}),
    nextReconcileAt: snapshot.localState.nextReconcileAt,
    provider: snapshot.connection.provider,
    scopes: [...snapshot.connection.scopes],
    status: snapshot.connection.status,
    updatedAt: snapshot.connection.updatedAt ?? snapshot.connection.createdAt,
  };
}

function sortHostedRuntimeConnectionSnapshots(
  connections: HostedExecutionDeviceSyncRuntimeConnectionSnapshot[],
): HostedExecutionDeviceSyncRuntimeConnectionSnapshot[] {
  return [...connections].sort((left, right) => {
    const leftUpdatedAt = left.connection.updatedAt ?? left.connection.createdAt;
    const rightUpdatedAt = right.connection.updatedAt ?? right.connection.createdAt;
    return rightUpdatedAt.localeCompare(leftUpdatedAt) || left.connection.id.localeCompare(right.connection.id);
  });
}

function computeNextHostedTokenVersion(
  current: HostedExecutionDeviceSyncRuntimeTokenBundle | null,
  next: HostedExecutionDeviceSyncRuntimeTokenBundle,
): number {
  if (!current) {
    return Math.max(1, next.tokenVersion);
  }

  return hasSameHostedTokenBundle(current, next)
    ? current.tokenVersion
    : current.tokenVersion + 1;
}

function hasSameHostedTokenBundle(
  left: HostedExecutionDeviceSyncRuntimeTokenBundle,
  right: HostedExecutionDeviceSyncRuntimeTokenBundle,
): boolean {
  return left.accessToken === right.accessToken
    && left.accessTokenExpiresAt === right.accessTokenExpiresAt
    && left.keyVersion === right.keyVersion
    && left.refreshToken === right.refreshToken;
}
