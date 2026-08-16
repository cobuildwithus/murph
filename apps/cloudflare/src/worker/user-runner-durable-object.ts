import { DurableObject } from "cloudflare:workers";
import type {
  HostedRuntimeLatencyPhaseBreakdown,
  HostedRunnerStatusResponse,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedRuntimeEnsureProcessingRequest,
  HostedRuntimeEnsureProcessingResponse,
} from "@murphai/hosted-execution/orchestration-control";

import {
  readHostedExecutionEnvironment,
} from "../env.ts";
import {
  notFound,
} from "../json.ts";
import {
  HostedUserRunner,
} from "../user-runner.ts";
import type {
  DurableObjectStateLike,
} from "../user-runner.ts";
import {
  asWorkerStringEnvironment,
} from "../worker-contracts.ts";
import type {
  UserRunnerDurableObjectStubLike,
  WorkerEnvironmentSource,
} from "../worker-routes/shared.ts";

export class UserRunnerDurableObject extends DurableObject implements UserRunnerDurableObjectStubLike {
  private readonly runner: HostedUserRunner;

  constructor(
    state: DurableObjectStateLike,
    env: WorkerEnvironmentSource,
    runner: HostedUserRunner = createHostedUserRunner(state, env),
  ) {
    super(state as never, env as never);
    this.runner = runner;
  }

  async bindUser(userId: string): Promise<{ userId: string }> {
    return this.runner.bindUser(userId);
  }

  async deleteHostedUserData(userId: string): ReturnType<HostedUserRunner["deleteHostedUserData"]> {
    return this.runner.deleteHostedUserData(userId);
  }

  async reconcileRuntimeHealthDataConsentForUser(
    userId: string,
  ): ReturnType<HostedUserRunner["reconcileRuntimeHealthDataConsentForUser"]> {
    return this.runner.reconcileRuntimeHealthDataConsentForUser(userId);
  }

  async prewarmRuntimeShellForUser(
    userId: string,
    source?: Parameters<HostedUserRunner["prewarmRuntimeShellForUser"]>[1],
  ): ReturnType<HostedUserRunner["prewarmRuntimeShellForUser"]> {
    return this.runner.prewarmRuntimeShellForUser(userId, source);
  }

  async publishHostedPrivateMedia(
    input: Parameters<HostedUserRunner["publishHostedPrivateMedia"]>[0],
  ): ReturnType<HostedUserRunner["publishHostedPrivateMedia"]> {
    return this.runner.publishHostedPrivateMedia(input);
  }

  async runnerStatus(input?: { logLimit?: number }): Promise<HostedRunnerStatusResponse> {
    return this.runner.runnerStatus(input);
  }

  async ensureRuntimeProcessingForUser(
    input: HostedRuntimeEnsureProcessingRequest & {
      commandTimeoutMs?: number;
      orchestration?: NonNullable<HostedRuntimeLatencyPhaseBreakdown["orchestration"]> | null;
      userId: string;
    },
  ): Promise<HostedRuntimeEnsureProcessingResponse> {
    return this.runner.ensureRuntimeProcessingForUser({
      ...input,
      orchestration: {
        ...(input.orchestration ?? {}),
        userRunnerRpcStartedAtEpochMs: Date.now(),
      },
    });
  }

  async validateRuntimeWriteFence(input: {
    attemptId: string;
    generation: string;
    userId: string;
  }): Promise<boolean> {
    return this.runner.validateRuntimeWriteFence(input);
  }

  async recordRuntimeCompletionFromContainer(
    input: Parameters<HostedUserRunner["recordRuntimeCompletionFromContainer"]>[0],
  ): ReturnType<HostedUserRunner["recordRuntimeCompletionFromContainer"]> {
    return this.runner.recordRuntimeCompletionFromContainer(input);
  }

  async validateRuntimeProviderEgressToken(input: {
    providerEgressToken: string;
    userId: string;
  }): ReturnType<HostedUserRunner["validateRuntimeProviderEgressToken"]> {
    return this.runner.validateRuntimeProviderEgressToken(input);
  }

  async validateRuntimeProviderEgressCredential(input: {
    providerKind: string;
    runnerContainerName: string;
    userId: string;
  }): ReturnType<HostedUserRunner["validateRuntimeProviderEgressCredential"]> {
    return this.runner.validateRuntimeProviderEgressCredential(input);
  }

  async createHostedWorkspaceSnapshotUploadSession(
    input: Parameters<HostedUserRunner["createHostedWorkspaceSnapshotUploadSession"]>[0],
  ): ReturnType<HostedUserRunner["createHostedWorkspaceSnapshotUploadSession"]> {
    return this.runner.createHostedWorkspaceSnapshotUploadSession(input);
  }

  async heartbeatHostedWorkspaceSnapshotUploadSession(
    input: Parameters<HostedUserRunner["heartbeatHostedWorkspaceSnapshotUploadSession"]>[0],
  ): ReturnType<HostedUserRunner["heartbeatHostedWorkspaceSnapshotUploadSession"]> {
    return this.runner.heartbeatHostedWorkspaceSnapshotUploadSession(input);
  }

  async completeHostedWorkspaceSnapshotUploadSession(
    input: Parameters<HostedUserRunner["completeHostedWorkspaceSnapshotUploadSession"]>[0],
  ): ReturnType<HostedUserRunner["completeHostedWorkspaceSnapshotUploadSession"]> {
    return this.runner.completeHostedWorkspaceSnapshotUploadSession(input);
  }

  async rememberHostedWorkspaceSnapshotReplacedRef(
    input: Parameters<HostedUserRunner["rememberHostedWorkspaceSnapshotReplacedRef"]>[0],
  ): ReturnType<HostedUserRunner["rememberHostedWorkspaceSnapshotReplacedRef"]> {
    return this.runner.rememberHostedWorkspaceSnapshotReplacedRef(input);
  }

  async rememberHostedWorkspaceSnapshotPresignedPut(
    input: Parameters<HostedUserRunner["rememberHostedWorkspaceSnapshotPresignedPut"]>[0],
  ): ReturnType<HostedUserRunner["rememberHostedWorkspaceSnapshotPresignedPut"]> {
    return this.runner.rememberHostedWorkspaceSnapshotPresignedPut(input);
  }

  async admitHostedBrowserVaultReplicaDirectPut(
    input: Parameters<HostedUserRunner["admitHostedBrowserVaultReplicaDirectPut"]>[0],
  ): ReturnType<HostedUserRunner["admitHostedBrowserVaultReplicaDirectPut"]> {
    return this.runner.admitHostedBrowserVaultReplicaDirectPut(input);
  }

  async releaseHostedBrowserVaultReplicaDirectPut(
    input: Parameters<HostedUserRunner["releaseHostedBrowserVaultReplicaDirectPut"]>[0],
  ): ReturnType<HostedUserRunner["releaseHostedBrowserVaultReplicaDirectPut"]> {
    return this.runner.releaseHostedBrowserVaultReplicaDirectPut(input);
  }

  async readHostedWorkspaceSnapshotUploadSession(
    input: Parameters<HostedUserRunner["readHostedWorkspaceSnapshotUploadSession"]>[0],
  ): ReturnType<HostedUserRunner["readHostedWorkspaceSnapshotUploadSession"]> {
    return this.runner.readHostedWorkspaceSnapshotUploadSession(input);
  }

  async deleteHostedWorkspaceSnapshotUploadSession(
    input: Parameters<HostedUserRunner["deleteHostedWorkspaceSnapshotUploadSession"]>[0],
  ): ReturnType<HostedUserRunner["deleteHostedWorkspaceSnapshotUploadSession"]> {
    return this.runner.deleteHostedWorkspaceSnapshotUploadSession(input);
  }

  async recordHostedWorkspaceSnapshotOrphanCandidate(
    input: Parameters<HostedUserRunner["recordHostedWorkspaceSnapshotOrphanCandidate"]>[0],
  ): ReturnType<HostedUserRunner["recordHostedWorkspaceSnapshotOrphanCandidate"]> {
    return this.runner.recordHostedWorkspaceSnapshotOrphanCandidate(input);
  }

  async recordHostedBrowserVaultReplicaOrphanCandidate(
    input: Parameters<HostedUserRunner["recordHostedBrowserVaultReplicaOrphanCandidate"]>[0],
  ): ReturnType<HostedUserRunner["recordHostedBrowserVaultReplicaOrphanCandidate"]> {
    return this.runner.recordHostedBrowserVaultReplicaOrphanCandidate(input);
  }

  async fetch(): Promise<Response> {
    return notFound();
  }

  async alarm(): Promise<void> {
    await this.runner.alarm();
  }
}

function createHostedUserRunner(
  state: DurableObjectStateLike,
  env: WorkerEnvironmentSource,
): HostedUserRunner {
  return new HostedUserRunner(
    state,
    readHostedExecutionEnvironment(asWorkerStringEnvironment(env)),
    env.BUNDLES,
    env,
    env.RUNNER_CONTAINER,
    env.HOSTED_RUNTIME_RETRY_ANALYTICS ?? null,
  );
}
