import type {
  HostedRunnerNudgeResult,
  HostedRunnerStatusResponse,
  HostedRuntimeWebStatusResponse,
  HostedWorkspaceReadResponse,
  HostedWorkspaceInvocationReason,
  HostedWorkspaceInvocationResult,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  emitHostedExecutionStructuredLog,
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
import type { HostedExecutionEnvironment } from "./env.js";
import { toStringEnvSource } from "./string-env.js";
import {
  createHostedUserKeyStoreFromEnvironment,
  type HostedUserCryptoContext,
  type HostedUserKeyAuditRecord,
} from "./user-key-store.js";
import {
  buildHostedRunnerContainerEnv,
  buildHostedRunnerJobRuntimeConfig,
} from "./runner-env.ts";
import {
  invokeHostedExecutionContainerRunner,
  type HostedExecutionContainerNamespaceLike,
} from "./runner-container.js";
import { withSerializedLock } from "./serialized-lock.js";
import {
  fetchHostedExecutionWebControlPlaneResponse,
} from "./web-control-plane.ts";
import type {
  RunnerInvocationLease,
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

interface RunnerUserStores {
  crypto: HostedUserCryptoContext;
  runnerSecrets: RunnerSecretsService;
  userId: string;
}

function emitHostedUserKeyAuditLog(record: HostedUserKeyAuditRecord): void {
  emitHostedExecutionStructuredLog({
    component: "hosted.user-key-store",
    level: "warn",
    message: `${record.action}: ${record.reason}`,
    phase: "runtime.starting",
    userId: record.userId,
  });
}

export class HostedUserRunner {
  private readonly stateStore: RunnerStateStore;
  private readonly runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
  private readonly runtimeAlarmScheduler: RunnerRuntimeAlarmScheduler;
  private readonly userKeyStore: ReturnType<typeof createHostedUserKeyStoreFromEnvironment>;
  private runnerStores: RunnerUserStores | null = null;
  private userKeyEnvelopeLock: Promise<void> | null = null;
  private invocationLock: Promise<void> | null = null;

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
    const userKeyStore = createHostedUserKeyStoreFromEnvironment({
      auditLog: emitHostedUserKeyAuditLog,
      bucket,
      environment: env,
    });
    this.userKeyStore = userKeyStore;
    this.stateStore = new RunnerStateStore(state);
    this.runtimeAlarmScheduler = new RunnerRuntimeAlarmScheduler(this.stateStore, state);
  }

  private async ensureRunnerStores(userId?: string): Promise<RunnerUserStores> {
    const resolvedUserId = userId ?? await this.requireBoundUserId();

    if (this.runnerStores?.userId === resolvedUserId && !this.userKeyEnvelopeLock) {
      return this.runnerStores;
    }

    return this.withUserKeyEnvelopeLock(async () => {
      if (this.runnerStores?.userId === resolvedUserId) {
        return this.runnerStores;
      }

      return this.refreshRunnerStores(resolvedUserId);
    });
  }

  private async refreshRunnerStores(userId: string): Promise<RunnerUserStores> {
    const crypto = await this.userKeyStore.requireUserCryptoContext(userId, {
      reason: "runner-store-refresh",
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

    const nowMs = Date.now();
    record = await this.stateStore.clearNextWakeIfDue(nowMs);
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

    try {
      const webStatus = await this.readHostedRuntimeStatusFromWeb(record.userId);
      const workspaceWakeDue = hostedWorkspaceWakeIsDue(
        webStatus.workspace?.nextWakeAt ?? null,
        nowMs,
      );
      const alarmDecisionDetails = {
        pendingNudge: record.pendingNudge,
        runnerNextWakePresent: record.nextWakeAt !== null,
        workspaceNextWakePresent: (webStatus.workspace?.nextWakeAt ?? null) !== null,
        workspaceWakeDue,
      };
      if (
        !record.pendingNudge
        && !workspaceWakeDue
      ) {
        await this.runtimeAlarmScheduler.syncNextWake({
          preferredWakeAt: webStatus.workspace?.nextWakeAt ?? null,
        });
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: alarmDecisionDetails,
          message: "Hosted runner alarm skipped because no wake is due.",
          phase: "scheduled",
          userId: record.userId,
        });
        return;
      }

      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: alarmDecisionDetails,
        message: "Hosted runner alarm starting workspace invocation.",
        phase: "wake.running",
        userId: record.userId,
      });
      await this.runUntilIdleOrBudget({ reason: "alarm" });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        error,
        level: "warn",
        message: "Hosted wake nudge failed; scheduling a retry.",
        phase: "wake.running",
        userId: record.userId,
      });
      await this.scheduleHostedWakeRetryAlarm();
    }
  }

  async runnerStatus(): Promise<HostedRunnerStatusResponse> {
    const record = await this.stateStore.readState();
    const webStatus = await this.readHostedRuntimeStatusFromWeb(record.userId);

    return {
      ...webStatus,
      inFlight: this.invocationLock !== null || record.inFlight,
      ...(record.lastErrorAt ? { lastErrorAt: record.lastErrorAt } : {}),
      ...(record.lastErrorCode ? { lastErrorCode: record.lastErrorCode } : {}),
      ...(record.lastInvocationAt ? { lastInvocationAt: record.lastInvocationAt } : {}),
      nextAlarmAt: record.nextWakeAt ?? webStatus.workspace?.nextWakeAt ?? null,
      userId: record.userId,
      workspace: webStatus.workspace,
    };
  }

  async nudgeHostedRunner(): Promise<HostedRunnerNudgeResult> {
    const runningRecord = await this.stateStore.readState();
    const alreadyRunning = this.invocationLock !== null
      || runningRecord.inFlight;
    const record = alreadyRunning
      ? await this.markPendingNudgeAndApplyAlarm()
      : await this.runtimeAlarmScheduler.syncNextWake({
          preferredWakeAt: new Date().toISOString(),
        });
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        alarmScheduled: record.nextWakeAt !== null,
        alreadyRunning,
        pendingNudge: record.pendingNudge,
      },
      message: "Hosted runner nudge accepted.",
      phase: "scheduled",
      userId: runningRecord.userId,
    });

    return {
      accepted: true,
      alarmScheduled: record.nextWakeAt !== null,
      alreadyRunning,
      inFlight: alreadyRunning,
      nextAlarmAt: record.nextWakeAt,
    };
  }

  async ownsActiveInvocationLease(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
    workspaceVersion?: string | null;
  }): Promise<boolean> {
    return this.stateStore.ownsActiveInvocationLease(input);
  }

  async recordActiveInvocationWorkspaceCheckpoint(input: {
    attemptId: string;
    leaseGeneration: string;
    userId: string;
    workspaceVersion: string;
  }): Promise<{ recorded: boolean }> {
    return this.stateStore.recordActiveInvocationWorkspaceCheckpoint(input);
  }

  async runUntilIdleOrBudget(input: {
    reason: HostedWorkspaceInvocationReason;
  }): Promise<HostedWorkspaceInvocationResult> {
    if (this.invocationLock !== null) {
      const record = await this.markPendingNudgeAndApplyAlarm();
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          reason: input.reason,
        },
        message: "Hosted runner invocation already active; scheduled another wake.",
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

  private async runUntilIdleOrBudgetInternal(input: {
    reason: HostedWorkspaceInvocationReason;
  }): Promise<HostedWorkspaceInvocationResult> {
    let initialRecord = await this.stateStore.readState();
    if (initialRecord.inFlight) {
      if (initialRecord.workspaceInvocation) {
        const recovery = await this.stateStore.clearStaleInvocationIfExpired({
          nowMs: Date.now(),
          timeoutMs: this.env.runnerTimeoutMs,
        });
        initialRecord = recovery.record;
        if (recovery.cleared) {
          emitHostedExecutionStructuredLog({
            component: "hosted.runner",
            details: {
              workspaceAttemptId: recovery.attemptId,
            },
            level: "warn",
            message: "Hosted workspace invocation lease expired; clearing stale in-flight state.",
            phase: "wake.running",
            userId: initialRecord.userId,
          });
        }
      }

      if (initialRecord.inFlight) {
        const record = await this.markPendingNudgeAndApplyAlarm();
        return {
          nextWakeAt: record.nextWakeAt,
          status: "scheduled",
        };
      }
    }

    let lease = await this.stateStore.beginInvocation({
      reason: input.reason,
      userId: initialRecord.userId,
    });
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        workspaceAttemptId: lease.attemptId,
        workspaceLeaseGeneration: lease.leaseGeneration,
        workspaceReason: input.reason,
      },
      message: "Hosted runner workspace invocation started.",
      phase: "wake.running",
      userId: initialRecord.userId,
    });

    try {
      const workspaceRead = await this.readHostedWorkspaceFromWeb(initialRecord.userId);
      this.assertWorkspaceBelongsToRunnerUser(workspaceRead.workspace, initialRecord.userId);
      const workspaceVersion = workspaceRead.workspace?.version ?? "0";
      lease = await this.stateStore.bindInvocationWorkspaceVersion({
        lease,
        workspaceVersion,
      });
      const result = await this.invokeWorkspaceRunner({
        lease,
        reason: input.reason,
        userId: initialRecord.userId,
        workspaceVersion,
      });
      await this.stateStore.completeInvocation({
        finishedAt: new Date().toISOString(),
        lease,
      });
      await this.scheduleNextWorkspaceAlarm({
        fallbackNextWakeAt: result.nextWakeAt ?? null,
        userId: initialRecord.userId,
      });
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
      await this.stateStore.failInvocation({
        error,
        finishedAt: new Date().toISOString(),
        lease,
      });
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          workspaceAttemptId: lease.attemptId,
        },
        error,
        level: "warn",
        message: "Hosted runner workspace invocation failed.",
        phase: "failed",
        userId: initialRecord.userId,
      });
      await this.scheduleHostedWakeRetryAlarm();
      throw error;
    }
  }

  private async markPendingNudgeAndApplyAlarm(): Promise<RunnerStateRecord> {
    const record = await this.stateStore.markPendingInvocationNudge();
    if (record.nextWakeAt) {
      await this.state.storage.setAlarm(new Date(record.nextWakeAt));
    }
    return record;
  }

  private async readHostedWorkspaceForStatus(
    userId: string,
  ): Promise<HostedWorkspaceState | null> {
    const workspace = (await this.readHostedWorkspaceFromWeb(userId)).workspace;
    this.assertWorkspaceBelongsToRunnerUser(workspace, userId);
    return workspace;
  }

  private async readHostedRuntimeStatusFromWeb(
    userId: string,
  ): Promise<HostedRuntimeWebStatusResponse> {
    const response = await fetchHostedExecutionWebControlPlaneResponse({
      baseUrl: this.readHostedWebControlBaseUrl(),
      boundUserId: userId,
      callbackSigning: this.env.webCallbackSigning,
      method: "GET",
      path: HOSTED_RUNTIME_STATUS_PATH,
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
    const job: HostedExecutionWorkspaceInvocationJobInput = {
      kind: HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND,
      request: {
        attemptId: input.lease.attemptId,
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
        workspaceAttemptId: input.lease.attemptId,
        workspaceLeaseGeneration: input.lease.leaseGeneration,
        workspaceReason: input.reason,
        workspaceVersion: input.workspaceVersion,
      },
      message: "Hosted runner prepared workspace invocation.",
      phase: "wake.running",
      userId: input.userId,
    });

    return await invokeHostedExecutionContainerRunner({
      job,
      runnerContainerNamespace: this.runnerContainerNamespace,
      timeoutMs: this.env.runnerTimeoutMs,
      userId: input.userId,
    });
  }

  private async scheduleNextWorkspaceAlarm(input: {
    fallbackNextWakeAt: string | null;
    userId: string;
  }): Promise<void> {
    const record = await this.stateStore.readState();
    if (record.pendingNudge) {
      await this.runtimeAlarmScheduler.syncNextWake({
        preferredWakeAt: new Date().toISOString(),
      });
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          pendingNudge: true,
        },
        message: "Hosted runner scheduled immediate alarm for pending nudge.",
        phase: "scheduled",
        userId: input.userId,
      });
      return;
    }

    const latestWorkspace = await this.readHostedWorkspaceForStatus(input.userId);
    await this.runtimeAlarmScheduler.syncNextWake({
      preferredWakeAt: latestWorkspace?.nextWakeAt ?? input.fallbackNextWakeAt,
    });
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        fallbackNextWakePresent: input.fallbackNextWakeAt !== null,
        workspaceNextWakePresent: (latestWorkspace?.nextWakeAt ?? null) !== null,
      },
      message: "Hosted runner synced next workspace alarm.",
      phase: "scheduled",
      userId: input.userId,
    });
  }

  private async scheduleHostedWakeRetryAlarm(): Promise<void> {
    await this.runtimeAlarmScheduler.syncNextWake({
      preferredWakeAt: new Date(Date.now() + this.env.retryDelayMs).toISOString(),
    });
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

  private async withUserKeyEnvelopeLock<T>(run: () => Promise<T>): Promise<T> {
    return withSerializedLock(
      {
        get: () => this.userKeyEnvelopeLock,
        set: (value) => {
          this.userKeyEnvelopeLock = value;
        },
      },
      run,
    );
  }

  private async withInvocationLock<T>(run: () => Promise<T>): Promise<T> {
    return withSerializedLock(
      {
        get: () => this.invocationLock,
        set: (value) => {
          this.invocationLock = value;
        },
      },
      run,
    );
  }

}

function hostedWorkspaceWakeIsDue(
  nextWakeAt: string | null,
  nowMs: number,
): boolean {
  if (!nextWakeAt) {
    return false;
  }

  const parsedMs = Date.parse(nextWakeAt);
  return Number.isFinite(parsedMs) && parsedMs <= nowMs;
}
