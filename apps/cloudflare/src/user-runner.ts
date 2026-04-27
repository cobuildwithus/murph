import type {
  HostedExecutionCursorState,
  HostedRuntimeEvent,
  HostedRunDrainResult,
  HostedRunNudgeResult,
  HostedExecutionUserStatus,
  HostedRunnerNudgeResult,
  HostedRunnerStatusResponse,
} from "@murphai/hosted-execution";
import type {
  HostedRunAcquireResponse,
} from "@murphai/hosted-execution/contracts";
import type { GatewayProjectionSnapshot } from "@murphai/gateway-core";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionCursorSnapshotRef,
} from "@murphai/hosted-execution/parsers";
import type { R2BucketLike } from "./bundle-store.js";
import type { HostedExecutionEnvironment } from "./env.js";
import { HostedGatewayProjectionCache } from "./gateway-projection-cache.js";
import { toStringEnvSource } from "./string-env.js";
import {
  createHostedUserKeyStoreFromEnvironment,
  type HostedUserCryptoContext,
  type HostedUserKeyAuditRecord,
} from "./user-key-store.js";
import {
  type HostedExecutionContainerNamespaceLike,
} from "./runner-container.js";
import { withSerializedLock } from "./serialized-lock.js";
import {
  acquireHostedRunFromWeb,
  isHostedRunStaleRunnerAcquireError,
  readHostedRunStatusFromWeb,
} from "./web-control-plane.ts";
import { RunnerBundleSync } from "./user-runner/runner-bundle-sync.js";
import {
  RunnerRunProcessor,
  HostedExecutionObsoleteRunResultError,
  recordHostedRunBreadcrumbInWebBestEffort,
  type RunnerUserStores,
} from "./user-runner/runner-run-processor.js";
import {
  finalizeAcquiredHostedRun,
  mergeAdoptedHostedRunCommitInputs as mergeAdoptedHostedRunCommitInputsForHostedRun,
  prepareAndCommitAcquiredHostedRun,
  reconcileTrackedAuthoritativeCursorBestEffort,
  type HostedRunBreadcrumbInput,
  type HostedRunDrainState,
  type HostedRunFinalizationContext,
} from "./user-runner/run-finalization.js";
import type { RunnerLeaseOwnerInput } from "./user-runner/runner-state-store.js";
import { RunnerSecretsService } from "./user-runner/runner-secrets.js";
import { RunnerStateStore } from "./user-runner/runner-state-store.js";
import { RunnerRuntimeAlarmScheduler } from "./user-runner/runner-runtime-alarm-scheduler.js";
import {
  toUserStatus,
  type DurableObjectStateLike,
  type RunnerStateRecord,
} from "./user-runner/types.js";

export type { DurableObjectStateLike } from "./user-runner/types.js";

const DEFAULT_HOSTED_WAKE_BATCH_LIMIT = 64;
const MAX_HOSTED_WAKE_DRAIN_BATCHES = 32;
const MAX_HOSTED_WAKE_DRAIN_EVENTS =
  DEFAULT_HOSTED_WAKE_BATCH_LIMIT * MAX_HOSTED_WAKE_DRAIN_BATCHES;

type HostedRunDrainExitState = HostedRunDrainState | "stale_runner" | null;

interface HostedRunDrainLoopResult extends HostedRunDrainResult {
  exitState: HostedRunDrainExitState;
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
  private readonly runProcessor: RunnerRunProcessor;
  private readonly eventTransitionLocks = new Map<string, Promise<void>>();
  private readonly stateStore: RunnerStateStore;
  private readonly runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
  private readonly runtimeAlarmScheduler: RunnerRuntimeAlarmScheduler;
  private readonly userKeyStore: ReturnType<typeof createHostedUserKeyStoreFromEnvironment>;
  private runnerStores: RunnerUserStores | null = null;
  private userKeyEnvelopeLock: Promise<void> | null = null;
  private runDrainLock: Promise<void> | null = null;

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
    this.runProcessor = new RunnerRunProcessor({
      applyHostedTransition: <T>(input: {
        eventId: string;
        gatewayProjectionSnapshot?: GatewayProjectionSnapshot | null;
        leaseOwner?: RunnerLeaseOwnerInput;
        run: (userId: string, stores: RunnerUserStores) => Promise<T>;
      }) => this.applyHostedTransition(input),
      bucket: this.bucket,
      ensureRunnerStores: (userId?: string) => this.ensureRunnerStores(userId),
      env: this.env,
      hostedWebBaseUrl: this.env.hostedWebBaseUrl,
      stateStore: this.stateStore,
      readRunnerRuntimeConfigSource: () => this.readRunnerRuntimeConfigSource(),
      runnerContainerNamespace: this.runnerContainerNamespace,
      runnerRuntimeEnvSource: this.runnerRuntimeEnvSource,
      runtimeAlarmScheduler: this.runtimeAlarmScheduler,
    });
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

  private async ensureRunnerStoresWhileHoldingKeyLock(userId: string): Promise<RunnerUserStores> {
    if (this.runnerStores?.userId === userId) {
      return this.runnerStores;
    }

    return this.refreshRunnerStores(userId);
  }

  private async refreshRunnerStores(userId: string): Promise<RunnerUserStores> {
    const crypto = await this.userKeyStore.requireUserCryptoContext(userId, {
      reason: "runner-store-refresh",
    });

    const stores: RunnerUserStores = {
      bundleSync: new RunnerBundleSync(
        this.bucket,
        crypto.rootKey,
        crypto.rootKeyId,
        crypto.keysById,
      ),
      crypto,
      gatewayCache: new HostedGatewayProjectionCache(),
      runnerSecrets: this.createRunnerSecretsService(crypto),
      userId,
    };

    this.runnerStores = stores;
    return stores;
  }

  async bootstrapUser(userId: string): Promise<{ userId: string }> {
    await this.stateStore.bootstrapUser(userId);
    await this.stateStore.markRuntimeBootstrapped();
    return { userId };
  }

  private async ensureManagedUserCryptoForActivationWakeIfNeeded(
    wake: HostedRuntimeEvent,
  ): Promise<void> {
    if (wake.kind !== "member.activated") {
      return;
    }

    await this.provisionManagedUserCryptoAtActivation(wake.userId, "member-activation-wake");
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

    record = await this.stateStore.clearNextWakeIfDue(Date.now());
    if (!record.runtimeBootstrapped) {
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

    try {
      const drainResult = await this.withRunDrainLock(async () => this.drainHostedRunsInternal());
      if (shouldScheduleHostedWakeRetryAlarm(drainResult)) {
        await this.scheduleHostedWakeRetryAlarm();
      }
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

  async status(): Promise<HostedExecutionUserStatus> {
    const record = await this.stateStore.readState();
    return this.composeUserStatus(record);
  }

  async runnerStatus(): Promise<HostedRunnerStatusResponse> {
    const record = await this.stateStore.readState();

    return {
      inFlight: this.runDrainLock !== null || record.inFlight,
      ...(record.lastErrorAt ? { lastErrorAt: record.lastErrorAt } : {}),
      ...(record.lastErrorCode ? { lastErrorCode: record.lastErrorCode } : {}),
      ...(record.lastRunAt ? { lastRunAt: record.lastRunAt } : {}),
      leaseGeneration: record.run?.attempt.toString() ?? "0",
      mailboxLag: [],
      nextAlarmAt: record.nextWakeAt,
      recentLogs: [],
      userId: record.userId,
      workspace: null,
    };
  }

  async nudgeHostedRun(): Promise<HostedRunNudgeResult> {
    if (this.runDrainLock !== null) {
      await this.runtimeAlarmScheduler.syncNextWake({
        preferredWakeAt: new Date().toISOString(),
      });

      return {
        accepted: true,
        alarmScheduled: true,
        alreadyRunning: true,
      };
    }

    await this.runtimeAlarmScheduler.syncNextWake({
      preferredWakeAt: new Date().toISOString(),
    });

    return {
      accepted: true,
      alarmScheduled: true,
      alreadyRunning: false,
    };
  }

  async nudgeHostedRunner(): Promise<HostedRunnerNudgeResult> {
    const record = await this.runtimeAlarmScheduler.syncNextWake({
      preferredWakeAt: new Date().toISOString(),
    });
    const alreadyRunning = this.runDrainLock !== null || record.inFlight;

    return {
      accepted: true,
      alarmScheduled: record.nextWakeAt !== null,
      alreadyRunning,
      inFlight: alreadyRunning,
      leaseGeneration: record.run?.attempt.toString() ?? "0",
      nextAlarmAt: record.nextWakeAt,
    };
  }

  async drainHostedRuns(input: {
    targetCommittedSeqHint?: string | null;
  } = {}): Promise<HostedRunDrainResult> {
    try {
      const result = await this.withRunDrainLock(async () => this.drainHostedRunsInternal(input));
      if (shouldScheduleHostedWakeRetryAlarm(result)) {
        await this.scheduleHostedWakeRetryAlarm();
      }
      return toHostedRunDrainResult(result);
    } catch (error) {
      await this.scheduleHostedWakeRetryAlarm();
      throw error;
    }
  }

  private async scheduleHostedWakeRetryAlarm(): Promise<void> {
    await this.runtimeAlarmScheduler.syncNextWake({
      preferredWakeAt: new Date(Date.now() + this.env.retryDelayMs).toISOString(),
    });
  }

  private async drainHostedRunsInternal(input: {
    targetCommittedSeqHint?: string | null;
  } = {}): Promise<HostedRunDrainLoopResult> {
    const userId = await this.requireBoundUserId();
    await this.bootstrapUser(userId);
    const runFinalizationContext = this.createHostedRunFinalizationContext();
    let targetCommittedSeqHint = parseOptionalHostedCommittedSeq(input.targetCommittedSeqHint);
    let committedSeq: string | null = null;
    let exitState: HostedRunDrainState | null = null;
    let capExhausted = true;
    let drainedEventCount = 0;

    for (
      let round = 0;
      round < MAX_HOSTED_WAKE_DRAIN_BATCHES
        && drainedEventCount < MAX_HOSTED_WAKE_DRAIN_EVENTS;
      round += 1
    ) {
      const remainingEventBudget = MAX_HOSTED_WAKE_DRAIN_EVENTS - drainedEventCount;
      const acquired = await this.acquireHostedRunForDrain({
        limit: Math.min(DEFAULT_HOSTED_WAKE_BATCH_LIMIT, remainingEventBudget),
        targetCommittedSeqHint,
        userId,
      });

      if (!acquired) {
        return this.stopStaleHostedRunnerAcquireRetries({
          targetCommittedSeqHint,
        });
      }

      await reconcileTrackedAuthoritativeCursorBestEffort(runFinalizationContext, {
        currentCursor: acquired.cursor,
        userId,
      });
      committedSeq = acquired.cursor.committedSeq;
      await this.syncRunnerBundleCacheToCursor(acquired.cursor.snapshotRef);
      await this.runtimeAlarmScheduler.syncNextWake({
        preferredWakeAt: acquired.cursor.nextRuntimeWakeAt ?? null,
      });

      if (!acquired.acquired || !acquired.run || !acquired.runToken) {
        capExhausted = false;
        break;
      }
      drainedEventCount += acquired.events.length;

      this.recordHostedRunBreadcrumb({
        message: "Cloudflare acquired a hosted run from the web-owned run ledger.",
        phase: "acquired",
        redacted: {
          eventCount: acquired.events.length,
          resumeFinalize: acquired.resumeFinalize,
          triggerKind: acquired.run.triggerKind,
        },
        run: acquired.run,
        runToken: acquired.runToken,
        userId,
      });

      const outcome = acquired.resumeFinalize
        ? await finalizeAcquiredHostedRun(runFinalizationContext, { acquired, userId })
        : await prepareAndCommitAcquiredHostedRun(runFinalizationContext, { acquired, userId });

      committedSeq = outcome.cursor.committedSeq;
      await this.syncRunnerBundleCacheToCursor(outcome.cursor.snapshotRef);
      await this.runtimeAlarmScheduler.syncNextWake({
        preferredWakeAt: outcome.cursor.nextRuntimeWakeAt ?? null,
      });

      if (outcome.state !== "completed") {
        exitState = outcome.state;
        capExhausted = false;
        break;
      }

      if (
        !acquired.resumeFinalize
        && acquired.events.length < DEFAULT_HOSTED_WAKE_BATCH_LIMIT
        && (!targetCommittedSeqHint || BigInt(committedSeq) >= targetCommittedSeqHint)
        && !hostedRuntimeWakeHintDueNow(outcome.cursor.nextRuntimeWakeAt)
      ) {
        capExhausted = false;
        break;
      }
    }

    if (capExhausted) {
      exitState ??= "backpressured";
    }

    const finalCommittedSeq = committedSeq ?? await this.readCommittedSeqFromWeb(userId);
    return {
      committedSeq: finalCommittedSeq,
      exitState,
      requestedTargetSeq: targetCommittedSeqHint?.toString() ?? null,
      targetReached: targetCommittedSeqHint === null
        || BigInt(finalCommittedSeq) >= targetCommittedSeqHint,
    };
  }

  private recordHostedRunBreadcrumb(input: HostedRunBreadcrumbInput): void {
    void recordHostedRunBreadcrumbInWebBestEffort({
      baseUrl: this.readHostedWebControlBaseUrl(),
      callbackSigning: this.env.webCallbackSigning,
      level: input.level,
      message: input.message,
      phase: input.phase,
      redacted: input.redacted,
      run: {
        attempt: input.run.attempt,
        runId: input.run.id,
        startedAt: input.run.acquiredAt,
      },
      runToken: input.runToken,
      userId: input.userId,
      wakeEventId: input.wakeEventId ?? `hosted-run:${input.run.id}`,
    });
  }

  private async acquireHostedRunForDrain(input: {
    limit: number;
    targetCommittedSeqHint: bigint | null;
    userId: string;
  }): Promise<HostedRunAcquireResponse | null> {
    try {
      return await acquireHostedRunFromWeb({
        baseUrl: this.readHostedWebControlBaseUrl(),
        body: {
          executorKind: "cloudflare-container",
          limit: input.limit,
        },
        boundUserId: input.userId,
        callbackSigning: this.env.webCallbackSigning,
        timeoutMs: this.env.webControlTimeoutMs,
      });
    } catch (error) {
      if (isHostedRunStaleRunnerAcquireError(error)) {
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            condition: "data-integrity.stale-runner-missing-hosted-member",
            errorCode: error.errorCode ?? "",
            httpStatus: String(error.status),
            requestedTargetSeq: input.targetCommittedSeqHint?.toString() ?? "",
          },
          error,
          level: "error",
          message:
            "Hosted runner acquire found a stale bound user missing from the web database; clearing the immediate retry alarm.",
          phase: "wake.running",
          userId: input.userId,
        });
        return null;
      }

      throw error;
    }
  }

  private async stopStaleHostedRunnerAcquireRetries(input: {
    targetCommittedSeqHint: bigint | null;
  }): Promise<HostedRunDrainLoopResult> {
    await this.runtimeAlarmScheduler.syncNextWake({
      preferredWakeAt: null,
    });

    return {
      committedSeq: "0",
      exitState: "stale_runner",
      requestedTargetSeq: input.targetCommittedSeqHint?.toString() ?? null,
      targetReached: false,
    };
  }

  private createHostedRunFinalizationContext(): HostedRunFinalizationContext {
    return {
      bucket: this.bucket,
      callbackSigning: this.env.webCallbackSigning,
      ensureManagedUserCryptoForActivationWakeIfNeeded: (wake) =>
        this.ensureManagedUserCryptoForActivationWakeIfNeeded(wake),
      ensureRunnerStores: (userId) => this.ensureRunnerStores(userId),
      hostedIngressEncryption: this.env.hostedIngressEncryption,
      hostedWebBaseUrl: this.readHostedWebControlBaseUrl(),
      readRunDrainSharePack: (wake) => this.runProcessor.readRunDrainSharePack(wake),
      readRunDrainVaultSyncImport: (wake) => this.runProcessor.readRunDrainVaultSyncImport(wake),
      recordHostedRunBreadcrumb: (input) => this.recordHostedRunBreadcrumb(input),
      resolveAcquiredRunInputSnapshotRef: (acquired) =>
        this.resolveAcquiredRunInputSnapshotRef(acquired),
      resolveAcquiredRunPreparedSnapshotRef: (acquired) =>
        this.resolveAcquiredRunPreparedSnapshotRef(acquired),
      runProcessor: this.runProcessor,
      webControlTimeoutMs: this.env.webControlTimeoutMs,
      stateStore: this.stateStore,
      syncRunnerBundleCacheToCursor: (snapshotRef) =>
        this.syncRunnerBundleCacheToCursor(snapshotRef),
    };
  }

  private async mergeAdoptedHostedRunCommitInputs(
    input: Parameters<typeof mergeAdoptedHostedRunCommitInputsForHostedRun>[1],
  ): ReturnType<typeof mergeAdoptedHostedRunCommitInputsForHostedRun> {
    return mergeAdoptedHostedRunCommitInputsForHostedRun(
      this.createHostedRunFinalizationContext(),
      input,
    );
  }

  private async syncRunnerBundleCacheToCursor(
    snapshotRef: HostedExecutionCursorState["snapshotRef"] | undefined,
  ): Promise<void> {
    const nextBundleRef = parseHostedExecutionCursorSnapshotRef(
      snapshotRef,
      "Hosted run cursor snapshotRef",
    );
    await this.stateStore.syncBundleRefCache(nextBundleRef);
  }

  private resolveAcquiredRunInputSnapshotRef(
    acquired: HostedRunAcquireResponse,
  ): HostedExecutionCursorState["snapshotRef"] {
    return parseHostedExecutionCursorSnapshotRef(
      acquired.run?.inputSnapshotRef ?? acquired.cursor.snapshotRef,
      "Hosted acquired run inputSnapshotRef",
    );
  }

  private resolveAcquiredRunPreparedSnapshotRef(
    acquired: HostedRunAcquireResponse,
  ): HostedExecutionCursorState["snapshotRef"] {
    return parseHostedExecutionCursorSnapshotRef(
      acquired.cursor.snapshotRef,
      "Hosted acquired run prepared snapshotRef",
    );
  }

  private async composeUserStatus(record: RunnerStateRecord): Promise<HostedExecutionUserStatus> {
    const baseStatus = toUserStatus(record);

    try {
      const runStatus = await readHostedRunStatusFromWeb({
        baseUrl: this.readHostedWebControlBaseUrl(),
        boundUserId: record.userId,
        callbackSigning: this.env.webCallbackSigning,
        timeoutMs: this.env.webControlTimeoutMs,
      });

      return {
        ...baseStatus,
        bundleRef: runStatus.cursor.snapshotRef,
        nextWakeAt: runStatus.cursor.nextRuntimeWakeAt ?? baseStatus.nextWakeAt,
        pendingIngressEventCount: runStatus.pendingIngressEventCount > 0
          ? runStatus.pendingIngressEventCount
          : baseStatus.pendingIngressEventCount,
      };
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        error,
        level: "warn",
        message: "Hosted run status read failed; returning local runner status only.",
        phase: "wake.running",
        userId: record.userId,
      });
      return baseStatus;
    }
  }

  private async readCommittedSeqFromWeb(userId: string): Promise<string> {
    const runStatus = await readHostedRunStatusFromWeb({
      baseUrl: this.readHostedWebControlBaseUrl(),
      boundUserId: userId,
      callbackSigning: this.env.webCallbackSigning,
      timeoutMs: this.env.webControlTimeoutMs,
    });

    return runStatus.cursor.committedSeq;
  }

  private async applyHostedTransition<T>(input: {
    eventId: string;
    gatewayProjectionSnapshot?: GatewayProjectionSnapshot | null;
    leaseOwner?: RunnerLeaseOwnerInput;
    run: (userId: string, stores: RunnerUserStores) => Promise<T>;
  }): Promise<T> {
    return this.withEventTransitionLock(input.eventId, async () => {
      if (input.leaseOwner && !(await this.stateStore.hasActiveRunLease(input.leaseOwner))) {
        throw new HostedExecutionObsoleteRunResultError(
          input.eventId,
          input.leaseOwner.run?.runId ?? null,
        );
      }

      return this.withUserKeyEnvelopeLock(async () => {
        const userId = await this.requireBoundUserId();
        const stores = await this.ensureRunnerStoresWhileHoldingKeyLock(userId);
        const result = await input.run(userId, stores);
        await stores.gatewayCache.applySnapshot(input.gatewayProjectionSnapshot ?? null);
        return result;
      });
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

  private async resolveRunnerSecretsServiceWhileHoldingKeyLock(
    userId: string,
    options: {
      reason: string;
    },
  ): Promise<RunnerSecretsService | null> {
    if (this.runnerStores?.userId === userId) {
      return this.runnerStores.runnerSecrets;
    }

    if (!(await this.userKeyStore.hasManagedUserCryptoEnvelope(userId))) {
      return null;
    }

    const crypto = await this.userKeyStore.requireUserCryptoContext(userId, {
      reason: options.reason,
    });
    return this.createRunnerSecretsService(crypto);
  }

  private async provisionManagedUserCryptoAtActivation(
    userId: string,
    reason: string,
  ) {
    const status = await this.userKeyStore.provisionManagedUserCryptoAtActivation(userId, {
      reason,
    });

    if (status.needsRunnerStoreRefresh && this.runnerStores?.userId === userId) {
      this.runnerStores = null;
    }

    return status;
  }

  private async requireBoundUserId(): Promise<string> {
    return (await this.stateStore.readState()).userId;
  }

  private async withEventTransitionLock<T>(eventId: string, run: () => Promise<T>): Promise<T> {
    return withSerializedLock(
      {
        get: () => this.eventTransitionLocks.get(eventId) ?? null,
        set: (value) => {
          if (value === null) {
            this.eventTransitionLocks.delete(eventId);
            return;
          }
          this.eventTransitionLocks.set(eventId, value);
        },
      },
      run,
    );
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

  private async withRunDrainLock<T>(run: () => Promise<T>): Promise<T> {
    return withSerializedLock(
      {
        get: () => this.runDrainLock,
        set: (value) => {
          this.runDrainLock = value;
        },
      },
      run,
    );
  }

}

function toHostedRunDrainResult(
  input: HostedRunDrainLoopResult,
): HostedRunDrainResult {
  return {
    committedSeq: input.committedSeq,
    requestedTargetSeq: input.requestedTargetSeq,
    targetReached: input.targetReached,
  };
}

function shouldScheduleHostedWakeRetryAlarm(
  input: HostedRunDrainLoopResult,
): boolean {
  return input.exitState === "backpressured";
}

function hostedRuntimeWakeHintDueNow(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  const parsedMs = Date.parse(value);
  return Number.isFinite(parsedMs) && parsedMs <= Date.now();
}

function parseOptionalHostedCommittedSeq(value: string | null | undefined): bigint | null {
  if (!value) {
    return null;
  }

  try {
    return BigInt(value);
  } catch {
    return null;
  }
}
