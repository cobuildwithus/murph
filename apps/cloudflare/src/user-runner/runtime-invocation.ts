import {
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  parseHostedRuntimeLogResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_LOG_PATH,
} from "@murphai/hosted-execution/routes";
import type {
  HostedRuntimeLogRequest,
  HostedRuntimeWebStatusResponse,
  HostedWorkspaceInvocationResult,
  HostedWorkspaceReadResponse,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";

import type { HostedExecutionEnvironment } from "../env.js";
import {
  hasHostedRunnerModelCredential,
  isHostedRunnerOpenAiProvider,
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
  HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND,
  type HostedExecutionWorkspaceInvocationJobInput,
} from "../runner-job-transport.js";
import {
  fetchHostedExecutionWebControlPlaneResponse,
} from "../web-control-plane.ts";
import {
  prepareHostedWorkspaceSnapshotRestore,
} from "../workspace-snapshot-restore-preparation.ts";
import {
  buildHostedRunnerMetadataOnlyErrorDetails,
  buildHostedRunnerRedactedErrorJson,
} from "./diagnostics.js";
import type {
  RuntimeProcessingCommandBudget,
} from "./runtime-command-budget.js";
import {
  readRuntimeProcessingCommandStepTimeoutMs,
  runRuntimeProcessingCommandStep,
} from "./runtime-command-budget.js";
import type { RunnerWriteFenceToken } from "./runner-state-store.js";
import { RunnerStateStore } from "./runner-state-store.js";
import type { RunnerStateRecord } from "./types.js";
import { RunnerStoreCache } from "./runner-store-cache.js";
import type { RunnerAlarmCoordinator } from "./alarm-coordinator.js";

const RUNTIME_ATTEMPT_LIVENESS_PROBE_TIMEOUT_MS = 5_000;

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
  orchestrationAttemptId: string;
  userId: string;
};

export interface PreparedRuntimeInvocation {
  input: RuntimeInvocationInput;
  job: HostedExecutionWorkspaceInvocationJobInput;
  runnerContainerName: string;
  token: RunnerWriteFenceToken;
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
      alarmCoordinator: RunnerAlarmCoordinator;
    },
  ) {}

  async prepareWithFence(input: {
    commandBudget?: RuntimeProcessingCommandBudget;
    input: RuntimeInvocationInput;
    token: RunnerWriteFenceToken;
  }): Promise<PreparedRuntimeInvocation> {
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
    this.input.assertWorkspaceBelongsToRunnerUser(workspaceRead.workspace, input.input.userId);
    const workspaceVersion = workspaceRead.workspace?.version ?? "0";
    const token = await this.input.stateStore.bindWriteFenceWorkspaceVersion({
      token: input.token,
      workspaceVersion,
    });
    const workspaceRunnerInvocation = await this.prepareWorkspaceRunnerInvocation({
      commandBudget: input.commandBudget,
      token,
      userId: input.input.userId,
      workspace: workspaceRead.workspace,
      workspaceVersion,
    });

    return {
      input: input.input,
      ...workspaceRunnerInvocation,
      token,
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
      await this.input.alarmCoordinator.sync(failed.record);
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

      if (input.acceptedProcessingAttempt) {
        const committedResult =
          await this.recoverAcceptedRuntimeCompletionAfterTransportFailure({
            executionInput,
            transportError: error,
            token,
            workspaceVersion,
          });
        if (committedResult.kind === "completed") {
          return committedResult.result;
        }
        if (committedResult.kind === "unknown") {
          throw error;
        }
        if (probeOutcome !== "mismatch") {
          await this.recordAcceptedRuntimeAttemptFailureBestEffort({
            error,
            executionInput,
            fenceCleared: false,
            probeOutcome,
            token,
            workspaceVersion,
          });
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
            "Hosted runner accepted runtime transport failed before committed progress was visible; preserving the write fence for identity-aware wake recovery.",
            phase: "failed",
            userId: executionInput.userId,
          });
          throw error;
        }
      }

      const failed = await this.input.stateStore.clearWriteFenceAfterTransportFailure({
        error,
        finishedAt: new Date().toISOString(),
        token,
      });
      await this.input.alarmCoordinator.sync(failed.record);
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

    const completion = await this.recordRuntimeCompletionAfterInvoke({
      input: executionInput,
      token,
      workspaceVersion,
    });
    await this.syncRunnerAlarmAfterCompletion({
      executionInput,
      record: completion.record,
      token,
      workspaceVersion,
    });

    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      details: {
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

  async recoverAcceptedRuntimeCompletionAfterTransportFailure(input: {
    executionInput: RuntimeInvocationInput;
    token: RunnerWriteFenceToken;
    transportError?: unknown;
    workspaceVersion: string | null;
  }): Promise<AcceptedRuntimeCompletionRecoveryResult> {
    if (input.workspaceVersion === null) {
      return { kind: "not_completed" };
    }
    const committedResult =
      await this.readAcceptedRuntimeCommittedProgressAfterTransportFailure({
        executionInput: input.executionInput,
        workspaceVersion: input.workspaceVersion,
      });
    if (committedResult.kind !== "completed") {
      return committedResult;
    }

    const completion = await this.recordRuntimeCompletionAfterInvoke({
      input: input.executionInput,
      token: input.token,
      workspaceVersion: input.workspaceVersion,
    });
    await this.syncRunnerAlarmAfterCompletion({
      executionInput: input.executionInput,
      record: completion.record,
      token: input.token,
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
      message: "Hosted runner accepted runtime attempt committed progress despite transport failure.",
      phase: "checkpoint",
      userId: input.executionInput.userId,
    });
    return {
      kind: "completed",
      result: committedResult.result,
    };
  }

  private async readAcceptedRuntimeCommittedProgressAfterTransportFailure(input: {
    executionInput: RuntimeInvocationInput;
    workspaceVersion: string;
  }): Promise<AcceptedRuntimeCompletionRecoveryResult> {
    let status: HostedRuntimeWebStatusResponse;
    try {
      status = await this.input.readHostedRuntimeStatusFromWeb(
        input.executionInput.userId,
      );
    } catch (error) {
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

    if (
      !status.workspace
      || !isHostedRuntimeWorkspaceVersionAfter(
        status.workspace.version,
        input.workspaceVersion,
      )
      || !hostedRuntimeMailboxLagDrained(status.mailboxLag)
    ) {
      return { kind: "not_completed" };
    }

    return {
      kind: "completed",
      result: {
        nextWakeAt: status.workspace.nextWakeAt,
        nextWakeReason: status.workspace.nextWakeReason,
        redactedStatus: status.workspace.redactedStatus,
        status: "idle",
      },
    };
  }

  private async recordRuntimeCompletionAfterInvoke(input: {
    input: RuntimeInvocationInput;
    token: RunnerWriteFenceToken;
    workspaceVersion: string | null;
  }): Promise<{ record: RunnerStateRecord | null }> {
    try {
      const completed = await this.input.stateStore.clearWriteFenceAfterCompletion({
        finishedAt: new Date().toISOString(),
        token: input.token,
      });
      if (!completed.completed) {
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            orchestrationAttemptId: input.input.orchestrationAttemptId,
            workspaceAttemptId: input.token.attemptId,
            workspaceVersion: input.workspaceVersion,
          },
          level: "warn",
          message: "Hosted runner runtime execution completed after its write fence changed; preserving completed result without transport retry.",
          phase: "checkpoint",
          userId: input.input.userId,
        });
      }
      return {
        record: completed.record,
      };
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          orchestrationAttemptId: input.input.orchestrationAttemptId,
          workspaceAttemptId: input.token.attemptId,
          workspaceVersion: input.workspaceVersion,
        },
        level: "warn",
        message: "Hosted runner runtime execution completed but completion recording failed; preserving completed result without transport retry.",
        phase: "checkpoint",
        userId: input.input.userId,
      });
      return {
        record: await this.readRunnerStateAfterCompletionRecordFailure(input),
      };
    }
  }

  private async readRunnerStateAfterCompletionRecordFailure(input: {
    input: RuntimeInvocationInput;
    token: RunnerWriteFenceToken;
    workspaceVersion: string | null;
  }): Promise<RunnerStateRecord | null> {
    try {
      return await this.input.stateStore.readState();
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          orchestrationAttemptId: input.input.orchestrationAttemptId,
          workspaceAttemptId: input.token.attemptId,
          workspaceVersion: input.workspaceVersion,
        },
        level: "warn",
        message: "Hosted runner runtime execution completed but state read after completion recording failure also failed.",
        phase: "checkpoint",
        userId: input.input.userId,
      });
      return null;
    }
  }

  private async syncRunnerAlarmAfterCompletion(input: {
    executionInput: RuntimeInvocationInput;
    record: RunnerStateRecord | null;
    token: RunnerWriteFenceToken;
    workspaceVersion: string | null;
  }): Promise<void> {
    if (!input.record) {
      return;
    }

    try {
      await this.input.alarmCoordinator.sync(input.record);
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
        message: "Hosted runner runtime execution completed but alarm cleanup failed.",
        phase: "checkpoint",
        userId: input.executionInput.userId,
      });
    }
  }

  private async prepareWorkspaceRunnerInvocation(input: {
    commandBudget?: RuntimeProcessingCommandBudget;
    token: RunnerWriteFenceToken;
    userId: string;
    workspace: HostedWorkspaceState | null;
    workspaceVersion: string;
  }): Promise<{
    job: HostedExecutionWorkspaceInvocationJobInput;
    runnerContainerName: string;
  }> {
    if (!this.input.runnerContainerNamespace) {
      throw new Error("Native hosted execution requires a RunnerContainer binding.");
    }

    const forwardedEnv = buildHostedRunnerContainerEnv(
      this.input.runnerRuntimeEnvSource,
    );
    const configSource = this.input.runnerStoreCache.readRuntimeConfigSource();
    const webControlTimeoutMs = input.commandBudget
      ? readRuntimeProcessingCommandStepTimeoutMs({
          budget: input.commandBudget,
          stepTimeoutMs: this.input.env.webControlTimeoutMs,
        })
      : undefined;
    const stores = await this.input.runnerStoreCache.ensure(
      input.userId,
      webControlTimeoutMs === undefined
        ? undefined
        : { webControlTimeoutMs },
    );
    const readRunnerSecrets = async () =>
      await stores.runnerSecrets.readRunnerSecrets(input.userId);
    const prepareSnapshotRestore = async () =>
      await prepareHostedWorkspaceSnapshotRestore({
        configSource,
        crypto: stores.crypto,
        onPreparationUnavailable: (error) => {
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
        },
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
        input.commandBudget
          ? runRuntimeProcessingCommandStep({
              budget: input.commandBudget,
              operation: prepareSnapshotRestore,
              stepTimeoutMs: this.input.env.webControlTimeoutMs,
            })
          : prepareSnapshotRestore(),
      ]);
    const runtimeConfig = buildHostedRunnerJobRuntimeConfig({
      configSource,
      forwardedEnv,
      rewritePlatformUrlsForContainer: true,
      runnerSecrets,
    });
    const userEnv = runtimeConfig.userEnv ?? {};
    const runnerContainerIdentity = readHostedRunnerContainerIdentity({
      containerName: input.token.runnerContainerName,
      source: this.input.runnerRuntimeEnvSource,
    });
    if (!runnerContainerIdentity || runnerContainerIdentity.userId !== input.userId) {
      throw new Error("Hosted runner container identity did not match the runtime invocation user.");
    }
    const runnerContainerName = runnerContainerIdentity.runnerContainerName;
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
        attemptId: input.token.attemptId,
        idleCheckpointDelayMs: this.input.env.idleCheckpointDelayMs,
        leaseGeneration: input.token.generation,
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
        hostedAssistantOpenAiConfigured:
          isHostedRunnerOpenAiProvider(forwardedEnv.HOSTED_ASSISTANT_PROVIDER),
        modelCredentialConfigured:
          hasHostedRunnerModelCredential({
            forwardedEnv,
            userEnv,
          }),
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
    const namespace = this.input.runnerContainerNamespace;
    if (!namespace) {
      return "unsupported";
    }
    let probeTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const container = namespace.getByName(prepared.runnerContainerName);
      if (!container.readActiveRuntimeUserFence) {
        return "unsupported";
      }
      const active = await Promise.race([
        container.readActiveRuntimeUserFence(),
        new Promise<null>((resolve) => {
          probeTimer = setTimeout(
            () => resolve(null),
            RUNTIME_ATTEMPT_LIVENESS_PROBE_TIMEOUT_MS,
          );
        }),
      ]);
      if (active === null) {
        this.emitAttemptLivenessProbeUnconfirmedLog({
          prepared,
          probeOutcome: "timeout",
        });
        return "timeout";
      }
      if (!active.active) {
        return "inactive";
      }
      return active.userId === prepared.input.userId
        && active.attemptId === prepared.token.attemptId
        // The container records the generation from the job request; compare
        // against that single source of truth.
        && active.leaseGeneration === prepared.job.request.leaseGeneration
        ? "active"
        : "mismatch";
    } catch (error) {
      this.emitAttemptLivenessProbeUnconfirmedLog({
        error,
        prepared,
        probeOutcome: "error",
      });
      return "error";
    } finally {
      if (probeTimer !== undefined) {
        clearTimeout(probeTimer);
      }
    }
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

export function hostedRuntimeMailboxLagDrained(
  mailboxLag: HostedRuntimeWebStatusResponse["mailboxLag"],
): boolean {
  return mailboxLag.every((lane) => {
    try {
      return BigInt(lane.lag) === 0n;
    } catch {
      return lane.lag === "0";
    }
  });
}
