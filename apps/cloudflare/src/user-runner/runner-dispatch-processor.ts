import type {
  HostedExecutionDispatchRequest,
  HostedExecutionRunContext,
  HostedExecutionRunLevel,
  HostedExecutionRunPhase,
  HostedExecutionUserStatus,
} from "@murphai/hosted-execution";
import type {
  HostedAssistantRuntimeJobInput,
  HostedAssistantRuntimeJobResult,
} from "@murphai/assistant-runtime";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";

import type { R2BucketLike } from "../bundle-store.js";
import type { HostedExecutionEnvironment } from "../env.js";
import {
  persistHostedExecutionCommit,
  persistHostedExecutionFinalBundles,
  type HostedExecutionCommitPayload,
  type HostedExecutionCommittedResult,
  type HostedExecutionFinalizePayload,
} from "../execution-journal.js";
import { deleteHostedEmailRawMessage } from "../hosted-email.js";
import type { HostedUserCryptoContext } from "../user-key-store.js";
import { HostedGatewayProjectionStore } from "../gateway-store.js";
import {
  HostedExecutionConfigurationError,
  type HostedExecutionContainerNamespaceLike,
  invokeHostedExecutionContainerRunner,
} from "../runner-container.js";
import {
  buildHostedRunnerContainerEnv,
  buildHostedRunnerJobRuntimeConfig,
} from "../runner-env.ts";
import {
  COMMITTED_RESULT_FRESH_WINDOW_MS,
  computeRetryDelayMs,
  toUserStatus,
  type PendingDispatchRecord,
  type RunnerStateRecord,
} from "./types.js";
import { applyHostedWebBusinessOutcomeIfNeeded } from "../runner-outbound/business-outcomes.ts";
import {
  RunnerCommitRecovery,
  isCommittedResultFinalized,
  isCommittedResultFresh,
} from "./runner-commit-recovery.js";
import { RunnerBundleSync } from "./runner-bundle-sync.js";
import { RunnerQueueStore } from "./runner-queue-store.js";
import { RunnerScheduler } from "./runner-scheduler.js";
import { RunnerUserEnvService } from "./runner-user-env.js";

export type HostedExecutionDispatchProgressRecord =
  Pick<HostedExecutionDispatchRequest, "eventId">
  & {
    event: Pick<HostedExecutionDispatchRequest["event"], "userId">;
  };

export interface RunnerUserStores {
  bundleSync: RunnerBundleSync;
  commitRecovery: RunnerCommitRecovery;
  crypto: HostedUserCryptoContext;
  gatewayStore: HostedGatewayProjectionStore;
  userEnv: RunnerUserEnvService;
  userId: string;
}

interface RunnerDispatchTransitionInput<T> {
  eventId: string;
  gatewayProjectionSnapshot?: HostedExecutionCommitPayload["gatewayProjectionSnapshot"];
  run: (userId: string, stores: RunnerUserStores) => Promise<T>;
}

interface RunnerDispatchProcessorDependencies {
  applyHostedTransition<T>(input: RunnerDispatchTransitionInput<T>): Promise<T>;
  bucket: R2BucketLike;
  ensureRunnerStores(userId?: string): Promise<RunnerUserStores>;
  env: HostedExecutionEnvironment;
  queueStore: RunnerQueueStore;
  readRunnerRuntimeConfigSource(): Readonly<Record<string, string | undefined>>;
  readWorkerStringEnvSource(): Readonly<Record<string, string | undefined>>;
  runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
  runnerRuntimeEnvSource: Readonly<Record<string, unknown>>;
  scheduler: RunnerScheduler;
}

export class RunnerDispatchProcessor {
  constructor(
    private readonly dependencies: RunnerDispatchProcessorDependencies,
  ) {}

  async dispatchBootstrapped(
    input: HostedExecutionDispatchRequest,
  ): Promise<HostedExecutionUserStatus> {
    const { commitRecovery, gatewayStore } = await this.dependencies.ensureRunnerStores(
      input.event.userId,
    );
    const committed = await commitRecovery.readCommittedDispatch(
      input.event.userId,
      input.eventId,
    );
    if (committed) {
      const presence = await this.dependencies.queueStore.readEventPresence(input.eventId);
      if (
        presence.pending
        || presence.consumed
        || isCommittedResultFresh(committed, COMMITTED_RESULT_FRESH_WINDOW_MS)
      ) {
        if (!isCommittedResultFinalized(committed)) {
          const synced = await commitRecovery.syncCommittedBundlesWithoutConsuming(
            input.event.userId,
            committed,
          );
          await gatewayStore.applySnapshot(committed.gatewayProjectionSnapshot ?? null);

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

        await gatewayStore.applySnapshot(committed.gatewayProjectionSnapshot ?? null);
        return toUserStatus(
          presence.pending
            ? await this.applyCommittedDispatchAndCleanup(
              input.event.userId,
              committed,
              input,
              input,
            )
            : await this.rememberCommittedEventAndCleanup(
              input.event.userId,
              input.eventId,
              input,
            ),
        );
      }

      await commitRecovery.deleteCommittedDispatch(input.event.userId, input.eventId);
    }

    const enqueueResult = await this.dependencies.queueStore.enqueueDispatch(input);
    let record = enqueueResult.record;

    if (enqueueResult.accepted) {
      record = await this.dependencies.scheduler.syncNextWake();
    }

    if (enqueueResult.alreadySeen || record.backpressuredEventIds.includes(input.eventId)) {
      return toUserStatus(record);
    }

    return this.runQueuedEvents(record.userId);
  }

  async runQueuedEvents(userId: string): Promise<HostedExecutionUserStatus> {
    await this.dependencies.ensureRunnerStores(userId);
    let record = await this.dependencies.queueStore.readState();
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

      const claim = await this.dependencies.queueStore.claimNextDuePendingDispatch(Date.now());
      const nextPending = claim.pendingDispatch;
      record = claim.record;

      if (!nextPending) {
        return toUserStatus(
          processedDispatch
            ? record
            : await this.dependencies.scheduler.syncNextWake(),
        );
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
        const { commitRecovery } = await this.dependencies.ensureRunnerStores(record.userId);
        const committed = await commitRecovery.readCommittedDispatch(
          record.userId,
          nextPending.dispatch.eventId,
        );
        if (committed && !isCommittedResultFinalized(committed)) {
          await (await this.dependencies.ensureRunnerStores(record.userId)).gatewayStore.applySnapshot(
            committed.gatewayProjectionSnapshot ?? null,
          );
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
        const durableCommit = await (await this.dependencies.ensureRunnerStores(record.userId))
          .commitRecovery.readCommittedDispatch(record.userId, nextPending.dispatch.eventId);
        if (!durableCommit) {
          throw new Error("Hosted runner returned before recording a durable commit.");
        }
        record = await this.advanceRunPhase({
          clearError: true,
          dispatch: nextPending.dispatch,
          message: "Hosted dispatch recorded a durable commit.",
          phase: "commit.recorded",
          run,
        });
        await this.finalizeReturnedRunnerResult({
          eventId: nextPending.dispatch.eventId,
          finalGatewayProjectionSnapshot: runnerResult.finalGatewayProjectionSnapshot,
          result: runnerResult.result,
        });
        const finalizedCommit = await (await this.dependencies.ensureRunnerStores(record.userId))
          .commitRecovery.readCommittedDispatch(record.userId, nextPending.dispatch.eventId);
        if (!finalizedCommit) {
          throw new Error("Hosted runner returned before recording a durable commit.");
        }
        record = await this.applyCommittedDispatchAndCleanup(
          record.userId,
          finalizedCommit,
          nextPending.dispatch,
          nextPending.dispatch,
          run,
        );
        processedDispatch = true;
      } catch (error) {
        const committed = await (await this.dependencies.ensureRunnerStores(record.userId))
          .commitRecovery.readCommittedDispatch(record.userId, nextPending.dispatch.eventId);

        if (committed) {
          if (isCommittedResultFinalized(committed)) {
            try {
              record = await this.applyCommittedDispatchAndCleanup(
                record.userId,
                committed,
                nextPending.dispatch,
                nextPending.dispatch,
                run,
              );
            } catch (finalizeError) {
              record = await (await this.dependencies.ensureRunnerStores(record.userId))
                .commitRecovery.rescheduleCommittedFinalizeRetry({
                  attempts: nextPending.attempts + 1,
                  committed,
                  error: finalizeError,
                  retryDelayMs: computeRetryDelayMs(
                    this.dependencies.env.retryDelayMs,
                    nextPending.attempts + 1,
                  ),
                });
              record = await this.advanceRunPhase({
                dispatch: nextPending.dispatch,
                error: finalizeError,
                level: "warn",
                message: "Hosted dispatch scheduled a business outcome retry.",
                phase: "retry.scheduled",
                run,
              });
            }
            continue;
          }

          record = await (await this.dependencies.ensureRunnerStores(record.userId))
            .commitRecovery.rescheduleCommittedFinalizeRetry({
              attempts: nextPending.attempts + 1,
              committed,
              error,
              retryDelayMs: computeRetryDelayMs(
                this.dependencies.env.retryDelayMs,
                nextPending.attempts + 1,
              ),
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
          record = await this.dependencies.queueStore.deferPendingConfigurationFailure({
            error,
            eventId: nextPending.dispatch.eventId,
            retryDelayMs: this.dependencies.env.retryDelayMs,
          });
          record = await this.dependencies.scheduler.syncNextWake();
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

        const failure = await this.dependencies.queueStore.reschedulePendingFailure({
          error,
          eventId: nextPending.dispatch.eventId,
          maxEventAttempts: this.dependencies.env.maxEventAttempts,
          retryDelayMs: computeRetryDelayMs(
            this.dependencies.env.retryDelayMs,
            nextPending.attempts + 1,
          ),
        });
        record = failure.record;
        record = await this.dependencies.scheduler.syncNextWake();
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
        if (failure.poisoned) {
          await this.deleteTransientDispatchDataBestEffort(nextPending.dispatch);
        }
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
  ): Promise<HostedAssistantRuntimeJobResult> {
    if (!this.dependencies.runnerContainerNamespace) {
      throw new Error("Native hosted execution requires a RunnerContainer binding.");
    }

    const { bundleSync, userEnv: userEnvService } = await this.dependencies.ensureRunnerStores(
      userId,
    );
    const [bundleState, userEnv] = await Promise.all([
      this.dependencies.queueStore.readBundleMetaState(),
      userEnvService.readUserEnv(userId),
    ]);
    const forwardedEnv = buildHostedRunnerContainerEnv(
      this.dependencies.runnerRuntimeEnvSource,
    );
    const job: HostedAssistantRuntimeJobInput = {
      request: {
        bundle: await bundleSync.readBundlesForRunner(),
        commit: {
          bundleRef: bundleState.bundleRef,
        },
        dispatch,
        run,
        ...(resume ? { resume } : {}),
      },
      runtime: buildHostedRunnerJobRuntimeConfig({
        forwardedEnv,
        runtimeConfigSource: this.dependencies.readRunnerRuntimeConfigSource(),
        userEnvSource: this.dependencies.readRunnerRuntimeConfigSource(),
        userEnv,
      }),
    };

    return invokeHostedExecutionContainerRunner({
      job,
      runnerContainerNamespace: this.dependencies.runnerContainerNamespace,
      runnerControlToken: crypto.randomUUID(),
      timeoutMs: this.dependencies.env.runnerTimeoutMs,
      userId,
    });
  }

  private async finalizeReturnedRunnerResult(input: {
    eventId: string;
    finalGatewayProjectionSnapshot: HostedExecutionFinalizePayload["gatewayProjectionSnapshot"];
    result: HostedAssistantRuntimeJobResult["result"];
  }): Promise<HostedExecutionCommittedResult> {
    return this.dependencies.applyHostedTransition({
      eventId: input.eventId,
      gatewayProjectionSnapshot: input.finalGatewayProjectionSnapshot ?? null,
      run: async (userId, stores) => {
        return persistHostedExecutionFinalBundles({
          bucket: this.dependencies.bucket,
          eventId: input.eventId,
          key: stores.crypto.rootKey,
          keyId: stores.crypto.rootKeyId,
          keysById: stores.crypto.keysById,
          payload: {
            bundle: input.result.bundle,
            gatewayProjectionSnapshot: input.finalGatewayProjectionSnapshot ?? null,
          },
          userId,
        });
      },
    });
  }

  private async recoverCommittedPendingDispatchAndCleanup(
    record: RunnerStateRecord,
  ): Promise<RunnerStateRecord | null> {
    const { commitRecovery } = await this.dependencies.ensureRunnerStores(
      record.userId,
    );
    const recovered = await commitRecovery.recoverCommittedPendingDispatch(record);
    if (!recovered) {
      return null;
    }

    return this.applyCommittedDispatchAndCleanup(
      record.userId,
      recovered.committed,
      recovered.cleanupDispatch ?? {
        event: {
          userId: record.userId,
        },
        eventId: recovered.committedEventId,
      },
      recovered.cleanupDispatch,
      this.resolveRunContext(recovered.record, {
        eventId: recovered.committedEventId,
        startedAt: recovered.record.lastRunAt ?? recovered.committed.committedAt,
      }),
    );
  }

  private async applyCommittedDispatchAndCleanup(
    userId: string,
    committed: HostedExecutionCommittedResult,
    dispatch: HostedExecutionDispatchProgressRecord,
    cleanupDispatch: HostedExecutionDispatchRequest | null = null,
    run: HostedExecutionRunContext | null = null,
  ): Promise<RunnerStateRecord> {
    const { commitRecovery, gatewayStore } = await this.dependencies.ensureRunnerStores(userId);
    if (cleanupDispatch) {
      await this.applyHostedBusinessOutcomeIfNeeded(cleanupDispatch);
    }
    await gatewayStore.applySnapshot(committed.gatewayProjectionSnapshot ?? null);
    let record = await commitRecovery.applyCommittedDispatch(userId, committed);
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
    if (cleanupDispatch) {
      await this.deleteTransientDispatchDataBestEffort(cleanupDispatch);
    }
    return record;
  }

  private async applyHostedBusinessOutcomeIfNeeded(
    dispatch: HostedExecutionDispatchRequest,
  ): Promise<void> {
    await applyHostedWebBusinessOutcomeIfNeeded({
      dispatch,
      env: this.dependencies.readWorkerStringEnvSource(),
      signingSecret: this.dependencies.env.webInternalSigningSecret,
    });
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
    dispatch: HostedExecutionDispatchProgressRecord;
    error?: unknown;
    level?: HostedExecutionRunLevel;
    message: string;
    phase: HostedExecutionRunPhase;
    run: HostedExecutionRunContext;
  }): Promise<RunnerStateRecord> {
    const record = await this.dependencies.queueStore.recordRunPhase({
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
    dispatch: HostedExecutionDispatchRequest | null = null,
  ): Promise<RunnerStateRecord> {
    const record = await this.dependencies.queueStore.rememberCommittedEvent(eventId);
    await this.deleteCommittedDispatchBestEffort(userId, eventId);
    if (dispatch) {
      await this.deleteTransientDispatchDataBestEffort(dispatch);
    }
    return record;
  }

  private async deleteCommittedDispatchBestEffort(
    userId: string,
    eventId: string,
  ): Promise<void> {
    try {
      await (await this.dependencies.ensureRunnerStores(userId)).commitRecovery
        .deleteCommittedDispatch(userId, eventId);
    } catch {
      // Leaving the transient journal behind is preferable to failing a successful hosted run.
    }
  }

  private async deleteTransientDispatchDataBestEffort(
    dispatch: Pick<HostedExecutionDispatchRequest, "event">,
  ): Promise<void> {
    if (dispatch.event.kind !== "email.message.received") {
      return;
    }

    try {
      const { crypto } = await this.dependencies.ensureRunnerStores(dispatch.event.userId);
      await deleteHostedEmailRawMessage({
        bucket: this.dependencies.bucket,
        key: crypto.rootKey,
        keysById: crypto.keysById,
        rawMessageKey: dispatch.event.rawMessageKey,
        userId: dispatch.event.userId,
      });
    } catch {
      // Best-effort cleanup only; lifecycle TTL still backstops raw message deletion.
    }
  }
}
