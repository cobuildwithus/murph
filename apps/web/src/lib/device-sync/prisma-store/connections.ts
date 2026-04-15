import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import {
  type DeviceSyncAccount,
  deviceSyncError,
  sanitizeStoredDeviceSyncMetadata,
  toRedactedPublicDeviceSyncAccount,
  type PublicDeviceSyncAccount,
  type UpsertPublicDeviceSyncConnectionInput,
} from "@murphai/device-syncd/public-ingress";

import {
  buildHostedConnectionTokenCipherOptions,
  buildHostedProviderAccountBlindIndex,
  type HostedSecretCodec,
} from "../crypto";
import {
  buildHostedPublicDeviceSyncAccount,
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
    accessTokenEncrypted: true,
    accessTokenExpiresAt: true,
    connectedAt: true,
    createdAt: true,
    displayName: true,
    externalAccountIdEncrypted: true,
    id: true,
    keyVersion: true,
    lastErrorCode: true,
    lastErrorMessage: true,
    lastSyncCompletedAt: true,
    lastSyncErrorAt: true,
    lastSyncStartedAt: true,
    lastWebhookAt: true,
    metadataJson: true,
    nextReconcileAt: true,
    provider: true,
    providerAccountBlindIndex: true,
    refreshTokenEncrypted: true,
    scopesJson: true,
    status: true,
    tokenVersion: true,
    updatedAt: true,
    userId: true,
  },
} satisfies Prisma.DeviceConnectionDefaultArgs;

export type HostedConnectionRecord = Prisma.DeviceConnectionGetPayload<typeof hostedConnectionRecordArgs>;
export type HostedStoredDeviceSyncAccount = DeviceSyncAccount & {
  keyVersion: string;
  tokenVersion: number;
};

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
    const codec = this.requireCodec();

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
            accessTokenEncrypted: codec.encrypt(
              input.tokens.accessToken,
              buildHostedConnectionTokenCipherOptions({
                connectionId: existing.id,
                provider: input.provider,
                purpose: "device-sync-access-token",
              }),
            ),
            accessTokenExpiresAt: maybeDate(input.tokens.accessTokenExpiresAt),
            connectedAt,
            displayName,
            externalAccountIdEncrypted: codec.encrypt(
              input.externalAccountId,
              buildHostedConnectionTokenCipherOptions({
                connectionId: existing.id,
                provider: input.provider,
                purpose: "device-sync-external-account-id",
              }),
            ),
            keyVersion: codec.keyVersion,
            metadataJson: metadata,
            nextReconcileAt: maybeDate(input.nextReconcileAt),
            refreshTokenEncrypted: input.tokens.refreshToken
              ? codec.encrypt(
                input.tokens.refreshToken,
                buildHostedConnectionTokenCipherOptions({
                  connectionId: existing.id,
                  provider: input.provider,
                  purpose: "device-sync-refresh-token",
                }),
              )
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
          accessTokenEncrypted: codec.encrypt(
            input.tokens.accessToken,
            buildHostedConnectionTokenCipherOptions({
              connectionId,
              provider: input.provider,
              purpose: "device-sync-access-token",
            }),
          ),
          accessTokenExpiresAt: maybeDate(input.tokens.accessTokenExpiresAt),
          connectedAt,
          displayName,
          externalAccountIdEncrypted: codec.encrypt(
            input.externalAccountId,
            buildHostedConnectionTokenCipherOptions({
              connectionId,
              provider: input.provider,
              purpose: "device-sync-external-account-id",
            }),
          ),
          id: connectionId,
          keyVersion: codec.keyVersion,
          metadataJson: metadata,
          nextReconcileAt: maybeDate(input.nextReconcileAt),
          provider: input.provider,
          providerAccountBlindIndex,
          refreshTokenEncrypted: input.tokens.refreshToken
            ? codec.encrypt(
              input.tokens.refreshToken,
              buildHostedConnectionTokenCipherOptions({
                connectionId,
                provider: input.provider,
                purpose: "device-sync-refresh-token",
              }),
            )
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

    const controlClient = readHostedDeviceSyncRuntimeClientIfConfigured();

    if (!controlClient) {
      return;
    }

    try {
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
    } catch (error) {
      console.warn(`Hosted device-sync runtime projection write failed for webhook receipt ${accountId}.`, error);
    }
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
        lastErrorMessage: sanitizeHostedSqlErrorText(account.lastErrorMessage),
        metadataJson: sanitizeStoredDeviceSyncMetadata(account.metadata ?? {}),
        nextReconcileAt: maybeDate(account.nextReconcileAt),
        scopesJson: normalizeStoredScopes(account.scopes),
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

    const codec = this.requireCodec();
    const externalAccountId =
      input.externalAccountId === undefined
        ? this.readStoredExternalAccountId(record)
        : normalizeNullableString(input.externalAccountId);

    await prisma.deviceConnection.update({
      where: {
        id: input.connectionId,
      },
      data: {
        accessTokenEncrypted: input.tokenBundle
          ? codec.encrypt(
            input.tokenBundle.accessToken,
            buildHostedConnectionTokenCipherOptions({
              connectionId: input.connectionId,
              provider: input.provider,
              purpose: "device-sync-access-token",
            }),
          )
          : null,
        accessTokenExpiresAt: maybeDate(input.tokenBundle?.accessTokenExpiresAt ?? null),
        externalAccountIdEncrypted: externalAccountId
          ? codec.encrypt(
            externalAccountId,
            buildHostedConnectionTokenCipherOptions({
              connectionId: input.connectionId,
              provider: input.provider,
              purpose: "device-sync-external-account-id",
            }),
          )
          : null,
        keyVersion: input.tokenBundle?.keyVersion ?? null,
        refreshTokenEncrypted: input.tokenBundle?.refreshToken
          ? codec.encrypt(
            input.tokenBundle.refreshToken,
            buildHostedConnectionTokenCipherOptions({
              connectionId: input.connectionId,
              provider: input.provider,
              purpose: "device-sync-refresh-token",
            }),
          )
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

  private buildDurableConnectionRecord(
    record: HostedConnectionRecord,
    fallback: {
      externalAccountId?: string | null;
    } = {},
  ): PublicDeviceSyncAccount {
    const mappedRecord = mapHostedConnectionRecord(record);
    mappedRecord.externalAccountId = this.readStoredExternalAccountId(record);

    return toRedactedPublicDeviceSyncAccount(
      buildHostedPublicDeviceSyncAccount({
        record: mappedRecord,
        fallback,
      }),
    );
  }

  private buildStoredConnectionAccount(record: HostedConnectionRecord): HostedStoredDeviceSyncAccount | null {
    const mappedRecord = mapHostedConnectionRecord(record);
    mappedRecord.externalAccountId = this.readStoredExternalAccountId(record);
    const publicConnection = buildHostedPublicDeviceSyncAccount({
      record: mappedRecord,
    });
    const tokenBundle = this.readStoredTokenBundle(record);

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

  private readStoredTokenBundle(record: HostedConnectionRecord): {
    accessToken: string;
    accessTokenExpiresAt: string | null;
    keyVersion: string;
    refreshToken: string | null;
    tokenVersion: number;
  } | null {
    const codec = this.codec;
    const accessTokenEncrypted = normalizeNullableString(record.accessTokenEncrypted);
    const keyVersion = normalizeNullableString(record.keyVersion);
    const tokenVersion = typeof record.tokenVersion === "number" ? record.tokenVersion : null;

    if (!codec || !accessTokenEncrypted || !keyVersion || !tokenVersion) {
      return null;
    }

    return {
      accessToken: codec.decrypt(
        accessTokenEncrypted,
        buildHostedConnectionTokenCipherOptions({
          connectionId: record.id,
          provider: record.provider,
          purpose: "device-sync-access-token",
        }),
      ),
      accessTokenExpiresAt: maybeIsoTimestamp(record.accessTokenExpiresAt),
      keyVersion,
      refreshToken: normalizeNullableString(record.refreshTokenEncrypted)
        ? codec.decrypt(
          normalizeNullableString(record.refreshTokenEncrypted)!,
          buildHostedConnectionTokenCipherOptions({
            connectionId: record.id,
            provider: record.provider,
            purpose: "device-sync-refresh-token",
          }),
        )
        : null,
      tokenVersion,
    };
  }

  private readStoredExternalAccountId(record: HostedConnectionRecord): string | null {
    const codec = this.codec;
    const payload = normalizeNullableString(record.externalAccountIdEncrypted);

    if (!codec || !payload) {
      return null;
    }

    return codec.decrypt(
      payload,
      buildHostedConnectionTokenCipherOptions({
        connectionId: record.id,
        provider: record.provider,
        purpose: "device-sync-external-account-id",
      }),
    );
  }

  private requireCodec(): HostedSecretCodec {
    if (!this.codec) {
      throw new TypeError("Hosted device-sync secret codec is required.");
    }

    return this.codec;
  }
}

export function mapHostedConnectionRecord(record: HostedConnectionRecord): HostedStaticDeviceSyncConnectionRecord {
  return {
    accessTokenExpiresAt: maybeIsoTimestamp(record.accessTokenExpiresAt),
    connectedAt: record.connectedAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
    displayName: normalizeNullableString(record.displayName),
    externalAccountId: null,
    id: record.id,
    lastErrorCode: normalizeNullableString(record.lastErrorCode),
    lastErrorMessage: sanitizeHostedSqlErrorText(record.lastErrorMessage),
    lastSyncCompletedAt: maybeIsoTimestamp(record.lastSyncCompletedAt),
    lastSyncErrorAt: maybeIsoTimestamp(record.lastSyncErrorAt),
    lastSyncStartedAt: maybeIsoTimestamp(record.lastSyncStartedAt),
    lastWebhookAt: maybeIsoTimestamp(record.lastWebhookAt),
    metadata: readStoredMetadata(record.metadataJson),
    nextReconcileAt: maybeIsoTimestamp(record.nextReconcileAt),
    provider: record.provider,
    scopes: readStoredScopes(record.scopesJson),
    status: record.status as HostedStaticDeviceSyncConnectionRecord["status"],
    updatedAt: record.updatedAt.toISOString(),
    userId: record.userId,
  } satisfies HostedStaticDeviceSyncConnectionRecord;
}

function normalizeStoredScopes(value: readonly string[] | null | undefined): string[] {
  return (value ?? [])
    .map((entry) => normalizeNullableString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function readStoredScopes(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeNullableString(typeof entry === "string" ? entry : null))
    .filter((entry): entry is string => Boolean(entry));
}

function readStoredMetadata(value: Prisma.JsonValue | null): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return sanitizeStoredDeviceSyncMetadata(value as Record<string, unknown>);
}
