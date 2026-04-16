import type {
  HostedExecutionBundleRef,
  HostedExecutionDispatchRequest,
  HostedExecutionRunContext,
  HostedExecutionRunLevel,
  HostedExecutionRunPhase,
  HostedExecutionRunnerSharePack,
  HostedExecutionUserStatus,
} from "@murphai/hosted-execution";
import { parseHostedExecutionRunnerSharePack } from "@murphai/hosted-execution/parsers";
import type {
  HostedAssistantDeliveryOutcome,
  HostedAssistantRuntimeJobInput,
  HostedAssistantRuntimeJobResult,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  emitHostedExecutionStructuredLog,
  formatHostedExecutionLogMessage,
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
import {
  createHostedUserKeyStore,
  type HostedUserCryptoContext,
} from "../user-key-store.js";
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
  type RunnerStateRecord,
} from "./types.js";
import {
  RunnerCommitRecovery,
  isCommittedResultFinalized,
  isCommittedResultFresh,
} from "./runner-commit-recovery.js";
import { RunnerBundleSync } from "./runner-bundle-sync.js";
import { RunnerQueueStore } from "./runner-queue-store.js";
import type { RunnerLeaseOwnerInput } from "./runner-queue-store.js";
import { RunnerScheduler } from "./runner-scheduler.js";
import { RunnerSecretsService } from "./runner-secrets.js";
import { fetchHostedExecutionWebControlPlaneResponse } from "../web-control-plane.ts";

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
  runnerSecrets: RunnerSecretsService;
  userId: string;
}

interface RunnerDispatchTransitionInput<T> {
  eventId: string;
  gatewayProjectionSnapshot?: HostedExecutionCommitPayload["gatewayProjectionSnapshot"];
  leaseOwner?: RunnerLeaseOwnerInput;
  run: (userId: string, stores: RunnerUserStores) => Promise<T>;
}

interface RunnerDispatchProcessorDependencies {
  applyHostedTransition<T>(input: RunnerDispatchTransitionInput<T>): Promise<T>;
  bucket: R2BucketLike;
  ensureRunnerStores(userId?: string): Promise<RunnerUserStores>;
  env: HostedExecutionEnvironment;
  hostedWebBaseUrl: string | null;
  queueStore: RunnerQueueStore;
  readRunnerRuntimeConfigSource(): Readonly<Record<string, string | undefined>>;
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
    stagedPayloadId: string | null = null,
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

    const enqueueResult = await this.dependencies.queueStore.enqueueDispatch(input, stagedPayloadId);
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
    if (record.inFlight && record.run) {
      return toUserStatus(record);
    }

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
      const run = claim.run;
      record = claim.record;

      if (!nextPending || !run) {
        return toUserStatus(
          processedDispatch
            ? record
            : await this.dependencies.scheduler.syncNextWake(),
        );
      }

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
          record = await commitRecovery.syncCommittedBundlesWithoutConsuming(
            record.userId,
            committed,
            { run },
          );
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
                assistantDeliveryEffects: committed.assistantDeliveryEffects,
                result: committed.result,
              },
            }
            : null,
        );
        const durableCommit = runnerResult.phase === "committed"
          ? await this.persistReturnedRunnerCommit({
            assistantDeliveryEffects: runnerResult.committedAssistantDeliveryEffects,
            currentBundleRef: (await this.dependencies.queueStore.readBundleMetaState()).bundleRef,
            dispatch: nextPending.dispatch,
            gatewayProjectionSnapshot: runnerResult.committedGatewayProjectionSnapshot,
            result: runnerResult.result,
            run,
          })
          : await (await this.dependencies.ensureRunnerStores(record.userId))
            .commitRecovery.readCommittedDispatch(record.userId, nextPending.dispatch.eventId);
        emitHostedExecutionStructuredLog({
          component: "runner",
          details: {
            assistantDeliveryEffectCount: runnerResult.phase === "committed"
              ? runnerResult.committedAssistantDeliveryEffects.length
              : durableCommit?.assistantDeliveryEffects.length ?? 0,
            committedPhaseReturned: String(runnerResult.phase),
            gatewayProjectionSnapshotPresent: runnerResult.phase === "committed"
              ? String(runnerResult.committedGatewayProjectionSnapshot !== null)
              : String(durableCommit?.gatewayProjectionSnapshot !== null),
            runElapsedMs: computeHostedRunElapsedMs(run),
          },
          dispatch: nextPending.dispatch,
          message: "Hosted runner returned a durable commit payload.",
          phase: "commit.recorded",
          run,
        });
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
        record = await (await this.dependencies.ensureRunnerStores(record.userId))
          .commitRecovery.syncCommittedBundlesWithoutConsuming(record.userId, durableCommit, { run });
        const finalRunnerResult = runnerResult.phase === "completed"
          ? runnerResult
          : await this.invokeRunner(
            record.userId,
            nextPending.dispatch,
            run,
            {
              committedResult: {
                assistantDeliveryEffects: durableCommit.assistantDeliveryEffects,
                result: durableCommit.result,
              },
            },
          );
        if (finalRunnerResult.phase !== "completed") {
          throw new Error("Hosted runner returned a duplicate committed result during finalize.");
        }
        emitHostedExecutionStructuredLog({
          component: "runner",
          details: {
            ...summarizeHostedAssistantDeliveryOutcomes(finalRunnerResult.assistantDeliveryOutcomes),
            finalGatewayProjectionSnapshotPresent:
              String(finalRunnerResult.finalGatewayProjectionSnapshot !== null),
            runElapsedMs: computeHostedRunElapsedMs(run),
          },
          dispatch: nextPending.dispatch,
          message: "Hosted runner returned a completed finalize payload.",
          phase: "side-effects.draining",
          run,
        });
        await this.finalizeReturnedRunnerResult({
          eventId: nextPending.dispatch.eventId,
          finalGatewayProjectionSnapshot: finalRunnerResult.finalGatewayProjectionSnapshot,
          result: finalRunnerResult.result,
          run,
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

        if (error instanceof HostedExecutionObsoleteRunResultError) {
          emitHostedExecutionStructuredLog({
            component: "runner",
            details: {
              obsoleteRunId: error.runId,
              runElapsedMs: computeHostedRunElapsedMs(run),
            },
            dispatch: nextPending.dispatch,
            error,
            level: "warn",
            message: "Hosted runner returned a stale result for an obsolete run lease.",
            phase: "dispatch.running",
            run,
          });
          return toUserStatus(await this.dependencies.queueStore.readState());
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

        if (isMissingHostedSharePackError(error) && nextPending.dispatch.event.kind === "vault.share.accepted") {
          const failure = await this.dependencies.queueStore.reschedulePendingFailure({
            error,
            eventId: nextPending.dispatch.eventId,
            maxEventAttempts: 1,
            retryDelayMs: this.dependencies.env.retryDelayMs,
          });
          record = failure.record;
          record = await this.dependencies.scheduler.syncNextWake();
          record = await this.advanceRunPhase({
            dispatch: nextPending.dispatch,
            error,
            level: "error",
            message: "Hosted share import is awaiting web reconciliation after the Cloudflare pack was missing.",
            phase: "poisoned",
            run,
          });
          await this.deleteTransientDispatchDataBestEffort(nextPending.dispatch);
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
        assistantDeliveryEffects:
          HostedExecutionCommittedResult["assistantDeliveryEffects"];
        result: HostedExecutionCommittedResult["result"];
      };
    } | null = null,
  ): Promise<HostedAssistantRuntimeJobResult> {
    if (!this.dependencies.runnerContainerNamespace) {
      throw new Error("Native hosted execution requires a RunnerContainer binding.");
    }

    const { bundleSync, runnerSecrets: runnerSecretsService } = await this.dependencies.ensureRunnerStores(
      userId,
    );
    const [bundleState, runnerSecrets, sharePack] = await Promise.all([
      this.dependencies.queueStore.readBundleMetaState(),
      runnerSecretsService.readRunnerSecrets(userId),
      dispatch.event.kind === "vault.share.accepted"
        ? this.readRunnerSharePack({
            ownerUserId: dispatch.event.share.ownerUserId,
            shareId: dispatch.event.share.shareId,
          })
        : Promise.resolve(null),
    ]);
    const forwardedEnv = buildHostedRunnerContainerEnv(
      this.dependencies.runnerRuntimeEnvSource,
    );
    const job: HostedAssistantRuntimeJobInput = {
      request: {
        bundle: await bundleSync.readBundlesForRunner(),
        currentBundleRef: bundleState.bundleRef,
        dispatch,
        ...(sharePack ? { sharePack } : {}),
        run,
        ...(resume ? { resume } : {}),
      },
      runtime: buildHostedRunnerJobRuntimeConfig({
        configSource: this.dependencies.readRunnerRuntimeConfigSource(),
        forwardedEnv,
        runnerSecrets,
      }),
    };

    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        bundlePresent: job.request.bundle !== null,
        forwardedEnvCategories: {
          assistantConfigured: hasAnyRunnerConfigKey(forwardedEnv, [
            "ANTHROPIC_API_KEY",
            "CEREBRAS_API_KEY",
            "DEEPSEEK_API_KEY",
            "FIREWORKS_API_KEY",
            "GOOGLE_API_KEY",
            "GOOGLE_GENERATIVE_AI_API_KEY",
            "GROQ_API_KEY",
            "MISTRAL_API_KEY",
            "OPENAI_API_KEY",
            "OPENROUTER_API_KEY",
            "PERPLEXITY_API_KEY",
            "TOGETHER_API_KEY",
            "VERCEL_AI_API_KEY",
            "VENICE_API_KEY",
            "XAI_API_KEY",
          ]),
          hostedEmailConfigured: hasAnyRunnerConfigKey(forwardedEnv, [
            "HOSTED_EMAIL_DOMAIN",
            "HOSTED_EMAIL_FROM_ADDRESS",
            "HOSTED_EMAIL_LOCAL_PART",
          ]),
          linqConfigured: hasAnyRunnerConfigKey(forwardedEnv, [
            "LINQ_API_BASE_URL",
            "LINQ_API_TOKEN",
            "LINQ_WEBHOOK_SECRET",
          ]),
          parserToolingConfigured: hasAnyRunnerConfigKey(forwardedEnv, [
            "FFMPEG_COMMAND",
            "WHISPER_COMMAND",
            "WHISPER_MODEL_PATH",
          ]),
          telegramConfigured: hasAnyRunnerConfigKey(forwardedEnv, [
            "TELEGRAM_API_BASE_URL",
            "TELEGRAM_BOT_TOKEN",
            "TELEGRAM_BOT_USERNAME",
            "TELEGRAM_FILE_BASE_URL",
          ]),
          webSearchConfigured: hasAnyRunnerConfigKey(forwardedEnv, [
            "BRAVE_API_KEY",
            "MURPH_WEB_FETCH_ENABLED",
            "MURPH_WEB_SEARCH_MAX_RESULTS",
            "MURPH_WEB_SEARCH_PROVIDER",
          ]),
        },
        forwardedEnvKeyCount: Object.keys(forwardedEnv).length,
        runElapsedMs: computeHostedRunElapsedMs(run),
        resumeFromCommit: Boolean(resume),
        sharePackAttached: Boolean(sharePack),
        runnerSecretsCategories: {
          modelCredentialConfigured: hasAnyRunnerConfigKey(runnerSecrets, [
            "ANTHROPIC_API_KEY",
            "BRAVE_API_KEY",
            "CEREBRAS_API_KEY",
            "DEEPSEEK_API_KEY",
            "FIREWORKS_API_KEY",
            "GOOGLE_API_KEY",
            "GOOGLE_GENERATIVE_AI_API_KEY",
            "GROQ_API_KEY",
            "HF_TOKEN",
            "HUGGINGFACEHUB_API_TOKEN",
            "HUGGINGFACE_API_KEY",
            "HUGGING_FACE_HUB_TOKEN",
            "LITELLM_PROXY_API_KEY",
            "MISTRAL_API_KEY",
            "NVIDIA_API_KEY",
            "NGC_API_KEY",
            "OPENAI_API_KEY",
            "OPENROUTER_API_KEY",
            "PERPLEXITY_API_KEY",
            "TOGETHER_API_KEY",
            "VERCEL_AI_API_KEY",
            "VENICE_API_KEY",
            "XAI_API_KEY",
          ]),
        },
        runnerSecretKeyCount: Object.keys(runnerSecrets).length,
      },
      dispatch,
      message: "Hosted runner prepared container invocation.",
      phase: "dispatch.running",
      run,
    });

    return invokeHostedExecutionContainerRunner({
      job,
      runnerContainerNamespace: this.dependencies.runnerContainerNamespace,
      timeoutMs: this.dependencies.env.runnerTimeoutMs,
      userId,
    });
  }

  private async persistReturnedRunnerCommit(input: {
    assistantDeliveryEffects: HostedExecutionCommittedResult["assistantDeliveryEffects"];
    currentBundleRef: HostedExecutionBundleRef | null;
    dispatch: HostedExecutionDispatchRequest;
    gatewayProjectionSnapshot: HostedExecutionCommitPayload["gatewayProjectionSnapshot"];
    result: HostedAssistantRuntimeJobResult["result"];
    run: HostedExecutionRunContext;
  }): Promise<HostedExecutionCommittedResult> {
    return this.dependencies.applyHostedTransition({
      eventId: input.dispatch.eventId,
      gatewayProjectionSnapshot: input.gatewayProjectionSnapshot ?? null,
      leaseOwner: {
        eventId: input.dispatch.eventId,
        run: input.run,
      },
      run: async (userId, stores) => {
        return persistHostedExecutionCommit({
          bucket: this.dependencies.bucket,
          currentBundleRef: input.currentBundleRef,
          eventId: input.dispatch.eventId,
          key: stores.crypto.rootKey,
          keyId: stores.crypto.rootKeyId,
          keysById: stores.crypto.keysById,
          payload: {
            assistantDeliveryEffects: input.assistantDeliveryEffects,
            bundle: input.result.bundle,
            gatewayProjectionSnapshot: input.gatewayProjectionSnapshot ?? null,
            result: input.result.result,
          },
          userId,
        });
      },
    });
  }

  private async readRunnerSharePack(input: {
    ownerUserId: string;
    shareId: string;
  }): Promise<HostedExecutionRunnerSharePack> {
    const hostedWebBaseUrl = this.dependencies.hostedWebBaseUrl;

    if (!hostedWebBaseUrl) {
      throw new Error("HOSTED_WEB_BASE_URL must be configured for hosted share payload hydration.");
    }

    const response = await fetchHostedExecutionWebControlPlaneResponse({
      baseUrl: hostedWebBaseUrl,
      boundUserId: input.ownerUserId,
      callbackSigning: this.dependencies.env.webCallbackSigning,
      method: "GET",
      path: `/api/internal/hosted-execution/share/${encodeURIComponent(input.shareId)}/payload`,
      timeoutMs: this.dependencies.env.runnerTimeoutMs,
    });

    if (response.status === 404) {
      throw createMissingHostedSharePackError(input);
    }

    if (!response.ok) {
      throw new Error(`Hosted share payload read failed with HTTP ${response.status}.`);
    }

    try {
      return parseHostedExecutionRunnerSharePack(JSON.parse(await response.text()) as unknown);
    } catch (error) {
      throw new Error("Hosted share payload read returned invalid JSON.", {
        cause: error,
      });
    }
  }

  private async finalizeReturnedRunnerResult(input: {
    eventId: string;
    finalGatewayProjectionSnapshot: HostedExecutionFinalizePayload["gatewayProjectionSnapshot"];
    result: HostedAssistantRuntimeJobResult["result"];
    run: HostedExecutionRunContext;
  }): Promise<HostedExecutionCommittedResult> {
    return this.dependencies.applyHostedTransition({
      eventId: input.eventId,
      gatewayProjectionSnapshot: input.finalGatewayProjectionSnapshot ?? null,
      leaseOwner: {
        eventId: input.eventId,
        run: input.run,
      },
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
      {
        policy: "same-event",
        run: null,
      },
    );
  }

  private async applyCommittedDispatchAndCleanup(
    userId: string,
    committed: HostedExecutionCommittedResult,
    dispatch: HostedExecutionDispatchProgressRecord,
    cleanupDispatch: HostedExecutionDispatchRequest | null = null,
    run: HostedExecutionRunContext | null = null,
    leaseOwner: {
      policy?: "matching-run" | "same-event";
      run: HostedExecutionRunContext | null;
    } | null = run === null ? null : { run },
  ): Promise<RunnerStateRecord> {
    const { commitRecovery, gatewayStore } = await this.dependencies.ensureRunnerStores(userId);
    await gatewayStore.applySnapshot(committed.gatewayProjectionSnapshot ?? null);
    let record = await commitRecovery.applyCommittedDispatch(userId, committed, leaseOwner);
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
    const message = formatHostedExecutionLogMessage(input.message, input.error);
    const record = await this.dependencies.queueStore.recordRunPhase({
      attempt: input.run.attempt,
      clearError: input.clearError,
      component: "runner",
      error: input.error,
      eventId: input.dispatch.eventId,
      level: input.level,
      message,
      phase: input.phase,
      runId: input.run.runId,
      startedAt: input.run.startedAt,
    });

    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        runElapsedMs: computeHostedRunElapsedMs(input.run),
      },
      dispatch: input.dispatch,
      error: input.error,
      level: input.level,
      message,
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
    const record = await this.dependencies.queueStore.rememberCommittedEvent(eventId, {
      eventId,
      policy: "same-event",
      run: null,
    });
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

export class HostedExecutionObsoleteRunResultError extends Error {
  constructor(
    readonly eventId: string,
    readonly runId: string | null,
  ) {
    super(
      runId
        ? `Hosted runner result for event ${eventId} no longer owns active run ${runId}.`
        : `Hosted runner result for event ${eventId} no longer owns the active run lease.`,
    );
    this.name = "HostedExecutionObsoleteRunResultError";
  }
}

function summarizeHostedAssistantDeliveryOutcomes(
  outcomes: readonly HostedAssistantDeliveryOutcome[] | undefined,
): Record<string, number | string> {
  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    return {
      assistantDeliveryOutcomeCount: 0,
    };
  }

  const sentCount = outcomes.filter((outcome) => outcome.deliveryStatus === "sent").length;
  const nonSent = outcomes.find((outcome) => outcome.deliveryStatus !== "sent") ?? null;

  return {
    assistantDeliveryOutcomeCount: outcomes.length,
    assistantDeliverySentCount: sentCount,
    assistantDeliveryNonSentCount: outcomes.length - sentCount,
    ...(nonSent ? {
      assistantDeliveryFirstNonSentChannel: nonSent.deliveryChannel ?? "unknown",
      assistantDeliveryFirstNonSentCode: nonSent.deliveryErrorCode ?? "unknown",
      assistantDeliveryFirstNonSentJournalMethod: nonSent.journalMethod ?? "unknown",
      assistantDeliveryFirstNonSentJournalStatus: nonSent.journalStatus ?? "unknown",
      assistantDeliveryFirstNonSentStatus: nonSent.deliveryStatus,
    } : {}),
  };
}

function computeHostedRunElapsedMs(
  run: HostedExecutionRunContext | null | undefined,
): number | null {
  if (!run?.startedAt) {
    return null;
  }

  const startedAtMs = Date.parse(run.startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return null;
  }

  return Math.max(0, Date.now() - startedAtMs);
}

function createMissingHostedSharePackError(input: {
  ownerUserId: string;
  shareId: string;
}): Error & { code: string } {
  const error = new Error(
    `Hosted share payload ${input.ownerUserId}/${input.shareId} is missing from the canonical web payload route.`,
  ) as Error & { code: string };
  error.code = "HOSTED_SHARE_PACK_NOT_FOUND";
  return error;
}

function isMissingHostedSharePackError(error: unknown): error is Error & { code: string } {
  return error instanceof Error
    && "code" in error
    && error.code === "HOSTED_SHARE_PACK_NOT_FOUND";
}

function hasAnyRunnerConfigKey(
  source: Readonly<Record<string, string>>,
  keys: readonly string[],
): boolean {
  return keys.some((key) => typeof source[key] === "string" && source[key].length > 0);
}
