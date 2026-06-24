import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeEnsureProcessingRequest,
  HostedRuntimeEnsureProcessingResponse,
} from "@murphai/hosted-execution/orchestration-control";
import type {
  HostedRuntimeLatencyPhaseBreakdown,
} from "@murphai/hosted-execution/runtime-control";

import type { HostedExecutionEnvironment } from "../env.js";
import {
  type HostedExecutionContainerNamespaceLike,
} from "../runner-container.js";
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
  createRuntimeProcessingCommandBudget,
  isRuntimeProcessingCommandBudgetTimeout,
  readRuntimeProcessingCommandStepTimeoutMs,
  runRuntimeProcessingCommandStep,
  type RuntimeProcessingCommandBudget,
} from "./runtime-command-budget.js";
import {
  ensureActiveRuntimeProcessing,
} from "./runtime-container-wake.js";
import {
  computeRuntimeProcessingOwnerRecheckAt as computeRuntimeProcessingOwnerRecheckAtValue,
  computeRuntimeProcessingRetryAt as computeRuntimeProcessingRetryAtValue,
  createRuntimeProcessingRetryLater,
} from "./runtime-processing-responses.js";
import {
  RuntimeInvocationService,
  type PreparedRuntimeInvocation,
  type RuntimeInvocationInput,
} from "./runtime-invocation.js";
import {
  RunnerWriteFenceAlreadyActiveError,
  type RunnerStateStore,
  type RunnerWriteFenceToken,
} from "./runner-state-store.js";
import type {
  DurableObjectStateLike,
  RunnerStateRecord,
} from "./types.js";
import {
  RunnerAlarmCoordinator,
  runnerWriteFenceIdentityMatches,
  runnerWriteFenceTokensMatch,
} from "./alarm-coordinator.js";

const RUNTIME_PROCESSING_STARTUP_GRACE_MS = 30_000;
const RUNTIME_PROCESSING_STARTUP_CONFIRM_TIMEOUT_MS = 8_000;

export type RuntimeProcessingInput = HostedRuntimeEnsureProcessingRequest & {
  commandTimeoutMs?: number;
  orchestration?: RuntimeProcessingOrchestrationDiagnostics | null;
  userId: string;
};

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
    }
  | {
      kind: "retry";
      response: HostedRuntimeEnsureProcessingResponse;
    };

function toRuntimeInvocationInput(input: RuntimeProcessingInput): RuntimeInvocationInput {
  return {
    ...(input.orchestration ? { orchestration: input.orchestration } : {}),
    orchestrationAttemptId: input.orchestrationAttemptId,
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

export class RuntimeProcessingController {
  constructor(
    private readonly input: {
      env: HostedExecutionEnvironment;
      invocationService: RuntimeInvocationService;
      runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
      runnerRuntimeEnvSource: Readonly<Record<string, unknown>>;
      state: DurableObjectStateLike;
      stateStore: RunnerStateStore;
      alarmCoordinator: RunnerAlarmCoordinator;
    },
  ) {}

  async alarm(): Promise<void> {
    try {
      await this.syncRunnerAlarm(await this.input.stateStore.readState());
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: buildHostedRunnerMetadataOnlyErrorDetails(error),
        level: "warn",
        message: "Hosted runner alarm maintenance failed.",
        phase: "failed",
        userId: await this.tryReadBoundUserId(),
      });
      throw error;
    }
  }

  async ensureForUser(
    input: RuntimeProcessingInput,
  ): Promise<HostedRuntimeEnsureProcessingResponse> {
    const runtimeWakeStartedAt = Date.now();
    const processingInput = withRuntimeProcessingOrchestration(input, {
      userRunnerEnsureStartedAtEpochMs: runtimeWakeStartedAt,
    });
    const commandBudget = createRuntimeProcessingCommandBudget({
      commandTimeoutMs: processingInput.commandTimeoutMs ?? null,
      startedAtMs: runtimeWakeStartedAt,
      webControlTimeoutMs: this.input.env.webControlTimeoutMs,
    });
    await this.input.stateStore.bindUser(processingInput.userId);
    const record = await this.input.stateStore.readState();
    if (record.writeFence) {
      return await this.ensureExistingRuntimeProcessing({
        commandBudget,
        input: processingInput,
        record,
        runtimeWakeStartedAt,
      });
    }
    return await this.startRuntimeProcessing({
      action: "started",
      commandBudget,
      input: processingInput,
      runtimeWakeStartedAt,
    });
  }

  async syncRunnerAlarm(record: RunnerStateRecord): Promise<void> {
    await this.input.alarmCoordinator.sync(record);
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
      return await this.startRuntimeProcessing({
        action: "started",
        commandBudget: input.commandBudget,
        input: input.input,
        runtimeWakeStartedAt: input.runtimeWakeStartedAt,
      });
    }

    const activeFence = record.writeFence;
    if (activeFence.kind !== "runtime") {
      await this.syncRunnerAlarm(record);
      return createRuntimeProcessingRetryLater({
        reason: "container_busy",
        userId: input.input.userId,
      });
    }

    const activeWakeStartedAtEpochMs = Date.now();
    const containerResult = await ensureActiveRuntimeProcessing({
      activeRuntime: {
        attemptId: activeFence.attemptId,
        leaseGeneration: String(activeFence.generation),
        userId: record.userId,
      },
      commandBudget: input.commandBudget,
      env: this.input.env,
      runnerContainerName: activeFence.runnerContainerName,
      runnerContainerNamespace: this.input.runnerContainerNamespace,
      runnerRuntimeEnvSource: this.input.runnerRuntimeEnvSource,
    });
    const inputAfterActiveWake = withRuntimeProcessingOrchestration(input.input, {
      activeWakeAccepted: containerResult.kind === "accepted",
      activeWakeFinishedAtEpochMs: Date.now(),
      activeWakeStartedAtEpochMs,
    });

    if (containerResult.kind === "accepted") {
      await this.syncRunnerAlarm(record);
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
      if (this.shouldPreserveStartingWriteFence(activeFence)) {
        await this.syncRunnerAlarm(record);
        return createRuntimeProcessingRetryLater({
          reason: "container_rpc_timeout",
          userId: inputAfterActiveWake.userId,
        });
      }

      const recoveredCompletion =
        await this.input.invocationService.recoverAcceptedRuntimeCompletionAfterTransportFailure({
          executionInput: toRuntimeInvocationInput(inputAfterActiveWake),
          token: {
            attemptId: activeFence.attemptId,
            expiresAt: activeFence.expiresAt,
            generation: String(activeFence.generation),
            kind: activeFence.kind,
            leaseGeneration: String(activeFence.generation),
            providerEgressToken: null,
            runnerContainerName: activeFence.runnerContainerName,
            startedAt: activeFence.startedAt,
            userId: record.userId,
            workspaceVersion: activeFence.workspaceVersion,
          },
          workspaceVersion: activeFence.workspaceVersion,
        });
      if (recoveredCompletion.kind === "completed") {
        return {
          action: "already_running",
          kind: "runtime_processing_accepted",
          recommendedRecheckAt:
            this.computeRuntimeProcessingOwnerRecheckAt(),
          runtimeAttemptId: activeFence.attemptId,
        };
      }
      if (recoveredCompletion.kind === "unknown") {
        await this.syncRunnerAlarm(record);
        return createRuntimeProcessingRetryLater({
          reason: "container_rpc_error",
          userId: inputAfterActiveWake.userId,
        });
      }

      const cleared = await this.input.stateStore.clearWriteFenceForReplacement({
        attemptId: activeFence.attemptId,
        finishedAt: new Date().toISOString(),
        generation: String(activeFence.generation),
        userId: record.userId,
      });
      await this.syncRunnerAlarm(cleared.record);
      if (!cleared.cleared) {
        return createRuntimeProcessingRetryLater({
          reason: "stale_fence_replacement_race",
          userId: inputAfterActiveWake.userId,
        });
      }
      const replacementInput = withRuntimeProcessingOrchestration(inputAfterActiveWake, {
        replacedStaleFence: true,
        replacementFenceClearedAtEpochMs: Date.now(),
      });
      return await this.startRuntimeProcessing({
        action: "replaced",
        commandBudget: input.commandBudget,
        input: replacementInput,
        runtimeWakeStartedAt: input.runtimeWakeStartedAt,
      });
    }

    await this.syncRunnerAlarm(record);
    return createRuntimeProcessingRetryLater({
      reason: mapRunnerProcessingRetryReason(containerResult.reason),
      userId: input.input.userId,
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
      return createRuntimeProcessingRetryLater({
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
    let token: RunnerWriteFenceToken;
    try {
      token = await this.input.stateStore.beginWriteFence({
        runnerContainerName,
        userId: processingInput.userId,
      });
      processingInput = withRuntimeProcessingOrchestration(processingInput, {
        freshStartFenceBoundAtEpochMs: Date.now(),
      });
    } catch (error) {
      if (!(error instanceof RunnerWriteFenceAlreadyActiveError)) {
        throw error;
      }
      await this.syncRunnerAlarm(error.record);
      return await this.ensureExistingRuntimeProcessing({
        commandBudget: input.commandBudget,
        input: processingInput,
        record: error.record,
        runtimeWakeStartedAt: input.runtimeWakeStartedAt,
      });
    }

    await this.syncRunnerAlarm(await this.input.stateStore.readState());

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
    });
    const prepared: PreparedRuntimeInvocation = {
      ...preparation.prepared,
      input: toRuntimeInvocationInput(processingInput),
    };

    const stillOwnsPreparedFence = await this.confirmPreparedRuntimeWriteFenceIsActive({
      input: processingInput,
      token: prepared.token,
    });
    if (!stillOwnsPreparedFence) {
      return createRuntimeProcessingRetryLater({
        reason: "stale_fence_replacement_race",
        userId: processingInput.userId,
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
    const background = this.input.invocationService.invokePreparedWithFence({
      acceptedProcessingAttempt: true,
      prepared: acceptedPrepared,
      runtimeWakeStartedAt: input.runtimeWakeStartedAt,
    }).then(
      () => undefined,
      () => undefined,
    );
    this.input.state.waitUntil(background);

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

    const record = await this.input.stateStore.readState();
    await this.syncRunnerAlarm(record);
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
    | { confirmed: true }
    | {
        confirmed: false;
        response: HostedRuntimeEnsureProcessingResponse;
      }
  > {
    if (!this.input.runnerContainerNamespace) {
      return {
        confirmed: false,
        response: createRuntimeProcessingRetryLater({
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

    try {
      let timeoutMs = RUNTIME_PROCESSING_STARTUP_CONFIRM_TIMEOUT_MS;
      await runRuntimeProcessingCommandStep({
        budget: input.commandBudget,
        operation: async () => {
          timeoutMs = readRuntimeProcessingCommandStepTimeoutMs({
            budget: input.commandBudget,
            stepTimeoutMs: RUNTIME_PROCESSING_STARTUP_CONFIRM_TIMEOUT_MS,
          });
          return await container.ensureReadyForProcessing!({
            timeoutMs,
            userId: input.input.userId,
          });
        },
        stepTimeoutMs: RUNTIME_PROCESSING_STARTUP_CONFIRM_TIMEOUT_MS,
      });
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
      return { confirmed: true };
    } catch (error) {
      return await this.clearWriteFenceAfterStartupConfirmationFailure({
        error,
        input: input.input,
        retryReason: isRuntimeProcessingCommandBudgetTimeout(error)
          ? "container_rpc_timeout"
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
    await this.syncRunnerAlarm(failed.record);
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
      response: createRuntimeProcessingRetryLater({
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

  private async tryReadBoundUserId(): Promise<string | null> {
    try {
      return (await this.input.stateStore.readState()).userId;
    } catch {
      return null;
    }
  }
}
