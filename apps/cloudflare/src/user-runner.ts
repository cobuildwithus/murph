import type {
  HostedExecutionCursorState,
  HostedRuntimeEvent,
  HostedRunDrainResult,
  HostedRunNudgeResult,
  HostedIngressEnvelope,
  HostedExecutionUserStatus,
} from "@murphai/hosted-execution";
import type {
  HostedRunAcquireResponse,
  HostedRunEventResult,
  HostedRunRecord,
  HostedRuntimeDrainEvent,
  HostedIngressLifecycleState,
} from "@murphai/hosted-execution/contracts";
import type { GatewayProjectionSnapshot } from "@murphai/gateway-core";
import {
  createRuntimeTimerSyntheticWake,
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionCursorSnapshotRef,
  parseHostedIngressPayload,
} from "@murphai/hosted-execution/parsers";
import type { R2BucketLike } from "./bundle-store.js";
import type { HostedExecutionEnvironment } from "./env.js";
import { HostedGatewayProjectionCache } from "./gateway-projection-cache.js";
import {
  HostedEmailRawMessageMissingError,
  readHostedEmailRawMessage,
} from "./hosted-email.js";
import { toStringEnvSource } from "./string-env.js";
import {
  createHostedUserKeyStoreFromEnvironment,
  type HostedUserCryptoContext,
  type HostedUserKeyAuditRecord,
} from "./user-key-store.js";
import {
  decryptHostedIngressPayloadCiphertext,
} from "./hosted-ingress-encryption.ts";
import {
  type HostedExecutionContainerNamespaceLike,
} from "./runner-container.js";
import { withSerializedLock } from "./serialized-lock.js";
import {
  acquireHostedRunFromWeb,
  commitHostedRunToWeb,
  finalizeHostedRunInWeb,
  releaseHostedRunFinalizeInWeb,
  readHostedRunStatusFromWeb,
} from "./web-control-plane.ts";
import { RunnerBundleSync } from "./user-runner/runner-bundle-sync.js";
import {
  RunnerRunProcessor,
  HostedExecutionObsoleteRunResultError,
  recordHostedRunBreadcrumbInWebBestEffort,
  type RunnerUserStores,
} from "./user-runner/runner-run-processor.js";
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

type HostedRunDrainState = HostedIngressLifecycleState;

const DEFAULT_HOSTED_WAKE_BATCH_LIMIT = 64;
const HOSTED_WAKE_NUDGE_RETRY_DELAY_MS = 5_000;
// Preserve the previous effective drain cap of 32 fetched batches * 64 wakes each
// now that every successful cursor advance forces a refetch before the next wake.
const MAX_HOSTED_WAKE_DRAIN_ROUNDS = DEFAULT_HOSTED_WAKE_BATCH_LIMIT * 32;
const HOSTED_WAKE_QUARANTINE_EMAIL_RAW_MESSAGE_MISSING = "email-raw-message-missing";
const HOSTED_WAKE_QUARANTINE_INVALID_PAYLOAD = "invalid-wake-payload";
const HOSTED_WAKE_QUARANTINE_USER_MISMATCH = "wake-user-mismatch";

interface HostedRunDrainLoopResult extends HostedRunDrainResult {
  exitState: HostedRunDrainState | null;
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

  private async drainHostedRunsInternal(input: {
    targetCommittedSeqHint?: string | null;
  } = {}): Promise<HostedRunDrainLoopResult> {
    const userId = await this.requireBoundUserId();
    await this.bootstrapUser(userId);
    let targetCommittedSeqHint = parseOptionalHostedCommittedSeq(input.targetCommittedSeqHint);
    let committedSeq: string | null = null;
    let exitState: HostedRunDrainState | null = null;

    for (let round = 0; round < MAX_HOSTED_WAKE_DRAIN_ROUNDS; round += 1) {
      const acquired = await acquireHostedRunFromWeb({
        baseUrl: this.readHostedWebControlBaseUrl(),
        body: {
          executorKind: "cloudflare-container",
          limit: DEFAULT_HOSTED_WAKE_BATCH_LIMIT,
        },
        boundUserId: userId,
        callbackSigning: this.env.webCallbackSigning,
        timeoutMs: this.env.runnerTimeoutMs,
      });

      committedSeq = acquired.cursor.committedSeq;
      await this.syncRunnerBundleCacheToCursor(acquired.cursor.snapshotRef);
      await this.runtimeAlarmScheduler.syncNextWake({
        preferredWakeAt: acquired.cursor.nextRuntimeWakeAt ?? null,
      });

      if (!acquired.acquired || !acquired.run || !acquired.runToken) {
        break;
      }

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
        ? await this.finalizeAcquiredHostedRun({ acquired, userId })
        : await this.prepareAndCommitAcquiredHostedRun({ acquired, userId });

      committedSeq = outcome.cursor.committedSeq;
      await this.syncRunnerBundleCacheToCursor(outcome.cursor.snapshotRef);
      await this.runtimeAlarmScheduler.syncNextWake({
        preferredWakeAt: outcome.cursor.nextRuntimeWakeAt ?? null,
      });

      if (outcome.state !== "completed") {
        exitState = outcome.state;
        break;
      }

      if (
        !acquired.resumeFinalize
        && acquired.events.length < DEFAULT_HOSTED_WAKE_BATCH_LIMIT
        && (!targetCommittedSeqHint || BigInt(committedSeq) >= targetCommittedSeqHint)
        && !hostedRuntimeWakeHintDueNow(outcome.cursor.nextRuntimeWakeAt)
      ) {
        break;
      }
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

  private recordHostedRunBreadcrumb(input: {
    level?: "info" | "warn" | "error";
    message: string;
    phase: string;
    redacted?: Record<string, unknown> | null;
    run: HostedRunRecord;
    runToken?: string | null;
    userId: string;
    wakeEventId?: string;
  }): void {
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

  private async prepareAndCommitAcquiredHostedRun(input: {
    acquired: HostedRunAcquireResponse;
    userId: string;
  }): Promise<{
    cursor: HostedExecutionCursorState;
    state: HostedRunDrainState;
  }> {
    const run = input.acquired.run;
    const runToken = input.acquired.runToken;
    if (!run || !runToken) {
      return {
        cursor: input.acquired.cursor,
        state: "backpressured",
      };
    }

    const resolved = await this.resolveHostedRunDrainInputs({
      acquired: input.acquired,
      run,
      userId: input.userId,
    });
    const primaryWake = resolved.primaryWake
      ?? createRuntimeTimerSyntheticWake({
        acquiredAt: run.acquiredAt,
        runId: run.id,
        triggerKind: run.triggerKind,
        userId: input.userId,
      });

    if (resolved.events.length === 0 && input.acquired.events.length > 0) {
      this.recordHostedRunBreadcrumb({
        message: "Cloudflare attempted to commit the acquired hosted run.",
        phase: "commit_attempted",
        redacted: {
          commitKind: "quarantine",
          quarantinedEventCount: input.acquired.events.length,
          validEventCount: 0,
        },
        run,
        runToken,
        userId: input.userId,
      });
      const commit = await commitHostedRunToWeb({
        baseUrl: this.readHostedWebControlBaseUrl(),
        body: {
          eventResults: resolved.eventResults,
          expectedCursorVersion: input.acquired.cursor.version,
          finalizeRequired: false,
          outputCommittedSeq: resolved.outputCommittedSeq,
          preparedSnapshotRef: input.acquired.cursor.snapshotRef,
          redactedSummary: {
            eventCount: input.acquired.events.length,
            phase: "quarantined",
            validEventCount: 0,
          },
          runId: run.id,
          runToken,
        },
        boundUserId: input.userId,
        callbackSigning: this.env.webCallbackSigning,
        timeoutMs: this.env.runnerTimeoutMs,
      });

      const cursor = commit.cursor;

      this.recordHostedRunBreadcrumb({
        level: commit.committed ? "info" : "warn",
        message: commit.committed
          ? "Cloudflare won the hosted run commit."
          : "Cloudflare lost the hosted run commit.",
        phase: commit.committed ? "commit_won" : "commit_lost",
        redacted: {
          commitKind: "quarantine",
          quarantinedEventCount: input.acquired.events.length,
          validEventCount: 0,
        },
        run,
        runToken,
        userId: input.userId,
      });

      return {
        cursor,
        state: commit.committed ? "completed" : "backpressured",
      };
    }

    const messagingActivity = await this.runProcessor.startRunMessagingActivity({
      events: resolved.events,
      run,
    });
    let messagingActivityStopped = false;
    const stopMessagingActivity = async () => {
      if (messagingActivityStopped || !messagingActivity) {
        return;
      }

      messagingActivityStopped = true;
      await messagingActivity.stop();
    };

    try {
      await this.ensureManagedUserCryptoForActivationWakeIfNeeded(primaryWake);
      const execution = await this.runProcessor.executeRunDrain({
        currentBundleRef: this.resolveAcquiredRunInputSnapshotRef(input.acquired),
        events: resolved.events,
        primaryWake,
        messagingActivityOwnedByExecutor: messagingActivity?.ownsRuntimeActivity === true,
        run,
        runToken,
      });

      if (execution.state !== "completed") {
        return this.failAcquiredHostedRun({
          acquired: input.acquired,
          failureCode: "HOSTED_RUN_RUNTIME_BACKPRESSURED",
          run,
          runToken,
          userId: input.userId,
        });
      }

      const commitInputs = await this.mergeAdoptedHostedRunCommitInputs({
        eventResults: resolved.eventResults,
        outputCommittedSeq: resolved.outputCommittedSeq,
        run,
        userId: input.userId,
      });

      this.recordHostedRunBreadcrumb({
        message: "Cloudflare attempted to commit the acquired hosted run.",
        phase: "commit_attempted",
        redacted: {
          commitKind: execution.finalizeRequired ? "prepared_snapshot_finalize" : "prepared_snapshot",
          eventCount: commitInputs.eventResults.length,
          preparedSnapshotPresent: execution.cursorSnapshotRef !== null,
        },
        run,
        runToken,
        userId: input.userId,
      });
      const commit = await commitHostedRunToWeb({
        baseUrl: this.readHostedWebControlBaseUrl(),
        body: {
          eventResults: commitInputs.eventResults,
          expectedCursorVersion: input.acquired.cursor.version,
          finalizeRequired: execution.finalizeRequired,
          ...(execution.nextRuntimeWakeAt === undefined
            ? {}
            : {
                nextRuntimeWakeAt: execution.nextRuntimeWakeAt ?? null,
                nextRuntimeWakeReason: execution.nextRuntimeWakeAt ? "runtime" : null,
              }),
          outputCommittedSeq: commitInputs.outputCommittedSeq,
          browserVaultReplicaRef: execution.finalizeRequired ? undefined : execution.browserVaultReplicaRef ?? null,
          preparedSnapshotRef: execution.cursorSnapshotRef,
          redactedSummary: execution.redactedSummary ?? null,
          runId: run.id,
          runToken,
        },
        boundUserId: input.userId,
        callbackSigning: this.env.webCallbackSigning,
        timeoutMs: this.env.runnerTimeoutMs,
      });

      this.recordHostedRunBreadcrumb({
        level: commit.committed ? "info" : "warn",
        message: commit.committed
          ? "Cloudflare won the hosted run commit."
          : "Cloudflare lost the hosted run commit.",
        phase: commit.committed ? "commit_won" : "commit_lost",
        redacted: {
          commitKind: execution.finalizeRequired ? "prepared_snapshot_finalize" : "prepared_snapshot",
          eventCount: commitInputs.eventResults.length,
          needsFinalize: commit.needsFinalize,
        },
        run,
        runToken,
        userId: input.userId,
      });

      if (!commit.committed || !commit.run) {
        if (execution.cursorSnapshotRef) {
          await this.syncRunnerBundleCacheToCursor(commit.cursor.snapshotRef);
        }
        return {
          cursor: commit.cursor,
          state: "backpressured",
        };
      }

      let cursor = commit.cursor;

      if (commit.needsFinalize) {
        await this.syncRunnerBundleCacheToCursor(cursor.snapshotRef);
        const resumeFinalizeAcquire = await acquireHostedRunFromWeb({
          baseUrl: this.readHostedWebControlBaseUrl(),
          body: {
            executorKind: "cloudflare-container",
            triggerKind: "retry_finalize",
          },
          boundUserId: input.userId,
          callbackSigning: this.env.webCallbackSigning,
          timeoutMs: this.env.runnerTimeoutMs,
        });
        if (
          !resumeFinalizeAcquire.acquired
          || resumeFinalizeAcquire.resumeFinalize !== true
          || !resumeFinalizeAcquire.run
          || !resumeFinalizeAcquire.runToken
          || resumeFinalizeAcquire.run.id !== commit.run.id
          || resumeFinalizeAcquire.run.status !== "finalizing"
        ) {
          return {
            cursor: resumeFinalizeAcquire.cursor,
            state: "backpressured",
          };
        }
        const finalized = await this.finalizeAcquiredHostedRun({
          acquired: resumeFinalizeAcquire,
          messagingActivityOwnedByExecutor: messagingActivity?.ownsRuntimeActivity === true,
          onRuntimeDeliveryFinished: stopMessagingActivity,
          userId: input.userId,
        });
        cursor = finalized.cursor;
        if (finalized.state !== "completed") {
          return finalized;
        }
      }

      for (const event of resolved.events) {
        if (event.wake.kind === "runtime.timer") {
          continue;
        }
        await this.runProcessor.cleanupTransientWakeDataBestEffortForRunDrain(
          event.wake,
        );
      }

      return {
        cursor,
        state: "completed",
      };
    } finally {
      await stopMessagingActivity();
    }
  }

  private async finalizeAcquiredHostedRun(input: {
    acquired: HostedRunAcquireResponse;
    messagingActivityOwnedByExecutor?: boolean;
    onRuntimeDeliveryFinished?: () => Promise<void>;
    userId: string;
  }): Promise<{
    cursor: HostedExecutionCursorState;
    state: HostedRunDrainState;
  }> {
    const run = input.acquired.run;
    const runToken = input.acquired.runToken;
    if (
      !run
      || !runToken
      || input.acquired.resumeFinalize !== true
      || run.status !== "finalizing"
    ) {
      return {
        cursor: input.acquired.cursor,
        state: "backpressured",
      };
    }

    await this.syncRunnerBundleCacheToCursor(input.acquired.cursor.snapshotRef);
    this.recordHostedRunBreadcrumb({
      message: "Cloudflare started hosted run finalization from the prepared snapshot.",
      phase: "finalize_started",
      redacted: {
        resumeFinalize: input.acquired.resumeFinalize,
      },
      run,
      runToken,
      userId: input.userId,
    });
    const execution = await this.runProcessor.finalizeRunDrain({
      currentBundleRef: this.resolveAcquiredRunPreparedSnapshotRef(input.acquired),
      primaryWake: createRuntimeTimerSyntheticWake({
        acquiredAt: run.acquiredAt,
        runId: run.id,
        triggerKind: run.triggerKind,
        userId: input.userId,
      }),
      messagingActivityOwnedByExecutor: input.messagingActivityOwnedByExecutor === true,
      run,
      runToken,
    });

    if (execution.state === "completed") {
      await input.onRuntimeDeliveryFinished?.();
    }

    if (execution.state !== "completed") {
      await this.releaseHostedRunFinalizeForRetry({
        failureCode: execution.state === "backpressured"
          ? "HOSTED_RUN_FINALIZE_BACKPRESSURED"
          : "HOSTED_RUN_FINALIZE_RETRYABLE",
        run,
        runToken,
        userId: input.userId,
      });
      return {
        cursor: input.acquired.cursor,
        state: execution.state,
      };
    }

    const finalized = await finalizeHostedRunInWeb({
      baseUrl: this.readHostedWebControlBaseUrl(),
      body: {
        browserVaultReplicaRef: execution.browserVaultReplicaRef ?? null,
        finalSnapshotRef: execution.cursorSnapshotRef,
        ...(execution.nextRuntimeWakeAt === undefined
          ? {}
          : {
              nextRuntimeWakeAt: execution.nextRuntimeWakeAt ?? null,
              nextRuntimeWakeReason: execution.nextRuntimeWakeAt ? "runtime" : null,
            }),
        redactedSummary: execution.redactedSummary ?? null,
        runId: run.id,
        runToken,
      },
      boundUserId: input.userId,
      callbackSigning: this.env.webCallbackSigning,
      timeoutMs: this.env.runnerTimeoutMs,
    });

    this.recordHostedRunBreadcrumb({
      level: finalized.finalized ? "info" : "warn",
      message: "Cloudflare finished hosted run finalization.",
      phase: "finalize_finished",
      redacted: {
        finalized: finalized.finalized,
        nextRuntimeWakeScheduled: execution.nextRuntimeWakeAt !== null,
      },
      run,
      runToken,
      userId: input.userId,
    });

    return {
      cursor: finalized.cursor,
      state: finalized.finalized ? "completed" : "backpressured",
    };
  }

  private async releaseHostedRunFinalizeForRetry(input: {
    failureCode: string;
    run: HostedRunRecord;
    runToken: string;
    userId: string;
  }): Promise<void> {
    try {
      const released = await releaseHostedRunFinalizeInWeb({
        baseUrl: this.readHostedWebControlBaseUrl(),
        body: {
          failureClass: "hosted_run_finalize_retryable",
          failureCode: input.failureCode,
          runId: input.run.id,
          runToken: input.runToken,
        },
        boundUserId: input.userId,
        callbackSigning: this.env.webCallbackSigning,
        timeoutMs: this.env.runnerTimeoutMs,
      });

      this.recordHostedRunBreadcrumb({
        level: released.released ? "warn" : "error",
        message: released.released
          ? "Cloudflare released hosted run finalization for retry."
          : "Cloudflare could not release hosted run finalization for retry.",
        phase: released.released ? "finalize_released" : "finalize_release_failed",
        redacted: {
          failureCode: input.failureCode,
          released: released.released,
        },
        run: input.run,
        runToken: input.runToken,
        userId: input.userId,
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "cloudflare.user-runner",
        details: {
          failureCode: input.failureCode,
          runId: input.run.id,
        },
        error,
        level: "error",
        message: "Hosted run finalize release request failed; stale-run recovery is now the fallback.",
        phase: "wake.running",
        userId: input.userId,
      });
    }
  }

  private async failAcquiredHostedRun(input: {
    acquired: HostedRunAcquireResponse;
    failureCode: string;
    run: HostedRunRecord;
    runToken: string;
    userId: string;
  }): Promise<{
    cursor: HostedExecutionCursorState;
    state: HostedRunDrainState;
  }> {
    this.recordHostedRunBreadcrumb({
      message: "Cloudflare attempted to commit the acquired hosted run.",
      phase: "commit_attempted",
      redacted: {
        commitKind: "failure",
        failureCode: input.failureCode,
      },
      run: input.run,
      runToken: input.runToken,
      userId: input.userId,
    });
    const commit = await commitHostedRunToWeb({
      baseUrl: this.readHostedWebControlBaseUrl(),
      body: {
        expectedCursorVersion: input.acquired.cursor.version,
        failureClass: "hosted_run_runtime",
        failureCode: input.failureCode,
        finalizeRequired: false,
        outputCommittedSeq: input.acquired.cursor.committedSeq,
        preparedSnapshotRef: input.acquired.cursor.snapshotRef,
        runId: input.run.id,
        runToken: input.runToken,
      },
      boundUserId: input.userId,
      callbackSigning: this.env.webCallbackSigning,
      timeoutMs: this.env.runnerTimeoutMs,
    });

    this.recordHostedRunBreadcrumb({
      level: commit.committed ? "info" : "warn",
      message: commit.committed
        ? "Cloudflare won the hosted run commit."
        : "Cloudflare lost the hosted run commit.",
      phase: commit.committed ? "commit_won" : "commit_lost",
      redacted: {
        commitKind: "failure",
        failureCode: input.failureCode,
      },
      run: input.run,
      runToken: input.runToken,
      userId: input.userId,
    });

    return {
      cursor: commit.cursor,
      state: "backpressured",
    };
  }

  private async mergeAdoptedHostedRunCommitInputs(input: {
    eventResults: HostedRunEventResult[];
    outputCommittedSeq: string;
    run: HostedRunRecord;
    userId: string;
  }): Promise<{
    eventResults: HostedRunEventResult[];
    outputCommittedSeq: string;
  }> {
    const status = await readHostedRunStatusFromWeb({
      baseUrl: this.readHostedWebControlBaseUrl(),
      body: {
        runId: input.run.id,
      },
      boundUserId: input.userId,
      callbackSigning: this.env.webCallbackSigning,
      timeoutMs: this.env.runnerTimeoutMs,
    });
    if (status.run?.id !== input.run.id) {
      throw new Error("Hosted run status refresh did not return the active run before commit.");
    }

    const latestRun = status.run;
    const mergedResults: HostedRunEventResult[] = [...input.eventResults];
    const resultIds = new Set(mergedResults.map((result) => result.ingressEventId));
    let outputCommittedSeq = BigInt(input.outputCommittedSeq);
    const eventCount = Math.min(
      latestRun.eventSeqs.length,
      latestRun.ingressEventIds.length,
    );

    for (let index = 0; index < eventCount; index += 1) {
      const seqText = latestRun.eventSeqs[index];
      if (!seqText) {
        continue;
      }
      const seq = BigInt(seqText);
      if (seq > outputCommittedSeq) {
        outputCommittedSeq = seq;
      }
    }

    for (let index = 0; index < eventCount; index += 1) {
      const seqText = latestRun.eventSeqs[index];
      const ingressEventId = latestRun.ingressEventIds[index];
      if (!seqText || !ingressEventId) {
        continue;
      }
      const seq = BigInt(seqText);
      if (seq > outputCommittedSeq || resultIds.has(ingressEventId)) {
        continue;
      }

      mergedResults.push({
        ingressEventId,
        state: "completed",
      });
      resultIds.add(ingressEventId);
    }

    return {
      eventResults: mergedResults,
      outputCommittedSeq: outputCommittedSeq.toString(),
    };
  }

  private async resolveHostedRunDrainInputs(input: {
    acquired: HostedRunAcquireResponse;
    run: HostedRunRecord;
    userId: string;
  }): Promise<{
    eventResults: HostedRunEventResult[];
    events: HostedRuntimeDrainEvent[];
    outputCommittedSeq: string;
    primaryWake: HostedRuntimeEvent | null;
  }> {
    const eventResults: HostedRunEventResult[] = [];
    const events: HostedRuntimeDrainEvent[] = [];
    let outputCommittedSeq = BigInt(input.acquired.cursor.committedSeq);
    let primaryWake: HostedRuntimeEvent | null = null;

    for (const wake of input.acquired.events) {
      outputCommittedSeq = maxHostedCommittedSeqHint(outputCommittedSeq, BigInt(wake.seq))
        ?? outputCommittedSeq;
      let hostedWake: HostedIngressEnvelope;

      try {
        const decryptedPayload = await this.decryptHostedWakeExecutionPayload(wake, input.userId);
        hostedWake = parseHostedIngressPayload({
          decryptedPayload,
          kind: wake.kind,
          occurredAt: wake.occurredAt,
          payloadSchema: wake.payloadSchema,
          userId: input.userId,
        });
      } catch (error) {
        this.quarantineHostedRunWake({
          details: {
            wakeKind: wake.kind,
            wakePayloadSchema: wake.payloadSchema,
          },
          error,
          eventResults,
          message: `Hosted run event seq ${wake.seq} has an invalid payload and will be quarantined at run commit.`,
          quarantineCode: HOSTED_WAKE_QUARANTINE_INVALID_PAYLOAD,
          runId: input.run.id,
          userId: input.userId,
          wake,
        });
        continue;
      }

      if (hostedWake.userId !== input.userId) {
        this.quarantineHostedRunWake({
          details: {
            wakeUserId: hostedWake.userId,
          },
          eventResults,
          message: `Hosted run event seq ${wake.seq} is bound to ${hostedWake.userId}, not ${input.userId}.`,
          quarantineCode: HOSTED_WAKE_QUARANTINE_USER_MISMATCH,
          runId: input.run.id,
          userId: input.userId,
          wake,
        });
        continue;
      }

      await this.ensureManagedUserCryptoForActivationWakeIfNeeded(hostedWake);

      let sharePack: HostedRuntimeDrainEvent["sharePack"] = null;
      let vaultSyncImport: HostedRuntimeDrainEvent["vaultSyncImport"] = null;
      try {
        sharePack = await this.runProcessor.readRunDrainSharePack(hostedWake);
        vaultSyncImport = await this.runProcessor.readRunDrainVaultSyncImport(hostedWake);
      } catch (error) {
        this.quarantineHostedRunWake({
          error,
          eventResults,
          message: `Hosted run event seq ${wake.seq} could not hydrate its side input payload and will be quarantined at run commit.`,
          quarantineCode: "hosted-side-input-unavailable",
          runId: input.run.id,
          userId: input.userId,
          wake,
        });
        continue;
      }

      try {
        await this.assertHostedWakeRuntimeInputsAvailable(hostedWake);
      } catch (error) {
        if (!(error instanceof HostedEmailRawMessageMissingError)) {
          throw error;
        }

        this.quarantineHostedRunWake({
          error,
          eventResults,
          message: `Hosted run event seq ${wake.seq} is missing its raw email payload and will be quarantined at run commit.`,
          quarantineCode: HOSTED_WAKE_QUARANTINE_EMAIL_RAW_MESSAGE_MISSING,
          runId: input.run.id,
          userId: input.userId,
          wake,
        });
        continue;
      }

      events.push({
        ingressEventId: wake.id,
        seq: wake.seq,
        ...(sharePack ? { sharePack } : {}),
        ...(vaultSyncImport ? { vaultSyncImport } : {}),
        wake: hostedWake,
      });
      eventResults.push({
        ingressEventId: wake.id,
        state: "completed",
      });
      primaryWake ??= hostedWake;
    }

    return {
      eventResults,
      events,
      outputCommittedSeq: outputCommittedSeq.toString(),
      primaryWake,
    };
  }

  private async assertHostedWakeRuntimeInputsAvailable(
    wake: HostedIngressEnvelope,
  ): Promise<void> {
    if (wake.kind !== "conversation.message" || wake.message.channel !== "email") {
      return;
    }

    const { crypto } = await this.ensureRunnerStores(wake.userId);
    const rawMessage = await readHostedEmailRawMessage({
      bucket: this.bucket,
      key: crypto.rootKey,
      keyId: crypto.rootKeyId,
      keysById: crypto.keysById,
      rawMessageKey: wake.message.rawMessageKey,
      userId: wake.userId,
    });

    if (!rawMessage) {
      throw new HostedEmailRawMessageMissingError({
        rawMessageKey: wake.message.rawMessageKey,
        userId: wake.userId,
      });
    }
  }

  private async decryptHostedWakeExecutionPayload(
    wake: HostedRunAcquireResponse["events"][number],
    userId: string,
  ): Promise<unknown> {
    const payloadCiphertext = "payloadCiphertext" in wake ? wake.payloadCiphertext : null;

    if (typeof payloadCiphertext !== "string" || payloadCiphertext.length === 0) {
      throw new TypeError("Hosted wake payload ciphertext is required.");
    }

    return await decryptHostedIngressPayloadCiphertext({
      ciphertext: payloadCiphertext,
      environment: this.env.hostedIngressEncryption,
      userId,
    });
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
        timeoutMs: this.env.runnerTimeoutMs,
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
      timeoutMs: this.env.runnerTimeoutMs,
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

  private async tryReadBoundUserId(): Promise<string | null> {
    if (this.runnerStores?.userId) {
      return this.runnerStores.userId;
    }

    try {
      return (await this.stateStore.readState()).userId;
    } catch {
      return null;
    }
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

  private async scheduleHostedWakeRetryAlarm(): Promise<void> {
    await this.runtimeAlarmScheduler.syncNextWake({
      preferredWakeAt: new Date(Date.now() + HOSTED_WAKE_NUDGE_RETRY_DELAY_MS).toISOString(),
    });
  }

  private quarantineHostedRunWake(input: {
    details?: Record<string, unknown>;
    error?: unknown;
    eventResults: HostedRunEventResult[];
    message: string;
    quarantineCode: string;
    runId: string;
    userId: string;
    wake: HostedRunAcquireResponse["events"][number];
  }): void {
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        hostedRunId: input.runId,
        quarantineCode: input.quarantineCode,
        ingressEventId: input.wake.id,
        wakeSeq: input.wake.seq,
        ...(input.details ?? {}),
      },
      ...(input.error === undefined ? {} : { error: input.error }),
      level: "warn",
      message: input.message,
      phase: "wake.running",
      userId: input.userId,
    });
    input.eventResults.push({
      ingressEventId: input.wake.id,
      quarantineCode: input.quarantineCode,
      state: "quarantined",
    });
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

function maxHostedCommittedSeqHint(left: bigint | null, right: bigint | null): bigint | null {
  if (left === null) {
    return right;
  }

  if (right === null) {
    return left;
  }

  return left > right ? left : right;
}
