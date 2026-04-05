import {
  deviceSyncError,
  sanitizeStoredDeviceSyncMetadata,
  type DeviceSyncAccount,
  type PublicDeviceSyncAccount,
} from "@murphai/device-syncd/public-ingress";
import type {
  HostedExecutionDeviceSyncRuntimeConnectionSnapshot,
  HostedExecutionDeviceSyncRuntimeSnapshotRequest,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
  HostedExecutionDeviceSyncRuntimeTokenBundle,
} from "@murphai/hosted-execution";

import {
  mapHostedInternalAccountRecord,
  PrismaDeviceSyncControlPlaneStore,
} from "./prisma-store";
import { toIsoTimestamp } from "./shared";

export {
  parseHostedDeviceSyncRuntimeApplyRequest,
  parseHostedDeviceSyncRuntimeSnapshotRequest,
} from "./internal-runtime-request";

export async function buildHostedDeviceSyncRuntimeSnapshot(
  store: PrismaDeviceSyncControlPlaneStore,
  request: HostedExecutionDeviceSyncRuntimeSnapshotRequest,
): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse> {
  const generatedAt = toIsoTimestamp(new Date());
  const records = await store.prisma.deviceConnection.findMany({
    where: {
      userId: request.userId,
      ...(request.connectionId ? { id: request.connectionId } : {}),
      ...(request.provider ? { provider: request.provider } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
  });

  return {
    connections: records.map((record) => {
      const connection = normalizeHostedDeviceSyncRuntimeConnection(
        mapHostedInternalAccountRecord(record),
      );
      const localState = normalizeHostedDeviceSyncRuntimeLocalState(
        mapHostedInternalAccountRecord(record),
      );

      return {
        connection,
        localState,
        tokenBundle: null,
      } satisfies HostedExecutionDeviceSyncRuntimeConnectionSnapshot;
    }),
    generatedAt,
    userId: request.userId,
  };
}

export function findHostedDeviceSyncRuntimeConnection(
  snapshot: HostedExecutionDeviceSyncRuntimeSnapshotResponse,
  connectionId: string,
): HostedExecutionDeviceSyncRuntimeConnectionSnapshot | null {
  return snapshot.connections.find((entry) => entry.connection.id === connectionId) ?? null;
}

export function requireHostedDeviceSyncRuntimeTokenBundle(input: {
  connectionId: string;
  runtimeConnection: HostedExecutionDeviceSyncRuntimeConnectionSnapshot | null;
  userId: string;
}): HostedExecutionDeviceSyncRuntimeTokenBundle {
  if (input.runtimeConnection?.tokenBundle) {
    return input.runtimeConnection.tokenBundle;
  }

  throw deviceSyncError({
    code: "CONNECTION_SECRET_MISSING",
    message: "Hosted device-sync connection no longer has an escrowed token bundle.",
    retryable: false,
    httpStatus: 409,
    details: {
      connectionId: input.connectionId,
      userId: input.userId,
    },
  });
}

export function composeHostedRuntimeDeviceSyncAccount(input: {
  connection: PublicDeviceSyncAccount;
  tokenBundle: HostedExecutionDeviceSyncRuntimeTokenBundle;
}): DeviceSyncAccount {
  return {
    accessToken: input.tokenBundle.accessToken,
    refreshToken: input.tokenBundle.refreshToken,
    disconnectGeneration: 0,
    ...input.connection,
    accessTokenExpiresAt: input.tokenBundle.accessTokenExpiresAt,
    metadata: sanitizeStoredDeviceSyncMetadata(input.connection.metadata ?? {}),
  };
}

function normalizeHostedDeviceSyncRuntimeConnection(
  connection: PublicDeviceSyncAccount,
): HostedExecutionDeviceSyncRuntimeConnectionSnapshot["connection"] {
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
): HostedExecutionDeviceSyncRuntimeConnectionSnapshot["localState"] {
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
