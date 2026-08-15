import { deviceSyncError } from "@murphai/device-syncd/errors";
import {
  parseHostedExecutionDeviceSyncReconcileRequest,
  type HostedExecutionDeviceSyncReconcileResponse,
} from "@murphai/device-syncd/hosted-runtime";

import { createHostedDeviceSyncControlPlane } from "./control-plane";
import { appendHostedDeviceSyncManualReconcileWake } from "./wake-service";

export async function requestHostedDeviceSyncReconcile(input: {
  request: Request;
  trustedUserId: string;
}): Promise<HostedExecutionDeviceSyncReconcileResponse> {
  const parsed = parseHostedExecutionDeviceSyncReconcileRequest(
    await input.request.json(),
  );
  const connection = await createHostedDeviceSyncControlPlane(input.request)
    .store.getConnectionForUser(input.trustedUserId, parsed.connectionId);

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

  const occurredAt = new Date().toISOString();
  const wake = await appendHostedDeviceSyncManualReconcileWake({
    connectionId: connection.id,
    expectedConnectedAt: connection.connectedAt,
    occurredAt,
    provider: connection.provider,
    userId: input.trustedUserId,
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
