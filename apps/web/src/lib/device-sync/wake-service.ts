import {
  buildJunctionProviderSourceInstanceKey,
  canonicalizeJunctionProviderSlug,
  JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG,
  JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG,
  normalizeJunctionProviderSlug,
  resolveJunctionDeviceConnectRouteByProviderSlug,
} from "@murphai/device-syncd/connect-config";
import { deviceSyncError, isDeviceSyncError } from "@murphai/device-syncd/errors";
import {
  isGoogleHealthFitbitMigrationLegacyTerminal,
} from "@murphai/device-syncd/fitbit-migration";
import {
  JUNCTION_COMPANION_HRV_SOURCE_PROVIDER,
  JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE,
} from "@murphai/device-syncd/junction-resources";
import {
  clearJunctionScheduleTimeExtendedHistoryCoverageForProvider,
  decideJunctionSourceCallbackAdmission,
} from "@murphai/device-syncd/junction-source-reconnect";
import type {
  DeviceConnectionHandler,
  DeviceSyncIngressWebhook,
  DeviceSyncJobInput,
  DeviceSyncRegistry,
  DeviceSyncWebhookAcceptanceMode,
  ProviderConnectionResult,
  PublicDeviceSyncAccount,
  StartConnectionSourceLifecycleProof,
} from "@murphai/device-syncd/types";
import {
  shapeHostedDeviceSyncJobHintPayload,
} from "@murphai/device-syncd/hosted-hints";
import {
  DEVICE_SYNC_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  DEVICE_SYNC_DISCONNECT_RECOVERY_REQUIRED_ERROR_CODE,
  DEVICE_SYNC_HISTORICAL_RESET_REVOKE_FAILED_ERROR_CODE,
  isEstablishedDeviceSyncConnection,
  isDeviceSyncConnectionSetupExpiredAt,
  isDeviceSyncConnectionSetupPending,
  isDeviceSyncDisconnectInProgress,
  isHistoricalResetIncompleteDeviceSyncAccount,
  requiresHistoricalResetDeviceSyncSource,
} from "@murphai/device-syncd/public-account";
import {
  bucketHostedDeviceSyncEventToProviderSendDelay,
  measureHostedDeviceSyncProviderSendToWebhookMs,
  sanitizeHostedRuntimeErrorCode,
  sanitizeHostedRuntimeErrorText,
  type HostedExecutionDeviceSyncJobHint,
} from "@murphai/device-syncd/hosted-runtime";
import type {
  HostedExecutionDeviceSyncWake,
  HostedExecutionDeviceSyncWakeEvent,
  HostedExecutionWake,
} from "@murphai/hosted-execution";
import {
  COMPANION_HRV_RMSSD_RESOURCE,
  serializeCompanionHrvRmssdObservation,
  type CompanionHrvRmssdObservation,
} from "@murphai/contracts";

import { getPrisma } from "../prisma";
import {
  appendHostedMailboxEnvelopeTx,
  appendHostedMailboxEnvelopeWithPreparedCryptoTx,
  prepareHostedMailboxItemAppendCrypto,
  type AppendHostedMailboxItemResult,
  type PreparedHostedMailboxItemAppendCrypto,
} from "../hosted-mailbox/store";
import {
  runWithFreshHostedDomainRootUnwrapCache,
  runWithHostedDomainRootProviderCallsDisabled,
  runWithHostedDomainRootUnwrapCache,
} from "../hosted-crypto/domain-root-unwrap-cache";
import {
  HostedDomainRootPreparationMismatchError,
} from "../hosted-crypto/domain-root-store";
import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import {
  signalHostedDeviceSyncMailboxRuntime,
} from "../hosted-orchestration/signal-runtime";
import {
  formatHostedExecutionSafeLogErrorDetails,
} from "../hosted-execution/logging";
import { readHostedHealthDataConsentState } from "../legal/consent";
import {
  buildHostedDeviceSyncWake,
} from "./wake";
import {
  HOSTED_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
  HOSTED_SOURCE_START_CLEANUP_IN_PROGRESS_ERROR_CODE,
  HOSTED_SOURCE_USER_DISCONNECTED_ERROR_CODE,
  isHostedConnectionSourceAdmitted,
  isHostedSourceDisconnectFenced,
  resolveHostedJunctionConnectionSource,
} from "./connection-source-lifecycle";
import {
  hasHostedDeviceSyncDirtyResourcePayload,
  mapHostedConnectionRecord,
  PrismaDeviceSyncControlPlaneStore,
  type HostedConnectionSourceAdmissionCandidate,
  type HostedPrismaTransactionClient,
} from "./prisma-store";
import {
  normalizeHostedDeviceSyncLifecycleStatus,
  normalizeHostedDeviceSyncSetupPhase,
  type HostedConnectionRecord,
} from "./prisma-store/connection-records";
import type { HostedDeviceConnectionSource } from "./prisma-store";
import type { HostedDeviceSyncDirtyResource } from "./prisma-store";
import {
  buildHostedTokenRefreshStateUnknownError,
  classifyHostedTokenRefreshLease,
  failClosedStaleHostedTokenRefreshLease,
} from "./agent-session-token-refresh";
import {
  normalizeNullableString,
  sha256Hex,
  toIsoTimestamp,
} from "./shared";

const HOSTED_DEVICE_SYNC_DIRTY_WAKE_EVENT_SCHEMA = "v1";
const HOSTED_DEVICE_SYNC_SCHEDULED_RECONCILE_WAKE_EVENT_SCHEMA = "v3";
const COMPANION_HEALTH_MAX_PENDING_PAYLOADS = 16;
const HISTORICAL_RESET_REVOKE_WARNING_MESSAGE =
  "Provider revoke did not complete while a historical data reset is pending. "
  + "Remove the connection in the provider account before reconnecting.";
const PROVIDER_REVOKE_NOT_CONFIGURED_WARNING = {
  code: "PROVIDER_REVOKE_NOT_CONFIGURED",
  message: "Provider access could not be revoked because provider cleanup is not configured.",
} as const;

export async function disconnectHostedDeviceSyncConnectionSource(input: {
  connectionId: string;
  registry: DeviceSyncRegistry;
  sourceProviderSlug: string;
  store: PrismaDeviceSyncControlPlaneStore;
  userId: string;
}): Promise<{ sourceProviderSlug: string; status: "disconnected" }> {
  const sourceProviderSlug = canonicalizeJunctionProviderSlug(input.sourceProviderSlug);
  if (!sourceProviderSlug) {
    throw deviceSyncError({
      code: "CONNECTION_SOURCE_INVALID",
      message: "Hosted device-sync source was invalid.",
      retryable: false,
      httpStatus: 400,
    });
  }

  const target = await input.store.withConnectionMutationLock(input.connectionId, async (tx) => {
    const connection = await input.store.getConnectionForUser(input.userId, input.connectionId, tx);
    if (!connection) {
      throw connectionSourceNotFoundError();
    }
    if (connection.provider !== "junction" || connection.status === "disconnected") {
      throw connectionSourceNotFoundError();
    }

    const source = await findHostedConnectionSource({
      connectionId: input.connectionId,
      sourceProviderSlug,
      store: input.store,
      tx,
    });
    if (!source) {
      throw connectionSourceNotFoundError();
    }
    if (
      source.lastErrorCode === HOSTED_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE
      || source.lastErrorCode === HOSTED_SOURCE_START_CLEANUP_IN_PROGRESS_ERROR_CODE
    ) {
      connectionChangedDuringDisconnectError();
    }

    const storedAccount = await input.store.getStoredConnectionAccountForUser(
      input.userId,
      input.connectionId,
      tx,
    );
    const revokeSourceAccess = input.registry.get("junction")?.connectionHandler?.revokeSourceAccess;
    if (!storedAccount || !revokeSourceAccess) {
      throw sourceDisconnectUnavailableError();
    }

    const claimAt = nextHostedSourceLifecycleAt(source.lastSeenAt);

    await writeHostedConnectionSourceLifecycle({
      errorCode: HOSTED_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
      errorMessage: null,
      now: claimAt,
      source,
      status: source.status,
      store: input.store,
      tx,
    });

    return {
      claimAt,
      connection,
      revokeSourceAccess,
      source,
      storedAccount,
    };
  });

  let completedByConcurrentCleanup = false;
  try {
    await target.revokeSourceAccess(target.storedAccount, sourceProviderSlug);
  } catch {
    completedByConcurrentCleanup = await input.store.withConnectionMutationLock(
      input.connectionId,
      async (tx) => {
        const current = await readCurrentSourceDisconnectTarget({
          connection: target.connection,
          connectionId: input.connectionId,
          source: target.source,
          sourceProviderSlug,
          storedAccount: target.storedAccount,
          store: input.store,
          tx,
          userId: input.userId,
        });
        if (
          current.status === "disconnected"
          && current.lastErrorCode === HOSTED_SOURCE_USER_DISCONNECTED_ERROR_CODE
        ) {
          if (target.source.lastErrorCode !== HOSTED_SOURCE_USER_DISCONNECTED_ERROR_CODE) {
            await input.store.createSignal({
              userId: input.userId,
              connectionId: input.connectionId,
              provider: target.connection.provider,
              kind: "source_disconnected",
              occurredAt: current.lastSeenAt,
              sourceProviderSlug,
              reason: "user_disconnect",
              createdAt: current.lastSeenAt,
              tx,
            });
          }
          return true;
        }
        if (
          current.lastErrorCode !== HOSTED_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE
          || current.lastSeenAt !== target.claimAt
        ) {
          return false;
        }
        await writeHostedConnectionSourceLifecycle({
          errorCode: target.source.lastErrorCode,
          errorMessage: target.source.lastErrorMessage,
          now: target.source.lastSeenAt,
          source: current,
          status: target.source.status,
          store: input.store,
          tx,
        });
        return false;
      },
    );
    if (!completedByConcurrentCleanup) {
      throw sourceDisconnectUnavailableError();
    }
  }

  let ownedClaimAt = target.claimAt;
  while (!completedByConcurrentCleanup) {
    const outcome = await input.store.withConnectionMutationLock(input.connectionId, async (tx) => {
      const current = await readCurrentSourceDisconnectTarget({
        connection: target.connection,
        connectionId: input.connectionId,
        source: target.source,
        sourceProviderSlug,
        storedAccount: target.storedAccount,
        store: input.store,
        tx,
        userId: input.userId,
      });
      if (
        current.status === "disconnected"
        && current.lastErrorCode === HOSTED_SOURCE_USER_DISCONNECTED_ERROR_CODE
      ) {
        if (target.source.lastErrorCode !== HOSTED_SOURCE_USER_DISCONNECTED_ERROR_CODE) {
          await input.store.createSignal({
            userId: input.userId,
            connectionId: input.connectionId,
            provider: target.connection.provider,
            kind: "source_disconnected",
            occurredAt: current.lastSeenAt,
            sourceProviderSlug,
            reason: "user_disconnect",
            createdAt: current.lastSeenAt,
            tx,
          });
        }
        return { complete: true as const, disconnectedAt: current.lastSeenAt };
      }
      if (current.lastErrorCode !== HOSTED_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE) {
        connectionChangedDuringDisconnectError();
      }
      if (current.lastSeenAt !== ownedClaimAt) {
        return { complete: false as const, claimAt: current.lastSeenAt };
      }

      const disconnectedAt = nextHostedSourceLifecycleAt(current.lastSeenAt);
      await writeHostedConnectionSourceLifecycle({
        errorCode: HOSTED_SOURCE_USER_DISCONNECTED_ERROR_CODE,
        errorMessage: null,
        now: disconnectedAt,
        source: current,
        status: "disconnected",
        store: input.store,
        tx,
      });
      if (target.source.lastErrorCode !== HOSTED_SOURCE_USER_DISCONNECTED_ERROR_CODE) {
        await input.store.createSignal({
          userId: input.userId,
          connectionId: input.connectionId,
          provider: target.connection.provider,
          kind: "source_disconnected",
          occurredAt: disconnectedAt,
          sourceProviderSlug,
          reason: "user_disconnect",
          createdAt: disconnectedAt,
          tx,
        });
      }
      return { complete: true as const, disconnectedAt };
    });

    if (outcome.complete) {
      completedByConcurrentCleanup = true;
      break;
    }

    ownedClaimAt = outcome.claimAt;
    try {
      await target.revokeSourceAccess(target.storedAccount, sourceProviderSlug);
    } catch {
      throw sourceDisconnectUnavailableError();
    }
  }

  return { sourceProviderSlug, status: "disconnected" };
}

/**
 * Opens one exact native-SDK source epoch after a successful explicit token
 * mint. Passive resume and missing intent never call this owner.
 */
export interface HostedDeviceSyncConnectionSourceReconnectProof {
  connection: PublicDeviceSyncAccount;
  source: HostedDeviceConnectionSource | null;
  sourceProviderSlug: string;
}

export async function captureHostedDeviceSyncConnectionSourceReconnect(input: {
  connectionId: string;
  sourceProviderSlug: string;
  store: PrismaDeviceSyncControlPlaneStore;
  userId: string;
}): Promise<HostedDeviceSyncConnectionSourceReconnectProof> {
  const sourceProviderSlug = canonicalizeJunctionProviderSlug(input.sourceProviderSlug);
  if (!sourceProviderSlug) {
    throw connectionSourceNotFoundError();
  }

  return input.store.withConnectionMutationLock(input.connectionId, async (tx) => {
    const connection = await input.store.getConnectionForUser(input.userId, input.connectionId, tx);
    if (
      !connection
      || connection.provider !== "junction"
      || !isEstablishedDeviceSyncConnection(connection)
    ) {
      throw connectionSourceNotFoundError();
    }

    const source = await findHostedConnectionSource({
      connectionId: input.connectionId,
      sourceProviderSlug,
      store: input.store,
      tx,
    });
    if (
      source?.lastErrorCode === HOSTED_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE
      || source?.lastErrorCode === HOSTED_SOURCE_START_CLEANUP_IN_PROGRESS_ERROR_CODE
    ) {
      connectionChangedDuringDisconnectError();
    }

    return { connection, source, sourceProviderSlug };
  });
}

export async function beginHostedDeviceSyncConnectionSourceReconnect(input: {
  proof: HostedDeviceSyncConnectionSourceReconnectProof;
  store: PrismaDeviceSyncControlPlaneStore;
  userId: string;
}): Promise<void> {
  const { connection: expectedConnection, source: expectedSource } = input.proof;
  const sourceProviderSlug = canonicalizeJunctionProviderSlug(input.proof.sourceProviderSlug);
  if (!sourceProviderSlug) {
    throw connectionSourceNotFoundError();
  }

  await input.store.withConnectionMutationLock(expectedConnection.id, async (tx) => {
    const connection = await input.store.getConnectionForUser(
      input.userId,
      expectedConnection.id,
      tx,
    );
    const source = await findHostedConnectionSource({
      connectionId: expectedConnection.id,
      sourceProviderSlug,
      store: input.store,
      tx,
    });
    if (
      !connection
      || !publicAccountMatchesDisconnectTarget(expectedConnection, connection)
      || !isEstablishedDeviceSyncConnection(connection)
      || !hostedConnectionSourceMatchesReconnectProof(expectedSource, source)
    ) {
      connectionChangedDuringDisconnectError();
    }
    const sourceInstanceKey = source?.sourceInstanceKey
      ?? buildJunctionProviderSourceInstanceKey({
        connectionId: expectedConnection.id,
        sourceProviderSlug,
      });
    if (!sourceInstanceKey) {
      throw connectionSourceNotFoundError();
    }
    const sourceStartedAt = nextHostedSourceLifecycleAt(
      source?.lastSeenAt ?? null,
      connection.updatedAt,
    );
    await input.store.upsertConnectionSource({
      connectionId: expectedConnection.id,
      sourceInstanceKey,
      sourceProviderSlug: source?.sourceProviderSlug ?? sourceProviderSlug,
      status: "disconnected",
      ...(source ? { lifecycleEpoch: source.lifecycleEpoch } : {}),
      firstSeenAt: sourceStartedAt,
      lastDataAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSeenAt: sourceStartedAt,
      resourceAvailabilitySummary: null,
      tx,
    });
    if (source) {
      await input.store.advanceConnectionSourceStartBoundary({
        connectionId: expectedConnection.id,
        updatedAt: sourceStartedAt,
        tx,
      });
    }
  });
}

function hostedConnectionSourceMatchesReconnectProof(
  expected: HostedDeviceConnectionSource | null,
  current: HostedDeviceConnectionSource | null,
): boolean {
  if (!expected || !current) {
    return expected === current;
  }
  return expected.id === current.id
    && expected.lastErrorCode === current.lastErrorCode
    && expected.lastErrorMessage === current.lastErrorMessage
    && expected.lifecycleEpoch === current.lifecycleEpoch
    && expected.lastSeenAt === current.lastSeenAt
    && expected.sourceInstanceKey === current.sourceInstanceKey
    && expected.status === current.status;
}

/**
 * Deregisters the exact target before issuing a new browser Link and leaves a
 * pending source epoch. Existing source mutations are fenced across provider
 * I/O so a stale-callback cleanup cannot overlap the newly issued Link.
 */
export async function prepareHostedDeviceSyncConnectionSourceStart(input: {
  connectionId: string;
  registry: DeviceSyncRegistry;
  sourceProviderSlug: string;
  store: PrismaDeviceSyncControlPlaneStore;
  userId: string;
}): Promise<StartConnectionSourceLifecycleProof> {
  const sourceProviderSlug = canonicalizeJunctionProviderSlug(input.sourceProviderSlug);
  if (!sourceProviderSlug) {
    throw sourceStartCleanupUnavailableError();
  }

  const target = await input.store.withConnectionMutationLock(input.connectionId, async (tx) => {
    const connection = await input.store.getConnectionForUser(input.userId, input.connectionId, tx);
    if (!connection || connection.provider !== "junction" || connection.status === "disconnected") {
      throw sourceStartCleanupUnavailableError();
    }
    const source = await findHostedConnectionSource({
      connectionId: input.connectionId,
      sourceProviderSlug,
      store: input.store,
      tx,
    });
    if (
      source?.lastErrorCode === HOSTED_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE
      || source?.lastErrorCode === HOSTED_SOURCE_START_CLEANUP_IN_PROGRESS_ERROR_CODE
    ) {
      throw sourceStartCleanupUnavailableError();
    }
    const storedAccount = await input.store.getStoredConnectionAccountForUser(
      input.userId,
      input.connectionId,
      tx,
    );
    const revokeSourceAccess = input.registry.get("junction")?.connectionHandler?.revokeSourceAccess;
    if (!storedAccount || !revokeSourceAccess) {
      throw sourceStartCleanupUnavailableError();
    }

    if (!source) {
      return {
        claimAt: null,
        connection,
        revokeSourceAccess,
        source: null,
        storedAccount,
      };
    }

    const claimAt = nextHostedSourceLifecycleAt(
      source.lastSeenAt,
      connection.updatedAt,
    );
    await writeHostedConnectionSourceLifecycle({
      errorCode: HOSTED_SOURCE_START_CLEANUP_IN_PROGRESS_ERROR_CODE,
      errorMessage: null,
      now: claimAt,
      source,
      status: source.status,
      store: input.store,
      tx,
    });
    await input.store.advanceConnectionSourceStartBoundary({
      connectionId: input.connectionId,
      updatedAt: claimAt,
      tx,
    });
    return { claimAt, connection, revokeSourceAccess, source, storedAccount };
  });

  try {
    await target.revokeSourceAccess(target.storedAccount, sourceProviderSlug);
  } catch {
    const claimedSource = target.source;
    const claimAt = target.claimAt;
    if (claimedSource && claimAt) {
      await input.store.withConnectionMutationLock(input.connectionId, async (tx) => {
        const current = await requireUnchangedSourceDisconnectTarget({
          claimErrorCode: HOSTED_SOURCE_START_CLEANUP_IN_PROGRESS_ERROR_CODE,
          claimAt,
          connection: target.connection,
          connectionId: input.connectionId,
          source: claimedSource,
          sourceProviderSlug,
          storedAccount: target.storedAccount,
          store: input.store,
          tx,
          userId: input.userId,
        });
        await writeHostedConnectionSourceLifecycle({
          errorCode: claimedSource.lastErrorCode,
          errorMessage: claimedSource.lastErrorMessage,
          now: claimedSource.lastSeenAt,
          source: current,
          status: claimedSource.status,
          store: input.store,
          tx,
        });
      });
    }
    throw sourceStartCleanupUnavailableError();
  }

  if (target.source && target.claimAt) {
    const claimedSource = target.source;
    let ownedClaimAt = target.claimAt;
    while (true) {
      const outcome = await input.store.withConnectionMutationLock(
        input.connectionId,
        async (tx) => {
          const source = await readCurrentSourceDisconnectTarget({
            connection: target.connection,
            connectionId: input.connectionId,
            source: claimedSource,
            sourceProviderSlug,
            storedAccount: target.storedAccount,
            store: input.store,
            tx,
            userId: input.userId,
          });
          if (
            source.status === "disconnected"
            && source.lastErrorCode === null
            && source.lastSeenAt !== ownedClaimAt
          ) {
            return { complete: true as const, source };
          }
          if (source.lastErrorCode !== HOSTED_SOURCE_START_CLEANUP_IN_PROGRESS_ERROR_CODE) {
            connectionChangedDuringDisconnectError();
          }
          if (source.lastSeenAt !== ownedClaimAt) {
            return { complete: false as const, claimAt: source.lastSeenAt };
          }

          const sourceStartedAt = nextHostedSourceLifecycleAt(source.lastSeenAt);
          const preparedSource = await input.store.upsertConnectionSource({
            connectionId: input.connectionId,
            sourceInstanceKey: source.sourceInstanceKey,
            sourceProviderSlug,
            status: "disconnected",
            firstSeenAt: sourceStartedAt,
            lifecycleEpoch: source.lifecycleEpoch,
            lastDataAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSeenAt: sourceStartedAt,
            resourceAvailabilitySummary: null,
            tx,
          });
          return { complete: true as const, source: preparedSource };
        },
      );
      if (outcome.complete) {
        return {
          connectionId: input.connectionId,
          lastSeenAt: outcome.source.lastSeenAt,
          sourceInstanceKey: outcome.source.sourceInstanceKey,
          sourceProviderSlug,
        };
      }
      ownedClaimAt = outcome.claimAt;
      try {
        await target.revokeSourceAccess(target.storedAccount, sourceProviderSlug);
      } catch {
        throw sourceStartCleanupUnavailableError();
      }
    }
  }

  return input.store.withConnectionMutationLock(input.connectionId, async (tx) => {
    const connection = await input.store.getConnectionForUser(input.userId, input.connectionId, tx);
    const storedAccount = await input.store.getStoredConnectionAccountForUser(
      input.userId,
      input.connectionId,
      tx,
    );
    const source = await findHostedConnectionSource({
      connectionId: input.connectionId,
      sourceProviderSlug,
      store: input.store,
      tx,
    });
    if (
      !connection
      || !publicAccountMatchesDisconnectTarget(target.connection, connection)
      || !storedAccountMatchesDisconnectTarget(target.storedAccount, storedAccount)
      || source
    ) {
      connectionChangedDuringDisconnectError();
    }
    const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
      connectionId: input.connectionId,
      sourceProviderSlug,
    });
    if (!sourceInstanceKey) {
      throw sourceStartCleanupUnavailableError();
    }
    const sourceStartedAt = nextHostedSourceLifecycleAt(null);
    const preparedSource = await input.store.upsertConnectionSource({
      connectionId: input.connectionId,
      sourceInstanceKey,
      sourceProviderSlug,
      status: "disconnected",
      firstSeenAt: sourceStartedAt,
      lastErrorCode: null,
      lastErrorMessage: null,
      lastSeenAt: sourceStartedAt,
      tx,
    });
    return {
      connectionId: input.connectionId,
      lastSeenAt: preparedSource.lastSeenAt,
      sourceInstanceKey: preparedSource.sourceInstanceKey,
      sourceProviderSlug,
    };
  });
}

/**
 * Removes provider authorization recreated by an obsolete Junction Link after
 * hosted exact-source admission rejected it. The source-row epoch is the sole
 * claim, so cleanup cannot cross a newer accepted reconnect.
 */
export async function cleanupRejectedHostedDeviceSyncConnectionSource(input: {
  account: PublicDeviceSyncAccount;
  connectionStartedAt: string;
  registry: DeviceSyncRegistry;
  sourceProviderSlug: string;
  store: PrismaDeviceSyncControlPlaneStore;
}): Promise<void> {
  const sourceProviderSlug = canonicalizeJunctionProviderSlug(input.sourceProviderSlug);
  const userId = await input.store.getConnectionOwnerId(input.account.id);
  if (!sourceProviderSlug || !userId) {
    return;
  }

  const target = await input.store.withConnectionMutationLock(input.account.id, async (tx) => {
    const connection = await input.store.getConnectionForUser(userId, input.account.id, tx);
    const source = await findHostedConnectionSource({
      connectionId: input.account.id,
      sourceProviderSlug,
      store: input.store,
      tx,
    });
    const connectionStartedAtMs = Date.parse(input.connectionStartedAt);
    const sourceEpochMs = source ? Date.parse(source.lastSeenAt) : Number.NaN;
    const canObsoleteCallbackOwnCleanup = source !== null
      && Number.isFinite(connectionStartedAtMs)
      && Number.isFinite(sourceEpochMs)
      && sourceEpochMs > connectionStartedAtMs
      && (source.status === "disconnected" || isHostedSourceDisconnectFenced(source));
    if (
      !connection
      || !publicAccountMatchesDisconnectTarget(input.account, connection)
      || !canObsoleteCallbackOwnCleanup
    ) {
      return null;
    }

    const storedAccount = await input.store.getStoredConnectionAccountForUser(
      userId,
      input.account.id,
      tx,
    );
    const revokeSourceAccess = input.registry.get("junction")?.connectionHandler?.revokeSourceAccess;
    if (!storedAccount || !revokeSourceAccess) {
      throw sourceAdmissionCleanupUnavailableError();
    }

    const claimAt = nextHostedSourceLifecycleAt(source.lastSeenAt);
    const preserveUserDisconnect =
      source.lastErrorCode === HOSTED_SOURCE_USER_DISCONNECTED_ERROR_CODE
      || source.lastErrorCode === HOSTED_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE;
    const claimErrorCode = preserveUserDisconnect
      ? HOSTED_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE
      : HOSTED_SOURCE_START_CLEANUP_IN_PROGRESS_ERROR_CODE;
    await writeHostedConnectionSourceLifecycle({
      errorCode: claimErrorCode,
      errorMessage: null,
      now: claimAt,
      source,
      status: "disconnected",
      store: input.store,
      tx,
    });

    return {
      claimAt,
      claimErrorCode,
      connection,
      preserveUserDisconnect,
      revokeSourceAccess,
      source,
      storedAccount,
      userId,
    };
  });
  if (!target) {
    return;
  }

  try {
    await target.revokeSourceAccess(target.storedAccount, sourceProviderSlug);
  } catch {
    const anotherCleanupOwnsResult = await input.store.withConnectionMutationLock(
      input.account.id,
      async (tx) => {
        const current = await readCurrentSourceDisconnectTarget({
          connection: target.connection,
          connectionId: input.account.id,
          source: target.source,
          sourceProviderSlug,
          storedAccount: target.storedAccount,
          store: input.store,
          tx,
          userId: target.userId,
        });
        if (target.preserveUserDisconnect) {
          return current.lastErrorCode === HOSTED_SOURCE_USER_DISCONNECTED_ERROR_CODE
            || (
              current.lastErrorCode === HOSTED_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE
              && current.lastSeenAt !== target.claimAt
            );
        }
        if (
          current.status === "disconnected"
          && current.lastErrorCode === null
          && current.lastSeenAt !== target.claimAt
        ) {
          return true;
        }
        if (
          current.lastErrorCode === HOSTED_SOURCE_START_CLEANUP_IN_PROGRESS_ERROR_CODE
          && current.lastSeenAt !== target.claimAt
        ) {
          return true;
        }
        if (
          current.lastErrorCode !== target.claimErrorCode
          || current.lastSeenAt !== target.claimAt
        ) {
          return false;
        }
        await writeHostedConnectionSourceLifecycle({
          errorCode: target.source.lastErrorCode,
          errorMessage: target.source.lastErrorMessage,
          now: target.source.lastSeenAt,
          source: current,
          status: target.source.status,
          store: input.store,
          tx,
        });
        return false;
      },
    );
    if (!anotherCleanupOwnsResult) {
      throw sourceAdmissionCleanupUnavailableError();
    }
    return;
  }

  await input.store.withConnectionMutationLock(input.account.id, async (tx) => {
    const current = await readCurrentSourceDisconnectTarget({
      connection: target.connection,
      connectionId: input.account.id,
      source: target.source,
      sourceProviderSlug,
      storedAccount: target.storedAccount,
      store: input.store,
      tx,
      userId: target.userId,
    });
    if (target.preserveUserDisconnect) {
      if (current.lastErrorCode === HOSTED_SOURCE_USER_DISCONNECTED_ERROR_CODE) {
        return;
      }
      if (
        current.lastErrorCode === HOSTED_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE
        && current.lastSeenAt !== target.claimAt
      ) {
        return;
      }
    } else {
      if (
        current.status === "disconnected"
        && current.lastErrorCode === null
        && current.lastSeenAt !== target.claimAt
      ) {
        return;
      }
      if (
        current.lastErrorCode === HOSTED_SOURCE_START_CLEANUP_IN_PROGRESS_ERROR_CODE
        && current.lastSeenAt !== target.claimAt
      ) {
        return;
      }
    }
    if (
      current.lastErrorCode !== target.claimErrorCode
      || current.lastSeenAt !== target.claimAt
    ) {
      connectionChangedDuringDisconnectError();
    }
    const restorePendingStart =
      target.source.lastErrorCode === HOSTED_SOURCE_START_CLEANUP_IN_PROGRESS_ERROR_CODE;
    await writeHostedConnectionSourceLifecycle({
      errorCode: target.preserveUserDisconnect
        ? HOSTED_SOURCE_USER_DISCONNECTED_ERROR_CODE
        : restorePendingStart ? null : target.source.lastErrorCode,
      errorMessage:
        target.preserveUserDisconnect || restorePendingStart
          ? null
          : target.source.lastErrorMessage,
      now: target.preserveUserDisconnect || restorePendingStart
        ? nextHostedSourceLifecycleAt(current.lastSeenAt)
        : target.source.lastSeenAt,
      source: current,
      status:
        target.preserveUserDisconnect || restorePendingStart
          ? "disconnected"
          : target.source.status,
      store: input.store,
      tx,
    });
  });
}

export async function disconnectHostedDeviceSyncConnection(input: {
  connectionId: string;
  registry: DeviceSyncRegistry;
  revokeAccess?: DeviceConnectionHandler["revokeAccess"] | null;
  revokeUnavailableWarning?: { code: string; message: string } | null;
  store: PrismaDeviceSyncControlPlaneStore;
  userId: string;
}): Promise<{
  connection: PublicDeviceSyncAccount;
  warning?: { code: string; message: string };
}> {
  const disconnectStartedAt = toIsoTimestamp(new Date());
  const target = await input.store.withConnectionMutationLock(input.connectionId, async (tx) => {
    const connection = await input.store.getConnectionForUser(input.userId, input.connectionId, tx);
    if (!connection) {
      throw deviceSyncError({
        code: "CONNECTION_NOT_FOUND",
        message: "Hosted device-sync connection was not found for the current user.",
        retryable: false,
        httpStatus: 404,
      });
    }

    const connectionRecord = await input.store.getConnectionRecordForUser(
      input.userId,
      input.connectionId,
      tx,
    );

    if (!connectionRecord) {
      connectionChangedDuringDisconnectError();
    }

    if (
      connection.status === "reauthorization_required"
      && connection.lastErrorCode === "TOKEN_REFRESH_STATE_UNKNOWN"
    ) {
      throw buildHostedTokenRefreshStateUnknownError();
    }

    const refreshLeaseStatus = classifyHostedTokenRefreshLease({
      now: disconnectStartedAt,
      record: connectionRecord,
    });
    if (refreshLeaseStatus.status === "in_progress") {
      throw deviceSyncError({
        code: "TOKEN_REFRESH_IN_PROGRESS",
        message: "A hosted device-sync token refresh is already in progress for this connection.",
        retryable: true,
        httpStatus: 409,
      });
    }
    if (refreshLeaseStatus.status === "stale") {
      return {
        refreshLeaseRecoveryError:
          await failClosedStaleHostedTokenRefreshLease({
            account: connection,
            now: disconnectStartedAt,
            store: input.store,
            tx,
            userId: input.userId,
          }),
      };
    }

    // The raw durable credential kind is the cleanup authority. In particular,
    // Prisma may hydrate a credentialKind=none row into a local account object;
    // that object must never cause provider cleanup to run again.
    const storedAccount = connectionRecord.credentialKind === "none"
      ? null
      : await input.store.getStoredConnectionAccountForUser(
          input.userId,
          input.connectionId,
          tx,
        );

    if (!storedAccount && connectionRecord.credentialKind !== "none") {
      throw deviceSyncError({
        code: "CONNECTION_SECRET_MISSING",
        message: "Hosted device-sync connection no longer has its stored cleanup credential.",
        retryable: false,
        httpStatus: 409,
      });
    }

    if (connection.status === "disconnected" && connectionRecord.credentialKind === "none") {
      return {
        alreadyDisconnected: true,
        connection,
        credentialKind: connectionRecord.credentialKind,
        storedAccount,
      };
    }

    if (!isDeviceSyncDisconnectInProgress(connection)) {
      await input.store.syncDurableConnectionState({
        ...connection,
        lastErrorCode: DEVICE_SYNC_DISCONNECT_IN_PROGRESS_ERROR_CODE,
        lastErrorMessage: null,
        nextReconcileAt: null,
        setupExpiresAt: null,
        setupPhase: null,
        status: "reauthorization_required",
        updatedAt: disconnectStartedAt,
      }, tx);
    }

    return {
      alreadyDisconnected: false,
      connection,
      credentialKind: connectionRecord.credentialKind,
      storedAccount,
    };
  });
  if ("refreshLeaseRecoveryError" in target) {
    throw target.refreshLeaseRecoveryError;
  }
  const existing = target.connection;
  const storedAccount = target.storedAccount;

  if (target.alreadyDisconnected) {
    return {
      connection: existing,
    };
  }

  let providerConfigRevokeSucceeded = false;
  let revokeFailure: { code: string; message: string } | undefined;

  if (storedAccount) {
    const revokeAccess = input.revokeAccess === undefined
      ? input.registry.get(existing.provider)?.connectionHandler?.revokeAccess
      : input.revokeAccess ?? undefined;

    // Any retained credential is cleanup authority, even on a legacy row that
    // was prematurely marked disconnected. Retry provider revocation before
    // releasing that exact durable generation.
    if (revokeAccess) {
      try {
        await revokeAccess(storedAccount);
        providerConfigRevokeSucceeded = storedAccount.credential.kind === "provider_config";
      } catch (error) {
        const code = sanitizeHostedRuntimeErrorCode(
          isDeviceSyncError(error) ? error.code : "PROVIDER_REVOKE_FAILED",
        ) ?? "PROVIDER_REVOKE_FAILED";
        const message = sanitizeHostedRuntimeErrorText(
          error instanceof Error ? error.message : "Provider revoke request failed during disconnect.",
        ) ?? "Provider revoke request failed during disconnect.";

        revokeFailure = { code, message };
      }
    } else {
      revokeFailure = input.revokeUnavailableWarning
        ?? PROVIDER_REVOKE_NOT_CONFIGURED_WARNING;
    }
  }

  const now = toIsoTimestamp(new Date());
  const disconnectResult = await input.store.withConnectionMutationLock(input.connectionId, async (tx) => {
    const freshExisting = await input.store.getConnectionForUser(input.userId, input.connectionId, tx);

    if (!freshExisting) {
      throw deviceSyncError({
        code: "CONNECTION_NOT_FOUND",
        message: "Hosted device-sync connection was not found for the current user.",
        retryable: false,
        httpStatus: 404,
      });
    }

    const freshConnectionRecord = await input.store.getConnectionRecordForUser(
      input.userId,
      input.connectionId,
      tx,
    );
    if (!freshConnectionRecord) {
      connectionChangedDuringDisconnectError();
    }
    const freshStoredAccount = freshConnectionRecord.credentialKind === "none"
      ? null
      : await input.store.getStoredConnectionAccountForUser(
          input.userId,
          input.connectionId,
          tx,
        );

    if (
      !isDeviceSyncDisconnectInProgress(freshExisting)
      || target.credentialKind !== freshConnectionRecord.credentialKind
      || !publicAccountMatchesDisconnectTarget(existing, freshExisting)
      || !storedAccountMatchesDisconnectTarget(storedAccount, freshStoredAccount)
    ) {
      connectionChangedDuringDisconnectError();
    }

    const warning = revokeFailure
      ? (
          isHistoricalResetIncompleteDeviceSyncAccount(existing)
          || isHistoricalResetIncompleteDeviceSyncAccount(freshExisting)
          || (await input.store.listConnectionSources(input.connectionId, tx))
            .some(requiresHistoricalResetDeviceSyncSource)
        )
        ? {
            code: DEVICE_SYNC_HISTORICAL_RESET_REVOKE_FAILED_ERROR_CODE,
            message: HISTORICAL_RESET_REVOKE_WARNING_MESSAGE,
          }
        : revokeFailure
      : undefined;
    if (warning && freshStoredAccount != null) {
      const pendingConnection: PublicDeviceSyncAccount = {
        ...freshExisting,
        // Keep the member's disconnect intent durable even when a provider
        // returns an arbitrary error code. The exact warning remains on the
        // signal and response for diagnostics and retry guidance.
        lastErrorCode:
          warning.code === DEVICE_SYNC_HISTORICAL_RESET_REVOKE_FAILED_ERROR_CODE
            ? DEVICE_SYNC_HISTORICAL_RESET_REVOKE_FAILED_ERROR_CODE
            : DEVICE_SYNC_DISCONNECT_RECOVERY_REQUIRED_ERROR_CODE,
        lastErrorMessage: warning.message,
        nextReconcileAt: null,
        setupExpiresAt: null,
        setupPhase: null,
        status: "reauthorization_required",
        updatedAt: now,
      };
      const hint = {
        reason: "user_disconnect",
        revokeWarning: warning,
      } satisfies HostedExecutionDeviceSyncWakeEvent["hint"];
      const wake = buildHostedDeviceSyncWake({
        connectionId: input.connectionId,
        expectedConnectedAt: freshExisting.connectedAt,
        hint,
        occurredAt: now,
        provider: freshExisting.provider,
        source: "reauthorization-required",
        userId: input.userId,
      });

      await input.store.syncDurableConnectionState(pendingConnection, tx);
      await input.store.createSignal({
        userId: input.userId,
        connectionId: input.connectionId,
        provider: freshExisting.provider,
        kind: "reauthorization_required",
        occurredAt: now,
        reason: normalizeNullableString(hint.reason),
        revokeWarning: warning,
        createdAt: now,
        tx,
      });
      const mailboxAppend = await appendHostedMailboxEnvelopeTx({
        envelope: wake,
        tx,
      });

      return {
        connection: pendingConnection,
        mailboxItemId: mailboxAppend.item.id,
        warning,
      };
    }

    if (
      existing.status === "disconnected"
      && freshStoredAccount?.credential.kind === "provider_config"
      && providerConfigRevokeSucceeded
    ) {
      const credentialCleared = await input.store.clearStoredProviderConfigCredential({
        connectionId: freshExisting.id,
        externalAccountId: freshStoredAccount.externalAccountId,
        provider: freshExisting.provider,
        providerConfigKey: freshStoredAccount.credential.providerConfigKey,
        tx,
        userId: input.userId,
      });
      if (!credentialCleared) {
        throw connectionChangedDuringDisconnectError();
      }
      await input.store.markConnectionSourcesDisconnected({
        connectionId: input.connectionId,
        now,
        tx,
      });

      const clearedConnection: PublicDeviceSyncAccount = {
        ...freshExisting,
        lastErrorCode: null,
        lastErrorMessage: null,
        status: "disconnected",
        updatedAt: now,
      };
      await input.store.syncDurableConnectionState(clearedConnection, tx);

      return {
        connection: clearedConnection,
        mailboxItemId: null,
        warning: undefined,
      };
    }

    if (
      existing.status === "disconnected"
      && freshStoredAccount?.credential.kind !== "oauth_tokens"
    ) {
      const repeatedDisconnectedConnection: PublicDeviceSyncAccount = {
        ...freshExisting,
        lastErrorCode: warning?.code ?? existing.lastErrorCode,
        lastErrorMessage: warning?.message ?? existing.lastErrorMessage,
        status: "disconnected",
        updatedAt: now,
      };
      await input.store.syncDurableConnectionState(repeatedDisconnectedConnection, tx);
      return {
        connection: repeatedDisconnectedConnection,
        mailboxItemId: null,
        warning,
      };
    }

    const disconnectedConnection: PublicDeviceSyncAccount = {
      ...freshExisting,
      accessTokenExpiresAt: null,
      lastErrorCode: warning?.code ?? null,
      lastErrorMessage: warning?.message ?? null,
      nextReconcileAt: null,
      setupExpiresAt: null,
      setupPhase: null,
      status: "disconnected",
      updatedAt: now,
    };
    const hint = {
      reason: "user_disconnect",
      ...(warning ? { revokeWarning: warning } : {}),
    } satisfies HostedExecutionDeviceSyncWakeEvent["hint"];
    const wake = buildHostedDeviceSyncWake({
      connectionId: input.connectionId,
      expectedConnectedAt: freshExisting.connectedAt,
      hint,
      occurredAt: now,
      provider: freshExisting.provider,
      source: "disconnect",
      userId: input.userId,
    });

    await input.store.syncDurableConnectionState(disconnectedConnection, tx);
    await input.store.markConnectionSourcesDisconnected({
      connectionId: input.connectionId,
      now,
      tx,
    });
    if (freshStoredAccount?.credential.kind === "provider_config" && providerConfigRevokeSucceeded) {
      const credentialCleared = await input.store.clearStoredProviderConfigCredential({
        connectionId: input.connectionId,
        externalAccountId: freshStoredAccount.externalAccountId,
        provider: freshExisting.provider,
        providerConfigKey: freshStoredAccount.credential.providerConfigKey,
        tx,
        userId: input.userId,
      });
      if (!credentialCleared) {
        throw connectionChangedDuringDisconnectError();
      }
    } else {
      await input.store.persistStoredConnectionTokenBundle({
        clearCredential: freshStoredAccount?.credential.kind === "oauth_tokens",
        connectionId: input.connectionId,
        clearRefreshLease: true,
        externalAccountId: freshStoredAccount?.externalAccountId ?? null,
        provider: freshExisting.provider,
        tokenBundle: null,
        tx,
      });
    }
    await input.store.createSignal({
      userId: input.userId,
      connectionId: input.connectionId,
      provider: freshExisting.provider,
      kind: "disconnected",
      occurredAt: now,
      reason: normalizeNullableString(hint.reason),
      revokeWarning: warning ?? null,
      createdAt: now,
      tx,
    });
    const mailboxAppend = await appendHostedMailboxEnvelopeTx({
      envelope: wake,
      tx,
    });

    return {
      connection: disconnectedConnection,
      mailboxItemId: mailboxAppend.item.id,
      warning,
    };
  });

  if (disconnectResult.mailboxItemId) {
    await startHostedDeviceSyncWakeWorkflow(disconnectResult.mailboxItemId);
  }

  return {
    connection: disconnectResult.connection,
    ...(disconnectResult.warning ? { warning: disconnectResult.warning } : {}),
  };
}

export function handleHostedDeviceSyncUnknownWebhook({
  externalAccountId,
  provider,
  traceId,
  webhook,
}: {
  externalAccountId: string;
  now: string;
  provider: { provider: string };
  traceId: string;
  webhook: DeviceSyncIngressWebhook;
}): void {
  console.warn("Accepted orphan hosted device-sync webhook.", {
    provider: provider.provider,
    externalAccountIdHash: sha256Hex(externalAccountId),
    eventType: webhook.eventType,
    resourceCategory: normalizeNullableString(webhook.resourceCategory),
    traceIdPresent: normalizeNullableString(traceId) !== null,
  });
}

function storedAccountMatchesDisconnectTarget(
  expected: Awaited<ReturnType<PrismaDeviceSyncControlPlaneStore["getStoredConnectionAccountForUser"]>>,
  current: Awaited<ReturnType<PrismaDeviceSyncControlPlaneStore["getStoredConnectionAccountForUser"]>>,
): boolean {
  if (!expected || !current) {
    return expected === current;
  }

  if (
    expected.provider !== current.provider
    || expected.externalAccountId !== current.externalAccountId
    || expected.connectedAt !== current.connectedAt
    || expected.credential.kind !== current.credential.kind
  ) {
    return false;
  }

  if (expected.credential.kind === "provider_config" || current.credential.kind === "provider_config") {
    return expected.credential.kind === "provider_config"
      && current.credential.kind === "provider_config"
      && expected.credential.providerConfigKey === current.credential.providerConfigKey;
  }

  return expected.tokenVersion === current.tokenVersion;
}

function publicAccountMatchesDisconnectTarget(
  expected: PublicDeviceSyncAccount,
  current: PublicDeviceSyncAccount,
): boolean {
  return expected.provider === current.provider
    && expected.externalAccountId === current.externalAccountId
    && expected.connectedAt === current.connectedAt;
}

function connectionChangedDuringDisconnectError(): never {
  throw deviceSyncError({
    code: "CONNECTION_CHANGED_DURING_DISCONNECT",
    message: "Hosted device-sync connection changed while disconnect was in progress. Retry disconnect.",
    retryable: true,
    httpStatus: 409,
  });
}

type HostedDeviceSyncConnectionEstablishedAccount = {
  connectedAt: string;
  id: string;
  provider: string;
  scopes: string[];
  status: PublicDeviceSyncAccount["status"];
};

function buildHostedDeviceSyncConnectionEstablishedWake(input: {
  account: HostedDeviceSyncConnectionEstablishedAccount;
  connection: Pick<ProviderConnectionResult, "initialJobs" | "nextReconcileAt">;
  now: string;
  ownerId: string;
}): HostedExecutionDeviceSyncWake {
  const hint = {
    jobs: normalizeHostedDeviceSyncJobHints({
      connectionId: input.account.id,
      expectedConnectedAt: input.account.connectedAt,
      jobs: input.connection.initialJobs ?? [],
      occurredAt: input.now,
      provider: input.account.provider,
      reason: "connected",
    }),
    nextReconcileAt: input.connection.nextReconcileAt ?? null,
    occurredAt: input.now,
    scopes: input.account.scopes,
  } satisfies HostedExecutionDeviceSyncWakeEvent["hint"];
  return buildHostedDeviceSyncWake({
    connectionId: input.account.id,
    expectedConnectedAt: input.account.connectedAt,
    hint,
    occurredAt: input.now,
    provider: input.account.provider,
    source: "connection-established",
    userId: input.ownerId,
  });
}

async function commitHostedDeviceSyncConnectionEstablishedTx(input: {
  account: HostedDeviceSyncConnectionEstablishedAccount;
  connectionStartedAt?: string | null;
  currentConnectionRecord?: HostedConnectionRecord;
  currentSource?: HostedConnectionSourceAdmissionCandidate;
  sourceProviderSlug?: string | null;
  connection: Pick<ProviderConnectionResult, "initialJobs" | "nextReconcileAt">;
  now: string;
  ownerId: string;
  preparedMailbox?: PreparedHostedMailboxItemAppendCrypto;
  store: PrismaDeviceSyncControlPlaneStore;
  tx: HostedPrismaTransactionClient;
  wake: HostedExecutionDeviceSyncWake;
}): Promise<AppendHostedMailboxItemResult> {
  // Prepared-webhook admission passes the connection row and semantic source
  // already revalidated under this same lock. Native completion still reads.
  const currentConnectionAccount = input.currentConnectionRecord
    ? null
    : await input.store.getConnectionForUser(
        input.ownerId,
        input.account.id,
        input.tx,
      );
  const currentConnection = input.currentConnectionRecord
    ? {
        connectedAt: input.currentConnectionRecord.connectedAt.toISOString(),
        metadata: mapHostedConnectionRecord(input.currentConnectionRecord).metadata,
        status: normalizeHostedDeviceSyncLifecycleStatus(
          input.currentConnectionRecord.status,
        ),
      }
    : currentConnectionAccount;
  if (
    !currentConnection
    || currentConnection.status !== input.account.status
    || currentConnection.connectedAt !== input.account.connectedAt
  ) {
    throw deviceSyncError({
      code: "CONNECTION_ESTABLISHMENT_STALE",
      message: "Device connection changed during completion. Start the connection again.",
      retryable: false,
      httpStatus: 409,
    });
  }

  const linkedSource = resolveHostedJunctionLinkedSource({
    account: input.account,
    sourceProviderSlug: input.sourceProviderSlug ?? null,
  });
  if (linkedSource) {
    const currentSourceCandidate = input.currentSource
      ?? await input.store.resolveConnectionSourceAdmissionCandidate({
        connectionId: input.account.id,
        sourceInstanceKey: linkedSource.sourceInstanceKey,
        sourceProviderSlug: linkedSource.sourceProviderSlug,
        tx: input.tx,
      });
    const currentSource = currentSourceCandidate
      ? {
          ...currentSourceCandidate,
          lastSeenAt: currentSourceCandidate.lastSeenAt.toISOString(),
        }
      : null;
    const sourceAdmission = decideJunctionSourceCallbackAdmission({
      connectionStartedAt: input.connectionStartedAt,
      currentSource,
    });
    if (sourceAdmission === "reject") {
      throw connectionEstablishmentStaleError();
    }
    let advancedLifecycleEpoch: number | undefined;
    if (sourceAdmission === "advance_lifecycle") {
      if (!currentSource) {
        throw connectionEstablishmentStaleError();
      }
      advancedLifecycleEpoch = nextHostedSourceLifecycleEpoch(
        currentSource.lifecycleEpoch,
      );
      const reopenedMetadata = clearJunctionScheduleTimeExtendedHistoryCoverageForProvider({
        metadata: currentConnection.metadata,
        providerSlug: linkedSource.sourceProviderSlug,
      });
      if (input.currentConnectionRecord) {
        await input.store.syncDurableConnectionMetadata(
          input.account.id,
          reopenedMetadata,
          input.tx,
        );
      } else {
        if (!currentConnectionAccount) {
          connectionEstablishmentStaleError();
        }
        await input.store.syncDurableConnectionState({
          ...currentConnectionAccount,
          metadata: reopenedMetadata,
        }, input.tx);
      }
    }
    await input.store.upsertConnectionSource({
      connectionId: input.account.id,
      sourceInstanceKey: currentSource?.sourceInstanceKey
        ?? linkedSource.sourceInstanceKey,
      sourceProviderSlug: currentSource?.sourceProviderSlug
        ?? linkedSource.sourceProviderSlug,
      status: "connected",
      ...(advancedLifecycleEpoch !== undefined
        ? { lifecycleEpoch: advancedLifecycleEpoch }
        : currentSource
          ? { lifecycleEpoch: currentSource.lifecycleEpoch }
          : {}),
      firstSeenAt: input.now,
      lastSeenAt: input.now,
      tx: input.tx,
    });
  }

  await input.store.createSignal({
    userId: input.ownerId,
    connectionId: input.account.id,
    provider: input.account.provider,
    kind: "connected",
    occurredAt: input.now,
    nextReconcileAt: input.connection.nextReconcileAt ?? null,
    createdAt: input.now,
    tx: input.tx,
  });

  const mailboxAppend = input.preparedMailbox
    ? await appendHostedMailboxEnvelopeWithPreparedCryptoTx({
        envelope: input.wake,
        prepared: input.preparedMailbox,
        tx: input.tx,
      })
    : await appendHostedMailboxEnvelopeTx({
        envelope: input.wake,
        tx: input.tx,
      });
  if (mailboxAppend.dedupeConflict) {
    throw deviceSyncError({
      code: "CONNECTION_ESTABLISHMENT_WORK_CONFLICT",
      message: "Device connection completion conflicted with existing initial work. Start the connection again.",
      retryable: false,
      httpStatus: 409,
    });
  }
  return mailboxAppend;
}

export async function handleHostedDeviceSyncConnectionEstablished(input: {
  account: HostedDeviceSyncConnectionEstablishedAccount;
  connectionStartedAt?: string | null;
  sourceProviderSlug?: string | null;
  connection: Pick<ProviderConnectionResult, "initialJobs" | "nextReconcileAt">;
  now: string;
  store: PrismaDeviceSyncControlPlaneStore;
}): Promise<void> {
  const ownerId = await input.store.getConnectionOwnerId(input.account.id);

  if (!ownerId) {
    throw deviceSyncError({
      code: "CONNECTION_ESTABLISHMENT_STALE",
      message: "Device connection ownership changed during completion. Start the connection again.",
      retryable: false,
      httpStatus: 409,
    });
  }

  const wake = buildHostedDeviceSyncConnectionEstablishedWake({
    account: input.account,
    connection: input.connection,
    now: input.now,
    ownerId,
  });
  const mailboxAppend = await input.store.withHealthDataAdmissionLock(
    ownerId,
    input.account.id,
    (tx) => commitHostedDeviceSyncConnectionEstablishedTx({
      ...input,
      ownerId,
      tx,
      wake,
    }),
  );

  if (
    mailboxAppend
    && (
      mailboxAppend.inserted
      || (mailboxAppend.duplicate && !mailboxAppend.dedupeConflict)
    )
  ) {
    await startHostedDeviceSyncWakeWorkflow(mailboxAppend.item.id);
  }
}

async function findHostedConnectionSource(input: {
  connectionId: string;
  sourceProviderSlug: string;
  store: PrismaDeviceSyncControlPlaneStore;
  tx: HostedPrismaTransactionClient;
}): Promise<HostedDeviceConnectionSource | null> {
  return resolveHostedJunctionConnectionSource(
    await input.store.listConnectionSources(input.connectionId, input.tx),
    input.sourceProviderSlug,
  );
}

async function readCurrentSourceDisconnectTarget(input: {
  connection: PublicDeviceSyncAccount;
  connectionId: string;
  source: HostedDeviceConnectionSource;
  sourceProviderSlug: string;
  storedAccount: NonNullable<Awaited<ReturnType<PrismaDeviceSyncControlPlaneStore["getStoredConnectionAccountForUser"]>>>;
  store: PrismaDeviceSyncControlPlaneStore;
  tx: HostedPrismaTransactionClient;
  userId: string;
}): Promise<HostedDeviceConnectionSource> {
  const connection = await input.store.getConnectionForUser(input.userId, input.connectionId, input.tx);
  const storedAccount = await input.store.getStoredConnectionAccountForUser(
    input.userId,
    input.connectionId,
    input.tx,
  );
  const source = await findHostedConnectionSource({
    connectionId: input.connectionId,
    sourceProviderSlug: input.sourceProviderSlug,
    store: input.store,
    tx: input.tx,
  });

  if (
    !connection
    || !publicAccountMatchesDisconnectTarget(input.connection, connection)
    || !storedAccountMatchesDisconnectTarget(input.storedAccount, storedAccount)
    || !source
    || source.id !== input.source.id
  ) {
    connectionChangedDuringDisconnectError();
  }

  return source;
}

async function requireUnchangedSourceDisconnectTarget(input: {
  claimAt: string;
  claimErrorCode: string;
  connection: PublicDeviceSyncAccount;
  connectionId: string;
  source: HostedDeviceConnectionSource;
  sourceProviderSlug: string;
  storedAccount: NonNullable<Awaited<ReturnType<PrismaDeviceSyncControlPlaneStore["getStoredConnectionAccountForUser"]>>>;
  store: PrismaDeviceSyncControlPlaneStore;
  tx: HostedPrismaTransactionClient;
  userId: string;
}): Promise<HostedDeviceConnectionSource> {
  const source = await readCurrentSourceDisconnectTarget(input);
  if (
    source.lastErrorCode !== input.claimErrorCode
    || source.lastSeenAt !== input.claimAt
  ) {
    connectionChangedDuringDisconnectError();
  }
  return source;
}

async function writeHostedConnectionSourceLifecycle(input: {
  errorCode: string | null;
  errorMessage: string | null;
  now: string;
  source: HostedDeviceConnectionSource;
  status: HostedDeviceConnectionSource["status"];
  store: PrismaDeviceSyncControlPlaneStore;
  tx: HostedPrismaTransactionClient;
}): Promise<void> {
  await input.store.upsertConnectionSource({
    connectionId: input.source.connectionId,
    sourceInstanceKey: input.source.sourceInstanceKey,
    sourceProviderSlug: input.source.sourceProviderSlug,
    status: input.status,
    lifecycleEpoch: input.source.lifecycleEpoch,
    lastErrorCode: input.errorCode,
    lastErrorMessage: input.errorMessage,
    lastSeenAt: input.now,
    tx: input.tx,
  });
}

function connectionSourceNotFoundError(): never {
  throw deviceSyncError({
    code: "CONNECTION_SOURCE_NOT_FOUND",
    message: "Hosted device-sync source was not found for this connection.",
    retryable: false,
    httpStatus: 404,
  });
}

function sourceDisconnectUnavailableError(): never {
  throw deviceSyncError({
    cause: {
      errorObservabilityClass: "provider_cleanup",
      errorPhase: "browser_disconnect",
    },
    code: "CONNECTION_SOURCE_DISCONNECT_FAILED",
    message: "Murph could not disconnect this source right now. Retry in a moment.",
    retryable: true,
    httpStatus: 503,
  });
}

function sourceAdmissionCleanupUnavailableError(): never {
  throw deviceSyncError({
    cause: {
      errorObservabilityClass: "provider_cleanup",
      errorPhase: "browser_callback_source_cleanup",
    },
    code: "CONNECTION_SOURCE_CLEANUP_FAILED",
    message: "Murph could not finish cleaning up this source. Start the connection again.",
    retryable: true,
    httpStatus: 503,
  });
}

function sourceStartCleanupUnavailableError(): never {
  throw deviceSyncError({
    cause: {
      errorObservabilityClass: "provider_cleanup",
      errorPhase: "browser_oauth_start",
    },
    code: "JUNCTION_PENDING_LINK_CLEANUP_FAILED",
    message: "Murph could not clear the earlier device connection attempt. Retry before opening another connection link.",
    retryable: true,
    httpStatus: 503,
  });
}

function nextHostedSourceLifecycleAt(...previous: Array<string | null>): string {
  return toIsoTimestamp(new Date(Math.max(
    Date.now(),
    ...previous.map((value) => {
      const previousMs = value === null ? Number.NaN : Date.parse(value);
      return Number.isFinite(previousMs) ? previousMs + 1 : 0;
    }),
  )));
}

function nextHostedSourceLifecycleEpoch(previous: number): number {
  if (!Number.isSafeInteger(previous) || previous < 1 || previous >= Number.MAX_SAFE_INTEGER) {
    throw deviceSyncError({
      code: "CONNECTION_SOURCE_LIFECYCLE_EPOCH_INVALID",
      message: "Device source lifecycle state was invalid. Reconnect the parent connection.",
      retryable: false,
      httpStatus: 409,
    });
  }
  return previous + 1;
}

function connectionEstablishmentStaleError(): never {
  throw deviceSyncError({
    code: "CONNECTION_ESTABLISHMENT_STALE",
    message: "Device connection changed during completion. Start the connection again.",
    retryable: false,
    httpStatus: 409,
  });
}

function resolveHostedJunctionLinkedSource(input: {
  account: {
    id: string;
    provider: string;
  };
  sourceProviderSlug: string | null;
}): { sourceInstanceKey: string; sourceProviderSlug: string } | null {
  if (input.account.provider !== "junction") {
    return null;
  }

  const sourceProviderSlug = canonicalizeJunctionProviderSlug(input.sourceProviderSlug);
  if (!sourceProviderSlug) {
    return null;
  }

  const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
    connectionId: input.account.id,
    sourceProviderSlug,
  });

  return sourceInstanceKey
    ? {
      sourceInstanceKey,
      sourceProviderSlug,
    }
    : null;
}

export async function handleHostedDeviceSyncWebhookAccepted(input: {
  account: {
    connectedAt: string;
    id: string;
    provider: string;
    scopes?: string[];
    status?: PublicDeviceSyncAccount["status"];
  };
  claimToken: string;
  now: string;
  ownerId: string | null;
  processingAttemptedAt: string;
  registry?: DeviceSyncRegistry;
  sourceAdmissionDeferred?: boolean;
  store: PrismaDeviceSyncControlPlaneStore;
  traceId?: string | null;
  webhook: DeviceSyncIngressWebhook;
}): Promise<void> {
  const traceId = normalizeNullableString(input.traceId);
  const ownerId = normalizeNullableString(input.ownerId);

  if (!ownerId) {
    console.warn("Rejecting hosted device-sync webhook without an owner mapping.", {
      connectionFingerprint: sha256Hex(input.account.id).slice(0, 16),
      provider: input.account.provider,
      traceIdPresent: traceId !== null,
    });

    throw deviceSyncError({
      code: "CONNECTION_OWNER_NOT_FOUND",
      message: "Hosted device-sync connection owner mapping is missing. Retry later.",
      retryable: true,
      httpStatus: 503,
    });
  }

  const resourceCategory = normalizeNullableString(input.webhook.resourceCategory);
  const dirtyResources = buildHostedWebhookDirtyResources({
    eventOccurredAt: input.webhook.occurredAt ?? null,
    jobs: input.webhook.jobs ?? [],
    provider: input.account.provider,
    providerSentAt: input.webhook.providerSentAt ?? null,
    sourceProviderSlug: input.webhook.sourceProviderSlug ?? null,
    webhookReceivedAt: input.now,
  });
  const fitbitMigrationSuccessorOccurredAt = input.webhook.occurredAt ?? null;
  const fitbitMigrationSuccessorEventId = fitbitMigrationSuccessorOccurredAt
    ? buildHostedFitbitMigrationSuccessorEventId({
        connectionId: input.account.id,
        expectedConnectedAt: input.account.connectedAt,
        jobs: input.webhook.jobs ?? [],
        provider: input.account.provider,
        userId: ownerId,
      })
    : null;
  const sourceObservation = input.sourceAdmissionDeferred === true
    ? await prepareHostedWebhookSourceObservation({
        ...input,
        ownerId,
        provider: input.account.provider,
        traceId,
      })
    : { kind: "not_required", preparationAuthorityProven: false } as const;
  if (sourceObservation.kind === "terminal") {
    return;
  }
  const resolvedSourceObservation = sourceObservation.kind === "provider_read"
      ? await resolveHostedWebhookSourceObservation({
          now: input.now,
          preparation: sourceObservation,
          store: input.store,
        })
    : null;
  await persistHostedDeviceSyncWebhookAccepted({
    acceptedAt: input.now,
    acceptanceMode: input.webhook.acceptanceMode,
    connectionId: input.account.id,
    dataSourceProviderSlug: canonicalizeJunctionProviderSlug(
      input.webhook.dataSourceProviderSlug,
    ),
    expectedConnectedAt: input.account.connectedAt,
    dirtyResources,
    eventType: input.webhook.eventType,
    fitbitMigrationSuccessorEventId,
    fitbitMigrationSuccessorOccurredAt,
    occurredAt: input.webhook.occurredAt ?? input.now,
    processingAttemptedAt: input.processingAttemptedAt,
    provider: input.account.provider,
    resourceCategory,
    scopes: input.account.scopes ?? [],
    sourceProviderSlug: input.webhook.sourceProviderSlug ?? null,
    sourceObservation: resolvedSourceObservation,
    preparationAuthorityProven: sourceObservation.kind === "provider_read"
      || sourceObservation.preparationAuthorityProven,
    status: input.account.status ?? "active",
    store: input.store,
    claimToken: input.claimToken,
    traceId,
    userId: ownerId,
  });
}

type HostedWebhookSourceObservationPreparation =
  | { kind: "not_required"; preparationAuthorityProven: boolean }
  | { kind: "terminal" }
  | {
      buildSourceConnectionWork: NonNullable<
        DeviceConnectionHandler["buildSourceConnectionWork"]
      >;
      isSourceAccessActive: NonNullable<DeviceConnectionHandler["isSourceAccessActive"]>;
      kind: "provider_read";
      source: HostedConnectionSourceAdmissionCandidate;
      storedConnection: HostedConnectionRecord;
    };

async function prepareHostedWebhookSourceObservation(input: {
  account: { connectedAt: string; id: string; provider: string };
  claimToken: string;
  now: string;
  ownerId: string;
  processingAttemptedAt: string;
  provider: string;
  registry?: DeviceSyncRegistry;
  store: PrismaDeviceSyncControlPlaneStore;
  traceId: string | null;
  webhook: DeviceSyncIngressWebhook;
}): Promise<HostedWebhookSourceObservationPreparation> {
  const sourceProviderSlug = canonicalizeJunctionProviderSlug(input.webhook.sourceProviderSlug);
  if (input.provider !== "junction" || !sourceProviderSlug) {
    return { kind: "not_required", preparationAuthorityProven: false };
  }

  try {
    return await input.store.withHealthDataAdmissionLock(
      input.ownerId,
      input.account.id,
      async (tx) => {
        // One raw record is both current authority and the encrypted credential
        // epoch carried across provider I/O. Materialization happens only
        // after this transaction releases.
        const current = await input.store.getConnectionRecordForUser(
          input.ownerId,
          input.account.id,
          tx,
        );
        if (
          !current
          || current.userId !== input.ownerId
          || current.provider !== input.provider
          || normalizeHostedDeviceSyncLifecycleStatus(current.status) !== "active"
          || current.connectedAt.toISOString() !== input.account.connectedAt
          || current.providerApplicationId !== null
          || current.providerApplicationRevision !== null
        ) {
          await completeHostedWebhookTraceTx(input, tx);
          return { kind: "terminal" };
        }
        const setup = {
          setupExpiresAt: current.setupExpiresAt?.toISOString() ?? null,
          setupPhase: normalizeHostedDeviceSyncSetupPhase(current.setupPhase),
        };
        const setupPending = isDeviceSyncConnectionSetupPending(setup);
        if (setupPending) {
          if (isDeviceSyncConnectionSetupExpiredAt(setup, input.processingAttemptedAt)) {
            await completeHostedWebhookTraceTx(input, tx);
            return { kind: "terminal" };
          }
        } else if (current.connectedAt.getTime() > Date.parse(input.now)) {
          await completeHostedWebhookTraceTx(input, tx);
          return { kind: "terminal" };
        }

        const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
          connectionId: input.account.id,
          sourceProviderSlug,
        });
        let source = await input.store.resolveConnectionSourceAdmissionCandidate({
          connectionId: input.account.id,
          ...(sourceInstanceKey ? { sourceInstanceKey } : {}),
          sourceProviderSlug,
          tx,
        });
        if (!source) {
          if (
            !sourceInstanceKey
            || resolveJunctionDeviceConnectRouteByProviderSlug(
              sourceProviderSlug,
            ) === null
          ) {
            throw webhookSourceNotReadyError(
              "Device source setup is not visible yet. Retry shortly.",
            );
          }
          await input.store.upsertConnectionSource({
            connectionId: input.account.id,
            // The prepared receipt owns this candidate epoch. Using the later
            // processing-attempt time would make the same encrypted event look
            // stale on retry before provider proof can succeed.
            firstSeenAt: input.now,
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSeenAt: input.now,
            sourceInstanceKey,
            sourceProviderSlug,
            status: "disconnected",
            tx,
          });
          source = await input.store.resolveConnectionSourceAdmissionCandidate({
            connectionId: input.account.id,
            sourceInstanceKey,
            sourceProviderSlug,
            tx,
          });
          if (!source) {
            throw webhookSourceNotReadyError(
              "Device source setup is not visible yet. Retry shortly.",
            );
          }
        }
        if (
          source.status === "connected"
          && !isHostedSourceDisconnectFenced(source)
        ) {
          return { kind: "not_required", preparationAuthorityProven: true };
        }
        if (
          source.status !== "disconnected"
          || source.lastErrorCode !== null
        ) {
          await completeHostedWebhookTraceTx(input, tx);
          return { kind: "terminal" };
        }
        if (source.lastSeenAt.getTime() > Date.parse(input.now)) {
          throw webhookSourceNotReadyError(
            "A newer device source setup is still pending. Retry shortly.",
          );
        }
        const connectionHandler = input.registry
          ?.get("junction")
          ?.connectionHandler;
        const isSourceAccessActive = connectionHandler?.isSourceAccessActive;
        const buildSourceConnectionWork = connectionHandler?.buildSourceConnectionWork;
        if (!isSourceAccessActive || !buildSourceConnectionWork) {
          throw deviceSyncError({
            code: "CONNECTION_SOURCE_REGISTRATION_RECONCILIATION_UNAVAILABLE",
            message: "Current device source registration could not be reconciled. Retry shortly.",
            retryable: true,
            httpStatus: 503,
          });
        }
        return {
          buildSourceConnectionWork,
          isSourceAccessActive,
          kind: "provider_read",
          source,
          storedConnection: current,
        };
      },
      { memberRowLockTimeoutMs: WEBHOOK_ADMISSION_MEMBER_ROW_LOCK_TIMEOUT_MS },
    );
  } catch (error) {
    if (
      isDeviceSyncError(error)
      && error.code === "HEALTH_DATA_CONSENT_REQUIRED"
      && !error.retryable
    ) {
      await completeHostedWebhookTrace(input);
      return { kind: "terminal" };
    }
    throw error;
  }
}

async function resolveHostedWebhookSourceObservation(input: {
  now: string;
  preparation: Extract<HostedWebhookSourceObservationPreparation, { kind: "provider_read" }>;
  store: PrismaDeviceSyncControlPlaneStore;
}): Promise<{
  buildSourceConnectionWork: NonNullable<
    DeviceConnectionHandler["buildSourceConnectionWork"]
  >;
  connectionWork: Pick<ProviderConnectionResult, "initialJobs" | "nextReconcileAt">;
  source: HostedConnectionSourceAdmissionCandidate;
  sourceAccessActive: boolean;
  storedConnection: HostedConnectionRecord;
}> {
  const storedAccount = await input.store.materializeStoredConnectionAccount(
    input.preparation.storedConnection,
  );
  if (!storedAccount) {
    throw deviceSyncError({
      code: "CONNECTION_SOURCE_REGISTRATION_RECONCILIATION_UNAVAILABLE",
      message: "Current device source registration could not be reconciled. Retry shortly.",
      retryable: true,
      httpStatus: 503,
    });
  }

  const sourceAccessActive = await input.preparation.isSourceAccessActive(
    storedAccount,
    input.preparation.source.sourceProviderSlug,
  );
  return {
    buildSourceConnectionWork: input.preparation.buildSourceConnectionWork,
    connectionWork: input.preparation.buildSourceConnectionWork({
      historicalProofAuthorization: {
        firstSeenAt: input.now,
        sourceProviderSlug: input.preparation.source.sourceProviderSlug,
      },
      now: input.now,
      sourceProviderSlug: input.preparation.source.sourceProviderSlug,
    }),
    source: input.preparation.source,
    sourceAccessActive,
    storedConnection: input.preparation.storedConnection,
  };
}

export function buildHostedJunctionSourceEstablishmentWork(input: {
  buildSourceConnectionWork: NonNullable<
    DeviceConnectionHandler["buildSourceConnectionWork"]
  >;
  connectionWork: Pick<ProviderConnectionResult, "initialJobs" | "nextReconcileAt">;
  hasAuthorizedLegacyFitbitBackfillSource: boolean;
  now: string;
  sourceProviderSlug: string | null | undefined;
}): Pick<ProviderConnectionResult, "initialJobs" | "nextReconcileAt"> {
  const sourceProviderSlug = normalizeJunctionProviderSlug(input.sourceProviderSlug);
  if (
    sourceProviderSlug !== JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG
    || !input.hasAuthorizedLegacyFitbitBackfillSource
  ) {
    return input.connectionWork;
  }
  const legacyWork = input.buildSourceConnectionWork({
    historicalProofAuthorization: {
      firstSeenAt: input.now,
      sourceProviderSlug,
    },
    now: input.now,
    sourceProviderSlug: JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG,
  });
  const legacyBackfillJobs = legacyWork.initialJobs?.filter(
    (job) => job.kind === "backfill",
  ) ?? [];
  if (legacyBackfillJobs.length === 0) {
    return input.connectionWork;
  }
  return {
    ...input.connectionWork,
    initialJobs: [
      ...(input.connectionWork.initialJobs ?? []),
      ...legacyBackfillJobs,
    ],
  };
}

/**
 * Durably stages a closed companion health payload on the member-owned
 * Junction runtime lane. The encrypted dirty payload is the handoff; health
 * values never enter mailbox hints or signal rows.
 */
export async function persistHostedDeviceSyncCompanionMetadata(input: {
  connectionId: string;
  occurredAt: string;
  resource: HostedDeviceSyncDirtyResource;
  store: PrismaDeviceSyncControlPlaneStore;
  userId: string;
}): Promise<void> {
  await persistHostedDeviceSyncCompanionResource({
    ...input,
    eventType: JUNCTION_COMPANION_HEALTH_METADATA_EVENT_TYPE,
    resourceCategory: "summary",
    setupRequirement: "active",
    wakeReason: "companion_health_metadata",
  });
}

export function buildHostedCompanionHrvRmssdDirtyResource(
  observation: CompanionHrvRmssdObservation,
): HostedDeviceSyncDirtyResource {
  const companionObservationJson = serializeCompanionHrvRmssdObservation(observation);
  const dirtyResources = buildHostedWebhookDirtyResources({
    provider: "junction",
    jobs: [{
      kind: "resource",
      payload: {
        companionAdmissionId: sha256Hex(companionObservationJson),
        companionObservationJson,
        resource: COMPANION_HRV_RMSSD_RESOURCE,
        resourceCategory: "derived",
        sourceProviderSlug: "whoop",
      },
    }],
  });

  const resource = dirtyResources[0];
  if (!resource) {
    throw deviceSyncError({
      code: "COMPANION_HRV_RESOURCE_INVALID",
      message: "Companion HRV ingestion could not build a runtime resource.",
      retryable: false,
      httpStatus: 400,
    });
  }
  return resource;
}

export async function acceptHostedCompanionHrvRmssdObservation(input: {
  acceptedAt: string;
  account: Pick<PublicDeviceSyncAccount, "id" | "provider">;
  resource: HostedDeviceSyncDirtyResource;
  store: PrismaDeviceSyncControlPlaneStore;
  userId: string;
}): Promise<void> {
  if (input.account.provider !== "junction") {
    throw deviceSyncError({
      code: "COMPANION_DEVICE_SYNC_CONNECTION_INVALID",
      message: "Companion HRV ingestion requires the companion device-sync connection.",
      retryable: false,
      httpStatus: 409,
    });
  }

  await persistHostedDeviceSyncCompanionResource({
    connectionId: input.account.id,
    eventType: "companion.hrv-rmssd.created",
    // Dirty-state and mailbox freshness describe server acceptance. The
    // source night remains inside the encrypted payload.
    occurredAt: input.acceptedAt,
    resource: input.resource,
    resourceCategory: "derived",
    setupRequirement: "established",
    store: input.store,
    userId: input.userId,
    wakeReason: "companion_hrv_rmssd",
  });
}

async function persistHostedDeviceSyncCompanionResource(input: {
  connectionId: string;
  eventType: string;
  occurredAt: string;
  resource: HostedDeviceSyncDirtyResource;
  resourceCategory: string;
  setupRequirement: "active" | "established";
  store: PrismaDeviceSyncControlPlaneStore;
  userId: string;
  wakeReason: string;
}): Promise<void> {
  const sourceProviderSlug = canonicalizeJunctionProviderSlug(
    input.resource.resource === COMPANION_HRV_RMSSD_RESOURCE
      ? JUNCTION_COMPANION_HRV_SOURCE_PROVIDER
      : input.resource.sourceProviderSlug,
  );
  const result = await runWithHostedDeviceSyncPreparedWriteReplan(async () => {
    const authority = await input.store.withHealthDataAdmissionLock(
      input.userId,
      input.connectionId,
      (tx) => requireHostedCompanionAdmissionTx({
        ...input,
        sourceProviderSlug,
        tx,
      }),
    );
    const preparedDirty = await input.store.prepareDirtyConnectionUpsert({
      connectionId: authority.connectionId,
      dirtyAt: input.occurredAt,
      eventType: input.eventType,
      provider: authority.provider,
      resourceCategory: input.resourceCategory,
      resources: [input.resource],
      userId: input.userId,
    });
    const wake = buildHostedDeviceSyncWake({
      connectionId: authority.connectionId,
      eventId: buildHostedDeviceSyncDirtyTransitionWakeEventId({
        connectionId: authority.connectionId,
        dirtyRevision: preparedDirty.dirtyRevision,
        expectedConnectedAt: authority.connectedAt,
        provider: authority.provider,
        userId: input.userId,
      }),
      expectedConnectedAt: authority.connectedAt,
      hint: {
        eventType: input.eventType,
        occurredAt: input.occurredAt,
        reason: input.wakeReason,
        resourceCategory: input.resourceCategory,
      },
      occurredAt: input.occurredAt,
      provider: authority.provider,
      source: "webhook-hint",
      userId: input.userId,
    });
    const preparedMailbox = preparedDirty.shouldRequestWake
      ? await prepareHostedMailboxItemAppendCrypto({
          prisma: input.store.prisma,
          userId: input.userId,
        })
      : null;

    return runWithHostedDomainRootProviderCallsDisabled(() =>
      input.store.withHealthDataAdmissionLock(
        input.userId,
        input.connectionId,
        async (tx) => {
          const currentAuthority = await requireHostedCompanionAdmissionTx({
            ...input,
            expectedConnectedAt: authority.connectedAt,
            sourceProviderSlug,
            tx,
          });
          const dirtyUpdate = await input.store.upsertDirtyConnectionWithPreparedPlanTx({
            prepared: preparedDirty,
            tx,
          });
          // Insert/no-op first so an exact replay at the cap remains a successful
          // no-op. A net-new 17th payload rolls back, preserving the bounded queue.
          const pendingPayloadCount = await tx.deviceSyncDirtyPayload.count({
            where: {
              connectionId: currentAuthority.connectionId,
              userId: input.userId,
            },
          });
          if (pendingPayloadCount > COMPANION_HEALTH_MAX_PENDING_PAYLOADS) {
            throw deviceSyncError({
              code: "COMPANION_HEALTH_BACKLOG_FULL",
              message: "Companion health sync is still processing. Retry later.",
              retryable: true,
              httpStatus: 429,
            });
          }
          if (!dirtyUpdate.shouldRequestWake) {
            return { wakeMailboxItemId: null };
          }
          if (!preparedMailbox) {
            throw createHostedDeviceSyncDirtyPreparationMismatchError();
          }

          const mailboxAppend = await appendHostedMailboxEnvelopeWithPreparedCryptoTx({
            envelope: wake,
            prepared: preparedMailbox,
            tx,
          });
          if (mailboxAppend.dedupeConflict) {
            throw deviceSyncError({
              code: "HOSTED_DEVICE_SYNC_DIRTY_WAKE_DEDUPE_CONFLICT",
              httpStatus: 503,
              message: "Hosted device-sync dirty wake conflicted with an existing wake identity.",
              retryable: true,
            });
          }

          return { wakeMailboxItemId: mailboxAppend.item.id };
        },
      )
    );
  });

  if (result.wakeMailboxItemId) {
    await startHostedDeviceSyncWakeWorkflow(result.wakeMailboxItemId, {
      failureMode: "best_effort",
    });
  }
}

async function requireHostedCompanionAdmissionTx(input: {
  connectionId: string;
  expectedConnectedAt?: string;
  setupRequirement: "active" | "established";
  sourceProviderSlug: string | null;
  store: PrismaDeviceSyncControlPlaneStore;
  tx: HostedPrismaTransactionClient;
  userId: string;
}): Promise<{
  connectedAt: string;
  connectionId: string;
  provider: "junction";
}> {
  const current = await input.tx.deviceConnection.findUnique({
    where: { id: input.connectionId },
    select: {
      connectedAt: true,
      provider: true,
      setupPhase: true,
      status: true,
      userId: true,
    },
  });
  const status = normalizeHostedDeviceSyncLifecycleStatus(current?.status);
  const setupPhase = normalizeHostedDeviceSyncSetupPhase(current?.setupPhase);
  if (
    !current
    || current.userId !== input.userId
    || current.provider !== "junction"
    || status !== "active"
    || (
      input.setupRequirement === "established"
      && !isEstablishedDeviceSyncConnection({ setupPhase, status })
    )
  ) {
    throw deviceSyncError({
      code: "COMPANION_HEALTH_CONNECTION_REQUIRED",
      message: "Finish companion health setup before syncing health data.",
      retryable: false,
      httpStatus: 409,
    });
  }

  const connectedAt = current.connectedAt.toISOString();
  if (
    input.expectedConnectedAt !== undefined
    && connectedAt !== input.expectedConnectedAt
  ) {
    throw createHostedDeviceSyncDirtyPreparationMismatchError();
  }
  if (!input.sourceProviderSlug) {
    throw deviceSyncError({
      code: "COMPANION_HEALTH_SOURCE_REQUIRED",
      message: "Reconnect this health source before syncing health data.",
      retryable: false,
      httpStatus: 409,
    });
  }
  const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
    connectionId: input.connectionId,
    sourceProviderSlug: input.sourceProviderSlug,
  });
  const source = await input.store.resolveConnectionSourceAdmissionCandidate({
    connectionId: input.connectionId,
    ...(sourceInstanceKey ? { sourceInstanceKey } : {}),
    sourceProviderSlug: input.sourceProviderSlug,
    tx: input.tx,
  });
  if (
    source
    && (source.status !== "connected" || isHostedSourceDisconnectFenced(source))
  ) {
    throw deviceSyncError({
      code: "COMPANION_HEALTH_SOURCE_REQUIRED",
      message: "Reconnect this health source before syncing health data.",
      retryable: false,
      httpStatus: 409,
    });
  }

  return {
    connectedAt,
    connectionId: input.connectionId,
    provider: "junction",
  };
}

export interface HostedDeviceSyncReconcileWakeResult {
  reason?: string;
  wakeAccepted: boolean;
  wakeAppended: boolean;
  wakeDuplicate: boolean;
  wakeInserted: boolean;
}

export async function appendHostedDeviceSyncManualReconcileWake(input: {
  connectionId: string;
  expectedConnectedAt: string;
  occurredAt: string;
  provider: string;
  userId: string;
}): Promise<HostedDeviceSyncReconcileWakeResult> {
  const store = new PrismaDeviceSyncControlPlaneStore({
    prisma: getPrisma(),
  });
  const wake = buildHostedDeviceSyncWake({
    connectionId: input.connectionId,
    expectedConnectedAt: input.expectedConnectedAt,
    hint: {
      occurredAt: input.occurredAt,
      reason: "manual_reconcile",
    },
    occurredAt: input.occurredAt,
    provider: input.provider,
    source: "manual-reconcile",
    userId: input.userId,
  });
  const appendResult = await persistHostedDeviceSyncWake({
    healthDataConnectionId: input.connectionId,
    healthDataUserId: input.userId,
    wake,
    store,
    persist: async () => {},
  });
  const wakeAccepted = appendResult.inserted
    || (appendResult.duplicate && !appendResult.dedupeConflict);

  return {
    ...(appendResult.dedupeConflict ? { reason: "dedupe_conflict" } : {}),
    wakeAccepted,
    wakeAppended: appendResult.inserted,
    wakeDuplicate: appendResult.duplicate && !appendResult.dedupeConflict,
    wakeInserted: appendResult.inserted,
  };
}

export async function appendHostedDeviceSyncScheduledReconcileWake(input: {
  connectionId: string;
  createdAt: string;
  eventId: string;
  expectedConnectedAt: string;
  nextReconcileAt: string;
  provider: string;
  traceId?: string | null;
  userId: string;
}): Promise<HostedDeviceSyncReconcileWakeResult> {
  const prisma = getPrisma();
  if (await readHostedHealthDataConsentState({
    memberId: input.userId,
    prisma,
  }) === "revoked") {
    return {
      reason: "health_data_consent_withdrawn",
      wakeAccepted: false,
      wakeAppended: false,
      wakeDuplicate: false,
      wakeInserted: false,
    };
  }

  const store = new PrismaDeviceSyncControlPlaneStore({
    prisma,
  });
  const hint = buildHostedDeviceSyncSignalPayload({
    hint: {
      nextReconcileAt: input.nextReconcileAt,
      occurredAt: input.nextReconcileAt,
    },
    occurredAt: input.nextReconcileAt,
    traceId: input.traceId ?? null,
  });
  const wake = buildHostedDeviceSyncWake({
    connectionId: input.connectionId,
    eventId: input.eventId,
    expectedConnectedAt: input.expectedConnectedAt,
    hint,
    occurredAt: input.nextReconcileAt,
    provider: input.provider,
    source: "scheduled-reconcile",
    traceId: input.traceId ?? null,
    userId: input.userId,
  });
  const appendResult = await persistHostedDeviceSyncWake({
    healthDataConnectionId: input.connectionId,
    healthDataUserId: input.userId,
    signalFailureMode: "throw",
    // The first append owns the direct Temporal handoff. A later recovery
    // bucket can encounter the same durable schedule tuple while its imported
    // runtime work is still pending; the shared mailbox-handoff sweep recovers
    // only a never-imported first signal, while imported work keeps its own
    // persisted retry owner.
    startWorkflowOnDuplicate: false,
    wake,
    store,
    persist: async () => {},
    complete: async () => {
      await store.createSignal({
        userId: input.userId,
        connectionId: input.connectionId,
        provider: input.provider,
        kind: "reconcile_due",
        occurredAt: hint.occurredAt ?? null,
        traceId: normalizeNullableString(hint.traceId),
        eventType: null,
        resourceCategory: null,
        reason: null,
        nextReconcileAt: hint.nextReconcileAt ?? null,
        revokeWarning: null,
        createdAt: input.createdAt,
      });
    },
  });
  const wakeAccepted = appendResult.inserted
    || (appendResult.duplicate && !appendResult.dedupeConflict);

  return {
    ...(appendResult.dedupeConflict ? { reason: "dedupe_conflict" } : {}),
    wakeAccepted,
    wakeAppended: appendResult.inserted,
    wakeDuplicate: appendResult.duplicate && !appendResult.dedupeConflict,
    wakeInserted: appendResult.inserted,
  };
}

export function buildHostedDeviceSyncScheduledReconcileWakeEventId(input: {
  connectionId: string;
  expectedConnectedAt: string;
  nextReconcileAt: string;
}): string {
  return [
    "device-sync",
    "scheduled-reconcile",
    HOSTED_DEVICE_SYNC_SCHEDULED_RECONCILE_WAKE_EVENT_SCHEMA,
    input.connectionId,
    input.expectedConnectedAt,
    input.nextReconcileAt,
  ].join(":");
}

async function persistHostedDeviceSyncWake(input: {
  healthDataConnectionId?: string;
  healthDataUserId?: string;
  wake: HostedExecutionWake;
  signalFailureMode?: "best_effort" | "throw";
  startWorkflowOnDuplicate?: boolean;
  store: PrismaDeviceSyncControlPlaneStore;
  persist(tx: HostedPrismaTransactionClient): Promise<void>;
  persistAfterAppend?(
    tx: HostedPrismaTransactionClient,
    mailboxAppend: AppendHostedMailboxItemResult,
  ): Promise<void>;
  complete?(): Promise<void>;
}): Promise<AppendHostedMailboxItemResult> {
  // Webhook retries rebuild fresh signal rows, so the canonical wake identity must stay
  // tied to the stable wake event id instead of the transient signal primary key.
  let mailboxItemId: string | null = null;
  const mailboxAppendState: {
    result: AppendHostedMailboxItemResult | null;
  } = {
    result: null,
  };

  const persistInTransaction = async (tx: HostedPrismaTransactionClient) => {
    await input.persist(tx);
    const mailboxAppend = await appendHostedMailboxEnvelopeTx({
      envelope: input.wake,
      tx,
    });
    mailboxItemId = mailboxAppend.item.id;
    mailboxAppendState.result = mailboxAppend;
    await input.persistAfterAppend?.(tx, mailboxAppend);
  };
  if (input.healthDataUserId && input.healthDataConnectionId) {
    await input.store.withHealthDataAdmissionLock(
      input.healthDataUserId,
      input.healthDataConnectionId,
      persistInTransaction,
    );
  } else {
    await input.store.prisma.$transaction(persistInTransaction);
  }

  const mailboxAppendResult = mailboxAppendState.result;
  if (!mailboxItemId || !mailboxAppendResult) {
    throw deviceSyncError({
      code: "HOSTED_DEVICE_SYNC_WAKE_MAILBOX_APPEND_MISSING",
      httpStatus: 503,
      message: "Hosted device-sync wake could not be queued for runner handoff.",
      retryable: true,
    });
  }

  const wakeAccepted = mailboxAppendResult.inserted
    || (mailboxAppendResult.duplicate && !mailboxAppendResult.dedupeConflict);
  if (
    mailboxAppendResult.inserted ||
    (
      mailboxAppendResult.duplicate
      && !mailboxAppendResult.dedupeConflict
      && input.startWorkflowOnDuplicate !== false
    )
  ) {
    await startHostedDeviceSyncWakeWorkflow(mailboxItemId, {
      failureMode: input.signalFailureMode ?? "best_effort",
    });
  }

  if (wakeAccepted) {
    await input.complete?.();
  }

  return mailboxAppendResult;
}

async function startHostedDeviceSyncWakeWorkflow(
  mailboxItemId: string,
  options: {
    failureMode?: "best_effort" | "throw";
  } = {},
): Promise<void> {
  try {
    await signalHostedDeviceSyncMailboxRuntime({
      mailboxItemId,
    });
  } catch (error) {
    if (
      isHostedOnboardingError(error)
      && error.code === "HOSTED_RUNTIME_USER_INACTIVE"
      && !error.retryable
    ) {
      const code = sanitizeHostedRuntimeErrorCode(error.code)
        ?? "HOSTED_RUNTIME_USER_INACTIVE";

      console.warn(
        "Hosted device-sync wake skipped after mailbox append because runtime access is inactive.",
        {
          ...formatHostedExecutionSafeLogErrorDetails(error, { code }),
          mailboxItemIdPresent: mailboxItemId.length > 0,
        },
      );
      if (options.failureMode === "throw") {
        throw error;
      }
      return;
    }

    const code = sanitizeHostedRuntimeErrorCode(
      isDeviceSyncError(error) ? error.code : "HOSTED_DEVICE_SYNC_TEMPORAL_SIGNAL_FAILED",
    ) ?? "HOSTED_DEVICE_SYNC_TEMPORAL_SIGNAL_FAILED";

    console.warn("Hosted device-sync wake Temporal signal failed after mailbox append.", {
      ...formatHostedExecutionSafeLogErrorDetails(error, { code }),
      mailboxItemIdPresent: mailboxItemId.length > 0,
    });
    if (options.failureMode === "throw") {
      throw error;
    }
  }
}

/**
 * Webhook fan-out bursts queue many admissions on one member row. Without a
 * lock bound, each queued transaction burns its whole 15s budget waiting and
 * then expires mid-callback; with one, waiters fail fast with a retryable 503
 * the provider absorbs by redelivering. Only webhook acceptance passes this
 * bound: other admission callers have no redelivery loop.
 */
const WEBHOOK_ADMISSION_MEMBER_ROW_LOCK_TIMEOUT_MS = 5_000;

interface HostedDeviceSyncWebhookAdmissionInput {
  acceptedAt: string;
  acceptanceMode: DeviceSyncWebhookAcceptanceMode;
  claimToken: string;
  connectionId: string;
  dataSourceProviderSlug: string | null;
  dirtyResources: readonly HostedDeviceSyncDirtyResource[];
  eventType: string;
  expectedConnectedAt: string;
  fitbitMigrationSuccessorEventId: string | null;
  fitbitMigrationSuccessorOccurredAt: string | null;
  occurredAt: string;
  processingAttemptedAt: string;
  provider: string;
  preparationAuthorityProven: boolean;
  resourceCategory?: string | null;
  scopes: string[];
  sourceProviderSlug: string | null;
  sourceObservation: {
    buildSourceConnectionWork: NonNullable<
      DeviceConnectionHandler["buildSourceConnectionWork"]
    >;
    connectionWork: Pick<ProviderConnectionResult, "initialJobs" | "nextReconcileAt">;
    source: HostedConnectionSourceAdmissionCandidate;
    sourceAccessActive: boolean;
    storedConnection: HostedConnectionRecord;
  } | null;
  store: PrismaDeviceSyncControlPlaneStore;
  status: PublicDeviceSyncAccount["status"];
  traceId: string | null;
  userId: string;
}

async function persistHostedDeviceSyncWebhookAccepted(
  input: HostedDeviceSyncWebhookAdmissionInput,
): Promise<void> {
  let result: {
    retrySourceAfterCommit: boolean;
    wakeMailboxItemIds: string[];
  };
  // Registration recovery already commits the callback-equivalent connected
  // signal/mailbox; its wake also drains the durable dirty record.
  const sourceEstablishmentOwnsWebhookHandoff = input.sourceObservation !== null
    && input.provider === "junction"
    && (
      input.eventType === "provider.connection.created"
      || input.eventType === "provider.connection.updated"
    );
  try {
    result = await runWithHostedDeviceSyncPreparedWriteReplan(async (attempt) => {
      const hasPayloadResources = input.dirtyResources.some(
        hasHostedDeviceSyncDirtyResourcePayload,
      );
      const advancesFitbitMigrationSuccessor =
        isHostedJunctionDailyDataWebhookEvent(input.eventType)
        && input.fitbitMigrationSuccessorOccurredAt !== null;
      const requiresFitbitMigrationAdmission = input.provider === "junction"
        && isHostedJunctionDataWebhookEvent(input.eventType)
        && (
          input.dataSourceProviderSlug === null
          || input.dataSourceProviderSlug === JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG
        );
      const sourceEstablishmentRequiresFitbitMigrationWork =
        normalizeJunctionProviderSlug(
          input.sourceObservation?.source.sourceProviderSlug,
        ) === JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG;
      const allowConditionalPreparation = attempt === 0;
      const pendingDirtySnapshot = (
        allowConditionalPreparation
        && !requiresFitbitMigrationAdmission
        && input.acceptanceMode === "level_dirty_hint"
        && !hasPayloadResources
        && input.sourceObservation === null
      )
        ? await input.store.readPendingDirtyConnectionSnapshot({
            connectionId: input.connectionId,
            provider: input.provider,
            userId: input.userId,
          })
        : null;
      const skipInitialAdmission = allowConditionalPreparation
        && !requiresFitbitMigrationAdmission
        && !sourceEstablishmentRequiresFitbitMigrationWork
        && (
          input.preparationAuthorityProven
          || (!hasPayloadResources && pendingDirtySnapshot !== null)
        );
      const initialAdmission = skipInitialAdmission
        ? null
        : await input.store.withHealthDataAdmissionLock(
            input.userId,
            input.connectionId,
            async (tx) => {
              const status = await inspectHostedDeviceSyncWebhookAdmissionTx(
                input,
                tx,
              );
              if (status.kind === "completed") {
                return { status } as const;
              }
              return {
                shouldPrepareWake: status.kind === "migration_pending"
                  ? advancesFitbitMigrationSuccessor
                  : hasPayloadResources
                    ? false
                    : await input.store.shouldRequestWakeForDirtyConnectionUpsert({
                        connectionId: input.connectionId,
                        tx,
                        userId: input.userId,
                      }),
                status,
              } as const;
            },
            {
              memberRowLockTimeoutMs: WEBHOOK_ADMISSION_MEMBER_ROW_LOCK_TIMEOUT_MS,
            },
          );
      if (initialAdmission?.status.kind === "completed") {
        return { retrySourceAfterCommit: false, wakeMailboxItemIds: [] };
      }

      const preparedDirty = initialAdmission?.status.kind !== "migration_pending"
        && hasPayloadResources
        ? await input.store.prepareDirtyConnectionUpsert({
            connectionId: input.connectionId,
            dirtyAt: input.occurredAt,
            eventType: input.eventType,
            provider: input.provider,
            resourceCategory: input.resourceCategory ?? null,
            resources: input.dirtyResources,
            traceId: input.traceId,
            userId: input.userId,
          })
        : null;
      const sourceConnectionAccount = input.sourceObservation
        ? {
            connectedAt: input.expectedConnectedAt,
            id: input.connectionId,
            provider: input.provider,
            scopes: input.scopes,
            status: input.status,
          } satisfies HostedDeviceSyncConnectionEstablishedAccount
        : null;
      const sourceConnectionWork = input.sourceObservation
        ? buildHostedJunctionSourceEstablishmentWork({
            buildSourceConnectionWork:
              input.sourceObservation.buildSourceConnectionWork,
            connectionWork: input.sourceObservation.connectionWork,
            hasAuthorizedLegacyFitbitBackfillSource:
              initialAdmission?.status.hasAuthorizedLegacyFitbitBackfillSource === true,
            now: input.acceptedAt,
            sourceProviderSlug: input.sourceObservation.source.sourceProviderSlug,
          })
        : null;
      const sourceConnectionWake = sourceConnectionAccount && input.sourceObservation
        ? buildHostedDeviceSyncConnectionEstablishedWake({
            account: sourceConnectionAccount,
            connection: sourceConnectionWork ?? input.sourceObservation.connectionWork,
            now: input.acceptedAt,
            ownerId: input.userId,
          })
        : null;
      const shouldPrepareMailbox = input.sourceObservation !== null
        || preparedDirty?.shouldRequestWake === true
        || initialAdmission?.shouldPrepareWake === true
        || (
          input.preparationAuthorityProven
          && !hasPayloadResources
          && pendingDirtySnapshot === null
        );
      const preparedMailbox = shouldPrepareMailbox
        ? await prepareHostedMailboxItemAppendCrypto({
            prisma: input.store.prisma,
            userId: input.userId,
          })
        : null;

      return runWithHostedDomainRootProviderCallsDisabled(() =>
        input.store.withHealthDataAdmissionLock(
          input.userId,
          input.connectionId,
          async (tx) => {
            let finalAdmission: HostedDeviceSyncWebhookAdmissionStatus;
            try {
              finalAdmission = await inspectHostedDeviceSyncWebhookAdmissionTx(
                input,
                tx,
              );
            } catch (error) {
              if (
                skipInitialAdmission
                && isHostedWebhookAdmissionAuthorityDriftError(error)
              ) {
                throw createHostedDeviceSyncDirtyPreparationMismatchError();
              }
              throw error;
            }
            if (finalAdmission.kind === "completed") {
              if (skipInitialAdmission) {
                throw createHostedDeviceSyncDirtyPreparationMismatchError();
              }
              return { retrySourceAfterCommit: false, wakeMailboxItemIds: [] };
            }
            if (
              initialAdmission
              && (
                finalAdmission.kind !== initialAdmission.status.kind
                || finalAdmission.hasAuthorizedLegacyFitbitBackfillSource
                  !== initialAdmission.status.hasAuthorizedLegacyFitbitBackfillSource
                || finalAdmission.hasNonTerminalLegacyFitbitSource
                  !== initialAdmission.status.hasNonTerminalLegacyFitbitSource
              )
            ) {
              throw createHostedDeviceSyncDirtyPreparationMismatchError();
            }

            const wakeMailboxItemIds: string[] = [];
            if (input.sourceObservation) {
              if (
                !preparedMailbox
                || !sourceConnectionAccount
                || !sourceConnectionWork
                || !sourceConnectionWake
                || !finalAdmission.currentConnectionRecord
                || !finalAdmission.currentSource
              ) {
                throw createHostedDeviceSyncDirtyPreparationMismatchError();
              }
              const sourceMailboxAppend = await commitHostedDeviceSyncConnectionEstablishedTx({
                account: sourceConnectionAccount,
                connection: sourceConnectionWork,
                connectionStartedAt: input.sourceObservation.source.lastSeenAt.toISOString(),
                currentConnectionRecord: finalAdmission.currentConnectionRecord,
                currentSource: finalAdmission.currentSource,
                now: input.acceptedAt,
                ownerId: input.userId,
                preparedMailbox,
                sourceProviderSlug: input.sourceObservation.source.sourceProviderSlug,
                store: input.store,
                tx,
                wake: sourceConnectionWake,
              });
              wakeMailboxItemIds.push(sourceMailboxAppend.item.id);
              if (finalAdmission.setupPending) {
                await tx.deviceConnection.update({
                  where: { id: input.connectionId },
                  data: {
                    setupExpiresAt: null,
                    setupPhase: "source_confirmed",
                  },
                });
              }
            }

            if (
              finalAdmission.kind === "migration_pending"
              && !advancesFitbitMigrationSuccessor
            ) {
              return { retrySourceAfterCommit: true, wakeMailboxItemIds };
            }

            if (finalAdmission.kind === "migration_pending") {
              const successorEventId = input.fitbitMigrationSuccessorEventId;
              const successorOccurredAt = input.fitbitMigrationSuccessorOccurredAt;
              if (!preparedMailbox || !successorEventId || !successorOccurredAt) {
                throw webhookSourceNotReadyError(
                  "Google Health webhook occurrence identity is not available yet. Retry shortly.",
                );
              }
              const mailboxAppend = await appendHostedMailboxEnvelopeWithPreparedCryptoTx({
                envelope: buildHostedDeviceSyncWake({
                  connectionId: input.connectionId,
                  eventId: successorEventId,
                  expectedConnectedAt: input.expectedConnectedAt,
                  hint: {
                    eventType: input.eventType,
                    occurredAt: successorOccurredAt,
                    reason: "fitbit_migration_successor_arrival",
                    resourceCategory: input.resourceCategory ?? null,
                  },
                  occurredAt: successorOccurredAt,
                  provider: input.provider,
                  source: "webhook-hint",
                  userId: input.userId,
                }),
                prepared: preparedMailbox,
                tx,
              });
              if (mailboxAppend.dedupeConflict) {
                throw deviceSyncError({
                  code: "HOSTED_DEVICE_SYNC_DIRTY_WAKE_DEDUPE_CONFLICT",
                  httpStatus: 503,
                  message: "Hosted device-sync migration wake conflicted with an existing wake identity.",
                  retryable: true,
                });
              }
              wakeMailboxItemIds.push(mailboxAppend.item.id);
              if (
                mailboxAppend.inserted
                && Date.parse(input.acceptedAt)
                  > finalAdmission.successorFirstSeenAt.getTime()
                && Date.parse(successorOccurredAt)
                  > finalAdmission.successorFirstSeenAt.getTime()
              ) {
                await input.store.markConnectionSourceDataReceived({
                  connectionId: input.connectionId,
                  now: successorOccurredAt,
                  sourceProviderSlug: JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG,
                  tx,
                });
              }
              return { retrySourceAfterCommit: true, wakeMailboxItemIds };
            }

            // Every accepted hint merges into dirty state so coalesced timing remains
            // representative. Only the clean-to-dirty transition appends a wake.
            const dirtyUpdate = preparedDirty
              ? await input.store.upsertDirtyConnectionWithPreparedPlanTx({
                  prepared: preparedDirty,
                  tx,
                })
              : await input.store.upsertDirtyConnection({
                  connectionId: input.connectionId,
                  dirtyAt: input.occurredAt,
                  eventType: input.eventType,
                  provider: input.provider,
                  resourceCategory: input.resourceCategory ?? null,
                  resources: input.dirtyResources,
                  traceId: input.traceId,
                  tx,
                  userId: input.userId,
                });
            await input.store.markWebhookReceived(input.connectionId, input.acceptedAt, tx);
            if (input.dataSourceProviderSlug) {
              await input.store.markConnectionSourceDataReceived({
                connectionId: input.connectionId,
                now: input.acceptedAt,
                sourceProviderSlug: input.dataSourceProviderSlug,
                tx,
              });
            }
            await completeHostedWebhookTraceTx(input, tx);

            if (
              dirtyUpdate.shouldRequestWake
              && !sourceEstablishmentOwnsWebhookHandoff
            ) {
              if (!preparedMailbox) {
                throw createHostedDeviceSyncDirtyPreparationMismatchError();
              }
              const wake = buildHostedDeviceSyncWake({
                connectionId: input.connectionId,
                eventId: buildHostedDeviceSyncDirtyTransitionWakeEventId({
                  connectionId: input.connectionId,
                  dirtyRevision: dirtyUpdate.dirty.dirtyRevision,
                  expectedConnectedAt: input.expectedConnectedAt,
                  provider: input.provider,
                  userId: input.userId,
                }),
                expectedConnectedAt: input.expectedConnectedAt,
                hint: buildHostedDeviceSyncSignalPayload({
                  hint: {
                    eventType: input.eventType,
                    occurredAt: input.occurredAt,
                    reason: "webhook_dirty_transition",
                    resourceCategory: input.resourceCategory ?? null,
                  },
                  occurredAt: input.occurredAt,
                  traceId: input.traceId,
                }),
                occurredAt: input.occurredAt,
                provider: input.provider,
                source: "webhook-hint",
                traceId: null,
                userId: input.userId,
              });
              const mailboxAppend = await appendHostedMailboxEnvelopeWithPreparedCryptoTx({
                envelope: wake,
                prepared: preparedMailbox,
                tx,
              });
              if (mailboxAppend.dedupeConflict) {
                throw deviceSyncError({
                  code: "HOSTED_DEVICE_SYNC_DIRTY_WAKE_DEDUPE_CONFLICT",
                  httpStatus: 503,
                  message: "Hosted device-sync dirty wake conflicted with an existing wake identity.",
                  retryable: true,
                });
              }
              wakeMailboxItemIds.push(mailboxAppend.item.id);
            }
            if (
              !sourceEstablishmentOwnsWebhookHandoff
              && (
                input.acceptanceMode !== "level_dirty_hint"
                || dirtyUpdate.shouldRequestWake
              )
            ) {
              await input.store.createSignal({
                userId: input.userId,
                connectionId: input.connectionId,
                provider: input.provider,
                kind: "webhook_hint",
                occurredAt: input.occurredAt,
                traceId: input.traceId,
                eventType: input.eventType,
                resourceCategory: input.resourceCategory ?? null,
                sourceProviderSlug: input.dataSourceProviderSlug,
                createdAt: input.acceptedAt,
                tx,
              });
            }

            return { retrySourceAfterCommit: false, wakeMailboxItemIds };
          },
          {
            memberRowLockTimeoutMs: WEBHOOK_ADMISSION_MEMBER_ROW_LOCK_TIMEOUT_MS,
          },
        )
      );
    });
  } catch (error) {
    if (
      isDeviceSyncError(error)
      && error.code === "HEALTH_DATA_CONSENT_REQUIRED"
      && !error.retryable
    ) {
      await completeHostedWebhookTrace(input);
      return;
    }
    throw error;
  }

  for (const mailboxItemId of new Set(result.wakeMailboxItemIds)) {
    await startHostedDeviceSyncWakeWorkflow(mailboxItemId, {
      failureMode: "best_effort",
    });
  }
  if (result.retrySourceAfterCommit) {
    throw webhookSourceNotReadyError(
      "Google Health delivery is waiting for Fitbit migration cutover.",
    );
  }
}

type HostedDeviceSyncWebhookAdmissionStatus =
  | { kind: "completed" }
  | {
      currentConnectionRecord: HostedConnectionRecord | null;
      currentSource: HostedConnectionSourceAdmissionCandidate | null;
      hasAuthorizedLegacyFitbitBackfillSource: boolean;
      hasNonTerminalLegacyFitbitSource: boolean;
      kind: "ready";
      setupPending: boolean;
    }
  | {
      currentConnectionRecord: HostedConnectionRecord | null;
      currentSource: HostedConnectionSourceAdmissionCandidate | null;
      hasAuthorizedLegacyFitbitBackfillSource: boolean;
      hasNonTerminalLegacyFitbitSource: boolean;
      kind: "migration_pending";
      setupPending: boolean;
      successorFirstSeenAt: Date;
    };

async function inspectHostedDeviceSyncWebhookAdmissionTx(
  input: HostedDeviceSyncWebhookAdmissionInput,
  tx: HostedPrismaTransactionClient,
): Promise<HostedDeviceSyncWebhookAdmissionStatus> {
  const sourceCredentialCurrent = input.sourceObservation
    ? await input.store.getConnectionRecordForUser(
        input.userId,
        input.connectionId,
        tx,
      )
    : null;
  const current = sourceCredentialCurrent ?? await tx.deviceConnection.findUnique({
    where: { id: input.connectionId },
    select: {
      connectedAt: true,
      provider: true,
      providerApplicationId: true,
      providerApplicationRevision: true,
      setupExpiresAt: true,
      setupPhase: true,
      status: true,
      userId: true,
    },
  });
  if (
    !current
    || current.userId !== input.userId
    || current.provider !== input.provider
    || normalizeHostedDeviceSyncLifecycleStatus(current.status) !== "active"
    || current.connectedAt.toISOString() !== input.expectedConnectedAt
  ) {
    await completeHostedWebhookTraceTx(input, tx);
    return { kind: "completed" };
  }
  // The hosted webhook endpoint authenticates only the shared/operator
  // provider application. A provider-account row may have been rebound to
  // a private application after the webhook's initial account lookup, so
  // the durable admission owner must reject that stale authority while it
  // holds the connection lock. Private connections continue through their
  // scheduled reconciliation path until private webhook ownership exists.
  if (
    current.providerApplicationId !== null
    || current.providerApplicationRevision !== null
  ) {
    await completeHostedWebhookTraceTx(input, tx);
    return { kind: "completed" };
  }
  const setup = {
    setupExpiresAt: current.setupExpiresAt?.toISOString() ?? null,
    setupPhase: normalizeHostedDeviceSyncSetupPhase(current.setupPhase),
  };
  const setupPending = isDeviceSyncConnectionSetupPending(setup);
  if (setupPending) {
    if (isDeviceSyncConnectionSetupExpiredAt(setup, input.processingAttemptedAt)) {
      await completeHostedWebhookTraceTx(input, tx);
      return { kind: "completed" };
    }
    if (!input.sourceObservation) {
      throw deviceSyncError({
        code: "WEBHOOK_ACCOUNT_NOT_READY",
        message: "Device sync setup changed before webhook work could be committed.",
        retryable: true,
        httpStatus: 503,
      });
    }
  } else if (current.connectedAt.getTime() > Date.parse(input.acceptedAt)) {
    await completeHostedWebhookTraceTx(input, tx);
    return { kind: "completed" };
  }
  let currentSource: HostedConnectionSourceAdmissionCandidate | null = null;
  let source: HostedConnectionSourceAdmissionCandidate | null = null;
  const sourceProviderSlug = canonicalizeJunctionProviderSlug(input.sourceProviderSlug);
  if (sourceProviderSlug) {
    const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
      connectionId: input.connectionId,
      sourceProviderSlug,
    });
    source = await input.store.resolveConnectionSourceAdmissionCandidate({
      connectionId: input.connectionId,
      ...(sourceInstanceKey ? { sourceInstanceKey } : {}),
      sourceProviderSlug,
      tx,
    });
    if (input.sourceObservation) {
      if (!sourceCredentialCurrent || !source) {
        throw deviceSyncError({
          code: "WEBHOOK_SOURCE_NOT_READY",
          message: "Device source authority could not be resolved. Retry shortly.",
          retryable: true,
          httpStatus: 503,
        });
      }
      if (!hostedStoredConnectionCredentialEpochMatches(
        input.sourceObservation.storedConnection,
        sourceCredentialCurrent,
      )) {
        throw deviceSyncError({
          code: "CONNECTION_SOURCE_REGISTRATION_RECONCILIATION_UNAVAILABLE",
          message: "Device source credentials changed while registration was checked. Retry shortly.",
          retryable: true,
          httpStatus: 503,
        });
      }
      if (!hostedConnectionSourceAdmissionMatchesProof(
        input.sourceObservation.source,
        source,
      )) {
        if (input.acceptanceMode === "durable_webhook_work") {
          throw deviceSyncError({
            code: "WEBHOOK_SOURCE_NOT_READY",
            message: "Device source authority changed while webhook work was prepared. Retry shortly.",
            retryable: true,
            httpStatus: 503,
          });
        }
        await completeHostedWebhookTraceTx(input, tx);
        return { kind: "completed" };
      }
      if (!input.sourceObservation.sourceAccessActive) {
        throw deviceSyncError({
          code: "WEBHOOK_SOURCE_NOT_READY",
          message: "Current device source registration is not active yet. Retry shortly.",
          retryable: true,
          httpStatus: 503,
        });
      }
      currentSource = source;
    } else {
      if (!source) {
        throw deviceSyncError({
          code: "WEBHOOK_SOURCE_NOT_READY",
          message: "Device source setup is not visible yet. Retry shortly.",
          retryable: true,
          httpStatus: 503,
        });
      }

      if (source.status !== "connected" || isHostedSourceDisconnectFenced(source)) {
        if (
          sourceProviderSlug === JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG
          && isGoogleHealthFitbitMigrationLegacyTerminal(source)
        ) {
          await completeHostedWebhookTraceTx(input, tx);
          return { kind: "completed" };
        }
        if (
          isHostedSourceDisconnectFenced(source)
          || (
            source.status === "disconnected"
            && source.lastErrorCode === null
            && source.lastSeenAt.getTime() <= Date.parse(input.acceptedAt)
          )
        ) {
          throw webhookSourceNotReadyError(
            "Device source registration is still settling. Retry shortly.",
          );
        }
        await completeHostedWebhookTraceTx(input, tx);
        return { kind: "completed" };
      }
    }
  }
  const dataSourceProviderSlug = normalizeJunctionProviderSlug(
    input.dataSourceProviderSlug,
  );
  const unknownJunctionDataSource = input.provider === "junction"
    && dataSourceProviderSlug === null
    && isHostedJunctionDataWebhookEvent(input.eventType);
  const observedGoogleHealthSource = normalizeJunctionProviderSlug(
    input.sourceObservation?.source.sourceProviderSlug,
  ) === JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG;
  const requiresLegacyFitbitSource = unknownJunctionDataSource
    || dataSourceProviderSlug === JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG
    || observedGoogleHealthSource;
  const legacySources = requiresLegacyFitbitSource
    ? await input.store.listBoundedConnectionSourcesForConnections({
        connectionIds: [input.connectionId],
        sourceProviderSlugs: [JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG],
        tx,
      })
    : [];
  const hasNonTerminalLegacyFitbitSource =
    hasNonTerminalHostedGoogleHealthFitbitLegacySource(legacySources);
  const ready = {
    currentConnectionRecord: sourceCredentialCurrent,
    currentSource,
    hasAuthorizedLegacyFitbitBackfillSource:
      hasAuthorizedHostedGoogleHealthFitbitLegacyBackfillSource(legacySources),
    hasNonTerminalLegacyFitbitSource,
    kind: "ready" as const,
    setupPending,
  };

  if (unknownJunctionDataSource) {
    if (hasNonTerminalLegacyFitbitSource) {
      throw webhookSourceNotReadyError(
        "Junction webhook data source provenance is not available yet. Retry shortly.",
      );
    }
    return ready;
  }
  if (!dataSourceProviderSlug) {
    return ready;
  }

  const dataSourceInstanceKey = buildJunctionProviderSourceInstanceKey({
    connectionId: input.connectionId,
    sourceProviderSlug: dataSourceProviderSlug,
  });
  const dataSource = dataSourceProviderSlug === sourceProviderSlug
    ? source
    : await input.store.resolveConnectionSourceAdmissionCandidate({
        connectionId: input.connectionId,
        ...(dataSourceInstanceKey
          ? { sourceInstanceKey: dataSourceInstanceKey }
          : {}),
        sourceProviderSlug: dataSourceProviderSlug,
        tx,
      });
  if (!dataSource) {
    throw webhookSourceNotReadyError(
      "Device data source setup is not visible yet. Retry shortly.",
    );
  }
  const observedSourceWillBeAdmitted = Boolean(
    input.sourceObservation?.sourceAccessActive
    && normalizeJunctionProviderSlug(
      input.sourceObservation.source.sourceProviderSlug,
    ) === dataSourceProviderSlug,
  );
  if (
    !observedSourceWillBeAdmitted
    && !isHostedConnectionSourceAdmitted([dataSource], dataSourceProviderSlug)
  ) {
    if (
      dataSourceProviderSlug === JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG
      && isGoogleHealthFitbitMigrationLegacyTerminal(dataSource)
    ) {
      await completeHostedWebhookTraceTx(input, tx);
      return { kind: "completed" };
    }
    if (
      isHostedSourceDisconnectFenced(dataSource)
      || (
        dataSource.status === "disconnected"
        && dataSource.lastErrorCode === null
        && dataSource.lastSeenAt.getTime() <= Date.parse(input.acceptedAt)
      )
    ) {
      throw webhookSourceNotReadyError(
        "Device data source registration is still settling. Retry shortly.",
      );
    }
    await completeHostedWebhookTraceTx(input, tx);
    return { kind: "completed" };
  }
  if (dataSourceProviderSlug === JUNCTION_GOOGLE_HEALTH_PROVIDER_SLUG) {
    if (hasNonTerminalLegacyFitbitSource) {
      return {
        ...ready,
        kind: "migration_pending",
        successorFirstSeenAt: observedSourceWillBeAdmitted
          ? new Date(Math.max(
              dataSource.firstSeenAt.getTime(),
              Date.parse(input.acceptedAt),
            ))
          : dataSource.firstSeenAt,
      };
    }
  }
  return ready;
}

export function hasNonTerminalHostedGoogleHealthFitbitLegacySource(
  sources: readonly HostedDeviceConnectionSource[],
): boolean {
  return sources.some((source) =>
    normalizeJunctionProviderSlug(source.sourceProviderSlug)
      === JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG
    && !isGoogleHealthFitbitMigrationLegacyTerminal(source)
  );
}

export function hasAuthorizedHostedGoogleHealthFitbitLegacyBackfillSource(
  sources: readonly HostedDeviceConnectionSource[],
): boolean {
  return sources.some((source) =>
    normalizeJunctionProviderSlug(source.sourceProviderSlug)
      === JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG
    && source.status !== "disconnected"
    && !isHostedSourceDisconnectFenced(source)
  );
}

function isHostedJunctionDailyDataWebhookEvent(eventType: string): boolean {
  return eventType.startsWith("daily.data.");
}

function buildHostedFitbitMigrationSuccessorEventId(input: {
  connectionId: string;
  expectedConnectedAt: string;
  jobs: readonly DeviceSyncJobInput[];
  provider: string;
  userId: string;
}): string | null {
  if (input.jobs.length === 0) {
    return null;
  }
  const providerJobDedupeKeys: string[] = [];
  for (const job of input.jobs) {
    const dedupeKey = normalizeNullableString(job.dedupeKey);
    if (!dedupeKey) {
      return null;
    }
    providerJobDedupeKeys.push(dedupeKey);
  }
  const logicalFactId = sha256Hex(JSON.stringify(
    [...new Set(providerJobDedupeKeys)].sort(),
  ));

  return [
    "device-sync",
    "fitbit-migration-successor-arrival",
    input.userId,
    input.provider,
    input.connectionId,
    input.expectedConnectedAt,
    logicalFactId,
  ].join(":");
}

function isHostedJunctionDataWebhookEvent(eventType: string): boolean {
  return isHostedJunctionDailyDataWebhookEvent(eventType)
    || eventType.startsWith("historical.data.");
}

function webhookSourceNotReadyError(
  message: string,
): ReturnType<typeof deviceSyncError> {
  return deviceSyncError({
    code: "WEBHOOK_SOURCE_NOT_READY",
    message,
    retryable: true,
    httpStatus: 503,
  });
}

function hostedConnectionSourceAdmissionMatchesProof(
  expected: HostedConnectionSourceAdmissionCandidate,
  current: HostedConnectionSourceAdmissionCandidate,
): boolean {
  const expectedCanonicalProvider = canonicalizeJunctionProviderSlug(
    expected.sourceProviderSlug,
  );
  const currentCanonicalProvider = canonicalizeJunctionProviderSlug(
    current.sourceProviderSlug,
  );
  const identityMatches = expectedCanonicalProvider && currentCanonicalProvider
    ? expectedCanonicalProvider === currentCanonicalProvider
    : expected.id === current.id
      && expected.sourceInstanceKey === current.sourceInstanceKey
      && expected.sourceProviderSlug === current.sourceProviderSlug;

  return identityMatches
    && expected.firstSeenAt.getTime() === current.firstSeenAt.getTime()
    && expected.lastErrorCode === current.lastErrorCode
    && expected.lastErrorMessage === current.lastErrorMessage
    && expected.lifecycleEpoch === current.lifecycleEpoch
    && expected.lastSeenAt.getTime() === current.lastSeenAt.getTime()
    && expected.status === current.status;
}

function hostedStoredConnectionCredentialEpochMatches(
  expected: HostedConnectionRecord,
  current: HostedConnectionRecord,
): boolean {
  return expected.id === current.id
    && expected.userId === current.userId
    && expected.provider === current.provider
    && expected.connectedAt.getTime() === current.connectedAt.getTime()
    && expected.credentialKind === current.credentialKind
    && expected.providerConfigKey === current.providerConfigKey
    && expected.providerAccountBlindIndex === current.providerAccountBlindIndex
    && expected.externalAccountIdEncrypted === current.externalAccountIdEncrypted
    && expected.accessTokenEncrypted === current.accessTokenEncrypted
    && expected.refreshTokenEncrypted === current.refreshTokenEncrypted
    && sameHostedConnectionTimestamp(
      expected.accessTokenExpiresAt,
      current.accessTokenExpiresAt,
    )
    && expected.keyVersion === current.keyVersion
    && expected.tokenVersion === current.tokenVersion
    && sameHostedConnectionJson(
      expected.credentialMetadataJson,
      current.credentialMetadataJson,
    );
}

function sameHostedConnectionTimestamp(
  left: Date | string | null | undefined,
  right: Date | string | null | undefined,
): boolean {
  const normalize = (value: Date | string | null | undefined): string | null =>
    value instanceof Date ? value.toISOString() : value ?? null;
  return normalize(left) === normalize(right);
}

function sameHostedConnectionJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalizeHostedConnectionJson(left))
    === JSON.stringify(canonicalizeHostedConnectionJson(right));
}

function canonicalizeHostedConnectionJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeHostedConnectionJson);
  }
  if (!value || typeof value !== "object" || value instanceof Date) {
    return value ?? null;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalizeHostedConnectionJson(entry)]),
  );
}

async function completeHostedWebhookTrace(input: {
  claimToken: string;
  provider: string;
  store: PrismaDeviceSyncControlPlaneStore;
  traceId: string | null;
}): Promise<void> {
  if (!input.traceId) {
    return;
  }
  const completed = await input.store.completeWebhookTrace(
    input.provider,
    input.traceId,
    input.claimToken,
  );
  if (!completed) {
    throw deviceSyncError({
      code: "WEBHOOK_TRACE_CLAIM_LOST",
      message: "Webhook trace claim was lost before durable acceptance completed.",
      retryable: true,
      httpStatus: 503,
    });
  }
}

function buildHostedDeviceSyncDirtyTransitionWakeEventId(input: {
  connectionId: string;
  dirtyRevision: bigint;
  expectedConnectedAt: string;
  provider: string;
  userId: string;
}): string {
  return [
    "device-sync",
    "dirty",
    HOSTED_DEVICE_SYNC_DIRTY_WAKE_EVENT_SCHEMA,
    input.userId,
    input.provider,
    input.connectionId,
    input.expectedConnectedAt,
    input.dirtyRevision.toString(),
  ].join(":");
}

const HOSTED_DEVICE_SYNC_PREPARED_WRITE_ATTEMPTS = 2;
const HOSTED_DEVICE_SYNC_WEBHOOK_MAX_DIRTY_RESOURCES = 2;
const HOSTED_DEVICE_SYNC_DIRTY_STATE_CONTENTION_CODE = "HOSTED_DEVICE_SYNC_DIRTY_STATE_CONTENTION";
const HOSTED_DEVICE_SYNC_DIRTY_PREPARATION_MISMATCH_CODE =
  "HOSTED_DEVICE_SYNC_DIRTY_PREPARATION_MISMATCH";
const HOSTED_DEVICE_SYNC_PREPARATION_STALE_CODE =
  "HOSTED_DEVICE_SYNC_PREPARATION_STALE";

function createHostedDeviceSyncDirtyPreparationMismatchError(): Error & {
  code: typeof HOSTED_DEVICE_SYNC_DIRTY_PREPARATION_MISMATCH_CODE;
} {
  return Object.assign(
    new Error("Hosted device-sync dirty preparation is stale."),
    { code: HOSTED_DEVICE_SYNC_DIRTY_PREPARATION_MISMATCH_CODE } as const,
  );
}

function isHostedWebhookAdmissionAuthorityDriftError(error: unknown): boolean {
  if (!isDeviceSyncError(error)) {
    return false;
  }

  return error.code === "WEBHOOK_ACCOUNT_NOT_READY"
    || error.code === "WEBHOOK_SOURCE_NOT_READY"
    || error.code === "CONNECTION_SOURCE_REGISTRATION_RECONCILIATION_UNAVAILABLE";
}

async function runWithHostedDeviceSyncPreparedWriteReplan<T>(
  operation: (attempt: number) => Promise<T>,
): Promise<T> {
  for (
    let attempt = 0;
    attempt < HOSTED_DEVICE_SYNC_PREPARED_WRITE_ATTEMPTS;
    attempt += 1
  ) {
    try {
      const attemptOperation = () => operation(attempt);
      return await (attempt === 0
        ? runWithHostedDomainRootUnwrapCache(attemptOperation)
        : runWithFreshHostedDomainRootUnwrapCache(attemptOperation));
    } catch (error) {
      if (!isHostedDeviceSyncPreparedWriteReplanError(error)) {
        throw error;
      }
      if (attempt === HOSTED_DEVICE_SYNC_PREPARED_WRITE_ATTEMPTS - 1) {
        if (isDeviceSyncError(error)) {
          throw error;
        }
        throw deviceSyncError({
          code: HOSTED_DEVICE_SYNC_PREPARATION_STALE_CODE,
          httpStatus: 503,
          message: "Hosted device-sync state changed during preparation. Retry the request.",
          retryable: true,
        });
      }
    }
  }

  throw new Error("Hosted device-sync prepared-write replan loop exhausted unexpectedly.");
}

function isHostedDeviceSyncPreparedWriteReplanError(error: unknown): boolean {
  if (error instanceof HostedDomainRootPreparationMismatchError) {
    return true;
  }
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === HOSTED_DEVICE_SYNC_DIRTY_PREPARATION_MISMATCH_CODE
    || code === HOSTED_DEVICE_SYNC_DIRTY_STATE_CONTENTION_CODE;
}

async function completeHostedWebhookTraceTx(
  input: {
    claimToken: string;
    provider: string;
    store: PrismaDeviceSyncControlPlaneStore;
    traceId: string | null;
  },
  tx: HostedPrismaTransactionClient,
): Promise<void> {
  if (!input.traceId) {
    return;
  }

  const completed = await input.store.completeWebhookTrace(input.provider, input.traceId, input.claimToken, tx);
  if (!completed) {
    throw deviceSyncError({
      code: "WEBHOOK_TRACE_CLAIM_LOST",
      message: "Webhook trace claim was lost before durable acceptance completed.",
      retryable: true,
      httpStatus: 503,
    });
  }
}

function buildHostedDeviceSyncSignalPayload(input: {
  hint?: HostedExecutionDeviceSyncWakeEvent["hint"] | null;
  occurredAt: string;
  traceId?: string | null;
}): NonNullable<HostedExecutionDeviceSyncWakeEvent["hint"]> {
  return {
    ...(input.hint ?? {}),
    ...(input.hint?.occurredAt === undefined ? { occurredAt: input.occurredAt } : {}),
    ...(input.traceId && input.hint?.traceId === undefined ? { traceId: input.traceId } : {}),
  };
}

function normalizeHostedDeviceSyncJobHints(input: {
  connectionId: string;
  expectedConnectedAt: string;
  jobs: readonly DeviceSyncJobInput[];
  occurredAt?: string | null;
  provider: string;
  reason: HostedExecutionDeviceSyncWakeEvent["reason"];
  traceId?: string | null;
}): HostedExecutionDeviceSyncJobHint[] {
  return input.jobs.map((job, index) => {
    const payload = shapeHostedDeviceSyncJobHintPayload(input.provider, job);
    const stableSeed = JSON.stringify({
      connectionId: input.connectionId,
      expectedConnectedAt: input.expectedConnectedAt,
      ...(typeof job.dedupeKey === "string"
        ? { providerDedupeKey: job.dedupeKey }
        : {
            index,
            kind: job.kind,
            payload,
          }),
      reason: input.reason,
      traceId: input.traceId ?? null,
    });

    return {
      kind: job.kind,
      ...(job.availableAt ? { availableAt: job.availableAt } : {}),
      dedupeKey: `hosted-device-sync:${sha256Hex(stableSeed)}`,
      ...(typeof job.maxAttempts === "number" ? { maxAttempts: job.maxAttempts } : {}),
      payload,
      ...(typeof job.priority === "number" ? { priority: job.priority } : {}),
    } satisfies HostedExecutionDeviceSyncJobHint;
  });
}

function buildHostedWebhookDirtyResources(input: {
  eventOccurredAt?: string | null;
  jobs: readonly DeviceSyncJobInput[];
  provider: string;
  providerSentAt?: string | null;
  sourceProviderSlug?: string | null;
  webhookReceivedAt?: string | null;
}): HostedDeviceSyncDirtyResource[] {
  if (input.jobs.length > HOSTED_DEVICE_SYNC_WEBHOOK_MAX_DIRTY_RESOURCES) {
    throw deviceSyncError({
      code: "HOSTED_DEVICE_SYNC_WEBHOOK_RESOURCE_BATCH_TOO_LARGE",
      httpStatus: 500,
      message: "Hosted device-sync webhook produced more work than its bounded admission contract permits.",
      retryable: false,
    });
  }
  const resources: HostedDeviceSyncDirtyResource[] = [];
  const webhookSourceProviderSlug = readHostedDirtyResourceString(
    input.sourceProviderSlug,
  );
  const providerSlug = readHostedDirtyResourceString(input.provider);

  for (const job of input.jobs) {
    const payload = shapeHostedDeviceSyncJobHintPayload(input.provider, job);
    const payloadSourceProviderSlug = readHostedDirtyResourceString(
      payload.sourceProviderSlug,
    );
    resources.push({
      count: 1,
      ...buildHostedWebhookDirtyResourceTiming(input),
      jobKind: job.kind,
      payload: readHostedDirtyResourcePayload(payload),
      resource: readHostedDirtyResourceString(payload.resource),
      resourceCategory: readHostedDirtyResourceString(payload.resourceCategory),
      // This field participates in resource execution identity and can be
      // promoted back into provider input, so only provider-owned payload data
      // may populate it. Timing attribution remains metadata-only below.
      sourceProviderSlug: payloadSourceProviderSlug,
      timingSourceProviderSlug: payloadSourceProviderSlug
        ?? webhookSourceProviderSlug
        ?? providerSlug,
      windowEnd: readHostedDirtyResourceString(payload.windowEnd),
      windowStart: readHostedDirtyResourceString(payload.windowStart),
    });
  }

  if (resources.length === 0) {
    resources.push({
      count: 1,
      ...buildHostedWebhookDirtyResourceTiming(input),
      jobKind: "reconcile",
      resource: null,
      resourceCategory: null,
      sourceProviderSlug: null,
      timingSourceProviderSlug: webhookSourceProviderSlug ?? providerSlug,
      windowEnd: null,
      windowStart: null,
    });
  }

  return resources;
}

function buildHostedWebhookDirtyResourceTiming(input: {
  eventOccurredAt?: string | null;
  providerSentAt?: string | null;
  webhookReceivedAt?: string | null;
}): Pick<
  HostedDeviceSyncDirtyResource,
  "eventToProviderSendBucket" | "firstWebhookReceivedAt" | "providerSendToWebhookMs"
> | Record<string, never> {
  const eventToProviderSendBucket = bucketHostedDeviceSyncEventToProviderSendDelay({
    eventOccurredAt: input.eventOccurredAt,
    providerSentAt: input.providerSentAt,
  });
  const firstWebhookReceivedAt = normalizeNullableString(input.webhookReceivedAt);
  const providerSendToWebhookMs = measureHostedDeviceSyncProviderSendToWebhookMs({
    providerSentAt: input.providerSentAt,
    webhookReceivedAt: input.webhookReceivedAt,
  });
  return eventToProviderSendBucket || firstWebhookReceivedAt || providerSendToWebhookMs !== null
    ? {
        eventToProviderSendBucket,
        firstWebhookReceivedAt,
        providerSendToWebhookMs,
      }
    : {};
}

function readHostedDirtyResourceString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readHostedDirtyResourcePayload(
  value: Record<string, unknown>,
): HostedDeviceSyncDirtyResource["payload"] {
  const payload: Record<string, boolean | number | string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" || typeof entry === "boolean") {
      payload[key] = entry;
    } else if (typeof entry === "number" && Number.isFinite(entry)) {
      payload[key] = entry;
    }
  }
  return Object.keys(payload).length > 0 ? payload : undefined;
}
