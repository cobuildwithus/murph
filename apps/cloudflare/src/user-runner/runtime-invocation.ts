import {
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import type {
  HostedRuntimeDemandRunSource,
} from "@murphai/hosted-execution/orchestration-control";
import {
  parseHostedRuntimeLogResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_LOG_PATH,
} from "@murphai/hosted-execution/routes";
import type {
  HostedRuntimeLogRequest,
  HostedRuntimeWebStatusResponse,
  HostedWorkspaceInvocationReason,
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
  resolveHostedExecutionRunnerContainerName,
  type HostedExecutionContainerNamespaceLike,
} from "../runner-container.js";
import {
  HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND,
  type HostedExecutionWorkspaceInvocationJobInput,
} from "../runner-job-transport.js";
import {
  fetchHostedExecutionWebControlPlaneResponse,
} from "../web-control-plane.ts";
import {
  buildHostedRunnerMetadataOnlyErrorDetails,
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
import type { RunnerWatchdog } from "./watchdog.js";

const WORKSPACE_SNAPSHOT_PATH_HASH_SECRET_CONTEXT =
  "murph.hosted.workspace-snapshot-path-hash.v1";
const WORKSPACE_SNAPSHOT_PATH_HASH_SECRET_TEXT_ENCODER = new TextEncoder();

export type RuntimeInvocationInput = {
  orchestrationAttemptId: string;
  reason: HostedWorkspaceInvocationReason;
  source?: HostedRuntimeDemandRunSource;
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
      watchdog: RunnerWatchdog;
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
      reason: input.input.reason,
      ...(input.input.source ? { source: input.input.source } : {}),
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
      await this.input.watchdog.sync(failed.record);
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          orchestrationAttemptId: executionInput.orchestrationAttemptId,
          transportFailureFenceCleared: failed.failed,
          workspaceAttemptId: input.token.attemptId,
          workspaceReason: executionInput.reason,
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
      if (input.acceptedProcessingAttempt) {
        const committedResult =
          await this.readAcceptedRuntimeCommittedProgressAfterTransportFailure({
            executionInput,
            workspaceVersion,
          });
        if (committedResult) {
          const completion = await this.recordRuntimeCompletionAfterInvoke({
            input: executionInput,
            token,
            workspaceVersion,
          });
          await this.syncWatchdogAlarmAfterCompletion({
            executionInput,
            record: completion.record,
            token,
            workspaceVersion,
          });
          emitHostedExecutionStructuredLog({
            component: "hosted.runner",
            details: {
              ...buildHostedRunnerMetadataOnlyErrorDetails(error),
              orchestrationAttemptId: executionInput.orchestrationAttemptId,
              workspaceAttemptId: token.attemptId,
              workspaceReason: executionInput.reason,
              workspaceVersion,
            },
            level: "warn",
            message: "Hosted runner accepted runtime attempt committed progress despite transport failure.",
            phase: "checkpoint",
            userId: executionInput.userId,
          });
          return committedResult;
        }
      }

      const failed = await this.input.stateStore.clearWriteFenceAfterTransportFailure({
        error,
        finishedAt: new Date().toISOString(),
        token,
      });
      await this.input.watchdog.sync(failed.record);
      if (input.acceptedProcessingAttempt && failed.failed) {
        await this.recordAcceptedRuntimeAttemptFailureBestEffort({
          error,
          executionInput,
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
          workspaceReason: executionInput.reason,
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
    await this.syncWatchdogAlarmAfterCompletion({
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

  private async readAcceptedRuntimeCommittedProgressAfterTransportFailure(input: {
    executionInput: RuntimeInvocationInput;
    workspaceVersion: string;
  }): Promise<HostedWorkspaceInvocationResult | null> {
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
          workspaceReason: input.executionInput.reason,
          workspaceVersion: input.workspaceVersion,
        },
        level: "warn",
        message: "Hosted runner accepted runtime progress recheck failed after transport failure.",
        phase: "failed",
        userId: input.executionInput.userId,
      });
      return null;
    }

    if (
      !status.workspace
      || !isHostedRuntimeWorkspaceVersionAfter(
        status.workspace.version,
        input.workspaceVersion,
      )
      || !hostedRuntimeMailboxLagDrained(status.mailboxLag)
    ) {
      return null;
    }

    return {
      nextWakeAt: status.workspace.nextWakeAt,
      nextWakeReason: status.workspace.nextWakeReason,
      redactedStatus: status.workspace.redactedStatus,
      status: "idle",
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
            workspaceReason: input.input.reason,
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
          workspaceReason: input.input.reason,
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
          workspaceReason: input.input.reason,
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

  private async syncWatchdogAlarmAfterCompletion(input: {
    executionInput: RuntimeInvocationInput;
    record: RunnerStateRecord | null;
    token: RunnerWriteFenceToken;
    workspaceVersion: string | null;
  }): Promise<void> {
    if (!input.record) {
      return;
    }

    try {
      await this.input.watchdog.sync(input.record);
    } catch (error) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          ...buildHostedRunnerMetadataOnlyErrorDetails(error),
          orchestrationAttemptIdPresent:
            input.executionInput.orchestrationAttemptId.length > 0,
          workspaceAttemptIdPresent: input.token.attemptId.length > 0,
          workspaceReason: input.executionInput.reason,
          workspaceVersion: input.workspaceVersion,
        },
        level: "warn",
        message: "Hosted runner runtime execution completed but watchdog alarm cleanup failed.",
        phase: "checkpoint",
        userId: input.executionInput.userId,
      });
    }
  }

  private async prepareWorkspaceRunnerInvocation(input: {
    commandBudget?: RuntimeProcessingCommandBudget;
    token: RunnerWriteFenceToken;
    reason: HostedWorkspaceInvocationReason;
    source?: HostedRuntimeDemandRunSource;
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
    const runtimeConfig = await this.buildForegroundRunnerJobRuntimeConfig({
      commandBudget: input.commandBudget,
      configSource,
      forwardedEnv,
      userId: input.userId,
    });
    const workspaceSnapshotPathHashSecret =
      await deriveHostedWorkspaceSnapshotPathHashSecret(configSource);
    const userEnv = runtimeConfig.userEnv ?? {};
    const runnerContainerName = resolveHostedExecutionRunnerContainerName({
      source: this.input.runnerRuntimeEnvSource,
      userId: input.userId,
    });
    const job: HostedExecutionWorkspaceInvocationJobInput = {
      ...(workspaceSnapshotPathHashSecret
        ? {
            diagnostics: {
              workspaceSnapshotPathHashSecret,
            },
          }
        : {}),
      kind: HOSTED_EXECUTION_WORKSPACE_INVOCATION_JOB_KIND,
      request: {
        attemptId: input.token.attemptId,
        deadlineAt: input.token.expiresAt,
        idleCheckpointDelayMs: this.input.env.idleCheckpointDelayMs,
        leaseGeneration: input.token.generation,
        reason: input.reason,
        ...(input.source ? { source: input.source } : {}),
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
        runnerContainerWorkerVersionPresent: runnerContainerName !== input.userId,
        workspaceAttemptId: input.token.attemptId,
        workspaceWriteFenceGeneration: input.token.generation,
        workspaceReason: input.reason,
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
      signal: AbortSignal.timeout(this.input.env.runnerTimeoutMs),
      timeoutMs: this.input.env.runnerTimeoutMs,
      userId: input.input.userId,
    });
  }

  private async buildForegroundRunnerJobRuntimeConfig(input: {
    commandBudget?: RuntimeProcessingCommandBudget;
    configSource: Readonly<Record<string, string | undefined>>;
    forwardedEnv: Readonly<Record<string, string>>;
    userId: string;
  }): Promise<ReturnType<typeof buildHostedRunnerJobRuntimeConfig>> {
    const webControlTimeoutMs = input.commandBudget
      ? readRuntimeProcessingCommandStepTimeoutMs({
          budget: input.commandBudget,
          stepTimeoutMs: this.input.env.webControlTimeoutMs,
        })
      : undefined;
    const { runnerSecrets: runnerSecretsService } = await this.input.runnerStoreCache.ensure(
      input.userId,
      webControlTimeoutMs === undefined
        ? undefined
        : { webControlTimeoutMs },
    );
    const runnerSecrets = input.commandBudget
      ? await runRuntimeProcessingCommandStep({
          budget: input.commandBudget,
          operation: async () => await runnerSecretsService.readRunnerSecrets(input.userId),
          stepTimeoutMs: this.input.env.webControlTimeoutMs,
        })
      : await runnerSecretsService.readRunnerSecrets(input.userId);
    return buildHostedRunnerJobRuntimeConfig({
      configSource: input.configSource,
      forwardedEnv: input.forwardedEnv,
      rewritePlatformUrlsForContainer: true,
      runnerSecrets,
    });
  }

  private async recordAcceptedRuntimeAttemptFailureBestEffort(input: {
    error: unknown;
    executionInput: RuntimeInvocationInput;
    token: RunnerWriteFenceToken;
    workspaceVersion: string;
  }): Promise<void> {
    const body = {
      entries: [
        {
          at: new Date().toISOString(),
          component: "runner",
          errorCode: deriveHostedExecutionErrorCode(input.error),
          eventCode: "runner.accepted_attempt_failed",
          level: "warn",
          phase: "error",
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
          workspaceReason: input.executionInput.reason,
          workspaceVersion: input.workspaceVersion,
        },
        level: "warn",
        message: "Hosted runner accepted runtime attempt failure log write failed.",
        phase: "failed",
        userId: input.executionInput.userId,
      });
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
