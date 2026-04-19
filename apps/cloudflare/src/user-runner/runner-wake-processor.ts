import type {
  HostedExecutionBundleRef,
  HostedExecutionRunContext,
  HostedExecutionRunLevel,
  HostedExecutionRunPhase,
  HostedExecutionRunnerResult,
  HostedExecutionRunnerSharePack,
  HostedExecutionWake,
  HostedWakeLifecycleState,
} from "@murphai/hosted-execution";
import type { GatewayProjectionSnapshot } from "@murphai/gateway-core";
import {
  emitHostedExecutionStructuredLog,
  formatHostedExecutionLogMessage,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionRunnerSharePack,
  parseHostedExecutionBundleRef,
  parseHostedWakeExecutionPayload,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedAssistantRuntimeCompletedJobResult,
  HostedAssistantDeliveryOutcome,
  HostedAssistantRuntimeJobInput,
  HostedAssistantRuntimeJobResult,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import type { R2BucketLike } from "../bundle-store.js";
import { createHostedBrowserVaultSnapshotStore } from "../browser-vault-store.js";
import type { HostedExecutionEnvironment } from "../env.js";
import { deleteHostedEmailRawMessage } from "../hosted-email.js";
import { decryptHostedWakePayloadCiphertext } from "../hosted-wake-encryption.ts";
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
  type RunnerPendingCommitRecord,
  type RunnerStateRecord,
} from "./types.js";
import { RunnerBundleSync } from "./runner-bundle-sync.js";
import { RunnerStateStore } from "./runner-state-store.js";
import type { RunnerLeaseOwnerInput } from "./runner-state-store.js";
import { RunnerWakeScheduler } from "./runner-wake-scheduler.js";
import { RunnerSecretsService } from "./runner-secrets.js";
import {
  fetchHostedExecutionWebControlPlaneResponse,
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

export interface RunnerWakeExecutionResult {
  cursorSnapshotRef: HostedExecutionBundleRef | null;
  postCursorAction: "cleanup-only";
  state: HostedWakeLifecycleState;
}

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

async function preparePendingCommitForCursorCommit(input: {
  pendingCommit: RunnerPendingCommitRecord;
  persistBrowserVaultSnapshotBestEffort: (
    userId: string,
    browserVaultSnapshot: unknown | null,
  ) => Promise<void>;
  restorePendingCommitState: (pendingCommit: RunnerPendingCommitRecord) => Promise<void>;
  resumePendingCommitToFinalResult: (input: {
    pendingCommit: RunnerPendingCommitRecord;
    run: HostedExecutionRunContext;
    userId: string;
    wake: HostedExecutionWake;
  }) => Promise<{
    finalRunnerResult: HostedAssistantRuntimeCompletedJobResult;
    finalizedPendingCommit: RunnerPendingCommitRecord;
  }>;
  run: HostedExecutionRunContext;
  userId: string;
  wake: HostedExecutionWake;
}): Promise<RunnerPendingCommitRecord> {
  if (input.pendingCommit.finalizedAt) {
    await input.restorePendingCommitState(input.pendingCommit);
    return input.pendingCommit;
  }

  const { finalRunnerResult, finalizedPendingCommit } = await input.resumePendingCommitToFinalResult({
    pendingCommit: input.pendingCommit,
    run: input.run,
    userId: input.userId,
    wake: input.wake,
  });
  await input.persistBrowserVaultSnapshotBestEffort(
    input.userId,
    finalRunnerResult.browserVaultSnapshot ?? null,
  );
  return finalizedPendingCommit;
}

async function reconcilePendingCommitAfterCursorCommit(input: {
  cursor: {
    committedSeq: string;
    snapshotRef: unknown;
    version: string;
  };
  dependencies: RunnerWakeProcessorDependencies;
  pendingCommit: RunnerPendingCommitRecord;
  restorePendingCommitState: (pendingCommit: RunnerPendingCommitRecord) => Promise<void>;
}): Promise<void> {
  if (BigInt(input.cursor.committedSeq) > BigInt(input.pendingCommit.wake.seq)) {
    await input.dependencies.stateStore.syncBundleRefCache(
      parseHostedExecutionBundleRef(
        input.cursor.snapshotRef === undefined ? null : input.cursor.snapshotRef,
        "Hosted wake stale cleanup cursor snapshotRef",
      ),
    );
    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        committedSeq: input.cursor.committedSeq,
        pendingWakeSeq: input.pendingCommit.wake.seq,
        version: input.cursor.version,
      },
      eventId: input.pendingCommit.eventId,
      level: "info",
      message: "Hosted wake cleanup discarded a stale DO-local pending commit after the web cursor advanced beyond its seq.",
      phase: "completed",
      run: null,
      userId: input.pendingCommit.userId,
    });
    return;
  }

  if (!input.pendingCommit.finalizedAt) {
    throw new Error(
      `Hosted wake cleanup found a non-finalized pending commit after cursor seq ${input.cursor.committedSeq} was committed.`,
    );
  }

  await input.restorePendingCommitState(input.pendingCommit);
}

type RunnerWakeStartMode =
  | {
    kind: "alreadyFinalized";
    pendingCommit: RunnerPendingCommitRecord;
  }
  | {
    kind: "resumePendingCommit";
    pendingCommit: RunnerPendingCommitRecord;
  }
  | {
    kind: "directRun";
  };

export class RunnerWakeProcessor {
  constructor(
    private readonly dependencies: RunnerWakeProcessorDependencies,
  ) {}

  async executeWake(
    wake: HostedExecutionWake,
    options: {
      holdLeaseUntilCleanup?: boolean;
      wakeRecord: RunnerPendingCommitRecord["wake"];
    },
  ): Promise<RunnerWakeExecutionResult> {
    const userId = wake.userId;
    const holdLeaseUntilCleanup = options.holdLeaseUntilCleanup === true;
    const startMode = await this.resolveWakeStartMode(wake.eventId);
    if (startMode.kind === "alreadyFinalized") {
      await this.restorePendingCommitState(startMode.pendingCommit);
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          existingCommittedAt: startMode.pendingCommit.committedAt,
          existingFinalizedAt: startMode.pendingCommit.finalizedAt,
        },
        eventId: wake.eventId,
        message: "Hosted wake execution reused an already-finalized DO-local pending commit.",
        phase: "completed",
        run: null,
        userId,
      });
      return {
        cursorSnapshotRef: startMode.pendingCommit.bundleRef,
        postCursorAction: "cleanup-only",
        state: "completed",
      };
    }

    if (startMode.kind === "resumePendingCommit") {
      const run = await this.resolvePendingCommitCleanupRun({
        pendingCommit: startMode.pendingCommit,
        wake,
      });

      try {
        const finalizedPendingCommit = await preparePendingCommitForCursorCommit({
          pendingCommit: startMode.pendingCommit,
          persistBrowserVaultSnapshotBestEffort: this.persistBrowserVaultSnapshotBestEffort.bind(this),
          restorePendingCommitState: this.restorePendingCommitState.bind(this),
          resumePendingCommitToFinalResult: this.resumePendingCommitToFinalResult.bind(this),
          run,
          userId,
          wake,
        });
        await this.advanceRunPhase({
          clearError: true,
          wake,
          message:
            "Hosted wake execution finalized a DO-local pending commit before retrying cursor commit.",
          phase: "completed",
          run,
        });
        return {
          cursorSnapshotRef: finalizedPendingCommit.bundleRef,
          postCursorAction: "cleanup-only",
          state: "completed",
        };
      } catch (error) {
        return await this.recoverWakeExecutionFailure({
          error,
          holdLeaseUntilCleanup,
          leaseOwner: {
            eventId: wake.eventId,
            policy: "same-event",
            run: null,
          },
          run,
          wake,
        });
      }
    }

    const activeLease = await this.readRecentActiveRunLease();
    if (activeLease) {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          activeRunEventId: activeLease.eventId,
          activeRunId: activeLease.run.runId,
        },
        eventId: wake.eventId,
        level: "info",
        message: "Hosted wake execution deferred because another active run still owns the user lease.",
        phase: "wake.running",
        run: null,
        userId,
      });
      return {
        cursorSnapshotRef: null,
        postCursorAction: "cleanup-only",
        state: "backpressured",
      };
    }

    const run = this.resolveRunContext(
      await this.dependencies.stateStore.readState(),
      {
        eventId: wake.eventId,
        startedAt: new Date().toISOString(),
      },
    );
    const leaseOwner: RunnerLeaseOwnerInput = {
      eventId: wake.eventId,
      run,
    };

    await this.dependencies.stateStore.beginWakeRun({
      eventId: wake.eventId,
      run,
      userId,
    });
    await this.advanceRunPhase({
      clearError: true,
      wake,
      message: "Invoking direct hosted wake execution.",
      phase: "claimed",
      run,
    });

    try {
      await this.advanceRunPhase({
        clearError: true,
        wake,
        message: "Running hosted wake directly from the canonical wake queue.",
        phase: "wake.running",
        run,
      });
      let finalRunnerResult: HostedAssistantRuntimeCompletedJobResult | null = null;
      let cursorSnapshotRef: HostedExecutionBundleRef | null = null;

      const runnerResult = await this.invokeRunner(
        userId,
        wake,
        run,
        null,
      );

      if (runnerResult.phase === "committed") {
        const pendingCommit = await this.persistPendingCommit({
          assistantDeliveryEffects: runnerResult.committedAssistantDeliveryEffects,
          gatewayProjectionSnapshot: runnerResult.committedGatewayProjectionSnapshot,
          result: runnerResult.result,
          run,
          wake,
          wakeRecord: options.wakeRecord,
        });
        cursorSnapshotRef = pendingCommit.bundleRef;

        await this.advanceRunPhase({
          clearError: true,
          wake,
          message: "Hosted wake execution recorded a DO-local pending commit.",
          phase: "commit.recorded",
          run,
        });
        const finalizedPendingCommit = await preparePendingCommitForCursorCommit({
          pendingCommit,
          persistBrowserVaultSnapshotBestEffort: this.persistBrowserVaultSnapshotBestEffort.bind(this),
          restorePendingCommitState: this.restorePendingCommitState.bind(this),
          resumePendingCommitToFinalResult: this.resumePendingCommitToFinalResult.bind(this),
          run,
          userId,
          wake,
        });
        cursorSnapshotRef = finalizedPendingCommit.bundleRef;
      } else {
        finalRunnerResult = runnerResult;
        cursorSnapshotRef = await this.persistCompletedRunnerResult({
          eventId: wake.eventId,
          finalGatewayProjectionSnapshot: runnerResult.finalGatewayProjectionSnapshot,
          result: runnerResult.result,
          run,
        });
      }

      if (finalRunnerResult) {
        await this.persistBrowserVaultSnapshotBestEffort(
          userId,
          finalRunnerResult.browserVaultSnapshot ?? null,
        );
      }
      await this.advanceRunPhase({
        clearError: true,
        wake,
        message: "Hosted wake execution produced a final runtime result and is awaiting cursor commit cleanup.",
        phase: "completed",
        run,
      });
      if (!holdLeaseUntilCleanup) {
        await this.dependencies.stateStore.completeWakeRun({
          eventId: wake.eventId,
          finishedAt: new Date().toISOString(),
          leaseOwner,
        });
      }
      return {
        cursorSnapshotRef,
        postCursorAction: "cleanup-only",
        state: "completed",
      };
    } catch (error) {
      return await this.recoverWakeExecutionFailure({
        error,
        holdLeaseUntilCleanup,
        leaseOwner,
        run,
        wake,
      });
    }
  }

  async cleanupWakeAfterCursorCommit<
    TCursor extends {
      committedSeq: string;
      snapshotRef: unknown;
      version: string;
    },
  >(input: {
    cursor: TCursor;
    wake: HostedExecutionWake | null;
  }): Promise<TCursor> {
    await this.dependencies.stateStore.markRuntimeBootstrapped();
    const pendingCommit = input.wake
      ? await this.dependencies.stateStore.readPendingCommit(input.wake.eventId)
      : await this.dependencies.stateStore.readPendingCommit();

    if (pendingCommit) {
      await reconcilePendingCommitAfterCursorCommit({
        cursor: input.cursor,
        dependencies: this.dependencies,
        pendingCommit,
        restorePendingCommitState: this.restorePendingCommitState.bind(this),
      });
    }

    const cleanupWake = input.wake ?? (pendingCommit
      ? await this.restoreWakeFromPendingCommit(pendingCommit)
      : null);
    await this.rememberCommittedEventAndCleanup(
      pendingCommit?.userId
        ?? cleanupWake?.userId
        ?? (await this.dependencies.stateStore.readState()).userId,
      pendingCommit?.eventId ?? cleanupWake?.eventId ?? "unknown",
      cleanupWake,
    );
    return input.cursor;
  }

  async discardWakeAfterLostCursorRace(input: {
    wake: HostedExecutionWake;
  }): Promise<void> {
    await this.dependencies.stateStore.clearPendingCommit(input.wake.eventId);
    await this.dependencies.stateStore.completeWakeRun({
      eventId: input.wake.eventId,
      finishedAt: new Date().toISOString(),
      leaseOwner: {
        eventId: input.wake.eventId,
        policy: "same-event",
        run: null,
      },
    });
  }

  private async restorePendingCommitState(
    pendingCommit: RunnerPendingCommitRecord,
  ): Promise<void> {
    await this.dependencies.stateStore.syncBundleRefCache(pendingCommit.bundleRef);
    await this.dependencies.wakeScheduler.syncNextWake({
      preferredWakeAt: pendingCommit.result.nextWakeAt ?? null,
      ...(pendingCommit.result.wakeMaterializationHints === undefined
        ? {}
        : { wakeMaterializationHints: pendingCommit.result.wakeMaterializationHints }),
    });
  }

  private async recoverWakeExecutionFailure(input: {
    error: unknown;
    holdLeaseUntilCleanup: boolean;
    leaseOwner: RunnerLeaseOwnerInput;
    run: HostedExecutionRunContext;
    wake: HostedExecutionWake;
  }): Promise<RunnerWakeExecutionResult> {
    if (input.error instanceof HostedExecutionObsoleteRunResultError) {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          obsoleteRunId: input.error.runId,
          runElapsedMs: computeHostedRunElapsedMs(input.run),
        },
        error: input.error,
        eventId: input.wake.eventId,
        level: "warn",
        message: "Hosted wake execution returned a stale result for an obsolete run lease.",
        phase: "wake.running",
        run: input.run,
        userId: input.wake.userId,
      });
      await this.dependencies.stateStore.failWakeRun({
        error: input.error,
        eventId: input.wake.eventId,
        leaseOwner: input.leaseOwner,
      });
      return {
        cursorSnapshotRef: null,
        postCursorAction: "cleanup-only",
        state: "backpressured",
      };
    }

    const recoveredPendingCommit = await this.dependencies.stateStore.readPendingCommit(
      input.wake.eventId,
    );
    if (recoveredPendingCommit?.finalizedAt) {
      await this.restorePendingCommitState(recoveredPendingCommit);
      if (!input.holdLeaseUntilCleanup) {
        await this.dependencies.stateStore.completeWakeRun({
          eventId: input.wake.eventId,
          finishedAt: recoveredPendingCommit.finalizedAt ?? recoveredPendingCommit.committedAt,
          leaseOwner: input.leaseOwner,
        });
      }
      await this.advanceRunPhase({
        clearError: true,
        wake: input.wake,
        message: "Hosted wake execution recovered a finalized DO-local pending commit after a transient failure.",
        phase: "completed",
        run: input.run,
      });
      return {
        cursorSnapshotRef: recoveredPendingCommit.bundleRef,
        postCursorAction: "cleanup-only",
        state: "completed",
      };
    }

    await this.dependencies.stateStore.failWakeRun({
      error: input.error,
      eventId: input.wake.eventId,
      leaseOwner: input.leaseOwner,
    });
    await this.dependencies.wakeScheduler.syncNextWake({
      preferredWakeAt: recoveredPendingCommit?.result.nextWakeAt ?? null,
      ...(recoveredPendingCommit?.result.wakeMaterializationHints === undefined
        ? {}
        : { wakeMaterializationHints: recoveredPendingCommit.result.wakeMaterializationHints }),
    });
    await this.advanceRunPhase({
      wake: input.wake,
      error: input.error,
      level: input.error instanceof HostedExecutionConfigurationError ? "warn" : "error",
      message: recoveredPendingCommit
        ? "Hosted wake execution preserved a DO-local pending commit for a later finalize retry."
        : input.error instanceof HostedExecutionConfigurationError
        ? "Hosted wake execution deferred because the runtime is not configured yet."
        : "Hosted wake execution deferred after a direct runner failure.",
      phase: "retry.scheduled",
      run: input.run,
    });
    return {
      cursorSnapshotRef: null,
      postCursorAction: "cleanup-only",
      state: "backpressured",
    };
  }

  private async resumePendingCommitToFinalResult(input: {
    pendingCommit: RunnerPendingCommitRecord;
    run: HostedExecutionRunContext;
    userId: string;
    wake: HostedExecutionWake;
  }): Promise<{
    finalRunnerResult: HostedAssistantRuntimeCompletedJobResult;
    finalizedPendingCommit: RunnerPendingCommitRecord;
  }> {
    await this.restorePendingCommitState(input.pendingCommit);
    const finalRunnerResult = await this.invokeRunner(
      input.userId,
      input.wake,
      input.run,
      {
        committedResult: {
          assistantDeliveryEffects: input.pendingCommit.assistantDeliveryEffects,
          result: input.pendingCommit.result,
        },
      },
    );

    if (!isCompletedRunnerResult(finalRunnerResult)) {
      throw new Error("Hosted wake execution returned a duplicate committed result during finalize.");
    }

    const finalizedPendingCommit = await this.finalizePendingCommitResult({
      eventId: input.wake.eventId,
      finalGatewayProjectionSnapshot: finalRunnerResult.finalGatewayProjectionSnapshot,
      pendingCommit: input.pendingCommit,
      result: finalRunnerResult.result,
      run: input.run,
    });
    return {
      finalRunnerResult,
      finalizedPendingCommit,
    };
  }

  private async resolvePendingCommitCleanupRun(input: {
    pendingCommit: RunnerPendingCommitRecord;
    wake: HostedExecutionWake;
  }): Promise<HostedExecutionRunContext> {
    const activeLease = await this.dependencies.stateStore.readActiveRunLease();
    if (activeLease && activeLease.eventId === input.pendingCommit.eventId) {
      return activeLease.run;
    }

    return this.resolveRunContext(await this.dependencies.stateStore.readState(), {
      eventId: input.pendingCommit.eventId,
      startedAt: input.pendingCommit.committedAt,
    });
  }

  private async restoreWakeFromPendingCommit(
    pendingCommit: RunnerPendingCommitRecord,
  ): Promise<HostedExecutionWake> {
    const decryptedPayload = await decryptHostedWakePayloadCiphertext({
      ciphertext: pendingCommit.wake.payloadCiphertext,
      environment: this.dependencies.env.hostedWakeEncryption,
      userId: pendingCommit.userId,
    });

    return parseHostedWakeExecutionPayload({
      decryptedPayload,
      kind: pendingCommit.wake.kind,
      occurredAt: pendingCommit.wake.occurredAt,
      payloadSchema: pendingCommit.wake.payloadSchema,
      userId: pendingCommit.userId,
    });
  }

  private async invokeRunner(
    userId: string,
    wake: HostedExecutionWake,
    run: HostedExecutionRunContext,
    resume: {
      committedResult: {
        assistantDeliveryEffects: RunnerPendingCommitRecord["assistantDeliveryEffects"];
        result: RunnerPendingCommitRecord["result"];
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
      this.dependencies.stateStore.readBundleMetaState(),
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

  private async persistPendingCommit(input: {
    assistantDeliveryEffects: RunnerPendingCommitRecord["assistantDeliveryEffects"];
    gatewayProjectionSnapshot: GatewayProjectionSnapshot | null;
    result: HostedExecutionRunnerResult;
    run: HostedExecutionRunContext;
    wake: HostedExecutionWake;
    wakeRecord: RunnerPendingCommitRecord["wake"];
  }): Promise<RunnerPendingCommitRecord> {
    return this.dependencies.applyHostedTransition({
      eventId: input.wake.eventId,
      gatewayProjectionSnapshot: input.gatewayProjectionSnapshot ?? null,
      leaseOwner: {
        eventId: input.wake.eventId,
        run: input.run,
      },
      run: async (userId, stores) => {
        const bundleState = await this.dependencies.stateStore.readBundleMetaState();
        const record = await stores.bundleSync.applyRunnerResultBundles(
          userId,
          bundleState.bundleVersion,
          input.result.bundle,
        );
        const pendingCommit: RunnerPendingCommitRecord = {
          assistantDeliveryEffects: [...input.assistantDeliveryEffects],
          bundleRef: record.bundleRef,
          committedAt: new Date().toISOString(),
          eventId: input.wake.eventId,
          finalizedAt: null,
          result: input.result.result,
          schemaVersion: 1,
          userId,
          wake: input.wakeRecord,
        };
        await this.dependencies.stateStore.writePendingCommit(pendingCommit);
        await this.dependencies.wakeScheduler.syncNextWake({
          preferredWakeAt: input.result.result.nextWakeAt ?? null,
          ...(input.result.result.wakeMaterializationHints === undefined
            ? {}
            : { wakeMaterializationHints: input.result.result.wakeMaterializationHints }),
        });
        return pendingCommit;
      },
    });
  }

  private async finalizePendingCommitResult(input: {
    eventId: string;
    finalGatewayProjectionSnapshot: GatewayProjectionSnapshot | null;
    pendingCommit: RunnerPendingCommitRecord;
    result: HostedExecutionRunnerResult;
    run: HostedExecutionRunContext;
  }): Promise<RunnerPendingCommitRecord> {
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
        const finalizedPendingCommit: RunnerPendingCommitRecord = {
          ...input.pendingCommit,
          assistantDeliveryEffects: [],
          bundleRef: record.bundleRef,
          finalizedAt: new Date().toISOString(),
          result: input.result.result,
        };
        await this.dependencies.stateStore.writePendingCommit(finalizedPendingCommit);
        await this.dependencies.wakeScheduler.syncNextWake({
          preferredWakeAt: input.result.result.nextWakeAt ?? null,
          ...(input.result.result.wakeMaterializationHints === undefined
            ? {}
            : { wakeMaterializationHints: input.result.result.wakeMaterializationHints }),
        });
        return finalizedPendingCommit;
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
          ...(input.result.result.wakeMaterializationHints === undefined
            ? {}
            : { wakeMaterializationHints: input.result.result.wakeMaterializationHints }),
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

  private async resolveWakeStartMode(eventId: string): Promise<RunnerWakeStartMode> {
    const pendingCommit = await this.dependencies.stateStore.readPendingCommit(eventId);
    if (!pendingCommit) {
      return {
        kind: "directRun",
      };
    }

    return pendingCommit.finalizedAt
      ? {
        kind: "alreadyFinalized",
        pendingCommit,
      }
      : {
        kind: "resumePendingCommit",
        pendingCommit,
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

    return record;
  }

  private async rememberCommittedEventAndCleanup(
    userId: string,
    eventId: string,
    wake: HostedExecutionWake | null = null,
  ): Promise<RunnerStateRecord> {
    const record = await this.dependencies.stateStore.completeWakeRun({
      eventId,
      finishedAt: new Date().toISOString(),
      leaseOwner: {
        eventId,
        policy: "same-event",
        run: null,
      },
    });
    await this.dependencies.stateStore.clearPendingCommit(eventId);
    if (wake) {
      await this.deleteTransientWakeDataBestEffort(wake);
    }
    return record;
  }

  private async deleteTransientWakeDataBestEffort(
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
