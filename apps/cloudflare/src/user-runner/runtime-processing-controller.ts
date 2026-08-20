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
  isHostedRuntimeDirectEnsureOrchestrationAttemptId,
} from "@murphai/hosted-execution/runtime-control";

import type { HostedExecutionEnvironment } from "../env.js";
import type {
  WorkerAnalyticsEngineDatasetLike,
} from "../worker-contracts.js";
import {
  destroyHostedExecutionContainer,
  type HostedExecutionContainerNamespaceLike,
  type RunnerContainerShellPrewarmObservation,
} from "../runner-container.js";
import {
  HOSTED_WORKSPACE_SNAPSHOT_HANDOFF_HEARTBEAT_STALE_MS,
} from "../workspace-snapshot-store.ts";
import {
  readHostedRunnerContainerIdentity,
  resolveHostedExecutionRunnerContainerName,
} from "../hosted-runner-container-identity.js";
import {
  buildHostedRunnerMetadataOnlyErrorDetails,
  buildRunnerRecordTimingLogDetails,
  classifyRuntimeStartFailureRetryReason,
  mapRunnerProcessingRetryReason,
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

type FreshRuntimeStartPreparation =
  | {
      containerReadyAtEpochMs: number | null;
      kind: "ready";
      prepared: PreparedRuntimeInvocation;
      preparedAtEpochMs: number;
      runtimePreparationWaitAfterContainerReadyMs: number;
      shellPrewarmOrchestration: RuntimeProcessingOrchestrationDiagnostics | null;
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
      stateStore: RunnerStateStore;
    },
  ) {}

  private createRetryLater(input: {
    orchestrationAttemptId: string;
    reason: RuntimeProcessingRetryReason;
    userId: string;
  }): HostedRuntimeEnsureProcessingResponse {
    return createRuntimeProcessingRetryLaterResponse({
      ...input,
      analytics: this.input.runtimeRetryAnalytics ?? null,
    });
  }

  async beginShellPrewarmForUser(
    userId: string,
    source?: CloudflareHostedControlRuntimeShellPrewarmSource,
  ): Promise<void> {
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
          shellPrewarmSource: source ?? "unknown",
        },
        message: "Hosted runner shell prewarm admission decided.",
        phase: "scheduled",
        userId,
      });
      return;
    }
    await container.beginShellPrewarm({
      ...(source === undefined ? {} : { source }),
      timeoutMs: RUNTIME_SHELL_PREWARM_TIMEOUT_MS,
      userId,
    });
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        shellPrewarmAdmissionOutcome: "scheduled",
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
        userId: input.input.userId,
      });
    }

    const requestedProcessingMode = normalizeRuntimeProcessingMode(input.input.processingMode);
    const foregroundWaitingOnSystemMailbox =
      activeFence.processingMode === "system_mailbox"
      && requestedProcessingMode === "default";
    if (activeFence.processingMode !== requestedProcessingMode) {
      if (activeFence.processingMode === "inbox_media_retention") {
        return await this.preemptActiveBackgroundRuntimeForPriorityProcessing({
          activeFence,
          commandBudget: input.commandBudget,
          input: input.input,
          record,
          runtimeWakeStartedAt: input.runtimeWakeStartedAt,
        });
      }
      if (!foregroundWaitingOnSystemMailbox) {
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
      if (foregroundWaitingOnSystemMailbox) {
        // The active system child accepted the wake so it can checkpoint and
        // release. It did not accept the requested default-mode processing.
        return this.createRetryLater({
          orchestrationAttemptId: input.input.orchestrationAttemptId,
          reason: "container_busy",
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
    if (!cleared.cleared) {
      const convergedInput = withoutSupersededRuntimeFenceDiagnostics(inputAtClearStart);
      return await this.ensureExistingRuntimeProcessing({
        commandBudget: input.commandBudget,
        input: cleared.record.writeFence
          ? withRuntimeProcessingOrchestration(convergedInput, {
              activeFenceObservedAtEpochMs: Date.now(),
            })
          : convergedInput,
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
    const replacementInput = withRuntimeProcessingOrchestration(inputAtClearStart, {
      replacedStaleFence: input.replacedStaleFence ?? true,
      replacementFenceClearElapsedMs: Math.max(
        0,
        replacementFenceClearedAtEpochMs - replacementFenceClearStartedAtEpochMs,
      ),
      replacementFenceClearedAtEpochMs,
    });
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
      return {
        aborted: false,
        response: this.createRetryLater({
          orchestrationAttemptId: input.orchestrationAttemptId,
          reason: abortStatus === "failed"
            ? "container_rpc_error"
            : "container_busy",
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
    return activeContainerName !== resolveHostedExecutionRunnerContainerName({
      source: this.input.runnerRuntimeEnvSource,
      userId: input.record.userId,
    });
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
    const runnerContainerName = runnerContainerIdentity.runnerContainerName;
    const pendingRunnerContainerName = initialRecord.pendingRunnerContainerName;
    if (
      pendingRunnerContainerName
      && pendingRunnerContainerName !== runnerContainerName
    ) {
      const destroyed = await destroyHostedExecutionContainer({
        runnerContainerName: pendingRunnerContainerName,
        runnerContainerNamespace: this.input.runnerContainerNamespace,
        userId: processingInput.userId,
      });
      if (!destroyed.ok) {
        return this.createRetryLater({
          orchestrationAttemptId: processingInput.orchestrationAttemptId,
          reason: "container_rpc_error",
          userId: processingInput.userId,
        });
      }
      const cleared =
        await this.input.stateStore.clearStoppedRunnerContainerForUserControl({
          runnerContainerName: pendingRunnerContainerName,
          userId: processingInput.userId,
        });
      if (!cleared) {
        return this.createRetryLater({
          orchestrationAttemptId: processingInput.orchestrationAttemptId,
          reason: "container_busy",
          userId: processingInput.userId,
        });
      }
    }
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

    const container = this.input.runnerContainerNamespace.getByName(
      input.runnerContainerName,
    );
    if (!container.ensureReadyForProcessing) {
      return await this.clearWriteFenceAfterStartupConfirmationFailure({
        error: new Error("Hosted runner container readiness method is unavailable."),
        input: input.input,
        retryReason: "container_rpc_error",
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
        input: input.input,
        retryReason: isRuntimeProcessingCommandBudgetTimeout(error)
          ? "command_budget_exhausted"
          : undefined,
        token: input.token,
      });
    }
  }

  private async clearWriteFenceAfterStartupConfirmationFailure(input: {
    error: unknown;
    input: RuntimeProcessingInput;
    retryReason?: RuntimeProcessingStartFailureRetryReason;
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
      token: input.token,
    });
  }

  private async clearWriteFenceAfterRuntimeStartFailure(input: {
    error: unknown;
    input: RuntimeProcessingInput;
    message: string;
    retryReason?: RuntimeProcessingStartFailureRetryReason;
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

class HostedRuntimeHealthDataConsentStopError extends Error {
  constructor() {
    super("Hosted runner container cleanup failed after health-data consent withdrawal.");
    this.name = "HostedRuntimeHealthDataConsentStopError";
  }
}

function normalizeRuntimeProcessingMode(
  value: RuntimeProcessingInput["processingMode"],
): RunnerRuntimeProcessingMode {
  return value === "inbox_media_retention" || value === "system_mailbox"
    ? value
    : "default";
}
