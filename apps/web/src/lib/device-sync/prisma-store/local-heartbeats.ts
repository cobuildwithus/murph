import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";

import type { PublicDeviceSyncAccount } from "@murph/device-syncd";

import { PrismaHostedConnectionStore } from "./connections";
import type { UpdateLocalHeartbeatInput } from "./types";

type LocalHeartbeatErrorPatch =
  | { kind: "clear" }
  | {
      kind: "merge";
      lastErrorCode?: string | null;
      lastErrorMessage?: string | null;
    };

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
    const errorPatch = resolveLocalHeartbeatErrorPatch(patch);
    const updated = await this.prisma.deviceConnection.updateMany({
      where: {
        id: connectionId,
        userId,
      },
      data: {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.lastSyncStartedAt !== undefined
          ? {
              lastSyncStartedAt: patch.lastSyncStartedAt ? new Date(patch.lastSyncStartedAt) : null,
            }
          : {}),
        ...(patch.lastSyncCompletedAt !== undefined
          ? {
              lastSyncCompletedAt: patch.lastSyncCompletedAt ? new Date(patch.lastSyncCompletedAt) : null,
            }
          : {}),
        ...(patch.lastSyncErrorAt !== undefined
          ? {
              lastSyncErrorAt: patch.lastSyncErrorAt ? new Date(patch.lastSyncErrorAt) : null,
            }
          : {}),
        ...(patch.nextReconcileAt !== undefined
          ? {
              nextReconcileAt: patch.nextReconcileAt ? new Date(patch.nextReconcileAt) : null,
            }
          : {}),
        ...toPrismaHeartbeatErrorPatch(errorPatch),
      },
    });

    if (updated.count === 0) {
      return null;
    }

    return this.connections.getConnectionForUser(userId, connectionId);
  }
}

function resolveLocalHeartbeatErrorPatch(input: UpdateLocalHeartbeatInput): LocalHeartbeatErrorPatch {
  if (input.clearError) {
    return { kind: "clear" };
  }

  return {
    kind: "merge",
    ...(input.lastErrorCode !== undefined ? { lastErrorCode: input.lastErrorCode } : {}),
    ...(input.lastErrorMessage !== undefined ? { lastErrorMessage: input.lastErrorMessage } : {}),
  };
}

function toPrismaHeartbeatErrorPatch(
  errorPatch: LocalHeartbeatErrorPatch,
): Pick<Prisma.DeviceConnectionUpdateManyMutationInput, "lastErrorCode" | "lastErrorMessage" | "lastSyncErrorAt"> {
  if (errorPatch.kind === "clear") {
    return {
      lastSyncErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    };
  }

  return {
    ...(errorPatch.lastErrorCode !== undefined ? { lastErrorCode: errorPatch.lastErrorCode } : {}),
    ...(errorPatch.lastErrorMessage !== undefined ? { lastErrorMessage: errorPatch.lastErrorMessage } : {}),
  };
}
