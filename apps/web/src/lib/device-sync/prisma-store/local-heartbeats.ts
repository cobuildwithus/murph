import { PrismaClient } from "@prisma/client";

import { deviceSyncError } from "@murphai/device-syncd/errors";
import { isDeviceSyncDisconnectInProgress } from "@murphai/device-syncd/public-account";
import type { PublicDeviceSyncAccount } from "@murphai/device-syncd/types";

import {
  buildHostedLocalHeartbeatRuntimeLocalStateUpdate,
  type HostedLocalHeartbeatPatch,
} from "../local-heartbeat";
import { sanitizeHostedConnectionLastErrorMessage } from "../shared";
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

    if (isDeviceSyncDisconnectInProgress(existing)) {
      throw deviceSyncError({
        code: "CONNECTION_DISCONNECT_IN_PROGRESS",
        message: "Device sync disconnect is still in progress. Retry later.",
        retryable: true,
        httpStatus: 409,
      });
    }

    if (existing.status === "reauthorization_required") {
      throw localHeartbeatReauthorizationRequiredError(connectionId);
    }

    const localState = buildHostedLocalHeartbeatRuntimeLocalStateUpdate(existing, patch);
    const durableConnection = await this.connections.syncDurableConnectionLocalHeartbeatState(existing, localState, tx);
    if (!durableConnection) {
      throw localHeartbeatReauthorizationRequiredError(connectionId);
    }
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

function localHeartbeatReauthorizationRequiredError(connectionId: string) {
  return deviceSyncError({
    code: "ACCOUNT_REAUTHORIZATION_REQUIRED",
    message: "Hosted device-sync connection requires reauthorization before local heartbeat state can be accepted.",
    retryable: false,
    httpStatus: 409,
    accountStatus: "reauthorization_required",
    details: { connectionId },
  });
}
