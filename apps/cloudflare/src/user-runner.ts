import type {
  HostedExecutionDispatchRequest,
  HostedExecutionRunnerRequest,
  HostedExecutionUserStatus,
} from "@healthybob/runtime-state";

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
  destroyHostedExecutionContainer,
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
  CONSUMED_EVENT_TTL_MS,
  computeRetryDelayMs,
  toUserStatus,
  type DurableObjectStateLike,
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
  private readonly userEnvLocks = new Map<string, Promise<void>>();

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
      this.queueStore,
      this.readUserEnvSource(),
    );
    this.commitRecovery = createRunnerCommitRecovery({
      bucket,
      bundleEncryptionKey: env.bundleEncryptionKey,
      bundleEncryptionKeyId: env.bundleEncryptionKeyId,
      queueStore: this.queueStore,
      scheduler: this.scheduler,
    });
  }

  async dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus> {
    const committed = await this.commitRecovery.readCommittedDispatch(input.event.userId, input.eventId);
    if (committed) {
      const presence = await this.queueStore.readEventPresence(input.event.userId, input.eventId);
      if (presence.pending || presence.consumed || isCommittedResultFresh(committed, CONSUMED_EVENT_TTL_MS)) {
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
            ? await this.commitRecovery.applyCommittedDispatch(input.event.userId, committed)
            : await this.queueStore.rememberCommittedEvent(input.event.userId, input.eventId),
        );
      }

      await this.commitRecovery.deleteCommittedDispatch(input.event.userId, input.eventId);
    }

    const enqueueResult = await this.queueStore.enqueueDispatch(input);
    let record = enqueueResult.record;

    if (enqueueResult.accepted) {
      record = await this.scheduler.syncNextWake(record.userId);
    }

    if (enqueueResult.alreadySeen || record.backpressuredEventIds.includes(input.eventId)) {
      return toUserStatus(record);
    }

    return this.runQueuedEvents(record.userId);
  }

  async alarm(): Promise<void> {
    let record = await this.queueStore.readState(null);
    if (!record.activated && record.pendingEventCount === 0) {
      return;
    }

    if (record.activated && !(await this.queueStore.hasDuePendingDispatch(record.userId, Date.now()))) {
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
        record = await this.scheduler.syncNextWake(record.userId);
      } else {
        record = enqueueResult.record;
      }
    }

    if (!record.activated && record.pendingEventCount === 0) {
      return;
    }

    await this.runQueuedEvents(record.userId);
  }

  async status(userId: string): Promise<HostedExecutionUserStatus> {
    return toUserStatus(await this.queueStore.readState(userId));
  }

  async getUserEnvStatus(userId: string): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    return {
      configuredUserEnvKeys: listHostedUserEnvKeys(await this.bundleSync.readUserEnv(userId)),
      userId,
    };
  }

  async updateUserEnv(
    userId: string,
    update: HostedUserEnvUpdate,
  ): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    return this.withUserEnvLock(userId, () => this.bundleSync.updateUserEnv(userId, update));
  }

  async clearUserEnv(userId: string): Promise<{ configuredUserEnvKeys: string[]; userId: string }> {
    return this.updateUserEnv(userId, {
      env: {},
      mode: "replace",
    });
  }

  async commit(input: {
    eventId: string;
    payload: HostedExecutionCommitPayload & {
      currentBundleRefs: {
        agentState: import("@healthybob/runtime-state").HostedExecutionBundleRef | null;
        vault: import("@healthybob/runtime-state").HostedExecutionBundleRef | null;
      };
    };
    userId: string;
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
    userId: string;
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
    let record = await this.queueStore.readState(userId);
    const recovered = await this.commitRecovery.recoverCommittedPendingDispatch(record);
    if (recovered) {
      record = recovered;
    }

    try {
      while (true) {
        const recoveredPending = await this.commitRecovery.recoverCommittedPendingDispatch(record);
        if (recoveredPending) {
          record = recoveredPending;
          continue;
        }

        const claim = await this.queueStore.claimNextDuePendingDispatch(userId, Date.now());
        const nextPending = claim.pendingDispatch;
        record = claim.record;

        if (!nextPending) {
          return toUserStatus(await this.scheduler.syncNextWake(userId));
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
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const committed = await this.commitRecovery.readCommittedDispatch(
            record.userId,
            nextPending.dispatch.eventId,
          );

          if (committed) {
            if (isCommittedResultFinalized(committed)) {
              record = await this.commitRecovery.applyCommittedDispatch(record.userId, committed);
              continue;
            }

            record = await this.commitRecovery.rescheduleCommittedFinalizeRetry({
              attempts: nextPending.attempts + 1,
              committed,
              errorMessage,
              retryDelayMs: computeRetryDelayMs(this.env.retryDelayMs, nextPending.attempts + 1),
              userId: record.userId,
            });
            return toUserStatus(record);
          }

          record = await this.queueStore.reschedulePendingFailure({
            errorMessage,
            eventId: nextPending.dispatch.eventId,
            maxEventAttempts: this.env.maxEventAttempts,
            retryDelayMs: computeRetryDelayMs(this.env.retryDelayMs, nextPending.attempts + 1),
            userIdHint: record.userId,
          });
          record = await this.scheduler.syncNextWake(record.userId);
          return toUserStatus(record);
        }
      }
    } finally {
      await destroyHostedExecutionContainer({
        runnerContainerNamespace: this.runnerContainerNamespace,
        userId,
      });
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

    const bundleState = await this.queueStore.readBundleState(userId);
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

  private async commitOnce(input: {
    eventId: string;
    payload: HostedExecutionCommitPayload & {
      currentBundleRefs: {
        agentState: import("@healthybob/runtime-state").HostedExecutionBundleRef | null;
        vault: import("@healthybob/runtime-state").HostedExecutionBundleRef | null;
      };
    };
    userId: string;
  }): Promise<HostedExecutionCommittedResult> {
    const existing = await this.commitRecovery.readCommittedDispatch(input.userId, input.eventId);
    if (existing) {
      return existing;
    }

    return persistHostedExecutionCommit({
      bucket: this.bucket,
      currentBundleRefs: input.payload.currentBundleRefs,
      eventId: input.eventId,
      key: this.env.bundleEncryptionKey,
      keyId: this.env.bundleEncryptionKeyId,
      payload: input.payload,
      userId: input.userId,
    });
  }

  private async finalizeOnce(input: {
    eventId: string;
    payload: HostedExecutionFinalizePayload;
    userId: string;
  }): Promise<HostedExecutionCommittedResult> {
    return persistHostedExecutionFinalBundles({
      bucket: this.bucket,
      eventId: input.eventId,
      key: this.env.bundleEncryptionKey,
      keyId: this.env.bundleEncryptionKeyId,
      payload: input.payload,
      userId: input.userId,
    });
  }

  private readUserEnvSource(): Readonly<Record<string, string | undefined>> {
    return {
      HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS: this.env.allowedUserEnvKeys ?? undefined,
      HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES: this.env.allowedUserEnvPrefixes ?? undefined,
    };
  }

  private async withUserEnvLock<T>(userId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.userEnvLocks.get(userId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.catch(() => {}).then(() => current);
    this.userEnvLocks.set(userId, chain);
    await previous.catch(() => {});

    try {
      return await run();
    } finally {
      release();
      if (this.userEnvLocks.get(userId) === chain) {
        this.userEnvLocks.delete(userId);
      }
    }
  }
}
