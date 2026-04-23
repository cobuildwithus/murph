import { PrismaClient } from "@prisma/client";

import type { PublicDeviceSyncAccount } from "@murphai/device-syncd/public-ingress";

import {
  buildHostedLocalHeartbeatRuntimeLocalStateUpdate,
  type HostedLocalHeartbeatPatch,
} from "../local-heartbeat";
import type { HostedPrismaTransactionClient } from "./types";
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
    tx?: HostedPrismaTransactionClient,
  ): Promise<PublicDeviceSyncAccount | null> {
    const existing = await this.connections.getConnectionForUser(userId, connectionId, tx);

    if (!existing) {
      return null;
    }

    const localState = buildHostedLocalHeartbeatRuntimeLocalStateUpdate(existing, patch);
    const durableConnection = await this.connections.syncDurableConnectionLocalHeartbeatState(existing, localState, tx);

    return {
      ...durableConnection,
      ...localState,
    };
  }
}
