import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";

import type { PublicDeviceSyncAccount } from "@murphai/device-syncd/public-ingress";

import { buildHostedLocalHeartbeatUpdate } from "../local-heartbeat";
import { mapHostedPublicAccountRecord, PrismaHostedConnectionStore } from "./connections";
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
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        select 1
        from "device_connection"
        where "id" = ${connectionId}
          and "user_id" = ${userId}
        for update
      `;

      const existing = await tx.deviceConnection.findFirst({
        where: {
          id: connectionId,
          userId,
        },
      });

      if (!existing) {
        return null;
      }

      buildHostedLocalHeartbeatUpdate(
        mapHostedPublicAccountRecord(existing),
        toLocalHeartbeatValidationPatch(patch),
      );

      const updated = await tx.deviceConnection.update({
        where: {
          id: connectionId,
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

      return mapHostedPublicAccountRecord(updated);
    });
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
