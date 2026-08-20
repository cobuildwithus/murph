import {
  createConfiguredDeviceSyncProvidersFromConfigs,
} from "@murphai/device-syncd/config";
import {
  JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG,
} from "@murphai/device-syncd/connect-config";
import {
  isGoogleHealthFitbitMigrationCutoverReady,
  isGoogleHealthFitbitMigrationLegacyTerminal,
  resolveGoogleHealthFitbitMigrationSources,
} from "@murphai/device-syncd/fitbit-migration";
import {
  DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE,
} from "@murphai/device-syncd/public-account";
import type {
  SerializableConfiguredDeviceSyncProviderConfigs,
} from "@murphai/device-syncd/config";
import type {
  DeviceSyncJobFailureDiagnostic,
  DeviceSyncJobFailureEventOrigin,
} from "@murphai/device-syncd/types";
import {
  resolveDeviceSyncStoreNextJobWakeAt,
  resolveDeviceSyncStoreNextWakeAt,
  type DeviceSyncService,
} from "@murphai/device-syncd/service";
import { createDeviceSyncRegistry } from "@murphai/device-syncd/registry";
import {
  sanitizeHostedRuntimeDiagnosticText,
  type HostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";
import { evaluatePushPrimarySourceStaleness } from "@murphai/device-syncd/source-staleness";
import {
  pruneWearableDenseRawTimeseries,
} from "@murphai/core";
import type {
  HostedDeviceSyncDirtyProcessedPostCheckpointRecord,
  HostedAssistantRuntimeDeviceSyncConfig,
  HostedMaintenanceMetrics,
} from "./models.ts";
import {
  applyHostedPendingDirtyDeviceSyncStateForWake,
  fetchCompleteHostedDeviceSyncRuntimeSnapshot,
  reconcileHostedDeviceSyncControlPlaneState,
  promoteHostedCompletedDirtyPayloadAcks,
  resolveHostedDeviceSyncSchedulerAccountId,
  resolveHostedDeviceSyncWakeLocalAccountId,
  resolveHostedDeviceSyncWakeRecovery,
  syncHostedDeviceSyncControlPlaneState,
  type HostedDeviceSyncCompletedImportTiming,
  type HostedDeviceSyncRuntimeSyncState,
} from "../hosted-device-sync-runtime.ts";
import {
  HOSTED_DEVICE_SYNC_PASS_JOB_LIMIT,
} from "../hosted-device-sync-limits.ts";
import type {
  HostedRuntimeEvent,
} from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeDeviceSyncPort,
  HostedRuntimePlatform,
} from "./platform.ts";
import {
  toHostedRuntimeLogCode,
  writeHostedRuntimeLogBestEffort,
  writeHostedRuntimeLogEntriesBestEffort,
} from "./runtime-logs.ts";
import {
  closeHostedRuntimeDeviceSyncService,
  createHostedRuntimeDeviceSyncService,
  requireHostedRuntimeDeviceSyncStore,
} from "../device-sync-service.ts";
import {
  HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
  createHostedRuntimeWakeCandidate,
  selectHostedRuntimeWakeCandidate,
} from "./wake-candidates.ts";
import {
  setHostedDeviceSyncDenseRawRetentionMailboxWakeAt,
} from "./system-mailbox-state.ts";
import {
  hasHostedRuntimeJunctionPlatformEnv,
  resolveHostedRuntimeDeviceSyncProviderConfigs,
} from "./device-sync-provider-configs.ts";
import {
  createHostedBackgroundMaintenanceCancellation,
} from "./background-maintenance-cancellation.ts";

const HOSTED_DEVICE_SYNC_YIELDED_RETRY_DELAY_MS = 30_000;
const HOSTED_DEVICE_SYNC_JOB_FAILURE_DIAGNOSTIC_FALLBACK = "Hosted device-sync job failed.";
const HOSTED_DEVICE_SYNC_DENSE_RAW_RETENTION_MAX_FILES = 25;
const HOSTED_DEVICE_SYNC_DENSE_RAW_RETENTION_MAX_BYTES = 512 * 1024 * 1024;
const HOSTED_DEVICE_SYNC_FITBIT_CUTOVER_MAX_ATTEMPTS_PER_PASS = 4;
const HOSTED_DEVICE_SYNC_FITBIT_CUTOVER_RETRY_DELAY_MS = 30_000;
type HostedDeviceSyncMaintenanceStore = ReturnType<
  typeof requireHostedRuntimeDeviceSyncStore
>;
export async function runHostedDeviceSyncPass(
  wake: HostedRuntimeEvent,
  vaultRoot: string,
  deviceSyncConfig: HostedAssistantRuntimeDeviceSyncConfig | null,
  deviceSyncPort: HostedRuntimeDeviceSyncPort | null | undefined,
  timeoutMs: number | null,
  options: {
    platformEnv?: Readonly<Record<string, string>>;
    runtimeLogPlatform?: Pick<HostedRuntimePlatform, "logPort"> | null;
    retainFollowUpWakeUntilCheckpoint?: boolean;
    shouldYield?: (() => boolean) | null;
    skipDirtyPendingFetch?: boolean;
    signal?: AbortSignal | null;
    stagedDirtyAcks?: readonly HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] | null;
  } = {},
): Promise<{
  nextWakeAt: string | null;
  postCheckpointRecord: HostedMaintenanceMetrics["postCheckpointRecord"];
  processedJobs: number;
  skipped: boolean;
  stagedDirtyAcks?: HostedDeviceSyncDirtyProcessedPostCheckpointRecord[];
}> {
  const platformEnv = options.platformEnv ?? {};
  await writeHostedLegacyDeviceSyncPlatformEnvLog({
    deviceSyncConfig,
    platform: options.runtimeLogPlatform ?? null,
    platformEnv,
  });
  const shouldYield = createHostedDeviceSyncYieldPredicate(
    options.shouldYield ?? null,
    options.signal ?? null,
  );
  const startedAtMs = Date.now();
  if (shouldYieldHostedDeviceSync(shouldYield)) {
    return buildHostedDeviceSyncPreServiceYieldedPassResult(
      options.stagedDirtyAcks ?? null,
    );
  }

  let preloadedSnapshot: HostedExecutionDeviceSyncRuntimeSnapshotResponse | undefined;
  try {
    preloadedSnapshot = await preloadHostedDeviceSyncRuntimeSnapshot({
      deviceSyncConfig,
      deviceSyncPort,
      signal: options.signal ?? null,
    });
  } catch (error) {
    if (isHostedDeviceSyncAbortError(error, options.signal ?? null)) {
      return buildHostedDeviceSyncPreServiceYieldedPassResult(
        options.stagedDirtyAcks ?? null,
      );
    }
    throw error;
  }

  const service = createHostedDeviceSyncRuntime({
    deviceSyncConfig,
    deviceSyncPort,
    hasHostedConnections: (preloadedSnapshot?.connections.length ?? 0) > 0,
    memberProviderConfigs: preloadedSnapshot?.providerConfigs ?? {},
    platformEnv,
    shouldYield,
    vaultRoot,
  });

  if (!service) {
    if (deviceSyncConfig) {
      reportHostedDeviceSyncConfigMissing(wake);
    }

    return {
      nextWakeAt: null,
      postCheckpointRecord: null,
      processedJobs: 0,
      skipped: true,
    };
  }

  const secret = deviceSyncConfig?.secret ?? null;
  let syncState: HostedDeviceSyncRuntimeSyncState = {
    dirtyWorkRemaining: false,
    hostedToLocalAccountIds: new Map(),
    localToHostedAccountIds: new Map(),
    observedTokenVersions: new Map(),
    pendingDirtyAcks: [],
    pendingDirtyPayloadJobs: [],
    snapshot: null,
  };
  let controlPlaneSynced = false;
  let processedJobs = 0;

  try {
    await setHostedDeviceSyncDenseRawRetentionMailboxWakeAt({
      nextWakeAt: resolveHostedDeviceSyncYieldRetryAt(),
      userId: wake.userId,
      vaultRoot,
    });

    if (shouldYieldHostedDeviceSync(shouldYield)) {
      return buildHostedDeviceSyncYieldedPassResult({
        processedJobs: 0,
        retainFollowUpWakeUntilCheckpoint:
          options.retainFollowUpWakeUntilCheckpoint ?? false,
        service,
        stagedDirtyAcks: options.stagedDirtyAcks ?? null,
        wake,
      });
    }

    if (secret) {
      syncState = await syncHostedDeviceSyncControlPlaneState({
        deviceSyncPort,
        wake,
        secret,
        signal: options.signal ?? null,
        service,
        snapshot: preloadedSnapshot,
        skipDirtyPendingFetch: true,
        stagedDirtyAcks: options.stagedDirtyAcks ?? null,
      });
      controlPlaneSynced = true;
    }

    if (syncState.wakeSuperseded === true) {
      const stagedDirtyAcks = options.stagedDirtyAcks ?? [];
      return {
        nextWakeAt: resolveHostedDeviceSyncServiceNextWakeAt(service),
        postCheckpointRecord: null,
        processedJobs: 0,
        skipped: false,
        ...(stagedDirtyAcks.length > 0
          ? { stagedDirtyAcks: [...stagedDirtyAcks] }
          : {}),
      };
    }

    if (shouldYieldHostedDeviceSync(shouldYield)) {
      return buildHostedDeviceSyncYieldedPassResult({
        processedJobs: 0,
        retainFollowUpWakeUntilCheckpoint:
          options.retainFollowUpWakeUntilCheckpoint ?? false,
        service,
        syncState,
        wake,
      });
    }

    const schedulerAccountId = resolveHostedDeviceSyncSchedulerAccountId({
      state: syncState,
      wake,
    });
    if (schedulerAccountId) {
      await service.runSchedulerOnce(schedulerAccountId);
    }

    const wakeLocalAccountId = resolveHostedDeviceSyncWakeLocalAccountId({
      state: syncState,
      wake,
    });
    if (
      wakeLocalAccountId
      && options.skipDirtyPendingFetch !== true
      && deviceSyncPort
    ) {
      await applyHostedPendingDirtyDeviceSyncStateForWake({
        deviceSyncPort,
        service,
        signal: options.signal ?? null,
        stagedDirtyAcks: options.stagedDirtyAcks ?? null,
        state: syncState,
        wake,
      });
    }

    if (shouldYieldHostedDeviceSync(shouldYield)) {
      return buildHostedDeviceSyncYieldedPassResult({
        processedJobs: 0,
        retainFollowUpWakeUntilCheckpoint:
          options.retainFollowUpWakeUntilCheckpoint ?? false,
        service,
        syncState,
        wake,
      });
    }

    processedJobs = await drainHostedDeviceSyncWorker({
      accountId: wakeLocalAccountId,
      service,
      shouldYield,
    });
    const completedImports = promoteHostedCompletedDirtyPayloadAcks({
      service,
      state: syncState,
    }) ?? [];
    writeHostedDeviceSyncImportCompletedRuntimeLogs({
      completedImports,
      platform: options.runtimeLogPlatform ?? null,
    });
    await writeHostedDeviceSyncJobFailureRuntimeLogs({
      platform: options.runtimeLogPlatform ?? null,
      processedJobs,
      service,
      shouldYield,
      state: syncState,
      wake,
    });

    if (shouldYieldHostedDeviceSync(shouldYield)) {
      return buildHostedDeviceSyncYieldedPassResult({
        processedJobs,
        retainFollowUpWakeUntilCheckpoint:
          options.retainFollowUpWakeUntilCheckpoint ?? false,
        service,
        syncState,
        wake,
      });
    }

    await writeHostedDeviceSyncSourceStalledRuntimeLogs({
      platform: options.runtimeLogPlatform ?? null,
      service,
    });

    if (shouldYieldHostedDeviceSync(shouldYield)) {
      return buildHostedDeviceSyncYieldedPassResult({
        processedJobs,
        retainFollowUpWakeUntilCheckpoint:
          options.retainFollowUpWakeUntilCheckpoint ?? false,
        service,
        syncState,
        wake,
      });
    }

    const wakeRecovery = resolveHostedDeviceSyncWakeRecovery({
      service,
      state: syncState,
      wake,
    });
    if (secret && controlPlaneSynced) {
      await reconcileHostedDeviceSyncControlPlaneState({
        deferNextReconcileAtForLocalAccountId: wakeRecovery
          ? wakeLocalAccountId
          : null,
        deviceSyncPort,
        wake,
        secret,
        signal: options.signal ?? null,
        service,
        state: syncState,
      });
      await completeHostedDeviceSyncFitbitMigrations({
        deviceSyncPort,
        platform: options.runtimeLogPlatform ?? null,
        service,
        signal: options.signal ?? null,
        state: syncState,
      });
    }

    if (shouldYieldHostedDeviceSync(shouldYield)) {
      return buildHostedDeviceSyncYieldedPassResult({
        processedJobs,
        retainFollowUpWakeUntilCheckpoint:
          options.retainFollowUpWakeUntilCheckpoint ?? false,
        service,
        syncState,
        wake,
      });
    }

    const denseRawRetention = await runHostedDeviceSyncDenseRawRetention({
      deadlineMs: remainingHostedDeviceSyncDeadlineMs(startedAtMs, timeoutMs),
      platform: options.runtimeLogPlatform ?? null,
      processedJobs,
      shouldYield,
      vaultRoot,
    });

    if (shouldYieldHostedDeviceSync(shouldYield)) {
      return buildHostedDeviceSyncYieldedPassResult({
        processedJobs,
        retainFollowUpWakeUntilCheckpoint:
          options.retainFollowUpWakeUntilCheckpoint ?? false,
        service,
        syncState,
        wake,
      });
    }

    const serviceNextWakeAt = resolveHostedDeviceSyncServiceNextWakeAt(service);
    deferHostedPendingDirtyPayloadAcksUntil({
      nextWakeAt: serviceNextWakeAt,
      state: syncState,
    });
    const postCheckpointRecord = attachHostedDeviceSyncFollowUpWake({
      nextWakeAt: options.retainFollowUpWakeUntilCheckpoint === true
        ? serviceNextWakeAt
        : null,
      record: attachHostedDeviceSyncMailboxRetry({
        mailboxRetryAt: wakeRecovery?.retryAt ?? null,
        record: resolveHostedDeviceSyncDirtyPostCheckpointRecord({
          state: syncState,
        }),
        retainedWake: wakeRecovery?.wake ?? null,
      }),
    });
    const stagedDirtyAcks = listHostedDeviceSyncDirtyProcessedRecords({
      state: syncState,
    });

    const denseRawRetentionWakeAt = denseRawRetention.hasMore
      ? resolveHostedDeviceSyncYieldRetryAt()
      : null;
    await setHostedDeviceSyncDenseRawRetentionMailboxWakeAt({
      nextWakeAt: denseRawRetentionWakeAt,
      userId: wake.userId,
      vaultRoot,
    });

    return {
      nextWakeAt: earliestHostedMaintenanceWakeAt(
        serviceNextWakeAt,
        denseRawRetentionWakeAt,
      ),
      postCheckpointRecord,
      processedJobs,
      skipped: false,
      ...(stagedDirtyAcks.length > 0 ? { stagedDirtyAcks } : {}),
    };
  } catch (error) {
    if (isHostedDeviceSyncAbortError(error, options.signal ?? null)) {
      return buildHostedDeviceSyncYieldedPassResult({
        processedJobs,
        retainFollowUpWakeUntilCheckpoint:
          options.retainFollowUpWakeUntilCheckpoint ?? false,
        service,
        syncState,
        wake,
      });
    }
    throw error;
  } finally {
    closeHostedRuntimeDeviceSyncService(service);
  }
}

async function completeHostedDeviceSyncFitbitMigrations(input: {
  deviceSyncPort: HostedRuntimeDeviceSyncPort | null | undefined;
  platform: Pick<HostedRuntimePlatform, "logPort"> | null;
  service: DeviceSyncService;
  signal: AbortSignal | null;
  state: HostedDeviceSyncRuntimeSyncState;
}): Promise<void> {
  const completeFitbitMigration = input.deviceSyncPort?.completeFitbitMigration;
  if (!completeFitbitMigration) {
    return;
  }

  const store = requireHostedRuntimeDeviceSyncStore(input.service);
  const candidates: Array<{ hostedConnectionId: string; localAccountId: string }> = [];
  for (const [localAccountId, hostedConnectionId] of input.state.localToHostedAccountIds) {
    const sources = store.listConnectionSources({ connectionId: localAccountId });
    const { legacy } = resolveGoogleHealthFitbitMigrationSources(sources);
    if (
      !legacy
      || isGoogleHealthFitbitMigrationLegacyTerminal(legacy)
      || (
        legacy.lastErrorCode
          !== DEVICE_SYNC_SOURCE_DISCONNECT_IN_PROGRESS_ERROR_CODE
        && !isGoogleHealthFitbitMigrationCutoverReady({ sources })
      )
    ) {
      continue;
    }
    candidates.push({ hostedConnectionId, localAccountId });
  }

  const retryBucket = Math.floor(
    Date.now() / HOSTED_DEVICE_SYNC_FITBIT_CUTOVER_RETRY_DELAY_MS,
  );
  const rotationStart = candidates.length > 0 ? retryBucket % candidates.length : 0;
  const rotatedCandidates = [
    ...candidates.slice(rotationStart),
    ...candidates.slice(0, rotationStart),
  ];
  const attempts = rotatedCandidates.slice(
    0,
    HOSTED_DEVICE_SYNC_FITBIT_CUTOVER_MAX_ATTEMPTS_PER_PASS,
  );
  const deferred = rotatedCandidates[HOSTED_DEVICE_SYNC_FITBIT_CUTOVER_MAX_ATTEMPTS_PER_PASS];
  if (deferred) {
    scheduleHostedDeviceSyncFitbitMigrationRetry(store, deferred.localAccountId);
  }

  for (const candidate of attempts) {
    try {
      const outcome = await completeFitbitMigration.call(input.deviceSyncPort, {
        connectionId: candidate.hostedConnectionId,
        signal: input.signal,
      });
      if (outcome.status === "pending") {
        scheduleHostedDeviceSyncFitbitMigrationRetry(store, candidate.localAccountId);
      }
    } catch (error) {
      if (input.signal?.aborted) {
        throw input.signal.reason ?? error;
      }
      scheduleHostedDeviceSyncFitbitMigrationRetry(store, candidate.localAccountId);
      if (input.platform) {
        await writeHostedRuntimeLogBestEffort({
          entry: {
            component: "device-sync",
            eventCode: "device-sync.fitbit_migration_cutover_failed",
            level: "warn",
            phase: "invoke",
            redactedJson: {
              errorSummary: sanitizeHostedRuntimeDiagnosticText(errorToString(error))
                ?? "Fitbit migration cutover failed",
              provider: "junction",
              sourceProvider: JUNCTION_FITBIT_LEGACY_PROVIDER_SLUG,
            },
          },
          platform: input.platform,
        });
      }
    }
  }
}

function scheduleHostedDeviceSyncFitbitMigrationRetry(
  store: HostedDeviceSyncMaintenanceStore,
  localAccountId: string,
): void {
  const account = store.getAccountById(localAccountId);
  if (account?.status !== "active") {
    return;
  }
  const retryAt = new Date(
    Date.now() + HOSTED_DEVICE_SYNC_FITBIT_CUTOVER_RETRY_DELAY_MS,
  ).toISOString();
  store.patchAccount(account.id, {
    nextReconcileAt: earliestHostedMaintenanceWakeAt(
      account.nextReconcileAt ?? null,
      retryAt,
    ),
  });
}

function writeHostedDeviceSyncImportCompletedRuntimeLogs(input: {
  completedImports: readonly HostedDeviceSyncCompletedImportTiming[];
  platform: Pick<HostedRuntimePlatform, "logPort"> | null;
}): void {
  if (!input.platform?.logPort) {
    return;
  }

  for (const completed of input.completedImports) {
    const webhookToImportMs = nonnegativeDurationMs(
      completed.firstWebhookReceivedAt,
      completed.importCompletedAt,
    );
    const runtimeQueueMs = nonnegativeDurationMs(
      completed.jobCreatedAt,
      completed.importExecutionStartedAt,
    );
    const importExecutionMs = nonnegativeDurationMs(
      completed.importExecutionStartedAt,
      completed.importCompletedAt,
    );

    void writeHostedRuntimeLogBestEffort({
      entry: {
        at: completed.importCompletedAt,
        component: "device-sync",
        eventCode: "device-sync.import_completed",
        level: "info",
        phase: "invoke",
        redactedJson: {
          eventToProviderSendBucket: completed.eventToProviderSendBucket,
          jobKind: toHostedRuntimeLogCode(completed.jobKind),
          provider: toHostedRuntimeLogCode(completed.provider),
          ...(completed.sourceProvider === null
            ? {}
            : { sourceProvider: toHostedRuntimeLogCode(completed.sourceProvider) }),
          ...(completed.providerSendToWebhookMs === null
            ? {}
            : { providerSendToWebhookMs: completed.providerSendToWebhookMs }),
          ...(webhookToImportMs === null ? {} : { webhookToImportMs }),
          ...(runtimeQueueMs === null ? {} : { runtimeQueueMs }),
          ...(importExecutionMs === null ? {} : { importExecutionMs }),
        },
      },
      platform: input.platform,
    });
  }
}

function nonnegativeDurationMs(
  startAt: string | null,
  endAt: string | null,
): number | null {
  if (!startAt || !endAt) {
    return null;
  }
  const startMs = Date.parse(startAt);
  const endMs = Date.parse(endAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return null;
  }
  return endMs - startMs;
}

export function resolveHostedDeviceSyncNextWakeAt(input: {
  deviceSyncConfig: HostedAssistantRuntimeDeviceSyncConfig | null;
  platform?: Pick<HostedRuntimePlatform, "logPort"> | null;
  vaultRoot: string;
}): string | null {
  if (!input.deviceSyncConfig) {
    return null;
  }

  try {
    const nextJobWakeAt = resolveDeviceSyncStoreNextJobWakeAt({
      vaultRoot: input.vaultRoot,
    });
    const nextWakeAt = resolveDeviceSyncStoreNextWakeAt({
      vaultRoot: input.vaultRoot,
    });
    return selectHostedDeviceSyncServiceNextWakeAt({
      nextJobWakeAt,
      nextWakeAt,
    });
  } catch (error) {
    if (input.platform?.logPort) {
      void writeHostedRuntimeLogBestEffort({
        entry: {
          component: "device-sync",
          eventCode: "device-sync.wake_projection_failed",
          level: "warn",
          phase: "invoke",
          redactedJson: {
            errorSummary: sanitizeHostedRuntimeDiagnosticText(errorToString(error))
              ?? "device sync wake projection failed",
          },
        },
        platform: input.platform,
      });
    }
    return resolveHostedDeviceSyncYieldRetryAt();
  }
}

function createHostedDeviceSyncYieldPredicate(
  shouldYield: (() => boolean) | null,
  signal: AbortSignal | null,
): (() => boolean) | null {
  if (!shouldYield && !signal) {
    return null;
  }

  return () => signal?.aborted === true || shouldYield?.() === true;
}

function shouldYieldHostedDeviceSync(shouldYield: (() => boolean) | null): boolean {
  return shouldYield?.() === true;
}

function isHostedDeviceSyncAbortError(error: unknown, signal: AbortSignal | null): boolean {
  if (!signal?.aborted) {
    return false;
  }

  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (current === signal.reason) {
      return true;
    }
    if (current instanceof Error && current.name === "AbortError") {
      return true;
    }
    current = "cause" in current
      ? (current as { cause?: unknown }).cause
      : null;
  }

  return false;
}

function buildHostedDeviceSyncPreServiceYieldedPassResult(
  stagedDirtyAcks: readonly HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] | null,
): {
  nextWakeAt: string;
  postCheckpointRecord: null;
  processedJobs: 0;
  skipped: true;
  stagedDirtyAcks?: HostedDeviceSyncDirtyProcessedPostCheckpointRecord[];
} {
  return {
    nextWakeAt: resolveHostedDeviceSyncYieldRetryAt(),
    postCheckpointRecord: null,
    processedJobs: 0,
    skipped: true,
    ...(stagedDirtyAcks && stagedDirtyAcks.length > 0
      ? { stagedDirtyAcks: [...stagedDirtyAcks] }
      : {}),
  };
}

function resolveHostedDeviceSyncServiceNextWakeAt(
  service: DeviceSyncService,
): string | null {
  return selectHostedDeviceSyncServiceNextWakeAt({
    nextJobWakeAt: service.getNextJobWakeAt(),
    nextWakeAt: service.getNextWakeAt(),
  });
}

function selectHostedDeviceSyncServiceNextWakeAt(input: {
  nextJobWakeAt: string | null;
  nextWakeAt: string | null;
}): string | null {
  const { nextJobWakeAt, nextWakeAt } = input;
  if (!nextWakeAt || nextWakeAt === nextJobWakeAt) {
    return nextWakeAt;
  }

  const nextWakeMs = Date.parse(nextWakeAt);
  return Number.isFinite(nextWakeMs) && nextWakeMs > Date.now()
    ? nextWakeAt
    : nextJobWakeAt;
}

function buildHostedDeviceSyncYieldedPassResult(input: {
  processedJobs: number;
  retainFollowUpWakeUntilCheckpoint: boolean;
  service: DeviceSyncService;
  stagedDirtyAcks?: readonly HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] | null;
  syncState?: HostedDeviceSyncRuntimeSyncState | null;
  wake: HostedRuntimeEvent;
}): {
  nextWakeAt: string | null;
  postCheckpointRecord: HostedMaintenanceMetrics["postCheckpointRecord"];
  processedJobs: number;
  skipped: boolean;
  stagedDirtyAcks?: HostedDeviceSyncDirtyProcessedPostCheckpointRecord[];
} {
  const syncState = input.syncState ?? null;
  const nextWakeAt = resolveHostedDeviceSyncYieldRetryAt();
  if (syncState) {
    deferHostedPendingDirtyPayloadAcksUntil({
      nextWakeAt,
      state: syncState,
    });
  }
  const stagedDirtyAcks = syncState
    ? listHostedDeviceSyncDirtyProcessedRecords({ state: syncState })
    : input.stagedDirtyAcks ?? [];
  const wakeRecovery = syncState
    ? resolveHostedDeviceSyncWakeRecovery({
        service: input.service,
        state: syncState,
        wake: input.wake,
      })
    : null;
  const serviceNextWakeAt = resolveHostedDeviceSyncServiceNextWakeAt(input.service);
  return {
    nextWakeAt,
    postCheckpointRecord: syncState
      ? attachHostedDeviceSyncFollowUpWake({
          nextWakeAt: input.retainFollowUpWakeUntilCheckpoint
            ? serviceNextWakeAt
            : null,
          record: attachHostedDeviceSyncMailboxRetry({
            mailboxRetryAt: wakeRecovery ? nextWakeAt : null,
            record: resolveHostedDeviceSyncDirtyPostCheckpointRecord({ state: syncState }),
            retainedWake: wakeRecovery?.wake ?? null,
          }),
        })
      : null,
    processedJobs: input.processedJobs,
    skipped: true,
    ...(stagedDirtyAcks.length > 0
      ? { stagedDirtyAcks: [...stagedDirtyAcks] }
      : {}),
  };
}

function deferHostedPendingDirtyPayloadAcksUntil(input: {
  nextWakeAt: string | null;
  state: HostedDeviceSyncRuntimeSyncState;
}): void {
  if (!input.nextWakeAt || input.state.pendingDirtyPayloadJobs.length === 0) {
    return;
  }

  const pendingAckKeys = new Set(
    input.state.pendingDirtyPayloadJobs.map((pending) =>
      buildHostedDeviceSyncDirtyAckKey(pending.connectionId, pending.processedRevision)
    ),
  );
  for (const ack of input.state.pendingDirtyAcks) {
    if (!pendingAckKeys.has(buildHostedDeviceSyncDirtyAckKey(
      ack.connectionId,
      ack.processedRevision,
    ))) {
      continue;
    }
    ack.nextWakeAt = earliestHostedMaintenanceWakeAt(ack.nextWakeAt, input.nextWakeAt);
  }
}

function buildHostedDeviceSyncDirtyAckKey(
  connectionId: string,
  processedRevision: string,
): string {
  return `${connectionId}\0${processedRevision}`;
}

function resolveHostedDeviceSyncYieldRetryAt(now = new Date()): string {
  return new Date(now.getTime() + HOSTED_DEVICE_SYNC_YIELDED_RETRY_DELAY_MS).toISOString();
}

function remainingHostedDeviceSyncDeadlineMs(
  startedAtMs: number,
  timeoutMs: number | null,
): number | undefined {
  if (timeoutMs === null) {
    return undefined;
  }
  return Math.max(0, timeoutMs - (Date.now() - startedAtMs));
}

async function drainHostedDeviceSyncWorker(input: {
  accountId: string | null;
  service: DeviceSyncService;
  shouldYield?: (() => boolean) | null;
}): Promise<number> {
  if (!input.accountId) {
    return 0;
  }
  if (!input.shouldYield) {
    return await input.service.drainWorker(
      HOSTED_DEVICE_SYNC_PASS_JOB_LIMIT,
      input.accountId,
    );
  }

  let processedJobs = 0;
  for (let index = 0; index < HOSTED_DEVICE_SYNC_PASS_JOB_LIMIT; index += 1) {
    if (input.shouldYield()) {
      break;
    }
    const processed = await input.service.drainWorker(1, input.accountId);
    if (processed <= 0) {
      break;
    }
    processedJobs += processed;
    if (processed !== 1) {
      break;
    }
  }
  return processedJobs;
}

async function runHostedDeviceSyncDenseRawRetention(input: {
  deadlineMs?: number;
  platform: Pick<HostedRuntimePlatform, "logPort"> | null;
  processedJobs: number;
  shouldYield: (() => boolean) | null;
  vaultRoot: string;
}): Promise<{ hasMore: boolean }> {
  try {
    if (shouldYieldHostedDeviceSync(input.shouldYield) || input.deadlineMs === 0) {
      return {
        hasMore: true,
      };
    }

    const result = await pruneWearableDenseRawTimeseries({
      deadlineMs: input.deadlineMs,
      maxBytes: HOSTED_DEVICE_SYNC_DENSE_RAW_RETENTION_MAX_BYTES,
      maxFiles: HOSTED_DEVICE_SYNC_DENSE_RAW_RETENTION_MAX_FILES,
      vaultRoot: input.vaultRoot,
    });

    await writeHostedDeviceSyncDenseRawRetentionRuntimeLog({
      platform: input.platform,
      processedJobs: input.processedJobs,
      result,
    });

    return {
      hasMore: result.hasMore,
    };
  } catch (error) {
    await writeHostedDeviceSyncDenseRawRetentionFailureRuntimeLog({
      error,
      platform: input.platform,
      processedJobs: input.processedJobs,
    });
    return {
      hasMore: true,
    };
  }
}

/**
 * A push-primary source that has gone quiet is invisible everywhere else: the
 * provider still reports the connection healthy, and the pull floor cannot
 * distinguish "no data upstream" from "carrier dead". This is the only place
 * that silence becomes observable, so it is emitted on the pass that already
 * runs for the connection. A still-stale source is reported on every pass;
 * suppressing repeats belongs to the alerting layer, which knows its own read
 * cadence, rather than to this pass, which does not.
 */
async function writeHostedDeviceSyncSourceStalledRuntimeLogs(input: {
  platform: Pick<HostedRuntimePlatform, "logPort"> | null;
  service: DeviceSyncService;
}): Promise<void> {
  if (!input.platform?.logPort) {
    return;
  }

  const now = new Date().toISOString();

  // Reporting a stall must never cost the member their sync pass, so this stays
  // strictly best-effort: a failure here is logged and the pass continues.
  try {
    for (const account of input.service.listAccounts()) {
      if (account.status !== "active") {
        continue;
      }

      const stale = evaluatePushPrimarySourceStaleness({
        now,
        sources: (account.sources ?? []).map((source) => ({
          firstSeenAt: source.firstSeenAt,
          lastDataAt: source.lastDataAt,
          sourceProviderSlug: source.sourceProviderSlug,
          status: source.status,
        })),
      });

      for (const entry of stale) {
        await writeHostedRuntimeLogBestEffort({
          entry: {
            component: "device-sync",
            eventCode: "device-sync.source_stalled",
            level: "warn",
            phase: "invoke",
            redactedJson: {
              lastDataAt: entry.lastDataAt,
              provider: account.provider,
              reason: entry.reason,
              silentHours: entry.silentHours,
              silentSinceAt: entry.silentSinceAt,
              sourceProviderSlug: entry.sourceProviderSlug,
              thresholdHours: entry.thresholdHours,
            },
          },
          platform: input.platform,
        });
      }
    }
  } catch (error) {
    await writeHostedRuntimeLogBestEffort({
      entry: {
        component: "device-sync",
        eventCode: "device-sync.source_stalled",
        level: "warn",
        phase: "invoke",
        redactedJson: {
          errorSummary: sanitizeHostedRuntimeDiagnosticText(errorToString(error))
            ?? "source staleness evaluation failed",
          failed: true,
        },
      },
      platform: input.platform,
    });
  }
}

async function writeHostedDeviceSyncDenseRawRetentionRuntimeLog(input: {
  platform: Pick<HostedRuntimePlatform, "logPort"> | null;
  processedJobs: number;
  result: Awaited<ReturnType<typeof pruneWearableDenseRawTimeseries>>;
}): Promise<void> {
  if (!input.platform?.logPort) {
    return;
  }
  if (
    input.result.tombstonedDenseRawArtifactCount === 0
    && input.result.skippedCount === 0
    && input.result.denseRawBytesBefore === 0
    && !input.result.hasMore
  ) {
    return;
  }

  await writeHostedRuntimeLogBestEffort({
    entry: {
      component: "device-sync",
      eventCode: "device-sync.dense_raw_retention",
      level: "info",
      phase: "invoke",
      redactedJson: {
        denseRawAfterBytes: input.result.denseRawBytesAfter,
        denseRawBeforeBytes: input.result.denseRawBytesBefore,
        denseRawFreedBytes: input.result.denseRawBytesFreed,
        hasMore: input.result.hasMore,
        processedJobs: input.processedJobs,
        skippedCount: input.result.skippedCount,
        tombstonedDenseRawArtifactCount: input.result.tombstonedDenseRawArtifactCount,
      },
    },
    platform: input.platform,
  });
}

async function writeHostedDeviceSyncDenseRawRetentionFailureRuntimeLog(input: {
  error: unknown;
  platform: Pick<HostedRuntimePlatform, "logPort"> | null;
  processedJobs: number;
}): Promise<void> {
  if (!input.platform?.logPort) {
    return;
  }

  await writeHostedRuntimeLogBestEffort({
    entry: {
      component: "device-sync",
      eventCode: "device-sync.dense_raw_retention",
      level: "warn",
      phase: "invoke",
      redactedJson: {
        errorSummary: sanitizeHostedRuntimeDiagnosticText(errorToString(input.error))
          ?? "dense raw retention failed",
        failed: true,
        hasMore: true,
        processedJobs: input.processedJobs,
      },
    },
    platform: input.platform,
  });
}

function errorToString(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
}

export async function runHostedDeviceSyncWakeLane(input: {
  deviceSyncPort?: HostedRuntimeDeviceSyncPort | null;
  platformEnv?: Readonly<Record<string, string>>;
  retainFollowUpWakeUntilCheckpoint?: boolean;
  runtimeLogPlatform?: Pick<HostedRuntimePlatform, "logPort"> | null;
  shouldYieldDeviceSync?: (() => boolean) | null;
  signal?: AbortSignal | null;
  skipDirtyPendingFetch?: boolean;
  stagedDirtyAcks?: readonly HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] | null;
  wake: HostedRuntimeEvent;
  resolvedConfig: {
    deviceSync: HostedAssistantRuntimeDeviceSyncConfig | null;
  };
  timeoutMs: number | null;
  vaultRoot: string;
}): Promise<HostedMaintenanceMetrics> {
  const cancellation = createHostedBackgroundMaintenanceCancellation({
    signal: input.signal ?? null,
    shouldYield: input.shouldYieldDeviceSync ?? null,
    timeoutMs: input.timeoutMs,
  });

  try {
    const deviceSyncResult = await runHostedDeviceSyncPass(
      input.wake,
      input.vaultRoot,
      input.resolvedConfig.deviceSync,
      input.deviceSyncPort,
      input.timeoutMs,
      {
        platformEnv: input.platformEnv ?? {},
        retainFollowUpWakeUntilCheckpoint:
          input.retainFollowUpWakeUntilCheckpoint ?? false,
        runtimeLogPlatform: input.runtimeLogPlatform ?? null,
        shouldYield: input.shouldYieldDeviceSync ?? null,
        signal: cancellation.signal,
        skipDirtyPendingFetch: input.skipDirtyPendingFetch ?? false,
        stagedDirtyAcks: input.stagedDirtyAcks ?? null,
      },
    );
    const nextWake = selectHostedRuntimeWakeCandidate([
      createHostedRuntimeWakeCandidate(
        deviceSyncResult.nextWakeAt,
        HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
      ),
      createHostedRuntimeWakeCandidate(
        deviceSyncResult.postCheckpointRecord?.nextWakeAt ?? null,
        HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
      ),
    ]);

    return {
      deviceSyncProcessed: deviceSyncResult.processedJobs,
      deviceSyncSkipped: deviceSyncResult.skipped,
      nextWakeAt: nextWake.at,
      ...(nextWake.reason ? { nextWakeReason: nextWake.reason } : {}),
      parserProcessed: 0,
      postCheckpointRecord: deviceSyncResult.postCheckpointRecord ?? null,
      ...(deviceSyncResult.stagedDirtyAcks
        ? { stagedDirtyAcks: deviceSyncResult.stagedDirtyAcks }
        : {}),
    };
  } finally {
    cancellation.dispose();
  }
}

function resolveHostedDeviceSyncDirtyPostCheckpointRecord(input: {
  state: HostedDeviceSyncRuntimeSyncState;
}): HostedMaintenanceMetrics["postCheckpointRecord"] {
  const pendingDirtyAcks = input.state.pendingDirtyAcks;
  if (pendingDirtyAcks.length === 0) {
    return null;
  }

  if (pendingDirtyAcks.length === 1) {
    const [pendingDirtyAck] = pendingDirtyAcks;
    return {
      kind: "device-sync.dirty-processed",
      ...toHostedDeviceSyncDirtyProcessedPostCheckpointRecord(pendingDirtyAck),
    };
  }

  return {
    kind: "device-sync.dirty-processed-batch",
    nextWakeAt: pendingDirtyAcks.reduce<string | null>(
      (nextWakeAt, ack) => earliestHostedMaintenanceWakeAt(nextWakeAt, ack.nextWakeAt),
      null,
    ),
    records: pendingDirtyAcks.map(toHostedDeviceSyncDirtyProcessedPostCheckpointRecord),
  };
}

function attachHostedDeviceSyncMailboxRetry(input: {
  mailboxRetryAt: string | null;
  record: HostedMaintenanceMetrics["postCheckpointRecord"];
  retainedWake: Extract<HostedRuntimeEvent, { kind: "device-sync.wake" }> | null;
}): HostedMaintenanceMetrics["postCheckpointRecord"] {
  if (!input.mailboxRetryAt) {
    return input.record;
  }
  if (!input.record) {
    return {
      kind: "device-sync.dirty-processed-batch",
      retainMailboxItemUntil: input.mailboxRetryAt,
      ...(input.retainedWake ? { retainedWake: input.retainedWake } : {}),
      records: [],
    };
  }
  if (input.record.kind === "device-sync.dirty-processed") {
    const { kind: _kind, ...record } = input.record;
    return {
      kind: "device-sync.dirty-processed-batch",
      retainMailboxItemUntil: input.mailboxRetryAt,
      ...(input.retainedWake ? { retainedWake: input.retainedWake } : {}),
      records: [record],
    };
  }
  if (input.record.kind === "device-sync.dirty-processed-batch") {
    return {
      ...input.record,
      retainMailboxItemUntil: input.mailboxRetryAt,
      ...(input.retainedWake ? { retainedWake: input.retainedWake } : {}),
    };
  }
  throw new TypeError("Hosted device-sync mailbox retry received an unrelated checkpoint record.");
}

function attachHostedDeviceSyncFollowUpWake(input: {
  nextWakeAt: string | null;
  record: HostedMaintenanceMetrics["postCheckpointRecord"];
}): HostedMaintenanceMetrics["postCheckpointRecord"] {
  if (!input.nextWakeAt) {
    return input.record;
  }
  if (!input.record) {
    return {
      kind: "device-sync.dirty-processed-batch",
      nextWakeAt: input.nextWakeAt,
      records: [],
    };
  }
  if (
    input.record.kind === "device-sync.dirty-processed"
    || input.record.kind === "device-sync.dirty-processed-batch"
  ) {
    return {
      ...input.record,
      nextWakeAt: earliestHostedMaintenanceWakeAt(
        input.record.nextWakeAt ?? null,
        input.nextWakeAt,
      ),
    };
  }
  throw new TypeError(
    "Hosted device-sync follow-up wake received an unrelated checkpoint record.",
  );
}

function listHostedDeviceSyncDirtyProcessedRecords(input: {
  state: HostedDeviceSyncRuntimeSyncState;
}): HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] {
  return input.state.pendingDirtyAcks.map(toHostedDeviceSyncDirtyProcessedPostCheckpointRecord);
}

function toHostedDeviceSyncDirtyProcessedPostCheckpointRecord(
  ack: HostedDeviceSyncRuntimeSyncState["pendingDirtyAcks"][number],
): HostedDeviceSyncDirtyProcessedPostCheckpointRecord {
  return {
    ...(ack.completedImports
      ? { completedImports: ack.completedImports }
      : {}),
    connectionId: ack.connectionId,
    nextWakeAt: ack.nextWakeAt,
    ...(ack.processedDirtyPayloadIds
      ? { processedDirtyPayloadIds: ack.processedDirtyPayloadIds }
      : {}),
    processedRevision: ack.processedRevision,
  };
}

function earliestHostedMaintenanceWakeAt(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function reportHostedDeviceSyncConfigMissing(wake: HostedRuntimeEvent): void {
  emitHostedExecutionStructuredLog({
    component: "runtime",
    details: {
      eventCode: "dirty_state.device_sync_config_missing",
      reason: "device_sync_config_missing",
    },
    level: "warn",
    message: "Hosted device-sync dirty state skipped: dirty_state.device_sync_config_missing.",
    phase: "wake.running",
    wake,
  });
}

async function writeHostedDeviceSyncJobFailureRuntimeLogs(input: {
  platform: Pick<HostedRuntimePlatform, "logPort"> | null;
  processedJobs: number;
  service: HostedDeviceSyncRuntimeService;
  shouldYield: (() => boolean) | null;
  state: HostedDeviceSyncRuntimeSyncState;
  wake: HostedRuntimeEvent;
}): Promise<void> {
  if (!input.platform?.logPort) {
    return;
  }

  // This maintenance pass is the sole owner of per-attempt failure telemetry.
  // It records the worker diagnostic at the moment a job attempt fails, so the
  // event survives a later job success that clears account-level failure state
  // in the same drain. Webhook-triggered wakes and idle maintenance both reach
  // this writer through runHostedDeviceSyncPass.
  const failureDiagnostics = input.service.listJobFailureDiagnostics();
  if (failureDiagnostics.length === 0) {
    return;
  }

  const baselineByHostedConnectionId = new Map(
    (input.state.snapshot?.connections ?? []).map((entry) => [entry.connection.id, entry]),
  );
  const accountsByLocalAccountId = new Map(
    input.service.listAccounts().map((account) => [account.id, account]),
  );

  const entries = failureDiagnostics.map((failureDiagnostic) => {
    const account = accountsByLocalAccountId.get(failureDiagnostic.accountId) ?? null;
    const hostedConnectionId =
      input.state.localToHostedAccountIds.get(failureDiagnostic.accountId) ?? null;
    const baseline = hostedConnectionId
      ? baselineByHostedConnectionId.get(hostedConnectionId) ?? null
      : null;

    return {
      ...(failureDiagnostic.at ? { at: failureDiagnostic.at } : {}),
      component: "device-sync" as const,
      errorCode: toHostedRuntimeLogCode(failureDiagnostic.code),
      eventCode: "device-sync.job_failed" as const,
      level: "warn" as const,
      phase: "invoke" as const,
      redactedJson: buildHostedDeviceSyncFailureLogRedactedJson({
        account,
        baseline,
        failureDiagnostic,
        hostedConnectionKnown: Boolean(hostedConnectionId),
        processedJobs: input.processedJobs,
        wake: input.wake,
      }),
    };
  });
  await writeHostedRuntimeLogEntriesBestEffort({
    entries,
    platform: input.platform,
    shouldYieldBetweenBatches: input.shouldYield,
  });
}

async function writeHostedLegacyDeviceSyncPlatformEnvLog(input: {
  deviceSyncConfig: HostedAssistantRuntimeDeviceSyncConfig | null;
  platform: Pick<HostedRuntimePlatform, "logPort"> | null;
  platformEnv: Readonly<Record<string, string>>;
}): Promise<void> {
  if (!input.platform?.logPort || !input.deviceSyncConfig?.providerConfigs.junction) {
    return;
  }

  const legacyPlatformEnvKeyCount = Object.keys(input.platformEnv).length;
  const junctionPlatformEnvPresent = hasHostedRuntimeJunctionPlatformEnv(input.platformEnv);
  if (legacyPlatformEnvKeyCount === 0 || !junctionPlatformEnvPresent) {
    return;
  }

  await writeHostedRuntimeLogBestEffort({
    entry: {
      component: "device-sync",
      eventCode: "device-sync.legacy_platform_env_present",
      level: "info",
      phase: "invoke",
      redactedJson: {
        junctionPlatformEnvPresent,
        legacyPlatformEnvKeyCount,
      },
    },
    platform: input.platform,
  });
}

type HostedDeviceSyncRuntimeService = NonNullable<ReturnType<typeof createHostedDeviceSyncRuntime>>;
type HostedDeviceSyncRuntimeSnapshotEntry = NonNullable<HostedDeviceSyncRuntimeSyncState["snapshot"]>["connections"][number];

function buildHostedDeviceSyncFailureLogRedactedJson(input: {
  account: ReturnType<HostedDeviceSyncRuntimeService["listAccounts"]>[number] | null;
  baseline: HostedDeviceSyncRuntimeSnapshotEntry | null;
  failureDiagnostic: DeviceSyncJobFailureDiagnostic;
  hostedConnectionKnown: boolean;
  processedJobs: number;
  wake: HostedRuntimeEvent;
}): Record<string, boolean | number | string | null> {
  const summary = sanitizeHostedRuntimeDiagnosticText(
    input.failureDiagnostic.summary
      ?? (input.account && input.account.lastErrorCode === input.failureDiagnostic.code
        ? input.account.lastErrorMessage
        : null),
  );
  const priorLocalState = input.baseline?.localState ?? null;
  const provider = input.failureDiagnostic.provider ?? input.account?.provider ?? null;

  return {
    failureCode: toHostedRuntimeLogCode(input.failureDiagnostic.code),
    failureEventOrigin: "worker_attempt" satisfies DeviceSyncJobFailureEventOrigin,
    ...(input.failureDiagnostic.jobDisposition
      ? { failureDisposition: input.failureDiagnostic.jobDisposition }
      : {}),
    ...(typeof input.failureDiagnostic.attempts === "number"
      ? { failureJobAttempts: input.failureDiagnostic.attempts }
      : {}),
    ...(input.failureDiagnostic.jobKind
      ? { failureJobKind: toHostedRuntimeLogCode(input.failureDiagnostic.jobKind) }
      : {}),
    ...(typeof input.failureDiagnostic.maxAttempts === "number"
      ? { failureJobMaxAttempts: input.failureDiagnostic.maxAttempts }
      : {}),
    ...(typeof input.failureDiagnostic.remainingAttempts === "number"
      ? { failureJobRemainingAttempts: input.failureDiagnostic.remainingAttempts }
      : {}),
    ...(input.failureDiagnostic.resource
      ? { failureResource: toHostedRuntimeLogCode(input.failureDiagnostic.resource) }
      : {}),
    failureSummary: summary ?? HOSTED_DEVICE_SYNC_JOB_FAILURE_DIAGNOSTIC_FALLBACK,
    ...buildHostedDeviceSyncFailureDiagnosticRedactedJson(input.failureDiagnostic),
    hadPriorFailure: Boolean(priorLocalState?.lastSyncErrorAt),
    hadPriorSuccess: Boolean(priorLocalState?.lastSyncCompletedAt),
    hostedConnectionKnown: input.hostedConnectionKnown,
    nextReconcileAt: input.account?.nextReconcileAt ?? null,
    processedJobs: input.processedJobs,
    provider: provider ? toHostedRuntimeLogCode(provider) : null,
    setupPhase: input.account?.setupPhase ?? null,
    status: input.account ? toHostedRuntimeLogCode(input.account.status) : null,
    syncCompletedAt: input.account?.lastSyncCompletedAt ?? null,
    syncFailedAt: input.account?.lastSyncErrorAt ?? null,
    syncStartedAt: input.account?.lastSyncStartedAt ?? null,
    wakeKind: toHostedRuntimeLogCode(input.wake.kind),
    wakeReason: "reason" in input.wake
      ? toHostedRuntimeLogCode(input.wake.reason)
      : "runtime_timer",
  };
}

type DeviceSyncFailureDiagnosticDetails = DeviceSyncJobFailureDiagnostic["details"];
type DeviceSyncFailureDiagnosticStringField = {
  [Key in keyof DeviceSyncFailureDiagnosticDetails]: DeviceSyncFailureDiagnosticDetails[Key] extends string | undefined
    ? Key
    : never;
}[keyof DeviceSyncFailureDiagnosticDetails];
type DeviceSyncFailureDiagnosticNumberField = {
  [Key in keyof DeviceSyncFailureDiagnosticDetails]: DeviceSyncFailureDiagnosticDetails[Key] extends number | undefined
    ? Key
    : never;
}[keyof DeviceSyncFailureDiagnosticDetails];
type DeviceSyncFailureDiagnosticBooleanField = {
  [Key in keyof DeviceSyncFailureDiagnosticDetails]: DeviceSyncFailureDiagnosticDetails[Key] extends boolean | undefined
    ? Key
    : never;
}[keyof DeviceSyncFailureDiagnosticDetails];

const DEVICE_SYNC_FAILURE_DIAGNOSTIC_CODE_FIELDS = [
  "failureCauseCode",
  "failureCauseName",
  "failureErrorName",
  "normalizationFailureReason",
  "normalizationSourceProvider",
  "normalizationTimestampKind",
  "normalizationTimestampSemantics",
  "providerRequestAuthKind",
  "providerRequestAuthPlacement",
  "providerRequestBodyFieldNames",
  "providerRequestBodyKind",
  "providerRequestCandidateAliasSource",
  "providerRequestContentType",
  "providerRequestEndpointKind",
  "providerRequestMethod",
  "providerRequestQueryParameterNames",
  "providerResponseErrorCode",
  "providerResponseShapeKind",
  "providerOAuthErrorCode",
  "providerOAuthGrantType",
  "providerOAuthRequestBodyBuilderKind",
  "providerOAuthRequestClientAuthPlacement",
  "providerOAuthRequestContentType",
  "providerOAuthRequestEncodingKind",
  "providerOAuthRequestMethod",
  "providerOAuthRequestParameterNames",
  "providerOAuthRequestScopeValue",
  "providerOAuthRequestTokenEndpointKind",
  "providerOAuthResponseShapeKind",
] as const satisfies readonly DeviceSyncFailureDiagnosticStringField[];

const DEVICE_SYNC_FAILURE_DIAGNOSTIC_REASON_FIELDS = [
  "failureErrorCause",
  "providerHttpStatusText",
  "providerResponseErrorDescription",
  "providerOAuthErrorDescription",
] as const satisfies readonly DeviceSyncFailureDiagnosticStringField[];

const DEVICE_SYNC_FAILURE_DIAGNOSTIC_NUMBER_FIELDS = [
  "normalizationRowOrdinal",
  "providerHttpStatus",
  "providerRequestBodyFieldCount",
  "providerRequestCandidateCount",
  "providerRequestCandidateOrdinal",
  "providerRequestQueryParameterCount",
  "providerOAuthRequestDuplicateParameterCount",
  "providerOAuthRequestParameterCount",
  "providerOAuthRequestScopeCount",
] as const satisfies readonly DeviceSyncFailureDiagnosticNumberField[];

const DEVICE_SYNC_FAILURE_DIAGNOSTIC_BOOLEAN_FIELDS = [
  "providerRequestCredentialPresent",
  "providerResponseErrorDescriptionFieldPresent",
  "providerResponseErrorFieldPresent",
  "providerOAuthRequestClientCredentialPresent",
  "providerOAuthRequestClientIdPresent",
  "providerOAuthRequestHasDuplicateParameters",
  "providerOAuthRequestOfflineScopePresent",
  "providerOAuthRequestRefreshCredentialPresent",
  "providerOAuthRequestScopePresent",
  "providerOAuthResponseErrorDescriptionFieldPresent",
  "providerOAuthResponseErrorFieldPresent",
] as const satisfies readonly DeviceSyncFailureDiagnosticBooleanField[];

function buildHostedDeviceSyncFailureDiagnosticRedactedJson(
  diagnostic: DeviceSyncJobFailureDiagnostic,
): Record<string, boolean | number | string | null> {
  const redacted: Record<string, boolean | number | string | null> = {
    failureRetryable: diagnostic.retryable,
  };

  if (diagnostic.accountStatus) {
    redacted.providerAccountStatus = toHostedRuntimeLogCode(diagnostic.accountStatus);
  }

  for (const field of DEVICE_SYNC_FAILURE_DIAGNOSTIC_CODE_FIELDS) {
    appendHostedDeviceSyncFailureDiagnosticCode(redacted, field, diagnostic.details[field]);
  }

  for (const field of DEVICE_SYNC_FAILURE_DIAGNOSTIC_REASON_FIELDS) {
    appendHostedDeviceSyncFailureDiagnosticReason(redacted, field, diagnostic.details[field]);
  }

  for (const field of DEVICE_SYNC_FAILURE_DIAGNOSTIC_NUMBER_FIELDS) {
    appendHostedDeviceSyncFailureDiagnosticNumber(redacted, field, diagnostic.details[field]);
  }

  for (const field of DEVICE_SYNC_FAILURE_DIAGNOSTIC_BOOLEAN_FIELDS) {
    appendHostedDeviceSyncFailureDiagnosticBoolean(redacted, field, diagnostic.details[field]);
  }

  return redacted;
}

function appendHostedDeviceSyncFailureDiagnosticBoolean(
  redacted: Record<string, boolean | number | string | null>,
  key: string,
  value: boolean | undefined,
): void {
  if (value !== undefined) {
    redacted[key] = value;
  }
}

function appendHostedDeviceSyncFailureDiagnosticNumber(
  redacted: Record<string, boolean | number | string | null>,
  key: string,
  value: number | undefined,
): void {
  if (value === undefined) {
    return;
  }

  redacted[key] = value;
}

function appendHostedDeviceSyncFailureDiagnosticCode(
  redacted: Record<string, boolean | number | string | null>,
  key: string,
  value: string | undefined,
): void {
  if (!value) {
    return;
  }

  redacted[key] = toHostedRuntimeLogCode(value);
}

function appendHostedDeviceSyncFailureDiagnosticReason(
  redacted: Record<string, boolean | number | string | null>,
  key: string,
  value: string | undefined,
): void {
  if (!value) {
    return;
  }

  redacted[key] = sanitizeHostedRuntimeDiagnosticText(value)
    ?? HOSTED_DEVICE_SYNC_JOB_FAILURE_DIAGNOSTIC_FALLBACK;
}

async function preloadHostedDeviceSyncRuntimeSnapshot(input: {
  deviceSyncConfig: HostedAssistantRuntimeDeviceSyncConfig | null;
  deviceSyncPort: HostedRuntimeDeviceSyncPort | null | undefined;
  signal: AbortSignal | null;
}): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse | undefined> {
  if (!input.deviceSyncConfig || !input.deviceSyncPort) {
    return undefined;
  }

  return fetchCompleteHostedDeviceSyncRuntimeSnapshot({
    deviceSyncPort: input.deviceSyncPort,
    includeCredentialMaterial: true,
    signal: input.signal,
  });
}

function createHostedDeviceSyncRuntime(input: {
  deviceSyncConfig: HostedAssistantRuntimeDeviceSyncConfig | null;
  deviceSyncPort: HostedRuntimeDeviceSyncPort | null | undefined;
  hasHostedConnections: boolean;
  memberProviderConfigs: SerializableConfiguredDeviceSyncProviderConfigs;
  platformEnv: Readonly<Record<string, string>>;
  shouldYield?: (() => boolean) | null;
  vaultRoot: string;
}) {
  if (!input.deviceSyncConfig) {
    return null;
  }

  const registry = createDeviceSyncRegistry(
    createConfiguredDeviceSyncProvidersFromConfigs(
      resolveHostedRuntimeDeviceSyncProviderConfigs(
        input.deviceSyncConfig.providerConfigs,
        input.memberProviderConfigs,
        input.platformEnv,
      ),
    ),
  );

  if (registry.list().length === 0 && !input.hasHostedConnections) {
    return null;
  }

  return createHostedRuntimeDeviceSyncService({
    deviceSyncPort: input.deviceSyncPort,
    secret: input.deviceSyncConfig.secret,
    config: {
      publicBaseUrl: input.deviceSyncConfig.publicBaseUrl,
      shouldYieldJobExecution: input.shouldYield ?? null,
      vaultRoot: input.vaultRoot,
    },
    registry,
  });
}
