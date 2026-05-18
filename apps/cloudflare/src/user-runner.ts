import {
  type HostedAiUsageAllowDecision,
  type HostedRunnerNudgeResult,
  type HostedRunnerNudgeRequest,
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
  resolveHostedExecutionRunnerContainerName,
  type HostedExecutionContainerNamespaceLike,
  type RunnerContainerEnsureProcessingResult,
  type RunnerRuntimeWakeInput,
  type RunnerRuntimeWakeResult,
} from "./runner-container.js";
import { withSerializedLock } from "./serialized-lock.js";
import {
  fetchHostedExecutionWebControlPlaneResponse,
} from "./web-control-plane.ts";
import type {
  RunnerWriteFenceToken,
} from "./user-runner/runner-state-store.js";
import {
  RunnerWriteFenceAlreadyActiveError,
  RunnerStateStore,
} from "./user-runner/runner-state-store.js";
import { normalizeFutureWakeAt } from "./user-runner/runner-state-helpers.js";
import { RunnerSecretsService } from "./user-runner/runner-secrets.js";
import type {
  DurableObjectStateLike,
  RunnerStateRecord,
} from "./user-runner/types.js";
import { computeRetryDelayMs } from "./user-runner/types.js";
import {
  HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND,
  type HostedExecutionWorkspaceInvocationJobInput,
} from "./runner-job-transport.js";

export type { DurableObjectStateLike } from "./user-runner/types.js";

const IMMEDIATE_WAKE_RETRY_DELAY_MS = 1_000;
const FRESH_WRITE_FENCE_STARTUP_GRACE_MS = 15_000;

type RunnerProgressDemand =
  | {
      kind: "active-runtime";
      record: RunnerStateRecord;
    }
  | {
      kind: "mailbox-backlog";
      record: RunnerStateRecord;
    }
  | {
      kind: "scheduled-runtime";
      record: RunnerStateRecord;
      reason: "retry" | "wake";
    };

type EnsureRunnerProgressResult =
  | {
      demand: null;
      kind: "caught-up";
      record: RunnerStateRecord;
    }
  | {
      containerResult:
        | Extract<RunnerContainerEnsureProcessingResult, { kind: "accepted" }>
        | null;
      demand: RunnerProgressDemand;
      kind: "processing-ensured";
      nextAlarmAt?: string | null;
      record: RunnerStateRecord;
    }
  | {
      containerResult:
        | Extract<RunnerContainerEnsureProcessingResult, { kind: "start-required" }>
        | Extract<RunnerContainerEnsureProcessingResult, { kind: "retry-scheduled" }>;
      demand: RunnerProgressDemand;
      localEnsurePromise: Promise<HostedWorkspaceInvocationResult> | null;
      kind: "processing-started";
      nextAlarmAt?: string | null;
      previousAttemptId: string;
      record: RunnerStateRecord;
    }
  | {
      containerResult: null;
      demand: RunnerProgressDemand;
      localEnsurePromise: Promise<HostedWorkspaceInvocationResult> | null;
      kind: "processing-started";
      nextAlarmAt?: string | null;
      record: RunnerStateRecord;
    }
  | {
      deferredFreshWriteFenceReplacement?: boolean;
      demand: RunnerProgressDemand | null;
      kind: "retry-scheduled";
      record: RunnerStateRecord;
      statusReadFailed?: boolean;
      containerResult:
        | Extract<RunnerContainerEnsureProcessingResult, { kind: "start-required" }>
        | Extract<RunnerContainerEnsureProcessingResult, { kind: "retry-scheduled" }>
        | null;
    };

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

interface RunnerProgressInput {
  aiUsageAllowDecision?: HostedAiUsageAllowDecision | null;
  reason: HostedWorkspaceInvocationReason;
}

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

class HostedRunnerRetryAlreadyRecordedError extends Error {
  constructor(
    message: string,
    readonly record: RunnerStateRecord,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HostedRunnerRetryAlreadyRecordedError";
  }
}

export class HostedUserRunner {
  private readonly stateStore: RunnerStateStore;
  private readonly runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
  private runnerStores: RunnerUserStores | null = null;
  private runtimeCryptoContextLock: Promise<void> | null = null;
  private localEnsureInFlight: Promise<HostedWorkspaceInvocationResult> | null = null;
  private readonly retiredEnsurePromises = new WeakSet<Promise<HostedWorkspaceInvocationResult>>();

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
    try {
      const progress = await this.ensureRunnerProgress({
        reason: "alarm",
      });
      if (
        progress.kind === "processing-started"
        && progress.localEnsurePromise
      ) {
        await progress.localEnsurePromise.catch(() => undefined);
      }
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: buildHostedRunnerMetadataOnlyErrorDetails(error),
        level: "warn",
        message: "Hosted runner alarm reconciliation failed; scheduling retry.",
        phase: "failed",
        userId: await this.tryReadBoundUserId(),
      });
      await this.scheduleRetryAfterFailure(error);
    }
  }

  async runnerStatus(input: { logLimit?: number } = {}): Promise<HostedRunnerStatusResponse> {
    const record = await this.stateStore.readState();
    const webStatus = await this.readHostedRuntimeStatusFromWeb(record.userId, {
      logLimit: input.logLimit,
    });

    return {
      ...webStatus,
      inFlight: this.localEnsureInFlight !== null || record.writeFence !== null,
      ...(record.lastErrorAt ? { lastErrorAt: record.lastErrorAt } : {}),
      ...(record.lastErrorCode ? { lastErrorCode: record.lastErrorCode } : {}),
      ...(record.lastInvocationAt ? { lastInvocationAt: record.lastInvocationAt } : {}),
      nextAlarmAt: earliestIsoDate(
        readRunnerStateAlarmAt(record),
        normalizeFutureWakeAt(webStatus.workspace?.nextWakeAt ?? null),
      ),
      mailboxLag: webStatus.mailboxLag,
      userId: record.userId,
      workspace: webStatus.workspace,
    };
  }

  async deleteHostedUserData(userId: string): Promise<HostedRunnerUserDataDeletionResult> {
    if (this.runnerStores?.userId === userId) {
      this.runnerStores = null;
    }

    await this.stateStore.assertStateForUser(userId);
    const runnerCleanup = await this.stopRunnerBeforeUserDataDeletion(userId);
    const r2 = await this.deleteHostedUserR2DataBestEffort(userId);
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
  }

  async nudgeHostedRunner(input: HostedRunnerNudgeRequest = {}): Promise<HostedRunnerNudgeResult> {
    const progress = await this.ensureRunnerProgress({
      aiUsageAllowDecision: input.aiUsageAllowDecision ?? null,
      reason: "nudge",
    });
    const result = this.toHostedRunnerNudgeResult(progress);

    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: buildEnsureRunnerProgressLogDetails(progress),
      message: "Hosted runner nudge accepted.",
      phase: "scheduled",
      userId: progress.record.userId,
    });

    return result;
  }

  async nudgeHostedRunnerForUser(
    userId: string,
    input: HostedRunnerNudgeRequest = {},
  ): Promise<HostedRunnerNudgeResult> {
    await this.stateStore.bindUser(userId);
    return this.nudgeHostedRunner(input);
  }

  /**
   * Legacy deploy-skew compatibility only: generic nudge only, not a
   * browser-vault scheduler. Delete after 2026-05-25.
   */
  async scheduleBrowserVaultRefreshForUser(input: { userId: string }): Promise<HostedBrowserVaultRefreshScheduleResult> {
    await this.stateStore.bindUser(input.userId);
    await this.nudgeHostedRunner();
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        scheduled: true,
      },
      message: "Hosted runner accepted legacy browser-vault refresh as a generic runtime nudge.",
      phase: "scheduled",
      userId: input.userId,
    });
    return {
      accepted: true,
      scheduled: true,
      userId: input.userId,
    };
  }

  async validateRuntimeWriteFence(input: {
    attemptId: string;
    generation: string;
    userId: string;
    workspaceVersion?: string | null;
  }): Promise<boolean> {
    return (await this.stateStore.validateWriteFenceToken(input)).owns;
  }

  async beginRuntimeWriteFenceForSmoke(input: {
    userId: string;
    workspaceVersion: string;
  }): Promise<RunnerWriteFenceToken | null> {
    await this.stateStore.bindUser(input.userId);
    const existing = await this.stateStore.readState();
    if (existing.writeFence) {
      await this.syncAlarm(existing);
      return null;
    }

    let token: RunnerWriteFenceToken;
    try {
      token = await this.stateStore.beginWriteFence({
        expiresAt: new Date(Date.now() + this.env.runnerTimeoutMs).toISOString(),
        kind: "runtime",
        reason: "manual",
        userId: input.userId,
      });
    } catch (error) {
      const activeRecord = readRunnerWriteFenceAlreadyActiveRecord(error);
      if (!activeRecord) {
        throw error;
      }
      await this.syncAlarm(activeRecord);
      return null;
    }
    return await this.stateStore.bindWriteFenceWorkspaceVersion({
      token,
      workspaceVersion: input.workspaceVersion,
    });
  }

  async finishRuntimeWriteFenceForSmoke(input: {
    attemptId: string;
    generation: string;
    userId: string;
  }): Promise<{ completed: boolean }> {
    const result = await this.stateStore.clearWriteFenceIdentityAfterCompletion({
      attemptId: input.attemptId,
      finishedAt: new Date().toISOString(),
      generation: input.generation,
      userId: input.userId,
    });
    if (result.completed) {
      await this.syncAlarm(await this.stateStore.readState());
    }
    return { completed: result.completed };
  }

  async runUntilIdleOrBudget(input: RunnerProgressInput): Promise<HostedWorkspaceInvocationResult> {
    const progress = await this.ensureRunnerProgress({
      aiUsageAllowDecision: input.aiUsageAllowDecision ?? null,
      reason: input.reason,
    });
    if (
      progress.kind === "processing-started"
      && progress.localEnsurePromise
    ) {
      return await progress.localEnsurePromise;
    }
    if (progress.kind === "caught-up") {
      return {
        nextWakeAt: readRunnerStateAlarmAt(progress.record),
        status: "idle",
      };
    }
    const nextWakeAt = readEnsureRunnerProgressNextAlarmAt(progress);
    return {
      nextWakeAt,
      status: "scheduled",
    };
  }

  private toHostedRunnerNudgeResult(
    progress: EnsureRunnerProgressResult,
  ): HostedRunnerNudgeResult {
    const immediateDriveStarted =
      progress.kind === "processing-started"
      && progress.localEnsurePromise !== null;
    const nextAlarmAt = readEnsureRunnerProgressNextAlarmAt(progress);
    const kind = progress.kind === "caught-up"
      ? "caught-up"
      : progress.kind === "retry-scheduled"
      ? "retry-scheduled"
      : "processing-ensured";

    return {
      accepted: true,
      alarmScheduled: nextAlarmAt !== null,
      kind,
      immediateDriveStarted,
      inFlight:
        progress.record.writeFence !== null
        || progress.kind === "processing-ensured"
        || progress.kind === "processing-started",
      nextAlarmAt,
    };
  }

  private async ensureRunnerProgress(input: RunnerProgressInput): Promise<EnsureRunnerProgressResult> {
    const progressStartedAt = Date.now();
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        localEnsureInFlightPresent: this.localEnsureInFlight !== null,
        progressReason: input.reason,
      },
      message: "Hosted runner progress check started.",
      phase: "scheduled",
      userId: null,
    });
    let demandReadDurationMs = 0;
    const finish = (progress: EnsureRunnerProgressResult): EnsureRunnerProgressResult => {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildEnsureRunnerProgressLogDetails(progress),
          ...buildRunnerRecordTimingLogDetails(progress.record),
          localEnsureInFlightPresent: this.localEnsureInFlight !== null,
          progressDemandReadDurationMs: demandReadDurationMs,
          progressDurationMs: Date.now() - progressStartedAt,
          progressReason: input.reason,
          progressStateNextAlarmAt: readEnsureRunnerProgressNextAlarmAt(progress),
        },
        message: "Hosted runner progress check completed.",
        phase: "scheduled",
        userId: null,
      });
      return progress;
    };

    const demandReadStartedAt = Date.now();
    let demand: RunnerProgressDemand | null;
    try {
      demand = await this.readRunnerProgressDemand();
    } catch (error) {
      demandReadDurationMs = Date.now() - demandReadStartedAt;
      const recheck = await this.scheduleShortProgressRecheck({
        respectBackoff: true,
      });
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          progressReason: input.reason,
          scheduledWakeAt: recheck.nextAlarmAt,
        },
        level: "warn",
        message: "Hosted runner progress demand read failed; scheduled recheck.",
        phase: "scheduled",
        userId: null,
      });
      return finish({
        containerResult: null,
        demand: null,
        kind: "retry-scheduled",
        record: recheck.record,
        statusReadFailed: true,
      });
    }
    demandReadDurationMs = Date.now() - demandReadStartedAt;
    if (!demand) {
      const record = await this.stateStore.readState();
      await this.syncAlarm(record);
      return finish({ demand: null, kind: "caught-up", record });
    }

    const record = demand.record;
    const parkedByRetryCap = await this.parkIfRunnerRetryCapReached({
      record,
      reason: "progress-demand",
    });
    if (parkedByRetryCap) {
      return finish({
        containerResult: null,
        demand,
        kind: "retry-scheduled",
        record: parkedByRetryCap,
      });
    }

    if (record.writeFence) {
      const containerResult = await this.ensureActiveRuntimeProcessing({
        activeRuntime: {
          attemptId: record.writeFence.attemptId,
          leaseGeneration: String(record.writeFence.generation),
          userId: record.userId,
        },
        reason: input.reason,
      });
      if (containerResult.kind === "accepted") {
        if (demand.kind === "mailbox-backlog") {
          const recheck = await this.scheduleShortProgressRecheck();
          return finish({
            containerResult,
            demand,
            kind: "processing-ensured",
            nextAlarmAt: recheck.nextAlarmAt,
            record: recheck.record,
          });
        }
        await this.syncAlarm(record);
        return finish({
          containerResult,
          demand,
          kind: "processing-ensured",
          record,
        });
      }

      if (
        containerResult.kind === "retry-scheduled"
        && this.shouldDeferFreshActiveRuntimeReplacement(record)
      ) {
        const retryRecord = await this.stateStore.markWakePending({
          preferredWakeAt: new Date(Date.now() + IMMEDIATE_WAKE_RETRY_DELAY_MS).toISOString(),
        });
        await this.syncAlarmAt(readRunnerRuntimeDueAt(retryRecord));
        return finish({
          containerResult,
          deferredFreshWriteFenceReplacement: true,
          demand,
          kind: "retry-scheduled",
          record: retryRecord,
        });
      }

      if (
        containerResult.kind === "start-required"
        && this.shouldDeferFreshActiveRuntimeReplacement(record)
      ) {
        const retryRecord = await this.stateStore.markWakePending({
          preferredWakeAt: new Date(Date.now() + IMMEDIATE_WAKE_RETRY_DELAY_MS).toISOString(),
        });
        await this.syncAlarmAt(readRunnerRuntimeDueAt(retryRecord));
        return finish({
          containerResult,
          deferredFreshWriteFenceReplacement: true,
          demand,
          kind: "retry-scheduled",
          record: retryRecord,
        });
      }

      if (!shouldReplaceUnconfirmedActiveRuntime(containerResult)) {
        const retryRecord = await this.stateStore.markWakePending({
          preferredWakeAt: new Date(Date.now() + IMMEDIATE_WAKE_RETRY_DELAY_MS).toISOString(),
        });
        await this.syncAlarmAt(readRunnerRuntimeDueAt(retryRecord));
        return finish({
          containerResult,
          demand,
          kind: "retry-scheduled",
          record: retryRecord,
        });
      }

      const previousFence = record.writeFence;
      const preemptionError = new Error(
        "Hosted runner active write fence was replaced after liveness could not be confirmed.",
      );
      const preempted = await this.stateStore.clearWriteFenceIfCurrent({
        attemptId: previousFence.attemptId,
        failure: {
          backoffUntil: null,
          error: preemptionError,
          failedAt: new Date().toISOString(),
        },
        generation: String(previousFence.generation),
        userId: record.userId,
        wakeAt: new Date().toISOString(),
      });

      if (!preempted.preempted) {
        await this.syncAlarm(preempted.record);
        return await this.ensureRunnerProgress(input);
      }

      this.retireCurrentEnsurePromise();
      const parkedByRetryCap = await this.parkIfRunnerRetryCapReached({
        error: preemptionError,
        reason: "active-fence-replacement",
        record: preempted.record,
      });
      if (parkedByRetryCap) {
        return finish({
          containerResult,
          demand,
          kind: "retry-scheduled",
          record: parkedByRetryCap,
        });
      }
      await this.syncAlarm(preempted.record);

      const localEnsureInFlight = this.kickLocalEnsure({
        aiUsageAllowDecision: input.aiUsageAllowDecision ?? null,
        reason: input.reason,
      });
      return finish({
        containerResult,
        demand,
        localEnsurePromise: localEnsureInFlight,
        kind: "processing-started",
        previousAttemptId: previousFence.attemptId,
        record: preempted.record,
      });
    }

    if (isRunnerBackoffActive(record, Date.now())) {
      const retryRecord = await this.stateStore.markWakePending({
        preferredWakeAt: new Date().toISOString(),
      });
      await this.syncAlarmAt(readRunnerRuntimeDueAt(retryRecord));
      return finish({
        containerResult: null,
        demand,
        kind: "retry-scheduled",
        record: retryRecord,
      });
    }

    this.retireCurrentEnsurePromise();
    const initialAlarmAt = new Date(Date.now() + IMMEDIATE_WAKE_RETRY_DELAY_MS).toISOString();
    await this.syncAlarmAt(initialAlarmAt);
    const localEnsureInFlight = this.kickLocalEnsure({
      aiUsageAllowDecision: input.aiUsageAllowDecision ?? null,
      reason: resolveRunnerProgressReason(demand, input.reason),
    });
    return finish({
      containerResult: null,
      demand,
      localEnsurePromise: localEnsureInFlight,
      kind: "processing-started",
      nextAlarmAt: initialAlarmAt,
      record,
    });
  }

  private async readRunnerProgressDemand(): Promise<RunnerProgressDemand | null> {
    const due = await this.stateStore.readDueWork(Date.now());
    const webStatus = await this.readMailboxBacklogStatus(due.record);

    if (hasMailboxBacklog(webStatus.mailboxLag)) {
      return {
        kind: "mailbox-backlog",
        record: due.record,
      };
    }

    if (due.record.writeFence) {
      return {
        kind: "active-runtime",
        record: due.record,
      };
    }

    if (due.kind === "runtime") {
      return {
        kind: "scheduled-runtime",
        reason: due.reason,
        record: due.record,
      };
    }

    return null;
  }

  private async readMailboxBacklogStatus(
    record: RunnerStateRecord,
  ): Promise<HostedRuntimeWebStatusResponse> {
    const statusReadStartedAt = Date.now();
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        ...buildRunnerRecordTimingLogDetails(record),
      },
      message: "Hosted runner mailbox backlog status read started.",
      phase: "scheduled",
      userId: null,
    });
    const webStatus = await this.readHostedRuntimeStatusFromWeb(record.userId);
    const mailboxBacklogPresent = hasMailboxBacklog(webStatus.mailboxLag);
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        mailboxBacklogPresent,
        mailboxLagLaneCount: webStatus.mailboxLag.length,
        statusReadDurationMs: Date.now() - statusReadStartedAt,
        workspacePresent: webStatus.workspace !== null,
        workspaceVersion: webStatus.workspace?.version ?? null,
      },
      message: "Hosted runner mailbox backlog status read completed.",
      phase: "scheduled",
      userId: null,
    });

    return webStatus;
  }

  private async ensureActiveRuntimeProcessing(
    input: {
      activeRuntime: RunnerRuntimeWakeInput;
      reason: HostedWorkspaceInvocationReason;
    },
  ): Promise<
    | Extract<RunnerContainerEnsureProcessingResult, { kind: "accepted" }>
    | Extract<RunnerContainerEnsureProcessingResult, { kind: "start-required" }>
    | Extract<RunnerContainerEnsureProcessingResult, { kind: "retry-scheduled" }>
  > {
    if (!this.runnerContainerNamespace) {
      return { kind: "retry-scheduled", reason: "missing-container-binding" };
    }

    const container = this.runnerContainerNamespace.getByName(
      resolveHostedExecutionRunnerContainerName({
        source: this.runnerRuntimeEnvSource,
        userId: input.activeRuntime.userId,
      }),
    );

    if (container.ensureProcessing) {
      try {
        const result = await container.ensureProcessing({
          activeRuntime: input.activeRuntime,
          reason: input.reason,
          userId: input.activeRuntime.userId,
        });
        if (
          result.kind === "accepted"
          || result.kind === "start-required"
          || result.kind === "retry-scheduled"
        ) {
          return result;
        }
        return { kind: "retry-scheduled", reason: "legacy-wake-result" };
      } catch (error) {
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: buildHostedRunnerMetadataOnlyErrorDetails(error),
          level: "warn",
          message: "Hosted runner could not ensure active runtime processing.",
          phase: "scheduled",
          userId: input.activeRuntime.userId,
        });
        return { kind: "retry-scheduled", reason: "container-rpc-error" };
      }
    }

    if (!container.wakeRuntime) {
      return { kind: "retry-scheduled", reason: "missing-wake-method" };
    }

    try {
      const runtimeWake = normalizeRunnerRuntimeWakeResult(await container.wakeRuntime(input.activeRuntime));
      if (runtimeWake.kind === "accepted") {
        return { action: "woken", kind: "accepted" };
      }
      if (runtimeWake.kind === "not-wakeable") {
        return { kind: "start-required", reason: "no-active-child" };
      }
      return { kind: "retry-scheduled", reason: runtimeWake.reason };
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: buildHostedRunnerMetadataOnlyErrorDetails(error),
          level: "warn",
          message: "Hosted runner could not ensure active runtime processing.",
          phase: "scheduled",
          userId: input.activeRuntime.userId,
        });
      return { kind: "retry-scheduled", reason: "container-rpc-error" };
    }
  }

  private shouldDeferFreshActiveRuntimeReplacement(record: RunnerStateRecord): boolean {
    if (!record.writeFence) {
      return false;
    }
    const startedAt = Date.parse(record.writeFence.startedAt);
    if (!Number.isFinite(startedAt)) {
      return false;
    }
    return Date.now() - startedAt < FRESH_WRITE_FENCE_STARTUP_GRACE_MS;
  }

  private async scheduleShortProgressRecheck(input: {
    respectBackoff?: boolean;
  } = {}): Promise<{
    nextAlarmAt: string | null;
    record: RunnerStateRecord;
  }> {
    const preferredWakeAt = new Date(Date.now() + IMMEDIATE_WAKE_RETRY_DELAY_MS).toISOString();
    const record = await this.stateStore.markWakePending({
      preferredWakeAt,
    });
    const parkedByRetryCap = await this.parkIfRunnerRetryCapReached({
      record,
      reason: "progress-recheck",
    });
    if (parkedByRetryCap) {
      return {
        nextAlarmAt: readRunnerStateAlarmAt(parkedByRetryCap),
        record: parkedByRetryCap,
      };
    }
    const nextAlarmAt = input.respectBackoff === true
      ? readRunnerRuntimeDueAt(record) ?? preferredWakeAt
      : preferredWakeAt;
    await this.syncAlarmAt(nextAlarmAt);
    return { nextAlarmAt, record };
  }

  async runUntilIdleForTest(input: {
    reason: HostedWorkspaceInvocationReason;
    userId: string;
  }): Promise<HostedWorkspaceInvocationResult> {
    await this.stateStore.bindUser(input.userId);
    const record = await this.stateStore.markWakePending({
      preferredWakeAt: new Date().toISOString(),
      resetRetry: true,
    });
    await this.syncAlarm(record);
    return await this.runUntilIdleOrBudget({
      reason: input.reason,
    });
  }

  async startStuckInvocationForTest(input: {
    expiresInMs?: number;
    reason?: HostedWorkspaceInvocationReason;
    userId: string;
  }): Promise<HostedRunnerStuckInvocationTestResult> {
    await this.stateStore.bindUser(input.userId);
    const token = await this.stateStore.beginWriteFence({
      expiresAt: typeof input.expiresInMs === "number"
        ? new Date(Date.now() + input.expiresInMs).toISOString()
        : "2000-01-01T00:00:00.000Z",
      kind: "runtime",
      reason: input.reason ?? "manual",
      userId: input.userId,
    });
    const record = await this.stateStore.markWakePending({
      preferredWakeAt: new Date().toISOString(),
    });

    return {
      attemptId: token.attemptId,
      nextWakeAt: readRunnerStateAlarmAt(record),
      ok: true,
    };
  }

  private kickLocalEnsure(
    input: RunnerProgressInput,
  ): Promise<HostedWorkspaceInvocationResult> | null {
    if (this.localEnsureInFlight) {
      return null;
    }

    const localEnsure = this.runLocalEnsureLoop(input)
      .finally(() => {
        if (this.localEnsureInFlight === localEnsure) {
          this.localEnsureInFlight = null;
        }
      });
    this.localEnsureInFlight = localEnsure;

    try {
      this.state.waitUntil?.(localEnsure);
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        error,
        level: "warn",
        message: "Hosted runner could not register detached ensure with Durable Object waitUntil.",
        phase: "scheduled",
        userId: null,
      });
    }
    void localEnsure.catch(async (error) => {
      if (this.retiredEnsurePromises.has(localEnsure)) {
        return;
      }
      await this.scheduleRetryAfterFailure(error);
    });
    return localEnsure;
  }

  private retireCurrentEnsurePromise(): void {
    if (!this.localEnsureInFlight) {
      return;
    }
    this.retiredEnsurePromises.add(this.localEnsureInFlight);
    this.localEnsureInFlight = null;
  }

  private async runLocalEnsureLoop(input: RunnerProgressInput): Promise<HostedWorkspaceInvocationResult> {
    const loopStartedAt = Date.now();
    let loopIteration = 0;
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        localEnsureReason: input.reason,
      },
      message: "Hosted runner local ensure loop started.",
      phase: "scheduled",
      userId: null,
    });
    let lastResult: HostedWorkspaceInvocationResult = {
      nextWakeAt: null,
      status: "idle",
    };

    while (true) {
      loopIteration += 1;
      const demandReadStartedAt = Date.now();
      const demand = await this.readRunnerProgressDemand();
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          demandKind: demand?.kind ?? null,
          demandReadDurationMs: Date.now() - demandReadStartedAt,
          localEnsureElapsedMs: Date.now() - loopStartedAt,
          localEnsureIteration: loopIteration,
          localEnsureReason: input.reason,
          ...(demand ? buildRunnerRecordTimingLogDetails(demand.record) : {}),
        },
        message: "Hosted runner local ensure loop demand checked.",
        phase: "scheduled",
        userId: null,
      });
      if (!demand) {
        await this.syncAlarm(await this.stateStore.readState());
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            localEnsureDurationMs: Date.now() - loopStartedAt,
            localEnsureFinishReason: "caught-up",
            localEnsureIteration: loopIteration,
            localEnsureReason: input.reason,
            lastRuntimeStatus: lastResult.status,
            nextWakePresent: lastResult.nextWakeAt !== null,
          },
          message: "Hosted runner local ensure loop completed.",
          phase: "scheduled",
          userId: null,
        });
        return lastResult;
      }

      const parkedByRetryCap = await this.parkIfRunnerRetryCapReached({
        record: demand.record,
        reason: "local-ensure-loop",
      });
      if (parkedByRetryCap) {
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            ...buildRunnerRecordTimingLogDetails(parkedByRetryCap),
            localEnsureDurationMs: Date.now() - loopStartedAt,
            localEnsureFinishReason: "retry-cap-reached",
            localEnsureIteration: loopIteration,
            localEnsureReason: input.reason,
          },
          message: "Hosted runner local ensure loop completed.",
          phase: "scheduled",
          userId: null,
        });
        return {
          nextWakeAt: readRunnerStateAlarmAt(parkedByRetryCap),
          status: "scheduled",
        };
      }

      if (demand.record.writeFence) {
        const activeWait = demand.kind === "mailbox-backlog"
          ? await this.scheduleShortProgressRecheck()
          : null;
        const nextWakeAt = activeWait?.nextAlarmAt
          ?? readRunnerStateAlarmAt(demand.record);
        const logRecord = activeWait?.record ?? demand.record;
        if (!activeWait) {
          await this.syncAlarm(demand.record);
        }
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            ...buildRunnerRecordTimingLogDetails(logRecord),
            localEnsureDurationMs: Date.now() - loopStartedAt,
            localEnsureFinishReason: demand.kind === "mailbox-backlog"
              ? "active-write-fence-mailbox-backlog"
              : "active-write-fence",
            localEnsureIteration: loopIteration,
            localEnsureReason: input.reason,
          },
          message: "Hosted runner local ensure loop completed.",
          phase: "scheduled",
          userId: null,
        });
        return {
          nextWakeAt,
          status: "scheduled",
        };
      }

      if (isRunnerBackoffActive(demand.record, Date.now())) {
        await this.syncAlarmAt(readRunnerRuntimeDueAt(demand.record));
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            ...buildRunnerRecordTimingLogDetails(demand.record),
            localEnsureDurationMs: Date.now() - loopStartedAt,
            localEnsureFinishReason: "backoff-active",
            localEnsureIteration: loopIteration,
            localEnsureReason: input.reason,
          },
          message: "Hosted runner local ensure loop completed.",
          phase: "scheduled",
          userId: null,
        });
        return {
          nextWakeAt: readRunnerRuntimeDueAt(demand.record),
          status: "scheduled",
        };
      }

      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          demandKind: demand.kind,
          localEnsureElapsedMs: Date.now() - loopStartedAt,
          localEnsureIteration: loopIteration,
          runtimeReason: resolveRunnerProgressReason(demand, input.reason),
        },
        message: "Hosted runner local ensure loop starting runtime wake.",
        phase: "runtime.starting",
        userId: null,
      });
      const runtimeWakeStartedAt = Date.now();
      lastResult = await this.runRuntimeWake({
        aiUsageAllowDecision: input.aiUsageAllowDecision ?? null,
        reason: resolveRunnerProgressReason(demand, input.reason),
      });
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          localEnsureElapsedMs: Date.now() - loopStartedAt,
          localEnsureIteration: loopIteration,
          nextWakePresent: lastResult.nextWakeAt !== null,
          runtimeWakeDurationMs: Date.now() - runtimeWakeStartedAt,
          runtimeWakeStatus: lastResult.status,
        },
        message: "Hosted runner local ensure loop runtime wake completed.",
        phase: "checkpoint",
        userId: null,
      });
      if (lastResult.status === "scheduled" || lastResult.status === "budget_exhausted") {
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            localEnsureDurationMs: Date.now() - loopStartedAt,
            localEnsureFinishReason: "runtime-scheduled",
            localEnsureIteration: loopIteration,
            localEnsureReason: input.reason,
            nextWakePresent: lastResult.nextWakeAt !== null,
          },
          message: "Hosted runner local ensure loop completed.",
          phase: "scheduled",
          userId: null,
        });
        return lastResult;
      }
    }
  }

  private async runRuntimeWake(input: RunnerProgressInput): Promise<HostedWorkspaceInvocationResult> {
    const runtimeWakeStartedAt = Date.now();
    const initialRecord = await this.stateStore.readState();
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        ...buildRunnerRecordTimingLogDetails(initialRecord),
        runtimeReason: input.reason,
      },
      message: "Hosted runner runtime wake started.",
      phase: "runtime.starting",
      userId: null,
    });
    let token: RunnerWriteFenceToken;
    try {
      const writeFenceStartedAt = Date.now();
      token = await this.stateStore.beginWriteFence({
        expiresAt: new Date(Date.now() + this.env.runnerTimeoutMs).toISOString(),
        kind: "runtime",
        reason: input.reason,
        userId: initialRecord.userId,
      });
      await this.syncAlarm(await this.stateStore.readState());
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          runtimeReason: input.reason,
          writeFenceAcquireDurationMs: Date.now() - writeFenceStartedAt,
          workspaceAttemptId: token.attemptId,
          workspaceWriteFenceGeneration: token.generation,
        },
        message: "Hosted runner runtime wake write fence acquired.",
        phase: "runtime.starting",
        userId: null,
      });
    } catch (error) {
      if (!(error instanceof RunnerWriteFenceAlreadyActiveError)) {
        throw error;
      }
      await this.syncAlarm(error.record);
      return {
        nextWakeAt: readRunnerStateAlarmAt(error.record),
        status: "scheduled",
      };
    }

    let workspaceVersion: string | null = null;
    try {
      const workspaceReadStartedAt = Date.now();
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          workspaceAttemptId: token.attemptId,
          workspaceWriteFenceGeneration: token.generation,
          workspaceReason: input.reason,
        },
        message: "Hosted runner workspace read started.",
        phase: "runtime.starting",
        userId: initialRecord.userId,
      });
      const workspaceRead = await this.readHostedWorkspaceFromWeb(initialRecord.userId);
      this.assertWorkspaceBelongsToRunnerUser(workspaceRead.workspace, initialRecord.userId);
      workspaceVersion = workspaceRead.workspace?.version ?? "0";
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          workspaceAttemptId: token.attemptId,
          workspaceReadLatencyMs: Date.now() - workspaceReadStartedAt,
          workspaceWriteFenceGeneration: token.generation,
          workspacePresent: workspaceRead.workspace !== null,
          workspaceVersion,
        },
        message: "Hosted runner workspace read completed.",
        phase: "runtime.starting",
        userId: initialRecord.userId,
      });
      token = await this.stateStore.bindWriteFenceWorkspaceVersion({
        token,
        workspaceVersion,
      });

      const result = await this.invokeWorkspaceRunner({
        token,
        reason: input.reason,
        userId: initialRecord.userId,
        workspaceVersion,
      });
      const completed = await this.stateStore.clearWriteFenceAfterCompletion({
        finishedAt: new Date().toISOString(),
        token,
      });
      if (!completed.completed) {
        await this.syncAlarm(completed.record);
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            workspaceAttemptId: token.attemptId,
            workspaceStatus: result.status,
          },
          message: "Hosted runner ignored stale runtime wake completion.",
          phase: "checkpoint",
          userId: initialRecord.userId,
        });
        return {
          nextWakeAt: readRunnerStateAlarmAt(completed.record),
          status: "scheduled",
        };
      }
      const reconciledResult = await this.scheduleAfterRuntimeWake({
        result,
        userId: initialRecord.userId,
      });
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          nextWakePresent: reconciledResult.nextWakeAt != null,
          runtimeWakeDurationMs: Date.now() - runtimeWakeStartedAt,
          workspaceAttemptId: token.attemptId,
          workspaceStatus: reconciledResult.status,
        },
        message: "Hosted runner runtime wake completed.",
        phase: "checkpoint",
        userId: initialRecord.userId,
      });
      return reconciledResult;
    } catch (error) {
      const retryDelayMs = this.resolveRetryDelayMs(initialRecord.failureCount + 1);
      const retryAt = new Date(Date.now() + retryDelayMs).toISOString();
      const failed = await this.stateStore.clearWriteFenceAfterFailure({
        error,
        finishedAt: new Date().toISOString(),
        token,
        retryAt,
      });
      if (!failed.failed) {
        await this.syncAlarm(failed.record);
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            ...buildHostedRunnerMetadataOnlyErrorDetails(error),
            failureCount: failed.record.failureCount,
            maxEventAttempts: this.env.maxEventAttempts,
            workspaceAttemptId: token.attemptId,
            workspaceWriteFenceGeneration: token.generation,
            workspaceReason: input.reason,
            workspaceVersion,
            runtimeRetryDelayMs: retryDelayMs,
            runtimeRetryAt: retryAt,
          },
          level: "warn",
          message: "Hosted runner ignored stale runtime wake failure.",
          phase: "failed",
          userId: initialRecord.userId,
        });
        return {
          nextWakeAt: readRunnerStateAlarmAt(failed.record),
          status: "scheduled",
        };
      }
      const parkedByRetryCap = await this.parkIfRunnerRetryCapReached({
        error,
        reason: "runtime-wake-failure",
        record: failed.record,
      });
      if (parkedByRetryCap) {
        return {
          nextWakeAt: readRunnerStateAlarmAt(parkedByRetryCap),
          status: "scheduled",
        };
      }
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          failureCount: failed.record.failureCount,
          maxEventAttempts: this.env.maxEventAttempts,
          workspaceAttemptId: token.attemptId,
          workspaceWriteFenceGeneration: token.generation,
          workspaceReason: input.reason,
          workspaceVersion,
          runtimeRetryDelayMs: retryDelayMs,
          runtimeRetryAt: retryAt,
        },
        level: "warn",
        message: "Hosted runner runtime wake failed.",
        phase: "failed",
        userId: initialRecord.userId,
      });
      try {
        await this.syncAlarm(failed.record);
      } catch (alarmError) {
        throw new HostedRunnerRetryAlreadyRecordedError(
          "Hosted runner retry was recorded, but alarm sync failed.",
          failed.record,
          { cause: alarmError },
        );
      }
      return {
        nextWakeAt: readRunnerStateAlarmAt(failed.record),
        status: "scheduled",
      };
    }
  }

  private async scheduleAfterRuntimeWake(input: {
    result: HostedWorkspaceInvocationResult;
    userId: string;
  }): Promise<HostedWorkspaceInvocationResult> {
    let webStatus: HostedRuntimeWebStatusResponse;
    try {
      webStatus = await this.readHostedRuntimeStatusFromWeb(input.userId);
    } catch (error) {
      const recheck = await this.scheduleShortProgressRecheck({
        respectBackoff: true,
      });
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          runtimeResultNextWakeAtPresent: input.result.nextWakeAt !== null,
          scheduledWakeAt: recheck.nextAlarmAt,
        },
        level: "warn",
        message: "Hosted runner runtime wake completion reconciliation failed; scheduled recheck.",
        phase: "checkpoint",
        userId: input.userId,
      });
      return {
        ...input.result,
        nextWakeAt: recheck.nextAlarmAt,
        status: "scheduled",
      };
    }
    const mailboxBacklogPresent = hasMailboxBacklog(webStatus.mailboxLag);
    if (mailboxBacklogPresent) {
      const recheck = await this.scheduleShortProgressRecheck();
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          mailboxBacklogPresent,
          mailboxLagLaneCount: webStatus.mailboxLag.length,
          runtimeResultNextWakeAtPresent: input.result.nextWakeAt !== null,
          scheduledWakeAt: recheck.nextAlarmAt,
          workspaceNextWakeAtPresent: webStatus.workspace?.nextWakeAt != null,
          workspaceVersion: webStatus.workspace?.version ?? null,
        },
        message: "Hosted runner reconciled runtime wake completion.",
        phase: "checkpoint",
        userId: input.userId,
      });
      return {
        ...input.result,
        nextWakeAt: recheck.nextAlarmAt,
        status: "scheduled",
      };
    }

    const runtimeResultNextWakeAt = normalizeFutureWakeAt(input.result.nextWakeAt ?? null);
    if (isImmediateRuntimeWakeRequest(input.result.nextWakeAt ?? null)) {
      const recheck = await this.scheduleShortProgressRecheck();
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          mailboxBacklogPresent,
          mailboxLagLaneCount: webStatus.mailboxLag.length,
          runtimeResultNextWakeAtPresent: true,
          scheduledWakeAt: recheck.nextAlarmAt,
          workspaceNextWakeAtPresent: webStatus.workspace?.nextWakeAt != null,
          workspaceVersion: webStatus.workspace?.version ?? null,
        },
        message: "Hosted runner reconciled immediate runtime wake request.",
        phase: "checkpoint",
        userId: input.userId,
      });
      return {
        ...input.result,
        nextWakeAt: recheck.nextAlarmAt,
        status: "scheduled",
      };
    }

    const nextWakeAt = earliestIsoDate(
      normalizeFutureWakeAt(webStatus.workspace?.nextWakeAt ?? null),
      runtimeResultNextWakeAt,
    );
    const record = await this.stateStore.scheduleNextWake({
      nextWakeAt,
    });
    await this.syncAlarm(record);
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        mailboxBacklogPresent,
        mailboxLagLaneCount: webStatus.mailboxLag.length,
        runtimeResultNextWakeAtPresent: input.result.nextWakeAt !== null,
        scheduledWakeAt: nextWakeAt,
        workspaceNextWakeAtPresent: webStatus.workspace?.nextWakeAt != null,
        workspaceVersion: webStatus.workspace?.version ?? null,
      },
      message: "Hosted runner reconciled runtime wake completion.",
      phase: "checkpoint",
      userId: input.userId,
    });
    return {
      ...input.result,
      nextWakeAt,
      status: nextWakeAt !== null
        ? "scheduled"
        : input.result.status === "budget_exhausted"
        ? "budget_exhausted"
        : "idle",
    };
  }

  private async invokeWorkspaceRunner(input: {
    token: RunnerWriteFenceToken;
    reason: HostedWorkspaceInvocationReason;
    userId: string;
    workspaceVersion: string;
  }): Promise<HostedWorkspaceInvocationResult> {
    if (!this.runnerContainerNamespace) {
      throw new Error("Native hosted execution requires a RunnerContainer binding.");
    }

    const forwardedEnv = buildHostedRunnerContainerEnv(
      this.runnerRuntimeEnvSource,
    );
    const configSource = this.readRunnerRuntimeConfigSource();
    const runtimeConfig = await this.buildForegroundRunnerJobRuntimeConfig({
      configSource,
      forwardedEnv,
      userId: input.userId,
    });
    const userEnv = runtimeConfig.userEnv ?? {};
    const runnerContainerName = resolveHostedExecutionRunnerContainerName({
      source: this.runnerRuntimeEnvSource,
      userId: input.userId,
    });
    const job: HostedExecutionWorkspaceInvocationJobInput = {
      kind: HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND,
      request: {
        attemptId: input.token.attemptId,
        deadlineAt: input.token.expiresAt,
        idleCheckpointDelayMs: this.env.idleCheckpointDelayMs,
        leaseGeneration: input.token.generation,
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
        runnerContainerName,
        workspaceAttemptId: input.token.attemptId,
        workspaceWriteFenceGeneration: input.token.generation,
        workspaceReason: input.reason,
        workspaceVersion: input.workspaceVersion,
      },
      message: "Hosted runner prepared workspace invocation.",
      phase: "wake.running",
      userId: input.userId,
    });

    return await invokeHostedExecutionContainerRunner({
      job,
      runnerContainerName,
      runnerContainerNamespace: this.runnerContainerNamespace,
      signal: AbortSignal.timeout(this.env.runnerTimeoutMs),
      timeoutMs: this.env.runnerTimeoutMs,
      userId: input.userId,
    });
  }

  private async buildForegroundRunnerJobRuntimeConfig(input: {
    configSource: Readonly<Record<string, string | undefined>>;
    forwardedEnv: Readonly<Record<string, string>>;
    userId: string;
  }): Promise<ReturnType<typeof buildHostedRunnerJobRuntimeConfig>> {
    const { runnerSecrets: runnerSecretsService } = await this.ensureRunnerStores(input.userId);
    const runnerSecrets = await runnerSecretsService.readRunnerSecrets(input.userId);
    return buildHostedRunnerJobRuntimeConfig({
      configSource: input.configSource,
      forwardedEnv: input.forwardedEnv,
      rewritePlatformUrlsForContainer: true,
      runnerSecrets,
    });
  }

  private async syncAlarm(record: RunnerStateRecord): Promise<void> {
    const nextAlarmAt = readRunnerStateAlarmAt(record);
    await this.syncAlarmAt(nextAlarmAt);
  }

  private async syncAlarmAt(nextAlarmAt: string | null): Promise<void> {
    if (!nextAlarmAt) {
      await this.state.storage.deleteAlarm?.();
      return;
    }

    await this.state.storage.setAlarm(new Date(nextAlarmAt));
  }

  private async parkRunnerAfterRetryCap(input: {
    error?: unknown;
    reason: string;
    record: RunnerStateRecord;
  }): Promise<RunnerStateRecord> {
    const parked = input.record.writeFence
      ? input.record
      : await this.stateStore.parkAfterRetryCap();
    await this.syncAlarm(parked);
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        ...buildHostedRunnerMetadataOnlyErrorDetails(input.error),
        activeWriteFencePresent: parked.writeFence !== null,
        failureCount: parked.failureCount,
        lastErrorCode: parked.lastErrorCode,
        maxEventAttempts: this.env.maxEventAttempts,
        retryCapReason: input.reason,
      },
      level: "warn",
      message: "Hosted runner parked after retry cap.",
      phase: "scheduled",
      userId: null,
    });
    return parked;
  }

  private async parkIfRunnerRetryCapReached(input: {
    error?: unknown;
    reason: string;
    record: RunnerStateRecord;
  }): Promise<RunnerStateRecord | null> {
    if (
      input.record.writeFence
      || !isRunnerRetryCapReached(input.record, this.env.maxEventAttempts)
    ) {
      return null;
    }

    return this.parkRunnerAfterRetryCap(input);
  }

  private async scheduleRetryAfterFailure(error: unknown): Promise<void> {
    try {
      if (error instanceof HostedRunnerRetryAlreadyRecordedError) {
        const parkedByRetryCap = await this.parkIfRunnerRetryCapReached({
          error,
          reason: "retry-already-recorded",
          record: error.record,
        });
        if (parkedByRetryCap) {
          return;
        }
        await this.syncAlarm(error.record);
        return;
      }
      const currentRecord = await this.stateStore.readState();
      const retryDelayMs = this.resolveRetryDelayMs(currentRecord.failureCount + 1);
      const retryAt = new Date(Date.now() + retryDelayMs).toISOString();
      const record = await this.stateStore.scheduleRetry({
        error,
        retryAt,
      });
      const parkedByRetryCap = await this.parkIfRunnerRetryCapReached({
        error,
        reason: "detached-ensure-failure",
        record,
      });
      if (parkedByRetryCap) {
        return;
      }
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          failureCount: record.failureCount,
          maxEventAttempts: this.env.maxEventAttempts,
          runtimeRetryDelayMs: retryDelayMs,
          runtimeRetryAt: retryAt,
        },
        level: "warn",
        message: "Hosted runner scheduled retry after failure.",
        phase: "scheduled",
        userId: await this.tryReadBoundUserId(),
      });
      await this.syncAlarm(record);
    } catch (retryError) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: buildHostedRunnerMetadataOnlyErrorDetails(retryError),
        level: "warn",
        message: "Hosted runner retry scheduling failed.",
        phase: "failed",
        userId: await this.tryReadBoundUserId(),
      });
    }
  }

  private resolveRetryDelayMs(attempts: number): number {
    return computeRetryDelayMs(
      Math.max(IMMEDIATE_WAKE_RETRY_DELAY_MS, this.env.retryDelayMs),
      attempts,
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

  private async stopRunnerBeforeUserDataDeletion(userId: string): Promise<{
    activeInvocationPreempted: boolean;
    runnerContainerDestroyAttempted: boolean;
    runnerContainerDestroyOk: boolean;
  }> {
    const preemption = await this.stateStore.clearWriteFenceForUserDeletion(userId);
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
        message: "Hosted runner cleared active write fence before user data deletion.",
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

  private async tryReadBoundUserId(): Promise<string | null> {
    try {
      return (await this.stateStore.readState()).userId;
    } catch {
      return null;
    }
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

function readRunnerStateAlarmAt(record: RunnerStateRecord): string | null {
  if (record.writeFence) {
    return record.writeFence.expiresAt;
  }
  return readRunnerRuntimeDueAt(record);
}

function hasMailboxBacklog(
  mailboxLag: HostedRuntimeWebStatusResponse["mailboxLag"],
): boolean {
  for (const lane of mailboxLag) {
    if (compareHostedMailboxSeq(lane.maxSeq, lane.importedSeq) <= 0) {
      continue;
    }
    return true;
  }
  return false;
}

function resolveRunnerProgressReason(
  demand: RunnerProgressDemand,
  requestedReason: HostedWorkspaceInvocationReason,
): HostedWorkspaceInvocationReason {
  return demand.kind === "scheduled-runtime"
    && demand.reason === "retry"
    && requestedReason === "alarm"
    ? "retry"
    : requestedReason;
}

function compareHostedMailboxSeq(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  if (leftValue === rightValue) {
    return 0;
  }
  return leftValue > rightValue ? 1 : -1;
}

function readRunnerRuntimeDueAt(record: RunnerStateRecord): string | null {
  if (!record.wakeAt) {
    return null;
  }
  return latestIsoDate(record.wakeAt, record.backoffUntil);
}

function isRunnerBackoffActive(record: RunnerStateRecord, nowMs: number): boolean {
  if (!record.backoffUntil) {
    return false;
  }
  const backoffUntilMs = Date.parse(record.backoffUntil);
  return Number.isFinite(backoffUntilMs) && backoffUntilMs > nowMs;
}

function isRunnerRetryCapReached(
  record: RunnerStateRecord,
  maxEventAttempts: number,
): boolean {
  return record.failureCount >= Math.max(1, maxEventAttempts);
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

function latestIsoDate(left: string | null, right: string | null): string | null {
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
  return rightMs > leftMs ? right : left;
}

function safeCleanupErrorCode(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

function readRunnerWriteFenceAlreadyActiveRecord(error: unknown): RunnerStateRecord | null {
  if (error instanceof RunnerWriteFenceAlreadyActiveError) {
    return error.record;
  }
  if (!isObjectRecord(error) || error.name !== "RunnerWriteFenceAlreadyActiveError") {
    return null;
  }
  const record = error.record;
  return isRunnerStateRecord(record) ? record : null;
}

function isRunnerStateRecord(value: unknown): value is RunnerStateRecord {
  return isObjectRecord(value) && "writeFence" in value;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRunnerRuntimeWakeResult(value: unknown): RunnerRuntimeWakeResult {
  if (isObjectRecord(value)) {
    if (value.kind === "accepted") {
      return { kind: "accepted" };
    }
    if (value.kind === "not-wakeable" && value.reason === "no-active-child") {
      return { kind: "not-wakeable", reason: "no-active-child" };
    }
    if (value.kind === "unknown" && typeof value.reason === "string") {
      return {
        kind: "unknown",
        reason: isRunnerRuntimeWakeUnknownReason(value.reason)
          ? value.reason
          : "legacy-wake-result",
      };
    }
    if ("accepted" in value) {
      return { kind: "unknown", reason: "legacy-wake-result" };
    }
  }

  return { kind: "unknown", reason: "legacy-wake-result" };
}

function shouldReplaceUnconfirmedActiveRuntime(
  result:
    | Extract<RunnerContainerEnsureProcessingResult, { kind: "start-required" }>
    | Extract<RunnerContainerEnsureProcessingResult, { kind: "retry-scheduled" }>,
): boolean {
  if (result.kind === "start-required") {
    return true;
  }

  return result.reason === "active-child-rejected"
    || result.reason === "container-rpc-error"
    || result.reason === "container-rpc-timeout";
}

function isRunnerRuntimeWakeUnknownReason(
  value: string,
): value is Extract<RunnerRuntimeWakeResult, { kind: "unknown" }>["reason"] {
  return value === "active-child-rejected"
    || value === "container-rpc-error"
    || value === "container-rpc-timeout"
    || value === "legacy-wake-result"
    || value === "missing-container-binding"
    || value === "missing-wake-method";
}

function buildEnsureRunnerProgressLogDetails(
  progress: EnsureRunnerProgressResult,
): HostedExecutionStructuredLogDetails {
  const containerResult = readEnsureRunnerProgressContainerResult(progress);
  return {
    immediateDriveStarted:
      progress.kind === "processing-started"
      && progress.localEnsurePromise !== null,
    demandKind: progress.demand?.kind ?? null,
    mailboxBacklogPresent: progress.demand?.kind === "mailbox-backlog",
    progressKind: progress.kind,
    containerProcessingAction: readContainerProcessingAction(containerResult),
    containerProcessingResult: containerResult
      ? formatContainerEnsureProcessingResult(containerResult)
      : null,
    freshLocalEnsurePreemptionDeferred:
      progress.kind === "retry-scheduled"
      && progress.deferredFreshWriteFenceReplacement === true
      && progress.containerResult?.kind === "start-required",
    progressStatusReadFailed:
      progress.kind === "retry-scheduled"
      && progress.statusReadFailed === true,
    freshWriteFenceReplacementDeferred:
      progress.kind === "retry-scheduled"
      && progress.deferredFreshWriteFenceReplacement === true,
    staleWriteFencePreempted:
      progress.kind === "processing-started"
      && "previousAttemptId" in progress,
    writeFenceHeldAfterStartRequired:
      progress.kind === "retry-scheduled"
      && progress.deferredFreshWriteFenceReplacement === true
      && progress.containerResult?.kind === "start-required",
    ...(progress.kind === "processing-started" && "previousAttemptId" in progress
      ? {
        previousAttemptId: progress.previousAttemptId,
        progressStarted: progress.localEnsurePromise !== null,
      }
      : {}),
    wakePending: progress.record.wakePending,
  };
}

function readEnsureRunnerProgressNextAlarmAt(
  progress: EnsureRunnerProgressResult,
): string | null {
  if (progress.kind === "retry-scheduled") {
    return readRunnerRuntimeDueAt(progress.record);
  }
  if (
    (progress.kind === "processing-ensured" || progress.kind === "processing-started")
    && progress.nextAlarmAt !== undefined
  ) {
    return progress.nextAlarmAt;
  }
  return readRunnerStateAlarmAt(progress.record);
}

function isImmediateRuntimeWakeRequest(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const parsedMs = Date.parse(value);
  return Number.isFinite(parsedMs) && parsedMs <= Date.now();
}

function buildRunnerRecordTimingLogDetails(
  record: RunnerStateRecord,
  nowMs = Date.now(),
): HostedExecutionStructuredLogDetails {
  const writeFence = record.writeFence;
  const writeFenceStartedAtMs = writeFence ? Date.parse(writeFence.startedAt) : NaN;
  const writeFenceExpiresAtMs = writeFence ? Date.parse(writeFence.expiresAt) : NaN;
  const runtimeDueAt = readRunnerRuntimeDueAt(record);

  return {
    activeWriteFenceAgeMs: Number.isFinite(writeFenceStartedAtMs)
      ? Math.max(0, nowMs - writeFenceStartedAtMs)
      : null,
    activeWriteFenceExpiresInMs: Number.isFinite(writeFenceExpiresAtMs)
      ? Math.max(0, writeFenceExpiresAtMs - nowMs)
      : null,
    activeWriteFenceGeneration: writeFence?.generation ?? null,
    activeWriteFencePresent: writeFence !== null,
    activeWriteFenceWorkspaceVersion: writeFence?.workspaceVersion ?? null,
    backoffActive: isRunnerBackoffActive(record, nowMs),
    failureCount: record.failureCount,
    lastErrorCode: record.lastErrorCode,
    runtimeDueAt,
    runtimeDuePresent: runtimeDueAt !== null,
    wakePending: record.wakePending,
  };
}

function readEnsureRunnerProgressContainerResult(
  progress: EnsureRunnerProgressResult,
): RunnerContainerEnsureProcessingResult | null {
  if (
    progress.kind === "processing-ensured"
    || progress.kind === "processing-started"
    || progress.kind === "retry-scheduled"
  ) {
    return progress.containerResult;
  }
  return null;
}

function readContainerProcessingAction(result: RunnerContainerEnsureProcessingResult | null): string | null {
  if (!result || !("action" in result)) {
    return null;
  }
  return result.action;
}

function formatContainerEnsureProcessingResult(result: RunnerContainerEnsureProcessingResult): string {
  if (result.kind === "accepted") {
    return `accepted:${result.action}`;
  }
  if (result.kind === "start-required") {
    return `start-required:${result.reason}`;
  }
  return `retry-scheduled:${result.reason}`;
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
