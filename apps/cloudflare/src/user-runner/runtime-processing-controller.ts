import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  HOSTED_RUNTIME_PREWARM_TIMEOUT_MS,
} from "@murphai/hosted-execution/contracts";
import type {
  HostedRuntimeEnsureProcessingRequest,
  HostedRuntimeEnsureProcessingResponse,
  HostedRuntimePrewarmRequest,
  HostedRuntimePrewarmResponse,
} from "@murphai/hosted-execution/orchestration-control";

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
  readRuntimeProcessingCommandStepTimeoutMs,
  type RuntimeProcessingCommandBudget,
} from "./runtime-command-budget.js";
import {
  ensureActiveRuntimeProcessing,
} from "./runtime-container-wake.js";
import {
  computeRuntimeProcessingOwnerRecheckAt as computeRuntimeProcessingOwnerRecheckAtValue,
  computeRuntimeProcessingRetryAt as computeRuntimeProcessingRetryAtValue,
  createRuntimePrewarmRetryLater,
  createRuntimeProcessingRetryLater,
  recordRuntimePrewarmAccepted,
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
  runnerWriteFenceTokensMatch,
} from "./alarm-coordinator.js";
import {
  isDeploySmokeWriteFenceStale,
} from "./runner-state-helpers.js";

const RUNTIME_PROCESSING_STARTUP_GRACE_MS = 30_000;
const RUNTIME_PROCESSING_STARTUP_CONFIRM_TIMEOUT_MS = 8_000;

export type RuntimeProcessingInput = HostedRuntimeEnsureProcessingRequest & {
  commandTimeoutMs?: number;
  userId: string;
};

export type RuntimePrewarmInput = HostedRuntimePrewarmRequest & {
  userId: string;
};

function toRuntimeInvocationInput(input: RuntimeProcessingInput): RuntimeInvocationInput {
  return {
    orchestrationAttemptId: input.orchestrationAttemptId,
    reason: input.reason,
    ...(input.source ? { source: input.source } : {}),
    userId: input.userId,
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
    const commandBudget = createRuntimeProcessingCommandBudget({
      commandTimeoutMs: input.commandTimeoutMs ?? null,
      startedAtMs: runtimeWakeStartedAt,
      webControlTimeoutMs: this.input.env.webControlTimeoutMs,
    });
    await this.input.stateStore.bindUser(input.userId);
    const record = await this.input.stateStore.readState();
    if (record.writeFence) {
      return await this.ensureExistingRuntimeProcessing({
        commandBudget,
        input,
        record,
        runtimeWakeStartedAt,
      });
    }
    return await this.startRuntimeProcessing({
      action: "started",
      commandBudget,
      input,
      runtimeWakeStartedAt,
    });
  }

  async prewarmForUser(
    input: RuntimePrewarmInput,
  ): Promise<HostedRuntimePrewarmResponse> {
    await this.input.stateStore.bindUser(input.userId);
    const record = await this.input.stateStore.readState();
    if (record.writeFence) {
      return recordRuntimePrewarmAccepted({
        action: "already_running",
        input,
      });
    }

    if (!this.input.runnerContainerNamespace) {
      return createRuntimePrewarmRetryLater({
        reason: "missing_container_binding",
        userId: input.userId,
      });
    }

    const container = this.input.runnerContainerNamespace.getByName(
      resolveHostedExecutionRunnerContainerName({
        source: this.input.runnerRuntimeEnvSource,
        userId: input.userId,
      }),
    );
    if (!container.prewarmForProcessing) {
      return createRuntimePrewarmRetryLater({
        reason: "container_rpc_error",
        userId: input.userId,
      });
    }

    try {
      const result = await container.prewarmForProcessing({
        timeoutMs: HOSTED_RUNTIME_PREWARM_TIMEOUT_MS,
        userId: input.userId,
      });
      if (result.kind === "busy") {
        return createRuntimePrewarmRetryLater({
          reason: "container_busy",
          userId: input.userId,
        });
      }
      return recordRuntimePrewarmAccepted({
        action: result.action ?? "started",
        input,
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          prewarmAttemptIdPresent: input.prewarmAttemptId.length > 0,
          source: input.source,
        },
        error,
        level: "warn",
        message: "Hosted runner runtime prewarm failed best-effort.",
        phase: "runtime.prewarm",
        userId: input.userId,
      });
      return createRuntimePrewarmRetryLater({
        reason: "container_rpc_error",
        userId: input.userId,
      });
    }
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
      if (
        activeFence.kind === "deploy_smoke"
        && isDeploySmokeWriteFenceStale(activeFence)
      ) {
        const cleared = await this.input.stateStore.clearWriteFenceForReplacement({
          attemptId: activeFence.attemptId,
          finishedAt: new Date().toISOString(),
          generation: String(activeFence.generation),
          userId: record.userId,
        });
        await this.syncRunnerAlarm(cleared.record);
        if (cleared.cleared) {
          return await this.startRuntimeProcessing({
            action: "replaced",
            commandBudget: input.commandBudget,
            input: input.input,
            runtimeWakeStartedAt: input.runtimeWakeStartedAt,
          });
        }
        return createRuntimeProcessingRetryLater({
          reason: "stale_fence_replacement_race",
          userId: input.input.userId,
        });
      }
      await this.syncRunnerAlarm(record);
      return createRuntimeProcessingRetryLater({
        reason: "container_busy",
        userId: input.input.userId,
      });
    }

    const containerResult = await ensureActiveRuntimeProcessing({
      activeRuntime: {
        attemptId: activeFence.attemptId,
        leaseGeneration: String(activeFence.generation),
        userId: record.userId,
      },
      commandBudget: input.commandBudget,
      env: this.input.env,
      reason: input.input.reason,
      runnerContainerName: activeFence.runnerContainerName,
      runnerContainerNamespace: this.input.runnerContainerNamespace,
      runnerRuntimeEnvSource: this.input.runnerRuntimeEnvSource,
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
          userId: input.input.userId,
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
          userId: input.input.userId,
        });
      }
      return await this.startRuntimeProcessing({
        action: "replaced",
        commandBudget: input.commandBudget,
        input: input.input,
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
    const initialRecord = await this.input.stateStore.readState();
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        ...buildRunnerRecordTimingLogDetails(initialRecord),
        orchestrationAttemptId: input.input.orchestrationAttemptId,
        runtimeReason: input.input.reason,
      },
      message: "Hosted runner runtime processing start requested.",
      phase: "runtime.starting",
      userId: input.input.userId,
    });

    if (!this.input.runnerContainerNamespace) {
      return createRuntimeProcessingRetryLater({
        reason: "missing_container_binding",
        userId: input.input.userId,
      });
    }

    const runnerContainerIdentity = readHostedRunnerContainerIdentity({
      containerName: resolveHostedExecutionRunnerContainerName({
        source: this.input.runnerRuntimeEnvSource,
        userId: input.input.userId,
      }),
      source: this.input.runnerRuntimeEnvSource,
    });
    if (!runnerContainerIdentity || runnerContainerIdentity.userId !== input.input.userId) {
      throw new Error("Hosted runner container identity did not match the runtime start user.");
    }
    const runnerContainerName = runnerContainerIdentity.runnerContainerName;
    let token: RunnerWriteFenceToken;
    try {
      token = await this.input.stateStore.beginWriteFence({
        kind: "runtime",
        reason: input.input.reason,
        runnerContainerName,
        userId: input.input.userId,
      });
    } catch (error) {
      if (!(error instanceof RunnerWriteFenceAlreadyActiveError)) {
        throw error;
      }
      await this.syncRunnerAlarm(error.record);
      return await this.ensureExistingRuntimeProcessing({
        commandBudget: input.commandBudget,
        input: input.input,
        record: error.record,
        runtimeWakeStartedAt: input.runtimeWakeStartedAt,
      });
    }

    await this.syncRunnerAlarm(await this.input.stateStore.readState());

    const executionInput = toRuntimeInvocationInput(input.input);
    let prepared: PreparedRuntimeInvocation;
    try {
      prepared = await this.input.invocationService.prepareWithFence({
        commandBudget: input.commandBudget,
        input: executionInput,
        token,
      });
    } catch (error) {
      const failed = await this.clearWriteFenceAfterRuntimeStartFailure({
        error,
        input: input.input,
        message: "Hosted runner runtime processing preparation failed.",
        token,
      });
      return failed.response;
    }

    const startupConfirmed = await this.confirmRuntimeContainerStartup({
      commandBudget: input.commandBudget,
      input: input.input,
      runnerContainerName: prepared.runnerContainerName,
      token: prepared.token,
    });
    if (!startupConfirmed.confirmed) {
      return startupConfirmed.response;
    }

    const stillOwnsPreparedFence = await this.confirmPreparedRuntimeWriteFenceIsActive({
      input: input.input,
      token: prepared.token,
    });
    if (!stillOwnsPreparedFence) {
      return createRuntimeProcessingRetryLater({
        reason: "stale_fence_replacement_race",
        userId: input.input.userId,
      });
    }

    const background = this.input.invocationService.invokePreparedWithFence({
      acceptedProcessingAttempt: true,
      prepared,
      runtimeWakeStartedAt: input.runtimeWakeStartedAt,
    }).then(
      () => undefined,
      () => undefined,
    );
    this.input.state.waitUntil(background);

    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        orchestrationAttemptId: input.input.orchestrationAttemptId,
        runtimeProcessingAction: input.action,
        workspaceAttemptId: prepared.token.attemptId,
        workspaceReason: input.input.reason,
      },
      message: "Hosted runner runtime processing accepted.",
      phase: "runtime.starting",
      userId: input.input.userId,
    });

    return {
      action: input.action,
      kind: "runtime_processing_accepted",
      recommendedRecheckAt: this.computeRuntimeProcessingOwnerRecheckAt(),
      runtimeAttemptId: prepared.token.attemptId,
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
        workspaceReason: input.input.reason,
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
      const timeoutMs = readRuntimeProcessingCommandStepTimeoutMs({
        budget: input.commandBudget,
        stepTimeoutMs: RUNTIME_PROCESSING_STARTUP_CONFIRM_TIMEOUT_MS,
      });
      await container.ensureReadyForProcessing({
        timeoutMs,
        userId: input.input.userId,
      });
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          orchestrationAttemptId: input.input.orchestrationAttemptId,
          runtimeStartupConfirmTimeoutMs: timeoutMs,
          workspaceAttemptId: input.token.attemptId,
          workspaceReason: input.input.reason,
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
        workspaceReason: input.input.reason,
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
