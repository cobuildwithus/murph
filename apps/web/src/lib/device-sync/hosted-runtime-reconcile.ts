import { deviceSyncError } from "@murphai/device-syncd/errors";
import {
  parseHostedExecutionDeviceSyncReconcileRequest,
  type HostedExecutionDeviceSyncReconcileResponse,
} from "@murphai/device-syncd/hosted-runtime";

import { createHostedDeviceSyncControlPlane } from "./control-plane";
import type { PrismaDeviceSyncControlPlaneStore } from "./prisma-store";
import { appendHostedDeviceSyncManualReconcileWake } from "./wake-service";

export async function requestHostedDeviceSyncReconcile(input: {
  request: Request;
  trustedUserId: string;
}): Promise<HostedExecutionDeviceSyncReconcileResponse> {
  const parsed = parseHostedExecutionDeviceSyncReconcileRequest(
    await input.request.json(),
  );
  return queueHostedDeviceSyncManualReconcile({
    connectionId: parsed.connectionId,
    store: createHostedDeviceSyncControlPlane(input.request).store,
    userId: input.trustedUserId,
  });
}

/**
 * Queues one re-sync of a connection its owner holds and that is still active.
 * Member surfaces pass `occurredAt` rounded to a bucket so repeated taps
 * collapse into one wake.
 */
export async function queueHostedDeviceSyncManualReconcile(input: {
  connectionId: string;
  occurredAt?: (connectedAt: string) => string;
  store: Pick<PrismaDeviceSyncControlPlaneStore, "getConnectionForUser">;
  userId: string;
}): Promise<HostedExecutionDeviceSyncReconcileResponse> {
  const connection = await input.store.getConnectionForUser(input.userId, input.connectionId);

  if (!connection) {
    throw deviceSyncError({
      code: "CONNECTION_NOT_FOUND",
      httpStatus: 404,
      message: "Hosted device-sync connection was not found for the current user.",
      retryable: false,
    });
  }
  if (connection.status !== "active") {
    throw deviceSyncError({
      code: connection.status === "disconnected"
        ? "ACCOUNT_DISCONNECTED"
        : "ACCOUNT_REAUTHORIZATION_REQUIRED",
      httpStatus: 409,
      message: "This device sync account must be reconnected before it can be reconciled.",
      retryable: false,
    });
  }

  const occurredAt = input.occurredAt?.(connection.connectedAt) ?? new Date().toISOString();
  const wake = await appendHostedDeviceSyncManualReconcileWake({
    connectionId: connection.id,
    expectedConnectedAt: connection.connectedAt,
    occurredAt,
    provider: connection.provider,
    userId: input.userId,
  });
  if (!wake.wakeAccepted) {
    throw deviceSyncError({
      code: "RECONCILE_WAKE_NOT_ACCEPTED",
      httpStatus: 503,
      message: "Hosted device reconcile could not be queued.",
      retryable: true,
    });
  }

  return {
    connectionId: connection.id,
    occurredAt,
    status: "queued",
  };
}
