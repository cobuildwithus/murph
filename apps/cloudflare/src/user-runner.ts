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
  dueWake?: unknown;
  idleCheckpointWorkspaceVersion?: string | null;
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
  private drainPromise: Promise<HostedWorkspaceInvocationResult> | null = null;

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
      await this.kickDrain({
        reason: "alarm",
        wait: true,
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: buildHostedRunnerMetadataOnlyErrorDetails(error),
        level: "warn",
        message: "Hosted runner alarm drain failed; scheduling retry.",
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
      inFlight: this.drainPromise !== null || record.writeFence !== null,
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
    const before = await this.stateStore.readState();
    const alreadyRunning = this.drainPromise !== null || before.writeFence !== null;
    const record = await this.stateStore.markWakePending({
      clearIdleCheckpoint: true,
      preferredWakeAt: new Date().toISOString(),
    });
    await this.syncAlarm(record);
    const due = await this.stateStore.readDueWork(Date.now());
    const immediateDriveStarted = due.kind === "runtime"
      ? this.kickDrain({
        aiUsageAllowDecision: input.aiUsageAllowDecision ?? null,
        reason: "nudge",
        wait: false,
      })
      : false;

    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        alreadyRunning,
        immediateDriveStarted,
        wakePending: record.wakePending,
      },
      message: "Hosted runner nudge accepted.",
      phase: "scheduled",
      userId: record.userId,
    });

    return {
      accepted: true,
      alarmScheduled: readRunnerStateAlarmAt(record) !== null,
      alreadyRunning,
      immediateDriveStarted,
      inFlight: alreadyRunning,
      nextAlarmAt: readRunnerStateAlarmAt(record),
    };
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
    await this.stateStore.markWakePending({
      clearIdleCheckpoint: true,
      preferredWakeAt: new Date().toISOString(),
    });
    await this.syncAlarm(await this.stateStore.readState());
    this.kickDrain({
      reason: "nudge",
      wait: false,
    });
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

  async beginIdleCheckpointLease(input: {
    userId: string;
    workspaceVersion: string;
  }): Promise<RunnerWriteFenceToken> {
    await this.stateStore.bindUser(input.userId);
    let token = await this.stateStore.beginWriteFence({
      expiresAt: new Date(Date.now() + this.env.runnerTimeoutMs).toISOString(),
      kind: "idle_checkpoint",
      reason: "idle_shutdown_checkpoint",
      userId: input.userId,
    });
    token = await this.stateStore.bindWriteFenceWorkspaceVersion({
      token,
      workspaceVersion: input.workspaceVersion,
    });
    return token;
  }

  async finishIdleCheckpointLease(input: {
    attemptId: string;
    generation: string;
    nextWakeAt?: string | null;
    userId: string;
  }): Promise<{ completed: boolean }> {
    const result = await this.stateStore.clearWriteFenceIdentityAfterCompletion({
      attemptId: input.attemptId,
      finishedAt: new Date().toISOString(),
      generation: input.generation,
      userId: input.userId,
    });
    if (result.completed) {
      await this.stateStore.scheduleNextWake({
        nextWakeAt: input.nextWakeAt ?? null,
      });
      await this.syncAlarm(await this.stateStore.readState());
    }
    return { completed: result.completed };
  }

  /**
   * Legacy active-invocation compatibility around the write fence.
   * Delete after 2026-05-25; live code must use `validateRuntimeWriteFence`.
   */
  async ownsActiveInvocationLease(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
    workspaceVersion?: string | null;
  }): Promise<boolean> {
    return await this.validateRuntimeWriteFence({
      attemptId: input.attemptId,
      generation: input.leaseGeneration,
      userId: input.userId,
      workspaceVersion: input.workspaceVersion,
    });
  }

  async recordRuntimeWriteFenceWorkspaceCheckpoint(input: {
    attemptId: string;
    generation: string;
    userId: string;
    workspaceVersion: string;
  }): Promise<{ recorded: boolean }> {
    const result = await this.stateStore.recordWriteFenceWorkspaceCheckpoint(input);
    return { recorded: result.recorded };
  }

  /**
   * Legacy active-invocation compatibility around the write fence.
   * Delete after 2026-05-25; live code must use
   * `recordRuntimeWriteFenceWorkspaceCheckpoint`.
   */
  async recordActiveInvocationWorkspaceCheckpoint(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
    workspaceVersion: string;
  }): Promise<{ recorded: boolean }> {
    return await this.recordRuntimeWriteFenceWorkspaceCheckpoint({
      attemptId: input.attemptId,
      generation: input.leaseGeneration,
      userId: input.userId,
      workspaceVersion: input.workspaceVersion,
    });
  }

  /**
   * Legacy active-invocation compatibility around the write fence.
   * Delete after 2026-05-25; this path is intentionally inert.
   */
  async recordActiveInvocationHeartbeat(_input?: unknown): Promise<{
    ok: false;
    reason: "no_active_invocation";
  }> {
    return {
      ok: false,
      reason: "no_active_invocation",
    };
  }

  /**
   * Legacy active-invocation compatibility around the write fence.
   * Delete after 2026-05-25; this path is intentionally inert.
   */
  async recordActiveInvocationContainerStopped(_input?: unknown): Promise<{ recorded: false }> {
    return { recorded: false };
  }

  async runUntilIdleOrBudget(input: RunnerDrainInput): Promise<HostedWorkspaceInvocationResult> {
    const started = this.kickDrain({
      aiUsageAllowDecision: input.aiUsageAllowDecision ?? null,
      reason: input.reason,
      wait: true,
    });
    if (typeof started === "boolean") {
      return {
        nextWakeAt: (await this.stateStore.readState()).nextWakeAt,
        status: "scheduled",
      };
    }
    return await started;
  }

  async startStuckInvocationForTest(input: {
    reason?: HostedWorkspaceInvocationReason;
    userId: string;
  }): Promise<HostedRunnerStuckInvocationTestResult> {
    await this.stateStore.bindUser(input.userId);
    const token = await this.stateStore.beginWriteFence({
      expiresAt: "2000-01-01T00:00:00.000Z",
      kind: input.reason === "idle_shutdown_checkpoint" ? "idle_checkpoint" : "runtime",
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

  private kickDrain(input: RunnerDrainInput & {
    wait: true;
  }): Promise<HostedWorkspaceInvocationResult> | boolean;
  private kickDrain(input: RunnerDrainInput & {
    wait: false;
  }): boolean;
  private kickDrain(input: RunnerDrainInput & {
    wait: boolean;
  }): Promise<HostedWorkspaceInvocationResult> | boolean {
    if (this.drainPromise) {
      return input.wait ? false : false;
    }

    const drain = this.runDrainLoop(input)
      .finally(() => {
        if (this.drainPromise === drain) {
          this.drainPromise = null;
        }
      });
    this.drainPromise = drain;

    if (input.wait) {
      return drain;
    }

    try {
      this.state.waitUntil?.(drain);
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        error,
        level: "warn",
        message: "Hosted runner could not register detached drain with Durable Object waitUntil.",
        phase: "scheduled",
        userId: null,
      });
    }
    void drain.catch(async (error) => {
      await this.scheduleRetryAfterFailure(error);
    });
    return true;
  }

  private async runDrainLoop(input: RunnerDrainInput): Promise<HostedWorkspaceInvocationResult> {
    let lastResult: HostedWorkspaceInvocationResult = {
      nextWakeAt: null,
      status: "idle",
    };

    while (true) {
      const due = await this.stateStore.readDueWork(Date.now());
      if (due.kind === "runtime") {
        lastResult = await this.runRuntimeWake({
          aiUsageAllowDecision: input.aiUsageAllowDecision ?? null,
          reason: due.reason === "retry" ? "retry" : input.reason,
        });
        if (lastResult.status === "scheduled") {
          return lastResult;
        }
        continue;
      }

      await this.syncAlarm(due.record);
      return lastResult;
    }
  }

  private async runRuntimeWake(input: RunnerDrainInput): Promise<HostedWorkspaceInvocationResult> {
    const initialRecord = await this.stateStore.readState();
    let token: RunnerWriteFenceToken;
    try {
      token = await this.stateStore.beginWriteFence({
        expiresAt: new Date(Date.now() + this.env.runnerTimeoutMs).toISOString(),
        kind: "runtime",
        reason: input.reason,
        userId: initialRecord.userId,
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
      await this.stateStore.clearWriteFenceAfterCompletion({
        finishedAt: new Date().toISOString(),
        token,
      });
      await this.scheduleAfterRuntimeWake({
        result,
        userId: initialRecord.userId,
        workspaceVersion,
      });
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          nextWakePresent: result.nextWakeAt !== null,
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
        throw error;
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
    userId: string;
    workspaceVersion: string;
  }): Promise<void> {
    void input.userId;
    void input.workspaceVersion;
    await this.stateStore.scheduleNextWake({
      nextWakeAt: input.result.nextWakeAt ?? null,
    });
    await this.syncAlarm(await this.stateStore.readState());
  }

  async finishIdleShutdownCheckpoint(input: {
    nextWakeAt?: string | null;
    preferredWakeAt?: string | null;
    userId?: string | null;
  }): Promise<void> {
    await this.stateStore.scheduleNextWake({
      nextWakeAt: input.preferredWakeAt ?? input.nextWakeAt ?? null,
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
  return readRunnerRuntimeDueAt(record);
}

function readRunnerRuntimeDueAt(record: RunnerStateRecord): string | null {
  if (!record.wakeAt) {
    return null;
  }
  return latestIsoDate(record.wakeAt, record.backoffUntil);
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
