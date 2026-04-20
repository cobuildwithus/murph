import type {
  HostedExecutionBundleRef,
  HostedExecutionRunContext,
  HostedExecutionRunLevel,
  HostedExecutionRunPhase,
  HostedExecutionRunnerResult,
  HostedExecutionRunnerSharePack,
  HostedExecutionWake,
  HostedRunRecord,
  HostedRuntimeDrainEvent,
  HostedRuntimeDrainRequest,
  HostedWakeLifecycleState,
} from "@murphai/hosted-execution";
import type { GatewayProjectionSnapshot } from "@murphai/gateway-core";
import {
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  formatHostedExecutionLogMessage,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionRunnerSharePack,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedAssistantDeliveryOutcome,
  HostedAssistantRuntimeCompletedJobResult,
  HostedAssistantRuntimeJobInput,
  HostedAssistantRuntimeJobResult,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import type { R2BucketLike } from "../bundle-store.js";
import { createHostedBrowserVaultSnapshotStore } from "../browser-vault-store.js";
import { deleteHostedEmailRawMessage } from "../hosted-email.ts";
import type { HostedExecutionEnvironment } from "../env.js";
import { type HostedUserCryptoContext } from "../user-key-store.js";
import { HostedGatewayProjectionCache } from "../gateway-projection-cache.js";
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
import { RunnerBundleSync } from "./runner-bundle-sync.js";
import { RunnerStateStore } from "./runner-state-store.js";
import type { RunnerLeaseOwnerInput } from "./runner-state-store.js";
import { RunnerWakeScheduler } from "./runner-wake-scheduler.js";
import { RunnerSecretsService } from "./runner-secrets.js";
import {
  fetchHostedExecutionWebControlPlaneResponse,
  recordHostedRunLogInWeb,
} from "../web-control-plane.ts";

export type HostedExecutionWakeProgressRecord =
  Pick<HostedExecutionWake, "eventId" | "userId">;

export interface RunnerUserStores {
  bundleSync: RunnerBundleSync;
  crypto: HostedUserCryptoContext;
  gatewayCache: HostedGatewayProjectionCache;
  runnerSecrets: RunnerSecretsService;
  userId: string;
}

export interface RunnerRunDrainExecutionResult {
  cursorSnapshotRef: HostedExecutionBundleRef | null;
  finalizeRequired: boolean;
  nextRuntimeWakeAt?: string | null;
  redactedSummary?: Record<string, unknown>;
  state: HostedWakeLifecycleState;
}

const HOSTED_RUN_PHASE_LOG_TIMEOUT_MS = 2_000;

interface RunnerWakeTransitionInput<T> {
  eventId: string;
  gatewayProjectionSnapshot?: GatewayProjectionSnapshot | null;
  leaseOwner?: RunnerLeaseOwnerInput;
  run: (userId: string, stores: RunnerUserStores) => Promise<T>;
}

interface RunnerWakeProcessorDependencies {
  applyHostedTransition<T>(input: RunnerWakeTransitionInput<T>): Promise<T>;
  bucket: R2BucketLike;
  ensureRunnerStores(userId?: string): Promise<RunnerUserStores>;
  env: HostedExecutionEnvironment;
  hostedWebBaseUrl: string | null;
  stateStore: RunnerStateStore;
  readRunnerRuntimeConfigSource(): Readonly<Record<string, string | undefined>>;
  runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
  runnerRuntimeEnvSource: Readonly<Record<string, unknown>>;
  wakeScheduler: RunnerWakeScheduler;
}

export class RunnerWakeProcessor {
  constructor(
    private readonly dependencies: RunnerWakeProcessorDependencies,
  ) {}

  async readRunDrainSharePack(
    wake: HostedExecutionWake,
  ): Promise<HostedExecutionRunnerSharePack | null> {
    if (wake.kind !== "vault.share.accepted") {
      return null;
    }

    return this.readRunnerSharePack({
      ownerUserId: wake.share.ownerUserId,
      shareId: wake.share.shareId,
    });
  }

  async executeRunDrain(input: {
    events: HostedRuntimeDrainEvent[];
    primaryWake: HostedExecutionWake;
    run: HostedRunRecord;
  }): Promise<RunnerRunDrainExecutionResult> {
    const userId = input.primaryWake.userId;
    const run = hostedRunRecordToExecutionRunContext(input.run);
    const runEventId = hostedRunEventId(input.run.id);
    const leaseOwner: RunnerLeaseOwnerInput = {
      eventId: runEventId,
      run,
    };
    const activeLease = await this.readRecentActiveRunLease();

    if (activeLease && activeLease.eventId !== runEventId) {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          activeRunEventId: activeLease.eventId,
          activeRunId: activeLease.run.runId,
          hostedRunId: input.run.id,
        },
        eventId: runEventId,
        level: "info",
        message: "Hosted run-drain execution deferred because another active run still owns the user lease.",
        phase: "wake.running",
        run: null,
        userId,
      });
      return {
        cursorSnapshotRef: null,
        finalizeRequired: false,
        state: "backpressured",
      };
    }

    await this.dependencies.stateStore.beginWakeRun({
      eventId: runEventId,
      run,
      userId,
    });
    await this.advanceRunPhase({
      clearError: true,
      wake: { eventId: runEventId, userId },
      message: "Running hosted run drain from the web-owned run ledger.",
      phase: "wake.running",
      run,
    });

    try {
      const runnerResult = await this.invokeRunner(
        userId,
        input.primaryWake,
        run,
        buildHostedRuntimeDrainRequest({
          events: input.events,
          resumeFinalize: false,
          run: input.run,
        }),
      );
      const result = runnerResult.result;

      if (runnerResult.phase === "committed") {
        const cursorSnapshotRef = await this.persistCompletedRunnerResult({
          eventId: runEventId,
          finalGatewayProjectionSnapshot: runnerResult.committedGatewayProjectionSnapshot,
          result: runnerResult.result,
          run,
        });
        await this.advanceRunPhase({
          clearError: true,
          wake: { eventId: runEventId, userId },
          message: "Hosted run drain prepared a committed snapshot and is awaiting web commit.",
          phase: "commit.recorded",
          run,
        });
        await this.dependencies.stateStore.completeWakeRun({
          eventId: runEventId,
          finishedAt: new Date().toISOString(),
          leaseOwner,
        });
        return {
          cursorSnapshotRef,
          finalizeRequired: runnerResult.committedAssistantDeliveryEffects.length > 0,
          nextRuntimeWakeAt: result.result.nextWakeAt ?? null,
          redactedSummary: {
            assistantDeliveryEffectCount: runnerResult.committedAssistantDeliveryEffects.length,
            eventsHandled: result.result.eventsHandled,
            phase: "prepared",
            summary: result.result.summary,
          },
          state: "completed",
        };
      }

      const cursorSnapshotRef = await this.persistCompletedRunnerResult({
        eventId: runEventId,
        finalGatewayProjectionSnapshot: runnerResult.finalGatewayProjectionSnapshot,
        result: runnerResult.result,
        run,
      });
      await this.persistBrowserVaultSnapshotBestEffort(
        userId,
        runnerResult.browserVaultSnapshot ?? null,
      );
      await this.dependencies.stateStore.completeWakeRun({
        eventId: runEventId,
        finishedAt: new Date().toISOString(),
        leaseOwner,
      });
      return {
        cursorSnapshotRef,
        finalizeRequired: false,
        nextRuntimeWakeAt: result.result.nextWakeAt ?? null,
        redactedSummary: {
          eventsHandled: result.result.eventsHandled,
          phase: "finalized",
          summary: result.result.summary,
        },
        state: "completed",
      };
    } catch (error) {
      await this.dependencies.stateStore.failWakeRun({
        error,
        eventId: runEventId,
        leaseOwner,
      });
      await this.advanceRunPhase({
        wake: { eventId: runEventId, userId },
        error,
        level: error instanceof HostedExecutionConfigurationError ? "warn" : "error",
        message: error instanceof HostedExecutionConfigurationError
          ? "Hosted run drain deferred because the runtime is not configured yet."
          : "Hosted run drain failed after invoking the runtime.",
        phase: "retry.scheduled",
        run,
      });
      return {
        cursorSnapshotRef: null,
        finalizeRequired: false,
        state: "backpressured",
      };
    }
  }

  async finalizeRunDrain(input: {
    primaryWake: HostedExecutionWake;
    run: HostedRunRecord;
  }): Promise<RunnerRunDrainExecutionResult> {
    const userId = input.primaryWake.userId;
    const run = hostedRunRecordToExecutionRunContext(input.run);
    const runEventId = hostedRunEventId(input.run.id);
    const leaseOwner: RunnerLeaseOwnerInput = {
      eventId: runEventId,
      run,
    };

    await this.dependencies.stateStore.beginWakeRun({
      eventId: runEventId,
      run,
      userId,
    });
    await this.advanceRunPhase({
      clearError: true,
      wake: { eventId: runEventId, userId },
      message: "Finalizing hosted run-drain side effects from the web-visible prepared snapshot.",
      phase: "side-effects.draining",
      run,
    });

    try {
      const runnerResult = await this.invokeRunner(
        userId,
        input.primaryWake,
        run,
        buildHostedRuntimeDrainRequest({
          events: [],
          resumeFinalize: true,
          run: input.run,
        }),
      );

      if (!isCompletedRunnerResult(runnerResult)) {
        throw new Error("Hosted run-drain finalization returned a duplicate committed result.");
      }

      const cursorSnapshotRef = await this.persistCompletedRunnerResult({
        eventId: runEventId,
        finalGatewayProjectionSnapshot: runnerResult.finalGatewayProjectionSnapshot,
        result: runnerResult.result,
        run,
      });
      await this.persistBrowserVaultSnapshotBestEffort(
        userId,
        runnerResult.browserVaultSnapshot ?? null,
      );
      await this.dependencies.stateStore.completeWakeRun({
        eventId: runEventId,
        finishedAt: new Date().toISOString(),
        leaseOwner,
      });
      await this.advanceRunPhase({
        clearError: true,
        wake: { eventId: runEventId, userId },
        message: "Hosted run drain finalized committed side effects.",
        phase: "completed",
        run,
      });

      return {
        cursorSnapshotRef,
        finalizeRequired: false,
        nextRuntimeWakeAt: runnerResult.result.result.nextWakeAt,
        redactedSummary: {
          ...summarizeHostedAssistantDeliveryOutcomes(runnerResult.assistantDeliveryOutcomes),
          eventsHandled: runnerResult.result.result.eventsHandled,
          phase: "finalized",
          summary: runnerResult.result.result.summary,
        },
        state: "completed",
      };
    } catch (error) {
      await this.dependencies.stateStore.failWakeRun({
        error,
        eventId: runEventId,
        leaseOwner,
      });
      await this.advanceRunPhase({
        wake: { eventId: runEventId, userId },
        error,
        level: error instanceof HostedExecutionConfigurationError ? "warn" : "error",
        message: error instanceof HostedExecutionConfigurationError
          ? "Hosted run-drain finalization deferred because the runtime is not configured yet."
          : "Hosted run-drain finalization failed after invoking the runtime.",
        phase: "retry.scheduled",
        run,
      });
      return {
        cursorSnapshotRef: null,
        finalizeRequired: false,
        state: "backpressured",
      };
    }
  }

  async cleanupTransientWakeDataBestEffortForRunDrain(
    wake: HostedExecutionWake,
  ): Promise<void> {
    await this.deleteTransientWakeDataBestEffort(wake);
  }

  private async deleteTransientWakeDataBestEffort(wake: HostedExecutionWake): Promise<void> {
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
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          rawMessageKey: wake.message.rawMessageKey,
          wakeChannel: wake.message.channel,
          wakeKind: wake.kind,
        },
        error,
        eventId: wake.eventId,
        level: "warn",
        message: "Hosted wake best-effort raw email cleanup failed; lifecycle TTL will still backstop deletion.",
        phase: "completed",
        run: null,
        userId: wake.userId,
      });
    }
  }

  private async invokeRunner(
    userId: string,
    wake: HostedExecutionWake,
    run: HostedExecutionRunContext,
    runDrain: HostedRuntimeDrainRequest,
  ): Promise<HostedAssistantRuntimeJobResult> {
    if (!this.dependencies.runnerContainerNamespace) {
      throw new Error("Native hosted execution requires a RunnerContainer binding.");
    }

    const { bundleSync, runnerSecrets: runnerSecretsService } = await this.dependencies.ensureRunnerStores(
      userId,
    );
    const runDrainPrimarySharePack = runDrain.events.find((event) => {
      return event.wake.eventId === wake.eventId && event.sharePack;
    })?.sharePack ?? null;
    const [bundleState, runnerSecrets, sharePack] = await Promise.all([
      this.dependencies.stateStore.readBundleMetaState(),
      runnerSecretsService.readRunnerSecrets(userId),
      wake.kind === "vault.share.accepted"
        ? runDrainPrimarySharePack
          ? Promise.resolve(runDrainPrimarySharePack)
          : this.readRunnerSharePack({
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
        runDrain,
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
        runDrainEventCount: runDrain.events.length,
        runDrainResumeFinalize: runDrain.resumeFinalize === true,
        runDrainRunId: runDrain.runId,
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
      eventId: wake.eventId,
      message: "Hosted runner prepared container invocation.",
      phase: "wake.running",
      run,
      userId,
    });

    return invokeHostedExecutionContainerRunner({
      job,
      runnerContainerNamespace: this.dependencies.runnerContainerNamespace,
      timeoutMs: this.dependencies.env.runnerTimeoutMs,
      userId,
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

  private async persistCompletedRunnerResult(input: {
    eventId: string;
    finalGatewayProjectionSnapshot: GatewayProjectionSnapshot | null;
    result: HostedExecutionRunnerResult;
    run: HostedExecutionRunContext;
  }): Promise<HostedExecutionBundleRef | null> {
    return this.dependencies.applyHostedTransition({
      eventId: input.eventId,
      gatewayProjectionSnapshot: input.finalGatewayProjectionSnapshot ?? null,
      leaseOwner: {
        eventId: input.eventId,
        run: input.run,
      },
      run: async (userId, stores) => {
        const bundleState = await this.dependencies.stateStore.readBundleMetaState();
        const record = await stores.bundleSync.applyRunnerResultBundles(
          userId,
          bundleState.bundleVersion,
          input.result.bundle,
        );
        await this.dependencies.wakeScheduler.syncNextWake({
          preferredWakeAt: input.result.result.nextWakeAt ?? null,
        });
        return record.bundleRef;
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
    const activeLease = await this.dependencies.stateStore.readActiveRunLease();
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
    wake: HostedExecutionWakeProgressRecord;
    error?: unknown;
    level?: HostedExecutionRunLevel;
    message: string;
    phase: HostedExecutionRunPhase;
    run: HostedExecutionRunContext;
  }): Promise<RunnerStateRecord> {
    const message = formatHostedExecutionLogMessage(input.message, input.error);
    const record = await this.dependencies.stateStore.recordRunPhase({
      attempt: input.run.attempt,
      clearError: input.clearError,
      component: "runner",
      error: input.error,
      eventId: input.wake.eventId,
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
      error: input.error,
      eventId: input.wake.eventId,
      level: input.level,
      message,
      phase: input.phase,
      run: input.run,
      userId: input.wake.userId,
    });

    void recordHostedRunPhaseLogInWebBestEffort({
      baseUrl: this.dependencies.hostedWebBaseUrl,
      callbackSigning: this.dependencies.env.webCallbackSigning,
      error: input.error,
      level: input.level,
      message,
      phase: input.phase,
      run: input.run,
      userId: input.wake.userId,
      wakeEventId: input.wake.eventId,
    });

    return record;
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

function hostedRunEventId(runId: string): string {
  return `hosted-run:${runId}`;
}

function hostedRunRecordToExecutionRunContext(run: HostedRunRecord): HostedExecutionRunContext {
  return {
    attempt: run.attempt,
    runId: run.id,
    startedAt: run.acquiredAt,
  };
}

function buildHostedRuntimeDrainRequest(input: {
  events: HostedRuntimeDrainEvent[];
  resumeFinalize: boolean;
  run: HostedRunRecord;
}): HostedRuntimeDrainRequest {
  return {
    acquiredAt: input.run.acquiredAt,
    events: input.resumeFinalize ? [] : input.events,
    inputCommittedSeq: input.run.inputCommittedSeq,
    inputCursorVersion: input.run.inputCursorVersion,
    ...(input.resumeFinalize ? { resumeFinalize: true } : {}),
    runId: input.run.id,
    triggerKind: input.run.triggerKind,
  };
}

function isCompletedRunnerResult(
  result: HostedAssistantRuntimeJobResult,
): result is Exclude<HostedAssistantRuntimeJobResult, { phase: "committed" }> {
  return result.phase === undefined || result.phase === "completed";
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
      assistantDeliveryFirstNonSentStatus: nonSent.deliveryStatus,
    } : {}),
  };
}

export async function recordHostedRunPhaseLogInWebBestEffort(input: {
  baseUrl: string | null;
  callbackSigning: HostedExecutionEnvironment["webCallbackSigning"];
  error?: unknown;
  level?: HostedExecutionRunLevel;
  message: string;
  phase: HostedExecutionRunPhase;
  recordLog?: typeof recordHostedRunLogInWeb;
  run: HostedExecutionRunContext;
  runToken?: string | null;
  userId: string;
  wakeEventId: string;
}): Promise<void> {
  if (!input.baseUrl) {
    return;
  }

  const recordLog = input.recordLog ?? recordHostedRunLogInWeb;

  try {
    await recordLog({
      baseUrl: input.baseUrl,
      body: {
        at: new Date().toISOString(),
        component: "cloudflare-runner",
        level: input.level ?? (input.error === undefined ? "info" : "error"),
        message: input.message,
        phase: input.phase,
        redacted: {
          errorCode: input.error === undefined ? null : deriveHostedExecutionErrorCode(input.error),
          eventId: input.wakeEventId,
          runElapsedMs: computeHostedRunElapsedMs(input.run),
        },
        runId: input.run.runId,
        ...(input.runToken === undefined ? {} : { runToken: input.runToken }),
      },
      boundUserId: input.userId,
      callbackSigning: input.callbackSigning,
      timeoutMs: HOSTED_RUN_PHASE_LOG_TIMEOUT_MS,
    });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "cloudflare-runner",
      details: {
        runElapsedMs: computeHostedRunElapsedMs(input.run),
        runLogWakeEventId: input.wakeEventId,
      },
      error,
      eventId: input.wakeEventId,
      level: "warn",
      message: "Hosted run phase log write to web failed; continuing with runner-local observability only.",
      phase: input.phase,
      run: input.run,
      userId: input.userId,
    });
  }
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
