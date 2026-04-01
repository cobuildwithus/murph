import type {
  HostedExecutionBundleRefs,
  HostedExecutionDispatchResult,
  HostedExecutionDispatchRequest,
  HostedExecutionRunLevel,
  HostedExecutionRunContext,
  HostedExecutionRunPhase,
  HostedExecutionUserEnvStatus,
  HostedExecutionUserStatus,
} from "@murphai/hosted-execution";
import type { HostedAssistantRuntimeJobInput } from "@murphai/assistant-runtime";
import type {
  GatewayFetchAttachmentsInput,
  GatewayGetConversationInput,
  GatewayListConversationsInput,
  GatewayListConversationsResult,
  GatewayListOpenPermissionsInput,
  GatewayPermissionRequest,
  GatewayPollEventsInput,
  GatewayPollEventsResult,
  GatewayReadMessagesInput,
  GatewayReadMessagesResult,
  GatewayRespondToPermissionInput,
} from "@murphai/gateway-core";
import {
  emitHostedExecutionStructuredLog,
  resolveHostedExecutionDispatchOutcomeState,
} from "@murphai/hosted-execution";

import type { R2BucketLike } from "./bundle-store.js";
import { HostedGatewayProjectionStore } from "./gateway-store.js";
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
import {
  buildHostedRunnerContainerEnv,
  buildHostedRunnerJobRuntimeConfig,
} from "./runner-env.ts";
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
  type PendingDispatchRecord,
  type RunnerStateRecord,
} from "./user-runner/types.js";

export type { DurableObjectStateLike } from "./user-runner/types.js";

export class HostedUserRunner {
  private readonly bundleSync: RunnerBundleSync;
  private readonly commitRecovery: ReturnType<typeof createRunnerCommitRecovery>;
  private readonly eventTransitionLocks = new Map<string, Promise<void>>();
  private readonly queueStore: RunnerQueueStore;
  private readonly runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
  private readonly scheduler: RunnerScheduler;
  private readonly gatewayStore: HostedGatewayProjectionStore;
  private userEnvLock: Promise<void> | null = null;

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
    this.queueStore = new RunnerQueueStore(state);
    this.scheduler = new RunnerScheduler(this.queueStore, state, env.defaultAlarmDelayMs);
    this.gatewayStore = new HostedGatewayProjectionStore(state);
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

  async gatewayListConversations(
    input?: GatewayListConversationsInput,
  ): Promise<GatewayListConversationsResult> {
    return this.gatewayStore.listConversations(input);
  }

  async gatewayGetConversation(input: GatewayGetConversationInput) {
    return this.gatewayStore.getConversation(input);
  }

  async gatewayReadMessages(
    input: GatewayReadMessagesInput,
  ): Promise<GatewayReadMessagesResult> {
    return this.gatewayStore.readMessages(input);
  }

  async gatewayFetchAttachments(input: GatewayFetchAttachmentsInput) {
    return this.gatewayStore.fetchAttachments(input);
  }

  async gatewayPollEvents(
    input?: GatewayPollEventsInput,
  ): Promise<GatewayPollEventsResult> {
    return this.gatewayStore.pollEvents(input);
  }

  async gatewayListOpenPermissions(
    input?: GatewayListOpenPermissionsInput,
  ): Promise<GatewayPermissionRequest[]> {
    return this.gatewayStore.listOpenPermissions(input);
  }

  async gatewayRespondToPermission(
    input: GatewayRespondToPermissionInput,
  ): Promise<GatewayPermissionRequest | null> {
    return this.gatewayStore.respondToPermission(input);
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
          const synced = await this.commitRecovery.syncCommittedBundlesWithoutConsuming(
            input.event.userId,
            committed,
          );
          await this.gatewayStore.applySnapshot(committed.gatewayProjectionSnapshot ?? null);

          return toUserStatus(
            await this.advanceRunPhase({
              clearError: true,
              dispatch: input,
              message: "Recovered a durable commit awaiting finalize.",
              phase: "commit.recorded",
              run: this.resolveRunContext(synced, {
                eventId: input.eventId,
                startedAt: committed.committedAt,
              }),
            }),
          );
        }

        await this.gatewayStore.applySnapshot(committed.gatewayProjectionSnapshot ?? null);
        return toUserStatus(
          presence.pending
            ? await this.applyCommittedDispatchAndCleanup(input.event.userId, committed, input)
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

  async getUserEnvStatus(): Promise<HostedExecutionUserEnvStatus> {
    const userId = await this.requireBoundUserId();
    return {
      configuredUserEnvKeys: listHostedUserEnvKeys(await this.bundleSync.readUserEnv(userId)),
      userId,
    };
  }

  async updateUserEnv(
    update: HostedUserEnvUpdate,
  ): Promise<HostedExecutionUserEnvStatus> {
    const userId = await this.requireBoundUserId();
    return this.withUserEnvLock(() => this.bundleSync.updateUserEnv(userId, update));
  }

  async clearUserEnv(): Promise<HostedExecutionUserEnvStatus> {
    return this.updateUserEnv({
      env: {},
      mode: "replace",
    });
  }

  async commit(input: {
    eventId: string;
    payload: HostedExecutionCommitPayload & {
      currentBundleRefs: HostedExecutionBundleRefs;
    };
  }): Promise<HostedExecutionCommittedResult> {
    return this.applyHostedTransition({
      eventId: input.eventId,
      gatewayProjectionSnapshot: input.payload.gatewayProjectionSnapshot ?? null,
      run: async (userId) => persistHostedExecutionCommit({
        bucket: this.bucket,
        currentBundleRefs: input.payload.currentBundleRefs,
        eventId: input.eventId,
        key: this.env.bundleEncryptionKey,
        keyId: this.env.bundleEncryptionKeyId,
        keysById: this.env.bundleEncryptionKeysById,
        payload: input.payload,
        userId,
      }),
    });
  }

  async finalizeCommit(input: {
    eventId: string;
    payload: HostedExecutionFinalizePayload;
  }): Promise<HostedExecutionCommittedResult> {
    return this.applyHostedTransition({
      eventId: input.eventId,
      gatewayProjectionSnapshot: input.payload.gatewayProjectionSnapshot ?? null,
      run: async (userId) => persistHostedExecutionFinalBundles({
        bucket: this.bucket,
        eventId: input.eventId,
        key: this.env.bundleEncryptionKey,
        keyId: this.env.bundleEncryptionKeyId,
        keysById: this.env.bundleEncryptionKeysById,
        payload: input.payload,
        userId,
      }),
    });
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

      const run = this.createRunContext(record, nextPending);
      record = await this.advanceRunPhase({
        clearError: true,
        dispatch: nextPending.dispatch,
        message: "Hosted dispatch claimed for execution.",
        phase: "claimed",
        run,
      });

      try {
        const committed = await this.commitRecovery.readCommittedDispatch(
          record.userId,
          nextPending.dispatch.eventId,
        );
        if (committed && !isCommittedResultFinalized(committed)) {
          await this.gatewayStore.applySnapshot(committed.gatewayProjectionSnapshot ?? null);
        }
        record = await this.advanceRunPhase({
          clearError: true,
          dispatch: nextPending.dispatch,
          message: committed && !isCommittedResultFinalized(committed)
            ? "Resuming hosted dispatch from a durable commit."
            : "Invoking hosted dispatch runtime.",
          phase: "dispatch.running",
          run,
        });
        const runnerResult = await this.invokeRunner(
          record.userId,
          nextPending.dispatch,
          run,
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
        record = await this.advanceRunPhase({
          clearError: true,
          dispatch: nextPending.dispatch,
          message: "Hosted dispatch recorded a durable commit.",
          phase: "commit.recorded",
          run,
        });
        record = await this.bundleSync.applyRunnerResultBundles(
          record.userId,
          record.bundleVersions,
          runnerResult.bundles,
        );
        record = await this.scheduler.syncNextWake(
          runnerResult.result.nextWakeAt ?? null,
        );
        record = await this.advanceRunPhase({
          clearError: true,
          dispatch: nextPending.dispatch,
          message: "Hosted dispatch completed.",
          phase: "completed",
          run,
        });
        await this.deleteCommittedDispatchBestEffort(record.userId, nextPending.dispatch.eventId);
        processedDispatch = true;
      } catch (error) {
        const committed = await this.commitRecovery.readCommittedDispatch(
          record.userId,
          nextPending.dispatch.eventId,
        );

        if (committed) {
          if (isCommittedResultFinalized(committed)) {
            record = await this.applyCommittedDispatchAndCleanup(
              record.userId,
              committed,
              nextPending.dispatch,
              run,
            );
            continue;
          }

          record = await this.commitRecovery.rescheduleCommittedFinalizeRetry({
            attempts: nextPending.attempts + 1,
            committed,
            error,
            retryDelayMs: computeRetryDelayMs(this.env.retryDelayMs, nextPending.attempts + 1),
          });
          record = await this.advanceRunPhase({
            dispatch: nextPending.dispatch,
            error,
            level: "warn",
            message: "Hosted dispatch scheduled a finalize retry.",
            phase: "retry.scheduled",
            run,
          });
          continue;
        }

        if (error instanceof HostedExecutionConfigurationError) {
          record = await this.queueStore.deferPendingConfigurationFailure({
            error,
            eventId: nextPending.dispatch.eventId,
            retryDelayMs: this.env.retryDelayMs,
          });
          record = await this.scheduler.syncNextWake();
          record = await this.advanceRunPhase({
            dispatch: nextPending.dispatch,
            error,
            level: "warn",
            message: "Hosted dispatch delayed for configuration retry.",
            phase: "retry.scheduled",
            run,
          });
          continue;
        }

        const failure = await this.queueStore.reschedulePendingFailure({
          error,
          eventId: nextPending.dispatch.eventId,
          maxEventAttempts: this.env.maxEventAttempts,
          retryDelayMs: computeRetryDelayMs(this.env.retryDelayMs, nextPending.attempts + 1),
        });
        record = failure.record;
        record = await this.scheduler.syncNextWake();
        record = await this.advanceRunPhase({
          dispatch: nextPending.dispatch,
          error,
          level: failure.poisoned ? "error" : "warn",
          message: failure.poisoned
            ? "Hosted dispatch was poisoned after exhausting retries."
            : "Hosted dispatch scheduled a retry.",
          phase: failure.poisoned ? "poisoned" : "retry.scheduled",
          run,
        });
        continue;
      }
    }
  }

  private async invokeRunner(
    userId: string,
    dispatch: HostedExecutionDispatchRequest,
    run: HostedExecutionRunContext,
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

    const [bundleState, userEnv] = await Promise.all([
      this.queueStore.readBundleMetaState(),
      this.bundleSync.readUserEnv(userId),
    ]);
    const forwardedEnv = buildHostedRunnerContainerEnv(this.runnerRuntimeEnvSource);
    const job: HostedAssistantRuntimeJobInput = {
      request: {
        bundles: await this.bundleSync.readBundlesForRunner(),
        commit: {
          bundleRefs: bundleState.bundleRefs,
        },
        dispatch,
        run,
        ...(resume ? { resume } : {}),
      },
      runtime: buildHostedRunnerJobRuntimeConfig({
        forwardedEnv,
        userEnv,
      }),
    };

    return invokeHostedExecutionContainerRunner({
      job,
      runnerContainerNamespace: this.runnerContainerNamespace,
      runnerControlToken: this.env.runnerControlToken,
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
      await this.gatewayStore.applySnapshot(recovered.committed.gatewayProjectionSnapshot ?? null);
      const completedRecord = await this.advanceRunPhase({
        clearError: true,
        dispatch: {
          event: {
            userId: record.userId,
          },
          eventId: recovered.committedEventId,
        },
        message: "Recovered a finalized committed dispatch.",
        phase: "completed",
        run: this.resolveRunContext(recovered.record, {
          eventId: recovered.committedEventId,
          startedAt: recovered.record.lastRunAt ?? new Date().toISOString(),
        }),
      });
      await this.deleteCommittedDispatchBestEffort(record.userId, recovered.committedEventId);
      return completedRecord;
    }

    return recovered.record;
  }

  private async applyCommittedDispatchAndCleanup(
    userId: string,
    committed: HostedExecutionCommittedResult,
    dispatch: Pick<HostedExecutionDispatchRequest, "eventId"> & {
      event: {
        userId: string;
      };
    },
    run: HostedExecutionRunContext | null = null,
  ): Promise<RunnerStateRecord> {
    await this.gatewayStore.applySnapshot(committed.gatewayProjectionSnapshot ?? null);
    let record = await this.commitRecovery.applyCommittedDispatch(userId, committed);
    record = await this.advanceRunPhase({
      clearError: true,
      dispatch,
      message: "Hosted dispatch completed from a committed result.",
      phase: "completed",
      run: run ?? this.resolveRunContext(record, {
        eventId: committed.eventId,
        startedAt: committed.committedAt,
      }),
    });
    await this.deleteCommittedDispatchBestEffort(userId, committed.eventId);
    return record;
  }

  private createRunContext(
    record: RunnerStateRecord,
    pending: PendingDispatchRecord,
  ): HostedExecutionRunContext {
    const priorAttempt = record.run?.eventId === pending.eventId
      ? record.run.attempt
      : 0;

    return {
      attempt: Math.max(pending.attempts + 1, priorAttempt + 1),
      runId: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
    };
  }

  private resolveRunContext(
    record: RunnerStateRecord,
    input: {
      attempt?: number;
      eventId: string;
      startedAt: string;
    },
  ): HostedExecutionRunContext {
    if (record.run && record.run.eventId === input.eventId) {
      return {
        attempt: record.run.attempt,
        runId: record.run.runId,
        startedAt: record.run.startedAt,
      };
    }

    return {
      attempt: input.attempt ?? 1,
      runId: crypto.randomUUID(),
      startedAt: input.startedAt,
    };
  }

  private async advanceRunPhase(input: {
    clearError?: boolean;
    dispatch: Pick<HostedExecutionDispatchRequest, "eventId"> & {
      event: {
        userId: string;
      };
    };
    error?: unknown;
    level?: HostedExecutionRunLevel;
    message: string;
    phase: HostedExecutionRunPhase;
    run: HostedExecutionRunContext;
  }): Promise<RunnerStateRecord> {
    const record = await this.queueStore.recordRunPhase({
      attempt: input.run.attempt,
      clearError: input.clearError,
      component: "runner",
      error: input.error,
      eventId: input.dispatch.eventId,
      level: input.level,
      message: input.message,
      phase: input.phase,
      runId: input.run.runId,
      startedAt: input.run.startedAt,
    });

    emitHostedExecutionStructuredLog({
      component: "runner",
      dispatch: input.dispatch,
      error: input.error,
      level: input.level,
      message: input.message,
      phase: input.phase,
      run: input.run,
    });

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

  private async applyHostedTransition<T>(input: {
    eventId: string;
    gatewayProjectionSnapshot?: HostedExecutionCommitPayload["gatewayProjectionSnapshot"];
    run: (userId: string) => Promise<T>;
  }): Promise<T> {
    return this.withEventTransitionLock(input.eventId, async () => {
      const userId = await this.requireBoundUserId();
      const result = await input.run(userId);
      await this.gatewayStore.applySnapshot(input.gatewayProjectionSnapshot ?? null);
      return result;
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

  private async withEventTransitionLock<T>(eventId: string, run: () => Promise<T>): Promise<T> {
    const previous = this.eventTransitionLocks.get(eventId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.catch(() => {}).then(() => current);
    this.eventTransitionLocks.set(eventId, chain);
    await previous.catch(() => {});

    try {
      return await run();
    } finally {
      release();
      if (this.eventTransitionLocks.get(eventId) === chain) {
        this.eventTransitionLocks.delete(eventId);
      }
    }
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
