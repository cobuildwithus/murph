import { PrismaClient } from "@prisma/client";

import { deviceSyncError, type PublicDeviceSyncAccount } from "@murphai/device-syncd/public-ingress";

import { requireHostedExecutionControlClient } from "../../hosted-execution/control";
import { buildHostedLocalHeartbeatUpdate } from "../local-heartbeat";
import { PrismaHostedConnectionStore } from "./connections";
import type { UpdateLocalHeartbeatInput } from "./types";

export class PrismaHostedLocalHeartbeatStore {
  readonly prisma: PrismaClient;
  readonly connections: PrismaHostedConnectionStore;

  constructor(input: { prisma: PrismaClient; connections: PrismaHostedConnectionStore }) {
    this.prisma = input.prisma;
    this.connections = input.connections;
  }

  async updateConnectionFromLocalHeartbeat(
    userId: string,
    connectionId: string,
    patch: UpdateLocalHeartbeatInput,
  ): Promise<PublicDeviceSyncAccount | null> {
    const existing = await this.connections.getRuntimeConnectionForUser(userId, connectionId);

    if (!existing) {
      return null;
    }

    buildHostedLocalHeartbeatUpdate(existing, toLocalHeartbeatValidationPatch(patch));

    const response = await requireHostedExecutionControlClient().applyDeviceSyncRuntimeUpdates(userId, {
      occurredAt: new Date().toISOString(),
      updates: [
        {
          connectionId,
          localState: {
            ...(patch.clearError ? { clearError: true } : {}),
            ...(patch.lastErrorCode !== undefined ? { lastErrorCode: patch.lastErrorCode } : {}),
            ...(patch.lastErrorMessage !== undefined ? { lastErrorMessage: patch.lastErrorMessage } : {}),
            ...(patch.lastSyncCompletedAt !== undefined ? { lastSyncCompletedAt: patch.lastSyncCompletedAt } : {}),
            ...(patch.lastSyncErrorAt !== undefined ? { lastSyncErrorAt: patch.lastSyncErrorAt } : {}),
            ...(patch.lastSyncStartedAt !== undefined ? { lastSyncStartedAt: patch.lastSyncStartedAt } : {}),
            ...(patch.nextReconcileAt !== undefined ? { nextReconcileAt: patch.nextReconcileAt } : {}),
          },
        },
      ],
    });
    const update = response.updates.find((entry) => entry.connectionId === connectionId) ?? null;

    if (update?.status === "missing") {
      throw deviceSyncError({
        code: "RUNTIME_STATE_CONFLICT",
        message: `Hosted device-sync runtime is missing connection ${connectionId}.`,
        retryable: true,
        httpStatus: 409,
      });
    }

    const connection = await this.connections.getRuntimeConnectionForUser(userId, connectionId);

    if (connection) {
      await this.connections.syncDurableConnectionState(connection);
    }

    return connection;
  }
}

function toLocalHeartbeatValidationPatch(
  input: UpdateLocalHeartbeatInput,
): Parameters<typeof buildHostedLocalHeartbeatUpdate>[1] {
  return {
    ...(input.lastSyncStartedAt !== undefined && input.lastSyncStartedAt !== null
      ? { lastSyncStartedAt: input.lastSyncStartedAt }
      : {}),
    ...(input.lastSyncCompletedAt !== undefined && input.lastSyncCompletedAt !== null
      ? { lastSyncCompletedAt: input.lastSyncCompletedAt }
      : {}),
    ...(input.lastSyncErrorAt !== undefined && input.lastSyncErrorAt !== null
      ? { lastSyncErrorAt: input.lastSyncErrorAt }
      : {}),
    ...(input.lastErrorCode !== undefined && input.lastErrorCode !== null
      ? { lastErrorCode: input.lastErrorCode }
      : {}),
    ...(input.lastErrorMessage !== undefined && input.lastErrorMessage !== null
      ? { lastErrorMessage: input.lastErrorMessage }
      : {}),
  };
}
