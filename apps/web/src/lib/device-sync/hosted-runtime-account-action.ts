import { deviceSyncError } from "@murphai/device-syncd/errors";
import {
  parseHostedExecutionDeviceSyncAccountActionRequest,
  type HostedExecutionDeviceSyncAccountActionResponse,
} from "@murphai/device-syncd/hosted-runtime";

import { formatHostedExecutionSafeLogErrorDetails } from "../hosted-execution/logging";
import { createHostedDeviceSyncControlPlane } from "./control-plane";
import { createHostedDeviceSyncPublicIngressService } from "./public-ingress-service";
import {
  appendHostedDeviceSyncScheduledReconcileWake,
  buildHostedDeviceSyncScheduledReconcileWakeEventId,
  HOSTED_DEVICE_SYNC_PROVIDER_REVOKE_TIMEOUT_MS,
} from "./wake-service";

export async function runHostedDeviceSyncAccountAction(input: {
  request: Request;
  trustedUserId: string;
}): Promise<HostedExecutionDeviceSyncAccountActionResponse> {
  const disconnectPreFinalizationSignal = AbortSignal.any([
    input.request.signal,
    AbortSignal.timeout(HOSTED_DEVICE_SYNC_PROVIDER_REVOKE_TIMEOUT_MS),
  ]);
  const parsed = parseHostedExecutionDeviceSyncAccountActionRequest(
    await input.request.json(),
  );
  if (parsed.action === "disconnect") {
    const disconnected = await createHostedDeviceSyncPublicIngressService(
      input.request,
    ).disconnectTrustedConnection(
      input.trustedUserId,
      parsed.connectionId,
      parsed.expectedConnectedAt,
      {
        signal: disconnectPreFinalizationSignal,
      },
    );
    const occurredAt = disconnected.connection.updatedAt;

    return {
      action: "disconnect",
      connectionId: parsed.connectionId,
      occurredAt,
      status: "disconnected",
      ...(disconnected.warning ? { warning: disconnected.warning } : {}),
    };
  }

  const controlPlane = createHostedDeviceSyncControlPlane(input.request);
  const connection = await controlPlane.store.getConnectionForUser(
    input.trustedUserId,
    parsed.connectionId,
  );

  if (!connection) {
    throw deviceSyncError({
      code: "CONNECTION_NOT_FOUND",
      message: "Hosted device-sync connection was not found for the current user.",
      retryable: false,
      httpStatus: 404,
    });
  }

  if (connection.status === "disconnected") {
    throw deviceSyncError({
      code: "ACCOUNT_DISCONNECTED",
      message: "Disconnected device sync accounts must be reconnected before they can be reconciled.",
      retryable: false,
      httpStatus: 409,
    });
  }
  if (connection.status === "reauthorization_required") {
    throw deviceSyncError({
      code: "ACCOUNT_REAUTHORIZATION_REQUIRED",
      message: "This device sync account must be reconnected before it can be reconciled.",
      retryable: false,
      httpStatus: 409,
    });
  }

  const occurredAt = new Date().toISOString();
  const dueConnection = await controlPlane.store.markConnectionReconcileDueForUser({
    connectionId: connection.id,
    dueAt: new Date(occurredAt),
    userId: input.trustedUserId,
  });
  if (!dueConnection) {
    throw deviceSyncError({
      code: "RECONCILE_ACCOUNT_STATE_CHANGED",
      message: "Device sync account state changed before reconcile could be queued.",
      retryable: true,
      httpStatus: 409,
    });
  }

  try {
    const wakeResult = await appendHostedDeviceSyncScheduledReconcileWake({
      connectionId: dueConnection.connectionId,
      createdAt: occurredAt,
      eventId: buildHostedDeviceSyncScheduledReconcileWakeEventId({
        connectionId: dueConnection.connectionId,
        nextReconcileAt: dueConnection.nextReconcileAt,
      }),
      nextReconcileAt: dueConnection.nextReconcileAt,
      provider: dueConnection.provider,
      userId: dueConnection.userId,
    });

    if (!wakeResult.wakeAccepted) {
      console.warn("Hosted device reconcile immediate wake was not accepted.", {
        connectionId: dueConnection.connectionId,
        errorCode: "HOSTED_DEVICE_RECONCILE_WAKE_NOT_ACCEPTED",
        reason: wakeResult.reason ?? null,
      });
    }
  } catch (error) {
    // nextReconcileAt is already durable; the due-reconcile sweeper owns recovery.
    console.warn("Hosted device reconcile immediate wake failed after scheduling.", {
      ...formatHostedExecutionSafeLogErrorDetails(error, {
        code: "HOSTED_DEVICE_RECONCILE_WAKE_FAILED",
      }),
      connectionId: dueConnection.connectionId,
    });
  }

  return {
    action: "reconcile",
    connectionId: parsed.connectionId,
    occurredAt,
    status: "queued",
  };
}
