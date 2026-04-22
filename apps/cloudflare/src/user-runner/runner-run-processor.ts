import type {
  HostedExecutionBundleRef,
  HostedBrowserVaultReplicaRef,
  HostedExecutionRedactedLogEntry,
  HostedExecutionRunContext,
  HostedExecutionRunLevel,
  HostedExecutionRunPhase,
  HostedRuntimeEvent,
  HostedExecutionRunnerResult,
  HostedExecutionRunnerSharePack,
  HostedExecutionRunnerVaultSyncImport,
  HostedIngressEnvelope,
  HostedRunRecord,
  HostedRuntimeDrainEvent,
  HostedRuntimeDrainRequest,
  HostedIngressLifecycleState,
} from "@murphai/hosted-execution";
import type { GatewayProjectionSnapshot } from "@murphai/gateway-core";
import {
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  extractHostedAssistantNotificationRedactedDetails,
  formatHostedExecutionLogMessage,
} from "@murphai/hosted-execution";
import {
  parseHostedExecutionRunnerSharePack,
  parseHostedExecutionRunnerVaultSyncImport,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedAssistantDeliveryOutcome,
  HostedAssistantRuntimeCompletedJobResult,
  HostedAssistantRuntimeConfig,
  HostedAssistantRuntimeJobInput,
  HostedAssistantRuntimeJobResult,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  HOSTED_RUN_MESSAGING_ACTIVITY_OWNER_ENV,
  HOSTED_RUN_MESSAGING_ACTIVITY_OWNER_EXECUTOR,
  computeHostedRunElapsedMs,
  selectHostedRunMessagingActivityTarget,
  startHostedRunMessagingActivity,
  type HostedRunMessagingActivityHandle,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import type { R2BucketLike } from "../bundle-store.js";
import { createHostedBrowserVaultReplicaStore } from "../browser-vault-store.js";
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
  summarizeHostedRunnerForwardedEnvLogCategories,
  summarizeHostedRunnerSecretLogCategories,
} from "../hosted-env-policy.ts";
import {
  type RunnerStateRecord,
} from "./types.js";
import { RunnerBundleSync } from "./runner-bundle-sync.js";
import { RunnerStateStore } from "./runner-state-store.js";
import type { RunnerLeaseOwnerInput } from "./runner-state-store.js";
import { RunnerRuntimeAlarmScheduler } from "./runner-runtime-alarm-scheduler.js";
import { RunnerSecretsService } from "./runner-secrets.js";
import {
  fetchHostedExecutionWebControlPlaneResponse,
  recordHostedRunLogInWeb,
} from "../web-control-plane.ts";

export type HostedIngressEnvelopeProgressRecord =
  Pick<HostedRuntimeEvent, "eventId" | "userId">;

export interface RunnerUserStores {
  bundleSync: RunnerBundleSync;
  crypto: HostedUserCryptoContext;
  gatewayCache: HostedGatewayProjectionCache;
  runnerSecrets: RunnerSecretsService;
  userId: string;
}

export interface RunnerRunDrainExecutionResult {
  browserVaultReplicaRef?: HostedBrowserVaultReplicaRef | null;
  cursorSnapshotRef: HostedExecutionBundleRef | null;
  finalizeRequired: boolean;
  nextRuntimeWakeAt?: string | null;
  redactedSummary?: Record<string, unknown>;
  state: HostedIngressLifecycleState;
}

const HOSTED_RUN_PHASE_LOG_TIMEOUT_MS = 2_000;
const HOSTED_RUN_LOG_COMPONENT = "cloudflare-runner";

interface RunnerRunTransitionInput<T> {
  eventId: string;
  gatewayProjectionSnapshot?: GatewayProjectionSnapshot | null;
  leaseOwner?: RunnerLeaseOwnerInput;
  run: (userId: string, stores: RunnerUserStores) => Promise<T>;
}

interface RunnerRunProcessorDependencies {
  applyHostedTransition<T>(input: RunnerRunTransitionInput<T>): Promise<T>;
  bucket: R2BucketLike;
  ensureRunnerStores(userId?: string): Promise<RunnerUserStores>;
  env: HostedExecutionEnvironment;
  hostedWebBaseUrl: string | null;
  stateStore: RunnerStateStore;
  readRunnerRuntimeConfigSource(): Readonly<Record<string, string | undefined>>;
  runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
  runnerRuntimeEnvSource: Readonly<Record<string, unknown>>;
  runtimeAlarmScheduler: RunnerRuntimeAlarmScheduler;
}

export class RunnerRunProcessor {
  constructor(
    private readonly dependencies: RunnerRunProcessorDependencies,
  ) {}

  async readRunDrainSharePack(
    wake: HostedIngressEnvelope,
  ): Promise<HostedExecutionRunnerSharePack | null> {
    if (wake.kind !== "vault.share.accepted") {
      return null;
    }

    return this.readRunnerSharePack({
      ownerUserId: wake.share.ownerUserId,
      shareId: wake.share.shareId,
    });
  }

  async readRunDrainVaultSyncImport(
    wake: HostedIngressEnvelope,
  ): Promise<HostedExecutionRunnerVaultSyncImport | null> {
    if (wake.kind !== "vault.sync.import") {
      return null;
    }

    return this.readRunnerVaultSyncImport({
      sessionId: wake.vaultSync.sessionId,
      userId: wake.userId,
    });
  }

  async executeRunDrain(input: {
    currentBundleRef: HostedExecutionBundleRef | null;
    events: HostedRuntimeDrainEvent[];
    primaryWake: HostedRuntimeEvent;
    messagingActivityOwnedByExecutor?: boolean;
    run: HostedRunRecord;
    runToken?: string | null;
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
      void recordHostedRunBreadcrumbInWebBestEffort({
        baseUrl: this.dependencies.hostedWebBaseUrl,
        callbackSigning: this.dependencies.env.webCallbackSigning,
        level: "info",
        message: "Cloudflare deferred hosted run execution because another active run still owns the user lease.",
        phase: "runtime_backpressured",
        redacted: {
          activeRunId: activeLease.run.runId,
          reason: "active_lease",
        },
        run,
        runToken: input.runToken,
        userId,
        wakeEventId: runEventId,
      });
      return {
        cursorSnapshotRef: null,
        finalizeRequired: false,
        state: "backpressured",
      };
    }

    await this.dependencies.stateStore.beginRun({
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
      runToken: input.runToken,
    });

    try {
      const runnerResult = await this.invokeRunner(
        userId,
        input.currentBundleRef,
        input.primaryWake,
        run,
        buildHostedRuntimeDrainRequest({
          events: input.events,
          resumeFinalize: false,
          run: input.run,
        }),
        input.runToken,
        {
          messagingActivityOwnedByExecutor: input.messagingActivityOwnedByExecutor === true,
        },
      );
      const result = runnerResult.result;

      if (runnerResult.phase === "prepared") {
        const cursorSnapshotRef = await this.persistCompletedRunnerResult({
          currentBundleRef: input.currentBundleRef,
          eventId: runEventId,
          finalGatewayProjectionSnapshot: runnerResult.committedGatewayProjectionSnapshot,
          result: runnerResult.result,
          run,
        });
        void recordHostedRunnerResultLogsInWebBestEffort({
          baseUrl: this.dependencies.hostedWebBaseUrl,
          callbackSigning: this.dependencies.env.webCallbackSigning,
          redactedLogEntries: result.result.redactedLogEntries ?? null,
          run,
          runToken: input.runToken,
          userId,
          wakeEventId: runEventId,
        });
        void recordHostedRunBreadcrumbInWebBestEffort({
          baseUrl: this.dependencies.hostedWebBaseUrl,
          callbackSigning: this.dependencies.env.webCallbackSigning,
          message: "Cloudflare prepared a hosted run snapshot for commit.",
          phase: "runner_prepared_snapshot",
          redacted: {
            assistantDeliveryEffectCount: runnerResult.committedAssistantDeliveryEffects.length,
            eventCount: input.events.length,
            nextRuntimeWakeScheduled: result.result.nextWakeAt !== null,
          },
          run,
          runToken: input.runToken,
          userId,
          wakeEventId: runEventId,
        });
        await this.advanceRunPhase({
          clearError: true,
          wake: { eventId: runEventId, userId },
          message: "Hosted run drain prepared a snapshot and is awaiting web commit.",
          phase: "commit.recorded",
          run,
          runToken: input.runToken,
        });
        await this.dependencies.stateStore.completeRun({
          eventId: runEventId,
          finishedAt: new Date().toISOString(),
          leaseOwner,
        });
        return {
          cursorSnapshotRef,
          finalizeRequired: true,
          nextRuntimeWakeAt: result.result.nextWakeAt ?? null,
          redactedSummary: buildRunnerRedactedSummary({
            assistantDeliveryEffectCount: runnerResult.committedAssistantDeliveryEffects.length,
            eventsHandled: result.result.eventsHandled,
            phase: "prepared",
            redactedDetails: result.result.redactedDetails ?? null,
            summary: result.result.summary,
          }),
          state: "completed",
        };
      }

      const cursorSnapshotRef = await this.persistCompletedRunnerResult({
        currentBundleRef: input.currentBundleRef,
        eventId: runEventId,
        finalGatewayProjectionSnapshot: runnerResult.finalGatewayProjectionSnapshot,
        result: runnerResult.result,
        run,
      });
      void recordHostedRunnerResultLogsInWebBestEffort({
        baseUrl: this.dependencies.hostedWebBaseUrl,
        callbackSigning: this.dependencies.env.webCallbackSigning,
        redactedLogEntries: result.result.redactedLogEntries ?? null,
        run,
        runToken: input.runToken,
        userId,
        wakeEventId: runEventId,
      });
      const browserVaultReplicaRef = await this.persistBrowserVaultReplicaBestEffort(
        userId,
        runnerResult.browserVaultReplica ?? null,
      );
      await this.dependencies.stateStore.completeRun({
        eventId: runEventId,
        finishedAt: new Date().toISOString(),
        leaseOwner,
      });
      return {
        browserVaultReplicaRef,
        cursorSnapshotRef,
        finalizeRequired: false,
        nextRuntimeWakeAt: result.result.nextWakeAt ?? null,
        redactedSummary: buildRunnerRedactedSummary({
          eventsHandled: result.result.eventsHandled,
          phase: "finalized",
          redactedDetails: result.result.redactedDetails ?? null,
          summary: result.result.summary,
        }),
        state: "completed",
      };
    } catch (error) {
      await this.dependencies.stateStore.failRun({
        error,
        eventId: runEventId,
        leaseOwner,
      });
      const backpressured = error instanceof HostedExecutionConfigurationError;
      void recordHostedRunBreadcrumbInWebBestEffort({
        baseUrl: this.dependencies.hostedWebBaseUrl,
        callbackSigning: this.dependencies.env.webCallbackSigning,
        error,
        level: backpressured ? "warn" : "error",
        message: backpressured
          ? "Cloudflare deferred hosted run execution because the runtime is not configured yet."
          : "Cloudflare runner invocation failed while preparing the hosted run snapshot.",
        phase: backpressured ? "runtime_backpressured" : "runtime_failed",
        redacted: mergeHostedRunRedactedDetails(
          {
            eventCount: input.events.length,
            reason: backpressured ? "runtime_not_configured" : "runner_invocation_failed",
            resumeFinalize: false,
          },
          extractHostedAssistantNotificationRedactedDetails(error),
        ),
        run,
        runToken: input.runToken,
        userId,
        wakeEventId: runEventId,
      });
      await this.advanceRunPhase({
        wake: { eventId: runEventId, userId },
        error,
        level: backpressured ? "warn" : "error",
        message: backpressured
          ? "Hosted run drain deferred because the runtime is not configured yet."
          : "Hosted run drain failed after invoking the runtime.",
        phase: "retry.scheduled",
        run,
        runToken: input.runToken,
      });
      return {
        cursorSnapshotRef: null,
        finalizeRequired: false,
        state: "backpressured",
      };
    }
  }

  async startRunMessagingActivity(input: {
    events: HostedRuntimeDrainEvent[];
    run: HostedRunRecord;
  }): Promise<HostedRunMessagingActivityHandle | null> {
    if (!selectHostedRunMessagingActivityTarget(input.events)) {
      return null;
    }

    const run = hostedRunRecordToExecutionRunContext(input.run);

    try {
      const runtimeEnv = await this.resolveRunnerMessagingActivityRuntimeEnv(input.run.userId);

      return startHostedRunMessagingActivity({
        component: "runner",
        events: input.events,
        runtimeEnv,
        run,
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          eventCount: input.events.length,
          runElapsedMs: computeHostedRunElapsedMs(run),
        },
        error,
        eventId: hostedRunEventId(input.run.id),
        level: "warn",
        message: "Hosted run messaging activity could not be started; continuing without typing indicator.",
        phase: "wake.running",
        run,
        userId: input.run.userId,
      });
      return null;
    }
  }

  async finalizeRunDrain(input: {
    currentBundleRef: HostedExecutionBundleRef | null;
    primaryWake: HostedRuntimeEvent;
    messagingActivityOwnedByExecutor?: boolean;
    run: HostedRunRecord;
    runToken?: string | null;
  }): Promise<RunnerRunDrainExecutionResult> {
    const userId = input.primaryWake.userId;
    const run = hostedRunRecordToExecutionRunContext(input.run);
    const runEventId = hostedRunEventId(input.run.id);
    const leaseOwner: RunnerLeaseOwnerInput = {
      eventId: runEventId,
      run,
    };

    await this.dependencies.stateStore.beginRun({
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
      runToken: input.runToken,
    });

    try {
      const runnerResult = await this.invokeRunner(
        userId,
        input.currentBundleRef,
        input.primaryWake,
        run,
        buildHostedRuntimeDrainRequest({
          events: [],
          resumeFinalize: true,
          run: input.run,
        }),
        input.runToken,
        {
          messagingActivityOwnedByExecutor: input.messagingActivityOwnedByExecutor === true,
        },
      );

      if (!isCompletedRunnerResult(runnerResult)) {
        throw new Error("Hosted run-drain finalization returned a duplicate committed result.");
      }

      const cursorSnapshotRef = await this.persistCompletedRunnerResult({
        currentBundleRef: input.currentBundleRef,
        eventId: runEventId,
        finalGatewayProjectionSnapshot: runnerResult.finalGatewayProjectionSnapshot,
        result: runnerResult.result,
        run,
      });
      const browserVaultReplicaRef = await this.persistBrowserVaultReplicaBestEffort(
        userId,
        runnerResult.browserVaultReplica ?? null,
      );
      await this.dependencies.stateStore.completeRun({
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
        runToken: input.runToken,
      });

      return {
        browserVaultReplicaRef,
        cursorSnapshotRef,
        finalizeRequired: false,
        nextRuntimeWakeAt: runnerResult.result.result.nextWakeAt,
        redactedSummary: buildRunnerRedactedSummary({
          ...summarizeHostedAssistantDeliveryOutcomes(runnerResult.assistantDeliveryOutcomes),
          eventsHandled: runnerResult.result.result.eventsHandled,
          phase: "finalized",
          redactedDetails: runnerResult.result.result.redactedDetails ?? null,
          summary: runnerResult.result.result.summary,
        }),
        state: "completed",
      };
    } catch (error) {
      await this.dependencies.stateStore.failRun({
        error,
        eventId: runEventId,
        leaseOwner,
      });
      const backpressured = error instanceof HostedExecutionConfigurationError;
      void recordHostedRunBreadcrumbInWebBestEffort({
        baseUrl: this.dependencies.hostedWebBaseUrl,
        callbackSigning: this.dependencies.env.webCallbackSigning,
        error,
        level: backpressured ? "warn" : "error",
        message: backpressured
          ? "Cloudflare deferred hosted run finalization because the runtime is not configured yet."
          : "Cloudflare runner invocation failed while finalizing the hosted run.",
        phase: backpressured ? "runtime_backpressured" : "runtime_failed",
        redacted: mergeHostedRunRedactedDetails(
          {
            reason: backpressured ? "runtime_not_configured" : "runner_finalize_failed",
            resumeFinalize: true,
          },
          extractHostedAssistantNotificationRedactedDetails(error),
        ),
        run,
        runToken: input.runToken,
        userId,
        wakeEventId: runEventId,
      });
      await this.advanceRunPhase({
        wake: { eventId: runEventId, userId },
        error,
        level: backpressured ? "warn" : "error",
        message: backpressured
          ? "Hosted run-drain finalization deferred because the runtime is not configured yet."
          : "Hosted run-drain finalization failed after invoking the runtime.",
        phase: "retry.scheduled",
        run,
        runToken: input.runToken,
      });
      return {
        cursorSnapshotRef: null,
        finalizeRequired: false,
        state: "backpressured",
      };
    }
  }

  async cleanupTransientWakeDataBestEffortForRunDrain(
    wake: HostedIngressEnvelope,
  ): Promise<void> {
    await this.deleteTransientWakeDataBestEffort(wake);
  }

  private async deleteTransientWakeDataBestEffort(wake: HostedIngressEnvelope): Promise<void> {
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
        message: "Hosted wake best-effort raw email cleanup failed; the durable raw message object may need manual cleanup.",
        phase: "completed",
        run: null,
        userId: wake.userId,
      });
    }
  }

  private async resolveRunnerMessagingActivityRuntimeEnv(
    userId: string,
  ): Promise<Record<string, string>> {
    const { runnerSecrets: runnerSecretsService } = await this.dependencies.ensureRunnerStores(
      userId,
    );
    const runnerSecrets = await runnerSecretsService.readRunnerSecrets(userId);
    const forwardedEnv = buildHostedRunnerContainerEnv(
      this.dependencies.runnerRuntimeEnvSource,
    );
    const runtimeConfig = buildHostedRunnerJobRuntimeConfig({
      configSource: this.dependencies.readRunnerRuntimeConfigSource(),
      forwardedEnv,
      runnerSecrets,
    });

    return {
      ...(runtimeConfig.forwardedEnv ?? {}),
      ...(runtimeConfig.userEnv ?? {}),
    };
  }

  private async invokeRunner(
    userId: string,
    currentBundleRef: HostedExecutionBundleRef | null,
    primaryWake: HostedRuntimeEvent,
    run: HostedExecutionRunContext,
    runDrain: HostedRuntimeDrainRequest,
    runToken?: string | null,
    options: {
      messagingActivityOwnedByExecutor?: boolean;
    } = {},
  ): Promise<HostedAssistantRuntimeJobResult> {
    if (!this.dependencies.runnerContainerNamespace) {
      throw new Error("Native hosted execution requires a RunnerContainer binding.");
    }

    const { bundleSync, runnerSecrets: runnerSecretsService } = await this.dependencies.ensureRunnerStores(
      userId,
    );
    const runnerSecrets = await runnerSecretsService.readRunnerSecrets(userId);
    const forwardedEnv = buildHostedRunnerContainerEnv(
      this.dependencies.runnerRuntimeEnvSource,
    );
    const runtimeConfig = buildHostedRunnerJobRuntimeConfig({
      configSource: this.dependencies.readRunnerRuntimeConfigSource(),
      forwardedEnv,
      runnerSecrets,
    });
    const job: HostedAssistantRuntimeJobInput = {
      request: {
        bundle: await bundleSync.readBundlesForRunner(currentBundleRef),
        currentBundleRef,
        run,
        runDrain,
        ...(runToken ? { runToken } : {}),
      },
      runtime: options.messagingActivityOwnedByExecutor === true
        ? markHostedRunMessagingActivityOwnedByExecutor(runtimeConfig)
        : runtimeConfig,
    };
    void recordHostedRunBreadcrumbInWebBestEffort({
      baseUrl: this.dependencies.hostedWebBaseUrl,
      callbackSigning: this.dependencies.env.webCallbackSigning,
      message: "Cloudflare started a runner invocation for the acquired hosted run.",
      phase: "runner_invocation_started",
      redacted: {
        eventCount: runDrain.events.length,
        resumeFinalize: runDrain.resumeFinalize === true,
        triggerKind: runDrain.triggerKind,
        wakeKind: primaryWake.kind,
      },
      run,
      runToken,
      userId,
      wakeEventId: primaryWake.eventId,
    });

    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        bundlePresent: job.request.bundle !== null,
        forwardedEnvCategories: summarizeHostedRunnerForwardedEnvLogCategories(forwardedEnv),
        forwardedEnvKeyCount: Object.keys(forwardedEnv).length,
        runElapsedMs: computeHostedRunElapsedMs(run),
        runDrainEventCount: runDrain.events.length,
        runDrainResumeFinalize: runDrain.resumeFinalize === true,
        runDrainRunId: runDrain.runId,
        runnerSecretsCategories: summarizeHostedRunnerSecretLogCategories(runnerSecrets),
        runnerSecretKeyCount: Object.keys(runnerSecrets).length,
      },
      eventId: primaryWake.eventId,
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
      const payload: unknown = JSON.parse(await response.text());
      return parseHostedExecutionRunnerSharePack(payload);
    } catch (error) {
      throw new Error("Hosted share payload read returned invalid JSON.", {
        cause: error,
      });
    }
  }


  private async readRunnerVaultSyncImport(input: {
    sessionId: string;
    userId: string;
  }): Promise<HostedExecutionRunnerVaultSyncImport> {
    const hostedWebBaseUrl = this.dependencies.hostedWebBaseUrl;

    if (!hostedWebBaseUrl) {
      throw new Error("HOSTED_WEB_BASE_URL must be configured for hosted vault sync import hydration.");
    }

    const response = await fetchHostedExecutionWebControlPlaneResponse({
      baseUrl: hostedWebBaseUrl,
      boundUserId: input.userId,
      callbackSigning: this.dependencies.env.webCallbackSigning,
      method: "GET",
      path: `/api/internal/hosted-execution/vault-sync/${encodeURIComponent(input.sessionId)}/payload`,
      timeoutMs: this.dependencies.env.runnerTimeoutMs,
    });

    if (response.status === 404) {
      throw createMissingHostedVaultSyncImportError(input);
    }

    if (!response.ok) {
      throw new Error(`Hosted vault sync import payload read failed with HTTP ${response.status}.`);
    }

    try {
      const payload: unknown = JSON.parse(await response.text());
      return parseHostedExecutionRunnerVaultSyncImport(payload);
    } catch (error) {
      throw new Error("Hosted vault sync import payload read returned invalid JSON.", {
        cause: error,
      });
    }
  }

  private async persistCompletedRunnerResult(input: {
    currentBundleRef: HostedExecutionBundleRef | null;
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
        const { bundleRef: nextBundleRef } = await stores.bundleSync.applyRunnerResultBundles(
          userId,
          input.currentBundleRef,
          input.result.bundle,
        );
        await this.dependencies.stateStore.syncBundleRefCache(nextBundleRef);
        await this.dependencies.runtimeAlarmScheduler.syncNextWake({
          preferredWakeAt: input.result.result.nextWakeAt ?? null,
        });
        return nextBundleRef;
      },
    });
  }

  private async persistBrowserVaultReplicaBestEffort(
    userId: string,
    browserVaultReplica: unknown | null,
  ): Promise<HostedBrowserVaultReplicaRef | null> {
    if (!browserVaultReplica) {
      return null;
    }

    try {
      const { crypto } = await this.dependencies.ensureRunnerStores(userId);
      const store = createHostedBrowserVaultReplicaStore({
        bucket: this.dependencies.bucket,
        rootKey: crypto.rootKey,
      });

      return await store.writeBrowserVaultReplica({
        replica: browserVaultReplica,
        userId,
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          action: "write",
          error: formatHostedExecutionLogMessage(
            "Browser vault replica persistence failed.",
            error,
          ),
        },
        eventId: "browser-vault-replica",
        message: "Failed to persist browser vault replica object.",
        phase: "completed",
        run: null,
        userId,
      });
      return null;
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
    wake: HostedIngressEnvelopeProgressRecord;
    error?: unknown;
    level?: HostedExecutionRunLevel;
    message: string;
    phase: HostedExecutionRunPhase;
    run: HostedExecutionRunContext;
    runToken?: string | null;
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
      message: input.message,
      phase: input.phase,
      run: input.run,
      runToken: input.runToken,
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
    userId: input.run.userId,
  };
}

function markHostedRunMessagingActivityOwnedByExecutor(
  runtimeConfig: HostedAssistantRuntimeConfig,
): HostedAssistantRuntimeConfig {
  return {
    ...runtimeConfig,
    forwardedEnv: {
      ...runtimeConfig.forwardedEnv,
      [HOSTED_RUN_MESSAGING_ACTIVITY_OWNER_ENV]:
        HOSTED_RUN_MESSAGING_ACTIVITY_OWNER_EXECUTOR,
    },
  };
}

function isCompletedRunnerResult(
  result: HostedAssistantRuntimeJobResult,
): result is Exclude<HostedAssistantRuntimeJobResult, { phase: "prepared" }> {
  return result.phase === undefined || result.phase === "completed";
}


function buildRunnerRedactedSummary(
  input: Record<string, unknown> & { redactedDetails?: Record<string, unknown> | null },
): Record<string, unknown> {
  const { redactedDetails, ...summary } = input;
  return {
    ...summary,
    ...(redactedDetails ? { details: redactedDetails } : {}),
  };
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
  component?: string;
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
  return recordHostedRunBreadcrumbInWebBestEffort({
    ...input,
    redacted: {
      eventId: input.wakeEventId,
    },
  });
}

export async function recordHostedRunBreadcrumbInWebBestEffort(input: {
  baseUrl: string | null;
  callbackSigning: HostedExecutionEnvironment["webCallbackSigning"];
  component?: string;
  error?: unknown;
  level?: HostedExecutionRunLevel;
  message: string;
  phase: string;
  recordLog?: typeof recordHostedRunLogInWeb;
  redacted?: Record<string, unknown> | null;
  run: HostedExecutionRunContext;
  runToken?: string | null;
  userId: string;
  wakeEventId: string;
}): Promise<void> {
  if (!input.baseUrl) {
    return;
  }

  if (typeof input.runToken !== "string") {
    return;
  }

  const runToken = input.runToken;
  const recordLog = input.recordLog ?? recordHostedRunLogInWeb;
  const redacted = {
    ...(input.redacted ?? {}),
    ...(input.error === undefined ? {} : { errorCode: deriveHostedExecutionErrorCode(input.error) }),
    runElapsedMs: computeHostedRunElapsedMs(input.run),
  };

  try {
    await recordLog({
      baseUrl: input.baseUrl,
      body: {
        at: new Date().toISOString(),
        component: input.component ?? HOSTED_RUN_LOG_COMPONENT,
        level: input.level ?? (input.error === undefined ? "info" : "error"),
        message: input.message,
        phase: input.phase,
        redacted,
        runId: input.run.runId,
        runToken,
      },
      boundUserId: input.userId,
      callbackSigning: input.callbackSigning,
      timeoutMs: HOSTED_RUN_PHASE_LOG_TIMEOUT_MS,
    });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: HOSTED_RUN_LOG_COMPONENT,
      details: {
        runElapsedMs: computeHostedRunElapsedMs(input.run),
        runLogWakeEventId: input.wakeEventId,
      },
      error,
      eventId: input.wakeEventId,
      level: "warn",
      message: "Hosted run phase log write to web failed; continuing with runner-local observability only.",
      phase: "retry.scheduled",
      run: input.run,
      userId: input.userId,
    });
  }
}

export async function recordHostedRunnerResultLogsInWebBestEffort(input: {
  baseUrl: string | null;
  callbackSigning: HostedExecutionEnvironment["webCallbackSigning"];
  recordLog?: typeof recordHostedRunLogInWeb;
  redactedLogEntries: readonly HostedExecutionRedactedLogEntry[] | null | undefined;
  run: HostedExecutionRunContext;
  runToken?: string | null;
  userId: string;
  wakeEventId: string;
}): Promise<void> {
  for (const entry of input.redactedLogEntries ?? []) {
    const eventId = entry.eventId ?? input.wakeEventId;
    await recordHostedRunBreadcrumbInWebBestEffort({
      baseUrl: input.baseUrl,
      callbackSigning: input.callbackSigning,
      component: entry.component,
      level: entry.level,
      message: entry.message,
      phase: entry.phase,
      recordLog: input.recordLog,
      redacted: mergeHostedRunRedactedDetails(
        {
          eventId,
        },
        entry.redacted ?? null,
      ),
      run: input.run,
      runToken: input.runToken,
      userId: input.userId,
      wakeEventId: eventId,
    });
  }
}

function mergeHostedRunRedactedDetails(
  primary: Record<string, unknown> | null | undefined,
  secondary: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const merged = {
    ...(primary ?? {}),
    ...(secondary ?? {}),
  };

  return Object.keys(merged).length > 0 ? merged : null;
}


function createMissingHostedVaultSyncImportError(input: {
  sessionId: string;
  userId: string;
}): Error {
  return new Error(
    `Hosted vault sync import ${input.userId}/${input.sessionId} is missing from the canonical web payload route.`,
  );
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
