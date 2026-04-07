import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import {
  deviceSyncError,
  sanitizeStoredDeviceSyncMetadata,
  toRedactedPublicDeviceSyncAccount,
  type PublicDeviceSyncAccount,
  type UpsertPublicDeviceSyncConnectionInput,
} from "@murphai/device-syncd/public-ingress";

import { buildHostedProviderAccountBlindIndex } from "../crypto";
import {
  buildHostedPublicDeviceSyncAccount,
  findHostedDeviceSyncRuntimeConnection,
  type HostedStaticDeviceSyncConnectionRecord,
} from "../internal-runtime";
import { readHostedDeviceSyncRuntimeClientIfConfigured } from "../runtime-client";
import {
  maybeDate,
  maybeIsoTimestamp,
  normalizeNullableString,
  sanitizeHostedSqlErrorText,
  generateHostedRandomPrefixedId,
} from "../shared";
import type { HostedPrismaTransactionClient } from "./types";

export const hostedConnectionRecordArgs = {
  select: {
    connectedAt: true,
    createdAt: true,
    id: true,
    lastErrorCode: true,
    lastErrorMessage: true,
    lastSyncCompletedAt: true,
    lastSyncErrorAt: true,
    lastSyncStartedAt: true,
    lastWebhookAt: true,
    nextReconcileAt: true,
    provider: true,
    providerAccountBlindIndex: true,
    status: true,
    updatedAt: true,
    userId: true,
  },
} satisfies Prisma.DeviceConnectionDefaultArgs;

export type HostedConnectionRecord = Prisma.DeviceConnectionGetPayload<typeof hostedConnectionRecordArgs>;

export class PrismaHostedConnectionStore {
  readonly prisma: PrismaClient;
  private readonly providerAccountBlindIndexKey: Buffer | null;

  constructor(input: { prisma: PrismaClient; providerAccountBlindIndexKey?: Buffer | null }) {
    this.prisma = input.prisma;
    this.providerAccountBlindIndexKey = input.providerAccountBlindIndexKey ?? null;
  }

  async upsertConnection(input: UpsertPublicDeviceSyncConnectionInput): Promise<PublicDeviceSyncAccount> {
    const ownerId = normalizeNullableString(input.ownerId);
    const displayName = normalizeNullableString(input.displayName);
    const connectedAt = new Date(input.connectedAt);
    const providerAccountBlindIndex = this.buildProviderAccountBlindIndex(input.provider, input.externalAccountId);

    const record = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.deviceConnection.findUnique({
        where: {
          provider_providerAccountBlindIndex: {
            provider: input.provider,
            providerAccountBlindIndex,
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
            nextReconcileAt: maybeDate(input.nextReconcileAt),
            status: input.status ?? "active",
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
          id: generateHostedRandomPrefixedId("dsc"),
          nextReconcileAt: maybeDate(input.nextReconcileAt),
          provider: input.provider,
          providerAccountBlindIndex,
          status: input.status ?? "active",
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
        provider_providerAccountBlindIndex: {
          provider,
          providerAccountBlindIndex: this.buildProviderAccountBlindIndex(provider, externalAccountId),
        },
      },
      ...hostedConnectionRecordArgs,
    });

    return record
      ? this.hydrateRuntimeConnectionRecord(record, {
          externalAccountId,
        })
      : null;
  }

  async markWebhookReceived(accountId: string, now: string): Promise<void> {
    const record = await this.getConnectionRecordById(accountId);

    if (!record) {
      return;
    }

    await this.prisma.deviceConnection.update({
      where: {
        id: accountId,
      },
      data: {
        lastWebhookAt: new Date(now),
      },
    });

    const controlClient = readHostedDeviceSyncRuntimeClientIfConfigured();

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

  async syncDurableConnectionState(
    account: PublicDeviceSyncAccount,
    tx?: HostedPrismaTransactionClient,
  ): Promise<void> {
    const prisma = tx ?? this.prisma;

    await prisma.deviceConnection.update({
      where: {
        id: account.id,
      },
      data: {
        status: account.status,
        connectedAt: new Date(account.connectedAt),
        lastWebhookAt: maybeDate(account.lastWebhookAt),
        lastSyncStartedAt: maybeDate(account.lastSyncStartedAt),
        lastSyncCompletedAt: maybeDate(account.lastSyncCompletedAt),
        lastSyncErrorAt: maybeDate(account.lastSyncErrorAt),
        lastErrorCode: normalizeNullableString(account.lastErrorCode),
        lastErrorMessage: sanitizeHostedSqlErrorText(account.lastErrorMessage),
        nextReconcileAt: maybeDate(account.nextReconcileAt),
      },
    });
  }

  async listConnectionsForUser(userId: string): Promise<PublicDeviceSyncAccount[]> {
    const records = await this.listConnectionRecordsForUser(userId);
    return records.map((record) => this.buildDurableConnectionRecord(record));
  }

  async getConnectionForUser(userId: string, connectionId: string): Promise<PublicDeviceSyncAccount | null> {
    const record = await this.getConnectionRecordForUser(userId, connectionId);
    return record ? this.buildDurableConnectionRecord(record) : null;
  }

  async listRuntimeConnectionsForUser(userId: string): Promise<PublicDeviceSyncAccount[]> {
    const records = await this.listConnectionRecordsForUser(userId);
    return this.hydrateRuntimeConnectionRecords(records);
  }

  async getRuntimeConnectionForUser(userId: string, connectionId: string): Promise<PublicDeviceSyncAccount | null> {
    const record = await this.getConnectionRecordForUser(userId, connectionId);
    return record ? this.hydrateRuntimeConnectionRecord(record) : null;
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

  private buildProviderAccountBlindIndex(provider: string, externalAccountId: string): string {
    if (!this.providerAccountBlindIndexKey) {
      throw new TypeError("Hosted device-sync provider account blind-index key is required.");
    }

    return buildHostedProviderAccountBlindIndex({
      key: this.providerAccountBlindIndexKey,
      provider,
      externalAccountId,
    });
  }

  private buildDurableConnectionRecord(record: HostedConnectionRecord): PublicDeviceSyncAccount {
    return toRedactedPublicDeviceSyncAccount(
      buildHostedPublicDeviceSyncAccount({
        record: mapHostedConnectionRecord(record),
      }),
    );
  }

  private async hydrateRuntimeConnectionRecord(
    record: HostedConnectionRecord,
    fallback: {
      externalAccountId?: string | null;
      displayName?: string | null;
    } = {},
  ): Promise<PublicDeviceSyncAccount> {
    const controlClient = readHostedDeviceSyncRuntimeClientIfConfigured();
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
        fallback,
      }),
    );
  }

  private async hydrateRuntimeConnectionRecords(records: readonly HostedConnectionRecord[]): Promise<PublicDeviceSyncAccount[]> {
    if (records.length === 0) {
      return [];
    }

    const controlClient = readHostedDeviceSyncRuntimeClientIfConfigured();
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

export function mapHostedConnectionRecord(record: HostedConnectionRecord): HostedStaticDeviceSyncConnectionRecord {
  return {
    connectedAt: record.connectedAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    id: record.id,
    lastErrorCode: normalizeNullableString(record.lastErrorCode),
    lastErrorMessage: sanitizeHostedSqlErrorText(record.lastErrorMessage),
    lastSyncCompletedAt: maybeIsoTimestamp(record.lastSyncCompletedAt),
    lastSyncErrorAt: maybeIsoTimestamp(record.lastSyncErrorAt),
    lastSyncStartedAt: maybeIsoTimestamp(record.lastSyncStartedAt),
    lastWebhookAt: maybeIsoTimestamp(record.lastWebhookAt),
    nextReconcileAt: maybeIsoTimestamp(record.nextReconcileAt),
    provider: record.provider,
    status: record.status as HostedStaticDeviceSyncConnectionRecord["status"],
    updatedAt: record.updatedAt.toISOString(),
    userId: record.userId,
  } satisfies HostedStaticDeviceSyncConnectionRecord;
}
