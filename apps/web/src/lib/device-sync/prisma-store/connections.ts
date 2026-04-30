import { PrismaClient, type Prisma } from "@prisma/client";
import {
  deviceSyncError,
  toRedactedPublicDeviceSyncAccount,
  type MarkPublicDeviceSyncConnectionSetupFailedInput,
  type ProviderAuthTokens,
  type PublicDeviceSyncAccount,
  type UpsertPublicDeviceSyncConnectionInput,
} from "@murphai/device-syncd/public-ingress";
import { resolveConfiguredDeviceSyncProviderManifest } from "@murphai/device-syncd/config";
import type {
  DeviceAccountCredential,
  DeviceAccountCredentialKind,
} from "@murphai/device-syncd/types";

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
  normalizeHostedDeviceSyncCredentialKind,
  normalizeHostedDeviceSyncLifecycleStatus,
  normalizeHostedDeviceSyncSetupPhase,
  normalizeStoredScopes,
  sanitizeHostedDeviceSyncConnectionMetadata,
  sanitizeHostedDeviceSyncCredentialMetadata,
  type HostedConnectionRecord,
  type HostedStoredDeviceSyncAccount,
} from "./connection-records";
import {
  encryptHostedConnectionSecret,
  readHostedStoredExternalAccountId,
  readHostedStoredTokenBundle,
  requireHostedSecretCodec,
} from "./connection-secrets";
import { toPrismaJsonObject } from "./prisma-json";

export {
  hostedConnectionRecordArgs,
  mapHostedConnectionRecord,
} from "./connection-records";
export type {
  HostedConnectionRecord,
  HostedStoredDeviceSyncAccount,
} from "./connection-records";

interface HostedConnectionCredentialWrite {
  accessTokenEncrypted: string | null;
  accessTokenExpiresAt: Date | null;
  credentialKind: DeviceAccountCredentialKind;
  credentialMetadataJson: Prisma.InputJsonObject;
  keyVersion: string | null;
  providerConfigKey: string | null;
  refreshTokenEncrypted: string | null;
  tokenVersion: number | null;
}

type HostedDeviceConnectionSetupPhase = NonNullable<
  ReturnType<typeof normalizeHostedDeviceSyncSetupPhase>
>;

type HostedUpsertConnectionInput = UpsertPublicDeviceSyncConnectionInput & {
  setupExpiresAt?: string | null;
  setupPhase?: HostedDeviceConnectionSetupPhase | null;
};

type HostedConnectionSetupWrite = {
  setupExpiresAt?: Date | null;
  setupPhase?: HostedDeviceConnectionSetupPhase | null;
};

const DEFAULT_HOSTED_DEVICE_SYNC_SETUP_TTL_MS = 30 * 60_000;

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
    const metadata = sanitizeHostedDeviceSyncConnectionMetadata(input.metadata ?? {});
    const scopes = normalizeStoredScopes(input.scopes);
    const connectedAt = new Date(input.connectedAt);
    const requestedStatus = input.status === undefined
      ? null
      : normalizeHostedDeviceSyncLifecycleStatus(input.status);
    const providerAccountBlindIndex = this.buildProviderAccountBlindIndex(input.provider, input.externalAccountId);
    const codec = requireHostedSecretCodec(this.codec);
    const credential = resolveHostedUpsertConnectionCredential(input);
    const setupWrite = buildHostedConnectionSetupWrite(input, connectedAt, "create");

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

        const credentialWrite = buildHostedConnectionCredentialWrite({
          codec,
          connectionId: existing.id,
          credential,
          provider: input.provider,
          tokenVersion: typeof existing.tokenVersion === "number" && existing.tokenVersion > 0
            ? existing.tokenVersion + 1
            : 1,
        });

        return tx.deviceConnection.update({
          where: {
            id: existing.id,
          },
          data: {
            ...credentialWrite,
            ...buildHostedConnectionSetupWrite(input, connectedAt, "update"),
            connectedAt,
            displayName,
            externalAccountIdEncrypted: encryptHostedConnectionSecret({
              codec,
              connectionId: existing.id,
              provider: input.provider,
              purpose: "device-sync-external-account-id",
              value: input.externalAccountId,
            }),
            metadataJson: toPrismaJsonObject(metadata),
            nextReconcileAt: maybeDate(input.nextReconcileAt),
            scopesJson: scopes,
            status: requestedStatus ?? existing.status,
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
      const credentialWrite = buildHostedConnectionCredentialWrite({
        codec,
        connectionId,
        credential,
        provider: input.provider,
        tokenVersion: 1,
      });

      return tx.deviceConnection.create({
        data: {
          ...credentialWrite,
          ...setupWrite,
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
          metadataJson: toPrismaJsonObject(metadata),
          nextReconcileAt: maybeDate(input.nextReconcileAt),
          provider: input.provider,
          providerAccountBlindIndex,
          scopesJson: scopes,
          status: requestedStatus ?? "active",
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

  async markConnectionSetupFailed(
    input: MarkPublicDeviceSyncConnectionSetupFailedInput,
  ): Promise<PublicDeviceSyncAccount | null> {
    const record = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.deviceConnection.findUnique({
        where: {
          id: input.accountId,
        },
        ...hostedConnectionRecordArgs,
      });

      if (!existing) {
        return null;
      }

      return tx.deviceConnection.update({
        where: {
          id: input.accountId,
        },
        data: {
          accessTokenEncrypted: null,
          accessTokenExpiresAt: null,
          keyVersion: null,
          lastErrorCode: normalizeNullableString(input.code) ?? "OAUTH_SETUP_FAILED",
          lastErrorMessage: omitHostedSqlErrorText(input.message),
          lastSyncErrorAt: new Date(input.now),
          nextReconcileAt: null,
          refreshTokenEncrypted: null,
          setupExpiresAt: null,
          setupPhase: "failed",
          status: "reauthorization_required",
          tokenVersion: null,
        },
        ...hostedConnectionRecordArgs,
      });
    });

    return record ? this.buildDurableConnectionRecord(record) : null;
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
        status: normalizeHostedDeviceSyncLifecycleStatus(account.status),
        connectedAt: new Date(account.connectedAt),
        displayName: normalizeNullableString(account.displayName),
        lastWebhookAt: maybeDate(account.lastWebhookAt),
        lastSyncStartedAt: maybeDate(account.lastSyncStartedAt),
        lastSyncCompletedAt: maybeDate(account.lastSyncCompletedAt),
        lastSyncErrorAt: maybeDate(account.lastSyncErrorAt),
        lastErrorCode: normalizeNullableString(account.lastErrorCode),
        lastErrorMessage: omitHostedSqlErrorText(account.lastErrorMessage),
        metadataJson: toPrismaJsonObject(sanitizeHostedDeviceSyncConnectionMetadata(account.metadata ?? {})),
        nextReconcileAt: maybeDate(account.nextReconcileAt),
        scopesJson: normalizeStoredScopes(account.scopes),
        setupExpiresAt: maybeDate(account.setupExpiresAt ?? null),
        setupPhase: normalizeHostedDeviceSyncSetupPhase(account.setupPhase ?? null),
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
    const existingCredentialKind = normalizeHostedDeviceSyncCredentialKind(record.credentialKind);
    const nextCredentialKind: DeviceAccountCredentialKind = input.tokenBundle
      ? "oauth_tokens"
      : existingCredentialKind;

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
        credentialKind: nextCredentialKind,
        ...(input.tokenBundle ? { credentialMetadataJson: toPrismaJsonObject({}) } : {}),
        providerConfigKey: input.tokenBundle ? null : record.providerConfigKey,
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
      credentialKind: "oauth_tokens",
      credentialMetadata: mappedRecord.credentialMetadata,
      disconnectGeneration: 0,
      keyVersion: tokenBundle.keyVersion,
      providerConfigKey: null,
      refreshToken: tokenBundle.refreshToken,
      tokenVersion: tokenBundle.tokenVersion,
    } satisfies HostedStoredDeviceSyncAccount;
  }
}

function resolveHostedUpsertConnectionCredential(
  input: UpsertPublicDeviceSyncConnectionInput,
): DeviceAccountCredential {
  if (input.credential) {
    return input.credential;
  }

  if (input.tokens) {
    return {
      kind: "oauth_tokens",
      tokens: input.tokens,
    };
  }

  throw deviceSyncError({
    code: "CONNECTION_CREDENTIAL_REQUIRED",
    message: "Hosted device-sync connection upserts require an explicit credential.",
    retryable: false,
    httpStatus: 400,
  });
}

function buildHostedConnectionSetupWrite(
  input: UpsertPublicDeviceSyncConnectionInput,
  connectedAt: Date,
  mode: "create" | "update",
): HostedConnectionSetupWrite {
  const setupInput = input as HostedUpsertConnectionInput;
  const hasSetupPhase = Object.prototype.hasOwnProperty.call(setupInput, "setupPhase");
  const hasSetupExpiresAt = Object.prototype.hasOwnProperty.call(setupInput, "setupExpiresAt");
  const nonLifecycleStatusRequested = input.status !== undefined
    && normalizeHostedDeviceSyncLifecycleStatus(input.status) !== input.status;

  if (!hasSetupPhase && !hasSetupExpiresAt && !nonLifecycleStatusRequested) {
    return mode === "create"
      ? {
          setupExpiresAt: null,
          setupPhase: null,
        }
      : {};
  }

  const setupPhase = hasSetupPhase
    ? requireHostedDeviceSyncSetupPhase(setupInput.setupPhase)
    : "pending_link";

  if (!setupPhase) {
    return {
      setupExpiresAt: null,
      setupPhase: null,
    };
  }

  return {
    setupExpiresAt: resolveHostedDeviceSyncSetupExpiresAt({
      connectedAt,
      phase: setupPhase,
      setupExpiresAt: hasSetupExpiresAt ? setupInput.setupExpiresAt : null,
    }),
    setupPhase,
  };
}

function requireHostedDeviceSyncSetupPhase(
  value: HostedUpsertConnectionInput["setupPhase"],
): HostedDeviceConnectionSetupPhase | null {
  const setupPhase = normalizeHostedDeviceSyncSetupPhase(value);

  if (setupPhase || value == null) {
    return setupPhase;
  }

  throw deviceSyncError({
    code: "CONNECTION_SETUP_PHASE_INVALID",
    message: "Hosted device-sync setup phase is invalid.",
    retryable: false,
    httpStatus: 400,
  });
}

function resolveHostedDeviceSyncSetupExpiresAt(input: {
  connectedAt: Date;
  phase: HostedDeviceConnectionSetupPhase;
  setupExpiresAt: string | null | undefined;
}): Date | null {
  const explicit = maybeDate(input.setupExpiresAt ?? null);

  if (explicit) {
    return explicit;
  }

  if (input.phase === "pending_link" || input.phase === "link_returned") {
    return new Date(input.connectedAt.getTime() + DEFAULT_HOSTED_DEVICE_SYNC_SETUP_TTL_MS);
  }

  return null;
}

function buildHostedConnectionCredentialWrite(input: {
  codec: HostedSecretCodec;
  connectionId: string;
  credential: DeviceAccountCredential;
  provider: string;
  tokenVersion: number;
}): HostedConnectionCredentialWrite {
  validateHostedDeviceSyncCredentialPolicy(input.provider, input.credential);

  switch (input.credential.kind) {
    case "oauth_tokens":
      return buildHostedOAuthCredentialWrite({
        codec: input.codec,
        connectionId: input.connectionId,
        provider: input.provider,
        tokenVersion: input.tokenVersion,
        tokens: input.credential.tokens,
      });
    case "provider_config": {
      const providerConfigKey = normalizeNullableString(input.credential.providerConfigKey);

      if (!providerConfigKey) {
        throw deviceSyncError({
          code: "CONNECTION_CREDENTIAL_INVALID",
          message: "Hosted provider-config device-sync credentials require providerConfigKey.",
          retryable: false,
          httpStatus: 400,
        });
      }

      return {
        accessTokenEncrypted: null,
        accessTokenExpiresAt: null,
        credentialKind: "provider_config",
        credentialMetadataJson: toPrismaJsonObject(buildHostedCredentialMetadata(input.credential)),
        keyVersion: null,
        providerConfigKey,
        refreshTokenEncrypted: null,
        tokenVersion: null,
      };
    }
    case "none":
      return {
        accessTokenEncrypted: null,
        accessTokenExpiresAt: null,
        credentialKind: "none",
        credentialMetadataJson: toPrismaJsonObject({}),
        keyVersion: null,
        providerConfigKey: null,
        refreshTokenEncrypted: null,
        tokenVersion: null,
      };
  }
}

function validateHostedDeviceSyncCredentialPolicy(
  provider: string,
  credential: DeviceAccountCredential,
): void {
  const manifest = resolveConfiguredDeviceSyncProviderManifest(provider);
  const policy = manifest?.credentialPolicy;

  if (policy) {
    if (credential.kind !== policy.kind) {
      throw deviceSyncError({
        code: "CONNECTION_CREDENTIAL_POLICY_MISMATCH",
        message: `Hosted device-sync provider ${provider} is configured for ${policy.kind} credentials.`,
        retryable: false,
        httpStatus: 400,
      });
    }

    if (
      credential.kind === "provider_config"
      && policy.kind === "provider_config"
      && credential.providerConfigKey.trim() !== policy.providerConfigKey
    ) {
      throw deviceSyncError({
        code: "PROVIDER_CONFIG_KEY_MISMATCH",
        message: "Hosted provider-config device-sync credential uses an unexpected provider profile.",
        retryable: false,
        httpStatus: 400,
      });
    }
    return;
  }

  if (credential.kind !== "provider_config") {
    return;
  }

  const providerConfigKey = normalizeNullableString(credential.providerConfigKey);
  const defaultProviderProfileKey = normalizeDefaultProviderProfileKey(provider);
  if (!providerConfigKey || providerConfigKey !== defaultProviderProfileKey) {
    throw deviceSyncError({
      code: "PROVIDER_CONFIG_KEY_MISMATCH",
      message: "Hosted provider-config device-sync credential uses an unexpected provider profile.",
      retryable: false,
      httpStatus: 400,
    });
  }
}

function normalizeDefaultProviderProfileKey(provider: string): string | null {
  const normalized = normalizeNullableString(provider)?.toLowerCase().replace(/[^a-z0-9_-]+/gu, "");
  return normalized && normalized.length > 0 ? normalized : null;
}

function buildHostedOAuthCredentialWrite(input: {
  codec: HostedSecretCodec;
  connectionId: string;
  provider: string;
  tokenVersion: number;
  tokens: ProviderAuthTokens;
}): HostedConnectionCredentialWrite {
  if (typeof input.tokens.accessToken !== "string" || input.tokens.accessToken.length === 0) {
    throw deviceSyncError({
      code: "CONNECTION_CREDENTIAL_INVALID",
      message: "Hosted OAuth device-sync credentials require an access token.",
      retryable: false,
      httpStatus: 400,
    });
  }

  return {
    accessTokenEncrypted: encryptHostedConnectionSecret({
      codec: input.codec,
      connectionId: input.connectionId,
      provider: input.provider,
      purpose: "device-sync-access-token",
      value: input.tokens.accessToken,
    }),
    accessTokenExpiresAt: maybeDate(input.tokens.accessTokenExpiresAt),
    credentialKind: "oauth_tokens",
    credentialMetadataJson: toPrismaJsonObject({}),
    keyVersion: input.codec.keyVersion,
    providerConfigKey: null,
    refreshTokenEncrypted: input.tokens.refreshToken
      ? encryptHostedConnectionSecret({
        codec: input.codec,
        connectionId: input.connectionId,
        provider: input.provider,
        purpose: "device-sync-refresh-token",
        value: input.tokens.refreshToken,
      })
      : null,
    tokenVersion: input.tokenVersion,
  };
}

function buildHostedCredentialMetadata(
  credential: Extract<DeviceAccountCredential, { kind: "provider_config" }>,
): Record<string, unknown> {
  const subjectMetadata: Record<string, unknown> = {};

  for (const [rawKey, rawValue] of Object.entries(credential.subject ?? {})) {
    if (Object.keys(subjectMetadata).length >= 16) {
      break;
    }

    const key = normalizeNullableString(rawKey);

    if (!key || key.length > 56 || typeof rawValue !== "string" || rawValue.length > 256) {
      continue;
    }

    subjectMetadata[`subject.${key}`] = rawValue;
  }

  return sanitizeHostedDeviceSyncCredentialMetadata(subjectMetadata);
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
