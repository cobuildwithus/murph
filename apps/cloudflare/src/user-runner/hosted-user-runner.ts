import {
  type HostedRunnerStatusResponse,
  type HostedRuntimeWebStatusResponse,
  type HostedWorkspaceReadResponse,
  type HostedWorkspaceInvocationReason,
  type HostedWorkspaceInvocationResult,
  type HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedRuntimeEnsureProcessingResponse,
  HostedRuntimePrewarmResponse,
} from "@murphai/hosted-execution/orchestration-control";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  parseHostedRuntimeWebStatusResponse,
  parseHostedWorkspaceReadResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_STATUS_PATH,
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";
import type { R2BucketLike } from "../bundle-store.js";
import type { HostedExecutionEnvironment } from "../env.js";
import type { HostedExecutionContainerNamespaceLike } from "../runner-container.js";
import type {
  WorkerActiveRuntimeWriteFenceValidationResult,
} from "../worker-contracts.js";
import {
  fetchHostedExecutionWebControlPlaneResponse,
} from "../web-control-plane.ts";
import type {
  RunnerWriteFenceToken,
} from "./runner-state-store.js";
import {
  RunnerStateStore,
} from "./runner-state-store.js";
import type {
  DurableObjectStateLike,
} from "./types.js";
import {
  type HostedWorkspaceSnapshotOrphanCandidate,
  type HostedWorkspaceSnapshotUploadSession,
} from "../workspace-snapshot-store.ts";
import {
  buildRunnerWriteFenceValidationRejectedDetails,
} from "./diagnostics.js";
import {
  RunnerWatchdog,
  readWriteFenceWatchdogAlarmAt,
} from "./watchdog.js";
import {
  createWorkspaceSnapshotSessionService,
  type WorkspaceSnapshotSessionService,
} from "./workspace-snapshot-sessions.js";
import {
  deleteHostedRunnerUserData,
  type HostedRunnerUserDataDeletionServiceInput,
  type HostedRunnerUserDataDeletionResult,
} from "./user-data-deletion.js";
import { RunnerStoreCache } from "./runner-store-cache.js";
import {
  RuntimeInvocationService,
} from "./runtime-invocation.js";
import {
  RuntimeProcessingController,
  type RuntimePrewarmInput,
  type RuntimeProcessingInput,
} from "./runtime-processing-controller.js";
import {
  RunnerTestControls,
  type HostedRunnerStuckInvocationTestResult,
} from "./test-controls.js";

export type { DurableObjectStateLike } from "./types.js";

export class HostedUserRunner {
  private readonly stateStore: RunnerStateStore;
  private readonly runtimeProcessing: RuntimeProcessingController;
  private readonly testControls: RunnerTestControls;
  private readonly userDataDeletionInput: HostedRunnerUserDataDeletionServiceInput;
  private readonly workspaceSnapshotSessions: WorkspaceSnapshotSessionService;
  private readonly runnerStoreCache: RunnerStoreCache;

  constructor(
    state: DurableObjectStateLike,
    private readonly env: HostedExecutionEnvironment,
    bucket: R2BucketLike,
    runnerRuntimeEnvSource: Readonly<Record<string, unknown>> = {},
    runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null = (
      state as {
        runnerContainerNamespace?: HostedExecutionContainerNamespaceLike;
      }
    ).runnerContainerNamespace ?? null,
  ) {
    this.stateStore = new RunnerStateStore(state);
    this.runnerStoreCache = new RunnerStoreCache({
      bucket,
      env,
      runnerRuntimeEnvSource,
    });
    const watchdog = new RunnerWatchdog(state);
    const runtimeInvocation = new RuntimeInvocationService({
      env,
      runnerContainerNamespace,
      runnerRuntimeEnvSource,
      runnerStoreCache: this.runnerStoreCache,
      stateStore: this.stateStore,
      assertWorkspaceBelongsToRunnerUser: (workspace, userId) => {
        this.assertWorkspaceBelongsToRunnerUser(workspace, userId);
      },
      readHostedRuntimeStatusFromWeb: async (userId) => await this.readHostedRuntimeStatusFromWeb(userId),
      readHostedWebControlBaseUrl: () => this.readHostedWebControlBaseUrl(),
      readHostedWorkspaceFromWeb: async (userId, input) => await this.readHostedWorkspaceFromWeb(userId, input),
      watchdog,
    });
    const runtimeProcessing = new RuntimeProcessingController({
      env,
      invocationService: runtimeInvocation,
      runnerContainerNamespace,
      runnerRuntimeEnvSource,
      state,
      stateStore: this.stateStore,
      watchdog,
    });
    this.runtimeProcessing = runtimeProcessing;
    this.testControls = new RunnerTestControls({
      env,
      runtimeInvocation,
      runtimeProcessing,
      stateStore: this.stateStore,
    });
    this.userDataDeletionInput = {
      bucket,
      runnerContainerNamespace,
      runnerRuntimeEnvSource,
      state,
      stateStore: this.stateStore,
    };
    this.workspaceSnapshotSessions = createWorkspaceSnapshotSessionService({
      bucket,
      state,
      stateStore: this.stateStore,
      assertWorkspaceBelongsToRunnerUser: (workspace, userId) => {
        this.assertWorkspaceBelongsToRunnerUser(workspace, userId);
      },
      readHostedWorkspaceFromWeb: async (userId) => await this.readHostedWorkspaceFromWeb(userId),
    });
  }

  async bindUser(userId: string): Promise<{ userId: string }> {
    await this.stateStore.bindUser(userId);
    emitHostedExecutionStructuredLog({
      component: "hosted.runner",
      message: "Hosted runner bound user.",
      phase: "runtime.starting",
      userId,
    });
    return { userId };
  }

  async alarm(): Promise<void> {
    await this.runtimeProcessing.alarm();
  }

  async runnerStatus(input: { logLimit?: number } = {}): Promise<HostedRunnerStatusResponse> {
    const record = await this.stateStore.readState();
    const activeWriteFence = await this.stateStore.readWriteFenceToken();
    const webStatus = await this.readHostedRuntimeStatusFromWeb(record.userId, {
      logLimit: input.logLimit,
    });

    const status: HostedRunnerStatusResponse & {
      activeWriteFence: RunnerWriteFenceToken | null;
    } = {
      ...webStatus,
      activeWriteFence,
      inFlight: record.writeFence !== null,
      ...(record.lastErrorAt ? { lastErrorAt: record.lastErrorAt } : {}),
      ...(record.lastErrorCode ? { lastErrorCode: record.lastErrorCode } : {}),
      ...(record.lastInvocationAt ? { lastInvocationAt: record.lastInvocationAt } : {}),
      nextAlarmAt: readWriteFenceWatchdogAlarmAt(record),
      mailboxLag: webStatus.mailboxLag,
      userId: record.userId,
      workspace: webStatus.workspace,
    };
    return status;
  }

  async deleteHostedUserData(userId: string): Promise<HostedRunnerUserDataDeletionResult> {
    this.runnerStoreCache.clearIfUser(userId);
    return await deleteHostedRunnerUserData({
      ...this.userDataDeletionInput,
      userId,
    });
  }

  async ensureRuntimeProcessingForUser(
    input: RuntimeProcessingInput,
  ): Promise<HostedRuntimeEnsureProcessingResponse> {
    return await this.runtimeProcessing.ensureForUser(input);
  }

  async prewarmRuntimeContainerForUser(
    input: RuntimePrewarmInput,
  ): Promise<HostedRuntimePrewarmResponse> {
    return await this.runtimeProcessing.prewarmForUser(input);
  }

  async validateRuntimeWriteFence(input: {
    attemptId: string;
    generation: string;
    userId: string;
    workspaceVersion?: string | null;
  }): Promise<boolean> {
    const validation = await this.stateStore.validateWriteFenceToken(input);
    if (!validation.owns) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: buildRunnerWriteFenceValidationRejectedDetails({
          attemptId: input.attemptId,
          generation: input.generation,
          record: validation.record,
          userId: input.userId,
          workspaceVersion: input.workspaceVersion ?? null,
        }),
        level: "warn",
        message: "Hosted runner runtime write fence validation rejected.",
        phase: "wake.running",
        userId: input.userId,
      });
    }
    return validation.owns;
  }

  async validateActiveRuntimeWriteFence(input: {
    runnerContainerName: string;
    userId: string;
  }): Promise<WorkerActiveRuntimeWriteFenceValidationResult> {
    const validation = await this.stateStore.validateActiveWriteFence(input);
    if (!validation.owns) {
      const writeFence = validation.record.writeFence;
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          activeWriteFencePresent: writeFence !== null,
          activeWriteFenceUserMatches: validation.record.userId === input.userId,
        },
        level: "warn",
        message: "Hosted runner active runtime write fence validation rejected.",
        phase: "wake.running",
        userId: input.userId,
      });
      return { owns: false };
    }
    return {
      attemptId: validation.attemptId,
      leaseGeneration: validation.leaseGeneration,
      owns: true,
      userId: validation.userId,
      workspaceVersion: validation.workspaceVersion,
    };
  }

  async createHostedWorkspaceSnapshotUploadSession(
    input: HostedWorkspaceSnapshotUploadSession,
  ): Promise<HostedWorkspaceSnapshotUploadSession> {
    return await this.workspaceSnapshotSessions.create(input);
  }

  async recordHostedWorkspaceSnapshotOrphanCandidate(
    input: HostedWorkspaceSnapshotOrphanCandidate,
  ): Promise<HostedWorkspaceSnapshotOrphanCandidate> {
    return await this.workspaceSnapshotSessions.recordOrphanCandidate(input);
  }

  async readHostedWorkspaceSnapshotUploadSession(input: {
    snapshotId: string;
    userId: string;
  }): Promise<HostedWorkspaceSnapshotUploadSession | null> {
    return await this.workspaceSnapshotSessions.read(input);
  }

  async deleteHostedWorkspaceSnapshotUploadSession(input: {
    snapshotId: string;
    userId: string;
  }): Promise<{ deleted: boolean }> {
    return await this.workspaceSnapshotSessions.delete(input);
  }

  async beginRuntimeWriteFenceForSmoke(input: {
    userId: string;
    workspaceVersion: string;
  }): Promise<RunnerWriteFenceToken | null> {
    return await this.testControls.beginRuntimeWriteFenceForSmoke(input);
  }

  async finishRuntimeWriteFenceForSmoke(input: {
    attemptId: string;
    generation: string;
    userId: string;
  }): Promise<{ completed: boolean }> {
    return await this.testControls.finishRuntimeWriteFenceForSmoke(input);
  }

  async runUntilIdleForTest(input: {
    reason: HostedWorkspaceInvocationReason;
    userId: string;
  }): Promise<HostedWorkspaceInvocationResult> {
    return await this.testControls.runUntilIdleForTest(input);
  }

  async startStuckInvocationForTest(input: {
    expiresInMs?: number;
    reason?: HostedWorkspaceInvocationReason;
    startedAgoMs?: number;
    userId: string;
  }): Promise<HostedRunnerStuckInvocationTestResult> {
    return await this.testControls.startStuckInvocationForTest(input);
  }

  private async readHostedRuntimeStatusFromWeb(
    userId: string,
    input: { logLimit?: number } = {},
  ): Promise<HostedRuntimeWebStatusResponse> {
    const response = await fetchHostedExecutionWebControlPlaneResponse({
      ...(this.env.hostedWebAllowHttpHosts
        ? { allowHttpHosts: this.env.hostedWebAllowHttpHosts }
        : {}),
      baseUrl: this.readHostedWebControlBaseUrl(),
      boundUserId: userId,
      callbackSigning: this.env.webCallbackSigning,
      method: "GET",
      path: HOSTED_RUNTIME_STATUS_PATH,
      search: input.logLimit ? `?logLimit=${input.logLimit}` : null,
      timeoutMs: this.env.webControlTimeoutMs,
    });

    if (!response.ok) {
      throw new Error(`Hosted runtime status read failed with HTTP ${response.status}.`);
    }

    const status = parseHostedRuntimeWebStatusResponse(await response.json());
    if (status.userId !== userId) {
      throw new Error("Hosted runtime status read returned a different user.");
    }
    this.assertWorkspaceBelongsToRunnerUser(status.workspace, userId);
    return status;
  }

  private async readHostedWorkspaceFromWeb(
    userId: string,
    input: { timeoutMs?: number } = {},
  ): Promise<HostedWorkspaceReadResponse> {
    const response = await fetchHostedExecutionWebControlPlaneResponse({
      ...(this.env.hostedWebAllowHttpHosts
        ? { allowHttpHosts: this.env.hostedWebAllowHttpHosts }
        : {}),
      baseUrl: this.readHostedWebControlBaseUrl(),
      boundUserId: userId,
      callbackSigning: this.env.webCallbackSigning,
      method: "GET",
      path: HOSTED_RUNTIME_WORKSPACE_PATH,
      timeoutMs: input.timeoutMs ?? this.env.webControlTimeoutMs,
    });

    if (!response.ok) {
      throw new Error(`Hosted workspace read failed with HTTP ${response.status}.`);
    }

    return parseHostedWorkspaceReadResponse(await response.json());
  }

  private assertWorkspaceBelongsToRunnerUser(
    workspace: HostedWorkspaceState | null,
    userId: string,
  ): void {
    if (workspace && workspace.userId !== userId) {
      throw new Error("Hosted workspace read returned a different user.");
    }
  }

  private readHostedWebControlBaseUrl(): string {
    return this.env.hostedWebBaseUrl;
  }
}
