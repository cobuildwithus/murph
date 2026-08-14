import { Prisma, PrismaClient } from "@prisma/client";
import { deviceSyncError } from "@murphai/device-syncd/errors";
import {
  mergeGuardedJunctionHistoricalBackfillMetadata,
} from "@murphai/device-syncd/hosted-runtime";
import {
  isDeviceSyncDisconnectInProgress,
  shouldPreserveEstablishedDeviceSyncConnection,
  toRedactedPublicDeviceSyncAccount,
} from "@murphai/device-syncd/public-account";
import {
  type ClearPublicDeviceSyncOAuthCredentialInput,
  type DeviceSyncAccount,
  type GetPublicDeviceSyncOAuthCleanupAccountInput,
  type MarkPublicDeviceSyncConnectionSetupFailedInput,
  type MarkPublicDeviceSyncConnectionSetupFailedResult,
  type OAuthStateConsumeClaim,
  type ProviderAuthTokens,
  type PublicDeviceSyncAccount,
  type UpsertPublicDeviceSyncConnectionInput,
  type UpsertPublicDeviceSyncConnectionResult,
} from "@murphai/device-syncd/types";
import {
  resolveConfiguredDeviceSyncProviderCredentialPolicy,
} from "@murphai/device-syncd/provider-credential-policy";
import type {
  DeviceAccountCredential,
  DeviceAccountCredentialKind,
} from "@murphai/device-syncd/types";

import type { HostedSecureBoxPrismaClient } from "../../hosted-crypto/secure-box";
import {
  HOSTED_HEALTH_DATA_CONSENT_SCOPE,
  readHostedHealthDataConsentState,
} from "../../legal/consent";
import {
  lockHostedMemberRow,
  readHostedMemberSuspensionAfterLockTx,
} from "../../hosted-onboarding/shared";
import { buildHostedProviderAccountBlindIndex } from "../routing-index";
import {
  buildHostedPublicDeviceSyncAccount,
  type HostedStaticDeviceSyncConnectionRecord,
} from "../internal-runtime";
import {
  maybeDate,
  toIsoTimestamp,
  normalizeNullableString,
  sanitizeHostedConnectionLastErrorMessage,
  generateHostedRandomPrefixedId,
} from "../shared";
import type { HostedLocalHeartbeatStateUpdate } from "../local-heartbeat";
import {
  isMemberOwnedDeviceProviderApplicationProvider,
  type DeviceProviderApplicationBinding,
} from "../provider-applications/types";
import type {
  HostedDeviceSyncDueReconcileConnectionRecord,
  HostedConnectionRefreshLeaseClaimResult,
  HostedPrismaTransactionClient,
} from "./types";
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
import { isUniqueViolation } from "./prisma-errors";

export { sanitizeHostedDeviceSyncConnectionMetadata } from "./connection-records";
import {
  HOSTED_DEVICE_SYNC_SECURE_BOX_KEY_VERSION,
  encryptHostedConnectionSecret,
  prepareHostedRuntimeApplyTokenWrites,
  readHostedRuntimeConnectionSecretMaterial,
  readHostedStoredExternalAccountId,
  readHostedStoredTokenBundle,
  type HostedRuntimeConnectionSecretMaterial,
  type HostedDeviceSyncSecretTestCodec,
  type HostedRuntimeApplyPreparedTokenWrite,
  type HostedRuntimeApplyTokenWritePreparation,
} from "./connection-secrets";
import {
  isHostedDirtyPayloadClassificationPendingError,
  supersedeHostedCredentialScopedDirtyStateForConnectionTx,
} from "./dirty-connections";
import { toPrismaJsonObject } from "./prisma-json";

export {
  hostedConnectionRecordArgs,
  hostedRuntimeRedactedConnectionRecordArgs,
  mapHostedConnectionRecord,
  mapHostedRuntimeRedactedConnectionRecord,
} from "./connection-records";
export type {
  HostedConnectionRecord,
  HostedRuntimeConnectionRecord,
  HostedRuntimeRedactedConnectionRecord,
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
const HOSTED_CONNECTION_UPSERT_MAX_ATTEMPTS = 2;

async function requireExactOAuthClaimResolutionTx(
  tx: HostedPrismaTransactionClient,
  claim: OAuthStateConsumeClaim | undefined,
): Promise<void> {
  if (!claim) {
    return;
  }
  const resolved = await tx.deviceOauthSession.deleteMany({
    where: {
      consumedAt: new Date(claim.consumedAt),
      state: claim.state,
    },
  });
  if (resolved.count !== 1) {
    throw deviceSyncError({
      code: "OAUTH_STATE_CHANGED",
      message: "OAuth callback ownership changed before its durable outcome committed.",
      retryable: true,
      httpStatus: 409,
    });
  }
}

export interface HostedMemberDeviceConnectionStatus {
  id: string;
  status: HostedStaticDeviceSyncConnectionRecord["status"];
}

export class PrismaHostedConnectionStore {
  readonly prisma: PrismaClient;
  private readonly providerAccountBlindIndexKey: Buffer | null;
  private readonly testCodec: HostedDeviceSyncSecretTestCodec | null;

  constructor(input: {
    codec?: HostedDeviceSyncSecretTestCodec;
    prisma: PrismaClient;
    providerAccountBlindIndexKey?: Buffer | null;
  }) {
    this.prisma = input.prisma;
    this.providerAccountBlindIndexKey = input.providerAccountBlindIndexKey ?? null;
    this.testCodec = input.codec ?? null;
    if (this.testCodec && !process.env.VITEST) {
      throw new TypeError("Hosted device-sync test secret codec can only be injected under Vitest.");
    }
  }

  async upsertConnection(input: UpsertPublicDeviceSyncConnectionInput): Promise<PublicDeviceSyncAccount> {
    return (await this.upsertConnectionWithPrevious(input)).account;
  }

  async upsertConnectionWithPrevious(
    input: UpsertPublicDeviceSyncConnectionInput,
  ): Promise<UpsertPublicDeviceSyncConnectionResult> {
    return this.upsertConnectionWithOptionalProviderApplication(input, null);
  }

  async upsertConnectionWithProviderApplication(
    input: UpsertPublicDeviceSyncConnectionInput,
    binding: DeviceProviderApplicationBinding,
  ): Promise<UpsertPublicDeviceSyncConnectionResult> {
    return this.upsertConnectionWithOptionalProviderApplication(input, binding);
  }

  private async upsertConnectionWithOptionalProviderApplication(
    input: UpsertPublicDeviceSyncConnectionInput,
    binding: DeviceProviderApplicationBinding | null,
  ): Promise<UpsertPublicDeviceSyncConnectionResult> {
    for (
      let attempt = 0;
      attempt < HOSTED_CONNECTION_UPSERT_MAX_ATTEMPTS;
      attempt += 1
    ) {
      try {
        return await this.upsertConnectionWithPreviousOnce(input, binding);
      } catch (error) {
        if (
          isHostedDirtyPayloadClassificationPendingError(error)
          && attempt < HOSTED_CONNECTION_UPSERT_MAX_ATTEMPTS - 1
        ) {
          continue;
        }
        if (!isUniqueViolation(error)) {
          throw error;
        }

        await this.resolveUpsertConnectionUniqueRace(input, error);
        if (attempt < HOSTED_CONNECTION_UPSERT_MAX_ATTEMPTS - 1) {
          continue;
        }
        throw error;
      }
    }

    throw new Error("Hosted device-sync connection replacement retry loop exhausted.");
  }

  private async upsertConnectionWithPreviousOnce(
    input: UpsertPublicDeviceSyncConnectionInput,
    binding: DeviceProviderApplicationBinding | null,
  ): Promise<UpsertPublicDeviceSyncConnectionResult> {
    const ownerId = normalizeNullableString(input.ownerId);
    const displayName = normalizeNullableString(input.displayName);
    const replacementMetadata = sanitizeHostedDeviceSyncConnectionMetadata(input.metadata ?? {});
    const scopes = normalizeStoredScopes(input.scopes);
    const connectedAt = new Date(input.connectedAt);
    const requestedStatus = input.status === undefined
      ? null
      : normalizeHostedDeviceSyncLifecycleStatus(input.status);
    const providerAccountBlindIndex = this.buildProviderAccountBlindIndex(input.provider, input.externalAccountId);
    const credential = resolveHostedUpsertConnectionCredential(input);
    const setupWrite = buildHostedConnectionSetupWrite(input, connectedAt, "create");
    const ownsFailedOauthProviderCleanup =
      input.cleanupOwnership === "oauth_provider_revoke";
    if (
      ownsFailedOauthProviderCleanup
      && (
        input.status !== "reauthorization_required"
        || input.setupPhase !== "failed"
        || input.nextReconcileAt !== null
      )
    ) {
      throw deviceSyncError({
        code: "CONNECTION_CLEANUP_OWNER_INVALID",
        message: "Provider cleanup ownership must be stored as failed reauthorization state.",
        retryable: false,
        httpStatus: 400,
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

    const result = await this.prisma.$transaction(async (tx) => {
      await lockHostedMemberRow(tx, ownerId);
      const ownerStatus = await readHostedMemberSuspensionAfterLockTx(
        tx,
        ownerId,
      );
      if (ownerStatus === "missing") {
        throw deviceSyncError({
          code: "CONNECTION_OWNER_REQUIRED",
          message: "Hosted device-sync connection owner no longer exists.",
          retryable: false,
          httpStatus: 404,
        });
      }
      if (ownerStatus === "suspended" && !ownsFailedOauthProviderCleanup) {
        throw deviceSyncError({
          code: "CONNECTION_OWNER_SUSPENDED",
          message: "Device connections cannot be completed while account deletion is active.",
          retryable: false,
          httpStatus: 409,
        });
      }
      if (!ownsFailedOauthProviderCleanup && await readHostedHealthDataConsentState({
        memberId: ownerId,
        prisma: tx,
      }) === "revoked") {
        throw deviceSyncError({
          code: "HEALTH_DATA_CONSENT_REQUIRED",
          httpStatus: 403,
          message: "Use Murph again before connecting a health source.",
          retryable: false,
        });
      }

      let existing = await tx.deviceConnection.findUnique({
        where: {
          provider_providerAccountBlindIndex: {
            provider: input.provider,
            providerAccountBlindIndex,
          },
        },
        ...hostedConnectionRecordArgs,
      });

      if (existing) {
        await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${existing.id}))`;
        existing = await tx.deviceConnection.findUnique({
          where: {
            provider_providerAccountBlindIndex: {
              provider: input.provider,
              providerAccountBlindIndex,
            },
          },
          ...hostedConnectionRecordArgs,
        });
      }

      if (existing) {
        assertHostedUpsertExistingConnectionGuard(existing, input.existingAccountGuard ?? null);

        if (ownerId && existing.userId !== ownerId) {
          throw deviceSyncError({
            code: "CONNECTION_OWNERSHIP_CONFLICT",
            message: "This provider account is already connected to a different Murph user.",
            retryable: false,
            httpStatus: 409,
          });
        }

        await assertHostedProviderApplicationBindingForUpsert({
          binding,
          existing,
          ownerId,
          provider: input.provider,
          tx,
        });

        if (isDeviceSyncDisconnectInProgress(existing) && !ownsFailedOauthProviderCleanup) {
          throw deviceSyncError({
            code: "CONNECTION_DISCONNECT_IN_PROGRESS",
            message: "Device sync disconnect is still in progress. Retry later.",
            retryable: true,
            httpStatus: 409,
          });
        }

        if (
          shouldPreserveEstablishedDeviceSyncConnection(
            existing,
            input.existingAccountPolicy,
          )
          && ownerId
          && existing.userId === ownerId
        ) {
          await requireExactOAuthClaimResolutionTx(tx, input.oauthClaim);
          return {
            record: existing,
            previousRecord: existing,
          };
        }

        assertNoActiveHostedConnectionRefreshLease(existing, connectedAt);

        const metadata = input.provider === "junction" && input.existingAccountGuard
          ? sanitizeHostedDeviceSyncConnectionMetadata(
              mergeGuardedJunctionHistoricalBackfillMetadata({
                existingMetadata: mapHostedConnectionRecord(existing).metadata,
                replacementMetadata,
              }),
            )
          : replacementMetadata;

        const credentialWrite = await buildHostedConnectionCredentialWrite({
          connectionId: existing.id,
          credential,
          prisma: tx,
          provider: input.provider,
          testCodec: this.testCodec,
          tokenVersion: typeof existing.tokenVersion === "number" && existing.tokenVersion > 0
            ? existing.tokenVersion + 1
            : 1,
          userId: existing.userId,
        });

        const updated = await tx.deviceConnection.update({
          where: {
            id: existing.id,
          },
          data: {
            ...credentialWrite,
            ...buildHostedConnectionSetupWrite(input, connectedAt, "update"),
            connectedAt,
            displayName,
            providerApplicationId: binding?.applicationId ?? null,
            providerApplicationRevision: binding?.revision ?? null,
            externalAccountIdEncrypted: await encryptHostedConnectionSecret({
              connectionId: existing.id,
              provider: input.provider,
              prisma: tx,
              purpose: "device-sync-external-account-id",
              testCodec: this.testCodec,
              userId: existing.userId,
              value: input.externalAccountId,
            }),
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncErrorAt: null,
            metadataJson: toPrismaJsonObject(metadata),
            nextReconcileAt: maybeDate(input.nextReconcileAt),
            refreshLeaseExpiresAt: null,
            refreshLeaseOwner: null,
            refreshLeaseTokenVersion: null,
            scopesJson: scopes,
            status: requestedStatus ?? "active",
          },
          ...hostedConnectionRecordArgs,
        });
        if (existing.connectedAt.getTime() !== connectedAt.getTime()) {
          await supersedeHostedCredentialScopedDirtyStateForConnectionTx({
            connectionId: existing.id,
            tx,
            userId: existing.userId,
          });
        }
        await requireExactOAuthClaimResolutionTx(tx, input.oauthClaim);
        return {
          record: updated,
          previousRecord: existing,
        };
      }

      assertHostedUpsertExistingConnectionGuard(null, input.existingAccountGuard ?? null);

      await assertHostedProviderApplicationBindingForUpsert({
        binding,
        existing: null,
        ownerId,
        provider: input.provider,
        tx,
      });

      const connectionId = generateHostedRandomPrefixedId("dsc");
      const credentialWrite = await buildHostedConnectionCredentialWrite({
        connectionId,
        credential,
        prisma: tx,
        provider: input.provider,
        testCodec: this.testCodec,
        tokenVersion: 1,
        userId: ownerId,
      });

      const created = await tx.deviceConnection.create({
        data: {
          ...credentialWrite,
          ...setupWrite,
          connectedAt,
          displayName,
          externalAccountIdEncrypted: await encryptHostedConnectionSecret({
            connectionId,
            provider: input.provider,
            prisma: tx,
            purpose: "device-sync-external-account-id",
            testCodec: this.testCodec,
            userId: ownerId,
            value: input.externalAccountId,
          }),
          id: connectionId,
          metadataJson: toPrismaJsonObject(replacementMetadata),
          nextReconcileAt: maybeDate(input.nextReconcileAt),
          provider: input.provider,
          providerAccountBlindIndex,
          providerApplicationId: binding?.applicationId ?? null,
          providerApplicationRevision: binding?.revision ?? null,
          scopesJson: scopes,
          status: requestedStatus ?? "active",
          userId: ownerId,
        },
        ...hostedConnectionRecordArgs,
      });
      await requireExactOAuthClaimResolutionTx(tx, input.oauthClaim);
      return {
        record: created,
        previousRecord: null,
      };
    });

    return {
      account: await this.buildDurableConnectionRecord(result.record),
      previousAccount: result.previousRecord
        ? await this.buildDurableConnectionRecord(result.previousRecord, {
            externalAccountId: input.externalAccountId,
          })
        : null,
    };
  }

  private async resolveUpsertConnectionUniqueRace(
    input: UpsertPublicDeviceSyncConnectionInput,
    originalError: unknown,
  ): Promise<void> {
    const ownerId = normalizeNullableString(input.ownerId);
    if (!ownerId) {
      throw originalError;
    }

    const existing = await this.getConnectionByExternalAccount(input.provider, input.externalAccountId);
    if (!existing) {
      throw originalError;
    }

    const existingOwnerId = await this.getConnectionOwnerId(existing.id);
    if (existingOwnerId !== ownerId) {
      throw deviceSyncError({
        code: "CONNECTION_OWNERSHIP_CONFLICT",
        message: "This provider account is already connected to a different Murph user.",
        retryable: false,
        httpStatus: 409,
      });
    }

    // The caller retries through the transaction after ownership has been
    // established. That path re-reads and locks the full record, then enforces
    // the exact provider-application binding before any established connection
    // can be reused. Returning the redacted account here would bypass those
    // checks during a uniqueness race.
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

    return record ? await this.buildDurableConnectionRecord(record, { externalAccountId }) : null;
  }

  async getConnectionById(connectionId: string): Promise<PublicDeviceSyncAccount | null> {
    const record = await this.prisma.deviceConnection.findUnique({
      where: {
        id: connectionId,
      },
      ...hostedConnectionRecordArgs,
    });

    return record ? await this.buildDurableConnectionRecord(record) : null;
  }

  async markWebhookReceived(
    accountId: string,
    now: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<void> {
    const lastWebhookAt = new Date(now);
    await (tx ?? this.prisma).deviceConnection.updateMany({
      where: {
        id: accountId,
        OR: [
          { lastWebhookAt: null },
          { lastWebhookAt: { lt: lastWebhookAt } },
        ],
      },
      data: {
        lastWebhookAt,
      },
    });
  }

  async markConnectionSetupFailed(
    input: MarkPublicDeviceSyncConnectionSetupFailedInput,
  ): Promise<MarkPublicDeviceSyncConnectionSetupFailedResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${input.accountId}))`;
      const existing = await tx.deviceConnection.findUnique({
        where: {
          id: input.accountId,
        },
        ...hostedConnectionRecordArgs,
      });

      if (!existing) {
        return {
          applied: false,
          blockedByRefreshLease: false,
          oauthTokenVersion: null,
          record: null,
        };
      }
      if (
        input.expectedConnectedAt === null
        || existing.connectedAt.toISOString() !== input.expectedConnectedAt
        || existing.status === "disconnected"
      ) {
        return {
          applied: false,
          blockedByRefreshLease: false,
          oauthTokenVersion: existing.credentialKind === "oauth_tokens"
            ? existing.tokenVersion
            : null,
          record: existing,
        };
      }
      if (
        existing.refreshLeaseOwner !== null
        || existing.refreshLeaseExpiresAt !== null
        || existing.refreshLeaseTokenVersion !== null
      ) {
        return {
          applied: false,
          blockedByRefreshLease: true,
          oauthTokenVersion: existing.credentialKind === "oauth_tokens"
            ? existing.tokenVersion
            : null,
          record: existing,
        };
      }

      const record = await tx.deviceConnection.update({
        where: {
          id: input.accountId,
        },
        data: {
          lastErrorCode: normalizeNullableString(input.code) ?? "OAUTH_SETUP_FAILED",
          lastErrorMessage: sanitizeHostedConnectionLastErrorMessage(input.message),
          lastSyncErrorAt: new Date(input.now),
          nextReconcileAt: null,
          setupExpiresAt: null,
          setupPhase: "failed",
          status: "reauthorization_required",
        },
        ...hostedConnectionRecordArgs,
      });
      await requireExactOAuthClaimResolutionTx(tx, input.oauthClaim);
      return {
        applied: true,
        blockedByRefreshLease: false,
        oauthTokenVersion: record.credentialKind === "oauth_tokens"
          ? record.tokenVersion
          : null,
        record,
      };
    });

    return {
      account: result.record ? await this.buildDurableConnectionRecord(result.record) : null,
      applied: result.applied,
      blockedByRefreshLease: result.blockedByRefreshLease,
      oauthTokenVersion: result.oauthTokenVersion,
    };
  }

  async getOAuthCleanupAccount(
    input: GetPublicDeviceSyncOAuthCleanupAccountInput,
  ): Promise<DeviceSyncAccount | null> {
    const record = await this.prisma.deviceConnection.findFirst({
      where: {
        id: input.accountId,
        connectedAt: new Date(input.expectedConnectedAt),
        credentialKind: "oauth_tokens",
        refreshLeaseExpiresAt: null,
        refreshLeaseOwner: null,
        refreshLeaseTokenVersion: null,
        setupPhase: "failed",
        status: "reauthorization_required",
        tokenVersion: input.expectedTokenVersion,
      },
      ...hostedConnectionRecordArgs,
    });
    return record ? await this.buildStoredConnectionAccount(record) : null;
  }

  async clearOAuthCredentialAfterConfirmedRevoke(
    input: ClearPublicDeviceSyncOAuthCredentialInput,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${input.accountId}))`;
      const existing = await tx.deviceConnection.findUnique({
        where: {
          id: input.accountId,
        },
        ...hostedConnectionRecordArgs,
      });

      if (
        !existing
        || existing.connectedAt.toISOString() !== input.expectedConnectedAt
        || existing.status !== "reauthorization_required"
        || existing.setupPhase !== "failed"
        || normalizeHostedDeviceSyncCredentialKind(existing.credentialKind) !== "oauth_tokens"
        || existing.tokenVersion !== input.expectedTokenVersion
        || existing.refreshLeaseOwner !== null
        || existing.refreshLeaseExpiresAt !== null
        || existing.refreshLeaseTokenVersion !== null
      ) {
        return false;
      }

      await tx.deviceConnection.update({
        where: {
          id: input.accountId,
        },
        data: {
          accessTokenEncrypted: null,
          accessTokenExpiresAt: null,
          credentialKind: "none",
          credentialMetadataJson: toPrismaJsonObject({}),
          keyVersion: null,
          providerConfigKey: null,
          refreshLeaseExpiresAt: null,
          refreshLeaseOwner: null,
          refreshLeaseTokenVersion: null,
          refreshTokenEncrypted: null,
          tokenVersion: null,
          updatedAt: new Date(input.now),
        },
      });
      return true;
    });
  }

  async syncDurableConnectionState(
    account: PublicDeviceSyncAccount,
    tx?: HostedPrismaTransactionClient,
  ): Promise<HostedConnectionRecord> {
    const prisma = tx ?? this.prisma;

    return prisma.deviceConnection.update({
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
        lastErrorMessage: sanitizeHostedConnectionLastErrorMessage(account.lastErrorMessage),
        metadataJson: toPrismaJsonObject(sanitizeHostedDeviceSyncConnectionMetadata(account.metadata ?? {})),
        nextReconcileAt: maybeDate(account.nextReconcileAt),
        scopesJson: normalizeStoredScopes(account.scopes),
        setupExpiresAt: maybeDate(account.setupExpiresAt ?? null),
        setupPhase: normalizeHostedDeviceSyncSetupPhase(account.setupPhase ?? null),
      },
      ...hostedConnectionRecordArgs,
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

    return await this.buildDurableConnectionRecord(
      record,
      {
        externalAccountId: account.externalAccountId,
      },
      prisma,
    );
  }

  async listConnectionsForUser(userId: string): Promise<PublicDeviceSyncAccount[]> {
    const records = await this.listConnectionRecordsForUser(userId);
    return Promise.all(records.map((record) => this.buildDurableConnectionRecord(record)));
  }

  async listConnectionsRequiringCleanupForUser(
    userId: string,
  ): Promise<PublicDeviceSyncAccount[]> {
    const records = (await this.listConnectionRecordsForUser(userId))
      .filter((record) =>
        record.status !== "disconnected" || record.credentialKind !== "none"
      );
    return Promise.all(records.map((record) => this.buildDurableConnectionRecord(record)));
  }

  async listMemberConnectionStatuses(input: {
    limit: number;
    provider: string;
    status: "active" | "not_disconnected";
    userId: string;
  }): Promise<HostedMemberDeviceConnectionStatus[]> {
    const provider = normalizeNullableString(input.provider);
    const userId = normalizeNullableString(input.userId);
    if (!provider || !userId) {
      throw new TypeError("Hosted device-sync member connection status query requires member and provider ids.");
    }
    if (!Number.isSafeInteger(input.limit) || input.limit < 1) {
      throw new TypeError("Hosted device-sync member connection status query requires a positive safe limit.");
    }

    const records = await this.prisma.deviceConnection.findMany({
      where: {
        provider,
        status: input.status === "active"
          ? "active"
          : { not: "disconnected" },
        userId,
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      select: {
        id: true,
        status: true,
      },
    });

    if (records.length > input.limit) {
      throw deviceSyncError({
        code: "MEMBER_CONNECTION_STATUS_SNAPSHOT_SATURATED",
        httpStatus: 503,
        message: `Hosted device-sync member connection status authority exceeds the ${input.limit}-connection bound.`,
        retryable: false,
      });
    }

    return records.map((record) => ({
      id: record.id,
      status: normalizeHostedDeviceSyncLifecycleStatus(record.status),
    }));
  }

  async getConnectionForUser(
    userId: string,
    connectionId: string,
    tx?: HostedPrismaTransactionClient,
  ): Promise<PublicDeviceSyncAccount | null> {
    const record = await this.getConnectionRecordForUser(userId, connectionId, tx);
    return record
      ? await this.buildDurableConnectionRecord(record, {}, tx ?? this.prisma)
      : null;
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
    return record ? await this.buildStoredConnectionAccount(record, prisma) : null;
  }

  async materializeDurableConnectionRecord(
    record: HostedConnectionRecord,
    prisma: HostedSecureBoxPrismaClient = this.prisma,
  ): Promise<PublicDeviceSyncAccount> {
    return this.buildDurableConnectionRecord(record, {}, prisma);
  }

  async materializeStoredConnectionAccount(
    record: HostedConnectionRecord,
    prisma: HostedSecureBoxPrismaClient = this.prisma,
  ): Promise<HostedStoredDeviceSyncAccount | null> {
    return this.buildStoredConnectionAccount(record, prisma);
  }

  async prepareRuntimeApplyTokenWrites(
    entries: readonly HostedRuntimeApplyTokenWritePreparation[],
  ): Promise<Map<string, HostedRuntimeApplyPreparedTokenWrite>> {
    return prepareHostedRuntimeApplyTokenWrites({
      entries,
      prisma: this.prisma,
      testCodec: this.testCodec,
    });
  }

  async readRuntimeConnectionSecretMaterial(input: {
    records: readonly HostedConnectionRecord[];
    tokenConnectionIds: ReadonlySet<string>;
  }, prisma: HostedSecureBoxPrismaClient = this.prisma): Promise<
    Map<string, HostedRuntimeConnectionSecretMaterial>
  > {
    return readHostedRuntimeConnectionSecretMaterial({
      prisma,
      records: input.records,
      testCodec: this.testCodec,
      tokenConnectionIds: input.tokenConnectionIds,
    });
  }

  async claimConnectionRefreshLease(input: {
    connectionId: string;
    userId: string;
    tokenVersion: number;
    leaseOwner: string;
    leaseExpiresAt: string;
    now: string;
    tx?: HostedPrismaTransactionClient;
  }): Promise<HostedConnectionRefreshLeaseClaimResult> {
    const prisma = input.tx ?? this.prisma;
    const claim = await prisma.deviceConnection.updateMany({
      where: {
        id: input.connectionId,
        userId: input.userId,
        tokenVersion: input.tokenVersion,
        status: "active",
        refreshLeaseExpiresAt: null,
        refreshLeaseOwner: null,
        refreshLeaseTokenVersion: null,
      },
      data: {
        refreshLeaseExpiresAt: new Date(input.leaseExpiresAt),
        refreshLeaseOwner: input.leaseOwner,
        refreshLeaseTokenVersion: input.tokenVersion,
      },
    });

    if (claim.count > 0) {
      return { status: "claimed" };
    }

    const record = await prisma.deviceConnection.findFirst({
      where: {
        id: input.connectionId,
        userId: input.userId,
      },
      select: {
        id: true,
        refreshLeaseExpiresAt: true,
        refreshLeaseOwner: true,
        refreshLeaseTokenVersion: true,
        tokenVersion: true,
      },
    });

    if (!record || record.tokenVersion !== input.tokenVersion) {
      return { status: "version_changed" };
    }

    if (record.refreshLeaseOwner && record.refreshLeaseExpiresAt) {
      if (record.refreshLeaseExpiresAt.getTime() > Date.parse(input.now)) {
        return {
          status: "in_progress",
          leaseExpiresAt: record.refreshLeaseExpiresAt.toISOString(),
        };
      }

      return { status: "stale" };
    }

    return { status: "stale" };
  }

  async clearConnectionRefreshLease(input: {
    connectionId: string;
    leaseOwner: string;
    tx?: HostedPrismaTransactionClient;
  }): Promise<boolean> {
    const prisma = input.tx ?? this.prisma;
    const result = await prisma.deviceConnection.updateMany({
      where: {
        id: input.connectionId,
        refreshLeaseOwner: input.leaseOwner,
      },
      data: {
        refreshLeaseExpiresAt: null,
        refreshLeaseOwner: null,
        refreshLeaseTokenVersion: null,
      },
    });

    return result.count > 0;
  }

  async clearStaleConnectionRefreshLease(input: {
    connectionId: string;
    tx?: HostedPrismaTransactionClient;
    userId: string;
  }): Promise<boolean> {
    const prisma = input.tx ?? this.prisma;
    const result = await prisma.deviceConnection.updateMany({
      where: {
        id: input.connectionId,
        userId: input.userId,
        OR: [
          { refreshLeaseExpiresAt: { not: null } },
          { refreshLeaseOwner: { not: null } },
          { refreshLeaseTokenVersion: { not: null } },
        ],
      },
      data: {
        refreshLeaseExpiresAt: null,
        refreshLeaseOwner: null,
        refreshLeaseTokenVersion: null,
      },
    });

    return result.count > 0;
  }

  async persistPreparedRuntimeApplyTokenWrite(input: {
    prepared: HostedRuntimeApplyPreparedTokenWrite;
    record: HostedConnectionRecord;
    tx: HostedPrismaTransactionClient;
  }): Promise<HostedConnectionRecord> {
    const refreshLeaseOwner = normalizeNullableString(input.record.refreshLeaseOwner);
    const obsoleteRefreshLease = Boolean(
      refreshLeaseOwner
      && input.record.refreshLeaseTokenVersion !== null
      && input.record.refreshLeaseTokenVersion !== input.record.tokenVersion,
    );

    if (refreshLeaseOwner && !obsoleteRefreshLease) {
      throw deviceSyncError({
        code: "TOKEN_REFRESH_IN_PROGRESS",
        message: "A hosted device-sync token refresh is already in progress for this connection.",
        retryable: true,
        httpStatus: 409,
      });
    }

    const hasTokenBundle = input.prepared.tokenVersion !== null;
    if (hasTokenBundle && !input.prepared.accessTokenEncrypted) {
      throw new TypeError("Hosted device-sync runtime apply token preparation is missing its access token.");
    }

    return input.tx.deviceConnection.update({
      where: {
        id: input.record.id,
      },
      data: {
        accessTokenEncrypted: input.prepared.accessTokenEncrypted,
        accessTokenExpiresAt: maybeDate(input.prepared.accessTokenExpiresAt),
        credentialKind: hasTokenBundle
          ? "oauth_tokens"
          : normalizeHostedDeviceSyncCredentialKind(input.record.credentialKind),
        ...(hasTokenBundle ? { credentialMetadataJson: toPrismaJsonObject({}) } : {}),
        externalAccountIdEncrypted: input.prepared.externalAccountIdEncrypted,
        keyVersion: input.prepared.keyVersion,
        providerConfigKey: hasTokenBundle ? null : input.record.providerConfigKey,
        ...(obsoleteRefreshLease
          ? {
              refreshLeaseExpiresAt: null,
              refreshLeaseOwner: null,
              refreshLeaseTokenVersion: null,
            }
          : {}),
        refreshTokenEncrypted: input.prepared.refreshTokenEncrypted,
        tokenVersion: input.prepared.tokenVersion,
      },
      ...hostedConnectionRecordArgs,
    });
  }

  async persistStoredConnectionTokenBundle(input: {
    clearCredential?: boolean;
    clearExternalAccountId?: boolean;
    connectionId: string;
    externalAccountId?: string | null;
    provider: string;
    clearRefreshLease?: boolean;
    refreshLeaseOwner?: string | null;
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

    const refreshLeaseOwner = normalizeNullableString(record.refreshLeaseOwner);
    const inputRefreshLeaseOwner = normalizeNullableString(input.refreshLeaseOwner);
    const ownsRefreshLease = Boolean(
      refreshLeaseOwner
      && inputRefreshLeaseOwner
      && refreshLeaseOwner === inputRefreshLeaseOwner,
    );
    const obsoleteRefreshLease = Boolean(
      refreshLeaseOwner
      && record.refreshLeaseTokenVersion !== null
      && record.refreshLeaseTokenVersion !== record.tokenVersion,
    );

    if (
      refreshLeaseOwner
      && !ownsRefreshLease
      && !obsoleteRefreshLease
      && input.clearRefreshLease !== true
    ) {
      throw deviceSyncError({
        code: "TOKEN_REFRESH_IN_PROGRESS",
        message: "A hosted device-sync token refresh is already in progress for this connection.",
        retryable: true,
        httpStatus: 409,
      });
    }

    const existingExternalAccountId = await readHostedStoredExternalAccountId(record, this.testCodec, prisma);
    const requestedExternalAccountId = normalizeNullableString(input.externalAccountId);
    const externalAccountId = input.clearExternalAccountId === true
      ? null
      : requestedExternalAccountId ?? existingExternalAccountId;
    const existingCredentialKind = normalizeHostedDeviceSyncCredentialKind(record.credentialKind);
    const nextCredentialKind: DeviceAccountCredentialKind = input.tokenBundle
      ? "oauth_tokens"
      : input.clearCredential === true ? "none" : existingCredentialKind;
    const accessTokenEncrypted = input.tokenBundle
      ? await encryptHostedConnectionSecret({
        connectionId: input.connectionId,
        provider: input.provider,
        prisma,
        purpose: "device-sync-access-token",
        testCodec: this.testCodec,
        tokenVersion: input.tokenBundle.tokenVersion,
        userId: record.userId,
        value: input.tokenBundle.accessToken,
      })
      : null;
    const refreshTokenEncrypted = input.tokenBundle?.refreshToken
      ? await encryptHostedConnectionSecret({
        connectionId: input.connectionId,
        provider: input.provider,
        prisma,
        purpose: "device-sync-refresh-token",
        testCodec: this.testCodec,
        tokenVersion: input.tokenBundle.tokenVersion,
        userId: record.userId,
        value: input.tokenBundle.refreshToken,
      })
      : null;
    const externalAccountIdEncrypted = externalAccountId
      ? await encryptHostedConnectionSecret({
        connectionId: input.connectionId,
        provider: input.provider,
        prisma,
        purpose: "device-sync-external-account-id",
        testCodec: this.testCodec,
        userId: record.userId,
        value: externalAccountId,
      })
      : null;

    await prisma.deviceConnection.update({
      where: {
        id: input.connectionId,
      },
      data: {
        accessTokenEncrypted,
        accessTokenExpiresAt: maybeDate(input.tokenBundle?.accessTokenExpiresAt ?? null),
        credentialKind: nextCredentialKind,
        ...(input.tokenBundle || input.clearCredential === true
          ? { credentialMetadataJson: toPrismaJsonObject({}) }
          : {}),
        providerConfigKey:
          input.tokenBundle || input.clearCredential === true
            ? null
            : record.providerConfigKey,
        externalAccountIdEncrypted,
        keyVersion: input.tokenBundle
          ? this.testCodec?.keyVersion ?? HOSTED_DEVICE_SYNC_SECURE_BOX_KEY_VERSION
          : null,
        ...(input.clearRefreshLease === true || obsoleteRefreshLease
          ? {
              refreshLeaseExpiresAt: null,
              refreshLeaseOwner: null,
              refreshLeaseTokenVersion: null,
            }
          : {}),
        refreshTokenEncrypted,
        tokenVersion: input.tokenBundle?.tokenVersion ?? null,
      },
    });
  }

  async clearStoredProviderConfigCredential(input: {
    connectionId: string;
    externalAccountId: string;
    provider: string;
    providerConfigKey: string;
    tx?: HostedPrismaTransactionClient;
    userId: string;
  }): Promise<boolean> {
    const prisma = input.tx ?? this.prisma;
    const providerConfigKey = normalizeNullableString(input.providerConfigKey);
    const externalAccountId = normalizeNullableString(input.externalAccountId);

    if (!providerConfigKey || !externalAccountId) {
      return false;
    }

    const previousProviderAccountBlindIndex = this.buildProviderAccountBlindIndex(input.provider, externalAccountId);
    const nextProviderAccountBlindIndex = this.buildProviderAccountBlindIndex(input.provider, `opaque:${input.connectionId}`);
    const update = await prisma.deviceConnection.updateMany({
      where: {
        id: input.connectionId,
        userId: input.userId,
        provider: input.provider,
        credentialKind: "provider_config",
        providerConfigKey,
        providerAccountBlindIndex: previousProviderAccountBlindIndex,
      },
      data: {
        accessTokenEncrypted: null,
        accessTokenExpiresAt: null,
        credentialKind: "none",
        credentialMetadataJson: toPrismaJsonObject({}),
        externalAccountIdEncrypted: null,
        keyVersion: null,
        providerAccountBlindIndex: nextProviderAccountBlindIndex,
        providerConfigKey: null,
        refreshLeaseExpiresAt: null,
        refreshLeaseOwner: null,
        refreshLeaseTokenVersion: null,
        refreshTokenEncrypted: null,
        tokenVersion: null,
      },
    });

    return update.count > 0;
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

  async listDueReconcileConnectionsForSweep(input: {
    dueAt: Date;
    limit: number;
    recoveryBucketStartedAt: Date;
  }): Promise<HostedDeviceSyncDueReconcileConnectionRecord[]> {
    const limit = Math.max(1, Math.min(input.limit, 251));
    const rows = await this.prisma.$queryRaw<Array<{
      connected_at: Date;
      id: string;
      next_reconcile_at: Date;
      provider: string;
      user_id: string;
    }>>(Prisma.sql`
      select
        "connection"."connected_at",
        "connection"."id",
        "connection"."next_reconcile_at",
        "connection"."provider",
        "connection"."user_id"
      from "device_connection" as "connection"
      join "hosted_member" as "member"
        on "member"."id" = "connection"."user_id"
      where "connection"."status" = 'active'
        and "connection"."next_reconcile_at" is not null
        and "connection"."next_reconcile_at" <= ${input.dueAt}
        and "member"."suspended_at" is null
        -- Set-based projection of the member-access resolver
        -- (member-access.ts): own active billing OR an active membership in
        -- an active, unsuspended account group. Device connections belong to
        -- human members, never thread containers, so no owner branch here.
        and (
          "member"."billing_status" = 'active'
          or exists (
            select 1
            from "hosted_account_group_membership" as "membership"
            join "hosted_account_group" as "account_group"
              on "account_group"."id" = "membership"."group_id"
            where "membership"."member_id" = "member"."id"
              and "membership"."status" = 'active'
              and "account_group"."billing_status" = 'active'
              and "account_group"."suspended_at" is null
          )
        )
        -- A missing historical grant remains compatible with legacy members.
        -- Only an explicit withdrawal removes scheduled-sync authority.
        and not exists (
          select 1
          from "hosted_consent_grant" as "consent_grant"
          where "consent_grant"."member_id" = "member"."id"
            and "consent_grant"."scope" = ${HOSTED_HEALTH_DATA_CONSENT_SCOPE}
            and "consent_grant"."status" = 'revoked'
        )
        and not exists (
          select 1
          from "device_sync_signal" as "signal"
          where "signal"."connection_id" = "connection"."id"
            and "signal"."kind" = 'reconcile_due'
            and "signal"."next_reconcile_at" = "connection"."next_reconcile_at"
            and "signal"."created_at" >= ${input.recoveryBucketStartedAt}
        )
      order by
        "connection"."next_reconcile_at" asc,
        "connection"."updated_at" asc,
        "connection"."id" asc
      limit ${limit}
    `);

    return rows.map((row) => ({
      connectionId: row.id,
      connectedAt: toIsoTimestamp(row.connected_at),
      nextReconcileAt: toIsoTimestamp(row.next_reconcile_at),
      provider: row.provider,
      userId: row.user_id,
    }));
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

  private async buildDurableConnectionRecord(
    record: HostedConnectionRecord,
    fallback: {
      externalAccountId?: string | null;
    } = {},
    // Callers already inside a transaction must pass their transaction client:
    // the secure-box read otherwise checks out a second pooled connection while
    // the transaction holds its own, which self-starves the pool under bursts.
    prisma: HostedSecureBoxPrismaClient = this.prisma,
  ): Promise<PublicDeviceSyncAccount> {
    const mappedRecord = mapHostedConnectionRecord(record);
    mappedRecord.externalAccountId = await readHostedStoredExternalAccountId(record, this.testCodec, prisma);

    return toRedactedPublicDeviceSyncAccount(
      buildHostedPublicDeviceSyncAccount({
        record: mappedRecord,
        fallback,
      }),
    );
  }

  private async buildStoredConnectionAccount(
    record: HostedConnectionRecord,
    prisma: HostedSecureBoxPrismaClient = this.prisma,
  ): Promise<HostedStoredDeviceSyncAccount | null> {
    const mappedRecord = mapHostedConnectionRecord(record);
    mappedRecord.externalAccountId = await readHostedStoredExternalAccountId(record, this.testCodec, prisma);

    const publicConnection = buildHostedPublicDeviceSyncAccount({
      record: mappedRecord,
    });

    switch (mappedRecord.credentialKind) {
      case "oauth_tokens": {
        const tokenBundle = await readHostedStoredTokenBundle(record, this.testCodec, prisma);

        if (!tokenBundle) {
          return null;
        }

        return {
          ...publicConnection,
          credential: {
            kind: "oauth_tokens",
            tokens: {
              accessToken: tokenBundle.accessToken,
              accessTokenExpiresAt: tokenBundle.accessTokenExpiresAt ?? null,
              refreshToken: tokenBundle.refreshToken,
            },
          },
          disconnectGeneration: 0,
          keyVersion: tokenBundle.keyVersion,
          tokenVersion: tokenBundle.tokenVersion,
        } satisfies HostedStoredDeviceSyncAccount;
      }
      case "provider_config":
        if (!mappedRecord.providerConfigKey) {
          return null;
        }

        return {
          ...publicConnection,
          credential: {
            kind: "provider_config",
            credentialMetadata: mappedRecord.credentialMetadata,
            providerConfigKey: mappedRecord.providerConfigKey,
          },
          disconnectGeneration: 0,
          keyVersion: null,
          tokenVersion: null,
        } satisfies HostedStoredDeviceSyncAccount;
      case "none":
        return {
          ...publicConnection,
          credential: {
            kind: "none",
            credentialMetadata: mappedRecord.credentialMetadata,
          },
          disconnectGeneration: 0,
          keyVersion: null,
          tokenVersion: null,
        } satisfies HostedStoredDeviceSyncAccount;
    }
  }
}

async function assertHostedProviderApplicationBindingForUpsert(input: {
  binding: DeviceProviderApplicationBinding | null;
  existing: HostedConnectionRecord | null;
  ownerId: string | null;
  provider: string;
  tx: HostedPrismaTransactionClient;
}): Promise<void> {
  const existingApplicationId = normalizeNullableString(
    input.existing?.providerApplicationId,
  );
  const existingApplicationRevision =
    input.existing?.providerApplicationRevision ?? null;

  if (!input.binding) {
    if (existingApplicationId || existingApplicationRevision !== null) {
      throw deviceSyncError({
        code: "PROVIDER_APPLICATION_REQUIRED",
        message: "This connection must be reauthorized through its private provider application.",
        retryable: false,
        httpStatus: 409,
      });
    }

    if (
      input.ownerId
      && isMemberOwnedDeviceProviderApplicationProvider(input.provider)
    ) {
      const application = await input.tx.deviceProviderApplication.findFirst({
        select: { id: true },
        where: {
          memberId: input.ownerId,
          provider: input.provider,
        },
      });
      if (application) {
        throw deviceSyncError({
          code: "PROVIDER_APPLICATION_REQUIRED",
          message: "This provider must be authorized through the member's private provider application.",
          retryable: false,
          httpStatus: 409,
        });
      }
    }
    return;
  }

  if (!input.ownerId) {
    throw deviceSyncError({
      code: "CONNECTION_OWNER_REQUIRED",
      message: "Member-owned provider application connections require an authenticated owner.",
      retryable: false,
      httpStatus: 400,
    });
  }
  if (input.binding.provider !== input.provider) {
    throw deviceSyncError({
      code: "PROVIDER_APPLICATION_PROVIDER_MISMATCH",
      message: "Private provider application does not match the requested provider.",
      retryable: false,
      httpStatus: 409,
    });
  }

  const application = await input.tx.deviceProviderApplication.findFirst({
    select: {
      id: true,
      memberId: true,
      provider: true,
      revision: true,
    },
    where: {
      id: input.binding.applicationId,
      memberId: input.ownerId,
      provider: input.provider,
      revision: input.binding.revision,
    },
  });
  if (!application) {
    throw deviceSyncError({
      code: "PROVIDER_APPLICATION_STALE",
      message: "Private provider application changed and must be reauthorized.",
      retryable: false,
      httpStatus: 409,
    });
  }

  if (
    input.existing
    && input.existing.status !== "disconnected"
    && (
      existingApplicationId !== application.id
      || existingApplicationRevision !== application.revision
    )
  ) {
    throw deviceSyncError({
      code: "PROVIDER_APPLICATION_CONNECTION_CONFLICT",
      message: "Disconnect the existing provider connection before switching to a private provider application.",
      retryable: false,
      httpStatus: 409,
    });
  }

  const conflictingConnection = await input.tx.deviceConnection.findFirst({
    select: { id: true },
    where: {
      ...(input.existing ? { id: { not: input.existing.id } } : {}),
      provider: input.provider,
      status: { not: "disconnected" },
      userId: input.ownerId,
    },
  });
  if (conflictingConnection) {
    throw deviceSyncError({
      code: "PROVIDER_APPLICATION_CONNECTION_CONFLICT",
      message: "Only one active member-owned connection is supported for this provider.",
      retryable: false,
      httpStatus: 409,
    });
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

function assertHostedUpsertExistingConnectionGuard(
  existing: HostedConnectionRecord | null,
  guard: UpsertPublicDeviceSyncConnectionInput["existingAccountGuard"] | null,
): void {
  if (!guard) {
    return;
  }

  if (!existing || existing.id !== guard.expectedAccountId) {
    throw deviceSyncError({
      code: "CONNECTION_SEEDED_ACCOUNT_MISMATCH",
      message: "Device sync connection callback referenced an unexpected seeded account.",
      retryable: false,
      httpStatus: 400,
    });
  }

  if (guard.rejectIfDisconnected && existing.status === "disconnected") {
    throw deviceSyncError({
      code: "CONNECTION_ALREADY_DISCONNECTED",
      message: "Device sync connection callback was received after the seeded account was disconnected.",
      retryable: false,
      httpStatus: 409,
    });
  }

  if (existing.connectedAt.toISOString() !== guard.expectedConnectedAt) {
    throw deviceSyncError({
      code: "CONNECTION_SEEDED_ACCOUNT_CHANGED",
      message: "Device sync connection changed after this connection flow started.",
      retryable: false,
      httpStatus: 409,
    });
  }
}

function assertNoActiveHostedConnectionRefreshLease(
  record: HostedConnectionRecord,
  now: Date,
): void {
  const refreshLeaseOwner = normalizeNullableString(record.refreshLeaseOwner);

  if (
    !refreshLeaseOwner
    || !record.refreshLeaseExpiresAt
    || record.refreshLeaseTokenVersion === null
    || record.refreshLeaseTokenVersion !== record.tokenVersion
    || record.refreshLeaseExpiresAt.getTime() <= now.getTime()
  ) {
    return;
  }

  throw deviceSyncError({
    code: "TOKEN_REFRESH_IN_PROGRESS",
    message: "A hosted device-sync token refresh is already in progress for this connection.",
    retryable: true,
    httpStatus: 409,
  });
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

async function buildHostedConnectionCredentialWrite(input: {
  connectionId: string;
  credential: DeviceAccountCredential;
  prisma: HostedPrismaTransactionClient;
  provider: string;
  testCodec: HostedDeviceSyncSecretTestCodec | null;
  tokenVersion: number;
  userId: string;
}): Promise<HostedConnectionCredentialWrite> {
  validateHostedDeviceSyncCredentialPolicy(input.provider, input.credential);

  switch (input.credential.kind) {
    case "oauth_tokens":
      return await buildHostedOAuthCredentialWrite({
        connectionId: input.connectionId,
        prisma: input.prisma,
        provider: input.provider,
        testCodec: input.testCodec,
        tokenVersion: input.tokenVersion,
        tokens: input.credential.tokens,
        userId: input.userId,
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
  const policy = resolveConfiguredDeviceSyncProviderCredentialPolicy(provider);

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

async function buildHostedOAuthCredentialWrite(input: {
  connectionId: string;
  prisma: HostedPrismaTransactionClient;
  provider: string;
  testCodec: HostedDeviceSyncSecretTestCodec | null;
  tokenVersion: number;
  tokens: ProviderAuthTokens;
  userId: string;
}): Promise<HostedConnectionCredentialWrite> {
  if (typeof input.tokens.accessToken !== "string" || input.tokens.accessToken.length === 0) {
    throw deviceSyncError({
      code: "CONNECTION_CREDENTIAL_INVALID",
      message: "Hosted OAuth device-sync credentials require an access token.",
      retryable: false,
      httpStatus: 400,
    });
  }

  return {
    accessTokenEncrypted: await encryptHostedConnectionSecret({
      connectionId: input.connectionId,
      provider: input.provider,
      prisma: input.prisma,
      purpose: "device-sync-access-token",
      testCodec: input.testCodec,
      tokenVersion: input.tokenVersion,
      userId: input.userId,
      value: input.tokens.accessToken,
    }),
    accessTokenExpiresAt: maybeDate(input.tokens.accessTokenExpiresAt),
    credentialKind: "oauth_tokens",
    credentialMetadataJson: toPrismaJsonObject({}),
    keyVersion: input.testCodec?.keyVersion ?? HOSTED_DEVICE_SYNC_SECURE_BOX_KEY_VERSION,
    providerConfigKey: null,
    refreshTokenEncrypted: input.tokens.refreshToken
      ? await encryptHostedConnectionSecret({
        connectionId: input.connectionId,
        provider: input.provider,
        prisma: input.prisma,
        purpose: "device-sync-refresh-token",
        testCodec: input.testCodec,
        tokenVersion: input.tokenVersion,
        userId: input.userId,
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
      ? { lastErrorMessage: sanitizeHostedConnectionLastErrorMessage(localState.lastErrorMessage ?? null) }
      : {}),
  };
}
