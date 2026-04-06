import {
  deviceSyncError,
  sanitizeStoredDeviceSyncMetadata,
  type DeviceSyncAccount,
  type PublicDeviceSyncAccount,
} from "@murphai/device-syncd/public-ingress";
import type {
  HostedExecutionDeviceSyncRuntimeConnectionSnapshot,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
  HostedExecutionDeviceSyncRuntimeTokenBundle,
} from "@murphai/hosted-execution";


export {
  parseHostedDeviceSyncRuntimeApplyRequest,
  parseHostedDeviceSyncRuntimeSnapshotRequest,
} from "./internal-runtime-request";

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
