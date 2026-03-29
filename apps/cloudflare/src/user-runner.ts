import type {
  HostedExecutionBundleRef,
  HostedExecutionDispatchResult,
  HostedExecutionDispatchRequest,
  HostedExecutionRunnerRequest,
  HostedExecutionUserStatus,
} from "@murph/hosted-execution";
import {
  resolveHostedExecutionDispatchOutcomeState,
} from "@murph/hosted-execution";

import type { R2BucketLike } from "./bundle-store.js";
import type { HostedExecutionEnvironment } from "./env.js";
import {
  persistHostedExecutionCommit,
  persistHostedExecutionFinalBundles,
  type HostedExecutionCommittedResult,
  type HostedExecutionCommitPayload,
  type HostedExecutionFinalizePayload,
} from "./execution-journal.js";
import {
  HostedExecutionConfigurationError,
  type HostedExecutionContainerNamespaceLike,
  invokeHostedExecutionContainerRunner,
} from "./runner-container.js";
import { listHostedUserEnvKeys, type HostedUserEnvUpdate } from "./user-env.js";
import {
  createRunnerCommitRecovery,
  isCommittedResultFinalized,
  isCommittedResultFresh,
} from "./user-runner/runner-commit-recovery.js";
import { RunnerBundleSync } from "./user-runner/runner-bundle-sync.js";
import { RunnerQueueStore } from "./user-runner/runner-queue-store.js";
import { RunnerScheduler } from "./user-runner/runner-scheduler.js";
import {
  COMMITTED_RESULT_FRESH_WINDOW_MS,
  computeRetryDelayMs,
  toUserStatus,
  type DurableObjectStateLike,
  type RunnerStateRecord,
} from "./user-runner/types.js";

export type { DurableObjectStateLike } from "./user-runner/types.js";

export class HostedUserRunner {
  private readonly bundleSync: RunnerBundleSync;
  private readonly commitLocks = new Map<string, Promise<HostedExecutionCommittedResult>>();
  private readonly commitRecovery: ReturnType<typeof createRunnerCommitRecovery>;
  private readonly finalizeLocks = new Map<string, Promise<HostedExecutionCommittedResult>>();
  private readonly queueStore: RunnerQueueStore;
  private readonly runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
  private readonly scheduler: RunnerScheduler;
  private userEnvLock: Promise<void> | null = null;

  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly env: HostedExecutionEnvironment,
    private readonly bucket: R2BucketLike,
    private readonly runnerContainerEnvironment: Readonly<Record<string, string>> = {},
    runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null = (
      state as {
        runnerContainerNamespace?: HostedExecutionContainerNamespaceLike;
      }
    ).runnerContainerNamespace ?? null,
  ) {
    this.runnerContainerNamespace = runnerContainerNamespace;
    this.queueStore = new RunnerQueueStore(state);
    this.scheduler = new RunnerScheduler(this.queueStore, state, env.defaultAlarmDelayMs);
    this.bundleSync = new RunnerBundleSync(
      bucket,
      env.bundleEncryptionKey,
      env.bundleEncryptionKeyId,
      env.bundleEncryptionKeysById,
      this.queueStore,
      this.readUserEnvSource(),
    );
    this.commitRecovery = createRunnerCommitRecovery({
      bucket,
      bundleEncryptionKey: env.bundleEncryptionKey,
      bundleEncryptionKeyId: env.bundleEncryptionKeyId,
      bundleEncryptionKeysById: env.bundleEncryptionKeysById,
      queueStore: this.queueStore,
      scheduler: this.scheduler,
    });
  }

  async bootstrapUser(userId: string): Promise<{ userId: string }> {
    return {
      userId: await this.queueStore.bootstrapUser(userId),
    };
  }

  async dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus> {
    await this.queueStore.bootstrapUser(input.event.userId);
    return this.dispatchBootstrapped(input);
  }

  async dispatchWithOutcome(
    input: HostedExecutionDispatchRequest,
  ): Promise<HostedExecutionDispatchResult> {
    await this.queueStore.bootstrapUser(input.event.userId);
    const initialState = await this.queueStore.readEventState(input.eventId);
    const status = await this.dispatchBootstrapped(input);
    const nextState = await this.queueStore.readEventState(input.eventId);

    return {
      event: {
        eventId: input.eventId,
        lastError: nextState.lastError ?? status.lastError,
        state: resolveHostedExecutionDispatchOutcomeState({
          initialState,
          nextState,
        }),
        userId: input.event.userId,
      },
      status,
    };
  }

  private async dispatchBootstrapped(
    input: HostedExecutionDispatchRequest,
  ): Promise<HostedExecutionUserStatus> {
    const committed = await this.commitRecovery.readCommittedDispatch(input.event.userId, input.eventId);
    if (committed) {
      const presence = await this.queueStore.readEventPresence(input.eventId);
      if (
        presence.pending
        || presence.consumed
        || isCommittedResultFresh(committed, COMMITTED_RESULT_FRESH_WINDOW_MS)
      ) {
        if (!isCommittedResultFinalized(committed)) {
          return toUserStatus(
            await this.commitRecovery.syncCommittedBundlesWithoutConsuming(
              input.event.userId,
              committed,
            ),
          );
        }

        return toUserStatus(
          presence.pending
            ? await this.applyCommittedDispatchAndCleanup(input.event.userId, committed)
            : await this.rememberCommittedEventAndCleanup(input.event.userId, input.eventId),
        );
      }

      await this.commitRecovery.deleteCommittedDispatch(input.event.userId, input.eventId);
    }

    const enqueueResult = await this.queueStore.enqueueDispatch(input);
    let record = enqueueResult.record;

    if (enqueueResult.accepted) {
      record = await this.scheduler.syncNextWake();
    }

    if (enqueueResult.alreadySeen || record.backpressuredEventIds.includes(input.eventId)) {
      return toUserStatus(record);
    }

    return this.runQueuedEvents(record.userId);
  }

  async alarm(): Promise<void> {
    let record: RunnerStateRecord;
    try {
      record = await this.queueStore.readState();
    } catch {
      return;
    }

    record = await this.queueStore.clearNextWakeIfDue(Date.now());
    if (!record.activated && record.pendingEventCount === 0) {
      return;
    }

    if (record.activated && !(await this.queueStore.hasDuePendingDispatch(Date.now()))) {
      const enqueueResult = await this.queueStore.enqueueDispatch({
        event: {
          kind: "assistant.cron.tick",
          reason: "alarm",
          userId: record.userId,
        },
        eventId: `alarm:${Date.now()}`,
        occurredAt: new Date().toISOString(),
      });

      if (enqueueResult.accepted) {
        record = await this.scheduler.syncNextWake();
      } else {
        record = enqueueResult.record;
      }
    }

    if (!record.activated && record.pendingEventCount === 0) {
      return;
    }

    await this.runQueuedEvents(record.userId);
  }

  async status(): Promise<HostedExecutionUserStatus> {
    return toUserStatus(await this.queueStore.readState());
  }

  async getUserEnvStatus(): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    const userId = await this.requireBoundUserId();
    return {
      configuredUserEnvKeys: listHostedUserEnvKeys(await this.bundleSync.readUserEnv(userId)),
      userId,
    };
  }

  async updateUserEnv(
    update: HostedUserEnvUpdate,
  ): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    const userId = await this.requireBoundUserId();
    return this.withUserEnvLock(() => this.bundleSync.updateUserEnv(userId, update));
  }

  async clearUserEnv(): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    return this.updateUserEnv({
      env: {},
      mode: "replace",
    });
  }

  async commit(input: {
    eventId: string;
    payload: HostedExecutionCommitPayload & {
      currentBundleRefs: {
        agentState: HostedExecutionBundleRef | null;
        vault: HostedExecutionBundleRef | null;
      };
    };
  }): Promise<HostedExecutionCommittedResult> {
    const existingLock = this.commitLocks.get(input.eventId);
    if (existingLock) {
      return existingLock;
    }

    const commitPromise = this.commitOnce(input).finally(() => {
      this.commitLocks.delete(input.eventId);
    });
    this.commitLocks.set(input.eventId, commitPromise);
    return commitPromise;
  }

  async finalizeCommit(input: {
    eventId: string;
    payload: HostedExecutionFinalizePayload;
  }): Promise<HostedExecutionCommittedResult> {
    const existingLock = this.finalizeLocks.get(input.eventId);
    if (existingLock) {
      return existingLock;
    }

    const finalizePromise = this.finalizeOnce(input).finally(() => {
      this.finalizeLocks.delete(input.eventId);
    });
    this.finalizeLocks.set(input.eventId, finalizePromise);
    return finalizePromise;
  }

  private async runQueuedEvents(userId: string): Promise<HostedExecutionUserStatus> {
    let record = await this.queueStore.readState();
    let processedDispatch = false;
    const recovered = await this.recoverCommittedPendingDispatchAndCleanup(record);
    if (recovered) {
      record = recovered;
      processedDispatch = true;
    }

    while (true) {
      const recoveredPending = await this.recoverCommittedPendingDispatchAndCleanup(record);
      if (recoveredPending) {
        record = recoveredPending;
        continue;
      }

      const claim = await this.queueStore.claimNextDuePendingDispatch(Date.now());
      const nextPending = claim.pendingDispatch;
      record = claim.record;

      if (!nextPending) {
        return toUserStatus(processedDispatch ? record : await this.scheduler.syncNextWake());
      }

      try {
        const committed = await this.commitRecovery.readCommittedDispatch(
          record.userId,
          nextPending.dispatch.eventId,
        );
        const runnerResult = await this.invokeRunner(
          record.userId,
          nextPending.dispatch,
          committed && !isCommittedResultFinalized(committed)
            ? {
                committedResult: {
                  result: committed.result,
                  sideEffects: committed.sideEffects,
                },
              }
            : null,
        );
        record = await this.commitRecovery.requireCommittedDispatch(
          record.userId,
          nextPending.dispatch.eventId,
        );
        record = await this.bundleSync.applyRunnerResultBundles(
          record.userId,
          record.bundleVersions,
          runnerResult.bundles,
        );
        record = await this.scheduler.syncNextWake(
          runnerResult.result.nextWakeAt ?? null,
        );
        await this.deleteCommittedDispatchBestEffort(record.userId, nextPending.dispatch.eventId);
        processedDispatch = true;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const committed = await this.commitRecovery.readCommittedDispatch(
          record.userId,
          nextPending.dispatch.eventId,
        );

        if (committed) {
          if (isCommittedResultFinalized(committed)) {
            record = await this.applyCommittedDispatchAndCleanup(record.userId, committed);
            continue;
          }

          record = await this.commitRecovery.rescheduleCommittedFinalizeRetry({
            attempts: nextPending.attempts + 1,
            committed,
            errorMessage,
            retryDelayMs: computeRetryDelayMs(this.env.retryDelayMs, nextPending.attempts + 1),
            userId: record.userId,
          });
          record = await this.scheduler.syncNextWake();
          continue;
        }

        if (error instanceof HostedExecutionConfigurationError) {
          record = await this.queueStore.deferPendingConfigurationFailure({
            errorMessage,
            eventId: nextPending.dispatch.eventId,
            retryDelayMs: this.env.retryDelayMs,
          });
          record = await this.scheduler.syncNextWake();
          continue;
        }

        record = await this.queueStore.reschedulePendingFailure({
          errorMessage,
          eventId: nextPending.dispatch.eventId,
          maxEventAttempts: this.env.maxEventAttempts,
          retryDelayMs: computeRetryDelayMs(this.env.retryDelayMs, nextPending.attempts + 1),
        });
        record = await this.scheduler.syncNextWake();
        continue;
      }
    }
  }

  private async invokeRunner(
    userId: string,
    dispatch: HostedExecutionDispatchRequest,
    resume: {
      committedResult: {
        result: HostedExecutionCommittedResult["result"];
        sideEffects: HostedExecutionCommittedResult["sideEffects"];
      };
    } | null = null,
  ) {
    if (!this.runnerContainerNamespace) {
      throw new Error("Native hosted execution requires a RunnerContainer binding.");
    }

    const bundleState = await this.queueStore.readBundleState();
    const requestBody: HostedExecutionRunnerRequest & {
      commit: {
        bundleRefs: typeof bundleState.bundleRefs;
      };
      resume?: {
        committedResult: {
          result: HostedExecutionCommittedResult["result"];
          sideEffects: HostedExecutionCommittedResult["sideEffects"];
        };
      };
      userEnv: Record<string, string>;
    } = {
      bundles: await this.bundleSync.readBundlesForRunner(userId),
      commit: {
        bundleRefs: bundleState.bundleRefs,
      },
      dispatch,
      ...(resume ? { resume } : {}),
      userEnv: await this.bundleSync.readUserEnv(userId),
    };

    return invokeHostedExecutionContainerRunner({
      request: requestBody,
      runnerContainerNamespace: this.runnerContainerNamespace,
      runnerControlToken: this.env.runnerControlToken,
      runnerEnvironment: this.runnerContainerEnvironment,
      timeoutMs: this.env.runnerTimeoutMs,
      userId,
    });
  }

  private async recoverCommittedPendingDispatchAndCleanup(
    record: RunnerStateRecord,
  ): Promise<RunnerStateRecord | null> {
    const recovered = await this.commitRecovery.recoverCommittedPendingDispatch(record);
    if (!recovered) {
      return null;
    }

    if (recovered.committedEventId) {
      await this.deleteCommittedDispatchBestEffort(record.userId, recovered.committedEventId);
    }

    return recovered.record;
  }

  private async applyCommittedDispatchAndCleanup(
    userId: string,
    committed: HostedExecutionCommittedResult,
  ): Promise<RunnerStateRecord> {
    const record = await this.commitRecovery.applyCommittedDispatch(userId, committed);
    await this.deleteCommittedDispatchBestEffort(userId, committed.eventId);
    return record;
  }

  private async rememberCommittedEventAndCleanup(
    userId: string,
    eventId: string,
  ): Promise<RunnerStateRecord> {
    const record = await this.queueStore.rememberCommittedEvent(eventId);
    await this.deleteCommittedDispatchBestEffort(userId, eventId);
    return record;
  }

  private async deleteCommittedDispatchBestEffort(userId: string, eventId: string): Promise<void> {
    try {
      await this.commitRecovery.deleteCommittedDispatch(userId, eventId);
    } catch {
      // Leaving the transient journal behind is preferable to failing a successful hosted run.
    }
  }

  private async commitOnce(input: {
    eventId: string;
    payload: HostedExecutionCommitPayload & {
      currentBundleRefs: {
        agentState: HostedExecutionBundleRef | null;
        vault: HostedExecutionBundleRef | null;
      };
    };
  }): Promise<HostedExecutionCommittedResult> {
    const userId = await this.requireBoundUserId();
    return persistHostedExecutionCommit({
      bucket: this.bucket,
      currentBundleRefs: input.payload.currentBundleRefs,
      eventId: input.eventId,
      key: this.env.bundleEncryptionKey,
      keyId: this.env.bundleEncryptionKeyId,
      keysById: this.env.bundleEncryptionKeysById,
      payload: input.payload,
      userId,
    });
  }

  private async finalizeOnce(input: {
    eventId: string;
    payload: HostedExecutionFinalizePayload;
  }): Promise<HostedExecutionCommittedResult> {
    const userId = await this.requireBoundUserId();
    return persistHostedExecutionFinalBundles({
      bucket: this.bucket,
      eventId: input.eventId,
      key: this.env.bundleEncryptionKey,
      keyId: this.env.bundleEncryptionKeyId,
      keysById: this.env.bundleEncryptionKeysById,
      payload: input.payload,
      userId,
    });
  }

  private readUserEnvSource(): Readonly<Record<string, string | undefined>> {
    return {
      HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS: this.env.allowedUserEnvKeys ?? undefined,
      HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES: this.env.allowedUserEnvPrefixes ?? undefined,
    };
  }

  private async requireBoundUserId(): Promise<string> {
    return (await this.queueStore.readState()).userId;
  }

  private async withUserEnvLock<T>(run: () => Promise<T>): Promise<T> {
    const previous = this.userEnvLock ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.catch(() => {}).then(() => current);
    this.userEnvLock = chain;
    await previous.catch(() => {});

    try {
      return await run();
    } finally {
      release();
      if (this.userEnvLock === chain) {
        this.userEnvLock = null;
      }
    }
  }
}
