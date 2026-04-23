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
  deleteHostedLinqMessages,
  deleteHostedTelegramMessages,
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
  buildHostedRunnerAmbientEnv,
  buildHostedRunnerContainerEnv,
  buildHostedRunnerJobRuntimeConfig,
} from "../runner-env.ts";
import {
  summarizeHostedRunnerForwardedEnvLogCategories,
  summarizeHostedRunnerSecretLogCategories,
} from "../hosted-env-policy.ts";
import {
  type RunnerPendingCleanupState,
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
  assistantDeliveryOutcomes?: HostedAssistantDeliveryOutcome[];
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
        ...(runnerResult.assistantDeliveryOutcomes && runnerResult.assistantDeliveryOutcomes.length > 0
          ? {
              assistantDeliveryOutcomes: runnerResult.assistantDeliveryOutcomes,
            }
          : {}),
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
      const runtimeEnv = await this.resolveRunnerRuntimeEnv(input.run.userId);

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
        ...(runnerResult.assistantDeliveryOutcomes && runnerResult.assistantDeliveryOutcomes.length > 0
          ? {
              assistantDeliveryOutcomes: runnerResult.assistantDeliveryOutcomes,
            }
          : {}),
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

  async cleanupTransientWakeDataBestEffortForRunDrain(input: {
    assistantDeliveryOutcomes?: readonly HostedAssistantDeliveryOutcome[] | null;
    runId?: string | null;
    userId?: string | null;
    wakes: readonly HostedIngressEnvelope[];
  }): Promise<void> {
    let pendingCleanup: RunnerPendingCleanupState | null = null;
    let canClearPendingCleanup = input.runId == null;
    if (input.runId) {
      try {
        pendingCleanup = await this.dependencies.stateStore.readPendingRunCleanup(input.runId);
        canClearPendingCleanup = true;
      } catch (error) {
        emitHostedExecutionStructuredLog({
          component: "runner",
          details: {
            runId: input.runId,
          },
          error,
          eventId: input.wakes[0]?.eventId ?? "hosted-run:cleanup",
          level: "warn",
          message: "Hosted pending cleanup sidecar read failed; continuing with in-memory cleanup inputs only.",
          phase: "completed",
          run: null,
          userId: input.userId ?? input.wakes[0]?.userId ?? "unknown",
        });
      }
    }
    if (
      input.wakes.length === 0
      && (!input.assistantDeliveryOutcomes || input.assistantDeliveryOutcomes.length === 0)
      && !pendingCleanup
    ) {
      return;
    }

    for (const wake of input.wakes) {
      await this.deleteTransientWakeDataBestEffort(wake);
    }
    for (const emailMessage of pendingCleanup?.emailMessages ?? []) {
      await this.deletePendingEmailCleanupBestEffort(emailMessage);
    }

    await this.deleteHostedLinqMessagesBestEffort({
      assistantDeliveryOutcomes: input.assistantDeliveryOutcomes ?? [],
      pendingCleanup,
      userId: input.userId ?? null,
      wakes: input.wakes,
    });
    await this.deleteHostedTelegramMessagesBestEffort({
      assistantDeliveryOutcomes: input.assistantDeliveryOutcomes ?? [],
      pendingCleanup,
      userId: input.userId ?? null,
      wakes: input.wakes,
    });

    if (input.runId && canClearPendingCleanup) {
      try {
        await this.dependencies.stateStore.clearPendingRunCleanup(input.runId);
      } catch (error) {
        emitHostedExecutionStructuredLog({
          component: "runner",
          details: {
            runId: input.runId,
          },
          error,
          eventId: input.wakes[0]?.eventId ?? "hosted-run:cleanup",
          level: "warn",
          message: "Hosted pending cleanup sidecar clear failed; continuing after best-effort cleanup.",
          phase: "completed",
          run: null,
          userId: input.userId ?? input.wakes[0]?.userId ?? "unknown",
        });
      }
    }
  }

  async persistPendingRunCleanupData(input: {
    runId: string;
    wakes: readonly HostedIngressEnvelope[];
  }): Promise<void> {
    await this.dependencies.stateStore.writePendingRunCleanup(
      input.runId,
      buildRunnerPendingCleanupState(input.wakes),
    );
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

  private async deletePendingEmailCleanupBestEffort(input: {
    eventId: string;
    rawMessageKey: string;
    userId: string;
  }): Promise<void> {
    try {
      const { crypto } = await this.dependencies.ensureRunnerStores(input.userId);
      await deleteHostedEmailRawMessage({
        bucket: this.dependencies.bucket,
        key: crypto.rootKey,
        keysById: crypto.keysById,
        rawMessageKey: input.rawMessageKey,
        userId: input.userId,
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          rawMessageKey: input.rawMessageKey,
          wakeChannel: "email",
          wakeKind: "conversation.message",
        },
        error,
        eventId: input.eventId,
        level: "warn",
        message: "Hosted wake best-effort raw email cleanup failed; the durable raw message object may need manual cleanup.",
        phase: "completed",
        run: null,
        userId: input.userId,
      });
    }
  }

  private async deleteHostedLinqMessagesBestEffort(input: {
    assistantDeliveryOutcomes: readonly HostedAssistantDeliveryOutcome[];
    pendingCleanup: RunnerPendingCleanupState | null;
    userId: string | null;
    wakes: readonly HostedIngressEnvelope[];
  }): Promise<void> {
    const messageIds = new Set<string>();

    for (const wake of input.wakes) {
      if (wake.kind === "conversation.message" && wake.message.channel === "linq") {
        messageIds.add(wake.message.linqMessage.messageId);
      }
    }
    for (const messageId of input.pendingCleanup?.linqMessageIds ?? []) {
      messageIds.add(messageId);
    }

    for (const outcome of input.assistantDeliveryOutcomes) {
      if (!shouldUseHostedDeliveryOutcomeForCleanup(outcome, "linq")) {
        continue;
      }

      for (const messageId of readHostedProviderMessageIds(outcome)) {
        messageIds.add(messageId);
      }
    }

    if (messageIds.size === 0) {
      return;
    }

    const firstWake = input.wakes[0];
    const cleanupUserId = firstWake?.userId ?? input.userId ?? null;
    try {
      const runtimeEnv = await this.resolveRunnerRuntimeEnv(cleanupUserId);
      await deleteHostedLinqMessages({
        env: runtimeEnv,
        messageIds: [...messageIds],
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          messageIdCount: messageIds.size,
          provider: "linq",
        },
        error,
        eventId: firstWake?.eventId ?? "hosted-run:cleanup",
        level: "warn",
        message: "Hosted Linq message cleanup failed; the provider copy may need manual deletion.",
        phase: "completed",
        run: null,
        userId: cleanupUserId ?? "unknown",
      });
    }
  }

  private async deleteHostedTelegramMessagesBestEffort(input: {
    assistantDeliveryOutcomes: readonly HostedAssistantDeliveryOutcome[];
    pendingCleanup: RunnerPendingCleanupState | null;
    userId: string | null;
    wakes: readonly HostedIngressEnvelope[];
  }): Promise<void> {
    const groupedMessageIds = new Map<string, Set<string>>();
    const cleanupTargetAliases = buildHostedTelegramCleanupTargetAliasMap(
      input.assistantDeliveryOutcomes,
    );
    const cleanupWakeMessages: Array<{ messageId: string; target: string }> = [];
    const persistedCleanupMessages = [...(input.pendingCleanup?.telegramMessages ?? [])];

    for (const wake of input.wakes) {
      if (wake.kind !== "conversation.message" || wake.message.channel !== "telegram") {
        continue;
      }

      cleanupWakeMessages.push({
        messageId: wake.message.telegramMessage.messageId,
        target: wake.message.telegramMessage.threadId,
      });
    }

    for (const message of cleanupWakeMessages) {
      addHostedProviderMessageId(
        groupedMessageIds,
        resolveHostedTelegramCleanupTarget(message.target, cleanupTargetAliases),
        message.messageId,
      );
    }
    for (const message of persistedCleanupMessages) {
      addHostedProviderMessageId(
        groupedMessageIds,
        resolveHostedTelegramCleanupTarget(message.target, cleanupTargetAliases),
        message.messageId,
      );
    }

    for (const outcome of input.assistantDeliveryOutcomes) {
      if (!isHostedTelegramCleanupTargetOutcome(outcome)) {
        continue;
      }

      for (const cleanupMessage of readHostedCleanupMessages(outcome)) {
        addHostedProviderMessageId(
          groupedMessageIds,
          cleanupMessage.target,
          cleanupMessage.messageId,
        );
      }
    }

    if (groupedMessageIds.size === 0) {
      return;
    }

    const firstWake = input.wakes[0];
    const cleanupUserId = firstWake?.userId ?? input.userId ?? null;
    try {
      const runtimeEnv = await this.resolveRunnerRuntimeEnv(cleanupUserId);
      for (const [target, messageIds] of groupedMessageIds) {
        try {
          await deleteHostedTelegramMessages({
            env: runtimeEnv,
            messageIds: [...messageIds],
            target,
          });
        } catch (error) {
          emitHostedExecutionStructuredLog({
            component: "runner",
            details: {
              messageIdCount: messageIds.size,
              provider: "telegram",
              target,
            },
            error,
            eventId: firstWake?.eventId ?? "hosted-run:cleanup",
            level: "warn",
            message: "Hosted Telegram message cleanup failed; the provider copy may need manual deletion.",
            phase: "completed",
            run: null,
            userId: cleanupUserId ?? "unknown",
          });
        }
      }
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          provider: "telegram",
          targetCount: groupedMessageIds.size,
        },
        error,
        eventId: firstWake?.eventId ?? "hosted-run:cleanup",
        level: "warn",
        message: "Hosted Telegram cleanup environment resolution failed; the provider copies may need manual deletion.",
        phase: "completed",
        run: null,
        userId: cleanupUserId ?? "unknown",
      });
    }
  }

  private async resolveRunnerRuntimeEnv(
    userId: string | null,
  ): Promise<Record<string, string>> {
    if (!userId) {
      return {
        ...buildHostedRunnerAmbientEnv(this.dependencies.runnerRuntimeEnvSource),
      };
    }
    const { runnerSecrets: runnerSecretsService } = await this.dependencies.ensureRunnerStores(
      userId,
    );
    const runnerSecrets = await runnerSecretsService.readRunnerSecrets(userId);
    const forwardedEnv = buildHostedRunnerAmbientEnv(
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

  private async resolveRunnerMessagingActivityRuntimeEnv(
    userId: string,
  ): Promise<Record<string, string>> {
    return this.resolveRunnerRuntimeEnv(userId);
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

function readHostedProviderMessageIds(
  outcome: HostedAssistantDeliveryOutcome,
): string[] {
  if (Array.isArray(outcome.providerMessageIds) && outcome.providerMessageIds.length > 0) {
    return outcome.providerMessageIds;
  }

  return outcome.providerMessageId ? [outcome.providerMessageId] : [];
}

function readHostedCleanupTargetAliases(
  outcome: HostedAssistantDeliveryOutcome,
): string[] {
  if (!Array.isArray(outcome.cleanupTargetAliases) || outcome.cleanupTargetAliases.length === 0) {
    return [];
  }

  return Array.from(
    new Set(
      outcome.cleanupTargetAliases
        .map((value) => typeof value === "string" ? value.trim() : "")
        .filter((value) => value.length > 0),
    ),
  );
}

function readHostedCleanupMessages(
  outcome: HostedAssistantDeliveryOutcome,
): Array<{ messageId: string; target: string }> {
  if (Array.isArray(outcome.cleanupMessages) && outcome.cleanupMessages.length > 0) {
    return Array.from(
      new Map(
        outcome.cleanupMessages.flatMap((entry) => {
          if (!entry || typeof entry !== "object") {
            return [];
          }

          const messageId =
            "messageId" in entry && typeof entry.messageId === "string"
              ? entry.messageId.trim()
              : "";
          const target =
            "target" in entry && typeof entry.target === "string"
              ? entry.target.trim()
              : "";
          if (messageId.length === 0 || target.length === 0) {
            return [];
          }

          return [[`${target}\u0000${messageId}`, { messageId, target }] as const];
        }),
      ).values(),
    );
  }

  if (typeof outcome.target !== "string" || outcome.target.length === 0) {
    return [];
  }

  const target = outcome.target;
  return readHostedProviderMessageIds(outcome).map((messageId) => ({
    messageId,
    target,
  }));
}

function addHostedProviderMessageId(
  groupedMessageIds: Map<string, Set<string>>,
  target: string,
  messageId: string,
): void {
  const bucket = groupedMessageIds.get(target) ?? new Set<string>();
  bucket.add(messageId);
  groupedMessageIds.set(target, bucket);
}

function shouldUseHostedDeliveryOutcomeForCleanup(
  outcome: HostedAssistantDeliveryOutcome,
  channel: string,
): boolean {
  return outcome.deliveryChannel === channel
    && (outcome.deliveryStatus === "sent" || outcome.deliveryStatus === "failed_ambiguous")
    && readHostedProviderMessageIds(outcome).length > 0;
}

function isHostedTelegramCleanupTargetOutcome(
  outcome: HostedAssistantDeliveryOutcome,
): outcome is HostedAssistantDeliveryOutcome & { target: string } {
  return outcome.deliveryChannel === "telegram"
    && (outcome.deliveryStatus === "sent" || outcome.deliveryStatus === "failed_ambiguous")
    && typeof outcome.target === "string"
    && outcome.target.length > 0;
}

function buildRunnerPendingCleanupState(
  wakes: readonly HostedIngressEnvelope[],
): RunnerPendingCleanupState | null {
  const cleanup: RunnerPendingCleanupState = {
    emailMessages: [],
    linqMessageIds: [],
    telegramMessages: [],
  };

  for (const wake of wakes) {
    if (wake.kind !== "conversation.message") {
      continue;
    }

    switch (wake.message.channel) {
      case "email":
        cleanup.emailMessages.push({
          eventId: wake.eventId,
          rawMessageKey: wake.message.rawMessageKey,
          userId: wake.userId,
        });
        break;
      case "linq":
        cleanup.linqMessageIds.push(wake.message.linqMessage.messageId);
        break;
      case "telegram":
        cleanup.telegramMessages.push({
          messageId: wake.message.telegramMessage.messageId,
          target: wake.message.telegramMessage.threadId,
        });
        break;
      default:
        break;
    }
  }

  return cleanup.emailMessages.length > 0
    || cleanup.linqMessageIds.length > 0
    || cleanup.telegramMessages.length > 0
    ? cleanup
    : null;
}

function resolveHostedTelegramCleanupTarget(
  target: string,
  cleanupTargetAliases: ReadonlyMap<string, string | null>,
): string {
  const replacement = cleanupTargetAliases.get(target);
  return replacement ?? target;
}

function buildHostedTelegramCleanupTargetAliasMap(
  outcomes: readonly HostedAssistantDeliveryOutcome[],
): Map<string, string | null> {
  const aliases = new Map<string, string | null>();

  for (const outcome of outcomes) {
    if (!shouldUseHostedDeliveryOutcomeForCleanup(outcome, "telegram")) {
      continue;
    }

    if (typeof outcome.target !== "string" || outcome.target.length === 0) {
      continue;
    }

    for (const alias of readHostedCleanupTargetAliases(outcome)) {
      if (alias === outcome.target) {
        continue;
      }

      const existing = aliases.get(alias);
      if (existing === undefined) {
        aliases.set(alias, outcome.target);
        continue;
      }

      if (existing !== outcome.target) {
        aliases.set(alias, null);
      }
    }
  }

  return aliases;
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
  return recordHostedRunBreadcrumbInWebBestEffort(input);
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
  // Keep web-visible observability linkable without persisting canonical wake ids.
  const correlationId = await createHostedRunLogCorrelationId(input.wakeEventId);
  const redacted = {
    ...(stripHostedRunObservabilityEventFields(input.redacted) ?? {}),
    correlationId,
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
        runLogCorrelationId: correlationId,
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
      redacted: entry.redacted ?? null,
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

function stripHostedRunObservabilityEventFields(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  const { correlationId: _ignoredCorrelationId, eventId: _ignoredEventId, ...rest } = value;
  return Object.keys(rest).length > 0 ? rest : null;
}

async function createHostedRunLogCorrelationId(eventId: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`hosted-run-log:${eventId}`),
    ),
  );

  return `evtcorr_${bytesToHex(digest.subarray(0, 16))}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
