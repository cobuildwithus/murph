import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import type {
  CloudflareHostedControlRuntimeShellPrewarmSource,
} from "@murphai/cloudflare-hosted-control/client";
import type {
  HostedRuntimeEnsureProcessingRequest,
  HostedRuntimeEnsureProcessingResponse,
} from "@murphai/hosted-execution/orchestration-control";
import {
  type HostedRuntimeLatencyPhaseBreakdown,
  type HostedRuntimeShellPrewarmOrchestrationDiagnostics,
  isHostedRuntimeDirectEnsureOrchestrationAttemptId,
} from "@murphai/hosted-execution/runtime-control";

import type { HostedExecutionEnvironment } from "../env.js";
import type {
  WorkerAnalyticsEngineDatasetLike,
} from "../worker-contracts.js";
import {
  destroyHostedExecutionContainer,
  RUNNER_CONTAINER_STARTUP_FAILURE_ELAPSED_MAX_MS,
  type HostedExecutionContainerNamespaceLike,
  type RunnerContainerColdStartTiming,
  type RunnerContainerShellPrewarmObservation,
  type RunnerContainerStartupFailureStage,
} from "../runner-container.js";
import {
  HOSTED_WORKSPACE_SNAPSHOT_HANDOFF_HEARTBEAT_STALE_MS,
} from "../workspace-snapshot-store.ts";
import {
  readHostedRunnerContainerIdentity,
  resolveHostedExecutionRunnerContainerName,
} from "../hosted-runner-container-identity.js";
import {
  HOSTED_STANDBY_CLAIM_TIMEOUT_MS,
  HOSTED_STANDBY_LOCATION_HINT,
  HOSTED_STANDBY_REGION,
  createHostedStandbyClaimId,
  isHostedStandbySlotName,
  readHostedStandbyMode,
  readHostedStandbyReleaseId,
  readHostedStandbySlotReleaseId,
  resolveHostedStandbyCoordinatorName,
  type HostedStandbyCoordinatorNamespaceLike,
  type HostedStandbyRunnerContainerNamespaceLike,
} from "../standby-runner-contract.js";
import {
  buildHostedRunnerMetadataOnlyErrorDetails,
  buildRunnerRecordTimingLogDetails,
  classifyRuntimeStartFailureRetryReason,
  mapRunnerProcessingRetryReason,
  type RuntimeProcessingRetryAttribution,
  type RuntimeProcessingRetryReason,
  type RuntimeProcessingStartFailureRetryReason,
} from "./diagnostics.js";
import {
  RUNTIME_PROCESSING_COMMAND_BUDGET_TIMEOUT_MESSAGE,
  createRuntimeProcessingCommandBudget,
  isRuntimeProcessingCommandBudgetTimeout,
  readRuntimeProcessingCommandStepTimeoutMs,
  runRuntimeProcessingCommandStep,
  type RuntimeProcessingCommandBudget,
} from "./runtime-command-budget.js";
import {
  readRuntimeFenceLivenessBestEffort,
  type RuntimeFenceLivenessReadResult,
} from "./runtime-fence-liveness.js";
import {
  ensureActiveRuntimeProcessing,
  readActiveRuntimeRunnerContainerName,
} from "./runtime-container-wake.js";
import {
  computeRuntimeProcessingOwnerRecheckAt as computeRuntimeProcessingOwnerRecheckAtValue,
  computeRuntimeProcessingRetryAt as computeRuntimeProcessingRetryAtValue,
  createRuntimeProcessingRetryLater as createRuntimeProcessingRetryLaterResponse,
} from "./runtime-processing-responses.js";
import {
  RuntimeInvocationService,
  type PreparedRuntimeInvocation,
  type RuntimeInvocationInput,
} from "./runtime-invocation.js";
import {
  RunnerWriteFenceAlreadyActiveError,
  runnerWriteFenceIdentityMatches,
  runnerWriteFenceTokensMatch,
  type RunnerStateStore,
  type RunnerWriteFenceToken,
} from "./runner-state-store.js";
import type {
  RunnerRuntimeProcessingMode,
  RunnerStateRecord,
} from "./types.js";

const RUNTIME_SHELL_PREWARM_TIMEOUT_MS = 20_000;
const RUNTIME_PROCESSING_STARTUP_GRACE_MS = 30_000;
// Readiness may trigger a fail-closed container stop. Reserve the container's
// bounded 5s stop settlement plus a 1s caller-side guard before the 25s direct
// command budget expires.
const RUNTIME_PROCESSING_STARTUP_CONFIRM_TIMEOUT_MS = 15_000;
const RUNTIME_PROCESSING_STARTUP_CLEANUP_SETTLEMENT_MS = 5_000;
const RUNTIME_PROCESSING_STARTUP_OUTER_GUARD_MS = 1_000;
const RUNTIME_PROCESSING_STARTUP_STEP_TIMEOUT_MS =
  RUNTIME_PROCESSING_STARTUP_CONFIRM_TIMEOUT_MS
  + RUNTIME_PROCESSING_STARTUP_CLEANUP_SETTLEMENT_MS
  + RUNTIME_PROCESSING_STARTUP_OUTER_GUARD_MS;

export type RuntimeProcessingInput = HostedRuntimeEnsureProcessingRequest & {
  commandStartedAtEpochMs?: number;
  commandTimeoutMs?: number;
  orchestration?: RuntimeProcessingOrchestrationDiagnostics | null;
  userId: string;
};

export interface RuntimeHealthDataConsentStopResult {
  activeInvocationPreempted: boolean;
  runnerContainerDestroyAttempted: boolean;
  runnerContainerDestroyOk: boolean;
}

type RuntimeProcessingOrchestrationDiagnostics = NonNullable<
  HostedRuntimeLatencyPhaseBreakdown["orchestration"]
>;

type RuntimeStartupCallerFailureStage = Extract<
  RunnerContainerStartupFailureStage,
  "caller_deadline" | "rpc_unattributed"
>;

type FreshRuntimeStartPreparation =
  | {
      containerReadyAtEpochMs: number | null;
      kind: "ready";
      prepared: PreparedRuntimeInvocation;
      preparedAtEpochMs: number;
      runtimePreparationWaitAfterContainerReadyMs: number;
      startupOrchestration: RuntimeProcessingOrchestrationDiagnostics | null;
      shellPrewarmOrchestration: RuntimeProcessingOrchestrationDiagnostics | null;
    }
  | {
      kind: "retry";
      response: HostedRuntimeEnsureProcessingResponse;
    };

type FreshRunnerContainerResolution =
  | {
      kind: "ready";
      runnerContainerName: string;
      standbyAllocationOutcome:
        | "claimed"
        | "disabled"
        | "fallback"
        | "retained";
    }
  | {
      kind: "retry";
      response: HostedRuntimeEnsureProcessingResponse;
    };

function toRuntimeInvocationInput(input: RuntimeProcessingInput): RuntimeInvocationInput {
  return {
    ...(input.assistantExecutionBlocked
      ? { assistantExecutionBlocked: true as const }
      : {}),
    ...(input.orchestration ? { orchestration: input.orchestration } : {}),
    orchestrationAttemptId: input.orchestrationAttemptId,
    ...(input.processingMode ? { processingMode: input.processingMode } : {}),
    userId: input.userId,
  };
}

function withRuntimeProcessingOrchestration(
  input: RuntimeProcessingInput,
  orchestration: RuntimeProcessingOrchestrationDiagnostics,
): RuntimeProcessingInput {
  return {
    ...input,
    orchestration: {
      ...(input.orchestration ?? {}),
      ...orchestration,
    },
  };
}

function toShellPrewarmOrchestrationDiagnostics(
  observation: RunnerContainerShellPrewarmObservation | undefined,
): RuntimeProcessingOrchestrationDiagnostics | null {
  if (!observation) {
    return null;
  }
  return {
    ...(observation.orchestration ?? {}),
    shellPrewarmFirstHintAtEpochMs: observation.firstHintAtEpochMs,
    shellPrewarmHintCount: observation.hintCount,
    ...(observation.finishedAtEpochMs === undefined ? {} : {
      shellPrewarmFinishedAtEpochMs: observation.finishedAtEpochMs,
    }),
    ...(observation.operationElapsedMs === undefined ? {} : {
      shellPrewarmOperationElapsedMs: observation.operationElapsedMs,
    }),
    ...(observation.outcome === undefined ? {} : {
      shellPrewarmOutcome: observation.outcome,
    }),
    shellPrewarmSource: observation.source,
  };
}

function toContainerColdStartOrchestrationDiagnostics(
  timing: RunnerContainerColdStartTiming | undefined,
): RuntimeProcessingOrchestrationDiagnostics | null {
  if (!timing) {
    return null;
  }
  return {
    freshStartContainerReadinessRequestedAtEpochMs:
      timing.readinessRequestedAtEpochMs,
    freshStartContainerLifecycleLockAcquiredAtEpochMs:
      timing.lifecycleLockAcquiredAtEpochMs,
    freshStartContainerStateReadFinishedAtEpochMs:
      timing.stateReadFinishedAtEpochMs,
    freshStartContainerStartIssuedAtEpochMs: timing.startIssuedAtEpochMs,
    ...(timing.onStartAtEpochMs === undefined ? {} : {
      freshStartContainerOnStartAtEpochMs: timing.onStartAtEpochMs,
    }),
    freshStartContainerPortsReadyAtEpochMs: timing.portsReadyAtEpochMs,
    freshStartContainerHealthStartedAtEpochMs:
      timing.healthCheckStartedAtEpochMs,
    freshStartContainerHealthFinishedAtEpochMs:
      timing.healthCheckFinishedAtEpochMs,
    ...(timing.processStartedAtEpochMs === undefined ? {} : {
      freshStartContainerProcessStartedAtEpochMs:
        timing.processStartedAtEpochMs,
    }),
    ...(timing.serverListeningAtEpochMs === undefined ? {} : {
      freshStartContainerListeningAtEpochMs:
        timing.serverListeningAtEpochMs,
    }),
    freshStartContainerReadyObservedAtEpochMs:
      timing.readyObservedAtEpochMs,
  };
}

function withoutSupersededRuntimeFenceDiagnostics(
  input: RuntimeProcessingInput,
): RuntimeProcessingInput {
  if (!input.orchestration) {
    return input;
  }

  const orchestration = { ...input.orchestration };
  delete orchestration.activeFenceObservedAtEpochMs;
  delete orchestration.activeFenceTargetWasPriorVersion;
  delete orchestration.activeWakeAccepted;
  delete orchestration.activeWakeElapsedMs;
  delete orchestration.activeWakeFinishedAtEpochMs;
  delete orchestration.activeWakeFoundNoActiveChild;
  delete orchestration.activeWakeStartedAtEpochMs;
  delete orchestration.replacedStaleFence;
  delete orchestration.replacementFenceClearElapsedMs;
  delete orchestration.replacementFenceClearedAtEpochMs;
  delete orchestration.replacementFenceClearStartedAtEpochMs;
  return {
    ...input,
    orchestration,
  };
}

export class RuntimeProcessingController {
  constructor(
    private readonly input: {
      env: HostedExecutionEnvironment;
      invocationService: RuntimeInvocationService;
      runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
      readCheckpointHandoff?: (input: {
        attemptId: string;
        leaseGeneration: string;
        userId: string;
      }) => Promise<{
        completedAt: string | null;
        heartbeatAt: string;
      } | null>;
      runnerRuntimeEnvSource: Readonly<Record<string, unknown>>;
      runtimeRetryAnalytics?: WorkerAnalyticsEngineDatasetLike | null;
      standbyContainerNamespace?: HostedStandbyRunnerContainerNamespaceLike | null;
      standbyCoordinatorNamespace?: HostedStandbyCoordinatorNamespaceLike | null;
      stateStore: RunnerStateStore;
    },
  ) {}

  private createRetryLater(
    input: RuntimeProcessingRetryAttribution & {
      orchestrationAttemptId: string;
      userId: string;
    },
  ): HostedRuntimeEnsureProcessingResponse {
    return createRuntimeProcessingRetryLaterResponse({
      ...input,
      analytics: this.input.runtimeRetryAnalytics ?? null,
    });
  }

  async beginShellPrewarmForUser(
    userId: string,
    source?: CloudflareHostedControlRuntimeShellPrewarmSource,
    orchestration?: HostedRuntimeShellPrewarmOrchestrationDiagnostics,
  ): Promise<void> {
    const orchestrationAttemptId =
      orchestration?.shellPrewarmOrchestrationAttemptId;
    const namespace = this.input.runnerContainerNamespace;
    if (!namespace) {
      throw new Error("Runner container namespace is unavailable.");
    }
    const runnerContainerName = resolveHostedExecutionRunnerContainerName({
      source: this.input.runnerRuntimeEnvSource,
      userId,
    });
    const container = namespace.getByName(runnerContainerName);
    if (!container.beginShellPrewarm) {
      throw new Error("Runner container shell-prewarm RPC is unavailable.");
    }
    const reserved =
      await this.input.stateStore.reserveRunnerContainerStopTargetForShellPrewarm({
        runnerContainerName,
        userId,
      });
    if (!reserved) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          shellPrewarmAdmissionOutcome: "skipped_runtime_busy",
          ...(orchestrationAttemptId === undefined
            ? {}
            : { orchestrationAttemptId }),
          shellPrewarmSource: source ?? "unknown",
        },
        message: "Hosted runner shell prewarm admission decided.",
        phase: "scheduled",
        userId,
      });
      return;
    }
    await container.beginShellPrewarm({
      ...(orchestration === undefined ? {} : { orchestration }),
      ...(source === undefined ? {} : { source }),
      timeoutMs: RUNTIME_SHELL_PREWARM_TIMEOUT_MS,
      userId,
    });
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        shellPrewarmAdmissionOutcome: "scheduled",
        ...(orchestrationAttemptId === undefined
          ? {}
          : { orchestrationAttemptId }),
        shellPrewarmSource: source ?? "unknown",
      },
      message: "Hosted runner shell prewarm admission decided.",
      phase: "scheduled",
      userId,
    });
  }

  async ensureForUser(
    input: RuntimeProcessingInput,
  ): Promise<HostedRuntimeEnsureProcessingResponse> {
    const runtimeWakeStartedAt = Date.now();
    const processingInput = withRuntimeProcessingOrchestration(input, {
      userRunnerEnsureStartedAtEpochMs: runtimeWakeStartedAt,
      runnerStateBindStartedAtEpochMs: Date.now(),
    });
    const commandBudget = createRuntimeProcessingCommandBudget({
      commandTimeoutMs: processingInput.commandTimeoutMs ?? null,
      startedAtMs:
        processingInput.commandStartedAtEpochMs ?? runtimeWakeStartedAt,
      webControlTimeoutMs: this.input.env.webControlTimeoutMs,
    });
    await this.input.stateStore.bindUser(processingInput.userId);
    const stateReadInput = withRuntimeProcessingOrchestration(processingInput, {
      runnerStateBindFinishedAtEpochMs: Date.now(),
      runnerStateReadStartedAtEpochMs: Date.now(),
    });
    const record = await this.input.stateStore.readState();
    const stateReadyInput = withRuntimeProcessingOrchestration(stateReadInput, {
      runnerStateReadFinishedAtEpochMs: Date.now(),
    });
    if (record.writeFence) {
      return await this.ensureExistingRuntimeProcessing({
        commandBudget,
        input: withRuntimeProcessingOrchestration(stateReadyInput, {
          activeFenceObservedAtEpochMs: Date.now(),
        }),
        record,
        runtimeWakeStartedAt,
      });
    }
    return await this.startRuntimeProcessing({
      action: "started",
      commandBudget,
      input: stateReadyInput,
      runtimeWakeStartedAt,
    });
  }

  async stopForHealthDataConsentWithdrawal(
    userId: string,
  ): Promise<RuntimeHealthDataConsentStopResult> {
    await this.input.stateStore.bindUser(userId);
    const preemption =
      await this.input.stateStore.clearWriteFenceForUserControl(userId);
    const runnerContainerName = preemption.runnerContainerName
      ? readActiveRuntimeRunnerContainerName({
        activeRuntime: {
          attemptId: preemption.attemptId ?? "user-control-stop",
          leaseGeneration: "0",
          userId,
        },
        runnerContainerName: preemption.runnerContainerName,
        runnerRuntimeEnvSource: this.input.runnerRuntimeEnvSource,
      })
      : resolveHostedExecutionRunnerContainerName({
        source: this.input.runnerRuntimeEnvSource,
        userId,
      });

    if (!runnerContainerName) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          activeInvocationPreempted: preemption.cleared,
          runnerContainerDestroyAttempted: false,
          runnerContainerDestroyOk: false,
          workspaceAttemptId: preemption.attemptId,
        },
        level: "error",
        message: "Hosted runner stop target was invalid after health-data consent withdrawal.",
        phase: "failed",
        userId,
      });
      throw new HostedRuntimeHealthDataConsentStopError();
    }

    const destroyed = await destroyHostedExecutionContainer({
      runnerContainerName,
      runnerContainerNamespace: this.input.runnerContainerNamespace,
      userId,
    });
    const pendingStopTargetCleared = !preemption.runnerContainerName
      || (
        destroyed.ok
        && await this.input.stateStore.clearStoppedRunnerContainerForUserControl({
          runnerContainerName: preemption.runnerContainerName,
          userId,
        })
      );
    const stopped = destroyed.ok && pendingStopTargetCleared;

    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        activeInvocationPreempted: preemption.cleared,
        pendingStopTargetCleared,
        runnerContainerDestroyAttempted: destroyed.attempted,
        runnerContainerDestroyOk: destroyed.ok,
        workspaceAttemptId: preemption.attemptId,
      },
      level: stopped ? "info" : "error",
      message: stopped
        ? "Hosted runner stopped after health-data consent withdrawal."
        : "Hosted runner could not stop after health-data consent withdrawal.",
      phase: stopped ? "wake.running" : "failed",
      userId,
    });

    if (!stopped) {
      throw new HostedRuntimeHealthDataConsentStopError();
    }

    return {
      activeInvocationPreempted: preemption.cleared,
      runnerContainerDestroyAttempted: destroyed.attempted,
      runnerContainerDestroyOk: destroyed.ok,
    };
  }

  computeRuntimeProcessingRetryAt(reason: RuntimeProcessingRetryReason): string {
    return computeRuntimeProcessingRetryAtValue(reason);
  }

  computeRuntimeProcessingOwnerRecheckAt(): string {
    return computeRuntimeProcessingOwnerRecheckAtValue({
      env: this.input.env,
    });
  }

  private async ensureExistingRuntimeProcessing(input: {
    commandBudget: RuntimeProcessingCommandBudget;
    input: RuntimeProcessingInput;
    record: RunnerStateRecord;
    runtimeWakeStartedAt: number;
  }): Promise<HostedRuntimeEnsureProcessingResponse> {
    const record = input.record;
    if (!record.writeFence) {
      if (!this.hasRuntimeProcessingCommandBudgetRemaining(input.commandBudget)) {
        return this.createRetryLater({
          orchestrationAttemptId: input.input.orchestrationAttemptId,
          reason: "command_budget_exhausted",
          userId: input.input.userId,
        });
      }
      return await this.startRuntimeProcessing({
        action: "started",
        commandBudget: input.commandBudget,
        input: input.input,
        runtimeWakeStartedAt: input.runtimeWakeStartedAt,
      });
    }

    const activeFence = record.writeFence;
    if (activeFence.kind !== "runtime") {
      return this.createRetryLater({
        orchestrationAttemptId: input.input.orchestrationAttemptId,
        reason: "container_busy",
        stage: "non_runtime_write_fence",
        userId: input.input.userId,
      });
    }

    const requestedProcessingMode = normalizeRuntimeProcessingMode(input.input.processingMode);
    const triggeredByTrustedWebDirect =
      isTrustedWebDirectRuntimeProcessing(input.input);
    const cooperativeMailboxOwnerHandoff =
      activeFence.processingMode === "system_mailbox"
      && requestedProcessingMode === "default";
    if (activeFence.processingMode !== requestedProcessingMode) {
      if (
        activeFence.processingMode === "inbox_media_retention"
        || (
          activeFence.processingMode === "system_mailbox"
          && requestedProcessingMode === "default"
          && triggeredByTrustedWebDirect
        )
      ) {
        return await this.preemptActiveBackgroundRuntimeForPriorityProcessing({
          activeFence,
          commandBudget: input.commandBudget,
          input: input.input,
          record,
          runtimeWakeStartedAt: input.runtimeWakeStartedAt,
        });
      }
      if (!cooperativeMailboxOwnerHandoff) {
        const activeRuntimeState =
          await this.readActiveRuntimeFenceLiveness({
            activeFence,
            commandBudget: input.commandBudget,
            record,
          });
        if (activeRuntimeState.outcome === "inactive") {
          return await this.replaceInactiveRuntimeFence({
            activeFence,
            commandBudget: input.commandBudget,
            input: input.input,
            record,
            runtimeWakeStartedAt: input.runtimeWakeStartedAt,
          });
        }

        return this.createRetryLater({
          orchestrationAttemptId: input.input.orchestrationAttemptId,
          reason: "container_busy",
          stage: "active_runtime_contention",
          userId: input.input.userId,
        });
      }
    }

    const canCoalesceWithoutWake =
      activeFence.processingMode === "inbox_media_retention"
      || (
        activeFence.processingMode === "system_mailbox"
        && requestedProcessingMode === "system_mailbox"
      );
    if (canCoalesceWithoutWake) {
      const activeRuntimeState =
        await this.readActiveRuntimeFenceLiveness({
          activeFence,
          commandBudget: input.commandBudget,
          record,
        });
      if (activeRuntimeState.outcome === "inactive") {
        return await this.replaceInactiveRuntimeFence({
          activeFence,
          commandBudget: input.commandBudget,
          input: input.input,
          record,
          runtimeWakeStartedAt: input.runtimeWakeStartedAt,
        });
      }
      if (activeRuntimeState.outcome !== "exact-active") {
        return this.createRetryLater({
          orchestrationAttemptId: input.input.orchestrationAttemptId,
          reason: "container_rpc_error",
          userId: input.input.userId,
        });
      }

      return {
        action: "already_running",
        kind: "runtime_processing_accepted",
        recommendedRecheckAt:
          this.computeRuntimeProcessingOwnerRecheckAt(),
        runtimeAttemptId: activeFence.attemptId,
      };
    }

    const activeWakeStartedAtEpochMs = Date.now();
    const activeFenceTargetWasPriorVersion =
      this.readActiveRuntimeFenceTargetWasPriorVersion({
        activeFence,
        record,
      });
    const inputAtActiveWakeStart = withRuntimeProcessingOrchestration(input.input, {
      ...(activeFenceTargetWasPriorVersion === null ? {} : {
        activeFenceTargetWasPriorVersion,
      }),
      activeWakeStartedAtEpochMs,
    });
    const containerResult = await ensureActiveRuntimeProcessing({
      activeRuntime: {
        attemptId: activeFence.attemptId,
        leaseGeneration: String(activeFence.generation),
        ...(inputAtActiveWakeStart.orchestration
          ? { orchestration: inputAtActiveWakeStart.orchestration }
          : {}),
        processingMode: activeFence.processingMode,
        ...(cooperativeMailboxOwnerHandoff
          ? { requestedProcessingMode }
          : {}),
        userId: record.userId,
      },
      commandBudget: input.commandBudget,
      env: this.input.env,
      runnerContainerName: activeFence.runnerContainerName,
      runnerContainerNamespace: this.input.runnerContainerNamespace,
      runnerRuntimeEnvSource: this.input.runnerRuntimeEnvSource,
    });
    const activeWakeFinishedAtEpochMs = Date.now();
    const inputAfterActiveWake = withRuntimeProcessingOrchestration(inputAtActiveWakeStart, {
      activeWakeAccepted: containerResult.kind === "accepted",
      activeWakeElapsedMs:
        Math.max(0, activeWakeFinishedAtEpochMs - activeWakeStartedAtEpochMs),
      activeWakeFinishedAtEpochMs,
      activeWakeFoundNoActiveChild: containerResult.kind === "start-required",
    });

    if (containerResult.kind === "accepted") {
      if (cooperativeMailboxOwnerHandoff) {
        // The active child accepted the wake so it can checkpoint and release.
        // It did not accept processing under the requested mode.
        return this.createRetryLater({
          orchestrationAttemptId: input.input.orchestrationAttemptId,
          reason: "container_busy",
          stage: "cooperative_handoff_pending",
          userId: input.input.userId,
        });
      }
      const action = containerResult.action === "already_running"
        ? "already_running"
        : "woken";
      return {
        action,
        kind: "runtime_processing_accepted",
        recommendedRecheckAt:
          this.computeRuntimeProcessingOwnerRecheckAt(),
        runtimeAttemptId: activeFence.attemptId,
      };
    }

    if (containerResult.kind === "start-required") {
      return await this.replaceInactiveRuntimeFence({
        activeFence,
        commandBudget: input.commandBudget,
        input: inputAfterActiveWake,
        preserveStartingFence:
          this.shouldPreserveStartingFenceAfterDirectNoChild({
            activeFence,
            record,
          }),
        record,
        runtimeWakeStartedAt: input.runtimeWakeStartedAt,
      });
    }

    const activeRuntimeState =
      await this.readActiveRuntimeFenceLiveness({
        activeFence,
        commandBudget: input.commandBudget,
        record,
      });
    if (activeRuntimeState.outcome === "inactive") {
      return await this.replaceInactiveRuntimeFence({
        activeFence,
        commandBudget: input.commandBudget,
        input: inputAfterActiveWake,
        record,
        runtimeWakeStartedAt: input.runtimeWakeStartedAt,
      });
    }

    return this.createRetryLater({
      orchestrationAttemptId: input.input.orchestrationAttemptId,
      reason: mapRunnerProcessingRetryReason(containerResult.reason),
      userId: input.input.userId,
    });
  }

  private async replaceInactiveRuntimeFence(input: {
    activeFence: NonNullable<RunnerStateRecord["writeFence"]>;
    commandBudget: RuntimeProcessingCommandBudget;
    input: RuntimeProcessingInput;
    preserveCheckpointHandoff?: boolean;
    preserveStartingFence?: boolean;
    record: RunnerStateRecord;
    replacedStaleFence?: boolean;
    runtimeWakeStartedAt: number;
  }): Promise<HostedRuntimeEnsureProcessingResponse> {
    const { activeFence, record } = input;
    if (
      input.preserveStartingFence !== false
      && this.shouldPreserveStartingWriteFence(activeFence)
    ) {
      return this.createRetryLater({
        orchestrationAttemptId: input.input.orchestrationAttemptId,
        reason: "starting_fence_preserved",
        userId: input.input.userId,
      });
    }

    if (
      input.preserveCheckpointHandoff !== false
      && await this.hasLiveCheckpointHandoff(activeFence, record.userId)
    ) {
      return this.createRetryLater({
        orchestrationAttemptId: input.input.orchestrationAttemptId,
        reason: "checkpoint_handoff_pending",
        userId: input.input.userId,
      });
    }

    const replacementFenceClearStartedAtEpochMs = Date.now();
    const inputAtClearStart = withRuntimeProcessingOrchestration(input.input, {
      replacementFenceClearStartedAtEpochMs,
    });
    const cleared = await this.input.stateStore.clearWriteFenceForReplacement({
      attemptId: activeFence.attemptId,
      finishedAt: new Date().toISOString(),
      generation: String(activeFence.generation),
      userId: record.userId,
    });
    if (!cleared.cleared && cleared.record.writeFence) {
      const convergedInput = withoutSupersededRuntimeFenceDiagnostics(inputAtClearStart);
      return await this.ensureExistingRuntimeProcessing({
        commandBudget: input.commandBudget,
        input: withRuntimeProcessingOrchestration(convergedInput, {
          activeFenceObservedAtEpochMs: Date.now(),
        }),
        record: cleared.record,
        runtimeWakeStartedAt: input.runtimeWakeStartedAt,
      });
    }
    if (!this.hasRuntimeProcessingCommandBudgetRemaining(input.commandBudget)) {
      return this.createRetryLater({
        orchestrationAttemptId: input.input.orchestrationAttemptId,
        reason: "command_budget_exhausted",
        userId: input.input.userId,
      });
    }
    const replacementFenceClearedAtEpochMs = Date.now();
    const replacementInput = cleared.cleared
      ? withRuntimeProcessingOrchestration(inputAtClearStart, {
          replacedStaleFence: input.replacedStaleFence ?? true,
          replacementFenceClearElapsedMs: Math.max(
            0,
            replacementFenceClearedAtEpochMs - replacementFenceClearStartedAtEpochMs,
          ),
          replacementFenceClearedAtEpochMs,
        })
      : withoutSupersededRuntimeFenceDiagnostics(inputAtClearStart);
    return await this.startRuntimeProcessing({
      action: "replaced",
      commandBudget: input.commandBudget,
      input: replacementInput,
      runtimeWakeStartedAt: input.runtimeWakeStartedAt,
    });
  }

  private async preemptActiveBackgroundRuntimeForPriorityProcessing(input: {
    activeFence: NonNullable<RunnerStateRecord["writeFence"]>;
    commandBudget: RuntimeProcessingCommandBudget;
    input: RuntimeProcessingInput;
    record: RunnerStateRecord;
    runtimeWakeStartedAt: number;
  }): Promise<HostedRuntimeEnsureProcessingResponse> {
    const { activeFence, record } = input;
    const runnerContainerName = this.readActiveRuntimeFenceContainerName(input);
    const abortResult = await this.abortActiveRuntimeFence({
      activeFence,
      commandBudget: input.commandBudget,
      orchestrationAttemptId: input.input.orchestrationAttemptId,
      record,
      runnerContainerName,
    });
    if (!abortResult.aborted) {
      return abortResult.response;
    }

    return await this.replaceInactiveRuntimeFence({
      activeFence,
      commandBudget: input.commandBudget,
      input: input.input,
      preserveCheckpointHandoff: false,
      preserveStartingFence: false,
      record,
      replacedStaleFence: false,
      runtimeWakeStartedAt: input.runtimeWakeStartedAt,
    });
  }

  private async abortActiveRuntimeFence(input: {
    activeFence: NonNullable<RunnerStateRecord["writeFence"]>;
    commandBudget: RuntimeProcessingCommandBudget;
    orchestrationAttemptId: string;
    record: RunnerStateRecord;
    runnerContainerName?: string | null;
  }): Promise<
    | { aborted: true }
    | {
        aborted: false;
        response: HostedRuntimeEnsureProcessingResponse;
      }
  > {
    const containerName = input.runnerContainerName === undefined
      ? input.activeFence.runnerContainerName
      : input.runnerContainerName;
    const namespace = this.input.runnerContainerNamespace;
    if (!namespace || !containerName) {
      return {
        aborted: false,
        response: this.createRetryLater({
          orchestrationAttemptId: input.orchestrationAttemptId,
          reason: "container_rpc_error",
          userId: input.record.userId,
        }),
      };
    }

    const container = namespace.getByName(containerName);
    if (!container.abortWorkspaceInvocation) {
      return {
        aborted: false,
        response: this.createRetryLater({
          orchestrationAttemptId: input.orchestrationAttemptId,
          reason: "container_busy",
          stage: "background_preemption_unavailable",
          userId: input.record.userId,
        }),
      };
    }

    try {
      const abortStatus = await runRuntimeProcessingCommandStep({
        budget: input.commandBudget,
        operation: async () =>
          await container.abortWorkspaceInvocation!({
            attemptId: input.activeFence.attemptId,
            leaseGeneration: String(input.activeFence.generation),
            userId: input.record.userId,
          }),
        stepTimeoutMs: this.input.env.webControlTimeoutMs,
      });
      if (
        abortStatus === "accepted"
        || abortStatus === "inactive"
      ) {
        return { aborted: true };
      }
      if (abortStatus === "failed") {
        return {
          aborted: false,
          response: this.createRetryLater({
            orchestrationAttemptId: input.orchestrationAttemptId,
            reason: "container_rpc_error",
            userId: input.record.userId,
          }),
        };
      }
      return {
        aborted: false,
        response: this.createRetryLater({
          orchestrationAttemptId: input.orchestrationAttemptId,
          reason: "container_busy",
          stage: "background_preemption_not_accepted",
          userId: input.record.userId,
        }),
      };
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: buildHostedRunnerMetadataOnlyErrorDetails(error),
        level: "warn",
        message: "Hosted runner could not preempt active background runtime processing.",
        phase: "scheduled",
        userId: input.record.userId,
      });
      return {
        aborted: false,
        response: this.createRetryLater({
          orchestrationAttemptId: input.orchestrationAttemptId,
          reason: isRuntimeProcessingCommandBudgetTimeout(error)
            ? "container_rpc_timeout"
            : "container_rpc_error",
          userId: input.record.userId,
        }),
      };
    }
  }

  private hasRuntimeProcessingCommandBudgetRemaining(
    commandBudget: RuntimeProcessingCommandBudget,
  ): boolean {
    return Date.now() < commandBudget.deadlineAtMs;
  }

  private async readActiveRuntimeFenceLiveness(input: {
    activeFence: NonNullable<RunnerStateRecord["writeFence"]>;
    commandBudget: RuntimeProcessingCommandBudget;
    record: RunnerStateRecord;
    runnerContainerName?: string | null;
  }): Promise<RuntimeFenceLivenessReadResult> {
    const result = await readRuntimeFenceLivenessBestEffort({
      commandBudget: input.commandBudget,
      identity: {
        attemptId: input.activeFence.attemptId,
        leaseGeneration: String(input.activeFence.generation),
        userId: input.record.userId,
      },
      runnerContainerName: input.runnerContainerName === undefined
        ? this.readActiveRuntimeFenceContainerName(input)
        : input.runnerContainerName,
      runnerContainerNamespace: this.input.runnerContainerNamespace,
      stepTimeoutMs: this.input.env.webControlTimeoutMs,
    });
    if (result.outcome === "indeterminate" && result.error !== undefined) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: buildHostedRunnerMetadataOnlyErrorDetails(result.error),
        level: "warn",
        message: "Hosted runner active runtime liveness check failed.",
        phase: "scheduled",
        userId: input.record.userId,
      });
    }
    return result;
  }

  private readActiveRuntimeFenceContainerName(input: {
    activeFence: NonNullable<RunnerStateRecord["writeFence"]>;
    record: RunnerStateRecord;
  }): string | null {
    return readActiveRuntimeRunnerContainerName({
      activeRuntime: {
        attemptId: input.activeFence.attemptId,
        leaseGeneration: String(input.activeFence.generation),
        userId: input.record.userId,
      },
      runnerContainerName: input.activeFence.runnerContainerName,
      runnerRuntimeEnvSource: this.input.runnerRuntimeEnvSource,
    });
  }

  private shouldPreserveStartingFenceAfterDirectNoChild(input: {
    activeFence: NonNullable<RunnerStateRecord["writeFence"]>;
    record: RunnerStateRecord;
  }): boolean {
    return this.readActiveRuntimeFenceTargetWasPriorVersion(input) !== true;
  }

  private readActiveRuntimeFenceTargetWasPriorVersion(input: {
    activeFence: NonNullable<RunnerStateRecord["writeFence"]>;
    record: RunnerStateRecord;
  }): boolean | null {
    const activeContainerName = this.readActiveRuntimeFenceContainerName(input);
    if (!activeContainerName) {
      return null;
    }
    if (isHostedStandbySlotName(activeContainerName)) {
      return readHostedStandbyReleaseId(this.input.runnerRuntimeEnvSource)
        !== readHostedStandbySlotReleaseId(activeContainerName);
    }
    return activeContainerName !== resolveHostedExecutionRunnerContainerName({
      source: this.input.runnerRuntimeEnvSource,
      userId: input.record.userId,
    });
  }

  private async resolveFreshRunnerContainer(input: {
    allowFreshStandbyClaim: boolean;
    commandBudget: RuntimeProcessingCommandBudget;
    exactRunnerContainerName: string;
    initialRecord: RunnerStateRecord;
    input: RuntimeProcessingInput;
  }): Promise<FreshRunnerContainerResolution> {
    const userId = input.input.userId;
    const pendingRunnerContainerName = input.initialRecord.pendingRunnerContainerName;
    if (pendingRunnerContainerName) {
      if (isHostedStandbySlotName(pendingRunnerContainerName)) {
        const retained = await this.resolveRetainedStandbyContainer({
          commandBudget: input.commandBudget,
          runnerContainerName: pendingRunnerContainerName,
          userId,
        });
        if (retained === "ready") {
          return {
            kind: "ready",
            runnerContainerName: pendingRunnerContainerName,
            standbyAllocationOutcome: "retained",
          };
        }
        if (retained === "retry") {
          return this.createStandbyRetryResolution(input.input);
        }
      } else if (pendingRunnerContainerName === input.exactRunnerContainerName) {
        return {
          kind: "ready",
          runnerContainerName: input.exactRunnerContainerName,
          standbyAllocationOutcome: "disabled",
        };
      } else if (!await this.destroyAndClearPendingRunnerContainer({
        runnerContainerName: pendingRunnerContainerName,
        userId,
      })) {
        return this.createStandbyRetryResolution(input.input);
      }
    }

    if (
      readHostedStandbyMode(this.input.runnerRuntimeEnvSource) !== "allocate"
      || !input.allowFreshStandbyClaim
      || normalizeRuntimeProcessingMode(input.input.processingMode) !== "default"
      || !isTrustedWebDirectRuntimeProcessing(input.input)
    ) {
      return {
        kind: "ready",
        runnerContainerName: input.exactRunnerContainerName,
        standbyAllocationOutcome: "disabled",
      };
    }
    const releaseId = readHostedStandbyReleaseId(this.input.runnerRuntimeEnvSource);
    const coordinatorNamespace = this.input.standbyCoordinatorNamespace;
    const standbyContainerNamespace = this.input.standbyContainerNamespace;
    if (!releaseId || !coordinatorNamespace || !standbyContainerNamespace) {
      return {
        kind: "ready",
        runnerContainerName: input.exactRunnerContainerName,
        standbyAllocationOutcome: "fallback",
      };
    }

    return await this.resolveFreshStandbyAllocation({
      commandBudget: input.commandBudget,
      coordinatorNamespace,
      exactRunnerContainerName: input.exactRunnerContainerName,
      releaseId,
      runtimeInput: input.input,
      standbyContainerNamespace,
    });
  }

  private async resolveFreshStandbyAllocation(input: {
    commandBudget: RuntimeProcessingCommandBudget;
    coordinatorNamespace: HostedStandbyCoordinatorNamespaceLike;
    exactRunnerContainerName: string;
    releaseId: string;
    runtimeInput: RuntimeProcessingInput;
    standbyContainerNamespace: HostedStandbyRunnerContainerNamespaceLike;
  }): Promise<FreshRunnerContainerResolution> {
    const {
      commandBudget,
      coordinatorNamespace,
      exactRunnerContainerName,
      releaseId,
      runtimeInput,
      standbyContainerNamespace,
    } = input;
    const userId = runtimeInput.userId;

    const standbyBudget: RuntimeProcessingCommandBudget = {
      deadlineAtMs: Math.min(
        commandBudget.deadlineAtMs,
        Date.now() + HOSTED_STANDBY_CLAIM_TIMEOUT_MS,
      ),
    };
    const deadlineAtEpochMs = standbyBudget.deadlineAtMs;
    const claimId = createHostedStandbyClaimId();
    const coordinator = coordinatorNamespace.getByName(
      resolveHostedStandbyCoordinatorName({
        releaseId,
        region: HOSTED_STANDBY_REGION,
      }),
      { locationHint: HOSTED_STANDBY_LOCATION_HINT },
    );
    const claim = await settleStandbyOperationWithinBudget(
      () => coordinator.claimReadyStandby({
        claimId,
        deadlineAtEpochMs,
        releaseId,
        region: HOSTED_STANDBY_REGION,
      }),
      standbyBudget,
      HOSTED_STANDBY_CLAIM_TIMEOUT_MS,
    );
    if (claim.kind !== "completed" || claim.value.outcome !== "claimed") {
      return {
        kind: "ready",
        runnerContainerName: exactRunnerContainerName,
        standbyAllocationOutcome: "fallback",
      };
    }

    const slotName = claim.value.slotName;
    const reserved = await this.input.stateStore.reserveRunnerContainerStopTarget({
      runnerContainerName: slotName,
      userId,
    });
    if (!reserved) {
      return this.createStandbyRetryResolution(runtimeInput);
    }
    const slot = standbyContainerNamespace.getByName(slotName, {
      locationHint: HOSTED_STANDBY_LOCATION_HINT,
    });
    const bind = await settleStandbyOperationWithinBudget(
      () => slot.bindStandbySlot({
        claimId,
        releaseId,
        region: HOSTED_STANDBY_REGION,
        slotName,
        userId,
      }),
      standbyBudget,
      HOSTED_STANDBY_CLAIM_TIMEOUT_MS,
    );
    if (
      bind.kind === "completed"
      && bind.value.bound
      && bind.value.claimId === claimId
      && bind.value.slotName === slotName
      && bind.value.userId === userId
    ) {
      return {
        kind: "ready",
        runnerContainerName: slotName,
        standbyAllocationOutcome: "claimed",
      };
    }
    if (bind.kind === "timed_out") {
      return this.createStandbyRetryResolution(runtimeInput);
    }

    const resolved = await settleStandbyOperationWithinBudget(
      () => slot.readStandbySlotBinding(),
      standbyBudget,
      HOSTED_STANDBY_CLAIM_TIMEOUT_MS,
    );
    if (resolved.kind !== "completed") {
      return this.createStandbyRetryResolution(runtimeInput);
    }
    const binding = resolved.value;
    if (
      binding.state === "bound"
      && binding.userId === userId
      && binding.releaseId === releaseId
      && binding.slotName === slotName
    ) {
      return {
        kind: "ready",
        runnerContainerName: slotName,
        standbyAllocationOutcome: "claimed",
      };
    }
    if (binding.state === "unbound") {
      const retired = await settleStandbyOperationWithinBudget(
        () => slot.retireStandbySlot({}),
        standbyBudget,
        HOSTED_STANDBY_CLAIM_TIMEOUT_MS,
      );
      if (retired.kind !== "completed") {
        return this.createStandbyRetryResolution(runtimeInput);
      }
    }
    const cleared = await this.input.stateStore.clearStoppedRunnerContainerForUserControl({
      runnerContainerName: slotName,
      userId,
    });
    if (!cleared) {
      return this.createStandbyRetryResolution(runtimeInput);
    }
    return {
      kind: "ready",
      runnerContainerName: exactRunnerContainerName,
      standbyAllocationOutcome: "fallback",
    };
  }

  private async resolveRetainedStandbyContainer(input: {
    commandBudget: RuntimeProcessingCommandBudget;
    runnerContainerName: string;
    userId: string;
  }): Promise<"cleared" | "ready" | "retry"> {
    const namespace = this.input.standbyContainerNamespace;
    const releaseId = readHostedStandbyReleaseId(this.input.runnerRuntimeEnvSource);
    if (!namespace || !releaseId) {
      return "retry";
    }
    const slot = namespace.getByName(input.runnerContainerName, {
      locationHint: HOSTED_STANDBY_LOCATION_HINT,
    });
    const bindingResult = await settleStandbyOperationWithinBudget(
      () => slot.readStandbySlotBinding(),
      input.commandBudget,
      this.input.env.webControlTimeoutMs,
    );
    if (bindingResult.kind !== "completed") {
      return "retry";
    }
    const binding = bindingResult.value;
    if (
      binding.state === "bound"
      && binding.userId === input.userId
      && binding.releaseId === releaseId
      && binding.slotName === input.runnerContainerName
    ) {
      return "ready";
    }
    if (binding.state === "retiring") {
      const claimId = binding.claimId;
      const retirement = claimId === null || binding.userId === input.userId
        ? await settleStandbyOperationWithinBudget(
            () => slot.retireStandbySlot(claimId === null ? {} : { claimId }),
            input.commandBudget,
            this.input.env.webControlTimeoutMs,
          )
        : null;
      if (retirement !== null && retirement.kind !== "completed") {
        return "retry";
      }
    }
    if (binding.state === "unbound") {
      const retirement = await settleStandbyOperationWithinBudget(
        () => slot.retireStandbySlot({}),
        input.commandBudget,
        this.input.env.webControlTimeoutMs,
      );
      if (retirement.kind !== "completed") {
        return "retry";
      }
    } else if (binding.state === "bound" && binding.userId === input.userId) {
      const destroyed = await settleStandbyOperationWithinBudget(
        async () => await destroyHostedExecutionContainer({
          runnerContainerName: input.runnerContainerName,
          runnerContainerNamespace: this.input.runnerContainerNamespace,
          userId: input.userId,
        }),
        input.commandBudget,
        this.input.env.webControlTimeoutMs,
      );
      if (destroyed.kind !== "completed" || !destroyed.value.ok) {
        return "retry";
      }
    }
    const cleared = await this.input.stateStore.clearStoppedRunnerContainerForUserControl({
      runnerContainerName: input.runnerContainerName,
      userId: input.userId,
    });
    return cleared ? "cleared" : "retry";
  }

  private async destroyAndClearPendingRunnerContainer(input: {
    runnerContainerName: string;
    userId: string;
  }): Promise<boolean> {
    const destroyed = await destroyHostedExecutionContainer({
      runnerContainerName: input.runnerContainerName,
      runnerContainerNamespace: this.input.runnerContainerNamespace,
      userId: input.userId,
    });
    return destroyed.ok
      && await this.input.stateStore.clearStoppedRunnerContainerForUserControl(input);
  }

  private createStandbyRetryResolution(
    input: RuntimeProcessingInput,
  ): Extract<FreshRunnerContainerResolution, { kind: "retry" }> {
    return {
      kind: "retry",
      response: this.createRetryLater({
        orchestrationAttemptId: input.orchestrationAttemptId,
        reason: "container_rpc_error",
        userId: input.userId,
      }),
    };
  }

  private async startRuntimeProcessing(input: {
    action: "started" | "replaced";
    commandBudget: RuntimeProcessingCommandBudget;
    input: RuntimeProcessingInput;
    runtimeWakeStartedAt: number;
  }): Promise<HostedRuntimeEnsureProcessingResponse> {
    let processingInput = withRuntimeProcessingOrchestration(input.input, {
      freshStartRequestedAtEpochMs: Date.now(),
    });
    const initialRecord = await this.input.stateStore.readState();
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        ...buildRunnerRecordTimingLogDetails(initialRecord),
        orchestrationAttemptId: processingInput.orchestrationAttemptId,
      },
      message: "Hosted runner runtime processing start requested.",
      phase: "runtime.starting",
      userId: processingInput.userId,
    });

    if (!this.input.runnerContainerNamespace) {
      return this.createRetryLater({
        orchestrationAttemptId: processingInput.orchestrationAttemptId,
        reason: "missing_container_binding",
        userId: processingInput.userId,
      });
    }

    const runnerContainerIdentity = readHostedRunnerContainerIdentity({
      containerName: resolveHostedExecutionRunnerContainerName({
        source: this.input.runnerRuntimeEnvSource,
        userId: processingInput.userId,
      }),
      source: this.input.runnerRuntimeEnvSource,
    });
    if (!runnerContainerIdentity || runnerContainerIdentity.userId !== processingInput.userId) {
      throw new Error("Hosted runner container identity did not match the runtime start user.");
    }
    const resolution = await this.resolveFreshRunnerContainer({
      allowFreshStandbyClaim: input.action === "started",
      commandBudget: input.commandBudget,
      exactRunnerContainerName: runnerContainerIdentity.runnerContainerName,
      initialRecord,
      input: processingInput,
    });
    if (resolution.kind === "retry") {
      return resolution.response;
    }
    const runnerContainerName = resolution.runnerContainerName;
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        standbyAllocationOutcome: resolution.standbyAllocationOutcome,
      },
      message: "Hosted runner selected a fresh container target.",
      phase: "runtime.starting",
      userId: processingInput.userId,
    });
    let token: RunnerWriteFenceToken;
    try {
      token = await this.input.stateStore.beginWriteFence({
        processingMode: normalizeRuntimeProcessingMode(input.input.processingMode),
        runnerContainerName,
        userId: processingInput.userId,
      });
      // Launch identity belongs to the request that acquired this fresh fence.
      // Active wakes never reach this point and therefore cannot claim it.
      const triggeredByWebDirect =
        processingInput.orchestration?.triggeredByWebDirect === true;
      const runtimeInvocationOrchestrationAttemptId =
        triggeredByWebDirect
          && isHostedRuntimeDirectEnsureOrchestrationAttemptId(
            processingInput.orchestrationAttemptId,
          )
          ? processingInput.orchestrationAttemptId
          : null;
      processingInput = withRuntimeProcessingOrchestration(processingInput, {
        freshStartFenceBoundAtEpochMs: Date.now(),
        triggeredByWebDirect,
        ...(runtimeInvocationOrchestrationAttemptId === null
          ? {}
          : { runtimeInvocationOrchestrationAttemptId }),
      });
    } catch (error) {
      if (!(error instanceof RunnerWriteFenceAlreadyActiveError)) {
        throw error;
      }
      return await this.ensureExistingRuntimeProcessing({
        commandBudget: input.commandBudget,
        input: processingInput,
        record: error.record,
        runtimeWakeStartedAt: input.runtimeWakeStartedAt,
      });
    }

    const preparation = await this.prepareFreshRuntimeStart({
      commandBudget: input.commandBudget,
      input: processingInput,
      runnerContainerName,
      token,
    });
    if (preparation.kind === "retry") {
      return preparation.response;
    }
    processingInput = withRuntimeProcessingOrchestration(processingInput, {
      ...(preparation.containerReadyAtEpochMs === null ? {} : {
        freshStartContainerReadyAtEpochMs: preparation.containerReadyAtEpochMs,
      }),
      freshStartInvocationPreparedAtEpochMs: preparation.preparedAtEpochMs,
      ...(preparation.startupOrchestration ?? {}),
      ...(preparation.shellPrewarmOrchestration ?? {}),
    });
    const preparationOrchestration =
      preparation.prepared.input.orchestration ?? {};
    const {
      runtimeInvocationPreparationElapsedMs,
      runtimeStoreEnsureElapsedMs,
      workspaceReadElapsedMs,
    } = preparationOrchestration;
    const prepared: PreparedRuntimeInvocation = {
      ...preparation.prepared,
      input: {
        ...toRuntimeInvocationInput(processingInput),
        orchestration: {
          ...preparationOrchestration,
          ...(processingInput.orchestration ?? {}),
          ...(runtimeInvocationPreparationElapsedMs === undefined ? {} : {
            runtimeInvocationPreparationElapsedMs,
          }),
          ...(runtimeStoreEnsureElapsedMs === undefined ? {} : {
            runtimeStoreEnsureElapsedMs,
          }),
          ...(workspaceReadElapsedMs === undefined ? {} : {
            workspaceReadElapsedMs,
          }),
        },
      },
    };

    const stillOwnsPreparedFence = await this.confirmPreparedRuntimeWriteFenceIsActive({
      input: processingInput,
      token: prepared.token,
    });
    if (!stillOwnsPreparedFence) {
      return await this.ensureExistingRuntimeProcessing({
        commandBudget: input.commandBudget,
        input: processingInput,
        record: await this.input.stateStore.readState(),
        runtimeWakeStartedAt: input.runtimeWakeStartedAt,
      });
    }

    const acceptedPrepared: PreparedRuntimeInvocation = {
      ...prepared,
      input: {
        ...prepared.input,
        orchestration: {
          ...(prepared.input.orchestration ?? {}),
          freshStartInvocationAcceptedAtEpochMs: Date.now(),
        },
      },
    };
    void this.input.invocationService.invokePreparedWithFence({
      acceptedProcessingAttempt: true,
      prepared: acceptedPrepared,
      runtimeWakeStartedAt: input.runtimeWakeStartedAt,
    }).then(
      () => undefined,
      () => undefined,
    );

    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        orchestrationAttemptId: processingInput.orchestrationAttemptId,
        runtimeProcessingAction: input.action,
        runtimePreparationWaitAfterContainerReadyMs:
          preparation.runtimePreparationWaitAfterContainerReadyMs,
        standbyAllocationOutcome: resolution.standbyAllocationOutcome,
        workspaceAttemptId: prepared.token.attemptId,
      },
      message: "Hosted runner runtime processing accepted.",
      phase: "runtime.starting",
      userId: processingInput.userId,
    });

    return {
      action: input.action,
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: this.computeRuntimeProcessingOwnerRecheckAt(),
      runtimeAttemptId: prepared.token.attemptId,
    };
  }

  private async prepareFreshRuntimeStart(input: {
    commandBudget: RuntimeProcessingCommandBudget;
    input: RuntimeProcessingInput;
    runnerContainerName: string;
    token: RunnerWriteFenceToken;
  }): Promise<FreshRuntimeStartPreparation> {
    const executionInput = toRuntimeInvocationInput(input.input);
    const token = input.token;
    const readinessPromise = this.confirmRuntimeContainerStartup({
      commandBudget: input.commandBudget,
      input: input.input,
      runnerContainerName: input.runnerContainerName,
      token,
    });
    let startupConfirmedAtMs: number | null = null;
    const readinessResultPromise = readinessPromise.then((startupConfirmed) => {
      if (startupConfirmed.confirmed) {
        startupConfirmedAtMs = Date.now();
      }
      return {
        kind: "startup" as const,
        startupConfirmed,
      };
    });
    const preparationPromise = this.input.invocationService.prepareWithFence({
      commandBudget: input.commandBudget,
      input: executionInput,
      token,
    }).then(
      (prepared) => ({
        kind: "prepared" as const,
        prepared,
        preparedAtEpochMs: Date.now(),
      }),
      (error: unknown) => ({ kind: "failed" as const, error }),
    );

    const clearPreparationFailure = async (
      error: unknown,
    ): Promise<FreshRuntimeStartPreparation> => {
      // Preparation is the invocation authority. Once it fails, clear this
      // fresh fence and return; any still-pending readiness RPC may finish as a
      // best-effort warm shell, but it cannot commit runtime work without the fence.
      void readinessResultPromise.catch(() => undefined);

      const current = await this.input.stateStore.readWriteFenceToken();
      const stillOwnsFreshFence = runnerWriteFenceIdentityMatches(current, token);
      if (!stillOwnsFreshFence) {
        const startupConfirmed = await readinessPromise;
        if (!startupConfirmed.confirmed) {
          return {
            kind: "retry",
            response: startupConfirmed.response,
          };
        }
      }

      const failed = await this.clearWriteFenceAfterRuntimeStartFailure({
        error,
        input: input.input,
        message: "Hosted runner runtime processing preparation failed.",
        token,
      });
      return {
        kind: "retry",
        response: failed.response,
      };
    };

    const firstCompleted = await Promise.race([
      readinessResultPromise,
      preparationPromise,
    ]);
    if (firstCompleted.kind === "failed") {
      return await clearPreparationFailure(firstCompleted.error);
    }

    const startupConfirmed = firstCompleted.kind === "startup"
      ? firstCompleted.startupConfirmed
      : await readinessPromise;
    if (!startupConfirmed.confirmed) {
      return {
        kind: "retry",
        response: startupConfirmed.response,
      };
    }

    const preparation = firstCompleted.kind === "prepared"
      ? firstCompleted
      : await preparationPromise;
    if (preparation.kind === "failed") {
      return await clearPreparationFailure(preparation.error);
    }
    const runtimePreparationWaitAfterContainerReadyMs =
      firstCompleted.kind === "startup" && startupConfirmedAtMs !== null
        ? Math.max(0, Date.now() - startupConfirmedAtMs)
        : 0;
    return {
      containerReadyAtEpochMs: startupConfirmedAtMs,
      kind: "ready",
      prepared: preparation.prepared,
      preparedAtEpochMs: preparation.preparedAtEpochMs,
      runtimePreparationWaitAfterContainerReadyMs,
      startupOrchestration: toContainerColdStartOrchestrationDiagnostics(
        startupConfirmed.coldStartTiming,
      ),
      shellPrewarmOrchestration: toShellPrewarmOrchestrationDiagnostics(
        startupConfirmed.shellPrewarmObservation,
      ),
    };
  }

  private async confirmPreparedRuntimeWriteFenceIsActive(input: {
    input: RuntimeProcessingInput;
    token: RunnerWriteFenceToken;
  }): Promise<boolean> {
    const current = await this.input.stateStore.readWriteFenceToken();
    if (runnerWriteFenceTokensMatch(current, input.token)) {
      return true;
    }

    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        orchestrationAttemptId: input.input.orchestrationAttemptId,
        workspaceAttemptId: input.token.attemptId,
      },
      level: "warn",
      message: "Hosted runner runtime processing startup confirmation finished after its write fence changed.",
      phase: "runtime.starting",
      userId: input.input.userId,
    });
    return false;
  }

  private async confirmRuntimeContainerStartup(input: {
    commandBudget: RuntimeProcessingCommandBudget;
    input: RuntimeProcessingInput;
    runnerContainerName: string;
    token: RunnerWriteFenceToken;
  }): Promise<
    | {
        coldStartTiming?: RunnerContainerColdStartTiming;
        confirmed: true;
        shellPrewarmObservation?: RunnerContainerShellPrewarmObservation;
      }
    | {
        confirmed: false;
        response: HostedRuntimeEnsureProcessingResponse;
      }
  > {
    if (!this.input.runnerContainerNamespace) {
      return {
        confirmed: false,
        response: this.createRetryLater({
          orchestrationAttemptId: input.input.orchestrationAttemptId,
          reason: "missing_container_binding",
          userId: input.input.userId,
        }),
      };
    }

    const startupConfirmationStartedAtEpochMs = Date.now();
    const container = this.input.runnerContainerNamespace.getByName(
      input.runnerContainerName,
    );
    if (!container.ensureReadyForProcessing) {
      return await this.clearWriteFenceAfterStartupConfirmationFailure({
        error: new Error("Hosted runner container readiness method is unavailable."),
        failureStage: "rpc_unattributed",
        input: input.input,
        retryReason: "container_rpc_error",
        startupConfirmationStartedAtEpochMs,
        token: input.token,
      });
    }

    let readinessRpcDispatched = false;
    try {
      let timeoutMs = RUNTIME_PROCESSING_STARTUP_CONFIRM_TIMEOUT_MS;
      const readinessResult = await runRuntimeProcessingCommandStep({
        budget: input.commandBudget,
        operation: async () => {
          const guardedTimeoutMs = readRuntimeProcessingCommandStepTimeoutMs({
            budget: input.commandBudget,
            stepTimeoutMs: RUNTIME_PROCESSING_STARTUP_STEP_TIMEOUT_MS,
          });
          if (guardedTimeoutMs <= RUNTIME_PROCESSING_STARTUP_OUTER_GUARD_MS) {
            throw new Error(RUNTIME_PROCESSING_COMMAND_BUDGET_TIMEOUT_MESSAGE);
          }
          timeoutMs = Math.max(
            1,
            Math.min(
              RUNTIME_PROCESSING_STARTUP_CONFIRM_TIMEOUT_MS,
              guardedTimeoutMs - RUNTIME_PROCESSING_STARTUP_OUTER_GUARD_MS,
            ),
          );
          readinessRpcDispatched = true;
          return await container.ensureReadyForProcessing!({
            timeoutMs,
            userId: input.input.userId,
          });
        },
        stepTimeoutMs: RUNTIME_PROCESSING_STARTUP_STEP_TIMEOUT_MS,
      });
      if (readinessResult.kind === "cleanup_unsettled") {
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            orchestrationAttemptId: input.input.orchestrationAttemptId,
            runtimeProcessingRetryReason: "container_rpc_timeout",
            runtimeStartupCleanupUnsettled: true,
            runtimeStartupFailureElapsedMs:
              readBoundedRuntimeStartupFailureElapsedMs(
                startupConfirmationStartedAtEpochMs,
              ),
            runtimeStartupFailureStage: "rpc_unattributed",
            runtimeStartupWriteFencePreserved: true,
            workspaceAttemptId: input.token.attemptId,
          },
          level: "warn",
          message: "Hosted runner runtime processing startup cleanup did not settle.",
          phase: "runtime.starting",
          userId: input.input.userId,
        });
        return {
          confirmed: false,
          response: this.createRetryLater({
            orchestrationAttemptId: input.input.orchestrationAttemptId,
            reason: "container_rpc_timeout",
            userId: input.input.userId,
          }),
        };
      }
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          orchestrationAttemptId: input.input.orchestrationAttemptId,
          runtimeStartupConfirmTimeoutMs: timeoutMs,
          workspaceAttemptId: input.token.attemptId,
        },
        message: "Hosted runner runtime processing startup confirmed.",
        phase: "runtime.starting",
        userId: input.input.userId,
      });
      return {
        ...(readinessResult.coldStartTiming === undefined ? {} : {
          coldStartTiming: readinessResult.coldStartTiming,
        }),
        confirmed: true,
        ...(readinessResult.shellPrewarmObservation === undefined ? {} : {
          shellPrewarmObservation: readinessResult.shellPrewarmObservation,
        }),
      };
    } catch (error) {
      if (
        isRuntimeProcessingCommandBudgetTimeout(error)
        && readinessRpcDispatched
      ) {
        // The outer guard cannot prove that the container RPC has settled.
        // Preserve the fence so a late RPC cannot overlap cleanup or a second
        // fresh start; the ordinary startup-grace convergence path will retry.
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            ...buildHostedRunnerMetadataOnlyErrorDetails(error),
            orchestrationAttemptId: input.input.orchestrationAttemptId,
            runtimeProcessingRetryReason: "container_rpc_timeout",
            runtimeStartupFailureElapsedMs:
              readBoundedRuntimeStartupFailureElapsedMs(
                startupConfirmationStartedAtEpochMs,
              ),
            runtimeStartupFailureStage: "caller_deadline",
            runtimeStartupWriteFencePreserved: true,
            workspaceAttemptId: input.token.attemptId,
          },
          level: "warn",
          message: "Hosted runner runtime processing startup confirmation guard elapsed.",
          phase: "runtime.starting",
          userId: input.input.userId,
        });
        return {
          confirmed: false,
          response: this.createRetryLater({
            orchestrationAttemptId: input.input.orchestrationAttemptId,
            reason: "container_rpc_timeout",
            userId: input.input.userId,
          }),
        };
      }
      return await this.clearWriteFenceAfterStartupConfirmationFailure({
        error,
        failureStage: isRuntimeProcessingCommandBudgetTimeout(error)
          ? "caller_deadline"
          : "rpc_unattributed",
        input: input.input,
        retryReason: isRuntimeProcessingCommandBudgetTimeout(error)
          ? "command_budget_exhausted"
          : undefined,
        startupConfirmationStartedAtEpochMs,
        token: input.token,
      });
    }
  }

  private async clearWriteFenceAfterStartupConfirmationFailure(input: {
    error: unknown;
    failureStage: RuntimeStartupCallerFailureStage;
    input: RuntimeProcessingInput;
    retryReason?: RuntimeProcessingStartFailureRetryReason;
    startupConfirmationStartedAtEpochMs: number;
    token: RunnerWriteFenceToken;
  }): Promise<{
    confirmed: false;
    response: HostedRuntimeEnsureProcessingResponse;
  }> {
    return await this.clearWriteFenceAfterRuntimeStartFailure({
      error: input.error,
      input: input.input,
      message: "Hosted runner runtime processing startup confirmation failed.",
      retryReason: input.retryReason,
      startupFailure: {
        elapsedMs: readBoundedRuntimeStartupFailureElapsedMs(
          input.startupConfirmationStartedAtEpochMs,
        ),
        stage: input.failureStage,
      },
      token: input.token,
    });
  }

  private async clearWriteFenceAfterRuntimeStartFailure(input: {
    error: unknown;
    input: RuntimeProcessingInput;
    message: string;
    retryReason?: RuntimeProcessingStartFailureRetryReason;
    startupFailure?: {
      elapsedMs: number;
      stage: RuntimeStartupCallerFailureStage;
    };
    token: RunnerWriteFenceToken;
  }): Promise<{
    confirmed: false;
    response: HostedRuntimeEnsureProcessingResponse;
  }> {
    const retryReason = input.retryReason
      ?? classifyRuntimeStartFailureRetryReason(input.error);
    const failed = await this.input.stateStore.clearWriteFenceAfterTransportFailure({
      error: input.error,
      finishedAt: new Date().toISOString(),
      token: input.token,
    });
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        ...buildHostedRunnerMetadataOnlyErrorDetails(input.error),
        orchestrationAttemptId: input.input.orchestrationAttemptId,
        ...(input.startupFailure === undefined ? {} : {
          runtimeProcessingRetryReason: retryReason,
          runtimeStartupFailureElapsedMs: input.startupFailure.elapsedMs,
          runtimeStartupFailureStage: input.startupFailure.stage,
        }),
        transportFailureFenceCleared: failed.failed,
        workspaceAttemptId: input.token.attemptId,
      },
      level: "warn",
      message: input.message,
      phase: "runtime.starting",
      userId: input.input.userId,
    });
    return {
      confirmed: false,
      response: this.createRetryLater({
        orchestrationAttemptId: input.input.orchestrationAttemptId,
        reason: retryReason,
        userId: input.input.userId,
      }),
    };
  }

  private shouldPreserveStartingWriteFence(
    fence: NonNullable<RunnerStateRecord["writeFence"]>,
  ): boolean {
    const startedAtMs = Date.parse(fence.startedAt);
    if (!Number.isFinite(startedAtMs)) {
      return false;
    }
    return Date.now() - startedAtMs < RUNTIME_PROCESSING_STARTUP_GRACE_MS;
  }

  private async hasLiveCheckpointHandoff(
    fence: NonNullable<RunnerStateRecord["writeFence"]>,
    userId: string,
  ): Promise<boolean> {
    const readHandoff = this.input.readCheckpointHandoff;
    if (!readHandoff) {
      return false;
    }
    const handoff = await readHandoff({
      attemptId: fence.attemptId,
      leaseGeneration: String(fence.generation),
      userId,
    });
    if (!handoff || handoff.completedAt !== null) {
      return false;
    }
    const heartbeatAtMs = Date.parse(handoff.heartbeatAt);
    if (!Number.isFinite(heartbeatAtMs)) {
      return false;
    }
    const ageMs = Date.now() - heartbeatAtMs;
    return ageMs >= 0
      && ageMs < HOSTED_WORKSPACE_SNAPSHOT_HANDOFF_HEARTBEAT_STALE_MS;
  }
}

type StandbyOperationSettlement<T> =
  | { kind: "completed"; value: T }
  | { kind: "failed" }
  | { kind: "timed_out" };

async function settleStandbyOperationWithinBudget<T>(
  operation: () => Promise<T>,
  commandBudget: RuntimeProcessingCommandBudget,
  stepTimeoutMs: number,
): Promise<StandbyOperationSettlement<T>> {
  try {
    return {
      kind: "completed",
      value: await runRuntimeProcessingCommandStep({
        budget: commandBudget,
        operation,
        stepTimeoutMs,
      }),
    };
  } catch (error) {
    if (isRuntimeProcessingCommandBudgetTimeout(error)) {
      return { kind: "timed_out" };
    }
    return { kind: "failed" };
  }
}

class HostedRuntimeHealthDataConsentStopError extends Error {
  constructor() {
    super("Hosted runner container cleanup failed after health-data consent withdrawal.");
    this.name = "HostedRuntimeHealthDataConsentStopError";
  }
}

function readBoundedRuntimeStartupFailureElapsedMs(
  startedAtEpochMs: number,
): number {
  const rawElapsedMs = Date.now() - startedAtEpochMs;
  return Number.isFinite(rawElapsedMs) && rawElapsedMs > 0
    ? Math.min(
        Math.floor(rawElapsedMs),
        RUNNER_CONTAINER_STARTUP_FAILURE_ELAPSED_MAX_MS,
      )
    : 0;
}

function normalizeRuntimeProcessingMode(
  value: RuntimeProcessingInput["processingMode"],
): RunnerRuntimeProcessingMode {
  return value === "inbox_media_retention"
      || value === "system_mailbox"
    ? value
    : "default";
}

function isTrustedWebDirectRuntimeProcessing(
  input: RuntimeProcessingInput,
): boolean {
  return input.orchestration?.triggeredByWebDirect === true
    && isHostedRuntimeDirectEnsureOrchestrationAttemptId(
      input.orchestrationAttemptId,
    );
}
