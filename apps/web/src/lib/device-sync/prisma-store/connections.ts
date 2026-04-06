import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import {
  deviceSyncError,
  sanitizeStoredDeviceSyncMetadata,
  toRedactedPublicDeviceSyncAccount,
  type PublicDeviceSyncAccount,
  type UpsertPublicDeviceSyncConnectionInput,
} from "@murphai/device-syncd/public-ingress";

import {
  readHostedExecutionControlClientIfConfigured,
} from "../../hosted-execution/control";
import {
  buildHostedPublicDeviceSyncAccount,
  findHostedDeviceSyncRuntimeConnection,
  type HostedStaticDeviceSyncConnectionRecord,
} from "../internal-runtime";
import { generateHostedRandomPrefixedId } from "../shared";

export const hostedConnectionRecordArgs = {
  select: {
    connectedAt: true,
    createdAt: true,
    displayName: true,
    externalAccountId: true,
    id: true,
    provider: true,
    updatedAt: true,
    userId: true,
  },
} satisfies Prisma.DeviceConnectionDefaultArgs;

export type HostedConnectionRecord = Prisma.DeviceConnectionGetPayload<typeof hostedConnectionRecordArgs>;

export class PrismaHostedConnectionStore {
  readonly prisma: PrismaClient;

  constructor(input: { prisma: PrismaClient }) {
    this.prisma = input.prisma;
  }

  async upsertConnection(input: UpsertPublicDeviceSyncConnectionInput): Promise<PublicDeviceSyncAccount> {
    const ownerId = typeof input.ownerId === "string" && input.ownerId.trim() ? input.ownerId.trim() : null;
    const displayName = normalizeNullableString(input.displayName);
    const connectedAt = new Date(input.connectedAt);

    const record = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.deviceConnection.findUnique({
        where: {
          provider_externalAccountId: {
            provider: input.provider,
            externalAccountId: input.externalAccountId,
          },
        },
        ...hostedConnectionRecordArgs,
      });

      if (existing) {
        if (ownerId && existing.userId !== ownerId) {
          throw deviceSyncError({
            code: "CONNECTION_OWNERSHIP_CONFLICT",
            message: "This provider account is already connected to a different Murph user.",
            retryable: false,
            httpStatus: 409,
          });
        }

        return tx.deviceConnection.update({
          where: {
            id: existing.id,
          },
          data: {
            connectedAt,
            displayName,
          },
          ...hostedConnectionRecordArgs,
        });
      }

      if (!ownerId) {
        throw deviceSyncError({
          code: "CONNECTION_OWNER_REQUIRED",
          message: "Hosted device-sync connections must be initiated by an authenticated Murph user.",
          retryable: false,
          httpStatus: 400,
        });
      }

      return tx.deviceConnection.create({
        data: {
          connectedAt,
          displayName,
          externalAccountId: input.externalAccountId,
          id: generateHostedRandomPrefixedId("dsc"),
          provider: input.provider,
          userId: ownerId,
        },
        ...hostedConnectionRecordArgs,
      });
    });

    return toRedactedPublicDeviceSyncAccount(
      buildHostedPublicDeviceSyncAccount({
        record: mapHostedConnectionRecord(record),
        fallback: {
          accessTokenExpiresAt: input.tokens.accessTokenExpiresAt ?? null,
          displayName,
          metadata: sanitizeStoredDeviceSyncMetadata(input.metadata ?? {}),
          nextReconcileAt: input.nextReconcileAt ?? null,
          scopes: input.scopes ?? [],
          status: input.status ?? "active",
        },
      }),
    );
  }

  async getConnectionByExternalAccount(
    provider: string,
    externalAccountId: string,
  ): Promise<PublicDeviceSyncAccount | null> {
    const record = await this.prisma.deviceConnection.findUnique({
      where: {
        provider_externalAccountId: {
          provider,
          externalAccountId,
        },
      },
      ...hostedConnectionRecordArgs,
    });

    return record ? this.hydrateConnectionRecord(record) : null;
  }

  async markWebhookReceived(accountId: string, now: string): Promise<void> {
    const record = await this.getConnectionRecordById(accountId);

    if (!record) {
      return;
    }

    const controlClient = readHostedExecutionControlClientIfConfigured();

    if (!controlClient) {
      return;
    }

    await controlClient.applyDeviceSyncRuntimeUpdates(record.userId, {
      occurredAt: now,
      updates: [
        {
          connectionId: record.id,
          localState: {
            lastWebhookAt: now,
          },
        },
      ],
    });
  }

  async listConnectionsForUser(userId: string): Promise<PublicDeviceSyncAccount[]> {
    const records = await this.listConnectionRecordsForUser(userId);

    return this.hydrateConnectionRecords(records);
  }

  async getConnectionForUser(userId: string, connectionId: string): Promise<PublicDeviceSyncAccount | null> {
    const record = await this.getConnectionRecordForUser(userId, connectionId);

    return record ? this.hydrateConnectionRecord(record) : null;
  }

  async getConnectionOwnerId(connectionId: string): Promise<string | null> {
    const record = await this.prisma.deviceConnection.findUnique({
      where: {
        id: connectionId,
      },
      select: {
        userId: true,
      },
    });

    return record?.userId ?? null;
  }

  async listConnectionRecordsForUser(userId: string): Promise<HostedConnectionRecord[]> {
    return this.prisma.deviceConnection.findMany({
      where: {
        userId,
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      ...hostedConnectionRecordArgs,
    });
  }

  async getConnectionRecordForUser(userId: string, connectionId: string): Promise<HostedConnectionRecord | null> {
    return this.prisma.deviceConnection.findFirst({
      where: {
        id: connectionId,
        userId,
      },
      ...hostedConnectionRecordArgs,
    });
  }

  async getConnectionRecordById(connectionId: string): Promise<HostedConnectionRecord | null> {
    return this.prisma.deviceConnection.findUnique({
      where: {
        id: connectionId,
      },
      ...hostedConnectionRecordArgs,
    });
  }

  private async hydrateConnectionRecord(record: HostedConnectionRecord): Promise<PublicDeviceSyncAccount> {
    const controlClient = readHostedExecutionControlClientIfConfigured();
    const runtimeSnapshot = controlClient
      ? await controlClient.getDeviceSyncRuntimeSnapshot(record.userId, {
          connectionId: record.id,
          provider: record.provider,
        })
      : null;
    const runtimeConnection = runtimeSnapshot
      ? findHostedDeviceSyncRuntimeConnection(runtimeSnapshot, record.id)
      : null;

    return toRedactedPublicDeviceSyncAccount(
      buildHostedPublicDeviceSyncAccount({
        record: mapHostedConnectionRecord(record),
        runtimeConnection,
      }),
    );
  }

  private async hydrateConnectionRecords(records: readonly HostedConnectionRecord[]): Promise<PublicDeviceSyncAccount[]> {
    if (records.length === 0) {
      return [];
    }

    const controlClient = readHostedExecutionControlClientIfConfigured();
    const runtimeSnapshot = controlClient
      ? await controlClient.getDeviceSyncRuntimeSnapshot(records[0].userId, {})
      : null;

    return records.map((record) => toRedactedPublicDeviceSyncAccount(
      buildHostedPublicDeviceSyncAccount({
        record: mapHostedConnectionRecord(record),
        runtimeConnection: runtimeSnapshot ? findHostedDeviceSyncRuntimeConnection(runtimeSnapshot, record.id) : null,
      }),
    ));
  }
}

function mapHostedConnectionRecord(record: HostedConnectionRecord): HostedStaticDeviceSyncConnectionRecord {
  return {
    connectedAt: record.connectedAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    displayName: normalizeNullableString(record.displayName),
    externalAccountId: record.externalAccountId,
    id: record.id,
    provider: record.provider,
    updatedAt: record.updatedAt.toISOString(),
    userId: record.userId,
  } satisfies HostedStaticDeviceSyncConnectionRecord;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
