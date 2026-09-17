import {
  RuntimeInvocationPreparation,
} from "../runtime-invocation-preparation.ts";
import type {
  PreparedRuntimeInvocation,
  RuntimeInvocationInput,
} from "../runtime-invocation-preparation.ts";
export { deriveHostedWorkspaceSnapshotPathHashSecret, normalizeHostedRunnerStringEnvValue, runHostedWorkspaceSnapshotRestorePreparationWithinBudget } from "../runtime-invocation-preparation.ts";
export type { PreparedRuntimeInvocation, RuntimeInvocationInput } from "../runtime-invocation-preparation.ts";

import {
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  parseHostedRuntimeLogResponse,
} from "@murphai/hosted-execution/parsers";




import {
  buildHostedRuntimeOwnerReleaseSearch,
  HOSTED_RUNTIME_LOG_PATH,
  HOSTED_RUNTIME_OWNER_RELEASED_PATH,
} from "@murphai/hosted-execution/routes";
import type {
  HostedRuntimeLogRequest,
  HostedRuntimeWebStatusResponse,
  HostedWorkspaceInvocationResult,
  HostedWorkspaceReadResponse,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";

import type {
  HostedExecutionEnvironment,
} from "../env.js";


import {
  invokeHostedExecutionContainerRunner,
  type HostedExecutionContainerNamespaceLike,
} from "../runner-container.js";








import {
  fetchHostedExecutionWebControlPlaneResponse,
} from "../web-control-plane.ts";

import type {
  WorkerRuntimeCompletionReceipt,
} from "../worker-contracts.js";
import {
  buildHostedRunnerMetadataOnlyErrorDetails,
  buildHostedRunnerRedactedErrorJson,
} from "./diagnostics.js";
import type {
  RuntimeProcessingCommandBudget,
} from "./runtime-command-budget.js";
import {
  isRuntimeProcessingCommandBudgetTimeout,
  runRuntimeProcessingCommandStep,
} from "./runtime-command-budget.js";
import {
  readRuntimeFenceLivenessBestEffort,
} from "./runtime-fence-liveness.js";
import type {
  RunnerWriteFenceToken,
} from "./runner-state-store.js";
import {
  RunnerStateStore,
} from "./runner-state-store.js";
import {
  RunnerStoreCache,
} from "./runner-store-cache.js";

const RUNTIME_ATTEMPT_LIVENESS_PROBE_TIMEOUT_MS = 5_000;
const RUNTIME_OWNER_RELEASE_CALLBACK_TIMEOUT_MS = 2_000;
type RuntimeAttemptLivenessProbeOutcome =
  | "active"
  | "error"
  | "inactive"
  | "mismatch"
  | "unsupported"
  | "timeout";
export type AcceptedRuntimeCompletionRecoveryResult =
  | {
      kind: "completed";
      result: HostedWorkspaceInvocationResult;
    }
  | {
      kind: "not_completed";
    }
  | {
      kind: "unknown";
    };
export class RuntimeInvocationService {
  private readonly preparation: RuntimeInvocationPreparation;
  constructor(
    private readonly input: {
      env: HostedExecutionEnvironment;
      runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null;
      runnerRuntimeEnvSource: Readonly<Record<string, unknown>>;
      runnerStoreCache: RunnerStoreCache;
      stateStore: RunnerStateStore;
      assertWorkspaceBelongsToRunnerUser(workspace: HostedWorkspaceState | null, userId: string): void;
      readHostedRuntimeStatusFromWeb(userId: string): Promise<HostedRuntimeWebStatusResponse>;
      readHostedWebControlBaseUrl(): string;
      readHostedWorkspaceFromWeb(
        userId: string,
        input?: { timeoutMs?: number },
      ): Promise<HostedWorkspaceReadResponse>;
      waitUntil(promise: Promise<unknown>): void;
    },
  ) {
    this.preparation = new RuntimeInvocationPreparation({
      ...input,
      bindInvocation: (facts) => input.stateStore.bindWriteFenceInvocationFacts(facts),
    });
  }

  async recordRuntimeCompletionFromContainer(
    input: WorkerRuntimeCompletionReceipt,
  ): Promise<{ completed: boolean }> {
    const token = await this.input.stateStore.readWriteFenceToken();
    if (
      token?.kind !== "runtime"
      || token.attemptId !== input.attemptId
      || token.generation !== input.generation
      || token.userId !== input.userId
    ) {
      return { completed: false };
    }

    return await this.recordRuntimeCompletionAfterInvoke({
      orchestrationAttemptId: null,
      result: input.result,
      token,
      userId: input.userId,
      workspaceVersion: token.workspaceVersion,
    });
  }

  prepareForFreshStart(input: Parameters<RuntimeInvocationPreparation["prepareForFreshStart"]>[0]) {
    return this.preparation.prepareForFreshStart(input);
  }

  prepareWithFence(input: Parameters<RuntimeInvocationPreparation["prepareWithFence"]>[0]) {
    return this.preparation.prepareWithFence(input);
  }

  async invokeWithFence(input: {
    input: RuntimeInvocationInput;
    runtimeWakeStartedAt: number;
    token: RunnerWriteFenceToken;
  }): Promise<HostedWorkspaceInvocationResult> {
    const executionInput = input.input;
    let prepared: PreparedRuntimeInvocation;
    try {
      prepared = await this.prepareWithFence({
        input: executionInput,
        token: input.token,
      });
    } catch (error) {
      const failed = await this.input.stateStore.clearWriteFenceAfterTransportFailure({
        error,
        finishedAt: new Date().toISOString(),
        token: input.token,
      });
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          orchestrationAttemptId: executionInput.orchestrationAttemptId,
          transportFailureFenceCleared: failed.failed,
          workspaceAttemptId: input.token.attemptId,
        },
        level: "warn",
        message: "Hosted runner runtime execution adapter failed.",
        phase: "failed",
        userId: executionInput.userId,
      });
      throw error;
    }

    return await this.invokePreparedWithFence({
      acceptedProcessingAttempt: false,
      prepared,
      runtimeWakeStartedAt: input.runtimeWakeStartedAt,
    });
  }

  async invokePreparedWithFence(input: {
    acceptedProcessingAttempt: boolean;
    prepared: PreparedRuntimeInvocation;
    runtimeWakeStartedAt: number;
  }): Promise<HostedWorkspaceInvocationResult> {
    const executionInput = input.prepared.input;
    const token = input.prepared.token;
    const workspaceCheckpointedAt =
      input.prepared.workspaceCheckpointedAt;
    const workspaceVersion = input.prepared.workspaceVersion;
    let result: HostedWorkspaceInvocationResult;
    try {
      result = await this.invokePreparedWorkspaceRunner(input.prepared);
    } catch (error) {
      // A failed transport call does not prove the invocation died. Probe the
      // container before revoking authority: clearing the fence under a live
      // invocation orphans it as an unwakeable zombie that blocks the runner
      // slot until its idle timer expires.
      const probeOutcome = await this.readPreparedAttemptLivenessBestEffort(
        input.prepared,
      );
      if (probeOutcome === "active") {
        if (input.acceptedProcessingAttempt) {
          await this.recordAcceptedRuntimeAttemptFailureBestEffort({
            error,
            executionInput,
            probeOutcome,
            token,
            workspaceVersion,
          });
        }
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            ...buildHostedRunnerMetadataOnlyErrorDetails(error),
            orchestrationAttemptId: executionInput.orchestrationAttemptId,
            transportFailureFenceCleared: false,
            workspaceAttemptId: token.attemptId,
          },
          level: "warn",
          message:
            "Hosted runner runtime transport failed while the invocation is still active; keeping the write fence.",
          phase: "failed",
          userId: executionInput.userId,
        });
        throw error;
      }

      if (
        input.acceptedProcessingAttempt
        && probeOutcome === "inactive"
      ) {
        const committedResult =
          await this.recoverAcceptedRuntimeCompletionFromCommittedProgress({
            executionInput,
            transportError: error,
            token,
            workspaceCheckpointedAt,
            workspaceVersion,
          });
        if (committedResult.kind === "completed") {
          return committedResult.result;
        }
        if (committedResult.kind === "unknown") {
          throw error;
        }
      }
      const preserveFence =
        probeOutcome === "error"
        || probeOutcome === "timeout"
        || probeOutcome === "unsupported"
        || (input.acceptedProcessingAttempt && probeOutcome === "inactive");
      if (preserveFence) {
        if (input.acceptedProcessingAttempt) {
          await this.recordAcceptedRuntimeAttemptFailureBestEffort({
            error,
            executionInput,
            fenceCleared: false,
            probeOutcome,
            token,
            workspaceVersion,
          });
        }
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            ...buildHostedRunnerMetadataOnlyErrorDetails(error),
            orchestrationAttemptId: executionInput.orchestrationAttemptId,
            transportFailureFenceCleared: false,
            workspaceAttemptId: token.attemptId,
            workspaceVersion,
          },
          level: "warn",
          message:
            "Hosted runner runtime transport failed without safe fence-clear proof; preserving the write fence.",
          phase: "failed",
          userId: executionInput.userId,
        });
        throw error;
      }

      const failed = await this.input.stateStore.clearWriteFenceAfterTransportFailure({
        error,
        finishedAt: new Date().toISOString(),
        token,
      });
      if (input.acceptedProcessingAttempt && failed.failed) {
        await this.recordAcceptedRuntimeAttemptFailureBestEffort({
          error,
          executionInput,
          probeOutcome,
          token,
          workspaceVersion,
        });
      }
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          orchestrationAttemptId: executionInput.orchestrationAttemptId,
          transportFailureFenceCleared: failed.failed,
          workspaceAttemptId: token.attemptId,
          workspaceVersion,
        },
        level: "warn",
        message: "Hosted runner runtime execution adapter failed.",
        phase: "failed",
        userId: executionInput.userId,
      });
      throw error;
    }

    await this.recordRuntimeCompletionAfterInvoke({
      orchestrationAttemptId: executionInput.orchestrationAttemptId,
      result,
      token,
      userId: executionInput.userId,
      workspaceVersion,
    });

    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        runtimeResultImmediateRecheckRequested:
          result.immediateRecheckRequested === true,
        orchestrationAttemptId: executionInput.orchestrationAttemptId,
        runtimeExecutionDurationMs: Date.now() - input.runtimeWakeStartedAt,
        runtimeResultNextWakeAtPresent: result.nextWakeAt != null,
        runtimeResultNextWakeReasonPresent: result.nextWakeReason != null,
        workspaceAttemptId: token.attemptId,
        workspaceStatus: result.status,
        workspaceVersion,
      },
      message: "Hosted runner runtime execution adapter completed.",
      phase: "checkpoint",
      userId: executionInput.userId,
    });

    return result;
  }

  async recoverAcceptedRuntimeCompletionFromCommittedProgress(input: {
    commandBudget?: RuntimeProcessingCommandBudget;
    executionInput: RuntimeInvocationInput;
    token: RunnerWriteFenceToken;
    transportError?: unknown;
    workspaceCheckpointedAt: string | null;
    workspaceVersion: string | null;
  }): Promise<AcceptedRuntimeCompletionRecoveryResult> {
    if (input.workspaceVersion === null) {
      return { kind: "not_completed" };
    }
    const committedResult =
      await this.readAcceptedRuntimeCommittedProgressAfterTransportFailure({
        commandBudget: input.commandBudget ?? null,
        executionInput: input.executionInput,
        workspaceCheckpointedAt: input.workspaceCheckpointedAt,
        workspaceVersion: input.workspaceVersion,
      });
    if (committedResult.kind !== "completed") {
      return committedResult;
    }

    await this.recordRuntimeCompletionAfterInvoke({
      orchestrationAttemptId: input.executionInput.orchestrationAttemptId,
      result: committedResult.result,
      token: input.token,
      userId: input.executionInput.userId,
      workspaceVersion: input.workspaceVersion,
    });
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        ...(input.transportError === undefined
          ? {}
          : buildHostedRunnerMetadataOnlyErrorDetails(input.transportError)),
        orchestrationAttemptId: input.executionInput.orchestrationAttemptId,
        workspaceAttemptId: input.token.attemptId,
        workspaceVersion: input.workspaceVersion,
      },
      level: "warn",
      message: input.transportError === undefined
        ? "Hosted runner accepted runtime attempt committed progress; completing the active write fence."
        : "Hosted runner accepted runtime attempt committed progress despite transport failure.",
      phase: "checkpoint",
      userId: input.executionInput.userId,
    });
    return {
      kind: "completed",
      result: committedResult.result,
    };
  }

  private async readAcceptedRuntimeCommittedProgressAfterTransportFailure(input: {
    commandBudget: RuntimeProcessingCommandBudget | null;
    executionInput: RuntimeInvocationInput;
    workspaceCheckpointedAt: string | null;
    workspaceVersion: string;
  }): Promise<AcceptedRuntimeCompletionRecoveryResult> {
    let status: HostedRuntimeWebStatusResponse;
    try {
      const readStatus = async () =>
        await this.input.readHostedRuntimeStatusFromWeb(
          input.executionInput.userId,
        );
      status = input.commandBudget
        ? await runRuntimeProcessingCommandStep({
            budget: input.commandBudget,
            operation: readStatus,
            stepTimeoutMs: this.input.env.webControlTimeoutMs,
          })
        : await readStatus();
    } catch (error) {
      if (isRuntimeProcessingCommandBudgetTimeout(error)) {
        return { kind: "unknown" };
      }
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          orchestrationAttemptId: input.executionInput.orchestrationAttemptId,
          workspaceVersion: input.workspaceVersion,
        },
        level: "warn",
        message: "Hosted runner accepted runtime progress recheck failed after transport failure.",
        phase: "failed",
        userId: input.executionInput.userId,
      });
      return { kind: "unknown" };
    }

    // A real runtime commit advances both the workspace CAS version and its
    // checkpoint timestamp. Administrative metadata transitions may advance
    // the version alone to invalidate stale writers, so version-only movement
    // cannot prove an accepted invocation completed.
    if (
      !status.workspace
      || !isHostedRuntimeWorkspaceVersionAfter(
        status.workspace.version,
        input.workspaceVersion,
      )
      || !didHostedRuntimeCheckpointAdvance({
        currentCheckpointedAt:
          status.workspace.checkpointedAt ?? null,
        previousCheckpointedAt: input.workspaceCheckpointedAt,
      })
    ) {
      return { kind: "not_completed" };
    }

    const recoveredResult: HostedWorkspaceInvocationResult = {
      nextWakeAt: status.workspace.nextWakeAt,
      nextWakeReason: status.workspace.nextWakeReason,
      redactedStatus: status.workspace.redactedStatus,
      status: "idle",
    };
    const recoveredNextWakeAtMs = status.workspace.nextWakeAt
      ? Date.parse(status.workspace.nextWakeAt)
      : Number.NaN;

    return {
      kind: "completed",
      result: {
        // Transport loss erased attempt-local wake provenance. A recovered due
        // wake gets one conservative fact re-read; future wakes retain their
        // authoritative timer, and normal no-progress completions omit the edge.
        ...(Number.isFinite(recoveredNextWakeAtMs)
            && recoveredNextWakeAtMs <= Date.now()
          ? { immediateRecheckRequested: true as const }
          : {}),
        ...recoveredResult,
      },
    };
  }

  private async recordRuntimeCompletionAfterInvoke(input: {
    orchestrationAttemptId: string | null;
    result: HostedWorkspaceInvocationResult;
    token: RunnerWriteFenceToken;
    userId: string;
    workspaceVersion: string | null;
  }): Promise<{ completed: boolean }> {
    try {
      const completed = await this.input.stateStore.clearWriteFenceAfterCompletion({
        finishedAt: new Date().toISOString(),
        token: input.token,
      });
      if (!completed.completed) {
        if (completed.record.writeFence !== null) {
          emitHostedExecutionStructuredLog({
            component: "hosted.runner",
            details: {
              ...(input.orchestrationAttemptId === null
                ? {}
                : { orchestrationAttemptId: input.orchestrationAttemptId }),
              workspaceAttemptId: input.token.attemptId,
              workspaceVersion: input.workspaceVersion,
            },
            level: "warn",
            message: "Hosted runner runtime execution completed after its write fence changed; preserving completed result without transport retry.",
            phase: "checkpoint",
            userId: input.userId,
          });
        }
        return { completed: false };
      }
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          ...(input.orchestrationAttemptId === null
            ? {}
            : { orchestrationAttemptId: input.orchestrationAttemptId }),
          workspaceAttemptId: input.token.attemptId,
          workspaceVersion: input.workspaceVersion,
        },
        level: "warn",
        message: "Hosted runner runtime execution completed but completion recording failed; preserving completed result without transport retry.",
        phase: "checkpoint",
        userId: input.userId,
      });
      return { completed: false };
    }

    this.input.waitUntil(
      this.notifyRunnerContainerCompletionRecordedBestEffort(input),
    );
    await this.notifyRuntimeOwnerReleasedBestEffort(input);
    return { completed: true };
  }

  private async notifyRunnerContainerCompletionRecordedBestEffort(input: {
    token: RunnerWriteFenceToken;
    userId: string;
  }): Promise<void> {
    try {
      if (!this.input.runnerContainerNamespace) {
        return;
      }
      const runnerContainerName = input.token.runnerContainerName ?? input.userId;
      const container = this.input.runnerContainerNamespace.getByName(
        runnerContainerName,
      );
      if (!container.onRuntimeCompletionRecorded) {
        return;
      }
      await container.onRuntimeCompletionRecorded({
        attemptId: input.token.attemptId,
        leaseGeneration: input.token.generation,
        userId: input.userId,
      });
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          workspaceAttemptId: input.token.attemptId,
        },
        level: "warn",
        message:
          "Hosted runner completion cleanup notification failed; preserving the lifecycle timer fallback.",
        phase: "checkpoint",
        userId: input.userId,
      });
    }
  }

  private async notifyRuntimeOwnerReleasedBestEffort(input: {
    orchestrationAttemptId: string | null;
    result: HostedWorkspaceInvocationResult;
    token: RunnerWriteFenceToken;
    userId: string;
    workspaceVersion: string | null;
  }): Promise<void> {
    try {
      const response = await fetchHostedExecutionWebControlPlaneResponse({
        ...(this.input.env.hostedWebAllowHttpHosts
          ? { allowHttpHosts: this.input.env.hostedWebAllowHttpHosts }
          : {}),
        baseUrl: this.input.readHostedWebControlBaseUrl(),
        boundUserId: input.userId,
        callbackSigning: this.input.env.webCallbackSigning,
        method: "POST",
        path: HOSTED_RUNTIME_OWNER_RELEASED_PATH,
        search: buildHostedRuntimeOwnerReleaseSearch({
          immediateRecheckRequested:
            input.result.immediateRecheckRequested === true,
          runtimeAttemptId: input.token.attemptId,
        }),
        timeoutMs: Math.min(
          this.input.env.webControlTimeoutMs,
          RUNTIME_OWNER_RELEASE_CALLBACK_TIMEOUT_MS,
        ),
      });

      if (!response.ok) {
        throw new Error(
          `Hosted runtime owner-release callback failed with HTTP ${response.status}.`,
        );
      }
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          ...(input.orchestrationAttemptId === null
            ? {}
            : { orchestrationAttemptId: input.orchestrationAttemptId }),
          workspaceAttemptId: input.token.attemptId,
          workspaceVersion: input.workspaceVersion,
        },
        level: "warn",
        message:
          "Hosted runner runtime owner-release recheck callback failed; preserving completed result.",
        phase: "checkpoint",
        userId: input.userId,
      });
    }
  }

  private async invokePreparedWorkspaceRunner(
    input: PreparedRuntimeInvocation,
  ): Promise<HostedWorkspaceInvocationResult> {
    if (!this.input.runnerContainerNamespace) {
      throw new Error("Native hosted execution requires a RunnerContainer binding.");
    }

    return await invokeHostedExecutionContainerRunner({
      job: input.job,
      orchestration: input.input.orchestration ?? null,
      runnerContainerName: input.runnerContainerName,
      runnerContainerNamespace: this.input.runnerContainerNamespace,
      userId: input.input.userId,
    });
  }

  /**
   * Best-effort check that the prepared invocation's Durable Object operation
   * is still in flight inside the RunnerContainer. "Active" means the DO-side
   * invoke for this exact fence identity has not settled — including its
   * pre-dispatch readiness window. Keeping the fence is correct across that
   * whole window: a live DO invoke either proceeds to run the invocation under
   * the intact fence, or dies and releases the container slot, after which the
   * pre-existing stale-fence replacement path reclaims the fence. Accepted
   * background invocations also keep the fence when durable progress is not
   * visible yet unless the probe positively identifies a different child. The
   * next ensure command uses the identity-aware wake endpoint to distinguish a
   * lost local pointer from a truly missing child.
   */
  private async readPreparedAttemptLivenessBestEffort(
    prepared: PreparedRuntimeInvocation,
  ): Promise<RuntimeAttemptLivenessProbeOutcome> {
    const liveness = await readRuntimeFenceLivenessBestEffort({
      commandBudget: null,
      identity: {
        attemptId: prepared.token.attemptId,
        // The container records the generation from the job request; compare
        // against that single source of truth.
        leaseGeneration: prepared.job.request.leaseGeneration,
        userId: prepared.input.userId,
      },
      runnerContainerName: prepared.runnerContainerName,
      runnerContainerNamespace: this.input.runnerContainerNamespace,
      stepTimeoutMs: RUNTIME_ATTEMPT_LIVENESS_PROBE_TIMEOUT_MS,
    });
    if (liveness.outcome === "exact-active") {
      return "active";
    }
    if (liveness.outcome === "inactive" || liveness.outcome === "mismatch") {
      return liveness.outcome;
    }

    if (liveness.reason === "timeout") {
      this.emitAttemptLivenessProbeUnconfirmedLog({
        ...(liveness.error !== undefined ? { error: liveness.error } : {}),
        prepared,
        probeOutcome: "timeout",
      });
      return "timeout";
    }
    if (liveness.reason === "error") {
      this.emitAttemptLivenessProbeUnconfirmedLog({
        ...(liveness.error !== undefined ? { error: liveness.error } : {}),
        prepared,
        probeOutcome: "error",
      });
      return "error";
    }
    return "unsupported";
  }

  private emitAttemptLivenessProbeUnconfirmedLog(input: {
    error?: unknown;
    prepared: PreparedRuntimeInvocation;
    probeOutcome: "error" | "timeout";
  }): void {
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
        ...(input.error === undefined
          ? {}
          : buildHostedRunnerMetadataOnlyErrorDetails(input.error)),
        attemptLivenessProbeOutcome: input.probeOutcome,
        orchestrationAttemptId: input.prepared.input.orchestrationAttemptId,
        workspaceAttemptId: input.prepared.token.attemptId,
      },
      level: "warn",
      message:
        "Hosted runner attempt liveness probe was unconfirmed.",
      phase: "failed",
      userId: input.prepared.input.userId,
    });
  }

  private async recordAcceptedRuntimeAttemptFailureBestEffort(input: {
    error: unknown;
    executionInput: RuntimeInvocationInput;
    fenceCleared?: boolean;
    probeOutcome: RuntimeAttemptLivenessProbeOutcome;
    token: RunnerWriteFenceToken;
    workspaceVersion: string;
  }): Promise<void> {
    const attemptStillActive = input.probeOutcome === "active";
    const fenceCleared = input.fenceCleared ?? !attemptStillActive;
    if (
      !fenceCleared
      && !await this.acceptedRuntimeAttemptStillOwnsFenceBestEffort(input.token)
    ) {
      return;
    }
    const body = {
      entries: [
        {
          at: new Date().toISOString(),
          attemptId: input.token.attemptId,
          component: "runner",
          errorCode: deriveHostedExecutionErrorCode(input.error),
          eventCode: "runner.accepted_attempt_failed",
          leaseGeneration: input.token.generation,
          level: "warn",
          phase: "error",
          redactedJson: {
            ...buildHostedRunnerRedactedErrorJson(input.error),
            attemptLivenessProbeOutcome: input.probeOutcome,
            attemptStillActive,
            fenceCleared,
          },
          workspaceVersion: input.workspaceVersion,
        },
      ],
    } satisfies HostedRuntimeLogRequest;

    try {
      const response = await fetchHostedExecutionWebControlPlaneResponse({
        ...(this.input.env.hostedWebAllowHttpHosts
          ? { allowHttpHosts: this.input.env.hostedWebAllowHttpHosts }
          : {}),
        baseUrl: this.input.readHostedWebControlBaseUrl(),
        body: JSON.stringify(body),
        boundUserId: input.executionInput.userId,
        callbackSigning: this.input.env.webCallbackSigning,
        method: "POST",
        path: HOSTED_RUNTIME_LOG_PATH,
        timeoutMs: this.input.env.webControlTimeoutMs,
      });

      if (!response.ok) {
        throw new Error(`Hosted runtime log write failed with HTTP ${response.status}.`);
      }

      parseHostedRuntimeLogResponse(await response.json());
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          orchestrationAttemptIdPresent:
            input.executionInput.orchestrationAttemptId.length > 0,
          workspaceAttemptIdPresent: input.token.attemptId.length > 0,
          workspaceVersion: input.workspaceVersion,
        },
        level: "warn",
        message: "Hosted runner accepted runtime attempt failure log write failed.",
        phase: "failed",
        userId: input.executionInput.userId,
      });
    }
  }

  private async acceptedRuntimeAttemptStillOwnsFenceBestEffort(
    token: RunnerWriteFenceToken,
  ): Promise<boolean> {
    try {
      const current = await this.input.stateStore.readWriteFenceToken();
      return current !== null
        && current.attemptId === token.attemptId
        && current.generation === token.generation
        && current.userId === token.userId;
    } catch {
      return true;
    }
  }
}

function nullableRunnerValue<T>(value: T | undefined): T | null {
  return value ?? null;
}

export function isHostedRuntimeWorkspaceVersionAfter(
  nextVersion: string,
  previousVersion: string,
): boolean {
  try {
    return BigInt(nextVersion) > BigInt(previousVersion);
  } catch {
    return false;
  }
}

function didHostedRuntimeCheckpointAdvance(input: {
  currentCheckpointedAt: string | null;
  previousCheckpointedAt: string | null;
}): boolean {
  return input.currentCheckpointedAt !== null
    && input.currentCheckpointedAt !== input.previousCheckpointedAt;
}
