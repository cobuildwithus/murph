import {
  type HostedRunnerStatusResponse,
  type HostedRuntimeLogRequest,
  type HostedRuntimeWebStatusResponse,
  type HostedWorkspaceReadResponse,
  type HostedWorkspaceInvocationReason,
  type HostedWorkspaceInvocationResult,
  type HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedRuntimeDemandRunSource,
  HostedRuntimeEnsureProcessingRequest,
  HostedRuntimeEnsureProcessingResponse,
  HostedRuntimePrewarmRequest,
  HostedRuntimePrewarmResponse,
} from "@murphai/hosted-execution/orchestration-control";
import {
  DEFAULT_HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS,
  HOSTED_RUNTIME_PROCESSING_COMMAND_RESPONSE_MARGIN_MS,
  HOSTED_RUNTIME_PREWARM_TIMEOUT_MS,
} from "@murphai/hosted-execution/contracts";
import {
  buildHostedExecutionSafeErrorDiagnostics,
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  type HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";
import {
  parseHostedRuntimeLogResponse,
  parseHostedRuntimeWebStatusResponse,
  parseHostedWorkspaceSnapshotV2Ref,
  parseHostedWorkspaceReadResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_LOG_PATH,
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
import {
  computeHostedRuntimeProcessingRecheckDelayMs,
} from "./runtime-processing-timing.ts";
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

const RUNTIME_PROCESSING_STARTUP_GRACE_MS = 30_000;
const RUNTIME_PROCESSING_STARTUP_CONFIRM_TIMEOUT_MS = 8_000;
const RUNTIME_PROCESSING_COMMAND_BUDGET_TIMEOUT_MESSAGE =
  "Hosted runner runtime processing command budget timed out.";
const WORKSPACE_SNAPSHOT_ORPHAN_CLEANUP_MIN_AGE_MS = 65 * 60_000;
const WORKSPACE_SNAPSHOT_PATH_HASH_SECRET_CONTEXT =
  "murph.hosted.workspace-snapshot-path-hash.v1";
const WORKSPACE_SNAPSHOT_PATH_HASH_SECRET_TEXT_ENCODER = new TextEncoder();

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

interface RunnerUserStores {
  crypto: HostedUserCryptoContext;
  runnerSecrets: RunnerSecretsService;
  userId: string;
}

type RuntimeProcessingInput = HostedRuntimeEnsureProcessingRequest & {
  commandTimeoutMs?: number;
  userId: string;
};

type RuntimePrewarmInput = HostedRuntimePrewarmRequest & {
  userId: string;
};

type RuntimeInvocationInput = {
  orchestrationAttemptId: string;
  reason: HostedWorkspaceInvocationReason;
  source?: HostedRuntimeDemandRunSource;
  userId: string;
};

function toRuntimeInvocationInput(input: RuntimeProcessingInput): RuntimeInvocationInput {
  return {
    orchestrationAttemptId: input.orchestrationAttemptId,
    reason: input.reason,
    ...(input.source ? { source: input.source } : {}),
    userId: input.userId,
  };
}

type RuntimeProcessingRetryReason =
  | "active_child_rejected"
  | "container_busy"
  | "container_rpc_error"
  | "container_rpc_timeout"
  | "missing_container_binding"
  | "stale_fence_replacement_race";

type RuntimeProcessingStartFailureRetryReason = Extract<
  RuntimeProcessingRetryReason,
  "container_rpc_error" | "container_rpc_timeout" | "missing_container_binding"
>;

interface PreparedRuntimeInvocation {
  input: RuntimeInvocationInput;
  job: HostedExecutionWorkspaceInvocationJobInput;
  runnerContainerName: string;
  token: RunnerWriteFenceToken;
  workspaceVersion: string;
}

interface RuntimeProcessingCommandBudget {
  deadlineAtMs: number;
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

export class HostedUserRunner {
  private readonly stateStore: RunnerStateStore;
  private readonly runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
  private runnerStores: RunnerUserStores | null = null;
  private readonly runtimeExecutionTasks = new Map<string, Promise<void>>();
  private runtimeCryptoContextLock: Promise<void> | null = null;

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
      throw error;
    }
  }

  async runnerStatus(input: { logLimit?: number } = {}): Promise<HostedRunnerStatusResponse> {
    const record = await this.stateStore.readState();
    const activeWriteFence = await this.stateStore.readWriteFenceToken();
    const webStatus = await this.readHostedRuntimeStatusFromWeb(record.userId, {
      logLimit: input.logLimit,
    });

    const status: HostedRunnerStatusResponse & {
      activeWriteFence: RunnerWriteFenceToken | null;
    } = {
      ...webStatus,
      activeWriteFence,
      inFlight: record.writeFence !== null,
      ...(record.lastErrorAt ? { lastErrorAt: record.lastErrorAt } : {}),
      ...(record.lastErrorCode ? { lastErrorCode: record.lastErrorCode } : {}),
      ...(record.lastInvocationAt ? { lastInvocationAt: record.lastInvocationAt } : {}),
      nextAlarmAt: readWriteFenceWatchdogAlarmAt(record),
      mailboxLag: webStatus.mailboxLag,
      userId: record.userId,
      workspace: webStatus.workspace,
    };
    return status;
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

  async ensureRuntimeProcessingForUser(
    input: RuntimeProcessingInput,
  ): Promise<HostedRuntimeEnsureProcessingResponse> {
    const runtimeWakeStartedAt = Date.now();
    const commandBudget = this.createRuntimeProcessingCommandBudget({
      commandTimeoutMs: input.commandTimeoutMs ?? null,
      startedAtMs: runtimeWakeStartedAt,
    });
    await this.stateStore.bindUser(input.userId);
    const record = await this.readRunnerStateAfterClearingExpiredWriteFence();
    if (record.writeFence) {
      return await this.ensureExistingRuntimeProcessing({
        commandBudget,
        input,
        record,
        runtimeWakeStartedAt,
      });
    }
    return await this.startRuntimeProcessing({
      action: "started",
      commandBudget,
      input,
      runtimeWakeStartedAt,
    });
  }

  async prewarmRuntimeContainerForUser(
    input: RuntimePrewarmInput,
  ): Promise<HostedRuntimePrewarmResponse> {
    await this.stateStore.bindUser(input.userId);
    const record = await this.stateStore.readState();
    if (record.writeFence) {
      return this.recordRuntimePrewarmAccepted({
        action: "already_running",
        input,
      });
    }

    if (!this.runnerContainerNamespace) {
      return this.createRuntimePrewarmRetryLater({
        reason: "missing_container_binding",
        userId: input.userId,
      });
    }

    const container = this.runnerContainerNamespace.getByName(
      resolveHostedExecutionRunnerContainerName({
        source: this.runnerRuntimeEnvSource,
        userId: input.userId,
      }),
    );
    if (!container.prewarmForProcessing) {
      return this.createRuntimePrewarmRetryLater({
        reason: "container_rpc_error",
        userId: input.userId,
      });
    }

    try {
      const result = await container.prewarmForProcessing({
        timeoutMs: Math.min(
          this.env.runnerTimeoutMs,
          HOSTED_RUNTIME_PREWARM_TIMEOUT_MS,
        ),
        userId: input.userId,
      });
      if (result.kind === "busy") {
        return this.createRuntimePrewarmRetryLater({
          reason: "container_busy",
          userId: input.userId,
        });
      }
      return this.recordRuntimePrewarmAccepted({
        action: result.action ?? "started",
        input,
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          prewarmAttemptIdPresent: input.prewarmAttemptId.length > 0,
          source: input.source,
        },
        error,
        level: "warn",
        message: "Hosted runner runtime prewarm failed best-effort.",
        phase: "runtime.prewarm",
        userId: input.userId,
      });
      return this.createRuntimePrewarmRetryLater({
        reason: "container_rpc_error",
        userId: input.userId,
      });
    }
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
    this.state.waitUntil(
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

  private async ensureExistingRuntimeProcessing(input: {
    commandBudget: RuntimeProcessingCommandBudget;
    input: RuntimeProcessingInput;
    record: RunnerStateRecord;
    runtimeWakeStartedAt: number;
  }): Promise<HostedRuntimeEnsureProcessingResponse> {
    const record = input.record;
    if (!record.writeFence) {
      return await this.startRuntimeProcessing({
        action: "started",
        commandBudget: input.commandBudget,
        input: input.input,
        runtimeWakeStartedAt: input.runtimeWakeStartedAt,
      });
    }

    const activeFence = record.writeFence;
    if (input.input.source === "workspace_wake") {
      await this.syncWatchdogAlarm(record);
      return this.createActiveWorkspaceWakeRetryLater({
        activeFence,
        userId: input.input.userId,
      });
    }

    const containerResult = await this.ensureActiveRuntimeProcessing({
      activeRuntime: {
        attemptId: activeFence.attemptId,
        leaseGeneration: String(activeFence.generation),
        userId: record.userId,
      },
      commandBudget: input.commandBudget,
      reason: input.input.reason,
    });

    if (containerResult.kind === "accepted") {
      await this.syncWatchdogAlarm(record);
      const action = containerResult.action === "already_running"
        ? "already_running"
        : "woken";
      return {
        action,
        kind: "runtime_processing_accepted",
        recommendedRecheckAt:
          this.computeRuntimeProcessingOwnerWatchdogAt(activeFence),
        runtimeAttemptId: activeFence.attemptId,
      };
    }

    if (containerResult.kind === "start-required") {
      if (this.shouldPreserveStartingWriteFence(activeFence)) {
        await this.syncWatchdogAlarm(record);
        return this.createRuntimeProcessingRetryLater({
          reason: "container_rpc_timeout",
          userId: input.input.userId,
        });
      }

      const cleared = await this.stateStore.clearWriteFenceForReplacement({
        attemptId: activeFence.attemptId,
        finishedAt: new Date().toISOString(),
        generation: String(activeFence.generation),
        userId: record.userId,
      });
      await this.syncWatchdogAlarm(cleared.record);
      if (!cleared.cleared) {
        return this.createRuntimeProcessingRetryLater({
          reason: "stale_fence_replacement_race",
          userId: input.input.userId,
        });
      }
      return await this.startRuntimeProcessing({
        action: "replaced",
        commandBudget: input.commandBudget,
        input: input.input,
        runtimeWakeStartedAt: input.runtimeWakeStartedAt,
      });
    }

    await this.syncWatchdogAlarm(record);
    return this.createRuntimeProcessingRetryLater({
      reason: mapRunnerProcessingRetryReason(containerResult.reason),
      userId: input.input.userId,
    });
  }

  private async startRuntimeProcessing(input: {
    action: "started" | "replaced";
    commandBudget: RuntimeProcessingCommandBudget;
    input: RuntimeProcessingInput;
    runtimeWakeStartedAt: number;
  }): Promise<HostedRuntimeEnsureProcessingResponse> {
    const initialRecord = await this.stateStore.readState();
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        ...buildRunnerRecordTimingLogDetails(initialRecord),
        orchestrationAttemptId: input.input.orchestrationAttemptId,
        runtimeReason: input.input.reason,
      },
      message: "Hosted runner runtime processing start requested.",
      phase: "runtime.starting",
      userId: input.input.userId,
    });

    if (!this.runnerContainerNamespace) {
      return this.createRuntimeProcessingRetryLater({
        reason: "missing_container_binding",
        userId: input.input.userId,
      });
    }

    let token: RunnerWriteFenceToken;
    try {
      token = await this.stateStore.beginWriteFence({
        expiresAt: new Date(Date.now() + this.env.runnerTimeoutMs).toISOString(),
        kind: "runtime",
        reason: input.input.reason,
        userId: input.input.userId,
      });
    } catch (error) {
      if (!(error instanceof RunnerWriteFenceAlreadyActiveError)) {
        throw error;
      }
      await this.syncWatchdogAlarm(error.record);
      return await this.ensureExistingRuntimeProcessing({
        commandBudget: input.commandBudget,
        input: input.input,
        record: error.record,
        runtimeWakeStartedAt: input.runtimeWakeStartedAt,
      });
    }

    await this.syncWatchdogAlarm(await this.stateStore.readState());

    const executionInput = toRuntimeInvocationInput(input.input);
    let prepared: PreparedRuntimeInvocation;
    try {
      prepared = await this.prepareRuntimeExecutionWithFence({
        commandBudget: input.commandBudget,
        input: executionInput,
        token,
      });
    } catch (error) {
      const failed = await this.clearWriteFenceAfterRuntimeStartFailure({
        error,
        input: input.input,
        message: "Hosted runner runtime processing preparation failed.",
        token,
      });
      return failed.response;
    }

    const startupConfirmed = await this.confirmRuntimeContainerStartup({
      commandBudget: input.commandBudget,
      input: input.input,
      runnerContainerName: prepared.runnerContainerName,
      token: prepared.token,
    });
    if (!startupConfirmed.confirmed) {
      return startupConfirmed.response;
    }

    const stillOwnsPreparedFence = await this.confirmPreparedRuntimeWriteFenceIsActive({
      input: input.input,
      token: prepared.token,
    });
    if (!stillOwnsPreparedFence) {
      return this.createRuntimeProcessingRetryLater({
        reason: "stale_fence_replacement_race",
        userId: input.input.userId,
      });
    }

    const background = this.invokePreparedRuntimeExecutionWithFence({
      acceptedProcessingAttempt: true,
      prepared,
      runtimeWakeStartedAt: input.runtimeWakeStartedAt,
    }).then(
      () => undefined,
      () => undefined,
    );
    this.trackRuntimeExecutionTask(prepared.token.attemptId, background);

    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        orchestrationAttemptId: input.input.orchestrationAttemptId,
        runtimeProcessingAction: input.action,
        workspaceAttemptId: prepared.token.attemptId,
        workspaceReason: input.input.reason,
      },
      message: "Hosted runner runtime processing accepted.",
      phase: "runtime.starting",
      userId: input.input.userId,
    });

    return {
      action: input.action,
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: this.computeRuntimeProcessingOwnerWatchdogAt(prepared.token),
      runtimeAttemptId: prepared.token.attemptId,
    };
  }

  private async confirmPreparedRuntimeWriteFenceIsActive(input: {
    input: RuntimeProcessingInput;
    token: RunnerWriteFenceToken;
  }): Promise<boolean> {
    const current = await this.stateStore.readWriteFenceToken();
    if (runnerWriteFenceTokensMatch(current, input.token)) {
      return true;
    }

    const record = await this.stateStore.readState();
    await this.syncWatchdogAlarm(record);
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        orchestrationAttemptId: input.input.orchestrationAttemptId,
        workspaceAttemptId: input.token.attemptId,
        workspaceReason: input.input.reason,
      },
      level: "warn",
      message: "Hosted runner runtime processing startup confirmation finished after its write fence changed.",
      phase: "runtime.starting",
      userId: input.input.userId,
    });
    return false;
  }

  private createRuntimeProcessingCommandBudget(input: {
    commandTimeoutMs: number | null;
    startedAtMs: number;
  }): RuntimeProcessingCommandBudget {
    const effectiveTimeoutMs = Math.min(
      this.env.webControlTimeoutMs,
      input.commandTimeoutMs ?? DEFAULT_HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS,
    );
    return {
      deadlineAtMs:
        input.startedAtMs + effectiveTimeoutMs - HOSTED_RUNTIME_PROCESSING_COMMAND_RESPONSE_MARGIN_MS,
    };
  }

  private readRuntimeProcessingCommandStepTimeoutMs(input: {
    budget: RuntimeProcessingCommandBudget;
    stepTimeoutMs: number;
  }): number {
    const remainingMs = input.budget.deadlineAtMs - Date.now();
    if (remainingMs <= 0) {
      throw this.createRuntimeProcessingCommandBudgetTimeoutError();
    }
    return Math.max(1, Math.min(input.stepTimeoutMs, remainingMs));
  }

  private async runRuntimeProcessingCommandStep<T>(input: {
    budget: RuntimeProcessingCommandBudget;
    operation: () => Promise<T>;
    stepTimeoutMs: number;
  }): Promise<T> {
    const timeoutMs = this.readRuntimeProcessingCommandStepTimeoutMs({
      budget: input.budget,
      stepTimeoutMs: input.stepTimeoutMs,
    });
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(this.createRuntimeProcessingCommandBudgetTimeoutError());
      }, timeoutMs);
    });

    try {
      return await Promise.race([input.operation(), timeout]);
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    }
  }

  private createRuntimeProcessingCommandBudgetTimeoutError(): Error {
    return new Error(RUNTIME_PROCESSING_COMMAND_BUDGET_TIMEOUT_MESSAGE);
  }

  private isRuntimeProcessingCommandBudgetTimeout(error: unknown): boolean {
    return error instanceof Error
      && error.message === RUNTIME_PROCESSING_COMMAND_BUDGET_TIMEOUT_MESSAGE;
  }

  private async confirmRuntimeContainerStartup(input: {
    commandBudget: RuntimeProcessingCommandBudget;
    input: RuntimeProcessingInput;
    runnerContainerName: string;
    token: RunnerWriteFenceToken;
  }): Promise<
    | { confirmed: true }
    | {
        confirmed: false;
        response: HostedRuntimeEnsureProcessingResponse;
      }
  > {
    if (!this.runnerContainerNamespace) {
      return {
        confirmed: false,
        response: this.createRuntimeProcessingRetryLater({
          reason: "missing_container_binding",
          userId: input.input.userId,
        }),
      };
    }

    const container = this.runnerContainerNamespace.getByName(
      input.runnerContainerName,
    );
    if (!container.ensureReadyForProcessing) {
      return await this.clearWriteFenceAfterStartupConfirmationFailure({
        error: new Error("Hosted runner container readiness method is unavailable."),
        input: input.input,
        retryReason: "container_rpc_error",
        token: input.token,
      });
    }

    try {
      const timeoutMs = this.readRuntimeProcessingCommandStepTimeoutMs({
        budget: input.commandBudget,
        stepTimeoutMs: Math.min(
          this.env.runnerTimeoutMs,
          RUNTIME_PROCESSING_STARTUP_CONFIRM_TIMEOUT_MS,
        ),
      });
      await container.ensureReadyForProcessing({
        timeoutMs,
        userId: input.input.userId,
      });
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          orchestrationAttemptId: input.input.orchestrationAttemptId,
          runtimeStartupConfirmTimeoutMs: timeoutMs,
          workspaceAttemptId: input.token.attemptId,
          workspaceReason: input.input.reason,
        },
        message: "Hosted runner runtime processing startup confirmed.",
        phase: "runtime.starting",
        userId: input.input.userId,
      });
      return { confirmed: true };
    } catch (error) {
      return await this.clearWriteFenceAfterStartupConfirmationFailure({
        error,
        input: input.input,
        token: input.token,
      });
    }
  }

  private async clearWriteFenceAfterStartupConfirmationFailure(input: {
    error: unknown;
    input: RuntimeProcessingInput;
    retryReason?: RuntimeProcessingStartFailureRetryReason;
    token: RunnerWriteFenceToken;
  }): Promise<{
    confirmed: false;
    response: HostedRuntimeEnsureProcessingResponse;
  }> {
    return await this.clearWriteFenceAfterRuntimeStartFailure({
      error: input.error,
      input: input.input,
      message: "Hosted runner runtime processing startup confirmation failed.",
      retryReason: input.retryReason,
      token: input.token,
    });
  }

  private async clearWriteFenceAfterRuntimeStartFailure(input: {
    error: unknown;
    input: RuntimeProcessingInput;
    message: string;
    retryReason?: RuntimeProcessingStartFailureRetryReason;
    token: RunnerWriteFenceToken;
  }): Promise<{
    confirmed: false;
    response: HostedRuntimeEnsureProcessingResponse;
  }> {
    const retryReason = input.retryReason
      ?? classifyRuntimeStartFailureRetryReason(input.error);
    const failed = await this.stateStore.clearWriteFenceAfterTransportFailure({
      error: input.error,
      finishedAt: new Date().toISOString(),
      token: input.token,
    });
    await this.syncWatchdogAlarm(failed.record);
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        ...buildHostedRunnerMetadataOnlyErrorDetails(input.error),
        orchestrationAttemptId: input.input.orchestrationAttemptId,
        transportFailureFenceCleared: failed.failed,
        workspaceAttemptId: input.token.attemptId,
        workspaceReason: input.input.reason,
      },
      level: "warn",
      message: input.message,
      phase: "runtime.starting",
      userId: input.input.userId,
    });
    return {
      confirmed: false,
      response: this.createRuntimeProcessingRetryLater({
        reason: retryReason,
        userId: input.input.userId,
      }),
    };
  }

  private createRuntimeProcessingRetryLater(input: {
    reason: RuntimeProcessingRetryReason;
    userId: string;
  }): HostedRuntimeEnsureProcessingResponse {
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        runtimeProcessingRetryReason: input.reason,
      },
      level: "warn",
      message: "Hosted runner runtime processing could not be accepted yet.",
      phase: "runtime.starting",
      userId: input.userId,
    });
    return {
      kind: "retry_later",
      retryAt: this.computeRuntimeProcessingRetryAt(input.reason),
    };
  }

  private createActiveWorkspaceWakeRetryLater(input: {
    activeFence: NonNullable<RunnerStateRecord["writeFence"]>;
    userId: string;
  }): HostedRuntimeEnsureProcessingResponse {
    const retryAt = this.computeRuntimeProcessingOwnerWatchdogAt(input.activeFence);
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        retryAt,
        runtimeProcessingRetryReason: "active_runtime_workspace_wake",
        workspaceAttemptIdPresent: input.activeFence.attemptId.length > 0,
      },
      message: "Hosted runner deferred workspace wake while runtime processing is already active.",
      phase: "runtime.starting",
      userId: input.userId,
    });
    return {
      kind: "retry_later",
      retryAt,
    };
  }

  private recordRuntimePrewarmAccepted(input: {
    action: Extract<
      HostedRuntimePrewarmResponse,
      { kind: "runtime_prewarm_accepted" }
    >["action"];
    input: RuntimePrewarmInput;
  }): HostedRuntimePrewarmResponse {
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        prewarmAttemptIdPresent: input.input.prewarmAttemptId.length > 0,
        runtimePrewarmAction: input.action,
        source: input.input.source,
      },
      message: "Hosted runner runtime prewarm accepted.",
      phase: "runtime.prewarm",
      userId: input.input.userId,
    });
    return {
      action: input.action,
      kind: "runtime_prewarm_accepted",
    };
  }

  private createRuntimePrewarmRetryLater(input: {
    reason: RuntimeProcessingRetryReason;
    userId: string;
  }): HostedRuntimePrewarmResponse {
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        runtimePrewarmAction: "retry_later",
        runtimePrewarmRetryReason: input.reason,
      },
      level: "warn",
      message: "Hosted runner runtime prewarm could not be accepted yet.",
      phase: "runtime.prewarm",
      userId: input.userId,
    });
    return {
      kind: "retry_later",
      retryAt: this.computeRuntimeProcessingRetryAt(input.reason),
    };
  }

  private computeRuntimeProcessingRetryAt(reason: RuntimeProcessingRetryReason): string {
    const delayMs =
      reason === "stale_fence_replacement_race" ? 5_000 :
      reason === "container_busy" ? 5_000 :
      reason === "container_rpc_timeout" ? 10_000 :
      reason === "container_rpc_error" ? 30_000 :
      reason === "missing_container_binding" ? 60_000 :
      15_000;

    return new Date(Date.now() + delayMs).toISOString();
  }

  private trackRuntimeExecutionTask(
    attemptId: string,
    task: Promise<void>,
  ): void {
    this.runtimeExecutionTasks.set(attemptId, task);
    this.state.waitUntil(task);
    void task.finally(() => {
      if (this.runtimeExecutionTasks.get(attemptId) === task) {
        this.runtimeExecutionTasks.delete(attemptId);
      }
    });
  }

  private async invokeRuntimeExecutionWithFence(input: {
    input: RuntimeInvocationInput;
    runtimeWakeStartedAt: number;
    token: RunnerWriteFenceToken;
  }): Promise<HostedWorkspaceInvocationResult> {
    const executionInput = input.input;
    let prepared: PreparedRuntimeInvocation;
    try {
      prepared = await this.prepareRuntimeExecutionWithFence({
        input: executionInput,
        token: input.token,
      });
    } catch (error) {
      const failed = await this.stateStore.clearWriteFenceAfterTransportFailure({
        error,
        finishedAt: new Date().toISOString(),
        token: input.token,
      });
      await this.syncWatchdogAlarm(failed.record);
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          orchestrationAttemptId: executionInput.orchestrationAttemptId,
          transportFailureFenceCleared: failed.failed,
          workspaceAttemptId: input.token.attemptId,
          workspaceReason: executionInput.reason,
        },
        level: "warn",
        message: "Hosted runner runtime execution adapter failed.",
        phase: "failed",
        userId: executionInput.userId,
      });
      throw error;
    }

    return await this.invokePreparedRuntimeExecutionWithFence({
      acceptedProcessingAttempt: false,
      prepared,
      runtimeWakeStartedAt: input.runtimeWakeStartedAt,
    });
  }

  private async prepareRuntimeExecutionWithFence(input: {
    commandBudget?: RuntimeProcessingCommandBudget;
    input: RuntimeInvocationInput;
    token: RunnerWriteFenceToken;
  }): Promise<PreparedRuntimeInvocation> {
    const workspaceRead = await this.readHostedWorkspaceFromWeb(
      input.input.userId,
      {
        timeoutMs: input.commandBudget
          ? this.readRuntimeProcessingCommandStepTimeoutMs({
              budget: input.commandBudget,
              stepTimeoutMs: this.env.webControlTimeoutMs,
            })
          : this.env.webControlTimeoutMs,
      },
    );
    this.assertWorkspaceBelongsToRunnerUser(workspaceRead.workspace, input.input.userId);
    const workspaceVersion = workspaceRead.workspace?.version ?? "0";
    const token = await this.stateStore.bindWriteFenceWorkspaceVersion({
      token: input.token,
      workspaceVersion,
    });
    const workspaceRunnerInvocation = await this.prepareWorkspaceRunnerInvocation({
      commandBudget: input.commandBudget,
      token,
      reason: input.input.reason,
      ...(input.input.source ? { source: input.input.source } : {}),
      userId: input.input.userId,
      workspace: workspaceRead.workspace,
      workspaceVersion,
    });

    return {
      input: input.input,
      ...workspaceRunnerInvocation,
      token,
      workspaceVersion,
    };
  }

  private async invokePreparedRuntimeExecutionWithFence(input: {
    acceptedProcessingAttempt: boolean;
    prepared: PreparedRuntimeInvocation;
    runtimeWakeStartedAt: number;
  }): Promise<HostedWorkspaceInvocationResult> {
    const executionInput = input.prepared.input;
    const token = input.prepared.token;
    const workspaceVersion = input.prepared.workspaceVersion;
    let result: HostedWorkspaceInvocationResult;
    try {
      result = await this.invokePreparedWorkspaceRunner(input.prepared);
    } catch (error) {
      if (input.acceptedProcessingAttempt) {
        const committedResult =
          await this.readAcceptedRuntimeCommittedProgressAfterTransportFailure({
            executionInput,
            workspaceVersion,
          });
        if (committedResult) {
          const completion = await this.recordRuntimeCompletionAfterInvoke({
            input: executionInput,
            token,
            workspaceVersion,
          });
          await this.syncWatchdogAlarmAfterCompletion({
            executionInput,
            record: completion.record,
            token,
            workspaceVersion,
          });
          emitHostedExecutionStructuredLog({
            component: "hosted.runner",
            details: {
              ...buildHostedRunnerMetadataOnlyErrorDetails(error),
              orchestrationAttemptId: executionInput.orchestrationAttemptId,
              workspaceAttemptId: token.attemptId,
              workspaceReason: executionInput.reason,
              workspaceVersion,
            },
            level: "warn",
            message: "Hosted runner accepted runtime attempt committed progress despite transport failure.",
            phase: "checkpoint",
            userId: executionInput.userId,
          });
          return committedResult;
        }
      }

      const failed = await this.stateStore.clearWriteFenceAfterTransportFailure({
        error,
        finishedAt: new Date().toISOString(),
        token,
      });
      await this.syncWatchdogAlarm(failed.record);
      if (input.acceptedProcessingAttempt && failed.failed) {
        await this.recordAcceptedRuntimeAttemptFailureBestEffort({
          error,
          executionInput,
          token,
          workspaceVersion,
        });
      }
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          orchestrationAttemptId: executionInput.orchestrationAttemptId,
          transportFailureFenceCleared: failed.failed,
          workspaceAttemptId: token.attemptId,
          workspaceReason: executionInput.reason,
          workspaceVersion,
        },
        level: "warn",
        message: "Hosted runner runtime execution adapter failed.",
        phase: "failed",
        userId: executionInput.userId,
      });
      throw error;
    }

    const completion = await this.recordRuntimeCompletionAfterInvoke({
      input: executionInput,
      token,
      workspaceVersion,
    });
    await this.syncWatchdogAlarmAfterCompletion({
      executionInput,
      record: completion.record,
      token,
      workspaceVersion,
    });

    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        orchestrationAttemptId: executionInput.orchestrationAttemptId,
        runtimeExecutionDurationMs: Date.now() - input.runtimeWakeStartedAt,
        runtimeResultNextWakeAtPresent: result.nextWakeAt != null,
        runtimeResultNextWakeReasonPresent: result.nextWakeReason != null,
        workspaceAttemptId: token.attemptId,
        workspaceStatus: result.status,
        workspaceVersion,
      },
      message: "Hosted runner runtime execution adapter completed.",
      phase: "checkpoint",
      userId: executionInput.userId,
    });

    return result;
  }

  private async readAcceptedRuntimeCommittedProgressAfterTransportFailure(input: {
    executionInput: RuntimeInvocationInput;
    workspaceVersion: string;
  }): Promise<HostedWorkspaceInvocationResult | null> {
    let status: HostedRuntimeWebStatusResponse;
    try {
      status = await this.readHostedRuntimeStatusFromWeb(
        input.executionInput.userId,
      );
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          orchestrationAttemptId: input.executionInput.orchestrationAttemptId,
          workspaceReason: input.executionInput.reason,
          workspaceVersion: input.workspaceVersion,
        },
        level: "warn",
        message: "Hosted runner accepted runtime progress recheck failed after transport failure.",
        phase: "failed",
        userId: input.executionInput.userId,
      });
      return null;
    }

    if (
      !status.workspace
      || !isHostedRuntimeWorkspaceVersionAfter(
        status.workspace.version,
        input.workspaceVersion,
      )
      || !hostedRuntimeMailboxLagDrained(status.mailboxLag)
    ) {
      return null;
    }

    return {
      nextWakeAt: status.workspace.nextWakeAt,
      nextWakeReason: status.workspace.nextWakeReason,
      redactedStatus: status.workspace.redactedStatus,
      status: "idle",
    };
  }

  private async recordRuntimeCompletionAfterInvoke(input: {
    input: RuntimeInvocationInput;
    token: RunnerWriteFenceToken;
    workspaceVersion: string | null;
  }): Promise<{ record: RunnerStateRecord | null }> {
    try {
      const completed = await this.stateStore.clearWriteFenceAfterCompletion({
        finishedAt: new Date().toISOString(),
        token: input.token,
      });
      if (!completed.completed) {
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            orchestrationAttemptId: input.input.orchestrationAttemptId,
            workspaceAttemptId: input.token.attemptId,
            workspaceReason: input.input.reason,
            workspaceVersion: input.workspaceVersion,
          },
          level: "warn",
          message: "Hosted runner runtime execution completed after its write fence changed; preserving completed result without transport retry.",
          phase: "checkpoint",
          userId: input.input.userId,
        });
      }
      return {
        record: completed.record,
      };
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          orchestrationAttemptId: input.input.orchestrationAttemptId,
          workspaceAttemptId: input.token.attemptId,
          workspaceReason: input.input.reason,
          workspaceVersion: input.workspaceVersion,
        },
        level: "warn",
        message: "Hosted runner runtime execution completed but completion recording failed; preserving completed result without transport retry.",
        phase: "checkpoint",
        userId: input.input.userId,
      });
      return {
        record: await this.readRunnerStateAfterCompletionRecordFailure(input),
      };
    }
  }

  private async readRunnerStateAfterCompletionRecordFailure(input: {
    input: RuntimeInvocationInput;
    token: RunnerWriteFenceToken;
    workspaceVersion: string | null;
  }): Promise<RunnerStateRecord | null> {
    try {
      return await this.stateStore.readState();
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          orchestrationAttemptId: input.input.orchestrationAttemptId,
          workspaceAttemptId: input.token.attemptId,
          workspaceReason: input.input.reason,
          workspaceVersion: input.workspaceVersion,
        },
        level: "warn",
        message: "Hosted runner runtime execution completed but state read after completion recording failure also failed.",
        phase: "checkpoint",
        userId: input.input.userId,
      });
      return null;
    }
  }

  private async syncWatchdogAlarmAfterCompletion(input: {
    executionInput: RuntimeInvocationInput;
    record: RunnerStateRecord | null;
    token: RunnerWriteFenceToken;
    workspaceVersion: string | null;
  }): Promise<void> {
    if (!input.record) {
      return;
    }

    try {
      await this.syncWatchdogAlarm(input.record);
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          orchestrationAttemptIdPresent:
            input.executionInput.orchestrationAttemptId.length > 0,
          workspaceAttemptIdPresent: input.token.attemptId.length > 0,
          workspaceReason: input.executionInput.reason,
          workspaceVersion: input.workspaceVersion,
        },
        level: "warn",
        message: "Hosted runner runtime execution completed but watchdog alarm cleanup failed.",
        phase: "checkpoint",
        userId: input.executionInput.userId,
      });
    }
  }

  private async ensureActiveRuntimeProcessing(
    input: {
      activeRuntime: RunnerRuntimeWakeInput;
      commandBudget: RuntimeProcessingCommandBudget;
      reason: HostedWorkspaceInvocationReason;
    },
  ): Promise<
    | Extract<RunnerContainerEnsureProcessingResult, { kind: "accepted" }>
    | Extract<RunnerContainerEnsureProcessingResult, { kind: "start-required" }>
    | Extract<RunnerContainerEnsureProcessingResult, { kind: "wake-unconfirmed" }>
  > {
    if (!this.runnerContainerNamespace) {
      return { kind: "wake-unconfirmed", reason: "missing-container-binding" };
    }

    const container = this.runnerContainerNamespace.getByName(
      resolveHostedExecutionRunnerContainerName({
        source: this.runnerRuntimeEnvSource,
        userId: input.activeRuntime.userId,
      }),
    );

    const ensureProcessing = container.ensureProcessing;
    if (ensureProcessing) {
      try {
        const result = await this.runRuntimeProcessingCommandStep({
          budget: input.commandBudget,
          operation: async () => await ensureProcessing({
            activeRuntime: input.activeRuntime,
            reason: input.reason,
            userId: input.activeRuntime.userId,
          }),
          stepTimeoutMs: this.env.runnerTimeoutMs,
        });
        if (
          result.kind === "accepted"
          || result.kind === "start-required"
          || result.kind === "wake-unconfirmed"
        ) {
          return result;
        }
        return { kind: "wake-unconfirmed", reason: "container-rpc-error" };
      } catch (error) {
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: buildHostedRunnerMetadataOnlyErrorDetails(error),
          level: "warn",
          message: "Hosted runner could not ensure active runtime processing.",
          phase: "scheduled",
          userId: input.activeRuntime.userId,
        });
        return {
          kind: "wake-unconfirmed",
          reason: this.isRuntimeProcessingCommandBudgetTimeout(error)
            ? "container-rpc-timeout"
            : "container-rpc-error",
        };
      }
    }

    const wakeRuntime = container.wakeRuntime;
    if (!wakeRuntime) {
      return { kind: "wake-unconfirmed", reason: "missing-wake-method" };
    }

    try {
      const runtimeWake = normalizeRunnerRuntimeWakeResult(
        await this.runRuntimeProcessingCommandStep({
          budget: input.commandBudget,
          operation: async () => await wakeRuntime(input.activeRuntime),
          stepTimeoutMs: this.env.runnerTimeoutMs,
        }),
      );
      if (runtimeWake.kind === "accepted") {
        return { action: runtimeWake.action, kind: "accepted" };
      }
      if (runtimeWake.kind === "not-wakeable") {
        return { kind: "start-required", reason: "no-active-child" };
      }
      return { kind: "wake-unconfirmed", reason: runtimeWake.reason };
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: buildHostedRunnerMetadataOnlyErrorDetails(error),
        level: "warn",
          message: "Hosted runner could not ensure active runtime processing.",
          phase: "scheduled",
          userId: input.activeRuntime.userId,
        });
      return {
        kind: "wake-unconfirmed",
        reason: this.isRuntimeProcessingCommandBudgetTimeout(error)
          ? "container-rpc-timeout"
          : "container-rpc-error",
      };
    }
  }

  async runUntilIdleForTest(input: {
    reason: HostedWorkspaceInvocationReason;
    userId: string;
  }): Promise<HostedWorkspaceInvocationResult> {
    await this.stateStore.bindUser(input.userId);
    const record = await this.readRunnerStateAfterClearingExpiredWriteFence();
    if (record.writeFence) {
      await this.syncWatchdogAlarm(record);
      return {
        nextWakeAt: this.computeRuntimeProcessingOwnerWatchdogAt(record.writeFence),
        status: "scheduled",
      };
    }

    const orchestrationAttemptId =
      createTestCloudflareOrchestrationAttemptId("run-until-idle");
    const runtimeWakeStartedAt = Date.now();
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
      return {
        nextWakeAt: error.record.writeFence
          ? this.computeRuntimeProcessingOwnerWatchdogAt(error.record.writeFence)
          : this.computeRuntimeProcessingRetryAt("stale_fence_replacement_race"),
        status: "scheduled",
      };
    }

    await this.syncWatchdogAlarm(await this.stateStore.readState());
    return await this.invokeRuntimeExecutionWithFence({
      input: {
        orchestrationAttemptId,
        reason: input.reason,
        userId: input.userId,
      },
      runtimeWakeStartedAt,
      token,
    });
  }

  async startStuckInvocationForTest(input: {
    expiresInMs?: number;
    reason?: HostedWorkspaceInvocationReason;
    startedAgoMs?: number;
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
    const record = typeof input.startedAgoMs === "number"
      ? await this.stateStore.ageActiveInvocationForTest({
          expiresAt: token.expiresAt,
          startedAt: new Date(Date.now() - input.startedAgoMs).toISOString(),
        })
      : await this.stateStore.readState();
    await this.syncWatchdogAlarm(record);

    return {
      attemptId: token.attemptId,
      nextWakeAt: readWriteFenceWatchdogAlarmAt(record),
      ok: true,
    };
  }

  private async prepareWorkspaceRunnerInvocation(input: {
    commandBudget?: RuntimeProcessingCommandBudget;
    token: RunnerWriteFenceToken;
    reason: HostedWorkspaceInvocationReason;
    source?: HostedRuntimeDemandRunSource;
    userId: string;
    workspace: HostedWorkspaceState | null;
    workspaceVersion: string;
  }): Promise<{
    job: HostedExecutionWorkspaceInvocationJobInput;
    runnerContainerName: string;
  }> {
    if (!this.runnerContainerNamespace) {
      throw new Error("Native hosted execution requires a RunnerContainer binding.");
    }

    const forwardedEnv = buildHostedRunnerContainerEnv(
      this.runnerRuntimeEnvSource,
    );
    const configSource = this.readRunnerRuntimeConfigSource();
    const runtimeConfig = await this.buildForegroundRunnerJobRuntimeConfig({
      commandBudget: input.commandBudget,
      configSource,
      forwardedEnv,
      userId: input.userId,
    });
    const workspaceSnapshotPathHashSecret =
      await deriveHostedWorkspaceSnapshotPathHashSecret(configSource);
    const userEnv = runtimeConfig.userEnv ?? {};
    const runnerContainerName = resolveHostedExecutionRunnerContainerName({
      source: this.runnerRuntimeEnvSource,
      userId: input.userId,
    });
    const job: HostedExecutionWorkspaceInvocationJobInput = {
      ...(workspaceSnapshotPathHashSecret
        ? {
            diagnostics: {
              workspaceSnapshotPathHashSecret,
            },
          }
        : {}),
      kind: HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND,
      request: {
        attemptId: input.token.attemptId,
        deadlineAt: input.token.expiresAt,
        idleCheckpointDelayMs: this.env.idleCheckpointDelayMs,
        leaseGeneration: input.token.generation,
        reason: input.reason,
        ...(input.source ? { source: input.source } : {}),
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
        runnerContainerWorkerVersionPresent: runnerContainerName !== input.userId,
        workspaceAttemptId: input.token.attemptId,
        workspaceWriteFenceGeneration: input.token.generation,
        workspaceReason: input.reason,
        workspaceVersion: input.workspaceVersion,
      },
      message: "Hosted runner prepared workspace invocation.",
      phase: "wake.running",
      userId: input.userId,
    });

    return {
      job,
      runnerContainerName,
    };
  }

  private async invokePreparedWorkspaceRunner(
    input: PreparedRuntimeInvocation,
  ): Promise<HostedWorkspaceInvocationResult> {
    if (!this.runnerContainerNamespace) {
      throw new Error("Native hosted execution requires a RunnerContainer binding.");
    }

    return await invokeHostedExecutionContainerRunner({
      job: input.job,
      runnerContainerName: input.runnerContainerName,
      runnerContainerNamespace: this.runnerContainerNamespace,
      signal: AbortSignal.timeout(this.env.runnerTimeoutMs),
      timeoutMs: this.env.runnerTimeoutMs,
      userId: input.input.userId,
    });
  }

  private async buildForegroundRunnerJobRuntimeConfig(input: {
    commandBudget?: RuntimeProcessingCommandBudget;
    configSource: Readonly<Record<string, string | undefined>>;
    forwardedEnv: Readonly<Record<string, string>>;
    userId: string;
  }): Promise<ReturnType<typeof buildHostedRunnerJobRuntimeConfig>> {
    const webControlTimeoutMs = input.commandBudget
      ? this.readRuntimeProcessingCommandStepTimeoutMs({
          budget: input.commandBudget,
          stepTimeoutMs: this.env.webControlTimeoutMs,
        })
      : undefined;
    const { runnerSecrets: runnerSecretsService } = await this.ensureRunnerStores(
      input.userId,
      webControlTimeoutMs === undefined
        ? undefined
        : { webControlTimeoutMs },
    );
    const runnerSecrets = input.commandBudget
      ? await this.runRuntimeProcessingCommandStep({
          budget: input.commandBudget,
          operation: async () => await runnerSecretsService.readRunnerSecrets(input.userId),
          stepTimeoutMs: this.env.webControlTimeoutMs,
        })
      : await runnerSecretsService.readRunnerSecrets(input.userId);
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

  private async readRunnerStateAfterClearingExpiredWriteFence(): Promise<RunnerStateRecord> {
    const record = await this.stateStore.readState();
    if (!record.writeFence || !isRunnerWriteFenceExpired(record.writeFence)) {
      return record;
    }

    const expired = await this.stateStore.clearExpiredWriteFence(Date.now());
    await this.syncWatchdogAlarm(expired.record);
    if (expired.cleared) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: buildRunnerRecordTimingLogDetails(expired.record),
        message: "Hosted runner cleared an expired write fence before accepting processing.",
        phase: "runtime.starting",
        userId: expired.record.userId,
      });
    }
    return expired.record;
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
      Date.now() + computeHostedRuntimeProcessingRecheckDelayMs({
        idleCheckpointDelayMs: this.env.idleCheckpointDelayMs,
        runnerCommitTimeoutMs: this.env.runnerCommitTimeoutMs,
      }),
    ).toISOString();
  }

  private computeRuntimeProcessingOwnerWatchdogAt(input: {
    expiresAt: string;
  }): string {
    const activeRuntimeWakeRecheckMs = Date.parse(this.computeActiveRuntimeWakeRecheckAt());
    const expiresAtMs = Date.parse(input.expiresAt);
    const watchdogMs = Number.isFinite(expiresAtMs)
      ? Math.min(expiresAtMs, activeRuntimeWakeRecheckMs)
      : activeRuntimeWakeRecheckMs;
    return new Date(Math.max(Date.now(), watchdogMs)).toISOString();
  }

  private shouldPreserveStartingWriteFence(
    fence: NonNullable<RunnerStateRecord["writeFence"]>,
  ): boolean {
    if (isRunnerWriteFenceExpired(fence)) {
      return false;
    }
    if (this.runtimeExecutionTasks.has(fence.attemptId)) {
      return true;
    }
    const startedAtMs = Date.parse(fence.startedAt);
    if (!Number.isFinite(startedAtMs)) {
      return false;
    }
    return Date.now() - startedAtMs < RUNTIME_PROCESSING_STARTUP_GRACE_MS;
  }

  private async ensureRunnerStores(
    userId?: string,
    input: { webControlTimeoutMs?: number } = {},
  ): Promise<RunnerUserStores> {
    const resolvedUserId = userId ?? await this.requireBoundUserId();
    const cached = this.readReusableRunnerStores(resolvedUserId);
    if (cached && !this.runtimeCryptoContextLock) {
      return cached;
    }

    return this.withRuntimeCryptoContextLock(async () => {
      const lockedCached = this.readReusableRunnerStores(resolvedUserId);
      if (lockedCached) {
        return lockedCached;
      }

      return this.refreshRunnerStores(resolvedUserId, input);
    });
  }

  private readReusableRunnerStores(userId: string): RunnerUserStores | null {
    return this.runnerStores?.userId === userId
      && !isHostedUserCryptoContextExpired(this.runnerStores.crypto)
      ? this.runnerStores
      : null;
  }

  private async refreshRunnerStores(
    userId: string,
    input: { webControlTimeoutMs?: number } = {},
  ): Promise<RunnerUserStores> {
    const stores = await this.createRunnerStores(userId, input);
    this.runnerStores = stores;
    return stores;
  }

  private async createRunnerStores(
    userId: string,
    input: { webControlTimeoutMs?: number } = {},
  ): Promise<RunnerUserStores> {
    const crypto = await requireHostedUserCryptoContextFromEnvironment({
      bucket: this.bucket,
      domain: "runtime",
      environment: input.webControlTimeoutMs === undefined
        ? this.env
        : {
            ...this.env,
            webControlTimeoutMs: input.webControlTimeoutMs,
          },
      reason: "runner-store-refresh",
      userId,
    });

    const stores: RunnerUserStores = {
      crypto,
      runnerSecrets: this.createRunnerSecretsService(crypto),
      userId,
    };
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
    input: { timeoutMs?: number } = {},
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
      timeoutMs: input.timeoutMs ?? this.env.webControlTimeoutMs,
    });

    if (!response.ok) {
      throw new Error(`Hosted workspace read failed with HTTP ${response.status}.`);
    }

    return parseHostedWorkspaceReadResponse(await response.json());
  }

  private async recordAcceptedRuntimeAttemptFailureBestEffort(input: {
    error: unknown;
    executionInput: RuntimeInvocationInput;
    token: RunnerWriteFenceToken;
    workspaceVersion: string;
  }): Promise<void> {
    const body = {
      entries: [
        {
          at: new Date().toISOString(),
          component: "runner",
          errorCode: deriveHostedExecutionErrorCode(input.error),
          eventCode: "runner.accepted_attempt_failed",
          level: "warn",
          phase: "error",
          workspaceVersion: input.workspaceVersion,
        },
      ],
    } satisfies HostedRuntimeLogRequest;

    try {
      const response = await fetchHostedExecutionWebControlPlaneResponse({
        ...(this.env.hostedWebAllowHttpHosts
          ? { allowHttpHosts: this.env.hostedWebAllowHttpHosts }
          : {}),
        baseUrl: this.readHostedWebControlBaseUrl(),
        body: JSON.stringify(body),
        boundUserId: input.executionInput.userId,
        callbackSigning: this.env.webCallbackSigning,
        method: "POST",
        path: HOSTED_RUNTIME_LOG_PATH,
        timeoutMs: this.env.webControlTimeoutMs,
      });

      if (!response.ok) {
        throw new Error(`Hosted runtime log write failed with HTTP ${response.status}.`);
      }

      parseHostedRuntimeLogResponse(await response.json());
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          orchestrationAttemptIdPresent:
            input.executionInput.orchestrationAttemptId.length > 0,
          workspaceAttemptIdPresent: input.token.attemptId.length > 0,
          workspaceReason: input.executionInput.reason,
          workspaceVersion: input.workspaceVersion,
        },
        level: "warn",
        message: "Hosted runner accepted runtime attempt failure log write failed.",
        phase: "failed",
        userId: input.executionInput.userId,
      });
    }
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

async function deriveHostedWorkspaceSnapshotPathHashSecret(
  source: Readonly<Record<string, string | undefined>>,
): Promise<string | null> {
  const rawSecret = normalizeHostedRunnerStringEnvValue(
    source.HOSTED_LOG_FINGERPRINT_SECRET,
  );
  if (!rawSecret) {
    return null;
  }

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      WORKSPACE_SNAPSHOT_PATH_HASH_SECRET_TEXT_ENCODER.encode(rawSecret),
      { hash: "SHA-256", name: "HMAC" },
      false,
      ["sign"],
    );
    const signature = new Uint8Array(await crypto.subtle.sign(
      "HMAC",
      key,
      WORKSPACE_SNAPSHOT_PATH_HASH_SECRET_TEXT_ENCODER.encode(
        WORKSPACE_SNAPSHOT_PATH_HASH_SECRET_CONTEXT,
      ),
    ));
    return Array.from(signature)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

function normalizeHostedRunnerStringEnvValue(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
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

function isRunnerWriteFenceExpired(fence: { expiresAt: string }): boolean {
  const expiresAtMs = Date.parse(fence.expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now();
}

function createTestCloudflareOrchestrationAttemptId(source: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `test-cloudflare-${source}-${crypto.randomUUID()}`;
  }

  return `test-cloudflare-${source}-${Date.now().toString(36)}`;
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
      return {
        action: value.action === "already_running" ? "already_running" : "woken",
        kind: "accepted",
      };
    }
    if (value.kind === "not-wakeable" && value.reason === "no-active-child") {
      return { kind: "not-wakeable", reason: "no-active-child" };
    }
    if (value.kind === "unknown" && typeof value.reason === "string") {
      return {
        kind: "unknown",
        reason: isRunnerRuntimeWakeUnknownReason(value.reason)
          ? value.reason
          : "container-rpc-error",
      };
    }
  }

  return { kind: "unknown", reason: "container-rpc-error" };
}

function isRunnerRuntimeWakeUnknownReason(
  value: string,
): value is Extract<RunnerRuntimeWakeResult, { kind: "unknown" }>["reason"] {
  return value === "active-child-rejected"
    || value === "container-rpc-error"
    || value === "container-rpc-timeout"
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

function isHostedRuntimeWorkspaceVersionAfter(
  nextVersion: string,
  previousVersion: string,
): boolean {
  try {
    return BigInt(nextVersion) > BigInt(previousVersion);
  } catch {
    return false;
  }
}

function hostedRuntimeMailboxLagDrained(
  mailboxLag: HostedRuntimeWebStatusResponse["mailboxLag"],
): boolean {
  return mailboxLag.every((lane) => {
    try {
      return BigInt(lane.lag) === 0n;
    } catch {
      return lane.lag === "0";
    }
  });
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

function mapRunnerProcessingRetryReason(
  reason: Extract<
    RunnerContainerEnsureProcessingResult,
    { kind: "wake-unconfirmed" }
  >["reason"],
): RuntimeProcessingRetryReason {
  switch (reason) {
    case "active-child-rejected":
      return "active_child_rejected";
    case "container-rpc-error":
      return "container_rpc_error";
    case "container-rpc-timeout":
      return "container_rpc_timeout";
    case "missing-container-binding":
      return "missing_container_binding";
    case "missing-wake-method":
      return "container_rpc_error";
  }
}

function classifyRuntimeStartFailureRetryReason(
  error: unknown,
): RuntimeProcessingStartFailureRetryReason {
  if (isMissingContainerBindingFailure(error)) {
    return "missing_container_binding";
  }

  return deriveHostedExecutionErrorCode(error) === "timeout"
    ? "container_rpc_timeout"
    : "container_rpc_error";
}

function isMissingContainerBindingFailure(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "";
  const normalized = message.toLowerCase();
  return normalized.includes("runnercontainer binding")
    || normalized.includes("container binding");
}

function runnerWriteFenceTokensMatch(
  current: RunnerWriteFenceToken | null,
  expected: RunnerWriteFenceToken,
): boolean {
  return current !== null
    && current.attemptId === expected.attemptId
    && current.generation === expected.generation
    && current.userId === expected.userId
    && current.workspaceVersion === expected.workspaceVersion;
}

function readObjectRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
