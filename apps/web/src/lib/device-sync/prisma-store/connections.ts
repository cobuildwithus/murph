import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { deviceSyncError, toRedactedPublicDeviceSyncAccount } from "@murph/device-syncd";

import type {
  DeviceSyncAccountStatus,
  PublicDeviceSyncAccount,
  UpsertPublicDeviceSyncConnectionInput,
} from "@murph/device-syncd";
import type { HostedSecretCodec } from "../crypto";
import { generateHostedRandomPrefixedId, maybeIsoTimestamp, toJsonRecord } from "../shared";
import { toPrismaJsonObject } from "./prisma-json";
import type { HostedConnectionSecretBundle, HostedPrismaTransactionClient } from "./types";

export const hostedConnectionWithSecretArgs = {
  include: {
    secret: true,
  },
} satisfies Prisma.DeviceConnectionDefaultArgs;

type HostedPublicAccountPrismaRecord = Prisma.DeviceConnectionGetPayload<Prisma.DeviceConnectionDefaultArgs>;
export type HostedConnectionWithSecretRecord = Prisma.DeviceConnectionGetPayload<typeof hostedConnectionWithSecretArgs>;

export class PrismaHostedConnectionStore {
  readonly prisma: PrismaClient;
  readonly codec: HostedSecretCodec;

  constructor(input: { prisma: PrismaClient; codec: HostedSecretCodec }) {
    this.prisma = input.prisma;
    this.codec = input.codec;
  }

  async upsertConnection(input: UpsertPublicDeviceSyncConnectionInput): Promise<PublicDeviceSyncAccount> {
    const ownerId = typeof input.ownerId === "string" && input.ownerId.trim() ? input.ownerId.trim() : null;
    const accessTokenEncrypted = this.codec.encrypt(input.tokens.accessToken);
    const refreshTokenEncrypted = input.tokens.refreshToken ? this.codec.encrypt(input.tokens.refreshToken) : null;
    const accessTokenExpiresAt = input.tokens.accessTokenExpiresAt ? new Date(input.tokens.accessTokenExpiresAt) : null;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.deviceConnection.findUnique({
        where: {
          provider_externalAccountId: {
            provider: input.provider,
            externalAccountId: input.externalAccountId,
          },
        },
        ...hostedConnectionWithSecretArgs,
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

        await tx.deviceConnection.update({
          where: {
            id: existing.id,
          },
          data: {
            displayName: input.displayName ?? null,
            status: input.status ?? "active",
            scopes: input.scopes ?? [],
            accessTokenExpiresAt,
            metadataJson: toPrismaJsonObject(input.metadata ?? {}),
            connectedAt: new Date(input.connectedAt),
            nextReconcileAt: input.nextReconcileAt ? new Date(input.nextReconcileAt) : null,
            lastSyncErrorAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        });

        await tx.deviceConnectionSecret.upsert({
          where: {
            connectionId: existing.id,
          },
          create: {
            connectionId: existing.id,
            accessTokenEncrypted,
            refreshTokenEncrypted,
            tokenVersion: 1,
            keyVersion: this.codec.keyVersion,
          },
          update: {
            accessTokenEncrypted,
            refreshTokenEncrypted,
            tokenVersion: {
              increment: 1,
            },
            keyVersion: this.codec.keyVersion,
          },
        });

        const updated = await tx.deviceConnection.findUnique({
          where: {
            id: existing.id,
          },
        });

        return requireHostedPublicAccountRecord(updated);
      }

      if (!ownerId) {
        throw deviceSyncError({
          code: "CONNECTION_OWNER_REQUIRED",
          message: "Hosted device-sync connections must be initiated by an authenticated Murph user.",
          retryable: false,
          httpStatus: 400,
        });
      }

      const connectionId = generateHostedRandomPrefixedId("dsc");
      await tx.deviceConnection.create({
        data: {
          id: connectionId,
          userId: ownerId,
          provider: input.provider,
          externalAccountId: input.externalAccountId,
          displayName: input.displayName ?? null,
          status: input.status ?? "active",
          scopes: input.scopes ?? [],
          accessTokenExpiresAt,
          metadataJson: toPrismaJsonObject(input.metadata ?? {}),
          connectedAt: new Date(input.connectedAt),
          nextReconcileAt: input.nextReconcileAt ? new Date(input.nextReconcileAt) : null,
        },
      });
      await tx.deviceConnectionSecret.create({
        data: {
          connectionId,
          accessTokenEncrypted,
          refreshTokenEncrypted,
          tokenVersion: 1,
          keyVersion: this.codec.keyVersion,
        },
      });

      const created = await tx.deviceConnection.findUnique({
        where: {
          id: connectionId,
        },
      });

      return requireHostedPublicAccountRecord(created);
    });
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
    });

    return record ? mapHostedPublicAccountRecord(record) : null;
  }

  async markWebhookReceived(accountId: string, now: string): Promise<void> {
    // Use raw SQL so `last_webhook_at` can advance without Prisma bumping `updated_at`.
    await this.prisma.$executeRaw`
      update device_connection
      set last_webhook_at = ${new Date(now)}
      where id = ${accountId}
    `;
  }

  async listConnectionsForUser(userId: string): Promise<PublicDeviceSyncAccount[]> {
    const records = await this.prisma.deviceConnection.findMany({
      where: {
        userId,
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });

    return records.map((record) => mapHostedPublicAccountRecord(record));
  }

  async getConnectionForUser(userId: string, connectionId: string): Promise<PublicDeviceSyncAccount | null> {
    const record = await this.prisma.deviceConnection.findFirst({
      where: {
        id: connectionId,
        userId,
      },
    });

    return record ? mapHostedPublicAccountRecord(record) : null;
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

  async getConnectionBundleForUser(userId: string, connectionId: string): Promise<HostedConnectionSecretBundle | null> {
    const record = await this.prisma.deviceConnection.findFirst({
      where: {
        id: connectionId,
        userId,
      },
      ...hostedConnectionWithSecretArgs,
    });

    if (!record) {
      return null;
    }

    return requireHostedConnectionBundleRecord(record, this.codec);
  }

  async markConnectionDisconnected(input: {
    connectionId: string;
    userId: string;
    now: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    tx?: HostedPrismaTransactionClient;
  }): Promise<PublicDeviceSyncAccount> {
    const run = async (tx: HostedPrismaTransactionClient) => {
      const existing = await tx.deviceConnection.findFirst({
        where: {
          id: input.connectionId,
          userId: input.userId,
        },
      });

      if (!existing) {
        throw deviceSyncError({
          code: "CONNECTION_NOT_FOUND",
          message: "Hosted device-sync connection was not found for the current user.",
          retryable: false,
          httpStatus: 404,
        });
      }

      await tx.deviceConnectionSecret.deleteMany({
        where: {
          connectionId: input.connectionId,
        },
      });

      return tx.deviceConnection.update({
        where: {
          id: input.connectionId,
        },
        data: {
          status: "disconnected",
          accessTokenExpiresAt: null,
          nextReconcileAt: null,
          lastSyncErrorAt: null,
          lastErrorCode: input.errorCode ?? null,
          lastErrorMessage: input.errorMessage ?? null,
          updatedAt: new Date(input.now),
        },
      });
    };
    const updated = input.tx
      ? await run(input.tx)
      : await this.prisma.$transaction(run);

    return mapHostedPublicAccountRecord(updated);
  }

  async updateConnectionStatus(input: {
    connectionId: string;
    status: DeviceSyncAccountStatus;
    now: string;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): Promise<PublicDeviceSyncAccount> {
    const updated = await this.prisma.deviceConnection.update({
      where: {
        id: input.connectionId,
      },
      data: {
        status: input.status,
        lastSyncErrorAt: new Date(input.now),
        lastErrorCode: input.errorCode ?? null,
        lastErrorMessage: input.errorMessage ?? null,
      },
    });

    return mapHostedPublicAccountRecord(updated);
  }
}

export function mapHostedInternalAccountRecord(record: HostedPublicAccountPrismaRecord): PublicDeviceSyncAccount {
  return {
    id: record.id,
    provider: record.provider,
    externalAccountId: record.externalAccountId,
    displayName: record.displayName,
    status: record.status,
    scopes: Array.isArray(record.scopes) ? record.scopes.filter((scope: unknown) => typeof scope === "string") : [],
    accessTokenExpiresAt: maybeIsoTimestamp(record.accessTokenExpiresAt),
    metadata: toJsonRecord(record.metadataJson),
    connectedAt: record.connectedAt.toISOString(),
    lastWebhookAt: maybeIsoTimestamp(record.lastWebhookAt),
    lastSyncStartedAt: maybeIsoTimestamp(record.lastSyncStartedAt),
    lastSyncCompletedAt: maybeIsoTimestamp(record.lastSyncCompletedAt),
    lastSyncErrorAt: maybeIsoTimestamp(record.lastSyncErrorAt),
    lastErrorCode: record.lastErrorCode,
    lastErrorMessage: record.lastErrorMessage,
    nextReconcileAt: maybeIsoTimestamp(record.nextReconcileAt),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  } satisfies PublicDeviceSyncAccount;
}

export function mapHostedPublicAccountRecord(record: HostedPublicAccountPrismaRecord): PublicDeviceSyncAccount {
  return toRedactedPublicDeviceSyncAccount(mapHostedInternalAccountRecord(record));
}

export function requireHostedPublicAccountRecord(
  record: HostedPublicAccountPrismaRecord | null | undefined,
): PublicDeviceSyncAccount {
  if (!record) {
    throw new TypeError("Expected device connection record.");
  }

  return mapHostedPublicAccountRecord(record);
}

export function requireHostedConnectionBundleRecord(
  record: HostedConnectionWithSecretRecord | null | undefined,
  codec: HostedSecretCodec,
): HostedConnectionSecretBundle {
  if (!record?.secret) {
    throw deviceSyncError({
      code: "CONNECTION_SECRET_MISSING",
      message: "Hosted device-sync connection no longer has an escrowed token bundle.",
      retryable: false,
      httpStatus: 409,
    });
  }

  return {
    userId: record.userId,
    account: {
      ...mapHostedInternalAccountRecord(record),
      disconnectGeneration: 0,
      accessToken: codec.decrypt(record.secret.accessTokenEncrypted),
      refreshToken: record.secret.refreshTokenEncrypted ? codec.decrypt(record.secret.refreshTokenEncrypted) : null,
    },
    tokenVersion: record.secret.tokenVersion,
    keyVersion: record.secret.keyVersion,
  } satisfies HostedConnectionSecretBundle;
}
