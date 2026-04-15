import { PrismaClient } from "@prisma/client";

import type { PublicDeviceSyncAccount } from "@murphai/device-syncd/public-ingress";

import {
  buildHostedLocalHeartbeatRuntimeLocalStateUpdate,
  type HostedLocalHeartbeatPatch,
} from "../local-heartbeat";
import { readHostedDeviceSyncRuntimeClientIfConfigured } from "../runtime-client";
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
    const existing = await this.connections.getConnectionForUser(userId, connectionId);

    if (!existing) {
      return null;
    }

    const localState = buildHostedLocalHeartbeatRuntimeLocalStateUpdate(existing, patch);
    const connection: PublicDeviceSyncAccount = {
      ...existing,
      ...localState,
      updatedAt: new Date().toISOString(),
    };

    await this.connections.syncDurableConnectionState(connection);

    const runtimeClient = readHostedDeviceSyncRuntimeClientIfConfigured();

    if (runtimeClient) {
      try {
        await runtimeClient.applyDeviceSyncRuntimeUpdates(userId, {
          occurredAt: new Date().toISOString(),
          updates: [
            {
              connectionId,
              localState,
              observedUpdatedAt: existing.updatedAt,
            },
          ],
        });
      } catch (error) {
        console.warn(`Hosted device-sync runtime projection write failed for local heartbeat ${connectionId}.`, error);
      }
    }

    return connection;
  }
}
