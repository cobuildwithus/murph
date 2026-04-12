import { PrismaClient } from "@prisma/client";

import { deviceSyncError, type PublicDeviceSyncAccount } from "@murphai/device-syncd/public-ingress";

import {
  buildHostedLocalHeartbeatRuntimeLocalStateUpdate,
  type HostedLocalHeartbeatPatch,
} from "../local-heartbeat";
import { requireHostedDeviceSyncRuntimeClient } from "../runtime-client";
import { PrismaHostedConnectionStore } from "./connections";

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
    patch: HostedLocalHeartbeatPatch,
  ): Promise<PublicDeviceSyncAccount | null> {
    const existing = await this.connections.getRuntimeConnectionForUser(userId, connectionId);

    if (!existing) {
      return null;
    }

    const response = await requireHostedDeviceSyncRuntimeClient().applyDeviceSyncRuntimeUpdates(userId, {
      occurredAt: new Date().toISOString(),
      updates: [
        {
          connectionId,
          localState: buildHostedLocalHeartbeatRuntimeLocalStateUpdate(existing, patch),
          observedUpdatedAt: existing.updatedAt,
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
