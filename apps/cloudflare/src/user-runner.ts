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
import type {
  HostedRuntimeEnsureExecutionRequest,
  HostedRuntimeEnsureExecutionResponse,
} from "@murphai/hosted-execution/orchestration-control";
import {
  buildHostedExecutionSafeErrorDiagnostics,
  emitHostedExecutionStructuredLog,
  type HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";
import {
  parseHostedRuntimeWebStatusResponse,
  parseHostedWorkspaceSnapshotV2Ref,
  parseHostedWorkspaceReadResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_STATUS_PATH,
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";
import {
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
} from "@murphai/hosted-execution/workspace-snapshot-v2";

import type { R2BucketLike } from "./bundle-store.js";
import {
  hostedArtifactUserPrefix,
  hostedBrowserVaultReplicaUserPrefix,
  hostedBundleUserPrefix,
  hostedRunnerSecretsObjectKey,
  hostedWorkspaceSnapshotUserPrefix,
} from "./storage-paths.js";
import type { HostedExecutionEnvironment } from "./env.js";
import { hostedEmailRawMessageUserPrefix } from "./hosted-email.ts";
import { toStringEnvSource } from "./string-env.js";
import {
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
import { RunnerSecretsService } from "./user-runner/runner-secrets.js";
import type {
  DurableObjectStateLike,
  RunnerStateRecord,
} from "./user-runner/types.js";
import {
  HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND,
  type HostedExecutionWorkspaceInvocationJobInput,
} from "./runner-job-transport.js";
import {
  HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
  parseHostedWorkspaceSnapshotOrphanCandidate,
  parseHostedWorkspaceSnapshotUploadSession,
  type HostedWorkspaceSnapshotOrphanCandidate,
  type HostedWorkspaceSnapshotUploadSession,
} from "./workspace-snapshot-store.ts";

export type { DurableObjectStateLike } from "./user-runner/types.js";

const ACTIVE_RUNTIME_WAKE_RECHECK_MARGIN_MS = 5_000;
const WORKSPACE_SNAPSHOT_ORPHAN_CLEANUP_MIN_AGE_MS = 65 * 60_000;

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
  removed: true;
  scheduled: false;
  userId: string;
}

interface RunnerUserStores {
  crypto: HostedUserCryptoContext;
  runnerSecrets: RunnerSecretsService;
  userId: string;
}

interface LegacyRunnerExecutionInput {
  aiUsageAllowDecision?: HostedAiUsageAllowDecision | null;
  reason: HostedWorkspaceInvocationReason;
}

type RuntimeExecutionInput = HostedRuntimeEnsureExecutionRequest & {
  userId: string;
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

class HostedRuntimeExecutionRetryableError extends Error {
  readonly retryable = true;

  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "HostedRuntimeExecutionRetryableError";
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
      const result = await this.stateStore.clearExpiredWriteFence(Date.now());
      await this.syncWatchdogAlarm(result.record);
      if (result.cleared) {
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: buildRunnerRecordTimingLogDetails(result.record),
          message: "Hosted runner alarm cleared an expired write fence.",
          phase: "scheduled",
          userId: result.record.userId,
        });
      }
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: buildHostedRunnerMetadataOnlyErrorDetails(error),
        level: "warn",
        message: "Hosted runner watchdog alarm maintenance failed.",
        phase: "failed",
        userId: await this.tryReadBoundUserId(),
      });
      await this.state.storage.deleteAlarm?.();
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
      nextAlarmAt: readWriteFenceWatchdogAlarmAt(record),
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
    const record = await this.stateStore.readState();
    const execution = await this.ensureRuntimeExecutionForUser({
      aiUsageAllowDecision: input.aiUsageAllowDecision ?? null,
      orchestrationAttemptId: createLegacyCloudflareOrchestrationAttemptId("nudge"),
      reason: "nudge",
      userId: record.userId,
    });
    const updatedRecord = await this.stateStore.readState();
    const result = this.toHostedRunnerNudgeResult(execution, updatedRecord);

    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        runtimeExecutionKind: execution.kind,
        runtimeAttemptId: execution.runtimeAttemptId,
        ...buildRunnerRecordTimingLogDetails(updatedRecord),
      },
      message: "Hosted runner legacy nudge translated to runtime execution.",
      phase: "scheduled",
      userId: updatedRecord.userId,
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

  async ensureRuntimeExecutionForUser(
    input: RuntimeExecutionInput,
  ): Promise<HostedRuntimeEnsureExecutionResponse> {
    await this.stateStore.bindUser(input.userId);
    const record = await this.stateStore.readState();
    if (record.writeFence) {
      return await this.ensureExistingRuntimeExecution(input, record);
    }
    return await this.startRuntimeExecution(input, "started");
  }

  async scheduleBrowserVaultRefreshForUser(input: { userId: string }): Promise<HostedBrowserVaultRefreshScheduleResult> {
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        removed: true,
      },
      message: "Hosted runner legacy browser-vault refresh scheduling is disabled.",
      phase: "scheduled",
      userId: input.userId,
    });
    return {
      accepted: true,
      removed: true,
      scheduled: false,
      userId: input.userId,
    };
  }

  async validateRuntimeWriteFence(input: {
    attemptId: string;
    generation: string;
    userId: string;
    workspaceVersion?: string | null;
  }): Promise<boolean> {
    const validation = await this.stateStore.validateWriteFenceToken(input);
    if (!validation.owns) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: buildRunnerWriteFenceValidationRejectedDetails({
          attemptId: input.attemptId,
          generation: input.generation,
          record: validation.record,
          userId: input.userId,
          workspaceVersion: input.workspaceVersion ?? null,
        }),
        level: "warn",
        message: "Hosted runner runtime write fence validation rejected.",
        phase: "wake.running",
        userId: input.userId,
      });
    }
    return validation.owns;
  }

  async createHostedWorkspaceSnapshotUploadSession(
    input: HostedWorkspaceSnapshotUploadSession,
  ): Promise<HostedWorkspaceSnapshotUploadSession> {
    await this.stateStore.bindUser(input.userId);
    const session = parseHostedWorkspaceSnapshotUploadSession(input);
    if (session.userId !== input.userId) {
      throw new Error("Hosted workspace snapshot upload session user mismatch.");
    }
    const previousCurrent = await this.state.storage.get<unknown>(
      workspaceSnapshotUploadSessionCurrentStorageKey(),
    );
    if (previousCurrent !== undefined) {
      const previousSession = parseHostedWorkspaceSnapshotUploadSession(previousCurrent);
      if (previousSession.userId === input.userId && previousSession.snapshotId !== session.snapshotId) {
        await this.recordHostedWorkspaceSnapshotOrphanCandidate({
          createdAt: new Date().toISOString(),
          objectKey: previousSession.objectKey,
          schema: HOSTED_WORKSPACE_SNAPSHOT_ORPHAN_CANDIDATE_SCHEMA,
          snapshotId: previousSession.snapshotId,
          userId: previousSession.userId,
        });
      }
    }
    await this.state.storage.put(workspaceSnapshotUploadSessionCurrentStorageKey(), session);
    this.state.waitUntil?.(
      this.cleanupHostedWorkspaceSnapshotOrphanCandidatesBestEffort(input.userId),
    );
    return session;
  }

  async recordHostedWorkspaceSnapshotOrphanCandidate(
    input: HostedWorkspaceSnapshotOrphanCandidate,
  ): Promise<HostedWorkspaceSnapshotOrphanCandidate> {
    await this.stateStore.bindUser(input.userId);
    const candidate = parseHostedWorkspaceSnapshotOrphanCandidate(input);
    if (candidate.userId !== input.userId) {
      throw new Error("Hosted workspace snapshot orphan candidate user mismatch.");
    }
    await this.state.storage.put(
      workspaceSnapshotOrphanCandidateStorageKey(candidate.snapshotId),
      candidate,
    );
    return candidate;
  }

  private async cleanupHostedWorkspaceSnapshotOrphanCandidatesBestEffort(
    userId: string,
  ): Promise<void> {
    try {
      await this.cleanupHostedWorkspaceSnapshotOrphanCandidates(userId);
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          reason: safeCleanupErrorCode(error),
        },
        error,
        level: "warn",
        message: "Hosted runner workspace snapshot orphan cleanup failed.",
        phase: "wake.running",
        userId,
      });
    }
  }

  private async cleanupHostedWorkspaceSnapshotOrphanCandidates(
    userId: string,
  ): Promise<void> {
    if (!this.bucket.delete || !this.state.storage.list) {
      return;
    }
    await this.stateStore.bindUser(userId);
    const candidates = await this.state.storage.list<unknown>({
      prefix: workspaceSnapshotOrphanCandidateStoragePrefix(),
    });
    if (candidates.size === 0) {
      return;
    }
    const nowMs = Date.now();
    const eligibleCandidates: Array<[string, HostedWorkspaceSnapshotOrphanCandidate]> = [];

    for (const [key, value] of candidates) {
      const candidate = parseHostedWorkspaceSnapshotOrphanCandidate(value);
      if (candidate.userId !== userId) {
        continue;
      }
      const createdAtMs = Date.parse(candidate.createdAt);
      if (
        !Number.isFinite(createdAtMs)
        || nowMs - createdAtMs < WORKSPACE_SNAPSHOT_ORPHAN_CLEANUP_MIN_AGE_MS
      ) {
        continue;
      }
      eligibleCandidates.push([key, candidate]);
    }
    if (eligibleCandidates.length === 0) {
      return;
    }

    const workspaceRead = await this.readHostedWorkspaceFromWeb(userId);
    this.assertWorkspaceBelongsToRunnerUser(workspaceRead.workspace, userId);
    const currentObjectKey = readHostedWorkspaceV2SnapshotObjectKey(workspaceRead.workspace);

    for (const [key, candidate] of eligibleCandidates) {
      if (candidate.objectKey === currentObjectKey) {
        continue;
      }
      await deleteR2ObjectIfSupported(this.bucket, candidate.objectKey);
      await this.state.storage.delete(key);
    }
  }

  async readHostedWorkspaceSnapshotUploadSession(input: {
    snapshotId: string;
    userId: string;
  }): Promise<HostedWorkspaceSnapshotUploadSession | null> {
    await this.stateStore.bindUser(input.userId);
    const value = await this.state.storage.get<unknown>(
      workspaceSnapshotUploadSessionCurrentStorageKey(),
    );
    if (value === undefined) {
      return null;
    }
    const session = parseHostedWorkspaceSnapshotUploadSession(value);
    if (session.userId !== input.userId) {
      throw new Error("Hosted workspace snapshot upload session is outside the bound user namespace.");
    }
    if (session.snapshotId !== input.snapshotId) {
      return null;
    }
    return session;
  }

  async deleteHostedWorkspaceSnapshotUploadSession(input: {
    snapshotId: string;
    userId: string;
  }): Promise<{ deleted: boolean }> {
    await this.stateStore.bindUser(input.userId);
    const current = await this.state.storage.get<unknown>(
      workspaceSnapshotUploadSessionCurrentStorageKey(),
    );
    if (current === undefined) {
      return { deleted: false };
    }
    const currentSession = parseHostedWorkspaceSnapshotUploadSession(current);
    if (currentSession.userId === input.userId && currentSession.snapshotId === input.snapshotId) {
      return {
        deleted: await this.state.storage.delete(workspaceSnapshotUploadSessionCurrentStorageKey()),
      };
    }
    return { deleted: false };
  }

  async beginRuntimeWriteFenceForSmoke(input: {
    userId: string;
    workspaceVersion: string;
  }): Promise<RunnerWriteFenceToken | null> {
    await this.stateStore.bindUser(input.userId);
    const existing = await this.stateStore.readState();
    if (existing.writeFence) {
      await this.syncWatchdogAlarm(existing);
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
      await this.syncWatchdogAlarm(activeRecord);
      return null;
    }
    const bound = await this.stateStore.bindWriteFenceWorkspaceVersion({
      token,
      workspaceVersion: input.workspaceVersion,
    });
    await this.syncWatchdogAlarm(await this.stateStore.readState());
    return bound;
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
      await this.syncWatchdogAlarm(await this.stateStore.readState());
    }
    return { completed: result.completed };
  }

  async runUntilIdleOrBudget(input: LegacyRunnerExecutionInput): Promise<HostedWorkspaceInvocationResult> {
    const record = await this.stateStore.readState();
    const execution = await this.ensureRuntimeExecutionForUser({
      aiUsageAllowDecision: input.aiUsageAllowDecision ?? null,
      orchestrationAttemptId: createLegacyCloudflareOrchestrationAttemptId("run-until-idle"),
      reason: input.reason,
      userId: record.userId,
    });
    return this.toLegacyWorkspaceInvocationResult(execution);
  }

  private async ensureExistingRuntimeExecution(
    input: RuntimeExecutionInput,
    record: RunnerStateRecord,
  ): Promise<HostedRuntimeEnsureExecutionResponse> {
    if (!record.writeFence) {
      return await this.startRuntimeExecution(input, "started");
    }

    const activeFence = record.writeFence;
    const containerResult = await this.ensureActiveRuntimeProcessing({
      activeRuntime: {
        attemptId: activeFence.attemptId,
        leaseGeneration: String(activeFence.generation),
        userId: record.userId,
      },
      reason: input.reason,
    });

    if (containerResult.kind === "accepted") {
      await this.syncWatchdogAlarm(record);
      return {
        kind: "runtime_wake_sent",
        recommendedRecheckAt: this.computeActiveRuntimeWakeRecheckAt(),
        runtimeAttemptId: activeFence.attemptId,
      };
    }

    if (containerResult.kind === "start-required") {
      const cleared = await this.stateStore.clearWriteFenceForReplacement({
        attemptId: activeFence.attemptId,
        finishedAt: new Date().toISOString(),
        generation: String(activeFence.generation),
        userId: record.userId,
      });
      await this.syncWatchdogAlarm(cleared.record);
      if (!cleared.cleared) {
        throw new HostedRuntimeExecutionRetryableError(
          "Hosted runtime active write fence changed before replacement could start.",
          "active-fence-replacement-stale",
        );
      }

      this.retireCurrentEnsurePromise();
      return await this.startRuntimeExecution(input, "replaced");
    }

    await this.syncWatchdogAlarm(record);
    throw new HostedRuntimeExecutionRetryableError(
      "Hosted runtime active child wake could not be confirmed.",
      containerResult.reason,
    );
  }

  private async startRuntimeExecution(
    input: RuntimeExecutionInput,
    action: "started" | "replaced",
  ): Promise<HostedRuntimeEnsureExecutionResponse> {
    const runtimeWakeStartedAt = Date.now();
    const initialRecord = await this.stateStore.readState();
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        ...buildRunnerRecordTimingLogDetails(initialRecord),
        orchestrationAttemptId: input.orchestrationAttemptId,
        runtimeReason: input.reason,
      },
      message: "Hosted runner runtime execution adapter start requested.",
      phase: "runtime.starting",
      userId: input.userId,
    });

    let token: RunnerWriteFenceToken;
    try {
      token = await this.stateStore.beginWriteFence({
        expiresAt: new Date(Date.now() + this.env.runnerTimeoutMs).toISOString(),
        kind: "runtime",
        reason: input.reason,
        userId: input.userId,
      });
    } catch (error) {
      if (!(error instanceof RunnerWriteFenceAlreadyActiveError)) {
        throw error;
      }
      await this.syncWatchdogAlarm(error.record);
      return await this.ensureExistingRuntimeExecution(input, error.record);
    }

    await this.syncWatchdogAlarm(await this.stateStore.readState());

    let workspaceVersion: string | null = null;
    try {
      const workspaceRead = await this.readHostedWorkspaceFromWeb(input.userId);
      this.assertWorkspaceBelongsToRunnerUser(workspaceRead.workspace, input.userId);
      workspaceVersion = workspaceRead.workspace?.version ?? "0";
      token = await this.stateStore.bindWriteFenceWorkspaceVersion({
        token,
        workspaceVersion,
      });

      const result = await this.invokeWorkspaceRunner({
        token,
        reason: input.reason,
        userId: input.userId,
        workspace: workspaceRead.workspace,
        workspaceVersion,
      });
      const completed = await this.stateStore.clearWriteFenceAfterCompletion({
        finishedAt: new Date().toISOString(),
        token,
      });
      await this.syncWatchdogAlarm(completed.record);
      if (!completed.completed) {
        throw new HostedRuntimeExecutionRetryableError(
          "Hosted runtime execution completed after its write fence changed.",
          "runtime-completion-stale",
        );
      }

      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          orchestrationAttemptId: input.orchestrationAttemptId,
          runtimeExecutionDurationMs: Date.now() - runtimeWakeStartedAt,
          runtimeResultNextWakeAtPresent: result.nextWakeAt != null,
          workspaceAttemptId: token.attemptId,
          workspaceStatus: result.status,
          workspaceVersion,
        },
        message: "Hosted runner runtime execution adapter completed.",
        phase: "checkpoint",
        userId: input.userId,
      });

      return {
        action,
        kind: "runtime_completed",
        runtimeAttemptId: token.attemptId,
        runtimeResultNextWakeAt: result.nextWakeAt ?? null,
        runtimeStatus: result.status,
      };
    } catch (error) {
      const failed = await this.stateStore.clearWriteFenceAfterTransportFailure({
        error,
        finishedAt: new Date().toISOString(),
        token,
      });
      await this.syncWatchdogAlarm(failed.record);
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          orchestrationAttemptId: input.orchestrationAttemptId,
          transportFailureFenceCleared: failed.failed,
          workspaceAttemptId: token.attemptId,
          workspaceReason: input.reason,
          workspaceVersion,
        },
        level: "warn",
        message: "Hosted runner runtime execution adapter failed.",
        phase: "failed",
        userId: input.userId,
      });
      throw error;
    }
  }

  private toHostedRunnerNudgeResult(
    execution: HostedRuntimeEnsureExecutionResponse,
    record: RunnerStateRecord,
  ): HostedRunnerNudgeResult {
    const watchdogAlarmAt = readWriteFenceWatchdogAlarmAt(record);
    return {
      accepted: true,
      alarmScheduled: watchdogAlarmAt !== null,
      kind: "processing-ensured",
      immediateDriveStarted: execution.kind === "runtime_completed",
      inFlight: record.writeFence !== null || execution.kind === "runtime_wake_sent",
      nextAlarmAt: watchdogAlarmAt,
    };
  }

  private toLegacyWorkspaceInvocationResult(
    execution: HostedRuntimeEnsureExecutionResponse,
  ): HostedWorkspaceInvocationResult {
    if (execution.kind === "runtime_completed") {
      return {
        nextWakeAt: execution.runtimeResultNextWakeAt,
        status: execution.runtimeStatus,
      };
    }

    return {
      nextWakeAt: execution.recommendedRecheckAt,
      status: "scheduled",
    };
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

  async runUntilIdleForTest(input: {
    reason: HostedWorkspaceInvocationReason;
    userId: string;
  }): Promise<HostedWorkspaceInvocationResult> {
    await this.stateStore.bindUser(input.userId);
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
    const record = await this.stateStore.readState();
    await this.syncWatchdogAlarm(record);

    return {
      attemptId: token.attemptId,
      nextWakeAt: readWriteFenceWatchdogAlarmAt(record),
      ok: true,
    };
  }

  private retireCurrentEnsurePromise(): void {
    if (!this.localEnsureInFlight) {
      return;
    }
    this.retiredEnsurePromises.add(this.localEnsureInFlight);
    this.localEnsureInFlight = null;
  }

  private async invokeWorkspaceRunner(input: {
    token: RunnerWriteFenceToken;
    reason: HostedWorkspaceInvocationReason;
    userId: string;
    workspace: HostedWorkspaceState | null;
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
        workspace: input.workspace,
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

  private async syncWatchdogAlarm(record: RunnerStateRecord): Promise<void> {
    await this.syncAlarmAt(record.writeFence?.expiresAt ?? null);
  }

  private async syncAlarmAt(nextAlarmAt: string | null): Promise<void> {
    if (!nextAlarmAt) {
      await this.state.storage.deleteAlarm?.();
      return;
    }

    await this.state.storage.setAlarm(new Date(nextAlarmAt));
  }

  private computeActiveRuntimeWakeRecheckAt(): string {
    return new Date(
      Date.now() + this.env.idleCheckpointDelayMs + ACTIVE_RUNTIME_WAKE_RECHECK_MARGIN_MS,
    ).toISOString();
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
    const userScopedSkipReasons: string[] = [];

    let deletedObjectCount = 0;
    if (supportsPrefixDeletion) {
      const prefixes = [
        await hostedBundleUserPrefix({ userId }),
        await hostedArtifactUserPrefix({ userId }),
        await hostedBrowserVaultReplicaUserPrefix({ userId }),
        await hostedWorkspaceSnapshotUserPrefix({ userId }),
      ];
      for (const prefix of prefixes) {
        deletedObjectCount += (await deleteR2ObjectsWithPrefix(this.bucket, prefix)).deletedCount;
      }

      deletedObjectCount += (await deleteR2ObjectIfSupported(
        this.bucket,
        await hostedRunnerSecretsObjectKey({ userId }),
      )).deletedCount;
      deletedObjectCount += (await deleteR2ObjectsWithPrefix(
        this.bucket,
        await hostedEmailRawMessageUserPrefix({ userId }),
      )).deletedCount;
    } else {
      userScopedSkipReasons.push("R2PrefixDeletionUnsupported");
    }

    const skippedUserScopedPrefixes =
      !supportsPrefixDeletion;
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

function readWriteFenceWatchdogAlarmAt(record: RunnerStateRecord): string | null {
  return record.writeFence?.expiresAt ?? null;
}

function createLegacyCloudflareOrchestrationAttemptId(source: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `legacy-cloudflare-${source}-${crypto.randomUUID()}`;
  }

  return `legacy-cloudflare-${source}-${Date.now().toString(36)}`;
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

function buildRunnerRecordTimingLogDetails(
  record: RunnerStateRecord,
  nowMs = Date.now(),
): HostedExecutionStructuredLogDetails {
  const writeFence = record.writeFence;
  const writeFenceStartedAtMs = writeFence ? Date.parse(writeFence.startedAt) : NaN;
  const writeFenceExpiresAtMs = writeFence ? Date.parse(writeFence.expiresAt) : NaN;

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
    failureCount: record.failureCount,
    lastErrorCode: record.lastErrorCode,
    watchdogAlarmAt: readWriteFenceWatchdogAlarmAt(record),
  };
}

function buildRunnerWriteFenceValidationRejectedDetails(input: {
  attemptId: string;
  generation: string;
  record: RunnerStateRecord;
  userId: string;
  workspaceVersion: string | null;
}): HostedExecutionStructuredLogDetails {
  const writeFence = input.record.writeFence;
  const writeFenceAttemptMatches = writeFence !== null
    && writeFence.attemptId === input.attemptId;
  const writeFenceGenerationMatches = writeFence !== null
    && String(writeFence.generation) === input.generation;
  const writeFenceUserMatches = input.record.userId === input.userId;
  const writeFenceWorkspaceVersionMatches = input.workspaceVersion === null
    || (
      writeFence !== null
      && writeFence.workspaceVersion === input.workspaceVersion
    );

  return {
    activeWriteFencePresent: writeFence !== null,
    activeWriteFenceWorkspaceVersionPresent: writeFence?.workspaceVersion !== null
      && writeFence?.workspaceVersion !== undefined,
    writeFenceAttemptMatches,
    writeFenceGenerationMatches,
    writeFenceUserMatches,
    writeFenceWorkspaceVersionMatches,
    writeFenceValidationRejectReason: readRunnerWriteFenceValidationRejectReason({
      writeFenceAttemptMatches,
      writeFenceGenerationMatches,
      writeFencePresent: writeFence !== null,
      writeFenceUserMatches,
      writeFenceWorkspaceVersionMatches,
    }),
  };
}

function readRunnerWriteFenceValidationRejectReason(input: {
  writeFenceAttemptMatches: boolean;
  writeFenceGenerationMatches: boolean;
  writeFencePresent: boolean;
  writeFenceUserMatches: boolean;
  writeFenceWorkspaceVersionMatches: boolean;
}): string {
  if (!input.writeFencePresent) {
    return "no_active_write_fence";
  }
  if (!input.writeFenceAttemptMatches) {
    return "attempt_mismatch";
  }
  if (!input.writeFenceGenerationMatches) {
    return "generation_mismatch";
  }
  if (!input.writeFenceUserMatches) {
    return "user_mismatch";
  }
  if (!input.writeFenceWorkspaceVersionMatches) {
    return "workspace_version_mismatch";
  }
  return "unknown";
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

function workspaceSnapshotUploadSessionCurrentStorageKey(): string {
  return "workspace-snapshot-upload-session:current";
}

function workspaceSnapshotOrphanCandidateStoragePrefix(): string {
  return "workspace-snapshot-orphan-candidate:";
}

function workspaceSnapshotOrphanCandidateStorageKey(snapshotId: string): string {
  return `${workspaceSnapshotOrphanCandidateStoragePrefix()}${snapshotId}`;
}

function readHostedWorkspaceV2SnapshotObjectKey(
  workspace: HostedWorkspaceState | null,
): string | null {
  const snapshotRef = workspace?.snapshotRef;
  const record = readObjectRecord(snapshotRef);
  if (!record || record.schema !== HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA) {
    return null;
  }
  return parseHostedWorkspaceSnapshotV2Ref(
    record,
    "Hosted workspace snapshot orphan cleanup current snapshotRef",
  ).objectKey;
}

function readObjectRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
