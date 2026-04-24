import type {
  HostedExecutionBundleRef,
  HostedBrowserVaultReplicaRef,
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
  HostedRunCleanupTarget,
  HostedRunEventResult,
} from "@murphai/hosted-execution";
import type { GatewayProjectionSnapshot } from "@murphai/gateway-core";
import {
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
import type { HostedExecutionEnvironment } from "../env.js";
import { type HostedUserCryptoContext } from "../user-key-store.js";
import { HostedGatewayProjectionCache } from "../gateway-projection-cache.js";
import {
  HostedExecutionConfigurationError,
  type HostedExecutionContainerNamespaceLike,
  invokeHostedExecutionContainerRunner,
} from "../runner-container.js";
import {
  isHostedBundleArchiveValidationError,
} from "../hosted-bundle-validation.js";
import {
  buildHostedRunnerAmbientEnv,
  buildHostedRunnerContainerEnv,
  buildHostedRunnerJobRuntimeConfig,
  buildHostedRunnerPlatformEnv,
} from "../runner-env.ts";
import {
  summarizeHostedRunnerForwardedEnvLogCategories,
  summarizeHostedRunnerSecretLogCategories,
} from "../hosted-env-policy.ts";
import { type RunnerStateRecord } from "./types.js";
import { RunnerBundleSync } from "./runner-bundle-sync.js";
import { RunnerCleanupService } from "./runner-cleanup.js";
import { RunnerStateStore } from "./runner-state-store.js";
import type { RunnerLeaseOwnerInput } from "./runner-state-store.js";
import { RunnerRuntimeAlarmScheduler } from "./runner-runtime-alarm-scheduler.js";
import { RunnerSecretsService } from "./runner-secrets.js";
import {
  recordHostedRunBreadcrumbInWebBestEffort,
  recordHostedRunPhaseLogInWebBestEffort,
  recordHostedRunnerResultLogsInWebBestEffort,
} from "./runner-web-observability.js";
import { fetchHostedExecutionWebControlPlaneResponse } from "../web-control-plane.ts";

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
  adoptedCleanupTargets?: HostedRunCleanupTarget[];
  adoptedEventResults?: HostedRunEventResult[];
  assistantDeliveryOutcomes?: HostedAssistantDeliveryOutcome[];
  browserVaultReplicaRef?: HostedBrowserVaultReplicaRef | null;
  committedResult?: HostedExecutionRunnerResult | null;
  cursorSnapshotRef: HostedExecutionBundleRef | null;
  finalizeRequired: boolean;
  nextRuntimeWakeAt?: string | null;
  redactedSummary?: Record<string, unknown>;
  state: HostedIngressLifecycleState;
}

const HOSTED_RUN_SIDE_INPUT_NOT_FOUND_CODE = "HOSTED_RUN_SIDE_INPUT_NOT_FOUND";

export type HostedRunSideInputKind = "share-pack" | "vault-sync-import";

export class HostedRunSideInputNotFoundError extends Error {
  readonly code = HOSTED_RUN_SIDE_INPUT_NOT_FOUND_CODE;
  readonly sideInputKind: HostedRunSideInputKind;

  constructor(input: {
    message: string;
    sideInputKind: HostedRunSideInputKind;
  }) {
    super(input.message);
    this.name = "HostedRunSideInputNotFoundError";
    this.sideInputKind = input.sideInputKind;
  }
}

export function isHostedRunSideInputNotFoundError(
  error: unknown,
): error is HostedRunSideInputNotFoundError {
  return error instanceof HostedRunSideInputNotFoundError
    || (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === HOSTED_RUN_SIDE_INPUT_NOT_FOUND_CODE
    );
}

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

interface RunnerRunDrainLifecycleContext {
  currentBundleRef: HostedExecutionBundleRef | null;
  events: HostedRuntimeDrainEvent[];
  leaseOwner: RunnerLeaseOwnerInput;
  run: HostedExecutionRunContext;
  runToken?: string | null;
  wake: HostedIngressEnvelopeProgressRecord;
}

interface RunnerRunDrainLifecyclePolicy {
  failureReason: string;
  handleSuccess(
    runnerResult: HostedAssistantRuntimeJobResult,
    context: RunnerRunDrainLifecycleContext,
  ): Promise<RunnerRunDrainExecutionResult>;
  includeEventCountInFailureBreadcrumb?: boolean;
  messages: {
    backpressuredBreadcrumb: string;
    backpressuredRetry: string;
    failedBreadcrumb: string;
    failedRetry: string;
    start: string;
    startPhase: HostedExecutionRunPhase;
  };
  resumeFinalize: boolean;
}

export class RunnerRunProcessor {
  private readonly cleanupService: RunnerCleanupService;

  constructor(
    private readonly dependencies: RunnerRunProcessorDependencies,
  ) {
    this.cleanupService = new RunnerCleanupService({
      bucket: this.dependencies.bucket,
      clearPendingRunCleanup: (runId) =>
        this.dependencies.stateStore.clearPendingRunCleanup(runId),
      readPendingRunCleanup: (runId) =>
        this.dependencies.stateStore.readPendingRunCleanup(runId),
      readUserCrypto: async (userId) =>
        (await this.dependencies.ensureRunnerStores(userId)).crypto,
      resolveRunnerRuntimeEnv: (userId) => this.resolveRunnerRuntimeEnv(userId),
      writePendingRunCleanup: (runId, cleanup) =>
        this.dependencies.stateStore.writePendingRunCleanup(runId, cleanup),
    });
  }

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

    return this.processRunDrainLifecycle({
      currentBundleRef: input.currentBundleRef,
      events: input.events,
      lifecycle: {
        failureReason: "runner_invocation_failed",
        handleSuccess: (runnerResult, context) =>
          this.handleExecuteRunDrainSuccess(runnerResult, context),
        includeEventCountInFailureBreadcrumb: true,
        messages: {
          backpressuredBreadcrumb:
            "Cloudflare deferred hosted run execution because the runtime is not configured yet.",
          backpressuredRetry:
            "Hosted run drain deferred because the runtime is not configured yet.",
          failedBreadcrumb:
            "Cloudflare runner invocation failed while preparing the hosted run snapshot.",
          failedRetry: "Hosted run drain failed after invoking the runtime.",
          start: "Running hosted run drain from the web-owned run ledger.",
          startPhase: "wake.running",
        },
        resumeFinalize: false,
      },
      messagingActivityOwnedByExecutor: input.messagingActivityOwnedByExecutor,
      primaryWake: input.primaryWake,
      run: input.run,
      runToken: input.runToken,
    });
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
    committedResult?: HostedExecutionRunnerResult | null;
    currentBundleRef: HostedExecutionBundleRef | null;
    primaryWake: HostedRuntimeEvent;
    messagingActivityOwnedByExecutor?: boolean;
    run: HostedRunRecord;
    runToken?: string | null;
  }): Promise<RunnerRunDrainExecutionResult> {
    return this.processRunDrainLifecycle({
      committedResult: input.committedResult ?? null,
      currentBundleRef: input.currentBundleRef,
      events: [],
      lifecycle: {
        failureReason: "runner_finalize_failed",
        handleSuccess: (runnerResult, context) =>
          this.handleFinalizeRunDrainSuccess(runnerResult, context),
        messages: {
          backpressuredBreadcrumb:
            "Cloudflare deferred hosted run finalization because the runtime is not configured yet.",
          backpressuredRetry:
            "Hosted run-drain finalization deferred because the runtime is not configured yet.",
          failedBreadcrumb:
            "Cloudflare runner invocation failed while finalizing the hosted run.",
          failedRetry: "Hosted run-drain finalization failed after invoking the runtime.",
          start: "Finalizing hosted run-drain side effects from the web-visible prepared snapshot.",
          startPhase: "side-effects.draining",
        },
        resumeFinalize: true,
      },
      messagingActivityOwnedByExecutor: input.messagingActivityOwnedByExecutor,
      primaryWake: input.primaryWake,
      run: input.run,
      runToken: input.runToken,
    });
  }

  private async processRunDrainLifecycle(input: {
    committedResult?: HostedExecutionRunnerResult | null;
    currentBundleRef: HostedExecutionBundleRef | null;
    events: HostedRuntimeDrainEvent[];
    lifecycle: RunnerRunDrainLifecyclePolicy;
    messagingActivityOwnedByExecutor?: boolean;
    primaryWake: HostedRuntimeEvent;
    run: HostedRunRecord;
    runToken?: string | null;
  }): Promise<RunnerRunDrainExecutionResult> {
    const userId = input.primaryWake.userId;
    const run = hostedRunRecordToExecutionRunContext(input.run);
    const wake = {
      eventId: hostedRunEventId(input.run.id),
      userId,
    } satisfies HostedIngressEnvelopeProgressRecord;
    const context: RunnerRunDrainLifecycleContext = {
      currentBundleRef: input.currentBundleRef,
      events: input.events,
      leaseOwner: {
        eventId: wake.eventId,
        run,
      },
      run,
      runToken: input.runToken,
      wake,
    };

    await this.dependencies.stateStore.beginRun({
      eventId: wake.eventId,
      run,
      userId,
    });
    await this.advanceRunPhase({
      clearError: true,
      wake,
      message: input.lifecycle.messages.start,
      phase: input.lifecycle.messages.startPhase,
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
          committedResult: input.committedResult ?? null,
          events: input.events,
          resumeFinalize: input.lifecycle.resumeFinalize,
          run: input.run,
        }),
        input.runToken,
        {
          messagingActivityOwnedByExecutor: input.messagingActivityOwnedByExecutor === true,
        },
      );

      return await input.lifecycle.handleSuccess(runnerResult, context);
    } catch (error) {
      if (isHostedBundleArchiveValidationError(error) && error.operation === "runner-input") {
        await this.dependencies.stateStore.completeRun({
          eventId: wake.eventId,
          finishedAt: new Date().toISOString(),
          leaseOwner: context.leaseOwner,
        });
        void recordHostedRunBreadcrumbInWebBestEffort({
          baseUrl: this.dependencies.hostedWebBaseUrl,
          callbackSigning: this.dependencies.env.webCallbackSigning,
          error,
          level: "warn",
          message:
            "Cloudflare quarantined hosted run execution because the authoritative bundle archive is invalid.",
          phase: "quarantined",
          redacted: {
            bundleRefKey: error.refKey,
            reason: "invalid_authoritative_snapshot",
            resumeFinalize: input.lifecycle.resumeFinalize,
          },
          run,
          runToken: input.runToken,
          userId,
          wakeEventId: wake.eventId,
        });
        await this.advanceRunPhase({
          wake,
          error,
          level: "warn",
          message:
            "Hosted run execution quarantined an invalid authoritative snapshot instead of scheduling another retry.",
          phase: "quarantined",
          run,
          runToken: input.runToken,
        });
        return {
          cursorSnapshotRef: input.currentBundleRef,
          finalizeRequired: false,
          redactedSummary: {
            phase: "quarantined",
            reason: "invalid_authoritative_snapshot",
          },
          state: "quarantined",
        };
      }

      await this.dependencies.stateStore.failRun({
        error,
        eventId: wake.eventId,
        leaseOwner: context.leaseOwner,
      });
      const backpressured = error instanceof HostedExecutionConfigurationError;
      void recordHostedRunBreadcrumbInWebBestEffort({
        baseUrl: this.dependencies.hostedWebBaseUrl,
        callbackSigning: this.dependencies.env.webCallbackSigning,
        error,
        level: backpressured ? "warn" : "error",
        message: backpressured
          ? input.lifecycle.messages.backpressuredBreadcrumb
          : input.lifecycle.messages.failedBreadcrumb,
        phase: backpressured ? "runtime_backpressured" : "runtime_failed",
        redacted: mergeHostedRunRedactedDetails(
          {
            ...(input.lifecycle.includeEventCountInFailureBreadcrumb
              ? { eventCount: input.events.length }
              : {}),
            reason: backpressured ? "runtime_not_configured" : input.lifecycle.failureReason,
            resumeFinalize: input.lifecycle.resumeFinalize,
          },
          extractHostedAssistantNotificationRedactedDetails(error),
        ),
        run,
        runToken: input.runToken,
        userId,
        wakeEventId: wake.eventId,
      });
      await this.advanceRunPhase({
        wake,
        error,
        level: backpressured ? "warn" : "error",
        message: backpressured
          ? input.lifecycle.messages.backpressuredRetry
          : input.lifecycle.messages.failedRetry,
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

  private async handleExecuteRunDrainSuccess(
    runnerResult: HostedAssistantRuntimeJobResult,
    context: RunnerRunDrainLifecycleContext,
  ): Promise<RunnerRunDrainExecutionResult> {
    const result = runnerResult.result;
    const assistantDeliveryOutcomes = readRunnerAssistantDeliveryOutcomes(runnerResult);

    if (runnerResult.phase === "prepared") {
      const cursorSnapshotRef = await this.persistCompletedRunnerResult({
        currentBundleRef: context.currentBundleRef,
        eventId: context.wake.eventId,
        finalGatewayProjectionSnapshot: runnerResult.committedGatewayProjectionSnapshot,
        result: runnerResult.result,
        run: context.run,
      });
      void recordHostedRunnerResultLogsInWebBestEffort({
        baseUrl: this.dependencies.hostedWebBaseUrl,
        callbackSigning: this.dependencies.env.webCallbackSigning,
        redactedLogEntries: result.result.redactedLogEntries ?? null,
        run: context.run,
        runToken: context.runToken,
        userId: context.wake.userId,
        wakeEventId: context.wake.eventId,
      });
      void recordHostedRunBreadcrumbInWebBestEffort({
        baseUrl: this.dependencies.hostedWebBaseUrl,
        callbackSigning: this.dependencies.env.webCallbackSigning,
        message: "Cloudflare prepared a hosted run snapshot for commit.",
        phase: "runner_prepared_snapshot",
        redacted: {
          assistantDeliveryEffectCount: runnerResult.committedAssistantDeliveryEffects.length,
          eventCount: context.events.length,
          nextRuntimeWakeScheduled: result.result.nextWakeAt !== null,
        },
        run: context.run,
        runToken: context.runToken,
        userId: context.wake.userId,
        wakeEventId: context.wake.eventId,
      });
      await this.advanceRunPhase({
        clearError: true,
        wake: context.wake,
        message: "Hosted run drain prepared a snapshot and is awaiting web commit.",
        phase: "commit.recorded",
        run: context.run,
        runToken: context.runToken,
      });
      await this.dependencies.stateStore.completeRun({
        eventId: context.wake.eventId,
        finishedAt: new Date().toISOString(),
        leaseOwner: context.leaseOwner,
      });
      return {
        ...(result.result.adoptedCleanupTargets && result.result.adoptedCleanupTargets.length > 0
          ? { adoptedCleanupTargets: result.result.adoptedCleanupTargets }
          : {}),
        ...(result.result.adoptedEventResults && result.result.adoptedEventResults.length > 0
          ? { adoptedEventResults: result.result.adoptedEventResults }
          : {}),
        ...(assistantDeliveryOutcomes
          ? {
              assistantDeliveryOutcomes,
            }
          : {}),
        committedResult: runnerResult.result,
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
      currentBundleRef: context.currentBundleRef,
      eventId: context.wake.eventId,
      finalGatewayProjectionSnapshot: runnerResult.finalGatewayProjectionSnapshot,
      result: runnerResult.result,
      run: context.run,
    });
    void recordHostedRunnerResultLogsInWebBestEffort({
      baseUrl: this.dependencies.hostedWebBaseUrl,
      callbackSigning: this.dependencies.env.webCallbackSigning,
      redactedLogEntries: result.result.redactedLogEntries ?? null,
      run: context.run,
      runToken: context.runToken,
      userId: context.wake.userId,
      wakeEventId: context.wake.eventId,
    });
    const browserVaultReplicaRef = await this.persistBrowserVaultReplicaBestEffort(
      context.wake.userId,
      runnerResult.browserVaultReplica ?? null,
    );
    await this.dependencies.stateStore.completeRun({
      eventId: context.wake.eventId,
      finishedAt: new Date().toISOString(),
      leaseOwner: context.leaseOwner,
    });
    return {
      ...(result.result.adoptedCleanupTargets && result.result.adoptedCleanupTargets.length > 0
        ? { adoptedCleanupTargets: result.result.adoptedCleanupTargets }
        : {}),
      ...(result.result.adoptedEventResults && result.result.adoptedEventResults.length > 0
        ? { adoptedEventResults: result.result.adoptedEventResults }
        : {}),
      ...(assistantDeliveryOutcomes
        ? {
            assistantDeliveryOutcomes,
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
  }

  private async handleFinalizeRunDrainSuccess(
    runnerResult: HostedAssistantRuntimeJobResult,
    context: RunnerRunDrainLifecycleContext,
  ): Promise<RunnerRunDrainExecutionResult> {
    if (!isCompletedRunnerResult(runnerResult)) {
      throw new Error("Hosted run-drain finalization returned a duplicate committed result.");
    }
    const assistantDeliveryOutcomes = readRunnerAssistantDeliveryOutcomes(runnerResult);

    const cursorSnapshotRef = await this.persistCompletedRunnerResult({
      currentBundleRef: context.currentBundleRef,
      eventId: context.wake.eventId,
      finalGatewayProjectionSnapshot: runnerResult.finalGatewayProjectionSnapshot,
      result: runnerResult.result,
      run: context.run,
    });
    const browserVaultReplicaRef = await this.persistBrowserVaultReplicaBestEffort(
      context.wake.userId,
      runnerResult.browserVaultReplica ?? null,
    );
    await this.dependencies.stateStore.completeRun({
      eventId: context.wake.eventId,
      finishedAt: new Date().toISOString(),
      leaseOwner: context.leaseOwner,
    });
    await this.advanceRunPhase({
      clearError: true,
      wake: context.wake,
      message: "Hosted run drain finalized committed side effects.",
      phase: "completed",
      run: context.run,
      runToken: context.runToken,
    });

    return {
      ...(assistantDeliveryOutcomes
        ? {
            assistantDeliveryOutcomes,
          }
        : {}),
      browserVaultReplicaRef,
      cursorSnapshotRef,
      finalizeRequired: false,
      nextRuntimeWakeAt: runnerResult.result.result.nextWakeAt,
      redactedSummary: buildRunnerRedactedSummary({
        ...summarizeHostedAssistantDeliveryOutcomes(assistantDeliveryOutcomes),
        eventsHandled: runnerResult.result.result.eventsHandled,
        phase: "finalized",
        redactedDetails: runnerResult.result.result.redactedDetails ?? null,
        summary: runnerResult.result.result.summary,
      }),
      state: "completed",
    };
  }

  async cleanupTransientWakeDataBestEffortForRunDrain(input: {
    cleanupTargets?: readonly HostedRunCleanupTarget[] | null;
    assistantDeliveryOutcomes?: readonly HostedAssistantDeliveryOutcome[] | null;
    runId?: string | null;
    userId?: string | null;
    wakes: readonly HostedIngressEnvelope[];
  }): Promise<void> {
    await this.cleanupService.cleanupTransientWakeDataBestEffortForRunDrain(input);
  }

  async persistPendingRunCleanupData(input: {
    assistantDeliveryOutcomes?: readonly HostedAssistantDeliveryOutcome[] | null;
    cleanupTargets?: readonly HostedRunCleanupTarget[] | null;
    committedResult?: HostedExecutionRunnerResult | null;
    runId: string;
    wakes: readonly HostedIngressEnvelope[];
  }): Promise<void> {
    await this.cleanupService.persistPendingRunCleanupData({
      ...input,
      committedResult: input.committedResult ?? null,
    });
  }

  private async resolveRunnerRuntimeEnv(
    userId: string | null,
  ): Promise<Record<string, string>> {
    const forwardedEnv = buildHostedRunnerAmbientEnv(
      this.dependencies.runnerRuntimeEnvSource,
    );

    if (!userId) {
      return {
        ...forwardedEnv,
        ...buildHostedRunnerPlatformEnv(this.dependencies.runnerRuntimeEnvSource),
      };
    }
    const { runnerSecrets: runnerSecretsService } = await this.dependencies.ensureRunnerStores(
      userId,
    );
    const runnerSecrets = await runnerSecretsService.readRunnerSecrets(userId);
    const runtimeConfig = buildHostedRunnerJobRuntimeConfig({
      configSource: this.dependencies.readRunnerRuntimeConfigSource(),
      forwardedEnv,
      runnerSecrets,
    });

    return {
      ...(runtimeConfig.forwardedEnv ?? {}),
      ...(runtimeConfig.userEnv ?? {}),
      ...(runtimeConfig.platformEnv ?? {}),
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
      rewritePlatformUrlsForContainer: true,
      runnerSecrets,
    });
    const job: HostedAssistantRuntimeJobInput = {
      request: {
        bundle: await bundleSync.readBundlesForRunner(currentBundleRef, userId),
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
  committedResult?: HostedExecutionRunnerResult | null;
  events: HostedRuntimeDrainEvent[];
  resumeFinalize: boolean;
  run: HostedRunRecord;
}): HostedRuntimeDrainRequest {
  return {
    acquiredAt: input.run.acquiredAt,
    events: input.resumeFinalize ? [] : input.events,
    inputCommittedSeq: input.run.inputCommittedSeq,
    inputCursorVersion: input.run.inputCursorVersion,
    ...(input.resumeFinalize && input.committedResult
      ? { committedResult: input.committedResult }
      : {}),
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

function readRunnerAssistantDeliveryOutcomes(
  result: HostedAssistantRuntimeJobResult,
): HostedAssistantDeliveryOutcome[] | undefined {
  if (
    "assistantDeliveryOutcomes" in result
    && Array.isArray(result.assistantDeliveryOutcomes)
    && result.assistantDeliveryOutcomes.length > 0
  ) {
    return result.assistantDeliveryOutcomes;
  }

  return undefined;
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
      assistantDeliveryFirstNonSentStatus: nonSent.deliveryStatus,
    } : {}),
  };
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
export {
  recordHostedRunBreadcrumbInWebBestEffort,
  recordHostedRunPhaseLogInWebBestEffort,
  recordHostedRunnerResultLogsInWebBestEffort,
};

function createMissingHostedVaultSyncImportError(input: {
  sessionId: string;
  userId: string;
}): HostedRunSideInputNotFoundError {
  return new HostedRunSideInputNotFoundError({
    message:
      `Hosted vault sync import ${input.userId}/${input.sessionId} is missing from the canonical web payload route.`,
    sideInputKind: "vault-sync-import",
  });
}

function createMissingHostedSharePackError(input: {
  ownerUserId: string;
  shareId: string;
}): HostedRunSideInputNotFoundError {
  return new HostedRunSideInputNotFoundError({
    message:
      `Hosted share payload ${input.ownerUserId}/${input.shareId} is missing from the canonical web payload route.`,
    sideInputKind: "share-pack",
  });
}
