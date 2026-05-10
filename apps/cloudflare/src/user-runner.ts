import {
  HOSTED_MAILBOX_LANES,
  type HostedAiUsageAllowDecision,
  type HostedMailboxLane,
  type HostedMailboxLaneLag,
  type HostedRunnerNudgeResult,
  type HostedRunnerNudgeRequest,
  type HostedRuntimeRedactedJson,
  type HostedRunnerStatusResponse,
  type HostedRuntimeWebStatusResponse,
  type HostedWorkspaceReadResponse,
  type HostedWorkspaceInvocationReason,
  type HostedWorkspaceInvocationResult,
  type HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedExecutionSafeErrorDiagnostics,
  emitHostedExecutionStructuredLog,
  type HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";
import {
  parseHostedRuntimeWebStatusResponse,
  parseHostedWorkspaceReadResponse,
  readHostedExecutionSnapshotDeltaRef,
  readHostedExecutionSnapshotHotRef,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_STATUS_PATH,
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";
import type { R2BucketLike } from "./bundle-store.js";
import {
  hostedArtifactUserPrefix,
  hostedBrowserVaultReplicaUserPrefix,
  hostedBundleUserPrefix,
  hostedRunnerSecretsObjectKey,
} from "./storage-paths.js";
import type { HostedExecutionEnvironment } from "./env.js";
import { hostedEmailRawMessageUserPrefix } from "./hosted-email.ts";
import { toStringEnvSource } from "./string-env.js";
import {
  HostedUserCryptoRepairNeededError,
  isHostedUserCryptoContextExpired,
  requireHostedUserCryptoContextFromEnvironment,
  type HostedUserCryptoContext,
} from "./hosted-crypto/runtime-user-crypto-context.ts";
import {
  buildHostedRunnerContainerEnv,
  buildHostedRunnerJobRuntimeConfig,
} from "./runner-env.ts";
import {
  hasHostedRunnerModelCredential,
  isHostedRunnerOpenAiProvider,
} from "./hosted-env-policy.ts";
import {
  destroyHostedExecutionContainer,
  invokeHostedExecutionContainerRunner,
  refreshHostedExecutionContainerBrowserVaultReplica,
  resolveHostedExecutionRunnerContainerName,
  type HostedExecutionContainerNamespaceLike,
} from "./runner-container.js";
import { withSerializedLock } from "./serialized-lock.js";
import {
  fetchHostedExecutionWebControlPlaneResponse,
} from "./web-control-plane.ts";
import type {
  RunnerInvocationLease,
  RunnerStaleInvocationRecoveryResult,
} from "./user-runner/runner-state-store.js";
import {
  RunnerInvocationAlreadyActiveError,
} from "./user-runner/runner-state-store.js";
import { RunnerSecretsService } from "./user-runner/runner-secrets.js";
import { RunnerStateStore } from "./user-runner/runner-state-store.js";
import { RunnerRuntimeAlarmScheduler } from "./user-runner/runner-runtime-alarm-scheduler.js";
import type {
  DurableObjectStateLike,
  RunnerStateRecord,
} from "./user-runner/types.js";
import {
  HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND,
  type HostedExecutionWorkspaceInvocationJobInput,
} from "./runner-job-transport.js";
export type { DurableObjectStateLike } from "./user-runner/types.js";

const ACTIVE_INVOCATION_HEARTBEAT_STALE_MS = 3_000;
const ACTIVE_INVOCATION_RECOVERY_MIN_DELAY_MS = 1_000;
const DEFERRED_CHECKPOINT_DRAIN_DELAY_MS = 1_000;
const PENDING_NUDGE_DRAIN_CONTINUATION_DELAY_MS = 1_000;
const IMMEDIATE_NUDGE_FAILURE_RETRY_DELAY_MS = 1_000;
const NUDGE_FAILURE_RETRY_BACKOFF_MULTIPLIER = 2;
const NUDGE_FAILURE_RETRY_MAX_DELAY_MS = 8_000;
const STALE_LOCAL_ACTIVE_INVOCATION_ABORT_MESSAGE =
  "Hosted workspace invocation lost liveness during active work.";
const CONTAINER_STOPPED_ACTIVE_INVOCATION_ABORT_MESSAGE =
  "Hosted workspace invocation container stopped during active work.";
const BROWSER_VAULT_REFRESH_INTENT_STORAGE_KEY = "runner:pending-browser-vault-refresh:v1";
const BROWSER_VAULT_REFRESH_INTENT_SCHEMA = "murph.hosted-runner.browser-vault-refresh-intent.v1";
const BROWSER_VAULT_REFRESH_CONTINUATION_DELAY_MS = 1_000;
const BROWSER_VAULT_REFRESH_RETRY_MAX_DELAY_MS = 5 * 60_000;

export interface HostedRunnerUserDataDeletionResult {
  deletedAt: string;
  durableObject: {
    alarmCleared: boolean;
    stateDeleted: boolean;
  };
  ok: true;
  r2: {
    deletedObjectCount: number;
    skippedUserScopedPrefixes: boolean;
    supported: boolean;
    userScopedSkipReason: string | null;
  };
  userId: string;
}

export interface HostedBrowserVaultRefreshScheduleResult {
  accepted: true;
  scheduled: true;
  userId: string;
}

interface RunnerUserStores {
  crypto: HostedUserCryptoContext;
  runnerSecrets: RunnerSecretsService;
  userId: string;
}

interface RunnerDrainInput {
  aiUsageAllowDecision?: HostedAiUsageAllowDecision | null;
  dueWake?: boolean;
  idleCheckpointWorkspaceVersion?: string | null;
  reason: HostedWorkspaceInvocationReason;
}

interface ActiveWorkspaceInvocationAbort {
  attemptId: string;
  controller: AbortController;
  leaseGeneration: string;
  userId: string;
}

type BrowserVaultRefreshIntentReason = "external_request" | "idle_checkpoint_committed";

interface BrowserVaultRefreshIntent {
  failureCount: number;
  lastErrorCode: string | null;
  nextAttemptAt: string;
  pendingSince: string;
  reason: BrowserVaultRefreshIntentReason;
  schema: typeof BROWSER_VAULT_REFRESH_INTENT_SCHEMA;
  updatedAt: string;
  userId: string;
}

type BackgroundBrowserVaultRefreshOutcome =
  | {
      kind: "completed";
      status:
        | "already_fresh"
        | "publish_conflict"
        | "published"
        | "refresh_failed_too_large"
        | "refresh_skipped_no_source";
    }
  | {
      kind: "deferred";
      nextAttemptAt: string | null;
      reason: "foreground_work";
    }
  | {
      kind: "retryable";
      status:
        | "refresh_failed_empty_source"
        | "stale_source"
        | "workspace_missing";
    };

export interface HostedRunnerStuckInvocationTestResult {
  attemptId: string;
  nextWakeAt: string | null;
  ok: true;
}

class HostedRunnerUserDataDeletionRunnerStillActiveError extends Error {
  constructor() {
    super("Hosted runner container cleanup failed before user data deletion.");
    this.name = "HostedRunnerUserDataDeletionRunnerStillActiveError";
  }
}

export class HostedUserRunner {
  private readonly stateStore: RunnerStateStore;
  private readonly runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
  private readonly runtimeAlarmScheduler: RunnerRuntimeAlarmScheduler;
  private runnerStores: RunnerUserStores | null = null;
  private runtimeCryptoContextLock: Promise<void> | null = null;
  private invocationLock: Promise<void> | null = null;
  private activeWorkspaceInvocationAbort: ActiveWorkspaceInvocationAbort | null = null;
  private pendingRunnerDriveAfterInvocation: {
    aiUsageAllowDecision?: HostedAiUsageAllowDecision | null;
    reason: HostedWorkspaceInvocationReason;
    userId: string;
  } | null = null;

  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly env: HostedExecutionEnvironment,
    private readonly bucket: R2BucketLike,
    private readonly runnerRuntimeEnvSource: Readonly<Record<string, unknown>> = {},
    runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null = (
      state as {
        runnerContainerNamespace?: HostedExecutionContainerNamespaceLike;
      }
    ).runnerContainerNamespace ?? null,
  ) {
    this.runnerContainerNamespace = runnerContainerNamespace;
    this.stateStore = new RunnerStateStore(state);
    this.runtimeAlarmScheduler = new RunnerRuntimeAlarmScheduler(
      this.stateStore,
      state,
      () => this.readPendingBrowserVaultRefreshWakeAt(),
    );
  }

  private async ensureRunnerStores(userId?: string): Promise<RunnerUserStores> {
    const resolvedUserId = userId ?? await this.requireBoundUserId();

    if (
      this.runnerStores?.userId === resolvedUserId
      && !this.runtimeCryptoContextLock
      && !isHostedUserCryptoContextExpired(this.runnerStores.crypto)
    ) {
      return this.runnerStores;
    }

    return this.withRuntimeCryptoContextLock(async () => {
      if (
        this.runnerStores?.userId === resolvedUserId
        && !isHostedUserCryptoContextExpired(this.runnerStores.crypto)
      ) {
        return this.runnerStores;
      }

      return this.refreshRunnerStores(resolvedUserId);
    });
  }

  private async refreshRunnerStores(userId: string): Promise<RunnerUserStores> {
    const crypto = await requireHostedUserCryptoContextFromEnvironment({
      bucket: this.bucket,
      domain: "runtime",
      environment: this.env,
      reason: "runner-store-refresh",
      userId,
    });

    const stores: RunnerUserStores = {
      crypto,
      runnerSecrets: this.createRunnerSecretsService(crypto),
      userId,
    };

    this.runnerStores = stores;
    return stores;
  }

  async bindUser(userId: string): Promise<{ userId: string }> {
    await this.stateStore.bindUser(userId);
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      message: "Hosted runner bound user.",
      phase: "runtime.starting",
      userId,
    });
    return { userId };
  }

  async alarm(): Promise<void> {
    let record: RunnerStateRecord;
    try {
      record = await this.stateStore.readState();
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        error,
        level: "warn",
        message: "Hosted wake nudge could not read runner state; scheduling a retry.",
        phase: "wake.running",
        userId: null,
      });
      await this.scheduleHostedWakeRetryAlarm();
      return;
    }

    if (!record.userId) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        level: "warn",
        message: "Hosted wake nudge skipped because the runner is not bound yet.",
        phase: "wake.running",
        userId: record.userId ?? null,
      });
      await this.scheduleHostedWakeRetryAlarm();
      return;
    }

    if (await this.runPendingBrowserVaultRefreshBeforeFutureRunnerAlarm(record)) {
      return;
    }

    const dueAlarm = await this.stateStore.consumeDueRunnerAlarm(Date.now());
    record = dueAlarm.record;

    if (dueAlarm.kind === "idle_checkpoint" && !this.env.idleShutdownCheckpointsEnabled) {
      await this.stateStore.clearIdleShutdownCheckpoint();
      await this.runtimeAlarmScheduler.syncNextWake({
        preferredWakeAt: dueAlarm.checkpointNextWakeAt ?? record.nextWakeAt,
      });
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          runnerAlarmKind: dueAlarm.kind,
        },
        message: "Hosted runner skipped disabled idle-shutdown checkpoint alarm.",
        phase: "scheduled",
        userId: record.userId,
      });
      return;
    }

    if (dueAlarm.kind === "none") {
      if (record.inFlight) {
        await this.runUntilIdleOrBudget({
          reason: "alarm",
        });
        return;
      }
      if (await this.runDuePendingBrowserVaultRefreshFromAlarm(record.userId)) {
        return;
      }
      await this.runtimeAlarmScheduler.syncStoredAlarm();
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          runnerAlarmPresent: record.alarm !== null,
        },
        message: "Hosted runner alarm found no due work.",
        phase: "scheduled",
        userId: record.userId,
      });
      return;
    }

    const reason = dueAlarm.kind === "idle_checkpoint"
      ? "idle_shutdown_checkpoint"
      : record.pendingNudge
        ? "nudge"
        : "alarm";

    try {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          pendingNudge: record.pendingNudge,
          runnerAlarmKind: dueAlarm.kind,
          runnerNextWakePresent: record.nextWakeAt !== null,
        },
        message: "Hosted runner alarm starting workspace invocation.",
        phase: "wake.running",
        userId: record.userId,
      });
      await this.runUntilIdleOrBudget({
        dueWake: dueAlarm.kind === "work",
        idleCheckpointWorkspaceVersion: dueAlarm.kind === "idle_checkpoint"
          ? dueAlarm.idleWorkspaceVersion
          : null,
        reason,
      });
    } catch (error) {
      if (dueAlarm.kind === "idle_checkpoint") {
        const latestRecord = await this.stateStore.readState();
        const pendingWorkOwnsRecovery = latestRecord.pendingNudge || latestRecord.inFlight;
        if (pendingWorkOwnsRecovery) {
          await this.syncPendingWorkRecoveryAfterFailure(latestRecord);
        } else if (latestRecord.retryFailureCount === record.retryFailureCount) {
          const failedRecord = await this.stateStore.recordInvocationStartFailure({
            error,
            failedAt: new Date().toISOString(),
          });
          const retryDelayMs = resolveHostedRunnerFailureRetryDelayMs({
            defaultRetryDelayMs: this.env.retryDelayMs,
            reason: "idle_shutdown_checkpoint",
            retryFailureCount: failedRecord.retryFailureCount,
          });
          const retryScheduled = await this.scheduleIdleShutdownCheckpointRetry({
            retryDelayMs,
            workspaceVersion: dueAlarm.idleWorkspaceVersion,
          });
          if (!retryScheduled) {
            await this.runtimeAlarmScheduler.syncNextWake({
              preferredWakeAt: latestRecord.nextWakeAt,
            });
          }
        }
        if (pendingWorkOwnsRecovery) {
          emitHostedExecutionStructuredLog({
            component: "hosted.runner",
            details: {
              pendingNudge: latestRecord.pendingNudge,
              runnerInFlight: latestRecord.inFlight,
            },
            message: "Hosted idle-shutdown checkpoint failure cleanup yielded to pending work.",
            phase: "scheduled",
            userId: record.userId,
          });
        } else {
          await this.destroyIdleShutdownCheckpointContainerAfterFailureBestEffort({
            userId: record.userId,
          });
        }
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: buildHostedRunnerMetadataOnlyErrorDetails(error),
          level: "warn",
          message: "Hosted idle-shutdown checkpoint alarm failed; preserving idle checkpoint retry state.",
          phase: "wake.running",
          userId: record.userId,
        });
        return;
      }

      if (reason === "nudge") {
        await this.preservePendingNudgeRetryAfterFailure();
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: buildHostedRunnerMetadataOnlyErrorDetails(error),
          level: "warn",
          message: "Hosted wake nudge failed; pending nudge retry remains scheduled.",
          phase: "wake.running",
          userId: record.userId,
        });
        return;
      }

      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: buildHostedRunnerMetadataOnlyErrorDetails(error),
        level: "warn",
        message: "Hosted wake nudge failed; scheduling a retry.",
        phase: "wake.running",
        userId: record.userId,
      });
      await this.scheduleHostedWakeRetryAlarm({
        respectMaxAttempts: true,
        userId: record.userId,
      });
    }
  }

  async runnerStatus(input: { logLimit?: number } = {}): Promise<HostedRunnerStatusResponse> {
    const record = await this.stateStore.readState();
    const webStatus = await this.readHostedRuntimeStatusFromWeb(record.userId, {
      logLimit: input.logLimit,
    });
    const deferredCheckpointMailboxStatus = record.deferredCheckpointRequired
      ? record.deferredCheckpointMailboxStatus
      : null;
    const mailboxLag = mergeHostedRunnerDeferredCheckpointMailboxLag({
      mailboxLag: webStatus.mailboxLag,
      redactedStatus: deferredCheckpointMailboxStatus,
    });
    const workspace = mergeHostedRunnerDeferredCheckpointWorkspaceStatus({
      redactedStatus: deferredCheckpointMailboxStatus,
      workspace: webStatus.workspace,
    });

    return {
      ...webStatus,
      inFlight: this.invocationLock !== null || record.inFlight,
      ...(record.lastErrorAt ? { lastErrorAt: record.lastErrorAt } : {}),
      ...(record.lastErrorCode ? { lastErrorCode: record.lastErrorCode } : {}),
      ...(record.lastInvocationAt ? { lastInvocationAt: record.lastInvocationAt } : {}),
      nextAlarmAt: earliestIsoDate(
        earliestIsoDate(record.nextWakeAt, record.idleShutdownCheckpointDueAt),
        webStatus.workspace?.nextWakeAt ?? null,
      ),
      mailboxLag,
      userId: record.userId,
      workspace,
    };
  }

  async deleteHostedUserData(userId: string): Promise<HostedRunnerUserDataDeletionResult> {
    return this.withInvocationLock(async () => {
      if (this.runnerStores?.userId === userId) {
        this.runnerStores = null;
      }

      await this.stateStore.assertStateForUser(userId);
      const runnerCleanup = await this.stopRunnerBeforeUserDataDeletion(userId);
      const r2 = await this.deleteHostedUserR2DataBestEffort(userId);
      await this.state.storage.delete(BROWSER_VAULT_REFRESH_INTENT_STORAGE_KEY);
      const stateDeletion = await this.stateStore.deleteStateForUser(userId);
      const deleteAlarm = this.state.storage.deleteAlarm;
      const alarmCleared = typeof deleteAlarm === "function";
      if (alarmCleared) {
        await deleteAlarm.call(this.state.storage);
      }

      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          activeInvocationPreempted: runnerCleanup.activeInvocationPreempted,
          r2DeletedObjectCount: r2.deletedObjectCount,
          r2Supported: r2.supported,
          runnerContainerDestroyAttempted: runnerCleanup.runnerContainerDestroyAttempted,
          runnerContainerDestroyOk: runnerCleanup.runnerContainerDestroyOk,
          runnerStateDeleted: stateDeletion.deleted,
        },
        message: "Hosted runner user data deletion completed.",
        phase: "wake.running",
        userId,
      });

      return {
        deletedAt: new Date().toISOString(),
        durableObject: {
          alarmCleared,
          stateDeleted: stateDeletion.deleted,
        },
        ok: true,
        r2,
        userId,
      };
    });
  }

  private async stopRunnerBeforeUserDataDeletion(userId: string): Promise<{
    activeInvocationPreempted: boolean;
    runnerContainerDestroyAttempted: boolean;
    runnerContainerDestroyOk: boolean;
  }> {
    const preemption = await this.stateStore.clearActiveInvocationForUserDeletion(userId);
    const destroyed = await destroyHostedExecutionContainer({
      runnerContainerName: resolveHostedExecutionRunnerContainerName({
        source: this.runnerRuntimeEnvSource,
        userId,
      }),
      runnerContainerNamespace: this.runnerContainerNamespace,
      userId,
    });

    if (preemption.cleared) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          runnerContainerDestroyAttempted: destroyed.attempted,
          runnerContainerDestroyOk: destroyed.ok,
          workspaceAttemptId: preemption.attemptId,
        },
        level: destroyed.ok ? "info" : "warn",
        message: "Hosted runner preempted active invocation before user data deletion.",
        phase: "wake.running",
        userId,
      });
    }

    if (!destroyed.ok) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          runnerContainerDestroyAttempted: destroyed.attempted,
          runnerContainerDestroyErrorCode: destroyed.errorCode,
          workspaceAttemptId: preemption.attemptId,
        },
        level: "error",
        message: "Hosted runner user data deletion blocked because runner container cleanup failed.",
        phase: "wake.running",
        userId,
      });
      throw new HostedRunnerUserDataDeletionRunnerStillActiveError();
    }

    return {
      activeInvocationPreempted: preemption.cleared,
      runnerContainerDestroyAttempted: destroyed.attempted,
      runnerContainerDestroyOk: destroyed.ok,
    };
  }

  private async deleteHostedUserR2DataBestEffort(userId: string): Promise<HostedRunnerUserDataDeletionResult["r2"]> {
    try {
      return await this.deleteHostedUserR2Data(userId);
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          r2Supported: false,
          userScopedSkipReason: safeCleanupErrorCode(error),
        },
        error,
        level: "warn",
        message: "Hosted runner R2 user data deletion failed; continuing Durable Object cleanup.",
        phase: "wake.running",
        userId,
      });
      return {
        deletedObjectCount: 0,
        skippedUserScopedPrefixes: true,
        supported: false,
        userScopedSkipReason: safeCleanupErrorCode(error),
      };
    }
  }

  async nudgeHostedRunner(input: HostedRunnerNudgeRequest = {}): Promise<HostedRunnerNudgeResult> {
    const activeInThisIsolate = this.invocationLock !== null;
    let runningRecord = await this.stateStore.readState();
    if (!activeInThisIsolate && runningRecord.inFlight) {
      const recovery = await this.stateStore.clearStaleInvocationIfExpired({
        currentWorkerVersionId: this.currentWorkerVersionId,
        heartbeatStaleMs: ACTIVE_INVOCATION_HEARTBEAT_STALE_MS,
        nowMs: Date.now(),
        timeoutMs: this.env.runnerTimeoutMs,
      });
      runningRecord = recovery.record;
      if (recovery.cleared) {
        this.logStaleInvocationLeaseCleared(
          recovery.attemptId,
          runningRecord.userId,
          recovery.reason,
        );
      }
    }
    const alreadyRunning = activeInThisIsolate || runningRecord.inFlight;
    const nowMs = Date.now();
    const resetRetryFailureCount = runningRecord.retryFailureCount >= this.env.maxEventAttempts;
    const retryFailureCount = resetRetryFailureCount
      ? 0
      : runningRecord.retryFailureCount;
    const preferredWakeAt = activeInThisIsolate
      ? new Date(nowMs + PENDING_NUDGE_DRAIN_CONTINUATION_DELAY_MS).toISOString()
      : alreadyRunning
      ? resolvePendingNudgeDrainContinuationWakeAt({
          nowMs,
          record: runningRecord,
          runnerTimeoutMs: this.env.runnerTimeoutMs,
        })
      : new Date(nowMs + resolveHostedRunnerFailureRetryDelayMs({
          defaultRetryDelayMs: this.env.retryDelayMs,
          reason: "nudge",
          retryFailureCount,
        })).toISOString();
    const record = await this.markPendingNudgeAndApplyAlarm({
      preferredWakeAt,
      resetRetryFailureCount,
    });
    const preemptedActiveInvocation = false;
    let immediateDriveStarted = false;
    if (activeInThisIsolate) {
      immediateDriveStarted = this.queueOrStartRunnerDriveAfterInvocation({
        aiUsageAllowDecision: input.aiUsageAllowDecision ?? null,
        reason: "nudge",
        userId: record.userId,
      });
    } else if (!alreadyRunning) {
      immediateDriveStarted = this.startDetachedRunnerDrive({
        aiUsageAllowDecision: input.aiUsageAllowDecision ?? null,
        reason: "nudge",
        userId: record.userId,
      });
    }
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        alarmScheduled: record.nextWakeAt !== null,
        alreadyRunning,
        immediateDriveStarted,
        pendingNudge: record.pendingNudge,
        preemptedPersistedActiveInvocation: false,
        preemptedActiveInvocation,
        retryFailureCountReset: resetRetryFailureCount,
      },
      message: "Hosted runner nudge accepted.",
      phase: "scheduled",
      userId: runningRecord.userId,
    });

    return {
      accepted: true,
      alarmScheduled: record.nextWakeAt !== null,
      alreadyRunning,
      immediateDriveStarted,
      inFlight: alreadyRunning,
      nextAlarmAt: record.nextWakeAt,
    };
  }

  async nudgeHostedRunnerForUser(
    userId: string,
    input: HostedRunnerNudgeRequest = {},
  ): Promise<HostedRunnerNudgeResult> {
    await this.stateStore.bindUser(userId);
    return this.nudgeHostedRunner(input);
  }

  async scheduleBrowserVaultRefreshForUser(input: { userId: string }): Promise<HostedBrowserVaultRefreshScheduleResult> {
    await this.stateStore.bindUser(input.userId);
    await this.scheduleBrowserVaultRefreshBestEffort({
      reason: "external_request",
      userId: input.userId,
    });
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        scheduled: true,
      },
      message: "Hosted runner accepted browser-vault refresh schedule.",
      phase: "scheduled",
      userId: input.userId,
    });
    return {
      accepted: true,
      scheduled: true,
      userId: input.userId,
    };
  }

  async ownsActiveInvocationLease(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
    workspaceVersion?: string | null;
  }): Promise<boolean> {
    const result = await this.stateStore.ownsActiveInvocationLease(input);
    if (result.owns && result.clearedOrphanObservation) {
      await this.reschedulePendingNudgeAfterInvocationLiveness(result.record);
    }
    return result.owns;
  }

  async recordActiveInvocationHeartbeat(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
  }): Promise<
    | {
      inputAvailable: boolean;
      nextAlarmAt: string | null;
      ok: true;
      pendingNudge: boolean;
    }
    | {
      ok: false;
      reason:
        | "no_active_invocation"
        | "stale_attempt"
        | "stale_generation"
        | "wrong_user";
    }
  > {
    const result = await this.stateStore.recordActiveInvocationHeartbeat(input);
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason,
      };
    }

    const record = await this.reschedulePendingNudgeAfterInvocationLiveness(result.record)
      ?? result.record;
    return {
      inputAvailable: record.pendingNudge,
      nextAlarmAt: record.nextWakeAt,
      ok: true,
      pendingNudge: record.pendingNudge,
    };
  }

  async recordActiveInvocationContainerStopped(input: {
    attemptId: string;
    leaseGeneration: string;
    stoppedAt?: string | null;
    userId: string;
  }): Promise<{ recorded: boolean }> {
    const result = await this.stateStore.recordActiveInvocationContainerStopped(input);
    if (!result.recorded) {
      return { recorded: false };
    }
    const abortedLocalInvocation = this.abortActiveWorkspaceInvocationAfterContainerStop(input);
    const preferredWakeAt = new Date().toISOString();
    await this.runtimeAlarmScheduler.syncNextWake({ preferredWakeAt });
    if (abortedLocalInvocation && result.record?.pendingNudge) {
      this.queueOrStartRunnerDriveAfterInvocation({
        aiUsageAllowDecision: null,
        reason: "nudge",
        userId: input.userId,
      });
    }
    return { recorded: true };
  }

  async recordActiveInvocationWorkspaceCheckpoint(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
    workspaceVersion: string;
  }): Promise<{ recorded: boolean }> {
    const result = await this.stateStore.recordActiveInvocationWorkspaceCheckpoint(input);
    if (result.recorded && result.clearedOrphanObservation) {
      await this.reschedulePendingNudgeAfterInvocationLiveness(result.record);
    }
    return { recorded: result.recorded };
  }

  async runUntilIdleOrBudget(input: RunnerDrainInput): Promise<HostedWorkspaceInvocationResult> {
    if (this.invocationLock !== null) {
      const recovered = await this.recoverStaleLocalActiveInvocationForPendingWork();
      if (recovered) {
        return {
          nextWakeAt: recovered.nextWakeAt,
          status: "scheduled",
        };
      }

      const runningRecord = await this.stateStore.readState();
      const record = await this.syncInvocationRecoveryAlarm(runningRecord, {
        minimumDelayMs: ACTIVE_INVOCATION_RECOVERY_MIN_DELAY_MS,
      });
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          reason: input.reason,
        },
        message: "Hosted runner invocation already active; synced recovery wake.",
        phase: "scheduled",
        userId: record.userId,
      });
      return {
        nextWakeAt: record.nextWakeAt,
        status: "scheduled",
      };
    }

    return this.withInvocationLock(async () => this.runUntilIdleOrBudgetInternal(input));
  }

  async startStuckInvocationForTest(input: {
    reason?: HostedWorkspaceInvocationReason;
    userId: string;
  }): Promise<HostedRunnerStuckInvocationTestResult> {
    await this.stateStore.bindUser(input.userId);
    if (this.invocationLock !== null) {
      throw new Error("Hosted runner already has an active local invocation lock.");
    }

    const lease = await this.stateStore.beginInvocation({
      reason: input.reason ?? "manual",
      userId: input.userId,
      workerVersionId: this.currentWorkerVersionId,
    });
    await this.stateStore.ageActiveInvocationForTest({
      startedAt: "2000-01-01T00:00:00.000Z",
    });
    const record = await this.runtimeAlarmScheduler.syncNextWake({
      preferredWakeAt: new Date().toISOString(),
    });
    this.invocationLock = new Promise<void>(() => undefined);
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        workspaceAttemptId: lease.attemptId,
      },
      message: "Hosted runner started test-only stuck active invocation.",
      phase: "wake.running",
      userId: input.userId,
    });

    return {
      attemptId: lease.attemptId,
      nextWakeAt: record.nextWakeAt,
      ok: true,
    };
  }

  private async runUntilIdleOrBudgetInternal(input: RunnerDrainInput): Promise<HostedWorkspaceInvocationResult> {
    let initialRecord = await this.stateStore.readState();
    if (initialRecord.inFlight) {
      if (initialRecord.workspaceInvocation) {
        const recovery = await this.clearExpiredActiveInvocationForRecovery();
        initialRecord = recovery.record;
      }

      if (initialRecord.inFlight) {
        const record = await this.syncInvocationRecoveryAlarm(initialRecord);
        return {
          nextWakeAt: record.nextWakeAt,
          status: "scheduled",
        };
      }
    }

    const invocationReason = resolveHostedRunnerInvocationReason({
      record: initialRecord,
      requestedReason: input.reason,
    });

    if (!shouldRunHostedRunnerInvocation({
      dueWake: input.dueWake,
      idleShutdownCheckpointsEnabled: this.env.idleShutdownCheckpointsEnabled,
      reason: invocationReason,
      record: initialRecord,
    })) {
      const record = await this.runtimeAlarmScheduler.syncNextWake({
        preferredWakeAt: initialRecord.nextWakeAt,
      });
      return {
        nextWakeAt: record.nextWakeAt,
        status: "idle",
      };
    }

    let preflightWorkspaceRead: HostedWorkspaceReadResponse | null = null;
    if (invocationReason === "idle_shutdown_checkpoint") {
      const idlePreflight = await this.preflightIdleShutdownCheckpoint({
        expectedWorkspaceVersion: input.idleCheckpointWorkspaceVersion ?? null,
        record: initialRecord,
      });
      if (!idlePreflight.run) {
        return {
          nextWakeAt: idlePreflight.nextWakeAt,
          status: "idle",
        };
      }
      preflightWorkspaceRead = idlePreflight.workspaceRead;
    }

    let lease: RunnerInvocationLease;
    try {
      lease = await this.stateStore.beginInvocation({
        consumePendingNudge: invocationReason === "idle_shutdown_checkpoint" ? false : undefined,
        expiresAt: new Date(Date.now() + this.env.runnerTimeoutMs).toISOString(),
        reason: invocationReason,
        userId: initialRecord.userId,
        workerVersionId: this.currentWorkerVersionId,
      });
    } catch (error) {
      if (!(error instanceof RunnerInvocationAlreadyActiveError)) {
        throw error;
      }
      const record = await this.syncInvocationRecoveryAlarm(error.record, {
        minimumDelayMs: ACTIVE_INVOCATION_RECOVERY_MIN_DELAY_MS,
      });
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          reason: invocationReason,
        },
        message: "Hosted runner invocation already active; synced recovery wake.",
        phase: "scheduled",
        userId: record.userId,
      });
      return {
        nextWakeAt: record.nextWakeAt,
        status: "scheduled",
      };
    }
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        workspaceAttemptId: lease.attemptId,
        workspaceLeaseGeneration: lease.leaseGeneration,
        workspaceReason: invocationReason,
      },
      message: "Hosted runner workspace invocation started.",
      phase: "wake.running",
      userId: initialRecord.userId,
    });

    let workspaceVersion: string | null = null;
    try {
      if (invocationReason === "idle_shutdown_checkpoint") {
        const quietRecord = await this.stateStore.readState();
        if (quietRecord.pendingNudge) {
          const completion = await this.stateStore.completeInvocation({
            finishedAt: new Date().toISOString(),
            lease,
          });
          const record = await this.queuePendingNudgeContinuationAfterInvocation({
            record: completion.record,
            userId: initialRecord.userId,
          });
          emitHostedExecutionStructuredLog({
            component: "hosted.runner",
            details: {
              pendingNudge: true,
              workspaceAttemptId: lease.attemptId,
            },
            message: "Hosted runner skipped idle-shutdown checkpoint because work arrived before invocation.",
            phase: "scheduled",
            userId: initialRecord.userId,
          });
          return {
            nextWakeAt: record.nextWakeAt,
            status: "scheduled",
          };
        }
      }

      const workspaceRead = preflightWorkspaceRead
        ?? await this.readHostedWorkspaceFromWeb(initialRecord.userId);
      this.assertWorkspaceBelongsToRunnerUser(workspaceRead.workspace, initialRecord.userId);
      workspaceVersion = workspaceRead.workspace?.version ?? "0";
      lease = await this.stateStore.bindInvocationWorkspaceVersion({
        lease,
        workspaceVersion,
      });
      const result = await this.invokeWorkspaceRunner({
        checkpointNextWakeAt: invocationReason === "idle_shutdown_checkpoint"
          ? initialRecord.nextWakeAt
          : null,
        lease,
        reason: invocationReason,
        userId: initialRecord.userId,
        workspaceVersion,
      });
      const completion = await this.stateStore.completeInvocation({
        finishedAt: new Date().toISOString(),
        lease,
      });
      if (completion.completed) {
        if (invocationReason === "idle_shutdown_checkpoint") {
          await this.handleIdleShutdownCheckpointResult({
            result,
            userId: initialRecord.userId,
          });
        } else {
          try {
            await this.scheduleNextWorkspaceAlarm({
              fallbackNextWakeAt: result.nextWakeAt ?? null,
              result,
              resultStatus: result.status,
              userId: initialRecord.userId,
              workspaceVersion,
            });
          } catch (error) {
            if (result.deferredCheckpointRequired === true) {
              await this.stateStore.markDeferredCheckpointRequired({
                redactedStatus: result.redactedStatus ?? null,
              });
              await this.scheduleHostedWakeRetryAlarm({
                userId: initialRecord.userId,
              });
            } else {
              await this.runtimeAlarmScheduler.syncNextWake({
                preferredWakeAt: result.nextWakeAt ?? null,
              });
            }
            emitHostedExecutionStructuredLog({
              component: "hosted.runner",
              error,
              level: "warn",
              message: "Hosted runner post-completion alarm scheduling failed; invocation result preserved.",
              phase: "scheduled",
              userId: initialRecord.userId,
            });
          }
        }
      }
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          nextWakePresent: result.nextWakeAt !== null,
          workspaceAttemptId: lease.attemptId,
          workspaceStatus: result.status,
        },
        message: "Hosted runner workspace invocation completed.",
        phase: "checkpoint",
        userId: initialRecord.userId,
      });
      return result;
    } catch (error) {
      const failure = await this.stateStore.failInvocation({
        error,
        finishedAt: new Date().toISOString(),
        lease,
      });
      if (failure.failed) {
        const retryDelayMs = resolveHostedRunnerFailureRetryDelayMs({
          defaultRetryDelayMs: this.env.retryDelayMs,
          reason: invocationReason,
          retryFailureCount: failure.record.retryFailureCount,
        });
        const latestRecord = await this.stateStore.readState();
        if (latestRecord.pendingNudge) {
          await this.queuePendingNudgeContinuationAfterInvocation({
            record: latestRecord,
            userId: initialRecord.userId,
          });
        } else if (invocationReason === "nudge") {
          await this.preservePendingNudgeRetryAfterFailure({
            retryDelayMs,
          });
        } else if (
          invocationReason === "idle_shutdown_checkpoint"
          && input.idleCheckpointWorkspaceVersion
        ) {
          const retryScheduled = await this.scheduleIdleShutdownCheckpointRetry({
            retryDelayMs,
            workspaceVersion: input.idleCheckpointWorkspaceVersion,
          });
          if (!retryScheduled) {
            await this.runtimeAlarmScheduler.syncNextWake({
              preferredWakeAt: latestRecord.nextWakeAt,
            });
          }
        } else {
          await this.scheduleHostedWakeRetryAlarm({
            respectMaxAttempts: true,
            retryDelayMs,
            userId: initialRecord.userId,
          });
        }
      }
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          pendingNudgePresent: failure.record.pendingNudge || invocationReason === "nudge",
          retryFailureCount: failure.record.retryFailureCount,
          workspaceAttemptId: lease.attemptId,
          workspaceLeaseGeneration: lease.leaseGeneration,
          workspaceReason: invocationReason,
          workspaceVersion,
        },
        level: "warn",
        message: "Hosted runner workspace invocation failed.",
        phase: "failed",
        userId: initialRecord.userId,
      });
      throw error;
    }
  }

  private async deleteHostedUserR2Data(userId: string): Promise<HostedRunnerUserDataDeletionResult["r2"]> {
    const supportsObjectDeletion = Boolean(this.bucket.delete);
    const supportsPrefixDeletion = Boolean(this.bucket.delete && this.bucket.list);
    let userCrypto: HostedUserCryptoContext | null = null;
    const userScopedSkipReasons: string[] = [];

    try {
      userCrypto = await requireHostedUserCryptoContextFromEnvironment({
        bucket: this.bucket,
        domain: "runtime",
        environment: this.env,
        reason: "account-data-deletion",
        userId,
      });
    } catch (error) {
      if (!(error instanceof HostedUserCryptoRepairNeededError)) {
        throw error;
      }
      userScopedSkipReasons.push(error instanceof Error && error.name ? error.name : "UnknownError");
    }

    let deletedObjectCount = 0;
    if (supportsPrefixDeletion) {
      if (userCrypto) {
        const prefixes = [
          await hostedBundleUserPrefix({ userId }),
          await hostedArtifactUserPrefix({ userId }),
          await hostedBrowserVaultReplicaUserPrefix({ userId }),
        ];
        for (const prefix of prefixes) {
          deletedObjectCount += (await deleteR2ObjectsWithPrefix(this.bucket, prefix)).deletedCount;
        }

        deletedObjectCount += (await deleteR2ObjectIfSupported(
          this.bucket,
          await hostedRunnerSecretsObjectKey({ userId }),
        )).deletedCount;

        // Domain-root envelopes are canonical in web-owned Postgres. Cloudflare
        // deletes only the user-scoped runtime blobs that it stores in R2.
      } else {
        userScopedSkipReasons.push("RuntimeCryptoContextUnavailable");
      }

      deletedObjectCount += (await deleteR2ObjectsWithPrefix(
        this.bucket,
        await hostedEmailRawMessageUserPrefix({ userId }),
      )).deletedCount;
    } else if (userCrypto) {
      userScopedSkipReasons.push("R2PrefixDeletionUnsupported");
    }

    const skippedUserScopedPrefixes =
      !supportsPrefixDeletion || userCrypto === null;
    return {
      deletedObjectCount,
      skippedUserScopedPrefixes,
      supported: supportsObjectDeletion && supportsPrefixDeletion,
      userScopedSkipReason: skippedUserScopedPrefixes
        ? Array.from(new Set(userScopedSkipReasons)).join(",") || null
        : null,
    };
  }

  private async markPendingNudgeAndApplyAlarm(input: {
    preferredWakeAt?: string | null;
    resetRetryFailureCount?: boolean;
  } = {}): Promise<RunnerStateRecord> {
    const record = await this.stateStore.markPendingInvocationNudge({
      preferredWakeAt: input.preferredWakeAt,
      resetRetryFailureCount: input.resetRetryFailureCount,
    });
    if (record.nextWakeAt) {
      await this.state.storage.setAlarm(new Date(record.nextWakeAt));
    }
    return record;
  }

  private async preservePendingNudgeRetryAfterFailure(input: {
    retryDelayMs?: number;
  } = {}): Promise<void> {
    const record = await this.tryReadStateForRetryScheduling();
    const retryFailureCount = record?.retryFailureCount ?? 0;
    const pendingNudgeRetryDelayMs = resolvePendingNudgeFailureRetryDelayMs({
      defaultRetryDelayMs: this.env.retryDelayMs,
      retryFailureCount,
    });
    const retryDelayMs = Math.min(
      input.retryDelayMs ?? pendingNudgeRetryDelayMs,
      pendingNudgeRetryDelayMs,
    );
    const retryWakeAt = new Date(Date.now() + retryDelayMs).toISOString();
    if (
      record?.pendingNudge
      && record.nextWakeAt
      && isHostedRunnerWakeAtNoLaterThan(record.nextWakeAt, retryWakeAt)
    ) {
      await this.runtimeAlarmScheduler.syncStoredAlarm();
      return;
    }

    await this.markPendingNudgeAndApplyAlarm({
      preferredWakeAt: retryWakeAt,
    });
  }

  private async syncPendingWorkRecoveryAfterFailure(
    record: RunnerStateRecord,
  ): Promise<void> {
    if (record.pendingNudge) {
      await this.preservePendingNudgeRetryAfterFailure();
      return;
    }
    if (record.inFlight) {
      await this.syncInvocationRecoveryAlarm(record, {
        minimumDelayMs: ACTIVE_INVOCATION_RECOVERY_MIN_DELAY_MS,
      });
      return;
    }
    await this.runtimeAlarmScheduler.syncStoredAlarm();
  }

  private async reschedulePendingNudgeAfterInvocationLiveness(
    record: RunnerStateRecord,
  ): Promise<RunnerStateRecord | null> {
    if (!record.pendingNudge) {
      return null;
    }

    const activeRecord = record.idleShutdownCheckpointDueAt
      ? await this.stateStore.clearIdleShutdownCheckpoint()
      : record;
    const nowMs = Date.now();
    return await this.runtimeAlarmScheduler.syncNextWake({
      preferredWakeAt: resolvePendingNudgeWakeAt({
        nowMs,
        record: activeRecord,
        runnerTimeoutMs: this.env.runnerTimeoutMs,
      }),
    });
  }

  private async syncInvocationRecoveryAlarm(
    inputRecord: RunnerStateRecord,
    input: {
      minimumDelayMs?: number;
    } = {},
  ): Promise<RunnerStateRecord> {
    const nowMs = Date.now();
    const minimumDelayMs = inputRecord.idleShutdownCheckpointDueAt
      ? Math.max(
          input.minimumDelayMs ?? 0,
          ACTIVE_INVOCATION_RECOVERY_MIN_DELAY_MS,
        )
      : input.minimumDelayMs ?? 0;
    const preferredWakeAt = resolvePendingNudgeWakeAt({
      nowMs,
      record: inputRecord,
      runnerTimeoutMs: this.env.runnerTimeoutMs,
    });
    const wakeAt = applyMinimumFutureWakeAt({
      minimumDelayMs,
      nowMs,
      wakeAt: preferredWakeAt,
    });
    if (inputRecord.idleShutdownCheckpointDueAt) {
      if (
        inputRecord.pendingNudge
        || !inputRecord.idleShutdownCheckpointWorkspaceVersion
      ) {
        await this.stateStore.clearIdleShutdownCheckpoint();
      } else {
        const record = await this.stateStore.scheduleIdleShutdownCheckpoint({
          checkpointNextWakeAt: wakeAt,
          dueAt: resolvePreemptingIdleShutdownCheckpointDueAt({
            nextWakeAt: wakeAt,
            nowMs,
          }),
          workspaceVersion: inputRecord.idleShutdownCheckpointWorkspaceVersion,
        });
        await this.runtimeAlarmScheduler.syncStoredAlarm();
        return record;
      }
    }
    return await this.runtimeAlarmScheduler.syncNextWake({
      preferredWakeAt: wakeAt,
    });
  }

  private async syncRunnerFollowUpAfterInvocation(input: {
    record: RunnerStateRecord;
    userId: string;
  }): Promise<RunnerStateRecord> {
    // Keep the runner follow-up policy centralized: pending nudges own
    // mailbox-lag continuation/clear, in-flight work owns recovery, and quiet
    // records leave ordinary wake or idle-checkpoint scheduling to the caller.
    let record = input.record;
    if (record.pendingNudge) {
      record = await this.queuePendingNudgeContinuationAfterInvocation(input);
      if (record.pendingNudge) {
        return record;
      }
    }

    if (record.inFlight) {
      return await this.syncInvocationRecoveryAlarm(record);
    }

    return record;
  }

  private async queuePendingNudgeContinuationAfterInvocation(input: {
    record: RunnerStateRecord;
    userId: string;
  }): Promise<RunnerStateRecord> {
    const record = await this.clearStalePendingNudgeIfMailboxLagDrainedBestEffort(input);
    if (!record.pendingNudge) {
      return record;
    }

    this.pendingRunnerDriveAfterInvocation = {
      aiUsageAllowDecision: null,
      reason: "nudge",
      userId: input.userId,
    };

    if (record.idleShutdownCheckpointDueAt) {
      await this.stateStore.clearIdleShutdownCheckpoint();
    }

    return await this.runtimeAlarmScheduler.syncNextWake({
      preferredWakeAt: new Date(
        Date.now() + PENDING_NUDGE_DRAIN_CONTINUATION_DELAY_MS,
      ).toISOString(),
    });
  }

  private async clearStalePendingNudgeIfMailboxLagDrainedBestEffort(input: {
    record: RunnerStateRecord;
    userId: string;
  }): Promise<RunnerStateRecord> {
    if (!input.record.pendingNudge) {
      return input.record;
    }

    try {
      const webStatus = await this.readHostedRuntimeStatusFromWeb(input.userId);
      const mailboxLag = mergeHostedRunnerDeferredCheckpointMailboxLag({
        mailboxLag: webStatus.mailboxLag,
        redactedStatus: input.record.deferredCheckpointRequired
          ? input.record.deferredCheckpointMailboxStatus
          : null,
      });
      if (!hostedRunnerMailboxLagDrained(mailboxLag)) {
        return input.record;
      }

      const record = await this.stateStore.clearPendingInvocationNudge({
        expectedPendingNudgeGeneration: input.record.pendingNudgeGeneration,
      });
      if (record.pendingNudge) {
        return record;
      }

      this.pendingRunnerDriveAfterInvocation = null;
      await this.runtimeAlarmScheduler.syncStoredAlarm();
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          mailboxLagDrained: true,
          pendingNudgeCleared: true,
        },
        message: "Hosted runner cleared stale pending nudge after mailbox lag drained.",
        phase: "scheduled",
        userId: input.userId,
      });
      return record;
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: buildHostedRunnerMetadataOnlyErrorDetails(error),
        level: "warn",
        message: "Hosted runner could not verify pending nudge mailbox lag before follow-up.",
        phase: "scheduled",
        userId: input.userId,
      });
      return input.record;
    }
  }

  private async clearExpiredActiveInvocationForRecovery(): Promise<
    RunnerStaleInvocationRecoveryResult
  > {
    const recovery = await this.stateStore.clearStaleInvocationIfExpired({
      currentWorkerVersionId: this.currentWorkerVersionId,
      heartbeatStaleMs: ACTIVE_INVOCATION_HEARTBEAT_STALE_MS,
      nowMs: Date.now(),
      timeoutMs: this.env.runnerTimeoutMs,
    });
    if (recovery.cleared) {
      this.logStaleInvocationLeaseCleared(
        recovery.attemptId,
        recovery.record.userId,
        recovery.reason,
      );
    }
    return recovery;
  }

  private async recoverStaleLocalActiveInvocationForPendingWork(): Promise<
    RunnerStateRecord | null
  > {
    const active = this.activeWorkspaceInvocationAbort;
    if (!active) {
      return null;
    }

    const record = await this.stateStore.readState();
    if (!this.shouldRecoverStaleLocalActiveInvocation(record, active)) {
      return null;
    }

    const recovery = await this.clearExpiredActiveInvocationForRecovery();
    if (!recovery.cleared) {
      return null;
    }

    const aborted = this.abortActiveWorkspaceInvocation(
      {
        attemptId: active.attemptId,
        leaseGeneration: active.leaseGeneration,
        userId: active.userId,
      },
      new Error(STALE_LOCAL_ACTIVE_INVOCATION_ABORT_MESSAGE),
    );
    if (recovery.record.pendingNudge) {
      const queuedRecord = await this.queuePendingNudgeContinuationAfterInvocation({
        record: recovery.record,
        userId: recovery.record.userId,
      });
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          activeWorkspaceInvocationAborted: aborted,
          pendingNudge: true,
          workspaceAttemptId: active.attemptId,
        },
        level: "warn",
        message: "Hosted runner cleared stale local invocation so pending nudge can drain.",
        phase: "scheduled",
        userId: recovery.record.userId,
      });
      return queuedRecord;
    }

    await this.syncPendingWorkRecoveryAfterFailure(recovery.record);
    return recovery.record;
  }

  private shouldRecoverStaleLocalActiveInvocation(
    record: RunnerStateRecord,
    active: ActiveWorkspaceInvocationAbort,
  ): boolean {
    const invocation = record.workspaceInvocation;
    if (
      !record.inFlight
      || !invocation
      || invocation.attemptId !== active.attemptId
      || record.leaseGeneration.toString() !== active.leaseGeneration
      || record.userId !== active.userId
      || active.controller.signal.aborted
    ) {
      return false;
    }

    const nowMs = Date.now();
    const lastHeartbeatAtMs = invocation.lastHeartbeatAt
      ? Date.parse(invocation.lastHeartbeatAt)
      : Number.NaN;
    if (Number.isFinite(lastHeartbeatAtMs)) {
      return nowMs - lastHeartbeatAtMs >= ACTIVE_INVOCATION_HEARTBEAT_STALE_MS;
    }

    const startedAtMs = Date.parse(invocation.startedAt);
    return Number.isFinite(startedAtMs)
      && nowMs - startedAtMs >= this.env.runnerReadyTimeoutMs;
  }

  private abortActiveWorkspaceInvocation(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
  }, reason: unknown): boolean {
    const active = this.activeWorkspaceInvocationAbort;
    if (
      !active
      || active.attemptId !== input.attemptId
      || active.leaseGeneration !== input.leaseGeneration
      || active.userId !== input.userId
      || active.controller.signal.aborted
    ) {
      return false;
    }

    active.controller.abort(reason);
    return true;
  }

  private abortActiveWorkspaceInvocationAfterContainerStop(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
  }): boolean {
    return this.abortActiveWorkspaceInvocation(
      input,
      new Error(CONTAINER_STOPPED_ACTIVE_INVOCATION_ABORT_MESSAGE),
    );
  }

  private logStaleInvocationLeaseCleared(
    attemptId: string | null,
    userId: string,
    reason: "container_stopped" | "expired" | "worker_version_mismatch",
  ): void {
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        workspaceAttemptId: attemptId,
      },
      level: "warn",
      message: reason === "worker_version_mismatch"
        ? "Hosted workspace invocation belonged to a previous worker version; clearing stale in-flight state."
        : reason === "container_stopped"
        ? "Hosted workspace invocation container stopped; clearing stale in-flight state."
        : "Hosted workspace invocation lease expired; clearing stale in-flight state.",
      phase: "wake.running",
      userId,
    });
  }

  private get currentWorkerVersionId(): string | null {
    return readHostedWorkerVersionIdFromSource(this.runnerRuntimeEnvSource);
  }

  private async readHostedRuntimeStatusFromWeb(
    userId: string,
    input: { logLimit?: number } = {},
  ): Promise<HostedRuntimeWebStatusResponse> {
    const response = await fetchHostedExecutionWebControlPlaneResponse({
      ...(this.env.hostedWebAllowHttpHosts
        ? { allowHttpHosts: this.env.hostedWebAllowHttpHosts }
        : {}),
      baseUrl: this.readHostedWebControlBaseUrl(),
      boundUserId: userId,
      callbackSigning: this.env.webCallbackSigning,
      method: "GET",
      path: HOSTED_RUNTIME_STATUS_PATH,
      search: input.logLimit ? `?logLimit=${input.logLimit}` : null,
      timeoutMs: this.env.webControlTimeoutMs,
    });

    if (!response.ok) {
      throw new Error(`Hosted runtime status read failed with HTTP ${response.status}.`);
    }

    const status = parseHostedRuntimeWebStatusResponse(await response.json());
    if (status.userId !== userId) {
      throw new Error("Hosted runtime status read returned a different user.");
    }
    this.assertWorkspaceBelongsToRunnerUser(status.workspace, userId);
    return status;
  }

  private async readHostedWorkspaceFromWeb(
    userId: string,
  ): Promise<HostedWorkspaceReadResponse> {
    const response = await fetchHostedExecutionWebControlPlaneResponse({
      ...(this.env.hostedWebAllowHttpHosts
        ? { allowHttpHosts: this.env.hostedWebAllowHttpHosts }
        : {}),
      baseUrl: this.readHostedWebControlBaseUrl(),
      boundUserId: userId,
      callbackSigning: this.env.webCallbackSigning,
      method: "GET",
      path: HOSTED_RUNTIME_WORKSPACE_PATH,
      timeoutMs: this.env.webControlTimeoutMs,
    });

    if (!response.ok) {
      throw new Error(`Hosted workspace read failed with HTTP ${response.status}.`);
    }

    return parseHostedWorkspaceReadResponse(await response.json());
  }

  private assertWorkspaceBelongsToRunnerUser(
    workspace: HostedWorkspaceState | null,
    userId: string,
  ): void {
    if (workspace && workspace.userId !== userId) {
      throw new Error("Hosted workspace read returned a different user.");
    }
  }

  private async invokeWorkspaceRunner(input: {
    checkpointNextWakeAt?: string | null;
    lease: RunnerInvocationLease;
    reason: HostedWorkspaceInvocationReason;
    userId: string;
    workspaceVersion: string;
  }): Promise<HostedWorkspaceInvocationResult> {
    if (!this.runnerContainerNamespace) {
      throw new Error("Native hosted execution requires a RunnerContainer binding.");
    }

    const { runnerSecrets: runnerSecretsService } = await this.ensureRunnerStores(input.userId);
    const runnerSecrets = await runnerSecretsService.readRunnerSecrets(input.userId);
    const forwardedEnv = buildHostedRunnerContainerEnv(
      this.runnerRuntimeEnvSource,
    );
    const runtimeConfig = buildHostedRunnerJobRuntimeConfig({
      configSource: this.readRunnerRuntimeConfigSource(),
      forwardedEnv,
      rewritePlatformUrlsForContainer: true,
      runnerSecrets,
    });
    const userEnv = runtimeConfig.userEnv ?? {};
    const runnerContainerName = resolveHostedExecutionRunnerContainerName({
      source: this.runnerRuntimeEnvSource,
      userId: input.userId,
    });
    const job: HostedExecutionWorkspaceInvocationJobInput = {
      kind: HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND,
      request: {
        attemptId: input.lease.attemptId,
        ...(input.reason === "idle_shutdown_checkpoint"
          ? { checkpointNextWakeAt: input.checkpointNextWakeAt ?? null }
          : {}),
        leaseGeneration: input.lease.leaseGeneration,
        reason: input.reason,
        userId: input.userId,
        workspaceVersion: input.workspaceVersion,
      },
      runtime: runtimeConfig,
    };

    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        forwardedEnvKeyCount: Object.keys(forwardedEnv).length,
        hostedAssistantProviderConfigured:
          typeof forwardedEnv.HOSTED_ASSISTANT_PROVIDER === "string"
          && forwardedEnv.HOSTED_ASSISTANT_PROVIDER.length > 0,
        hostedAssistantOpenAiConfigured:
          isHostedRunnerOpenAiProvider(forwardedEnv.HOSTED_ASSISTANT_PROVIDER),
        modelCredentialConfigured:
          hasHostedRunnerModelCredential({
            forwardedEnv,
            userEnv,
          }),
        nodeEnvConfigured:
          typeof forwardedEnv.NODE_ENV === "string"
          && forwardedEnv.NODE_ENV.length > 0,
        runnerContainerName,
        workspaceAttemptId: input.lease.attemptId,
        workspaceLeaseGeneration: input.lease.leaseGeneration,
        workspaceReason: input.reason,
        workspaceVersion: input.workspaceVersion,
      },
      message: "Hosted runner prepared workspace invocation.",
      phase: "wake.running",
      userId: input.userId,
    });

    const timeoutSignal = AbortSignal.timeout(this.env.runnerTimeoutMs);
    const activeAbort = createHostedRunnerActiveInvocationAbort({
      attemptId: input.lease.attemptId,
      leaseGeneration: input.lease.leaseGeneration,
      timeoutSignal,
      userId: input.userId,
    });
    this.activeWorkspaceInvocationAbort = activeAbort.active;

    try {
      return await invokeHostedExecutionContainerRunner({
        job,
        runnerContainerName,
        runnerContainerNamespace: this.runnerContainerNamespace,
        signal: activeAbort.active.controller.signal,
        timeoutMs: this.env.runnerTimeoutMs,
        userId: input.userId,
      });
    } finally {
      activeAbort.unlinkTimeout();
      if (this.activeWorkspaceInvocationAbort === activeAbort.active) {
        this.activeWorkspaceInvocationAbort = null;
      }
    }
  }

  private async scheduleNextWorkspaceAlarm(input: {
    fallbackNextWakeAt: string | null;
    result: HostedWorkspaceInvocationResult;
    resultStatus: HostedWorkspaceInvocationResult["status"];
    userId: string;
    workspaceVersion: string;
  }): Promise<void> {
    const record = input.result.deferredCheckpointRequired === true
      ? await this.stateStore.markDeferredCheckpointRequired({
          redactedStatus: input.result.redactedStatus ?? null,
        })
      : await this.stateStore.readState();
    if (record.pendingNudge) {
      const queuedRecord = await this.queuePendingNudgeContinuationAfterInvocation({
        record,
        userId: input.userId,
      });
      if (queuedRecord.pendingNudge) {
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            pendingNudge: true,
          },
          message: "Hosted runner queued follow-up drive for pending nudge and scheduled delayed continuation alarm.",
          phase: "scheduled",
          userId: input.userId,
        });
        return;
      }
    }

    if (
      this.env.idleShutdownCheckpointsEnabled
      && (
        input.resultStatus === "idle"
        || (record.deferredCheckpointRequired && input.resultStatus !== "failed")
      )
    ) {
      const idleSchedule = await this.scheduleIdleShutdownCheckpointIfCurrent({
        deferredCheckpointRequired: record.deferredCheckpointRequired,
        drainBeforeNextWake: input.resultStatus !== "idle",
        nextWakeAt: input.fallbackNextWakeAt,
        userId: input.userId,
        workspaceVersion: input.workspaceVersion,
      });
      if (idleSchedule?.kind === "scheduled") {
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            deferredCheckpointRequired: record.deferredCheckpointRequired,
            idleShutdownCheckpointDueAt: idleSchedule.record.idleShutdownCheckpointDueAt,
          },
          message: "Hosted runner scheduled idle-shutdown checkpoint.",
          phase: "scheduled",
          userId: input.userId,
        });
        return;
      }
      if (idleSchedule?.kind === "deferred") {
        return;
      }
    }

    await this.runtimeAlarmScheduler.syncNextWake({
      preferredWakeAt: input.fallbackNextWakeAt,
    });
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        nextWakePresent: input.fallbackNextWakeAt !== null,
      },
      message: "Hosted runner synced next workspace alarm.",
      phase: "scheduled",
      userId: input.userId,
    });
  }

  private async scheduleBrowserVaultRefreshBestEffort(input: {
    reason: "external_request" | "idle_checkpoint_committed";
    userId: string;
  }): Promise<void> {
    if (this.shouldSkipBackgroundBrowserVaultRefresh()) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          reason: input.reason,
        },
        message: "Hosted runner skipped background browser-vault refresh for local e2e isolation.",
        phase: "scheduled",
        userId: input.userId,
      });
      return;
    }

    await this.upsertPendingBrowserVaultRefreshIntent(input);
    const refresh = this.drivePendingBrowserVaultRefresh({
      trigger: "detached",
      userId: input.userId,
    });

    try {
      this.state.waitUntil?.(refresh);
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        error,
        level: "warn",
        message: "Hosted runner could not register background browser-vault refresh.",
        phase: "scheduled",
        userId: input.userId,
      });
      void this.runtimeAlarmScheduler.syncStoredAlarm().catch(() => undefined);
    }
    void refresh;
  }

  private async runDuePendingBrowserVaultRefreshFromAlarm(userId: string): Promise<boolean> {
    const intent = await this.readPendingBrowserVaultRefreshIntent();
    if (!intent || intent.userId !== userId) {
      return false;
    }

    const nextAttemptAtMs = Date.parse(intent.nextAttemptAt);
    if (Number.isFinite(nextAttemptAtMs) && nextAttemptAtMs > Date.now()) {
      await this.runtimeAlarmScheduler.syncStoredAlarm();
      return false;
    }

    await this.drivePendingBrowserVaultRefresh({
      trigger: "alarm",
      userId,
    });
    return true;
  }

  private async runPendingBrowserVaultRefreshBeforeFutureRunnerAlarm(
    record: RunnerStateRecord,
  ): Promise<boolean> {
    if (record.inFlight || record.alarm?.kind !== "work") {
      return false;
    }

    const runnerAlarmDueAtMs = Date.parse(record.alarm.dueAt);
    if (!Number.isFinite(runnerAlarmDueAtMs) || runnerAlarmDueAtMs <= Date.now()) {
      return false;
    }

    return await this.runDuePendingBrowserVaultRefreshFromAlarm(record.userId);
  }

  private async drivePendingBrowserVaultRefresh(input: {
    trigger: "alarm" | "detached";
    userId: string;
  }): Promise<void> {
    const intent = await this.readPendingBrowserVaultRefreshIntent();
    if (!intent || intent.userId !== input.userId) {
      await this.runtimeAlarmScheduler.syncStoredAlarm();
      return;
    }

    const nextAttemptAtMs = Date.parse(intent.nextAttemptAt);
    if (Number.isFinite(nextAttemptAtMs) && nextAttemptAtMs > Date.now()) {
      await this.runtimeAlarmScheduler.syncStoredAlarm();
      return;
    }

    try {
      const outcome = await this.runBackgroundBrowserVaultRefresh({
        userId: input.userId,
      });
      if (outcome.kind === "completed") {
        await this.clearPendingBrowserVaultRefreshIntent({
          syncAlarm: input.trigger === "alarm",
        });
        return;
      }

      if (outcome.kind === "deferred") {
        await this.deferPendingBrowserVaultRefreshIntent({
          errorCode: outcome.reason,
          nextAttemptAt: resolveBrowserVaultRefreshDeferredWakeAt(outcome),
          userId: input.userId,
        });
        return;
      }

      await this.retryPendingBrowserVaultRefreshIntent({
        errorCode: outcome.status,
        userId: input.userId,
      });
    } catch (error) {
      await this.retryPendingBrowserVaultRefreshIntent({
        error,
        userId: input.userId,
      });
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          trigger: input.trigger,
        },
        level: "warn",
        message: "Hosted runner background browser-vault refresh failed.",
        phase: "failed",
        userId: input.userId,
      });
    }
  }

  private async upsertPendingBrowserVaultRefreshIntent(input: {
    reason: BrowserVaultRefreshIntentReason;
    userId: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    const nowMs = Date.parse(now);
    const existing = await this.readPendingBrowserVaultRefreshIntent();
    const existingForUser = existing?.userId === input.userId ? existing : null;
    const existingNextAttemptAtMs = existingForUser
      ? Date.parse(existingForUser.nextAttemptAt)
      : Number.NaN;
    const intent: BrowserVaultRefreshIntent = {
      failureCount: existingForUser ? existingForUser.failureCount : 0,
      lastErrorCode: existingForUser ? existingForUser.lastErrorCode : null,
      nextAttemptAt: existingForUser
        && Number.isFinite(existingNextAttemptAtMs)
        && existingNextAttemptAtMs > nowMs
        ? existingForUser.nextAttemptAt
        : now,
      pendingSince: existingForUser ? existingForUser.pendingSince : now,
      reason: input.reason,
      schema: BROWSER_VAULT_REFRESH_INTENT_SCHEMA,
      updatedAt: now,
      userId: input.userId,
    };
    await this.state.storage.put(BROWSER_VAULT_REFRESH_INTENT_STORAGE_KEY, intent);
  }

  private async deferPendingBrowserVaultRefreshIntent(input: {
    errorCode: string;
    nextAttemptAt: string;
    userId: string;
  }): Promise<void> {
    const intent = await this.readPendingBrowserVaultRefreshIntent();
    if (!intent || intent.userId !== input.userId) {
      await this.runtimeAlarmScheduler.syncStoredAlarm();
      return;
    }

    const now = new Date().toISOString();
    await this.state.storage.put(BROWSER_VAULT_REFRESH_INTENT_STORAGE_KEY, {
      ...intent,
      lastErrorCode: input.errorCode,
      nextAttemptAt: input.nextAttemptAt,
      updatedAt: now,
    } satisfies BrowserVaultRefreshIntent);
    await this.runtimeAlarmScheduler.syncStoredAlarm();
  }

  private async retryPendingBrowserVaultRefreshIntent(input: {
    error?: unknown;
    errorCode?: string;
    userId: string;
  }): Promise<void> {
    const intent = await this.readPendingBrowserVaultRefreshIntent();
    if (!intent || intent.userId !== input.userId) {
      await this.runtimeAlarmScheduler.syncStoredAlarm();
      return;
    }

    const failureCount = intent.failureCount + 1;
    const retryDelayMs = resolveBrowserVaultRefreshRetryDelayMs({
      baseDelayMs: this.env.retryDelayMs,
      failureCount,
    });
    const now = new Date().toISOString();
    await this.state.storage.put(BROWSER_VAULT_REFRESH_INTENT_STORAGE_KEY, {
      ...intent,
      failureCount,
      lastErrorCode: input.errorCode ?? readHostedExecutionSafeErrorCode(input.error) ?? null,
      nextAttemptAt: new Date(Date.now() + retryDelayMs).toISOString(),
      updatedAt: now,
    } satisfies BrowserVaultRefreshIntent);
    await this.runtimeAlarmScheduler.syncStoredAlarm();
  }

  private async clearPendingBrowserVaultRefreshIntent(input: {
    syncAlarm: boolean;
  }): Promise<void> {
    await this.state.storage.delete(BROWSER_VAULT_REFRESH_INTENT_STORAGE_KEY);
    if (input.syncAlarm) {
      await this.runtimeAlarmScheduler.syncStoredAlarm();
    }
  }

  private async readPendingBrowserVaultRefreshWakeAt(): Promise<string | null> {
    return (await this.readPendingBrowserVaultRefreshIntent())?.nextAttemptAt ?? null;
  }

  private async readPendingBrowserVaultRefreshIntent(): Promise<BrowserVaultRefreshIntent | null> {
    return parseBrowserVaultRefreshIntent(
      await this.state.storage.get<unknown>(BROWSER_VAULT_REFRESH_INTENT_STORAGE_KEY),
    );
  }

  private shouldSkipBackgroundBrowserVaultRefresh(): boolean {
    return this.readWorkerStringEnvSource().MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED === "1";
  }

  private async preflightIdleShutdownCheckpoint(input: {
    expectedWorkspaceVersion: string | null;
    record: RunnerStateRecord;
  }): Promise<
    | {
      nextWakeAt: string | null;
      run: false;
    }
    | {
      run: true;
      workspaceRead: HostedWorkspaceReadResponse;
    }
  > {
    if (input.record.pendingNudge) {
      await this.stateStore.clearIdleShutdownCheckpoint();
      const record = await this.queuePendingNudgeContinuationAfterInvocation({
        record: input.record,
        userId: input.record.userId,
      });
      return {
        nextWakeAt: record.nextWakeAt,
        run: false,
      };
    }

    if (!input.expectedWorkspaceVersion) {
      await this.stateStore.clearIdleShutdownCheckpoint();
      const record = await this.runtimeAlarmScheduler.syncNextWake({
        preferredWakeAt: input.record.nextWakeAt,
      });
      return {
        nextWakeAt: record.nextWakeAt,
        run: false,
      };
    }

    const workspaceRead = await this.readHostedWorkspaceFromWeb(input.record.userId);
    this.assertWorkspaceBelongsToRunnerUser(workspaceRead.workspace, input.record.userId);
    const latestRecord = await this.stateStore.readState();
    if (latestRecord.pendingNudge || latestRecord.inFlight) {
      const record = await this.syncRunnerFollowUpAfterInvocation({
        record: latestRecord,
        userId: latestRecord.userId,
      });
      return {
        nextWakeAt: record.nextWakeAt,
        run: false,
      };
    }
    const workspace = workspaceRead.workspace;
    const idleCheckpointDueAt = input.record.idleShutdownCheckpointDueAt;
    const workspaceVersionMatches = workspace
      ? workspace.version === input.expectedWorkspaceVersion
      : input.expectedWorkspaceVersion === "0"
        && latestRecord.deferredCheckpointRequired;
    const recordWakeWouldPreemptIdleCheckpoint =
      latestRecord.nextWakeAt && idleCheckpointDueAt
        ? Date.parse(latestRecord.nextWakeAt) <= Date.parse(idleCheckpointDueAt)
        : Boolean(latestRecord.nextWakeAt);
    const deferredIdleCheckpointShouldDrainFirst =
      latestRecord.deferredCheckpointRequired
      && idleCheckpointDueAt !== null
      && Date.parse(idleCheckpointDueAt) <= Date.now();
    const recordWakePreemptsIdleCheckpoint =
      recordWakeWouldPreemptIdleCheckpoint
      && !deferredIdleCheckpointShouldDrainFirst;
    if (
      !workspaceVersionMatches
      || recordWakePreemptsIdleCheckpoint
    ) {
      await this.stateStore.clearIdleShutdownCheckpoint();
      const record = await this.runtimeAlarmScheduler.syncNextWake({
        preferredWakeAt: latestRecord.nextWakeAt,
      });
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          expectedWorkspaceVersion: input.expectedWorkspaceVersion,
          hasNextWake: Boolean(latestRecord.nextWakeAt),
          nextWakePreemptsIdleCheckpoint: Boolean(recordWakePreemptsIdleCheckpoint),
          hasWorkspace: Boolean(workspace),
          workspaceVersionMatches,
        },
        message: "Hosted runner skipped stale idle-shutdown checkpoint alarm.",
        phase: "scheduled",
        userId: input.record.userId,
      });
      return {
        nextWakeAt: record.nextWakeAt,
        run: false,
      };
    }

    return {
      run: true,
      workspaceRead,
    };
  }

  private async scheduleIdleShutdownCheckpointIfCurrent(input: {
    deferredCheckpointRequired: boolean;
    drainBeforeNextWake?: boolean;
    nextWakeAt: string | null;
    userId: string;
    workspaceVersion: string;
  }): Promise<
    | {
      kind: "deferred";
      record: RunnerStateRecord;
    }
    | {
      kind: "scheduled";
      record: RunnerStateRecord;
    }
    | null
  > {
    const workspaceRead = await this.readHostedWorkspaceFromWeb(input.userId);
    this.assertWorkspaceBelongsToRunnerUser(workspaceRead.workspace, input.userId);
    const workspace = workspaceRead.workspace;
    const currentRecord = await this.stateStore.readState();
    if (currentRecord.pendingNudge || currentRecord.inFlight) {
      const record = await this.syncRunnerFollowUpAfterInvocation({
        record: currentRecord,
        userId: input.userId,
      });
      return {
        kind: "deferred",
        record,
      };
    }

    const idleCheckpointDelayMs = resolveIdleShutdownCheckpointDelayMs({
      idleTtlMs: this.env.runnerIdleTtlMs,
      safetyMarginMs: this.env.idleShutdownCheckpointSafetyMarginMs,
    });
    const idleCheckpointDueAt = new Date(Date.now() + idleCheckpointDelayMs).toISOString();
    const workspaceWakePreemptsIdleWindow =
      input.nextWakeAt
        ? Date.parse(input.nextWakeAt) <= Date.parse(idleCheckpointDueAt)
        : false;
    const shouldDrainBeforeNextWake =
      input.drainBeforeNextWake === true && workspaceWakePreemptsIdleWindow;
    const delayedDeferredCheckpointDueAt = new Date(
      Date.now() + DEFERRED_CHECKPOINT_DRAIN_DELAY_MS,
    ).toISOString();
    const dueAt = shouldDrainBeforeNextWake && input.nextWakeAt
      ? earliestIsoDate(
        delayedDeferredCheckpointDueAt,
        resolvePreemptingIdleShutdownCheckpointDueAt({
          nextWakeAt: input.nextWakeAt,
          nowMs: Date.now(),
        }),
      ) ?? delayedDeferredCheckpointDueAt
      : idleCheckpointDueAt;
    const workspaceWakePreemptsIdleCheckpoint =
      workspaceWakePreemptsIdleWindow && !shouldDrainBeforeNextWake;
    const nullWorkspaceCheckpointAllowed =
      input.deferredCheckpointRequired
      && input.workspaceVersion === "0";
    const checkpointWorkspaceVersion = workspace?.version
      ?? (nullWorkspaceCheckpointAllowed ? input.workspaceVersion : null);
    if (
      !checkpointWorkspaceVersion
      || workspaceWakePreemptsIdleCheckpoint
      || (
        workspace !== null
        && !input.deferredCheckpointRequired
        && isHostedWorkspaceBaseOnlySnapshot(workspace)
      )
    ) {
      if (input.nextWakeAt) {
        const record = await this.runtimeAlarmScheduler.syncNextWake({
          preferredWakeAt: input.nextWakeAt,
        });
        return {
          kind: "deferred",
          record,
        };
      }
      return null;
    }

    if (input.nextWakeAt) {
      await this.stateStore.syncNextWake({
        preferredWakeAt: input.nextWakeAt,
      });
    }

    const scheduledCheckpoint = await this.stateStore.scheduleIdleShutdownCheckpointIfStillQuiet({
      checkpointNextWakeAt: input.nextWakeAt,
      dueAt,
      workspaceVersion: checkpointWorkspaceVersion,
    });
    if (!scheduledCheckpoint.scheduled) {
      const record = await this.syncRunnerFollowUpAfterInvocation({
        record: scheduledCheckpoint.record,
        userId: input.userId,
      });
      return {
        kind: "deferred",
        record,
      };
    }

    await this.runtimeAlarmScheduler.syncStoredAlarm();
    const latestRecord = await this.stateStore.readState();
    if (latestRecord.pendingNudge || latestRecord.inFlight) {
      const record = await this.syncRunnerFollowUpAfterInvocation({
        record: latestRecord,
        userId: input.userId,
      });
      return {
        kind: "deferred",
        record,
      };
    }

    return {
      kind: "scheduled",
      record: latestRecord,
    };
  }

  private async scheduleIdleShutdownCheckpointRetry(input: {
    retryDelayMs: number;
    workspaceVersion: string;
  }): Promise<boolean> {
    const record = await this.stateStore.readState();
    if (record.pendingNudge || record.inFlight) {
      const scheduledRecord = await this.syncRunnerFollowUpAfterInvocation({
        record,
        userId: record.userId,
      });
      return scheduledRecord.pendingNudge || scheduledRecord.inFlight;
    }
    if (record.retryFailureCount >= this.env.maxEventAttempts) {
      await this.stateStore.clearIdleShutdownCheckpoint();
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          maxEventAttempts: this.env.maxEventAttempts,
          retryFailureCount: record.retryFailureCount,
        },
        level: "warn",
        message: "Hosted runner idle-shutdown checkpoint retry attempts exhausted; waiting for fresh activity.",
        phase: "failed",
        userId: record.userId,
      });
      return false;
    }

    await this.stateStore.scheduleIdleShutdownCheckpoint({
      dueAt: new Date(Date.now() + input.retryDelayMs).toISOString(),
      workspaceVersion: input.workspaceVersion,
    });
    await this.runtimeAlarmScheduler.syncStoredAlarm();
    return true;
  }

  private async handleIdleShutdownCheckpointResult(input: {
    result: HostedWorkspaceInvocationResult;
    userId: string;
  }): Promise<void> {
    if (isCommittedIdleShutdownCheckpointResult(input.result)) {
      await this.stateStore.clearDeferredCheckpointRequired();
      await this.finishIdleShutdownCheckpointBestEffort({
        cleanupFailureMessage: "Hosted idle-shutdown checkpoint committed but cleanup failed.",
        preferredWakeAt: null,
        userId: input.userId,
      });
      await this.scheduleBrowserVaultRefreshBestEffort({
        reason: "idle_checkpoint_committed",
        userId: input.userId,
      });
      return;
    }

    if (input.result.idleShutdownCheckpointed === true) {
      await this.stateStore.clearDeferredCheckpointRequired();
      await this.finishIdleShutdownCheckpointBestEffort({
        cleanupFailureMessage: "Hosted idle-shutdown checkpoint cleanup failed.",
        preferredWakeAt: input.result.nextWakeAt ?? null,
        userId: input.userId,
      });
      await this.scheduleBrowserVaultRefreshBestEffort({
        reason: "idle_checkpoint_committed",
        userId: input.userId,
      });
      return;
    }

    const record = await this.stateStore.readState();
    if (record.pendingNudge || record.inFlight) {
      const scheduledRecord = await this.syncRunnerFollowUpAfterInvocation({
        record,
        userId: input.userId,
      });
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          idleShutdownCheckpointed: Boolean(input.result.idleShutdownCheckpointed),
          inFlight: record.inFlight,
          pendingNudge: record.pendingNudge,
        },
        message: "Hosted runner preserved wake after idle checkpoint because work is pending.",
        phase: "scheduled",
        userId: scheduledRecord.userId,
      });
      return;
    }

    await this.finishIdleShutdownCheckpointBestEffort({
      cleanupFailureMessage: "Hosted idle-shutdown checkpoint cleanup failed.",
      preferredWakeAt: input.result.nextWakeAt ?? null,
      userId: input.userId,
    });
  }

  private async finishIdleShutdownCheckpointBestEffort(input: {
    cleanupFailureMessage: string;
    preferredWakeAt: string | null;
    userId: string;
  }): Promise<void> {
    try {
      await this.finishIdleShutdownCheckpoint(input);
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          cleanupErrorCode: safeCleanupErrorCode(error),
        },
        error,
        level: "warn",
        message: input.cleanupFailureMessage,
        phase: "checkpoint",
        userId: input.userId,
      });

      try {
        await this.runtimeAlarmScheduler.syncStoredAlarm();
      } catch (syncError) {
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            cleanupErrorCode: safeCleanupErrorCode(syncError),
          },
          error: syncError,
          level: "warn",
          message: "Hosted idle-shutdown checkpoint cleanup alarm resync failed.",
          phase: "scheduled",
          userId: input.userId,
        });
      }
    }
  }

  private async finishIdleShutdownCheckpoint(input: {
    preferredWakeAt: string | null;
    userId: string;
  }): Promise<void> {
    const record = await this.stateStore.readState();
    if (record.pendingNudge || record.inFlight) {
      const scheduledRecord = await this.syncRunnerFollowUpAfterInvocation({
        record,
        userId: input.userId,
      });
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          inFlight: record.inFlight,
          pendingNudge: record.pendingNudge,
        },
        message: "Hosted runner kept warm container after idle checkpoint because work is pending.",
        phase: "scheduled",
        userId: scheduledRecord.userId,
      });
      return;
    }

    const runnerContainerName = resolveHostedExecutionRunnerContainerName({
      source: this.runnerRuntimeEnvSource,
      userId: input.userId,
    });
    const destroyed = await destroyHostedExecutionContainer({
      runnerContainerName,
      runnerContainerNamespace: this.runnerContainerNamespace,
      userId: input.userId,
    });
    const postCleanupRecord = await this.stateStore.readState();
    if (postCleanupRecord.pendingNudge || postCleanupRecord.inFlight) {
      const record = await this.syncRunnerFollowUpAfterInvocation({
        record: postCleanupRecord,
        userId: input.userId,
      });
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          destroyAttempted: destroyed.attempted,
          destroyOk: destroyed.ok,
          inFlight: postCleanupRecord.inFlight,
          pendingNudge: postCleanupRecord.pendingNudge,
        },
        message: "Hosted runner preserved wake after idle checkpoint because work arrived during cleanup.",
        phase: "scheduled",
        userId: record.userId,
      });
      return;
    }
    await this.stateStore.clearIdleShutdownCheckpoint();
    await this.runtimeAlarmScheduler.syncNextWake({
      preferredWakeAt: input.preferredWakeAt,
    });
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        destroyErrorCode: destroyed.errorCode,
        destroyAttempted: destroyed.attempted,
        destroyOk: destroyed.ok,
      },
      level: destroyed.ok ? "info" : "warn",
      message: "Hosted runner completed idle-shutdown checkpoint container cleanup.",
      phase: "checkpoint",
      userId: input.userId,
    });
  }

  private async destroyIdleShutdownCheckpointContainerAfterFailureBestEffort(input: {
    userId: string;
  }): Promise<void> {
    try {
      const runnerContainerName = resolveHostedExecutionRunnerContainerName({
        source: this.runnerRuntimeEnvSource,
        userId: input.userId,
      });
      const destroyed = await destroyHostedExecutionContainer({
        runnerContainerName,
        runnerContainerNamespace: this.runnerContainerNamespace,
        userId: input.userId,
      });
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          destroyErrorCode: destroyed.errorCode,
          destroyAttempted: destroyed.attempted,
          destroyOk: destroyed.ok,
        },
        level: destroyed.ok ? "info" : "warn",
        message: "Hosted runner destroyed container after idle-shutdown checkpoint failure.",
        phase: "checkpoint",
        userId: input.userId,
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        error,
        level: "warn",
        message: "Hosted runner could not destroy container after idle-shutdown checkpoint failure.",
        phase: "checkpoint",
        userId: input.userId,
      });
    }
  }

  private async scheduleHostedWakeRetryAlarm(input: {
    respectMaxAttempts?: boolean;
    retryDelayMs?: number;
    userId?: string | null;
  } = {}): Promise<boolean> {
    const record = input.respectMaxAttempts === true
      ? await this.stateStore.readState()
      : await this.tryReadStateForRetryScheduling();
    if (record && (record.pendingNudge || record.inFlight)) {
      await this.syncPendingWorkRecoveryAfterFailure(record);
      return true;
    }

    if (input.respectMaxAttempts === true) {
      if (record && record.retryFailureCount >= this.env.maxEventAttempts) {
        if (record.nextWakeAt !== null) {
          await this.runtimeAlarmScheduler.syncNextWake({
            preferredWakeAt: null,
          });
        }
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            maxEventAttempts: this.env.maxEventAttempts,
            retryFailureCount: record.retryFailureCount,
          },
          level: "warn",
          message: "Hosted runner retry attempts exhausted; waiting for a fresh nudge before retrying.",
          phase: "failed",
          userId: record.userId ?? input.userId ?? null,
        });
        return false;
      }
    }

    await this.runtimeAlarmScheduler.syncNextWake({
      preferredWakeAt: new Date(
        Date.now() + (input.retryDelayMs ?? this.env.retryDelayMs),
      ).toISOString(),
    });
    return true;
  }

  private async runBackgroundBrowserVaultRefresh(input: {
    userId: string;
  }): Promise<BackgroundBrowserVaultRefreshOutcome> {
    let record = await this.stateStore.readState();
    if (record.pendingNudge || record.inFlight) {
      return {
        kind: "deferred",
        nextAttemptAt: resolveBrowserVaultRefreshForegroundWakeAt(record),
        reason: "foreground_work",
      };
    }

    if (!this.runnerContainerNamespace) {
      throw new Error("Native hosted execution requires a RunnerContainer binding.");
    }

    const { runnerSecrets: runnerSecretsService } = await this.ensureRunnerStores(input.userId);
    const runnerSecrets = await runnerSecretsService.readRunnerSecrets(input.userId);
    const forwardedEnv = buildHostedRunnerContainerEnv(
      this.runnerRuntimeEnvSource,
    );
    const runtimeConfig = buildHostedRunnerJobRuntimeConfig({
      configSource: this.readRunnerRuntimeConfigSource(),
      forwardedEnv,
      rewritePlatformUrlsForContainer: true,
      runnerSecrets,
    });
    const runnerContainerName = resolveHostedExecutionRunnerContainerName({
      source: this.runnerRuntimeEnvSource,
      userId: input.userId,
    });

    record = await this.stateStore.readState();
    if (record.pendingNudge || record.inFlight) {
      return {
        kind: "deferred",
        nextAttemptAt: resolveBrowserVaultRefreshForegroundWakeAt(record),
        reason: "foreground_work",
      };
    }

    const abortController = new AbortController();
    const generated = await refreshHostedExecutionContainerBrowserVaultReplica({
      runnerContainerName,
      runnerContainerNamespace: this.runnerContainerNamespace,
      runtime: runtimeConfig,
      signal: abortController.signal,
      timeoutMs: this.env.runnerTimeoutMs,
      userId: input.userId,
    });

    if (generated.status === "refresh_failed_too_large") {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          browserVaultReplicaByteLength: generated.byteLength,
          browserVaultReplicaMaxBytes: generated.maxBytes,
        },
        level: "warn",
        message: "Hosted runner skipped browser-vault refresh because the generated replica exceeded the size limit.",
        phase: "scheduled",
        userId: input.userId,
      });
      return {
        kind: "completed",
        status: generated.status,
      };
    }

    if (generated.status === "publish_conflict") {
      emitHostedExecutionStructuredLog({
        component: "runner",
        level: "warn",
        message: "Hosted runner skipped background browser-vault refresh because publish conflicted with the latest workspace row.",
        phase: "scheduled",
        userId: input.userId,
      });
      return {
        kind: "completed",
        status: generated.status,
      };
    }

    if (generated.status === "refresh_skipped_no_source") {
      emitHostedExecutionStructuredLog({
        component: "runner",
        message: "Hosted runner skipped browser-vault refresh because the restored workspace has no canonical source.",
        phase: "scheduled",
        userId: input.userId,
      });
      return {
        kind: "completed",
        status: generated.status,
      };
    }

    if (generated.status === "refresh_failed_empty_source") {
      emitHostedExecutionStructuredLog({
        component: "runner",
        level: "warn",
        message: "Hosted runner browser-vault refresh produced no private content from restored source.",
        phase: "failed",
        userId: input.userId,
      });
      return {
        kind: "retryable",
        status: generated.status,
      };
    }

    if (
      generated.status === "stale_source"
      || generated.status === "workspace_missing"
    ) {
      return {
        kind: "retryable",
        status: generated.status,
      };
    }

    if (generated.status !== "published") {
      return {
        kind: "completed",
        status: generated.status,
      };
    }

    return {
      kind: "completed",
      status: "published",
    };
  }

  private startDetachedRunnerDrive(input: {
    aiUsageAllowDecision?: HostedAiUsageAllowDecision | null;
    reason: HostedWorkspaceInvocationReason;
    userId: string;
  }): boolean {
    if (this.invocationLock !== null) {
      return false;
    }

    const drive = this.runUntilIdleOrBudget({
      aiUsageAllowDecision: input.aiUsageAllowDecision ?? null,
      reason: input.reason,
    })
      .then(() => undefined, async (error) => {
        const record = await this.tryReadStateForRetryScheduling();
        const retryFailureCount = record?.retryFailureCount ?? 0;
        const retryDelayMs = input.reason === "nudge"
          ? resolvePendingNudgeFailureRetryDelayMs({
              defaultRetryDelayMs: this.env.retryDelayMs,
              retryFailureCount,
            })
          : resolveHostedRunnerFailureRetryDelayMs({
              defaultRetryDelayMs: this.env.retryDelayMs,
              reason: input.reason,
              retryFailureCount,
            });
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            ...buildHostedRunnerMetadataOnlyErrorDetails(error),
            reason: input.reason,
            retryDelayMs,
          },
          level: "warn",
          message: "Hosted runner immediate wake drive failed; durable alarm fallback remains scheduled.",
          phase: "failed",
          userId: input.userId,
        });

        try {
          if (input.reason === "nudge") {
            if (isRecoveredActiveInvocationAbortError(error) && record) {
              const durableRecoverySettled =
                (record.pendingNudge && record.nextWakeAt !== null)
                || (
                  !record.pendingNudge
                  && !record.inFlight
                  && record.retryFailureCount === 0
                );
              if (!durableRecoverySettled) {
                await this.preservePendingNudgeRetryAfterFailure({
                  retryDelayMs,
                });
                return;
              }

              await this.runtimeAlarmScheduler.syncStoredAlarm();
              return;
            }
            if (
              record
              && !record.pendingNudge
              && !record.inFlight
              && record.retryFailureCount === 0
            ) {
              await this.runtimeAlarmScheduler.syncStoredAlarm();
              return;
            }
            await this.preservePendingNudgeRetryAfterFailure({
              retryDelayMs,
            });
          } else {
            await this.scheduleHostedWakeRetryAlarm({
              respectMaxAttempts: true,
              retryDelayMs,
              userId: input.userId,
            });
          }
        } catch (retryError) {
          emitHostedExecutionStructuredLog({
            component: "hosted.runner",
            details: {
              reason: input.reason,
            },
            error: retryError,
            level: "warn",
            message: "Hosted runner immediate wake retry alarm scheduling failed.",
            phase: "failed",
            userId: input.userId,
          });
        }
      });
    try {
      this.state.waitUntil?.(drive);
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          reason: input.reason,
        },
        error,
        level: "warn",
        message: "Hosted runner immediate wake drive could not be registered with Durable Object waitUntil.",
        phase: "scheduled",
        userId: input.userId,
      });
    }
    void drive;

    return true;
  }

  private queueOrStartRunnerDriveAfterInvocation(input: {
    aiUsageAllowDecision?: HostedAiUsageAllowDecision | null;
    reason: HostedWorkspaceInvocationReason;
    userId: string;
  }): boolean {
    if (this.invocationLock !== null) {
      this.pendingRunnerDriveAfterInvocation = input;
      return false;
    }

    const started = this.startDetachedRunnerDrive(input);
    if (!started) {
      this.pendingRunnerDriveAfterInvocation = input;
    }
    return started;
  }

  private async tryReadStateForRetryScheduling(): Promise<RunnerStateRecord | null> {
    try {
      return await this.stateStore.readState();
    } catch {
      return null;
    }
  }

  private readAllowedRunnerSecretsSource(): Readonly<Record<string, string | undefined>> {
    return {
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: this.env.allowedRunnerSecretKeys ?? undefined,
    };
  }

  private createRunnerSecretsService(crypto: HostedUserCryptoContext): RunnerSecretsService {
    return new RunnerSecretsService(
      this.bucket,
      crypto.rootKey,
      crypto.rootKeyId,
      crypto.keysById,
      crypto.resolveKeyById,
      this.readAllowedRunnerSecretsSource(),
    );
  }

  private readRunnerRuntimeConfigSource(): Readonly<Record<string, string | undefined>> {
    return {
      ...this.readWorkerStringEnvSource(),
      ...this.readAllowedRunnerSecretsSource(),
    };
  }

  private readWorkerStringEnvSource(): Readonly<Record<string, string | undefined>> {
    return toStringEnvSource(this.runnerRuntimeEnvSource);
  }

  private readHostedWebControlBaseUrl(): string {
    return this.env.hostedWebBaseUrl;
  }

  private async requireBoundUserId(): Promise<string> {
    return (await this.stateStore.readState()).userId;
  }

  private async withRuntimeCryptoContextLock<T>(run: () => Promise<T>): Promise<T> {
    return withSerializedLock(
      {
        get: () => this.runtimeCryptoContextLock,
        set: (value) => {
          this.runtimeCryptoContextLock = value;
        },
      },
      run,
    );
  }

  private async withInvocationLock<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await withSerializedLock(
        {
          get: () => this.invocationLock,
          set: (value) => {
            this.invocationLock = value;
          },
        },
        run,
      );
    } finally {
      const pendingDrive = this.pendingRunnerDriveAfterInvocation;

      if (pendingDrive && this.invocationLock === null) {
        this.pendingRunnerDriveAfterInvocation = null;

        const started = this.startDetachedRunnerDrive(pendingDrive);
        if (!started) {
          this.pendingRunnerDriveAfterInvocation = pendingDrive;
        }
      }
    }
  }

}

async function deleteR2ObjectIfSupported(
  bucket: R2BucketLike,
  key: string,
): Promise<{ deleted: boolean; deletedCount: number }> {
  if (!bucket.delete) {
    return { deleted: false, deletedCount: 0 };
  }

  const existingObject = await bucket.get(key);
  if (!existingObject) {
    return { deleted: false, deletedCount: 0 };
  }

  await bucket.delete(key);
  return { deleted: true, deletedCount: 1 };
}

async function deleteR2ObjectsWithPrefix(
  bucket: R2BucketLike,
  prefix: string,
): Promise<{ deletedCount: number }> {
  if (!bucket.delete || !bucket.list) {
    return { deletedCount: 0 };
  }

  let cursor: string | undefined;
  let deletedCount = 0;

  do {
    const page = await bucket.list({ cursor, limit: 1_000, prefix });
    for (const object of page.objects) {
      await bucket.delete(object.key);
      deletedCount += 1;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  return { deletedCount };
}

function safeCleanupErrorCode(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

function shouldRunHostedRunnerInvocation(input: {
  dueWake?: boolean;
  idleShutdownCheckpointsEnabled: boolean;
  reason: HostedWorkspaceInvocationReason;
  record: RunnerStateRecord;
}): boolean {
  return (input.idleShutdownCheckpointsEnabled && input.reason === "idle_shutdown_checkpoint")
    || input.reason === "manual"
    || input.record.pendingNudge
    || input.dueWake === true;
}

function resolveHostedRunnerInvocationReason(input: {
  record: RunnerStateRecord;
  requestedReason: HostedWorkspaceInvocationReason;
}): HostedWorkspaceInvocationReason {
  if (
    input.record.pendingNudge
    && (
      input.requestedReason === "alarm"
      || input.requestedReason === "retry"
    )
  ) {
    return "nudge";
  }

  return input.requestedReason;
}

function createHostedRunnerActiveInvocationAbort(input: {
  attemptId: string;
  leaseGeneration: string;
  timeoutSignal: AbortSignal;
  userId: string;
}): {
  active: ActiveWorkspaceInvocationAbort;
  unlinkTimeout(): void;
} {
  const controller = new AbortController();
  const active: ActiveWorkspaceInvocationAbort = {
    attemptId: input.attemptId,
    controller,
    leaseGeneration: input.leaseGeneration,
    userId: input.userId,
  };

  if (input.timeoutSignal.aborted) {
    controller.abort(input.timeoutSignal.reason);
    return {
      active,
      unlinkTimeout: () => undefined,
    };
  }

  const abortFromTimeout = () => {
    if (!controller.signal.aborted) {
      controller.abort(input.timeoutSignal.reason);
    }
  };
  input.timeoutSignal.addEventListener("abort", abortFromTimeout, { once: true });

  return {
    active,
    unlinkTimeout: () => {
      input.timeoutSignal.removeEventListener("abort", abortFromTimeout);
    },
  };
}

function isCommittedIdleShutdownCheckpointResult(input: HostedWorkspaceInvocationResult): boolean {
  return input.idleShutdownCheckpointed === true
    && input.status === "idle"
    && (input.nextWakeAt === undefined || input.nextWakeAt === null);
}

function isHostedWorkspaceBaseOnlySnapshot(workspace: HostedWorkspaceState): boolean {
  return workspace.snapshotRef !== null
    && readHostedExecutionSnapshotDeltaRef(workspace.snapshotRef) === null
    && readHostedExecutionSnapshotHotRef(workspace.snapshotRef) === null;
}

function resolveIdleShutdownCheckpointDelayMs(input: {
  idleTtlMs: number;
  safetyMarginMs: number;
}): number {
  const boundedMarginMs = Math.min(
    Math.max(0, Math.floor(input.safetyMarginMs)),
    Math.max(0, Math.floor(input.idleTtlMs / 2)),
  );
  return Math.max(1_000, input.idleTtlMs - boundedMarginMs);
}

function earliestIsoDate(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs)) {
    return right;
  }
  if (!Number.isFinite(rightMs)) {
    return left;
  }
  return rightMs < leftMs ? right : left;
}

function resolvePendingNudgeWakeAt(input: {
  nowMs: number;
  record: RunnerStateRecord;
  runnerTimeoutMs: number;
}): string {
  const invocation = input.record.workspaceInvocation;
  if (!invocation) {
    return new Date(input.nowMs).toISOString();
  }

  const startedAtMs = Date.parse(invocation.startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return new Date(input.nowMs).toISOString();
  }

  const hardDeadlineMs = startedAtMs + input.runnerTimeoutMs;
  const lastHeartbeatAtMs = invocation.lastHeartbeatAt
    ? Date.parse(invocation.lastHeartbeatAt)
    : Number.NaN;
  const livenessDeadlineMs = Number.isFinite(lastHeartbeatAtMs)
    ? lastHeartbeatAtMs + ACTIVE_INVOCATION_HEARTBEAT_STALE_MS
    : input.nowMs;
  return new Date(Math.max(input.nowMs, Math.min(hardDeadlineMs, livenessDeadlineMs))).toISOString();
}

function resolvePendingNudgeDrainContinuationWakeAt(input: {
  nowMs: number;
  record: RunnerStateRecord;
  runnerTimeoutMs: number;
}): string {
  const recoveryWakeAt = resolvePendingNudgeWakeAt(input);
  const continuationWakeAt = new Date(
    input.nowMs + PENDING_NUDGE_DRAIN_CONTINUATION_DELAY_MS,
  ).toISOString();
  return earliestIsoDate(recoveryWakeAt, continuationWakeAt) ?? continuationWakeAt;
}

function applyMinimumFutureWakeAt(input: {
  minimumDelayMs: number;
  nowMs: number;
  wakeAt: string;
}): string {
  const minimumDelayMs = Math.max(0, Math.floor(input.minimumDelayMs));
  if (minimumDelayMs === 0) {
    return input.wakeAt;
  }

  const wakeAtMs = Date.parse(input.wakeAt);
  const minimumWakeAtMs = input.nowMs + minimumDelayMs;
  if (Number.isFinite(wakeAtMs) && wakeAtMs >= minimumWakeAtMs) {
    return input.wakeAt;
  }

  return new Date(minimumWakeAtMs).toISOString();
}

function mergeHostedRunnerDeferredCheckpointWorkspaceStatus(input: {
  redactedStatus: HostedRuntimeRedactedJson | null;
  workspace: HostedWorkspaceState | null;
}): HostedWorkspaceState | null {
  if (!input.workspace || !input.redactedStatus) {
    return input.workspace;
  }

  return {
    ...input.workspace,
    redactedStatus: mergeHostedRunnerDeferredCheckpointRedactedStatus({
      base: input.workspace.redactedStatus ?? null,
      deferred: input.redactedStatus,
    }),
  };
}

function mergeHostedRunnerDeferredCheckpointRedactedStatus(input: {
  base: HostedRuntimeRedactedJson | null;
  deferred: HostedRuntimeRedactedJson;
}): HostedRuntimeRedactedJson {
  const merged: HostedRuntimeRedactedJson = {
    ...(input.base ?? {}),
  };

  for (const [key, value] of Object.entries(input.deferred)) {
    const deferredSeq = readNonNegativeBigInt(value);
    if (deferredSeq === null) {
      continue;
    }

    const baseSeq = readNonNegativeBigInt(merged[key]);
    if (baseSeq === null || deferredSeq > baseSeq) {
      merged[key] = deferredSeq.toString();
    }
  }

  return merged;
}

function mergeHostedRunnerDeferredCheckpointMailboxLag(input: {
  mailboxLag: readonly HostedMailboxLaneLag[];
  redactedStatus: HostedRuntimeRedactedJson | null;
}): HostedMailboxLaneLag[] {
  const redactedStatus = input.redactedStatus;
  if (!redactedStatus) {
    return [...input.mailboxLag];
  }

  return input.mailboxLag.map((lag) => {
    const webImportedSeq = readNonNegativeBigInt(lag.importedSeq) ?? 0n;
    const deferredImportedSeq = readHostedMailboxImportedSeqForLane(
      redactedStatus,
      lag.lane,
    );
    const importedSeq = deferredImportedSeq > webImportedSeq
      ? deferredImportedSeq
      : webImportedSeq;
    const maxSeq = readNonNegativeBigInt(lag.maxSeq) ?? 0n;

    return {
      ...lag,
      importedSeq: importedSeq.toString(),
      lag: (maxSeq > importedSeq ? maxSeq - importedSeq : 0n).toString(),
      maxSeq: maxSeq.toString(),
    };
  });
}

function hostedRunnerMailboxLagDrained(
  mailboxLag: readonly HostedMailboxLaneLag[],
): boolean {
  const seenLanes = new Set<HostedMailboxLane>();
  for (const lag of mailboxLag) {
    if ((readNonNegativeBigInt(lag.lag) ?? 1n) !== 0n) {
      return false;
    }
    seenLanes.add(lag.lane);
  }

  return HOSTED_MAILBOX_LANES.every((lane) => seenLanes.has(lane));
}

function readHostedMailboxImportedSeqForLane(
  redactedStatus: HostedRuntimeRedactedJson,
  lane: HostedMailboxLane,
): bigint {
  const key = `hostedMailbox${lane.slice(0, 1).toUpperCase()}${lane.slice(1)}ImportedSeq`;
  return readNonNegativeBigInt(redactedStatus[key]) ?? 0n;
}

function readNonNegativeBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint" && value >= 0n) {
    return value;
  }

  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }

  if (typeof value === "string" && /^[0-9]+$/u.test(value)) {
    return BigInt(value);
  }

  return null;
}

function resolvePreemptingIdleShutdownCheckpointDueAt(input: {
  nextWakeAt: string;
  nowMs: number;
}): string {
  const nextWakeAtMs = Date.parse(input.nextWakeAt);
  if (!Number.isFinite(nextWakeAtMs)) {
    return new Date(input.nowMs).toISOString();
  }

  return new Date(Math.max(input.nowMs, nextWakeAtMs - 1)).toISOString();
}

function resolveBrowserVaultRefreshRetryDelayMs(input: {
  baseDelayMs: number;
  failureCount: number;
}): number {
  return Math.min(
    BROWSER_VAULT_REFRESH_RETRY_MAX_DELAY_MS,
    input.baseDelayMs * (2 ** Math.max(0, input.failureCount - 1)),
  );
}

function resolveBrowserVaultRefreshForegroundWakeAt(record: RunnerStateRecord): string | null {
  return record.alarm?.kind === "work" ? record.alarm.dueAt : null;
}

function resolveBrowserVaultRefreshDeferredWakeAt(input: {
  nextAttemptAt: string | null;
}): string {
  if (input.nextAttemptAt) {
    const nextAttemptAtMs = Date.parse(input.nextAttemptAt);
    if (Number.isFinite(nextAttemptAtMs) && nextAttemptAtMs > Date.now()) {
      return input.nextAttemptAt;
    }
  }

  return new Date(Date.now() + BROWSER_VAULT_REFRESH_CONTINUATION_DELAY_MS).toISOString();
}

function readHostedExecutionSafeErrorCode(error: unknown): string | null {
  const diagnostics = buildHostedExecutionSafeErrorDiagnostics(error);
  return typeof diagnostics?.errorCode === "string" ? diagnostics.errorCode : null;
}

function parseBrowserVaultRefreshIntent(value: unknown): BrowserVaultRefreshIntent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<BrowserVaultRefreshIntent>;
  if (
    record.schema !== BROWSER_VAULT_REFRESH_INTENT_SCHEMA
    || !isBrowserVaultRefreshIntentReason(record.reason)
    || typeof record.userId !== "string"
    || record.userId.length === 0
    || typeof record.pendingSince !== "string"
    || typeof record.nextAttemptAt !== "string"
    || typeof record.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    failureCount: normalizeNonNegativeInteger(record.failureCount),
    lastErrorCode: typeof record.lastErrorCode === "string" && record.lastErrorCode
      ? record.lastErrorCode
      : null,
    nextAttemptAt: record.nextAttemptAt,
    pendingSince: record.pendingSince,
    reason: record.reason,
    schema: BROWSER_VAULT_REFRESH_INTENT_SCHEMA,
    updatedAt: record.updatedAt,
    userId: record.userId,
  };
}

function isBrowserVaultRefreshIntentReason(
  value: unknown,
): value is BrowserVaultRefreshIntentReason {
  return value === "external_request" || value === "idle_checkpoint_committed";
}

function normalizeNonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function buildHostedRunnerMetadataOnlyErrorDetails(error: unknown): HostedExecutionStructuredLogDetails {
  const diagnostics = buildHostedExecutionSafeErrorDiagnostics(error);
  if (!diagnostics) {
    return {};
  }

  return {
    detailsKeys: Object.keys(diagnostics).sort(),
    ...(typeof diagnostics.errorCode === "string" ? { errorCode: diagnostics.errorCode } : {}),
    ...(typeof diagnostics.errorCodeDetail === "string"
      ? { errorCodeDetail: diagnostics.errorCodeDetail }
      : {}),
    errorDetailPresent: typeof diagnostics.errorDetail === "string",
    ...(typeof diagnostics.errorMessage === "string" ? { errorMessage: diagnostics.errorMessage } : {}),
    ...(typeof diagnostics.errorName === "string" ? { errorName: diagnostics.errorName } : {}),
    ...(typeof diagnostics.errorStatus === "number" ? { errorStatus: diagnostics.errorStatus } : {}),
  };
}

function isRecoveredActiveInvocationAbortError(error: unknown): boolean {
  return error instanceof Error
    && (
      error.message === STALE_LOCAL_ACTIVE_INVOCATION_ABORT_MESSAGE
      || error.message === CONTAINER_STOPPED_ACTIVE_INVOCATION_ABORT_MESSAGE
    );
}

function readHostedWorkerVersionIdFromSource(
  source: Readonly<Record<string, unknown>>,
): string | null {
  const metadata = source.CF_VERSION_METADATA;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const versionId = (metadata as { id?: unknown }).id;
  if (typeof versionId !== "string") {
    return null;
  }

  const trimmed = versionId.trim();
  return trimmed ? trimmed : null;
}

function resolveHostedRunnerFailureRetryDelayMs(input: {
  defaultRetryDelayMs: number;
  reason: HostedWorkspaceInvocationReason;
  retryFailureCount?: number | null;
}): number {
  if (input.reason !== "nudge") {
    return input.defaultRetryDelayMs;
  }

  const retryFailureCount = Math.max(0, Math.floor(input.retryFailureCount ?? 0));
  const backoffStep = Math.max(0, retryFailureCount - 1);
  const exponentialDelay = IMMEDIATE_NUDGE_FAILURE_RETRY_DELAY_MS
    * (NUDGE_FAILURE_RETRY_BACKOFF_MULTIPLIER ** backoffStep);
  return Math.min(
    input.defaultRetryDelayMs,
    exponentialDelay,
    NUDGE_FAILURE_RETRY_MAX_DELAY_MS,
  );
}

function isHostedRunnerWakeAtNoLaterThan(
  left: string,
  right: string,
): boolean {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs <= rightMs;
}

function resolvePendingNudgeFailureRetryDelayMs(input: {
  defaultRetryDelayMs: number;
  retryFailureCount: number;
}): number {
  return resolveHostedRunnerFailureRetryDelayMs({
    defaultRetryDelayMs: input.defaultRetryDelayMs,
    reason: "nudge",
    retryFailureCount: input.retryFailureCount,
  });
}
