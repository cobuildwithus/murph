import { PrismaClient } from "@prisma/client";

import { deviceSyncError } from "@murphai/device-syncd/errors";
import type { PublicDeviceSyncAccount } from "@murphai/device-syncd/types";

import {
  buildHostedLocalHeartbeatRuntimeLocalStateUpdate,
  type HostedLocalHeartbeatPatch,
} from "../local-heartbeat";
import { sanitizeHostedConnectionLastErrorMessage } from "../shared";
import type { HostedPrismaTransactionClient } from "./types";
import { normalizeHostedDeviceSyncLifecycleStatus } from "./connection-records";
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
    const record = await this.connections.getConnectionRecordForUser(userId, connectionId, tx);
    if (!record) {
      return null;
    }
    if (record.disconnectLeaseOwner !== null || record.disconnectLeaseExpiresAt !== null) {
      throw deviceSyncError({
        code: "CONNECTION_DISCONNECT_IN_PROGRESS",
        message: "This device connection is being disconnected and cannot accept a local heartbeat.",
        retryable: true,
        httpStatus: 409,
      });
    }
    if (normalizeHostedDeviceSyncLifecycleStatus(record.status) !== "active") {
      throw deviceSyncError({
        code: "CONNECTION_NOT_ACTIVE",
        message: "This device connection is not active and cannot accept a local heartbeat.",
        retryable: false,
        httpStatus: 409,
      });
    }

    const existing = await this.connections.getConnectionForUser(userId, connectionId, tx);

    // The advisory lock held by the caller keeps this second read on the same
    // active, lease-free connection record that was authorized above.
    if (!existing) {
      return null;
    }

    const localState = buildHostedLocalHeartbeatRuntimeLocalStateUpdate(existing, patch);
    const durableConnection = await this.connections.syncDurableConnectionLocalHeartbeatState(existing, localState, tx);
    const responseLocalState = "lastErrorMessage" in localState
      ? {
          ...localState,
          lastErrorMessage: sanitizeHostedConnectionLastErrorMessage(localState.lastErrorMessage ?? null),
        }
      : localState;

    return {
      ...durableConnection,
      ...responseLocalState,
    };
  }
}
