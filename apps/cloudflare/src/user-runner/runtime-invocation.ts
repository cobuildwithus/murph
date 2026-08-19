import {
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  parseHostedRuntimeLogResponse,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedAssistantModelOverride,
  HostedAssistantProviderOverride,
  HostedAssistantReasoningEffortOverride,
} from "@murphai/hosted-execution/assistant-model";
import type {
  HostedAssistantCustomInferenceOverride,
} from "@murphai/hosted-execution/assistant-inference";
import {
  HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON,
} from "@murphai/hosted-execution/orchestration-control";
import {
  HOSTED_RUNTIME_LOG_PATH,
  HOSTED_RUNTIME_OWNER_RELEASE_IMMEDIATE_RECHECK_QUERY,
  HOSTED_RUNTIME_OWNER_RELEASED_PATH,
} from "@murphai/hosted-execution/routes";
import {
  isHostedRuntimeFutureMailboxContinuation,
  type HostedRuntimeLatencyPhaseBreakdown,
  type HostedRuntimeLogRequest,
  type HostedRuntimeWebStatusResponse,
  type HostedWorkspaceInvocationProcessingMode,
  type HostedWorkspaceInvocationResult,
  type HostedWorkspaceReadResponse,
  type HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";

import type { HostedExecutionEnvironment } from "../env.js";
import {
  hasHostedRunnerModelCredential,
  isHostedRunnerOpenAiProvider,
  isHostedRunnerVeniceProvider,
} from "../hosted-env-policy.ts";
import {
  buildHostedRunnerContainerEnv,
  buildHostedRunnerJobRuntimeConfig,
} from "../runner-env.ts";
import {
  invokeHostedExecutionContainerRunner,
  type HostedExecutionContainerNamespaceLike,
} from "../runner-container.js";
import {
  readHostedRunnerContainerIdentity,
} from "../hosted-runner-container-identity.js";
import {
  createHostedProviderEgressCredential,
} from "../hosted-provider-egress-credential.js";
import {
  parseHostedInferenceRuntimeTarget,
  type HostedInferenceRuntimeTarget,
} from "../hosted-inference-runtime-target.ts";
import {
  sealHostedInferenceRuntimeTarget,
} from "../hosted-inference-target-envelope.ts";
import {
  readHostedProviderCredentialDiagnosticKind,
} from "../hosted-provider-credential-diagnostics.js";
import {
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
} from "../runner-injected-credential.ts";
import {
  HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND,
  type HostedExecutionWorkspaceInvocationJobInput,
} from "../runner-job-transport.js";
import {
  fetchHostedExecutionWebControlPlaneResponse,
} from "../web-control-plane.ts";
import {
  prepareHostedWorkspaceSnapshotRestore,
  type HostedWorkspaceSnapshotPreparedRestore,
} from "../workspace-snapshot-restore-preparation.ts";
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
  readRuntimeProcessingCommandStepTimeoutMs,
  runRuntimeProcessingCommandStep,
} from "./runtime-command-budget.js";
import {
  readRuntimeFenceLivenessBestEffort,
} from "./runtime-fence-liveness.js";
import type { RunnerWriteFenceToken } from "./runner-state-store.js";
import { RunnerStateStore } from "./runner-state-store.js";
import { RunnerStoreCache } from "./runner-store-cache.js";

const RUNTIME_ATTEMPT_LIVENESS_PROBE_TIMEOUT_MS = 5_000;
const RUNTIME_OWNER_RELEASE_CALLBACK_TIMEOUT_MS = 2_000;
const HOSTED_INFERENCE_RUNTIME_TARGET_MAX_BODY_BYTES = 16 * 1024;
const HOSTED_INFERENCE_RUNTIME_TARGET_PATH = "/api/internal/hosted-inference/resolve";
const HOSTED_RUNNER_NATIVE_PROVIDER_EGRESS_ENV = {
  EXA_API_KEY: "exa",
  MAPBOX_ACCESS_TOKEN: "mapbox",
  MURPH_DATA_API_KEY: "murph_data_api",
  OPENAI_API_KEY: "openai",
  VENICE_API_KEY: "venice",
} as const;
const HOSTED_RUNNER_WORKERS_AI_TRANSCRIBE_PROVIDER_KIND = "workers_ai_transcribe";
const HOSTED_CUSTOM_INFERENCE_PROVIDER = "hosted-custom-inference";
const HOSTED_CUSTOM_INFERENCE_API_KEY_ENV = "MURPH_CUSTOM_INFERENCE_API_KEY";
const HOSTED_CUSTOM_INFERENCE_CONTEXT_WINDOW_ENV =
  "HOSTED_ASSISTANT_CONTEXT_WINDOW_TOKENS";

function shouldDeferHostedRuntimeOwnerReleaseCallback(
  result: HostedWorkspaceInvocationResult,
): boolean {
  if (result.immediateRecheckRequested === true) {
    return false;
  }

  try {
    return isHostedRuntimeFutureMailboxContinuation({
      nextWakeAt: result.nextWakeAt,
      nextWakeReason: result.nextWakeReason,
      redactedStatus: result.redactedStatus,
    });
  } catch {
    return true;
  }
}

type HostedRunnerNativeProviderCredentialEnvName =
  keyof typeof HOSTED_RUNNER_NATIVE_PROVIDER_EGRESS_ENV;

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
const WORKSPACE_SNAPSHOT_PATH_HASH_SECRET_CONTEXT =
  "murph.hosted.workspace-snapshot-path-hash.v1";
const WORKSPACE_SNAPSHOT_PATH_HASH_SECRET_TEXT_ENCODER = new TextEncoder();

export type RuntimeInvocationInput = {
  orchestration?: NonNullable<HostedRuntimeLatencyPhaseBreakdown["orchestration"]> | null;
  orchestrationAttemptId: string;
  processingMode?: HostedWorkspaceInvocationProcessingMode | null;
  userId: string;
};

export interface PreparedRuntimeInvocation {
  input: RuntimeInvocationInput;
  job: HostedExecutionWorkspaceInvocationJobInput;
  runnerContainerName: string;
  token: RunnerWriteFenceToken;
  workspaceCheckpointedAt: string | null;
  workspaceVersion: string;
}

export class RuntimeInvocationService {
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
    },
  ) {}

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

  async prepareWithFence(input: {
    commandBudget?: RuntimeProcessingCommandBudget;
    input: RuntimeInvocationInput;
    token: RunnerWriteFenceToken;
  }): Promise<PreparedRuntimeInvocation> {
    const preparationStartedAtMs = Date.now();
    const workspaceReadStartedAtMs = Date.now();
    const workspaceRead = await this.input.readHostedWorkspaceFromWeb(
      input.input.userId,
      {
        timeoutMs: input.commandBudget
          ? readRuntimeProcessingCommandStepTimeoutMs({
              budget: input.commandBudget,
              stepTimeoutMs: this.input.env.webControlTimeoutMs,
            })
          : this.input.env.webControlTimeoutMs,
      },
    );
    const workspaceReadElapsedMs = Math.max(
      0,
      Date.now() - workspaceReadStartedAtMs,
    );
    this.input.assertWorkspaceBelongsToRunnerUser(
      workspaceRead.workspace,
      input.input.userId,
    );
    const workspaceVersion = workspaceRead.workspace?.version ?? "0";
    const hostedAssistantCustomInferenceOverride =
      workspaceRead.hostedAssistantCustomInferenceOverride ?? null;
    const customInferenceTarget = hostedAssistantCustomInferenceOverride
      ? await this.readHostedInferenceRuntimeTargetFromWeb({
          override: hostedAssistantCustomInferenceOverride,
          timeoutMs: input.commandBudget
            ? readRuntimeProcessingCommandStepTimeoutMs({
                budget: input.commandBudget,
                stepTimeoutMs: this.input.env.webControlTimeoutMs,
              })
            : this.input.env.webControlTimeoutMs,
          userId: input.input.userId,
        })
      : null;
    let platformAiUsageAllowed: boolean | null = null;
    let assistantExecutionBlocked = false;
    let invocationProcessingMode = input.input.processingMode ?? null;
    if (hostedAssistantCustomInferenceOverride) {
      if (typeof workspaceRead.platformAiUsageAllowed !== "boolean") {
        throw new Error(
          "Hosted custom inference workspace projection omitted the platform AI usage decision.",
        );
      }
      platformAiUsageAllowed = workspaceRead.platformAiUsageAllowed;
    } else if (workspaceRead.platformAiUsageAllowed === false) {
      // A payloadless direct wake can win the race with Temporal's usage-block
      // reconciliation. Keep that expected product block out of transport
      // failure state and keep restored assistant work out of provider-failure
      // handling. A due delivery-only wake must retain the default assistant
      // phase because that phase owns outbox delivery, while the bound fence
      // still rejects every metered provider egress if one is reached
      // unexpectedly. Other default work remains narrowed to system-mailbox
      // processing, and explicit retention-only work can proceed without a
      // model call.
      platformAiUsageAllowed = false;
      const isDefaultDeliveryOnlyWake =
        (invocationProcessingMode ?? "default") === "default"
        && isDueHostedAssistantDeliveryWake(
          workspaceRead.workspace,
          Date.now(),
        );
      assistantExecutionBlocked = !isDefaultDeliveryOnlyWake;
      if (
        !isDefaultDeliveryOnlyWake
        && (invocationProcessingMode ?? "default") === "default"
      ) {
        invocationProcessingMode = "system_mailbox";
      }
    }
    const customInferenceEnvelope = customInferenceTarget
      ? await sealHostedInferenceRuntimeTarget({
          source: this.input.runnerRuntimeEnvSource,
          target: customInferenceTarget,
        })
      : null;
    const token = await this.input.stateStore.bindWriteFenceInvocationFacts({
      customInferenceEnvelope,
      platformAiUsageAllowed,
      processingMode: invocationProcessingMode,
      token: input.token,
      workspaceVersion,
    });
    const {
      runtimeStoreEnsureElapsedMs,
      ...workspaceRunnerInvocation
    } = await this.prepareWorkspaceRunnerInvocation({
      commandBudget: input.commandBudget,
      hostedAssistantCustomInferenceOverride,
      hostedAssistantModelOverride:
        workspaceRead.hostedAssistantModelOverride ?? null,
      hostedAssistantProviderOverride:
        workspaceRead.hostedAssistantProviderOverride ?? null,
      hostedAssistantReasoningEffortOverride:
        workspaceRead.hostedAssistantReasoningEffortOverride ?? null,
      assistantExecutionBlocked,
      processingMode: invocationProcessingMode,
      token,
      userId: input.input.userId,
      workspace: workspaceRead.workspace,
      workspaceVersion,
    });

    return {
      input: {
        ...input.input,
        orchestration: {
          ...(input.input.orchestration ?? {}),
          runtimeInvocationPreparationElapsedMs:
            Math.max(0, Date.now() - preparationStartedAtMs),
          runtimeStoreEnsureElapsedMs,
          workspaceReadElapsedMs,
        },
      },
      ...workspaceRunnerInvocation,
      token,
      workspaceCheckpointedAt:
        workspaceRead.workspace?.checkpointedAt ?? null,
      workspaceVersion,
    };
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

    if (!shouldDeferHostedRuntimeOwnerReleaseCallback(input.result)) {
      await this.notifyRuntimeOwnerReleasedBestEffort(input);
    }
    return { completed: true };
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
        ...(input.result.immediateRecheckRequested === true
          ? {
              search:
                `?${HOSTED_RUNTIME_OWNER_RELEASE_IMMEDIATE_RECHECK_QUERY}=1`,
            }
          : {}),
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

  private async readHostedInferenceRuntimeTargetFromWeb(input: {
    override: HostedAssistantCustomInferenceOverride;
    timeoutMs: number;
    userId: string;
  }): Promise<HostedInferenceRuntimeTarget> {
    const response = await fetchHostedExecutionWebControlPlaneResponse({
      ...(this.input.env.hostedWebAllowHttpHosts
        ? { allowHttpHosts: this.input.env.hostedWebAllowHttpHosts }
        : {}),
      baseUrl: this.input.readHostedWebControlBaseUrl(),
      boundUserId: input.userId,
      callbackSigning: this.input.env.webCallbackSigning,
      method: "GET",
      path: HOSTED_INFERENCE_RUNTIME_TARGET_PATH,
      search: `?revision=${input.override.revision}`,
      timeoutMs: input.timeoutMs,
    });
    if (!response.ok) {
      throw new Error(
        `Hosted custom inference resolution failed with HTTP ${response.status}.`,
      );
    }
    const text = await response.text();
    if (
      new TextEncoder().encode(text).byteLength
      > HOSTED_INFERENCE_RUNTIME_TARGET_MAX_BODY_BYTES
    ) {
      throw new RangeError("Hosted custom inference resolution response was too large.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new TypeError("Hosted custom inference resolution response was invalid.");
    }
    const target = parseHostedInferenceRuntimeTarget(parsed);
    if (
      target.contextWindowTokens !== input.override.contextWindowTokens
      || target.protocol !== input.override.protocol
      || target.revision !== input.override.revision
      || target.supportsImages !== input.override.supportsImages
      || target.verificationProfile !== input.override.verificationProfile
    ) {
      throw new Error("Hosted custom inference resolution did not match workspace projection.");
    }
    return target;
  }

  private async prepareWorkspaceRunnerInvocation(input: {
    assistantExecutionBlocked: boolean;
    commandBudget?: RuntimeProcessingCommandBudget;
    hostedAssistantCustomInferenceOverride:
      HostedAssistantCustomInferenceOverride | null;
    hostedAssistantModelOverride: HostedAssistantModelOverride | null;
    hostedAssistantProviderOverride: HostedAssistantProviderOverride | null;
    hostedAssistantReasoningEffortOverride:
      HostedAssistantReasoningEffortOverride | null;
    processingMode?: HostedWorkspaceInvocationProcessingMode | null;
    token: RunnerWriteFenceToken;
    userId: string;
    workspace: HostedWorkspaceState | null;
    workspaceVersion: string;
  }): Promise<{
    job: HostedExecutionWorkspaceInvocationJobInput;
    runnerContainerName: string;
    runtimeStoreEnsureElapsedMs: number;
  }> {
    if (!this.input.runnerContainerNamespace) {
      throw new Error("Native hosted execution requires a RunnerContainer binding.");
    }

    const forwardedEnv = buildHostedRunnerContainerEnv(
      this.input.runnerRuntimeEnvSource,
    );
    if (input.hostedAssistantCustomInferenceOverride !== null) {
      forwardedEnv.HOSTED_ASSISTANT_PROVIDER = HOSTED_CUSTOM_INFERENCE_PROVIDER;
      forwardedEnv.HOSTED_ASSISTANT_MODEL =
        input.hostedAssistantCustomInferenceOverride.modelAlias;
      forwardedEnv[HOSTED_CUSTOM_INFERENCE_API_KEY_ENV] =
        HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL;
      forwardedEnv[HOSTED_CUSTOM_INFERENCE_CONTEXT_WINDOW_ENV] =
        String(input.hostedAssistantCustomInferenceOverride.contextWindowTokens);
      delete forwardedEnv.HOSTED_ASSISTANT_REASONING_EFFORT;
    } else {
      if (input.hostedAssistantProviderOverride !== null) {
        forwardedEnv.HOSTED_ASSISTANT_PROVIDER =
          input.hostedAssistantProviderOverride;
      }
      if (input.hostedAssistantModelOverride !== null) {
        forwardedEnv.HOSTED_ASSISTANT_MODEL =
          input.hostedAssistantModelOverride;
      }
      if (input.hostedAssistantReasoningEffortOverride !== null) {
        forwardedEnv.HOSTED_ASSISTANT_REASONING_EFFORT =
          input.hostedAssistantReasoningEffortOverride;
      }
    }
    const configSource = this.input.runnerStoreCache.readRuntimeConfigSource();
    const webControlTimeoutMs = input.commandBudget
      ? readRuntimeProcessingCommandStepTimeoutMs({
          budget: input.commandBudget,
          stepTimeoutMs: this.input.env.webControlTimeoutMs,
        })
      : undefined;
    const runtimeStoreEnsureStartedAtMs = Date.now();
    const stores = await this.input.runnerStoreCache.ensure(
      input.userId,
      webControlTimeoutMs === undefined
        ? undefined
        : { webControlTimeoutMs },
    );
    const runtimeStoreEnsureElapsedMs = Math.max(
      0,
      Date.now() - runtimeStoreEnsureStartedAtMs,
    );
    const readRunnerSecrets = async () =>
      await stores.runnerSecrets.readRunnerSecrets(input.userId);
    const emitSnapshotRestorePreparationUnavailableLog = (error: unknown): void => {
      emitHostedExecutionStructuredLog({
        component: "runner",
        details: {
          runtimeSnapshotRestorePreparationFailureCode:
            deriveHostedExecutionErrorCode(error),
          workspaceAttemptId: input.token.attemptId,
          workspaceVersion: input.workspaceVersion,
        },
        level: "warn",
        message: "Hosted workspace snapshot restore preparation unavailable.",
        phase: "wake.running",
        userId: input.userId,
      });
    };
    const prepareSnapshotRestore = async () =>
      await prepareHostedWorkspaceSnapshotRestore({
        configSource,
        crypto: stores.crypto,
        onPreparationUnavailable: emitSnapshotRestorePreparationUnavailableLog,
        userId: input.userId,
        workspace: input.workspace,
      });
    const [runnerSecrets, workspaceSnapshotPathHashSecret, preparedSnapshotRestore] =
      await Promise.all([
        input.commandBudget
          ? runRuntimeProcessingCommandStep({
              budget: input.commandBudget,
              operation: readRunnerSecrets,
              stepTimeoutMs: this.input.env.webControlTimeoutMs,
            })
          : readRunnerSecrets(),
        deriveHostedWorkspaceSnapshotPathHashSecret(configSource),
        runHostedWorkspaceSnapshotRestorePreparationWithinBudget({
          budget: input.commandBudget ?? null,
          onBudgetTimeout: emitSnapshotRestorePreparationUnavailableLog,
          operation: prepareSnapshotRestore,
          stepTimeoutMs: this.input.env.webControlTimeoutMs,
        }),
      ]);
    const runnerContainerIdentity = readHostedRunnerContainerIdentity({
      containerName: input.token.runnerContainerName,
      source: this.input.runnerRuntimeEnvSource,
    });
    if (!runnerContainerIdentity || runnerContainerIdentity.userId !== input.userId) {
      throw new Error("Hosted runner container identity did not match the runtime invocation user.");
    }
    const runnerContainerName = runnerContainerIdentity.runnerContainerName;
    const openAiCredentialBeforeMintKind =
      readHostedProviderCredentialDiagnosticKind(forwardedEnv.OPENAI_API_KEY);
    const veniceCredentialBeforeMintKind =
      readHostedProviderCredentialDiagnosticKind(forwardedEnv.VENICE_API_KEY);
    let openAiProviderCredentialMinted = false;
    let veniceProviderCredentialMinted = false;
    const createProviderCredential = async (providerKind: string) =>
      await createHostedProviderEgressCredential({
        providerKind,
        runnerContainerName,
        source: this.input.runnerRuntimeEnvSource,
        userId: input.userId,
      });
    for (const [envKey, providerKind] of Object.entries(
      HOSTED_RUNNER_NATIVE_PROVIDER_EGRESS_ENV,
    ) as Array<[HostedRunnerNativeProviderCredentialEnvName, string]>) {
      // OpenAI remains available as a separately scoped managed credential for
      // provider-specific tools such as image generation even when core
      // assistant inference runs through Venice.
      if (
        envKey === "VENICE_API_KEY"
        && !isHostedRunnerVeniceProvider(forwardedEnv.HOSTED_ASSISTANT_PROVIDER)
      ) {
        continue;
      }
      if (typeof forwardedEnv[envKey] === "string" && forwardedEnv[envKey].length > 0) {
        forwardedEnv[envKey] = await createProviderCredential(providerKind);
        if (envKey === "OPENAI_API_KEY") {
          openAiProviderCredentialMinted = true;
        }
        if (envKey === "VENICE_API_KEY") {
          veniceProviderCredentialMinted = true;
        }
      }
    }
    const openAiCredentialAfterMintKind =
      readHostedProviderCredentialDiagnosticKind(forwardedEnv.OPENAI_API_KEY);
    const veniceCredentialAfterMintKind =
      readHostedProviderCredentialDiagnosticKind(forwardedEnv.VENICE_API_KEY);
    const workersAiTranscribeProviderEgressCredential = await createProviderCredential(
      HOSTED_RUNNER_WORKERS_AI_TRANSCRIBE_PROVIDER_KIND,
    );
    const runtimeConfig = buildHostedRunnerJobRuntimeConfig({
      configSource,
      forwardedEnv,
      providerEgressCredentials: {
        workersAiTranscribe: workersAiTranscribeProviderEgressCredential,
      },
      rewritePlatformUrlsForContainer: true,
      runnerSecrets,
    });
    const userEnv = runtimeConfig.userEnv ?? {};
    const job: HostedExecutionWorkspaceInvocationJobInput = {
      ...(workspaceSnapshotPathHashSecret
        ? {
            diagnostics: {
              workspaceSnapshotPathHashSecret,
            },
          }
        : {}),
      kind: HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND,
      ...(preparedSnapshotRestore ? { preparedSnapshotRestore } : {}),
      request: {
        ...(input.assistantExecutionBlocked
          ? { assistantExecutionBlocked: true as const }
          : {}),
        attemptId: input.token.attemptId,
        idleCheckpointDelayMs: this.input.env.idleCheckpointDelayMs,
        leaseGeneration: input.token.generation,
        ...(input.processingMode
          ? { processingMode: input.processingMode }
          : {}),
        providerEgressToken: input.token.providerEgressToken,
        userId: input.userId,
        workspace: input.workspace,
        workspaceVersion: input.workspaceVersion,
      },
      runtime: runtimeConfig,
    };

    emitHostedExecutionStructuredLog({
      component: "runner",
      details: {
        forwardedEnvKeyCount: Object.keys(forwardedEnv).length,
        hostedAssistantProviderConfigured:
          typeof forwardedEnv.HOSTED_ASSISTANT_PROVIDER === "string"
          && forwardedEnv.HOSTED_ASSISTANT_PROVIDER.length > 0,
        hostedAssistantCustomInferenceConfigured:
          input.hostedAssistantCustomInferenceOverride !== null,
        hostedAssistantOpenAiConfigured:
          isHostedRunnerOpenAiProvider(forwardedEnv.HOSTED_ASSISTANT_PROVIDER),
        hostedAssistantVeniceConfigured:
          isHostedRunnerVeniceProvider(forwardedEnv.HOSTED_ASSISTANT_PROVIDER),
        modelCredentialConfigured:
          hasHostedRunnerModelCredential({
            forwardedEnv,
            userEnv,
          }),
        openAiCredentialAfterMintKind,
        openAiCredentialBeforeMintKind,
        openAiProviderCredentialMinted,
        veniceCredentialAfterMintKind,
        veniceCredentialBeforeMintKind,
        veniceProviderCredentialMinted,
        preparedSnapshotRestorePresent: preparedSnapshotRestore !== null,
        runnerContainerWorkerVersionPresent: runnerContainerName !== input.userId,
        workspaceAttemptId: input.token.attemptId,
        workspaceWriteFenceGeneration: input.token.generation,
        workspaceVersion: input.workspaceVersion,
      },
      message: "Hosted runner prepared workspace invocation.",
      phase: "wake.running",
      userId: input.userId,
    });

    return {
      job,
      runnerContainerName,
      runtimeStoreEnsureElapsedMs,
    };
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
          leaseGeneration: input.token.leaseGeneration,
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

function isDueHostedAssistantDeliveryWake(
  workspace: HostedWorkspaceState | null,
  nowMs: number,
): boolean {
  if (
    workspace?.nextWakeReason !== HOSTED_RUNTIME_ASSISTANT_DELIVERY_WAKE_REASON
    || typeof workspace.nextWakeAt !== "string"
  ) {
    return false;
  }
  const nextWakeAtMs = Date.parse(workspace.nextWakeAt);
  return Number.isFinite(nextWakeAtMs) && nextWakeAtMs <= nowMs;
}

// Budget-aware wrapper for `prepareHostedWorkspaceSnapshotRestore`. A
// control-plane stall that exceeds the per-command budget must not clear the
// runner write fence: warm-clean checkpoint markers can restore without R2
// access, key unwrap, or a prepared URL. The fenced cold path still fails
// closed because it re-attempts the same reads under the fence. Runner-secret
// preparation intentionally stays fatal — the container cannot start without
// it — so this wrapper is snapshot-prep specific.
export async function runHostedWorkspaceSnapshotRestorePreparationWithinBudget(input: {
  budget: RuntimeProcessingCommandBudget | null;
  onBudgetTimeout: (error: unknown) => void;
  operation: () => Promise<HostedWorkspaceSnapshotPreparedRestore | null>;
  stepTimeoutMs: number;
}): Promise<HostedWorkspaceSnapshotPreparedRestore | null> {
  if (!input.budget) {
    return await input.operation();
  }
  try {
    return await runRuntimeProcessingCommandStep({
      budget: input.budget,
      operation: input.operation,
      stepTimeoutMs: input.stepTimeoutMs,
    });
  } catch (error) {
    if (isRuntimeProcessingCommandBudgetTimeout(error)) {
      input.onBudgetTimeout(error);
      return null;
    }
    throw error;
  }
}

export async function deriveHostedWorkspaceSnapshotPathHashSecret(
  source: Readonly<Record<string, string | undefined>>,
): Promise<string | null> {
  const rawSecret = normalizeHostedRunnerStringEnvValue(
    source.HOSTED_LOG_FINGERPRINT_SECRET,
  );
  if (!rawSecret) {
    return null;
  }

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      WORKSPACE_SNAPSHOT_PATH_HASH_SECRET_TEXT_ENCODER.encode(rawSecret),
      { hash: "SHA-256", name: "HMAC" },
      false,
      ["sign"],
    );
    const signature = new Uint8Array(await crypto.subtle.sign(
      "HMAC",
      key,
      WORKSPACE_SNAPSHOT_PATH_HASH_SECRET_TEXT_ENCODER.encode(
        WORKSPACE_SNAPSHOT_PATH_HASH_SECRET_CONTEXT,
      ),
    ));
    return Array.from(signature)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

export function normalizeHostedRunnerStringEnvValue(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
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
