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
  resolveHostedExecutionRunnerContainerName,
} from "../hosted-runner-container-identity.js";
import {
  HOSTED_STANDBY_CLAIM_TIMEOUT_MS,
  HOSTED_RUNNER_REGION,
  createHostedRunnerSlotName,
  hostedRunnerSlotBindingMatchesTarget,
  isHostedRunnerSlotName,
  isHostedRunnerTargetName,
  isHostedStandbyClaimId,
  createHostedStandbyClaimId,
  readHostedStandbyMode,
  readHostedStandbyReleaseId,
  readHostedRunnerTargetIdentity,
  requireHostedRunnerSlotLifecycle,
  resolveHostedRunnerReleaseId,
  type HostedRunnerSlotLifecycle,
  type HostedStandbySlotBinding,
  resolveHostedStandbyCoordinatorName,
  type HostedStandbyCoordinatorNamespaceLike,
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
import type {
  RuntimeInvocationService,
  PreparedRuntimeInvocation,
  RuntimeInvocationInput,
} from "./runtime-invocation.js";
import {
  RunnerWriteFenceAlreadyActiveError,
  RunnerContainerReservationLostError,
  runnerWriteFenceIdentityMatches,
  runnerWriteFenceTokensMatch,
  type RunnerStateStore,
  type RunnerWriteFenceToken,
} from "./runner-state-store.js";
import type {
  RunnerRuntimeProcessingMode,
  RunnerStateRecord,
} from "./types.js";

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

type RunnerAllocationReason = NonNullable<
  RuntimeProcessingOrchestrationDiagnostics["standbyAllocationReason"]
>;

type FreshRunnerContainerResolution =
  | {
      kind: "ready";
      runnerContainerName: string;
      standbyAllocationOutcome: NonNullable<
        RuntimeProcessingOrchestrationDiagnostics["standbyAllocationOutcome"]
      >;
      standbyAllocationReason: NonNullable<
        RuntimeProcessingOrchestrationDiagnostics["standbyAllocationReason"]
      >;
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
      invocationService: Pick<RuntimeInvocationService, "prepareWithFence" | "invokePreparedWithFence">;
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
    // Hints never create member-specific shells. The memberless coordinator
    // owns optional prewarming in every mode; allocation alone binds a target.
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        shellPrewarmAdmissionOutcome: "skipped_standby_pool",
        ...(orchestration?.shellPrewarmOrchestrationAttemptId === undefined ? {} : {
          orchestrationAttemptId: orchestration.shellPrewarmOrchestrationAttemptId,
        }),
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
    if (isHostedRunnerTargetName(activeContainerName)) {
      return resolveHostedRunnerReleaseId(this.input.runnerRuntimeEnvSource)
        !== readHostedRunnerTargetIdentity(activeContainerName)?.releaseId;
    }
    return activeContainerName !== resolveHostedExecutionRunnerContainerName({
      source: this.input.runnerRuntimeEnvSource,
      userId: input.record.userId,
    });
  }

  private async resolveFreshRunnerContainer(input: {
    commandBudget: RuntimeProcessingCommandBudget;
    initialRecord: RunnerStateRecord;
    input: RuntimeProcessingInput;
  }): Promise<FreshRunnerContainerResolution> {
    if (!this.input.runnerContainerNamespace) {
      return {
        kind: "retry",
        response: this.createRetryLater({
          orchestrationAttemptId: input.input.orchestrationAttemptId,
          reason: "missing_container_binding",
          userId: input.input.userId,
        }),
      };
    }
    const userId = input.input.userId;
    if (!userId || userId.length > 256 || userId.trim() !== userId) {
      throw new TypeError("Hosted runner runtime user id must be canonical.");
    }
    const pending = input.initialRecord.pendingRunnerContainerName;
    if (pending) {
      if (isHostedRunnerTargetName(pending)) {
        const retained = await this.resolveRetainedRunnerContainer({
          commandBudget: input.commandBudget,
          runnerContainerName: pending,
          userId,
        });
        if (retained === "ready") {
          return {
            kind: "ready",
            runnerContainerName: pending,
            standbyAllocationOutcome: "retained",
            standbyAllocationReason: "retained",
          };
        }
        if (retained === "retry") return this.createStandbyRetryResolution(input.input);
      } else if (!await this.destroyAndClearPendingRunnerContainer({
        runnerContainerName: pending,
        userId,
      })) {
        // Exact-member names are drain-only. Never restart a stopped old target.
        return this.createStandbyRetryResolution(input.input);
      }
    }

    const releaseId = resolveHostedRunnerReleaseId(this.input.runnerRuntimeEnvSource);
    const cold = (reason: RunnerAllocationReason, outcome: "disabled" | "fallback" = "disabled") =>
      this.bindFreshRunnerTarget({
        claimId: createHostedStandbyClaimId(),
        commandBudget: input.commandBudget,
        outcome,
        reason,
        releaseId,
        runtimeInput: input.input,
        slotName: createHostedRunnerSlotName(releaseId),
      });
    if (readHostedStandbyMode(this.input.runnerRuntimeEnvSource) !== "allocate") {
      return await cold("mode_not_allocate");
    }
    if (normalizeRuntimeProcessingMode(input.input.processingMode) !== "default") {
      return await cold("processing_mode_not_default");
    }
    if (!isTrustedWebDirectRuntimeProcessing(input.input) && input.input.conversationWorkPending !== true) {
      return await cold("not_trusted_web_direct");
    }
    const coordinatorNamespace = this.input.standbyCoordinatorNamespace;
    if (!readHostedStandbyReleaseId(this.input.runnerRuntimeEnvSource) || !coordinatorNamespace) {
      return await cold("bindings_unavailable", "fallback");
    }
    return await this.resolveFreshStandbyAllocation({
      cold,
      commandBudget: input.commandBudget,
      coordinatorNamespace,
      releaseId,
      runtimeInput: input.input,
    });
  }

  private async resolveFreshStandbyAllocation(input: {
    cold: (reason: RunnerAllocationReason, outcome: "fallback") => Promise<FreshRunnerContainerResolution>;
    commandBudget: RuntimeProcessingCommandBudget;
    coordinatorNamespace: HostedStandbyCoordinatorNamespaceLike;
    releaseId: string;
    runtimeInput: RuntimeProcessingInput;
  }): Promise<FreshRunnerContainerResolution> {
    const budget = {
      deadlineAtMs: Math.min(input.commandBudget.deadlineAtMs, Date.now() + HOSTED_STANDBY_CLAIM_TIMEOUT_MS),
    };
    const claimId = createHostedStandbyClaimId();
    const claim = await settleStandbyOperationWithinBudget(
      () => input.coordinatorNamespace.getByName(resolveHostedStandbyCoordinatorName({
        releaseId: input.releaseId,
        region: HOSTED_RUNNER_REGION,
      })).claimReadyStandby({
        claimId,
        deadlineAtEpochMs: budget.deadlineAtMs,
        releaseId: input.releaseId,
        region: HOSTED_RUNNER_REGION,
      }),
      budget,
      HOSTED_STANDBY_CLAIM_TIMEOUT_MS,
    );
    // A lost memberless claim carries no member data or credentials. Its
    // existing coordinator orphan recovery is independent of cold allocation.
    if (claim.kind !== "completed") return await input.cold(`claim_${claim.kind}`, "fallback");
    if (claim.value?.outcome !== "claimed") {
      const reason = claim.value?.outcome === "deadline_expired" ? "claim_deadline_expired"
        : claim.value?.outcome === "disabled" ? "claim_disabled"
        : claim.value?.outcome === "no_ready_slot" ? "claim_no_ready_slot"
        : claim.value?.outcome === "stale_release" ? "claim_stale_release"
        : "claim_failed";
      return await input.cold(reason, "fallback");
    }
    return await this.bindFreshRunnerTarget({
      claimId,
      commandBudget: budget,
      outcome: "claimed",
      reason: "bind_completed",
      releaseId: input.releaseId,
      runtimeInput: input.runtimeInput,
      slotName: claim.value.slotName,
    });
  }

  private async bindFreshRunnerTarget(input: {
    claimId: string;
    commandBudget: RuntimeProcessingCommandBudget;
    outcome: "claimed" | "disabled" | "fallback";
    reason: RunnerAllocationReason;
    releaseId: string;
    runtimeInput: RuntimeProcessingInput;
    slotName: string;
  }): Promise<FreshRunnerContainerResolution> {
    const { slotName, runtimeInput, releaseId, claimId } = input;
    const retry = () => this.createStandbyRetryResolution(runtimeInput);
    if (!isHostedRunnerSlotName(slotName) || readHostedRunnerTargetIdentity(slotName)?.releaseId !== releaseId) {
      // No new allocation may consume a legacy namespace or a different release.
      return retry();
    }
    if (!await this.input.stateStore.reserveRunnerContainerStopTarget({
      runnerContainerName: slotName,
      userId: runtimeInput.userId,
    })) return retry();

    let slot: HostedRunnerSlotLifecycle;
    try {
      slot = this.runnerSlot(slotName);
    } catch {
      return retry();
    }
    const bindingInput = {
      claimId,
      releaseId,
      region: HOSTED_RUNNER_REGION,
      slotName,
      userId: runtimeInput.userId,
    };
    const settle = <T>(operation: () => Promise<T>) => settleStandbyOperationWithinBudget(
      operation, input.commandBudget, this.input.env.webControlTimeoutMs,
    );
    const ready = (): FreshRunnerContainerResolution => ({
      kind: "ready",
      runnerContainerName: slotName,
      standbyAllocationOutcome: input.outcome,
      standbyAllocationReason: input.reason,
    });
    const boundExactly = (binding: {
      claimId: string | null; releaseId: string; region: string; slotName: string; userId: string | null;
    }) => binding.claimId === claimId
      && binding.releaseId === releaseId
      && binding.region === HOSTED_RUNNER_REGION
      && binding.slotName === slotName
      && binding.userId === runtimeInput.userId;
    const bind = await settle(() => slot.bindStandbySlot(bindingInput));
    if (bind.kind === "completed" && bind.value?.bound === true && boundExactly(bind.value)) return ready();
    // A timed-out bind can still commit. Keep the exact pending target; the
    // next request must use the owner's no-start native-warm/retire resolution.
    if (bind.kind === "timed_out") return retry();

    const recovery = await settle(() => slot.readStandbySlotBinding());
    if (recovery.kind !== "completed" || !hostedRunnerSlotBindingMatchesTarget(recovery.value, slotName)) {
      return retry();
    }
    let binding: HostedStandbySlotBinding = recovery.value;
    if (binding.state === "bound" && boundExactly(binding)) {
      // Same allocating request, same random claim: a just-bound cold target
      // may start. This exception is never used by later pending recovery.
      return ready();
    }
    if (binding.state === "unbound") {
      const retirement = await settle(() => slot.retireStandbySlot({}));
      if (retirement.kind !== "completed") return retry();
      const receipt = await settle(() => slot.readStandbySlotBinding());
      if (receipt.kind !== "completed") return retry();
      binding = receipt.value;
    }
    // Foreign, retiring, malformed and unavailable evidence all stay pinned.
    // The retirement RPC's boolean is not a terminal receipt for this identity.
    if (
      !hostedRunnerSlotBindingMatchesTarget(binding, slotName)
      || binding.state !== "retired"
    ) return retry();
    await this.input.stateStore.clearStoppedRunnerContainerForUserControl({
      runnerContainerName: slotName,
      userId: runtimeInput.userId,
    });
    return retry();
  }

  private runnerSlot(slotName: string): HostedRunnerSlotLifecycle {
    if (!this.input.runnerContainerNamespace) throw new Error("Hosted runner container binding is unavailable.");
    return requireHostedRunnerSlotLifecycle(this.input.runnerContainerNamespace.getByName(slotName));
  }

  private async resolveRetainedRunnerContainer(input: {
    commandBudget: RuntimeProcessingCommandBudget;
    runnerContainerName: string;
    userId: string;
  }): Promise<"cleared" | "ready" | "retry"> {
    const currentReleaseId = resolveHostedRunnerReleaseId(this.input.runnerRuntimeEnvSource);
    const identity = readHostedRunnerTargetIdentity(input.runnerContainerName);
    if (!identity) return "retry";
    const resolution = await settleStandbyOperationWithinBudget(
      () => this.runnerSlot(input.runnerContainerName).resolveRetainedStandbySlot({
        currentReleaseId,
        region: identity.region,
        slotName: input.runnerContainerName,
        userId: input.userId,
      }),
      input.commandBudget,
      this.input.env.webControlTimeoutMs,
    );
    if (resolution.kind !== "completed") return "retry";
    const binding = resolution.value;
    if (!hostedRunnerSlotBindingMatchesTarget(binding, input.runnerContainerName)) return "retry";
    if (binding.state === "bound") {
      return binding.releaseId === currentReleaseId && binding.userId === input.userId
        && isHostedStandbyClaimId(binding.claimId) ? "ready" : "retry";
    }
    if (binding.state !== "retired" || binding.claimId !== null || binding.userId !== null) return "retry";
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

    const standbyAllocationStartedAtEpochMs = Date.now();
    const resolution = await this.resolveFreshRunnerContainer({
      commandBudget: input.commandBudget,
      initialRecord,
      input: processingInput,
    });
    if (resolution.kind === "retry") {
      return resolution.response;
    }
    const standbyAllocationElapsedMs = Math.max(
      0,
      Date.now() - standbyAllocationStartedAtEpochMs,
    );
    processingInput = withRuntimeProcessingOrchestration(processingInput, {
      standbyAllocationElapsedMs,
      standbyAllocationOutcome: resolution.standbyAllocationOutcome,
      standbyAllocationReason: resolution.standbyAllocationReason,
    });
    const runnerContainerName = resolution.runnerContainerName;
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        standbyAllocationOutcome: resolution.standbyAllocationOutcome,
        standbyAllocationReason: resolution.standbyAllocationReason,
        standbyAllocationElapsedMs,
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
      if (error instanceof RunnerContainerReservationLostError) {
        return this.createRetryLater({
          orchestrationAttemptId: processingInput.orchestrationAttemptId,
          reason: "container_rpc_error",
          userId: processingInput.userId,
        });
      }
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
        standbyAllocationReason: resolution.standbyAllocationReason,
        standbyAllocationElapsedMs,
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
    let timeoutMs = RUNTIME_PROCESSING_STARTUP_CONFIRM_TIMEOUT_MS;
    try {
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
            orchestrationAttemptId: input.input.orchestrationAttemptId,
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
            runtimeStartupConfirmTimeoutMs: timeoutMs,
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
            runtimeStartupConfirmTimeoutMs: timeoutMs,
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
        startupConfirmationTimeoutMs: readinessRpcDispatched
          ? timeoutMs
          : undefined,
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
    startupConfirmationTimeoutMs?: number;
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
        timeoutMs: input.startupConfirmationTimeoutMs,
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
      timeoutMs?: number;
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
          ...(input.startupFailure.timeoutMs === undefined ? {} : {
            runtimeStartupConfirmTimeoutMs: input.startupFailure.timeoutMs,
          }),
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
