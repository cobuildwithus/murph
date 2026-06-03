import { DurableObject } from "cloudflare:workers";
import type {
  HostedRunnerStatusResponse,
  HostedWorkspaceInvocationReason,
  HostedWorkspaceInvocationResult,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedRuntimeEnsureProcessingRequest,
  HostedRuntimeEnsureProcessingResponse,
  HostedRuntimePrewarmRequest,
  HostedRuntimePrewarmResponse,
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
  HostedRunnerStuckInvocationTestResult,
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

  constructor(state: DurableObjectStateLike, env: WorkerEnvironmentSource) {
    super(state as never, env as never);
    this.runner = new HostedUserRunner(
      state,
      readHostedExecutionEnvironment(asWorkerStringEnvironment(env)),
      env.BUNDLES,
      env,
      env.RUNNER_CONTAINER,
    );
  }

  async bindUser(userId: string): Promise<{ userId: string }> {
    return this.runner.bindUser(userId);
  }

  async deleteHostedUserData(userId: string): ReturnType<HostedUserRunner["deleteHostedUserData"]> {
    return this.runner.deleteHostedUserData(userId);
  }

  async runnerStatus(input?: { logLimit?: number }): Promise<HostedRunnerStatusResponse> {
    return this.runner.runnerStatus(input);
  }

  async ensureRuntimeProcessingForUser(
    input: HostedRuntimeEnsureProcessingRequest & {
      commandTimeoutMs?: number;
      userId: string;
    },
  ): Promise<HostedRuntimeEnsureProcessingResponse> {
    return this.runner.ensureRuntimeProcessingForUser(input);
  }

  async prewarmRuntimeContainerForUser(
    input: HostedRuntimePrewarmRequest & {
      userId: string;
    },
  ): Promise<HostedRuntimePrewarmResponse> {
    return this.runner.prewarmRuntimeContainerForUser(input);
  }

  async validateRuntimeWriteFence(input: {
    attemptId: string;
    generation: string;
    userId: string;
  }): Promise<boolean> {
    return this.runner.validateRuntimeWriteFence(input);
  }

  async validateActiveRuntimeWriteFence(input: {
    userId: string;
  }): Promise<boolean> {
    return this.runner.validateActiveRuntimeWriteFence(input);
  }

  async createHostedWorkspaceSnapshotUploadSession(
    input: Parameters<HostedUserRunner["createHostedWorkspaceSnapshotUploadSession"]>[0],
  ): ReturnType<HostedUserRunner["createHostedWorkspaceSnapshotUploadSession"]> {
    return this.runner.createHostedWorkspaceSnapshotUploadSession(input);
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

  async beginRuntimeWriteFenceForSmoke(input: {
    userId: string;
    workspaceVersion: string;
  }): ReturnType<HostedUserRunner["beginRuntimeWriteFenceForSmoke"]> {
    return this.runner.beginRuntimeWriteFenceForSmoke(input);
  }

  async finishRuntimeWriteFenceForSmoke(input: {
    attemptId: string;
    generation: string;
    userId: string;
  }): ReturnType<HostedUserRunner["finishRuntimeWriteFenceForSmoke"]> {
    return this.runner.finishRuntimeWriteFenceForSmoke(input);
  }

  async runUntilIdleForTest(input: {
    reason: HostedWorkspaceInvocationReason;
    userId: string;
  }): Promise<HostedWorkspaceInvocationResult> {
    return await this.runner.runUntilIdleForTest(input);
  }

  async runAlarmForTest(input: { userId: string }): Promise<{ ok: true }> {
    await this.runner.bindUser(input.userId);
    await this.runner.alarm();
    return { ok: true };
  }

  async startStuckInvocationForTest(input: {
    expiresInMs?: number;
    reason?: HostedWorkspaceInvocationReason;
    startedAgoMs?: number;
    userId: string;
  }): Promise<HostedRunnerStuckInvocationTestResult> {
    await this.runner.bindUser(input.userId);
    return this.runner.startStuckInvocationForTest(input);
  }

  async fetch(): Promise<Response> {
    return notFound();
  }

  async alarm(): Promise<void> {
    await this.runner.alarm();
  }
}
