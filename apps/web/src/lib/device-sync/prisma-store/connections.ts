import { PrismaClient } from "@prisma/client";
import {
  deviceSyncError,
  sanitizeStoredDeviceSyncMetadata,
  toRedactedPublicDeviceSyncAccount,
  type PublicDeviceSyncAccount,
  type UpsertPublicDeviceSyncConnectionInput,
} from "@murphai/device-syncd/public-ingress";

import { buildHostedProviderAccountBlindIndex, type HostedSecretCodec } from "../crypto";
import { buildHostedPublicDeviceSyncAccount } from "../internal-runtime";
import {
  maybeDate,
  normalizeNullableString,
  omitHostedSqlErrorText,
  generateHostedRandomPrefixedId,
} from "../shared";
import type { HostedLocalHeartbeatStateUpdate } from "../local-heartbeat";
import type { HostedPrismaTransactionClient } from "./types";
import {
  hostedConnectionRecordArgs,
  mapHostedConnectionRecord,
  normalizeStoredScopes,
  type HostedConnectionRecord,
  type HostedStoredDeviceSyncAccount,
} from "./connection-records";
import {
  encryptHostedConnectionSecret,
  readHostedStoredExternalAccountId,
  readHostedStoredTokenBundle,
  requireHostedSecretCodec,
} from "./connection-secrets";

export {
  hostedConnectionRecordArgs,
  mapHostedConnectionRecord,
} from "./connection-records";
export type {
  HostedConnectionRecord,
  HostedStoredDeviceSyncAccount,
} from "./connection-records";

export class PrismaHostedConnectionStore {
  readonly prisma: PrismaClient;
  private readonly codec: HostedSecretCodec | null;
  private readonly providerAccountBlindIndexKey: Buffer | null;

  constructor(input: {
    codec?: HostedSecretCodec;
    prisma: PrismaClient;
    providerAccountBlindIndexKey?: Buffer | null;
  }) {
    this.prisma = input.prisma;
    this.codec = input.codec ?? null;
    this.providerAccountBlindIndexKey = input.providerAccountBlindIndexKey ?? null;
  }

  async upsertConnection(input: UpsertPublicDeviceSyncConnectionInput): Promise<PublicDeviceSyncAccount> {
    const ownerId = normalizeNullableString(input.ownerId);
    const displayName = normalizeNullableString(input.displayName);
    const metadata = sanitizeStoredDeviceSyncMetadata(input.metadata ?? {});
    const scopes = normalizeStoredScopes(input.scopes);
    const connectedAt = new Date(input.connectedAt);
    const providerAccountBlindIndex = this.buildProviderAccountBlindIndex(input.provider, input.externalAccountId);
    const codec = requireHostedSecretCodec(this.codec);

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

        const tokenVersion = typeof existing.tokenVersion === "number" && existing.tokenVersion > 0
          ? existing.tokenVersion + 1
          : 1;

        return tx.deviceConnection.update({
          where: {
            id: existing.id,
          },
          data: {
            accessTokenEncrypted: encryptHostedConnectionSecret({
              codec,
              connectionId: existing.id,
              provider: input.provider,
              purpose: "device-sync-access-token",
              value: input.tokens.accessToken,
            }),
            accessTokenExpiresAt: maybeDate(input.tokens.accessTokenExpiresAt),
            connectedAt,
            displayName,
            externalAccountIdEncrypted: encryptHostedConnectionSecret({
              codec,
              connectionId: existing.id,
              provider: input.provider,
              purpose: "device-sync-external-account-id",
              value: input.externalAccountId,
            }),
            keyVersion: codec.keyVersion,
            metadataJson: metadata,
            nextReconcileAt: maybeDate(input.nextReconcileAt),
            refreshTokenEncrypted: input.tokens.refreshToken
              ? encryptHostedConnectionSecret({
                codec,
                connectionId: existing.id,
                provider: input.provider,
                purpose: "device-sync-refresh-token",
                value: input.tokens.refreshToken,
              })
              : null,
            scopesJson: scopes,
            status: input.status ?? "active",
            tokenVersion,
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

      const connectionId = generateHostedRandomPrefixedId("dsc");

      return tx.deviceConnection.create({
        data: {
          accessTokenEncrypted: encryptHostedConnectionSecret({
            codec,
            connectionId,
            provider: input.provider,
            purpose: "device-sync-access-token",
            value: input.tokens.accessToken,
          }),
          accessTokenExpiresAt: maybeDate(input.tokens.accessTokenExpiresAt),
          connectedAt,
          displayName,
          externalAccountIdEncrypted: encryptHostedConnectionSecret({
            codec,
            connectionId,
            provider: input.provider,
            purpose: "device-sync-external-account-id",
            value: input.externalAccountId,
          }),
          id: connectionId,
          keyVersion: codec.keyVersion,
          metadataJson: metadata,
          nextReconcileAt: maybeDate(input.nextReconcileAt),
          provider: input.provider,
          providerAccountBlindIndex,
          refreshTokenEncrypted: input.tokens.refreshToken
            ? encryptHostedConnectionSecret({
              codec,
              connectionId,
              provider: input.provider,
              purpose: "device-sync-refresh-token",
              value: input.tokens.refreshToken,
            })
            : null,
          scopesJson: scopes,
          status: input.status ?? "active",
          tokenVersion: 1,
          userId: ownerId,
        },
        ...hostedConnectionRecordArgs,
      });
    });

    return this.buildDurableConnectionRecord(record);
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

    return record ? this.buildDurableConnectionRecord(record, { externalAccountId }) : null;
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
        accessTokenExpiresAt: maybeDate(account.accessTokenExpiresAt),
        status: account.status,
        connectedAt: new Date(account.connectedAt),
        displayName: normalizeNullableString(account.displayName),
        lastWebhookAt: maybeDate(account.lastWebhookAt),
        lastSyncStartedAt: maybeDate(account.lastSyncStartedAt),
        lastSyncCompletedAt: maybeDate(account.lastSyncCompletedAt),
        lastSyncErrorAt: maybeDate(account.lastSyncErrorAt),
        lastErrorCode: normalizeNullableString(account.lastErrorCode),
        lastErrorMessage: omitHostedSqlErrorText(account.lastErrorMessage),
        metadataJson: sanitizeStoredDeviceSyncMetadata(account.metadata ?? {}),
        nextReconcileAt: maybeDate(account.nextReconcileAt),
        scopesJson: normalizeStoredScopes(account.scopes),
      },
    });
  }

  async syncDurableConnectionLocalHeartbeatState(
    account: Pick<PublicDeviceSyncAccount, "externalAccountId" | "id">,
    localState: HostedLocalHeartbeatStateUpdate,
    tx?: HostedPrismaTransactionClient,
  ): Promise<PublicDeviceSyncAccount> {
    const prisma = tx ?? this.prisma;
    const record = await prisma.deviceConnection.update({
      where: {
        id: account.id,
      },
      data: buildHostedLocalHeartbeatUpdateData(localState),
      ...hostedConnectionRecordArgs,
    });

    return this.buildDurableConnectionRecord(record, {
      externalAccountId: account.externalAccountId,
    });
  }

  async listConnectionsForUser(userId: string): Promise<PublicDeviceSyncAccount[]> {
    const records = await this.listConnectionRecordsForUser(userId);
    return records.map((record) => this.buildDurableConnectionRecord(record));
  }

  async getConnectionForUser(
    userId: string,
    connectionId: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<PublicDeviceSyncAccount | null> {
    const record = await this.getConnectionRecordForUser(userId, connectionId, tx);
    return record ? this.buildDurableConnectionRecord(record) : null;
  }

  async getStoredConnectionAccountForUser(
    userId: string,
    connectionId: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<HostedStoredDeviceSyncAccount | null> {
    const prisma = tx ?? this.prisma;
    const record = await prisma.deviceConnection.findFirst({
      where: {
        id: connectionId,
        userId,
      },
      ...hostedConnectionRecordArgs,
    });
    return record ? this.buildStoredConnectionAccount(record) : null;
  }

  async persistStoredConnectionTokenBundle(input: {
    clearExternalAccountId?: boolean;
    connectionId: string;
    externalAccountId?: string | null;
    provider: string;
    tokenBundle: {
      accessToken: string;
      accessTokenExpiresAt: string | null;
      keyVersion: string;
      refreshToken: string | null;
      tokenVersion: number;
    } | null;
    tx?: HostedPrismaTransactionClient;
  }): Promise<void> {
    const prisma = input.tx ?? this.prisma;
    const record = await prisma.deviceConnection.findUnique({
      where: {
        id: input.connectionId,
      },
      ...hostedConnectionRecordArgs,
    });

    if (!record) {
      return;
    }

    const codec = requireHostedSecretCodec(this.codec);
    const existingExternalAccountId = readHostedStoredExternalAccountId(record, this.codec);
    const requestedExternalAccountId = normalizeNullableString(input.externalAccountId);
    const externalAccountId = input.clearExternalAccountId === true
      ? null
      : requestedExternalAccountId ?? existingExternalAccountId;

    await prisma.deviceConnection.update({
      where: {
        id: input.connectionId,
      },
      data: {
        accessTokenEncrypted: input.tokenBundle
          ? encryptHostedConnectionSecret({
            codec,
            connectionId: input.connectionId,
            provider: input.provider,
            purpose: "device-sync-access-token",
            value: input.tokenBundle.accessToken,
          })
          : null,
        accessTokenExpiresAt: maybeDate(input.tokenBundle?.accessTokenExpiresAt ?? null),
        externalAccountIdEncrypted: externalAccountId
          ? encryptHostedConnectionSecret({
            codec,
            connectionId: input.connectionId,
            provider: input.provider,
            purpose: "device-sync-external-account-id",
            value: externalAccountId,
          })
          : null,
        keyVersion: input.tokenBundle?.keyVersion ?? null,
        refreshTokenEncrypted: input.tokenBundle?.refreshToken
          ? encryptHostedConnectionSecret({
            codec,
            connectionId: input.connectionId,
            provider: input.provider,
            purpose: "device-sync-refresh-token",
            value: input.tokenBundle.refreshToken,
          })
          : null,
        tokenVersion: input.tokenBundle?.tokenVersion ?? null,
      },
    });
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

  async getConnectionRecordForUser(
    userId: string,
    connectionId: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<HostedConnectionRecord | null> {
    const prisma = tx ?? this.prisma;

    return prisma.deviceConnection.findFirst({
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

  private buildDurableConnectionRecord(
    record: HostedConnectionRecord,
    fallback: {
      externalAccountId?: string | null;
    } = {},
  ): PublicDeviceSyncAccount {
    const mappedRecord = mapHostedConnectionRecord(record);
    mappedRecord.externalAccountId = readHostedStoredExternalAccountId(record, this.codec);

    return toRedactedPublicDeviceSyncAccount(
      buildHostedPublicDeviceSyncAccount({
        record: mappedRecord,
        fallback,
      }),
    );
  }

  private buildStoredConnectionAccount(record: HostedConnectionRecord): HostedStoredDeviceSyncAccount | null {
    const mappedRecord = mapHostedConnectionRecord(record);
    mappedRecord.externalAccountId = readHostedStoredExternalAccountId(record, this.codec);
    const publicConnection = buildHostedPublicDeviceSyncAccount({
      record: mappedRecord,
    });
    const tokenBundle = readHostedStoredTokenBundle(record, this.codec);

    if (!tokenBundle) {
      return null;
    }

    return {
      ...publicConnection,
      accessToken: tokenBundle.accessToken,
      disconnectGeneration: 0,
      keyVersion: tokenBundle.keyVersion,
      refreshToken: tokenBundle.refreshToken,
      tokenVersion: tokenBundle.tokenVersion,
    } satisfies HostedStoredDeviceSyncAccount;
  }
}

function buildHostedLocalHeartbeatUpdateData(
  localState: HostedLocalHeartbeatStateUpdate,
): {
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  lastSyncCompletedAt?: Date | null;
  lastSyncErrorAt?: Date | null;
  lastSyncStartedAt?: Date | null;
} {
  return {
    ...("lastSyncStartedAt" in localState
      ? { lastSyncStartedAt: maybeDate(localState.lastSyncStartedAt ?? null) }
      : {}),
    ...("lastSyncCompletedAt" in localState
      ? { lastSyncCompletedAt: maybeDate(localState.lastSyncCompletedAt ?? null) }
      : {}),
    ...("lastSyncErrorAt" in localState
      ? { lastSyncErrorAt: maybeDate(localState.lastSyncErrorAt ?? null) }
      : {}),
    ...("lastErrorCode" in localState
      ? { lastErrorCode: normalizeNullableString(localState.lastErrorCode ?? null) }
      : {}),
    ...("lastErrorMessage" in localState
      ? { lastErrorMessage: omitHostedSqlErrorText(localState.lastErrorMessage ?? null) }
      : {}),
  };
}
