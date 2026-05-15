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
import { RunnerSecretsService } from "./user-runner/runner-secrets.js";
import type {
  DurableObjectStateLike,
  RunnerStateRecord,
} from "./user-runner/types.js";
import {
  HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND,
  type HostedExecutionWorkspaceInvocationJobInput,
} from "./runner-job-transport.js";

export type { DurableObjectStateLike } from "./user-runner/types.js";

const IMMEDIATE_WAKE_RETRY_DELAY_MS = 1_000;
const LOCAL_ENSURE_START_GRACE_MS = 2_000;

type DurableRunnerDemand =
  | {
      kind: "mailbox-backlog";
      mailboxMaxSeq: string;
      mailboxLag: HostedRuntimeWebStatusResponse["mailboxLag"];
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
      demand: DurableRunnerDemand;
      kind: "processing-ensured";
      record: RunnerStateRecord;
    }
  | {
      containerResult: Extract<RunnerContainerEnsureProcessingResult, { kind: "start-required" }>;
      demand: DurableRunnerDemand;
      localEnsurePromise: Promise<HostedWorkspaceInvocationResult> | null;
      kind: "processing-started";
      nextAlarmAt?: string | null;
      previousAttemptId: string;
      record: RunnerStateRecord;
    }
  | {
      containerResult: null;
      demand: DurableRunnerDemand;
      localEnsurePromise: Promise<HostedWorkspaceInvocationResult> | null;
      kind: "processing-started";
      nextAlarmAt?: string | null;
      record: RunnerStateRecord;
    }
  | {
      deferredFreshLocalEnsure?: boolean;
      demand: DurableRunnerDemand;
      kind: "retry-scheduled";
      record: RunnerStateRecord;
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
      await this.ensureRunnerProgress({
        reason: "alarm",
      });
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
        webStatus.workspace?.nextWakeAt ?? null,
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
    const nextWakeAt = progress.kind === "retry-scheduled"
      ? readRunnerRuntimeDueAt(progress.record)
      : readRunnerStateAlarmAt(progress.record);
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
    const nextAlarmAt = progress.kind === "retry-scheduled"
      ? readRunnerRuntimeDueAt(progress.record)
      : progress.kind === "processing-started" && progress.nextAlarmAt !== undefined
      ? progress.nextAlarmAt
      : readRunnerStateAlarmAt(progress.record);
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
        progress.kind === "processing-ensured"
        || progress.kind === "processing-started",
      nextAlarmAt,
    };
  }

  private async ensureRunnerProgress(input: RunnerProgressInput): Promise<EnsureRunnerProgressResult> {
    const demand = await this.readDurableDemand();
    if (!demand) {
      const record = await this.stateStore.readState();
      await this.syncAlarm(record);
      return { demand: null, kind: "caught-up", record };
    }

    const record = demand.record;

    if (record.writeFence) {
      const containerResult = await this.ensureActiveRuntimeProcessing({
        activeRuntime: {
          attemptId: record.writeFence.attemptId,
          leaseGeneration: String(record.writeFence.generation),
          userId: record.userId,
        },
        demand,
        reason: input.reason,
      });
      if (containerResult.kind === "accepted") {
        await this.syncAlarm(record);
        return {
          containerResult,
          demand,
          kind: "processing-ensured",
          record,
        };
      }

      if (containerResult.kind === "retry-scheduled") {
        const retryRecord = await this.stateStore.markWakePending({
          preferredWakeAt: new Date(Date.now() + IMMEDIATE_WAKE_RETRY_DELAY_MS).toISOString(),
        });
        await this.syncAlarmAt(readRunnerRuntimeDueAt(retryRecord));
        return {
          containerResult,
          demand,
          kind: "retry-scheduled",
          record: retryRecord,
        };
      }

      if (this.shouldDeferFreshLocalEnsurePreemption(record)) {
        const retryRecord = await this.stateStore.markWakePending({
          preferredWakeAt: new Date(Date.now() + IMMEDIATE_WAKE_RETRY_DELAY_MS).toISOString(),
        });
        await this.syncAlarmAt(readRunnerRuntimeDueAt(retryRecord));
        return {
          containerResult,
          deferredFreshLocalEnsure: true,
          demand,
          kind: "retry-scheduled",
          record: retryRecord,
        };
      }

      const previousFence = record.writeFence;
      const preempted = await this.stateStore.clearWriteFenceIfCurrent({
        attemptId: previousFence.attemptId,
        generation: String(previousFence.generation),
        userId: record.userId,
        wakeAt: new Date().toISOString(),
      });

      if (!preempted.preempted) {
        await this.syncAlarm(preempted.record);
        return await this.ensureRunnerProgress(input);
      }

      this.retireCurrentEnsurePromise();
      await this.syncAlarm(preempted.record);

      const localEnsureInFlight = this.kickLocalEnsure({
        aiUsageAllowDecision: input.aiUsageAllowDecision ?? null,
        reason: input.reason,
      });
      return {
        containerResult,
        demand,
        localEnsurePromise: localEnsureInFlight,
        kind: "processing-started",
        previousAttemptId: previousFence.attemptId,
        record: preempted.record,
      };
    }

    if (isRunnerBackoffActive(record, Date.now())) {
      const retryRecord = await this.stateStore.markWakePending({
        preferredWakeAt: new Date().toISOString(),
      });
      await this.syncAlarmAt(readRunnerRuntimeDueAt(retryRecord));
      return {
        containerResult: null,
        demand,
        kind: "retry-scheduled",
        record: retryRecord,
      };
    }

    this.retireCurrentEnsurePromise();
    const initialAlarmAt = new Date(Date.now() + IMMEDIATE_WAKE_RETRY_DELAY_MS).toISOString();
    await this.syncAlarmAt(initialAlarmAt);
    const localEnsureInFlight = this.kickLocalEnsure({
      aiUsageAllowDecision: input.aiUsageAllowDecision ?? null,
      reason: demand.kind === "scheduled-runtime" && demand.reason === "retry"
        ? "retry"
        : input.reason,
    });
    return {
      containerResult: null,
      demand,
      localEnsurePromise: localEnsureInFlight,
      kind: "processing-started",
      nextAlarmAt: initialAlarmAt,
      record,
    };
  }

  private async readDurableDemand(): Promise<DurableRunnerDemand | null> {
    const due = await this.stateStore.readDueWork(Date.now());

    if (due.kind === "runtime") {
      const mailboxDemand = await this.tryReadMailboxBacklogDemand(due.record);
      if (mailboxDemand) {
        return mailboxDemand;
      }

      return {
        kind: "scheduled-runtime",
        reason: due.reason,
        record: due.record,
      };
    }

    return await this.readMailboxBacklogDemand(due.record);
  }

  private async readMailboxBacklogDemand(
    record: RunnerStateRecord,
  ): Promise<Extract<DurableRunnerDemand, { kind: "mailbox-backlog" }> | null> {
    const webStatus = await this.readHostedRuntimeStatusFromWeb(record.userId);
    const mailboxMaxSeq = readMailboxBacklogMaxSeq(webStatus.mailboxLag);

    if (mailboxMaxSeq) {
      return {
        kind: "mailbox-backlog",
        mailboxLag: webStatus.mailboxLag,
        mailboxMaxSeq,
        record,
      };
    }

    return null;
  }

  private async tryReadMailboxBacklogDemand(
    record: RunnerStateRecord,
  ): Promise<Extract<DurableRunnerDemand, { kind: "mailbox-backlog" }> | null> {
    try {
      return await this.readMailboxBacklogDemand(record);
    } catch {
      return null;
    }
  }

  private async ensureActiveRuntimeProcessing(
    input: {
      activeRuntime: RunnerRuntimeWakeInput;
      demand: DurableRunnerDemand;
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
          targetSeq: readDurableDemandTargetSeq(input.demand),
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

  private shouldDeferFreshLocalEnsurePreemption(record: RunnerStateRecord): boolean {
    if (!this.localEnsureInFlight || !record.writeFence) {
      return false;
    }
    const startedAt = Date.parse(record.writeFence.startedAt);
    if (!Number.isFinite(startedAt)) {
      return false;
    }
    return Date.now() - startedAt < LOCAL_ENSURE_START_GRACE_MS;
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
    let lastResult: HostedWorkspaceInvocationResult = {
      nextWakeAt: null,
      status: "idle",
    };

    while (true) {
      const demand = await this.readDurableDemand();
      if (!demand) {
        await this.syncAlarm(await this.stateStore.readState());
        return lastResult;
      }

      if (demand.record.writeFence) {
        await this.syncAlarm(demand.record);
        return {
          nextWakeAt: readRunnerStateAlarmAt(demand.record),
          status: "scheduled",
        };
      }

      if (isRunnerBackoffActive(demand.record, Date.now())) {
        await this.syncAlarmAt(readRunnerRuntimeDueAt(demand.record));
        return {
          nextWakeAt: readRunnerRuntimeDueAt(demand.record),
          status: "scheduled",
        };
      }

      lastResult = await this.runRuntimeWake({
        aiUsageAllowDecision: input.aiUsageAllowDecision ?? null,
        reason: demand.kind === "scheduled-runtime" && demand.reason === "retry"
          ? "retry"
          : input.reason,
      });
      if (lastResult.status === "scheduled") {
        return lastResult;
      }
    }
  }

  private async runRuntimeWake(input: RunnerProgressInput): Promise<HostedWorkspaceInvocationResult> {
    const initialRecord = await this.stateStore.readState();
    let token: RunnerWriteFenceToken;
    try {
      token = await this.stateStore.beginWriteFence({
        expiresAt: new Date(Date.now() + this.env.runnerTimeoutMs).toISOString(),
        kind: "runtime",
        reason: input.reason,
        userId: initialRecord.userId,
      });
      await this.syncAlarm(await this.stateStore.readState());
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
      const workspaceRead = await this.readHostedWorkspaceFromWeb(initialRecord.userId);
      this.assertWorkspaceBelongsToRunnerUser(workspaceRead.workspace, initialRecord.userId);
      workspaceVersion = workspaceRead.workspace?.version ?? "0";
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
      await this.scheduleAfterRuntimeWake({ result });
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          nextWakePresent: result.nextWakeAt != null,
          workspaceAttemptId: token.attemptId,
          workspaceStatus: result.status,
        },
        message: "Hosted runner runtime wake completed.",
        phase: "checkpoint",
        userId: initialRecord.userId,
      });
      return result;
    } catch (error) {
      const failed = await this.stateStore.clearWriteFenceAfterFailure({
        error,
        finishedAt: new Date().toISOString(),
        token,
        retryAt: new Date(Date.now() + this.resolveRetryDelayMs()).toISOString(),
      });
      if (!failed.failed) {
        await this.syncAlarm(failed.record);
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            ...buildHostedRunnerMetadataOnlyErrorDetails(error),
            workspaceAttemptId: token.attemptId,
            workspaceWriteFenceGeneration: token.generation,
            workspaceReason: input.reason,
            workspaceVersion,
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
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          workspaceAttemptId: token.attemptId,
          workspaceWriteFenceGeneration: token.generation,
          workspaceReason: input.reason,
          workspaceVersion,
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
  }): Promise<void> {
    await this.stateStore.scheduleNextWake({
      nextWakeAt: input.result.nextWakeAt ?? null,
    });
    await this.syncAlarm(await this.stateStore.readState());
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

  private async scheduleRetryAfterFailure(error: unknown): Promise<void> {
    try {
      if (error instanceof HostedRunnerRetryAlreadyRecordedError) {
        await this.syncAlarm(error.record);
        return;
      }
      const record = await this.stateStore.scheduleRetry({
        error,
        retryAt: new Date(Date.now() + this.resolveRetryDelayMs()).toISOString(),
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

  private resolveRetryDelayMs(): number {
    return Math.max(IMMEDIATE_WAKE_RETRY_DELAY_MS, this.env.retryDelayMs);
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

function readMailboxBacklogMaxSeq(
  mailboxLag: HostedRuntimeWebStatusResponse["mailboxLag"],
): string | null {
  let maxSeq: string | null = null;
  for (const lane of mailboxLag) {
    if (compareHostedMailboxSeq(lane.maxSeq, lane.importedSeq) <= 0) {
      continue;
    }
    if (!maxSeq || compareHostedMailboxSeq(lane.maxSeq, maxSeq) > 0) {
      maxSeq = lane.maxSeq;
    }
  }
  return maxSeq;
}

function readDurableDemandTargetSeq(demand: DurableRunnerDemand): string | null {
  return demand.kind === "mailbox-backlog" ? demand.mailboxMaxSeq : null;
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
      && progress.deferredFreshLocalEnsure === true,
    staleWriteFencePreempted:
      progress.kind === "processing-started"
      && "previousAttemptId" in progress,
    writeFenceHeldAfterStartRequired:
      progress.kind === "retry-scheduled"
      && progress.deferredFreshLocalEnsure === true,
    ...(progress.kind === "processing-started" && "previousAttemptId" in progress
      ? {
        previousAttemptId: progress.previousAttemptId,
        progressStarted: progress.localEnsurePromise !== null,
      }
      : {}),
    wakePending: progress.record.wakePending,
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
