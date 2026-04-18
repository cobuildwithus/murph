import type {
  HostedExecutionBundleRef,
  HostedExecutionRunContext,
  HostedExecutionRunLevel,
  HostedExecutionRunPhase,
  HostedExecutionRunnerSharePack,
  HostedExecutionWake,
  HostedWakeLifecycleState,
} from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
  formatHostedExecutionLogMessage,
} from "@murphai/hosted-execution";
import { parseHostedExecutionRunnerSharePack } from "@murphai/hosted-execution/parsers";
import type {
  HostedAssistantDeliveryOutcome,
  HostedAssistantRuntimeJobInput,
  HostedAssistantRuntimeJobResult,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import type { R2BucketLike } from "../bundle-store.js";
import { createHostedBrowserVaultSnapshotStore } from "../browser-vault-store.js";
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
  type RunnerStateRecord,
} from "./types.js";
import {
  RunnerCommitRecovery,
  isCommittedResultFinalized,
} from "./runner-commit-recovery.js";
import { RunnerBundleSync } from "./runner-bundle-sync.js";
import { RunnerQueueStore } from "./runner-queue-store.js";
import type { RunnerLeaseOwnerInput } from "./runner-queue-store.js";
import { RunnerScheduler } from "./runner-scheduler.js";
import { RunnerSecretsService } from "./runner-secrets.js";
import { fetchHostedExecutionWebControlPlaneResponse } from "../web-control-plane.ts";

export type HostedExecutionWakeProgressRecord =
  Pick<HostedExecutionWake, "eventId" | "userId">;

export interface RunnerUserStores {
  bundleSync: RunnerBundleSync;
  commitRecovery: RunnerCommitRecovery;
  crypto: HostedUserCryptoContext;
  gatewayStore: HostedGatewayProjectionStore;
  runnerSecrets: RunnerSecretsService;
  userId: string;
}

interface RunnerWakeTransitionInput<T> {
  eventId: string;
  gatewayProjectionSnapshot?: HostedExecutionCommitPayload["gatewayProjectionSnapshot"];
  leaseOwner?: RunnerLeaseOwnerInput;
  run: (userId: string, stores: RunnerUserStores) => Promise<T>;
}

interface RunnerWakeProcessorDependencies {
  applyHostedTransition<T>(input: RunnerWakeTransitionInput<T>): Promise<T>;
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

export class RunnerWakeProcessor {
  constructor(
    private readonly dependencies: RunnerWakeProcessorDependencies,
  ) {}

  async executeNativeWakeDispatch(
    wake: HostedExecutionWake,
    options: {
      holdLeaseUntilCleanup?: boolean;
    } = {},
  ): Promise<HostedWakeLifecycleState> {
    const userId = wake.userId;
    const holdLeaseUntilCleanup = options.holdLeaseUntilCleanup === true;
    const { commitRecovery } = await this.dependencies.ensureRunnerStores(userId);
    const committed = await commitRecovery.readCommittedDispatch(userId, wake.eventId);

    if (committed && isCommittedResultFinalized(committed)) {
      await commitRecovery.syncCommittedBundlesWithoutConsuming(userId, committed, {
        policy: "same-event",
        run: null,
      });
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          existingCommittedAt: committed.committedAt,
          existingFinalizedAt: committed.finalizedAt,
        },
        dispatch: wake,
        message: "Hosted wake execution reused an already-finalized durable commit.",
        phase: "completed",
        run: null,
      });
      return "completed";
    }

    const activeLease = await this.readRecentActiveRunLease();
    if (activeLease) {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          activeRunEventId: activeLease.eventId,
          activeRunId: activeLease.run.runId,
        },
        dispatch: wake,
        level: "info",
        message: "Hosted wake execution deferred because another active run still owns the user lease.",
        phase: "dispatch.running",
        run: null,
      });
      return "backpressured";
    }

    const run = this.resolveRunContext(
      await this.dependencies.queueStore.readState(),
      {
        eventId: wake.eventId,
        startedAt: new Date().toISOString(),
      },
    );
    const leaseOwner: RunnerLeaseOwnerInput = {
      eventId: wake.eventId,
      run,
    };

    await this.dependencies.queueStore.beginWakeRun({
      eventId: wake.eventId,
      run,
      userId,
    });
    await this.advanceRunPhase({
      clearError: true,
      dispatch: wake,
      message: committed && !isCommittedResultFinalized(committed)
        ? "Resuming direct hosted wake execution from a durable commit."
        : "Invoking direct hosted wake execution.",
      phase: "claimed",
      run,
    });

    try {
      await this.advanceRunPhase({
        clearError: true,
        dispatch: wake,
        message: committed && !isCommittedResultFinalized(committed)
          ? "Resuming hosted wake finalize from a durable commit."
          : "Running hosted wake directly from the canonical wake queue.",
        phase: "dispatch.running",
        run,
      });
      const runnerResult = await this.invokeRunner(
        userId,
        wake,
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
          wake,
          gatewayProjectionSnapshot: runnerResult.committedGatewayProjectionSnapshot,
          result: runnerResult.result,
          run,
        })
        : await commitRecovery.readCommittedDispatch(userId, wake.eventId);

      if (!durableCommit) {
        throw new Error("Hosted wake execution returned before recording a durable commit.");
      }

      await this.advanceRunPhase({
        clearError: true,
        dispatch: wake,
        message: "Hosted wake execution recorded a durable commit.",
        phase: "commit.recorded",
        run,
      });
      await commitRecovery.syncCommittedBundlesWithoutConsuming(userId, durableCommit, { run });
      if (!holdLeaseUntilCleanup) {
        await this.dependencies.queueStore.completeWakeRun({
          eventId: wake.eventId,
          finishedAt: durableCommit.committedAt,
          leaseOwner,
        });
      }
      await this.advanceRunPhase({
        clearError: true,
        dispatch: wake,
        message: "Hosted wake execution recorded a durable commit and is awaiting cursor commit.",
        phase: "completed",
        run,
      });
      return "completed";
    } catch (error) {
      if (error instanceof HostedExecutionObsoleteRunResultError) {
        emitHostedExecutionStructuredLog({
          component: "runner",
          details: {
            obsoleteRunId: error.runId,
            runElapsedMs: computeHostedRunElapsedMs(run),
          },
          dispatch: wake,
          error,
          level: "warn",
          message: "Hosted wake execution returned a stale result for an obsolete run lease.",
          phase: "dispatch.running",
          run,
        });
        await this.dependencies.queueStore.failWakeRun({
          error,
          eventId: wake.eventId,
          leaseOwner,
        });
        return "backpressured";
      }

      const recoveredCommitted = await commitRecovery.readCommittedDispatch(userId, wake.eventId);
      if (recoveredCommitted && isCommittedResultFinalized(recoveredCommitted)) {
        await commitRecovery.syncCommittedBundlesWithoutConsuming(userId, recoveredCommitted, {
          policy: "same-event",
          run: null,
        });
        if (!holdLeaseUntilCleanup) {
          await this.dependencies.queueStore.completeWakeRun({
            eventId: wake.eventId,
            finishedAt: recoveredCommitted.finalizedAt ?? recoveredCommitted.committedAt,
            leaseOwner,
          });
        }
        await this.advanceRunPhase({
          clearError: true,
          dispatch: wake,
          message: "Hosted wake execution recovered a finalized durable commit after a transient failure.",
          phase: "completed",
          run,
        });
        return "completed";
      }

      await this.dependencies.queueStore.failWakeRun({
        error,
            eventId: wake.eventId,
        leaseOwner,
      });
      await this.dependencies.scheduler.syncNextWake(recoveredCommitted?.result.nextWakeAt ?? null);
      await this.advanceRunPhase({
        dispatch: wake,
        error,
        level: error instanceof HostedExecutionConfigurationError ? "warn" : "error",
        message: recoveredCommitted
          ? "Hosted wake execution preserved a durable commit for a later finalize retry."
          : error instanceof HostedExecutionConfigurationError
          ? "Hosted wake execution deferred because the runtime is not configured yet."
          : "Hosted wake execution deferred after a direct runner failure.",
        phase: "retry.scheduled",
        run,
      });
      return "backpressured";
    }
  }

  async finalizeNativeWakeDispatchAfterCursorCommit(input: {
    wake: HostedExecutionWake;
  }): Promise<HostedExecutionCommittedResult | null> {
    await this.dependencies.queueStore.markRuntimeBootstrapped();
    const userId = input.wake.userId;
    const { commitRecovery } = await this.dependencies.ensureRunnerStores(userId);
    let committed = await commitRecovery.readCommittedDispatch(userId, input.wake.eventId);

    if (!committed) {
      return null;
    }

    if (!isCommittedResultFinalized(committed)) {
      const record = await this.dependencies.queueStore.readState();
      const run = this.resolveRunContext(record, {
        eventId: input.wake.eventId,
        startedAt: committed.committedAt,
      });
      const finalRunnerResult = await this.invokeRunner(
        userId,
        input.wake,
        run,
        {
          committedResult: {
            assistantDeliveryEffects: committed.assistantDeliveryEffects,
            result: committed.result,
          },
        },
      );

      if (finalRunnerResult.phase !== "completed") {
        throw new Error("Hosted wake execution returned a duplicate committed result during finalize.");
      }

      await this.finalizeReturnedRunnerResult({
        eventId: input.wake.eventId,
        finalGatewayProjectionSnapshot: finalRunnerResult.finalGatewayProjectionSnapshot,
        result: finalRunnerResult.result,
        run,
      });
      await this.persistBrowserVaultSnapshotBestEffort(
        userId,
        finalRunnerResult.browserVaultSnapshot ?? null,
      );
      committed = await commitRecovery.readCommittedDispatch(userId, input.wake.eventId);
      if (!committed) {
        throw new Error("Hosted wake execution lost its durable commit before finalize cleanup.");
      }
    }

    await commitRecovery.syncCommittedBundlesWithoutConsuming(userId, committed, {
      policy: "same-event",
      run: null,
    });
    return committed;
  }

  async cleanupNativeWakeDispatchAfterCursorCommit(input: {
    wake: HostedExecutionWake;
  }): Promise<void> {
    await this.dependencies.queueStore.markRuntimeBootstrapped();
    await this.rememberCommittedEventAndCleanup(
      input.wake.userId,
      input.wake.eventId,
      input.wake,
    );
  }

  private async invokeRunner(
    userId: string,
    wake: HostedExecutionWake,
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
      wake.kind === "vault.share.accepted"
        ? this.readRunnerSharePack({
            ownerUserId: wake.share.ownerUserId,
            shareId: wake.share.shareId,
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
        wake,
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
      dispatch: wake,
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
    wake: HostedExecutionWake;
    gatewayProjectionSnapshot: HostedExecutionCommitPayload["gatewayProjectionSnapshot"];
    result: HostedAssistantRuntimeJobResult["result"];
    run: HostedExecutionRunContext;
  }): Promise<HostedExecutionCommittedResult> {
    return this.dependencies.applyHostedTransition({
      eventId: input.wake.eventId,
      gatewayProjectionSnapshot: input.gatewayProjectionSnapshot ?? null,
      leaseOwner: {
        eventId: input.wake.eventId,
        run: input.run,
      },
      run: async (userId, stores) => {
        return persistHostedExecutionCommit({
          bucket: this.dependencies.bucket,
          currentBundleRef: input.currentBundleRef,
          eventId: input.wake.eventId,
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

  private async persistBrowserVaultSnapshotBestEffort(
    userId: string,
    browserVaultSnapshot: unknown | null,
  ): Promise<void> {
    if (!browserVaultSnapshot) {
      return;
    }

    try {
      const { crypto } = await this.dependencies.ensureRunnerStores(userId);
      const store = createHostedBrowserVaultSnapshotStore({
        bucket: this.dependencies.bucket,
        key: crypto.rootKey,
        keyId: crypto.rootKeyId,
      });

      await store.writeBrowserVaultSnapshot(userId, browserVaultSnapshot);
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          error: formatHostedExecutionLogMessage(
            "Browser vault snapshot persistence failed.",
            error,
          ),
        },
        eventId: "browser-vault-snapshot",
        message: "Failed to persist browser vault snapshot sidecar.",
        phase: "completed",
        run: null,
        userId,
      });
    }
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

  private async readRecentActiveRunLease(): Promise<{
    eventId: string;
    run: HostedExecutionRunContext;
  } | null> {
    const activeLease = await this.dependencies.queueStore.readActiveRunLease();
    if (!activeLease) {
      return null;
    }

    const startedAtMs = Date.parse(activeLease.run.startedAt);
    if (!Number.isFinite(startedAtMs)) {
      return null;
    }

    return (Date.now() - startedAtMs) < this.dependencies.env.runnerTimeoutMs
      ? activeLease
      : null;
  }

  private async advanceRunPhase(input: {
    clearError?: boolean;
    dispatch: HostedExecutionWakeProgressRecord;
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
    wake: HostedExecutionWake | null = null,
  ): Promise<RunnerStateRecord> {
    const record = await this.dependencies.queueStore.completeWakeRun({
      eventId,
      finishedAt: new Date().toISOString(),
      leaseOwner: {
        eventId,
        policy: "same-event",
        run: null,
      },
    });
    await this.deleteCommittedDispatchBestEffort(userId, eventId);
    if (wake) {
      await this.deleteTransientDispatchDataBestEffort(wake);
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
    wake: HostedExecutionWake,
  ): Promise<void> {
    if (wake.kind !== "conversation.message" || wake.message.channel !== "email") {
      return;
    }

    try {
      const { crypto } = await this.dependencies.ensureRunnerStores(wake.userId);
      await deleteHostedEmailRawMessage({
        bucket: this.dependencies.bucket,
        key: crypto.rootKey,
        keysById: crypto.keysById,
        rawMessageKey: wake.message.rawMessageKey,
        userId: wake.userId,
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

export function summarizeHostedAssistantDeliveryOutcomes(
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
      assistantDeliveryFirstNonSentMessage: nonSent.deliveryErrorMessage ?? "unknown",
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
