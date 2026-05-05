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
  hasHostedRunnerVercelAiGatewayCredential,
  isHostedRunnerVercelAiGatewayProvider,
} from "./hosted-env-policy.ts";
import {
  destroyHostedExecutionContainer,
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

const PERSISTED_ONLY_INVOCATION_ORPHAN_GRACE_MS = 45_000;
const PENDING_NUDGE_DRAIN_CONTINUATION_DELAY_MS = 1_000;
const HOSTED_WEB_USAGE_GATE_PATH = "/api/internal/hosted-execution/usage/gate";

type HostedAiUsageGateDecision =
  | {
    allowed: true;
    reason: null;
    retryAfter: null;
  }
  | {
    allowed: false;
    reason: string;
    retryAfter: string;
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

interface RunnerUserStores {
  crypto: HostedUserCryptoContext;
  runnerSecrets: RunnerSecretsService;
  userId: string;
}

interface RunnerDrainInput {
  dueWake?: boolean;
  reason: HostedWorkspaceInvocationReason;
}

export class HostedUserRunner {
  private readonly stateStore: RunnerStateStore;
  private readonly runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
  private readonly runtimeAlarmScheduler: RunnerRuntimeAlarmScheduler;
  private runnerStores: RunnerUserStores | null = null;
  private runtimeCryptoContextLock: Promise<void> | null = null;
  private invocationLock: Promise<void> | null = null;
  private pendingRunnerDriveAfterInvocation: {
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
    this.runtimeAlarmScheduler = new RunnerRuntimeAlarmScheduler(this.stateStore, state);
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

    const alarmNowMs = Date.now();
    const alarmWakeWasDue = isWakeDue(record.nextWakeAt, alarmNowMs);
    record = await this.stateStore.clearNextWakeIfDue(alarmNowMs);
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
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          pendingNudge: record.pendingNudge,
          runnerNextWakePresent: record.nextWakeAt !== null,
        },
        message: "Hosted runner alarm starting workspace invocation.",
        phase: "wake.running",
        userId: record.userId,
      });
      await this.runUntilIdleOrBudget({
        dueWake: alarmWakeWasDue,
        reason: "alarm",
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        error,
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

  async deleteHostedUserData(userId: string): Promise<HostedRunnerUserDataDeletionResult> {
    return this.withInvocationLock(async () => {
      if (this.runnerStores?.userId === userId) {
        this.runnerStores = null;
      }

      await this.stateStore.assertStateForUser(userId);
      const r2 = await this.deleteHostedUserR2DataBestEffort(userId);
      const stateDeletion = await this.stateStore.deleteStateForUser(userId);
      const deleteAlarm = this.state.storage.deleteAlarm;
      const alarmCleared = typeof deleteAlarm === "function";
      if (alarmCleared) {
        await deleteAlarm.call(this.state.storage);
      }
      await destroyHostedExecutionContainer({
        runnerContainerNamespace: this.runnerContainerNamespace,
        userId,
      });

      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          r2DeletedObjectCount: r2.deletedObjectCount,
          r2Supported: r2.supported,
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

  async nudgeHostedRunner(): Promise<HostedRunnerNudgeResult> {
    const activeInThisIsolate = this.invocationLock !== null;
    let runningRecord = await this.stateStore.readState();
    if (!activeInThisIsolate && runningRecord.inFlight) {
      const recovery = await this.stateStore.clearStaleInvocationIfExpired({
        nowMs: Date.now(),
        orphanGraceMs: PERSISTED_ONLY_INVOCATION_ORPHAN_GRACE_MS,
        timeoutMs: this.env.runnerTimeoutMs,
      });
      runningRecord = recovery.record;
      if (recovery.cleared) {
        this.logStaleInvocationLeaseCleared(recovery.attemptId, runningRecord.userId);
      }
    }
    const alreadyRunning = activeInThisIsolate || runningRecord.inFlight;
    const nowMs = Date.now();
    const preferredWakeAt = alreadyRunning
      ? resolvePendingNudgeWakeAt({
          nowMs,
          record: runningRecord,
          runnerTimeoutMs: this.env.runnerTimeoutMs,
        })
      : new Date(nowMs + this.env.retryDelayMs).toISOString();
    const record = await this.markPendingNudgeAndApplyAlarm({
      preferredWakeAt,
    });
    const immediateDriveStarted = alreadyRunning
      ? false
      : this.startDetachedRunnerDrive({
          reason: "nudge",
          userId: runningRecord.userId,
        });
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        alarmScheduled: record.nextWakeAt !== null,
        alreadyRunning,
        immediateDriveStarted,
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
      const runningRecord = await this.stateStore.readState();
      const record = await this.syncInvocationRecoveryAlarm(runningRecord);
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

  private async runUntilIdleOrBudgetInternal(input: RunnerDrainInput): Promise<HostedWorkspaceInvocationResult> {
    let initialRecord = await this.stateStore.readState();
    if (initialRecord.inFlight) {
      if (initialRecord.workspaceInvocation) {
        const nowMs = Date.now();
        const recovery = await this.stateStore.clearStaleInvocationIfExpired({
          nowMs,
          orphanGraceMs: PERSISTED_ONLY_INVOCATION_ORPHAN_GRACE_MS,
          timeoutMs: this.env.runnerTimeoutMs,
        });
        initialRecord = recovery.record;
        if (recovery.cleared) {
          this.logStaleInvocationLeaseCleared(recovery.attemptId, initialRecord.userId);
        }
      }

      if (initialRecord.inFlight) {
        const record = await this.syncInvocationRecoveryAlarm(initialRecord);
        return {
          nextWakeAt: record.nextWakeAt,
          status: "scheduled",
        };
      }
    }

    if (!shouldRunHostedRunnerInvocation({
      dueWake: input.dueWake,
      reason: input.reason,
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

    const gate = await this.readHostedAiUsageGateBeforeInvocation(initialRecord.userId);
    if (!gate.allowed) {
      const record = await this.markPendingNudgeAndApplyAlarm({
        preferredWakeAt: gate.retryAfter,
      });
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          reason: gate.reason,
          retryAfter: gate.retryAfter,
        },
        message: "Hosted runner skipped workspace invocation because the AI usage gate denied the start.",
        phase: "scheduled",
      });
      return {
        nextWakeAt: record.nextWakeAt,
        redactedStatus: {
          aiUsageGateBlocked: true,
          aiUsageGateReason: gate.reason,
          aiUsageGateRetryAfter: gate.retryAfter,
        },
        status: "scheduled",
      };
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
      const completion = await this.stateStore.completeInvocation({
        finishedAt: new Date().toISOString(),
        lease,
      });
      if (completion.completed) {
        await this.scheduleNextWorkspaceAlarm({
          fallbackNextWakeAt: result.nextWakeAt ?? null,
          userId: initialRecord.userId,
        });
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
        await this.scheduleHostedWakeRetryAlarm({
          respectMaxAttempts: true,
          userId: initialRecord.userId,
        });
      }
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
  } = {}): Promise<RunnerStateRecord> {
    const record = await this.stateStore.markPendingInvocationNudge({
      preferredWakeAt: input.preferredWakeAt,
    });
    if (record.nextWakeAt) {
      await this.state.storage.setAlarm(new Date(record.nextWakeAt));
    }
    return record;
  }

  private async reschedulePendingNudgeAfterInvocationLiveness(
    record: RunnerStateRecord,
  ): Promise<RunnerStateRecord | null> {
    if (!record.pendingNudge) {
      return null;
    }

    const nowMs = Date.now();
    return await this.runtimeAlarmScheduler.syncNextWake({
      preferredWakeAt: resolvePendingNudgeWakeAt({
        nowMs,
        record,
        runnerTimeoutMs: this.env.runnerTimeoutMs,
      }),
    });
  }

  private async syncInvocationRecoveryAlarm(
    record: RunnerStateRecord,
  ): Promise<RunnerStateRecord> {
    return await this.runtimeAlarmScheduler.syncNextWake({
      preferredWakeAt: resolvePendingNudgeWakeAt({
        nowMs: Date.now(),
        record,
        runnerTimeoutMs: this.env.runnerTimeoutMs,
      }),
    });
  }

  private logStaleInvocationLeaseCleared(
    attemptId: string | null,
    userId: string,
  ): void {
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        workspaceAttemptId: attemptId,
      },
      level: "warn",
      message: "Hosted workspace invocation lease expired; clearing stale in-flight state.",
      phase: "wake.running",
      userId,
    });
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

  private async readHostedAiUsageGateBeforeInvocation(
    userId: string,
  ): Promise<HostedAiUsageGateDecision> {
    try {
      const response = await fetchHostedExecutionWebControlPlaneResponse({
        baseUrl: this.readHostedWebControlBaseUrl(),
        body: "{}",
        boundUserId: userId,
        callbackSigning: this.env.webCallbackSigning,
        method: "POST",
        path: HOSTED_WEB_USAGE_GATE_PATH,
        timeoutMs: this.env.webControlTimeoutMs,
      });

      if (!response.ok) {
        throw new Error(`Hosted AI usage gate failed with HTTP ${response.status}.`);
      }

      return parseHostedAiUsageGateDecision(await response.json());
    } catch (error) {
      const retryAfter = new Date(Date.now() + this.env.retryDelayMs).toISOString();
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          reason: "ai_usage_gate_unavailable",
          retryAfter,
        },
        error,
        level: "warn",
        message: "Hosted runner skipped workspace invocation because the AI usage gate was unavailable.",
        phase: "scheduled",
      });
      return {
        allowed: false,
        reason: "ai_usage_gate_unavailable",
        retryAfter,
      };
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
    const userEnv = runtimeConfig.userEnv ?? {};
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
        forwardedEnvKeyCount: Object.keys(forwardedEnv).length,
        hostedAssistantProviderConfigured:
          typeof forwardedEnv.HOSTED_ASSISTANT_PROVIDER === "string"
          && forwardedEnv.HOSTED_ASSISTANT_PROVIDER.length > 0,
        hostedAssistantVercelAiGatewayConfigured:
          isHostedRunnerVercelAiGatewayProvider(forwardedEnv.HOSTED_ASSISTANT_PROVIDER),
        modelCredentialConfigured:
          hasHostedRunnerVercelAiGatewayCredential({
            forwardedEnv,
            userEnv,
          }),
        nodeEnvConfigured:
          typeof forwardedEnv.NODE_ENV === "string"
          && forwardedEnv.NODE_ENV.length > 0,
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
      this.pendingRunnerDriveAfterInvocation = {
        reason: "nudge",
        userId: input.userId,
      };

      await this.runtimeAlarmScheduler.syncNextWake({
        preferredWakeAt: new Date(
          Date.now() + PENDING_NUDGE_DRAIN_CONTINUATION_DELAY_MS,
        ).toISOString(),
      });
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

  private async scheduleHostedWakeRetryAlarm(input: {
    respectMaxAttempts?: boolean;
    userId?: string | null;
  } = {}): Promise<boolean> {
    if (input.respectMaxAttempts === true) {
      const record = await this.stateStore.readState();
      if (record.retryFailureCount >= this.env.maxEventAttempts) {
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
      preferredWakeAt: new Date(Date.now() + this.env.retryDelayMs).toISOString(),
    });
    return true;
  }

  private startDetachedRunnerDrive(input: {
    reason: HostedWorkspaceInvocationReason;
    userId: string;
  }): boolean {
    if (this.invocationLock !== null) {
      return false;
    }

    void this.runUntilIdleOrBudget({ reason: input.reason })
      .catch(async (error) => {
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            reason: input.reason,
          },
          error,
          level: "warn",
          message: "Hosted runner immediate wake drive failed; durable alarm fallback remains scheduled.",
          phase: "failed",
          userId: input.userId,
        });

        try {
          await this.scheduleHostedWakeRetryAlarm({
            respectMaxAttempts: true,
            userId: input.userId,
          });
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

    return true;
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

function parseHostedAiUsageGateDecision(value: unknown): HostedAiUsageGateDecision {
  const record = requireHostedAiUsageGateObject(value);
  if (record.allowed === true) {
    return {
      allowed: true,
      reason: null,
      retryAfter: null,
    };
  }

  if (record.allowed !== false) {
    throw new TypeError("Hosted AI usage gate response allowed must be boolean.");
  }

  return {
    allowed: false,
    reason: requireHostedAiUsageGateString(record.reason, "reason"),
    retryAfter: requireHostedAiUsageGateIsoDateString(record.retryAfter, "retryAfter"),
  };
}

function requireHostedAiUsageGateObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted AI usage gate response must be an object.");
  }

  return value as Record<string, unknown>;
}

function requireHostedAiUsageGateString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`Hosted AI usage gate response ${label} must be a string.`);
  }

  return value;
}

function requireHostedAiUsageGateIsoDateString(value: unknown, label: string): string {
  const normalized = requireHostedAiUsageGateString(value, label);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`Hosted AI usage gate response ${label} must be an ISO date string.`);
  }

  return parsed.toISOString();
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

function isWakeDue(nextWakeAt: string | null, nowMs: number): boolean {
  if (!nextWakeAt) {
    return false;
  }

  const wakeAtMs = Date.parse(nextWakeAt);
  return Number.isFinite(wakeAtMs) && wakeAtMs <= nowMs;
}

function shouldRunHostedRunnerInvocation(input: {
  dueWake?: boolean;
  reason: HostedWorkspaceInvocationReason;
  record: RunnerStateRecord;
}): boolean {
  return input.reason === "manual"
    || input.record.pendingNudge
    || input.dueWake === true;
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
  const orphanObservedAtMs = invocation.orphanObservedAt
    ? Date.parse(invocation.orphanObservedAt)
    : Number.NaN;
  const orphanDeadlineMs = Number.isFinite(lastHeartbeatAtMs)
    ? lastHeartbeatAtMs + PERSISTED_ONLY_INVOCATION_ORPHAN_GRACE_MS
    : Number.isFinite(orphanObservedAtMs)
      ? orphanObservedAtMs + PERSISTED_ONLY_INVOCATION_ORPHAN_GRACE_MS
      : input.nowMs + PERSISTED_ONLY_INVOCATION_ORPHAN_GRACE_MS;
  return new Date(Math.max(input.nowMs, Math.min(hardDeadlineMs, orphanDeadlineMs))).toISOString();
}
