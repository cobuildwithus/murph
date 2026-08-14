import {
  type HostedHealthDataConsentState,
  type HostedRunnerStatusResponse,
  type HostedRuntimeHealthDataAdmissionResponse,
  type HostedRuntimeWebStatusResponse,
  type HostedWorkspaceReadResponse,
  type HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import type {
  CloudflareHostedControlRuntimeShellPrewarmSource,
} from "@murphai/cloudflare-hosted-control/client";
import type {
  HostedRuntimeEnsureProcessingResponse,
} from "@murphai/hosted-execution/orchestration-control";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  parseHostedRuntimeHealthDataAdmissionResponse,
  parseHostedRuntimeWebStatusResponse,
  parseHostedWorkspaceReadResponse,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_HEALTH_DATA_ADMISSION_PATH,
  HOSTED_RUNTIME_STATUS_PATH,
  HOSTED_RUNTIME_WORKSPACE_PATH,
} from "@murphai/hosted-execution/routes";
import type { R2BucketLike } from "../bundle-store.js";
import type { HostedBrowserVaultReplicaOrphanCandidate } from "../browser-vault-store.ts";
import type { HostedExecutionEnvironment } from "../env.js";
import {
  readHostedPrivateMediaCapabilitySecret,
  readHostedPrivateMediaDeliveryOrigin,
  stageHostedPrivateMedia,
  type HostedPrivateMediaPublishInput,
  type HostedPrivateMediaPublishResult,
} from "../private-media.ts";
import type { HostedExecutionContainerNamespaceLike } from "../runner-container.js";
import { withSerializedLock } from "../serialized-lock.js";
import type {
  WorkerAnalyticsEngineDatasetLike,
  WorkerProviderEgressCredentialValidationResult,
  WorkerProviderEgressTokenValidationResult,
} from "../worker-contracts.js";
import {
  fetchHostedExecutionWebControlPlaneResponse,
} from "../web-control-plane.ts";
import {
  RunnerStateStore,
  type RunnerWriteFenceToken,
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
  type RuntimeProcessingInput,
} from "./runtime-processing-controller.js";
export type { DurableObjectStateLike } from "./types.js";

export interface HostedRuntimeHealthDataConsentReconcileResult {
  activeInvocationPreempted: boolean;
  consentState: HostedHealthDataConsentState;
  processingAllowed: boolean;
  runnerContainerDestroyAttempted: boolean;
  runnerContainerDestroyOk: boolean;
  userId: string;
}

const HOSTED_RUNTIME_WITHDRAWN_CONSENT_RETRY_MS = 60_000;
// The retained hint measured a 693 ms provider-start p50 gain. Abandon its
// optional admission before it can consume even half of that useful overlap.
const HOSTED_RUNTIME_SHELL_PREWARM_ADMISSION_TIMEOUT_MS = 250;

export class HostedUserRunner {
  protected readonly stateStore: RunnerStateStore;
  protected readonly runtimeInvocation: RuntimeInvocationService;
  protected readonly runtimeProcessing: RuntimeProcessingController;
  private readonly userDataDeletionInput: HostedRunnerUserDataDeletionServiceInput;
  private readonly workspaceSnapshotSessions: WorkspaceSnapshotSessionService;
  private readonly runnerStoreCache: RunnerStoreCache;
  private readonly privateMediaBucket: R2BucketLike;
  private readonly privateMediaCapabilitySecret: string | null;
  private readonly privateMediaDeliveryOrigin: string;
  private readonly runtimeRetryAnalytics: WorkerAnalyticsEngineDatasetLike | null;
  private privateMediaMutationLock: Promise<void> | null = null;
  private runtimeConsentMutationLock: Promise<void> | null = null;

  constructor(
    state: DurableObjectStateLike,
    protected readonly env: HostedExecutionEnvironment,
    bucket: R2BucketLike,
    runnerRuntimeEnvSource: Readonly<Record<string, unknown>> = {},
    runnerContainerNamespace: HostedExecutionContainerNamespaceLike | null = (
      state as {
        runnerContainerNamespace?: HostedExecutionContainerNamespaceLike;
      }
    ).runnerContainerNamespace ?? null,
    runtimeRetryAnalytics: WorkerAnalyticsEngineDatasetLike | null = null,
  ) {
    // Keep this first. The schema floor must reject an older Worker before it
    // can construct any service capable of waking a runner or reading a workspace.
    this.stateStore = new RunnerStateStore(state);
    this.privateMediaBucket = bucket;
    this.privateMediaCapabilitySecret =
      readHostedPrivateMediaCapabilitySecret(runnerRuntimeEnvSource);
    this.privateMediaDeliveryOrigin =
      readHostedPrivateMediaDeliveryOrigin(runnerRuntimeEnvSource);
    this.runtimeRetryAnalytics = runtimeRetryAnalytics;
    this.runnerStoreCache = new RunnerStoreCache({
      bucket,
      env,
      runnerRuntimeEnvSource,
    });
    const runtimeInvocation = new RuntimeInvocationService({
      env,
      runnerContainerNamespace,
      runnerRuntimeEnvSource,
      runnerStoreCache: this.runnerStoreCache,
      stateStore: this.stateStore,
      assertWorkspaceBelongsToRunnerUser: (workspace, userId) => {
        this.assertWorkspaceBelongsToRunnerUser(workspace, userId);
      },
      readHostedRuntimeStatusFromWeb: async (userId) =>
        await this.readHostedRuntimeStatusFromWeb(userId, { logLimit: 0 }),
      readHostedWebControlBaseUrl: () => this.readHostedWebControlBaseUrl(),
      readHostedWorkspaceFromWeb: async (userId, input) => await this.readHostedWorkspaceFromWeb(userId, input),
    });
    this.runtimeInvocation = runtimeInvocation;
    this.workspaceSnapshotSessions = createWorkspaceSnapshotSessionService({
      bucket,
      runnerStoreCache: this.runnerStoreCache,
      state,
      stateStore: this.stateStore,
      assertWorkspaceBelongsToRunnerUser: (workspace, userId) => {
        this.assertWorkspaceBelongsToRunnerUser(workspace, userId);
      },
      readHostedWorkspaceFromWeb: async (userId) => await this.readHostedWorkspaceFromWeb(userId),
    });
    const runtimeProcessing = new RuntimeProcessingController({
      env,
      invocationService: runtimeInvocation,
      runnerContainerNamespace,
      readCheckpointHandoff: async (input) =>
        await this.workspaceSnapshotSessions.readCurrentOwnerHandoff(input),
      runnerRuntimeEnvSource,
      runtimeRetryAnalytics,
      stateStore: this.stateStore,
    });
    this.runtimeProcessing = runtimeProcessing;
    this.userDataDeletionInput = {
      bucket,
      runnerContainerNamespace,
      runnerRuntimeEnvSource,
      state,
      stateStore: this.stateStore,
    };
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
    const record = await this.stateStore.readState();
    await this.workspaceSnapshotSessions.cleanupOrphanCandidates(record.userId);
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
      nextAlarmAt: null,
      mailboxLag: webStatus.mailboxLag,
      userId: record.userId,
      workspace: webStatus.workspace,
    };
    return status;
  }

  async deleteHostedUserData(userId: string): Promise<HostedRunnerUserDataDeletionResult> {
    return this.withRuntimeConsentMutationLock(async () =>
      await this.withPrivateMediaMutationLock(async () => {
        this.runnerStoreCache.clearIfUser(userId);
        return await deleteHostedRunnerUserData({
          ...this.userDataDeletionInput,
          userId,
        });
      })
    );
  }

  async publishHostedPrivateMedia(
    input: HostedPrivateMediaPublishInput,
  ): Promise<HostedPrivateMediaPublishResult> {
    return this.withPrivateMediaMutationLock(async () => {
      const ownsWriteFence = await this.validateRuntimeWriteFence(input);
      if (!ownsWriteFence) {
        return {
          ok: false,
          reason: "write-fence-rejected",
        };
      }
      if (!this.privateMediaCapabilitySecret) {
        return {
          ok: false,
          reason: "not-configured",
        };
      }
      try {
        const staged = await stageHostedPrivateMedia({
          bucket: this.privateMediaBucket,
          bytes: input.bytes,
          capabilitySecret: this.privateMediaCapabilitySecret,
          contentType: input.contentType,
          deliveryOrigin: this.privateMediaDeliveryOrigin,
          userId: input.userId,
        });
        return {
          expiresAt: staged.expiresAt,
          ok: true,
          url: staged.url,
        };
      } catch {
        return {
          ok: false,
          reason: "stage-failed",
        };
      }
    });
  }

  async ensureRuntimeProcessingForUser(
    input: RuntimeProcessingInput,
  ): Promise<HostedRuntimeEnsureProcessingResponse> {
    return await this.withRuntimeConsentMutationLock(async () => {
      const lockInput = withRuntimeOrchestration(input, {
        runtimeConsentLockAcquiredAtEpochMs: Date.now(),
        healthDataAdmissionReadStartedAtEpochMs: Date.now(),
      });
      const admission = await this.readHostedRuntimeHealthDataAdmissionFromWeb(
        lockInput.userId,
      );
      const processingInput = withRuntimeOrchestration(lockInput, {
        healthDataAdmissionReadFinishedAtEpochMs: Date.now(),
      });
      if (!admission.processingAllowed) {
        return {
          kind: "retry_later",
          retryAt: new Date(
            Date.now() + HOSTED_RUNTIME_WITHDRAWN_CONSENT_RETRY_MS,
          ).toISOString(),
        };
      }
      return await this.runtimeProcessing.ensureForUser(processingInput);
    });
  }

  async prewarmRuntimeShellForUser(
    userId: string,
    source?: CloudflareHostedControlRuntimeShellPrewarmSource,
  ): Promise<void> {
    if (this.runtimeConsentMutationLock) {
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          shellPrewarmAdmissionOutcome: "skipped_consent_busy",
          shellPrewarmSource: source ?? "unknown",
        },
        message: "Hosted runner shell prewarm admission decided.",
        phase: "scheduled",
        userId,
      });
      return;
    }
    await this.withRuntimeConsentMutationLock(async () => {
      let admission: HostedRuntimeHealthDataAdmissionResponse;
      try {
        admission = await this.readHostedRuntimeHealthDataAdmissionFromWeb(
          userId,
          { timeoutMs: HOSTED_RUNTIME_SHELL_PREWARM_ADMISSION_TIMEOUT_MS },
        );
      } catch {
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            shellPrewarmAdmissionOutcome: "skipped_admission_unavailable",
            shellPrewarmSource: source ?? "unknown",
          },
          level: "warn",
          message: "Hosted runner shell prewarm admission decided.",
          phase: "scheduled",
          userId,
        });
        return;
      }
      if (!admission.processingAllowed) {
        emitHostedExecutionStructuredLog({
          component: "hosted.runner",
          details: {
            shellPrewarmAdmissionOutcome: "skipped_processing_disallowed",
            shellPrewarmSource: source ?? "unknown",
          },
          message: "Hosted runner shell prewarm admission decided.",
          phase: "scheduled",
          userId,
        });
        return;
      }
      await this.runtimeProcessing.beginShellPrewarmForUser(userId, source);
    });
  }

  async reconcileRuntimeHealthDataConsentForUser(
    userId: string,
  ): Promise<HostedRuntimeHealthDataConsentReconcileResult> {
    return await this.withRuntimeConsentMutationLock(async () => {
      const admission =
        await this.readHostedRuntimeHealthDataAdmissionFromWeb(userId);
      if (admission.processingAllowed) {
        return {
          activeInvocationPreempted: false,
          consentState: admission.consentState,
          processingAllowed: true,
          runnerContainerDestroyAttempted: false,
          runnerContainerDestroyOk: true,
          userId,
        };
      }

      return {
        ...(await this.runtimeProcessing
          .stopForHealthDataConsentWithdrawal(userId)),
        consentState: admission.consentState,
        processingAllowed: false,
        userId,
      };
    });
  }

  async validateRuntimeWriteFence(input: {
    attemptId: string;
    generation: string;
    userId: string;
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
        }),
        level: "warn",
        message: "Hosted runner runtime write fence validation rejected.",
        phase: "wake.running",
        userId: input.userId,
      });
    }
    return validation.owns;
  }

  async recordRuntimeCompletionFromContainer(
    input: Parameters<RuntimeInvocationService["recordRuntimeCompletionFromContainer"]>[0],
  ): ReturnType<RuntimeInvocationService["recordRuntimeCompletionFromContainer"]> {
    return this.runtimeInvocation.recordRuntimeCompletionFromContainer(input);
  }

  private async withPrivateMediaMutationLock<T>(
    run: () => Promise<T>,
  ): Promise<T> {
    return withSerializedLock(
      {
        get: () => this.privateMediaMutationLock,
        set: (value) => {
          this.privateMediaMutationLock = value;
        },
      },
      run,
    );
  }

  private async withRuntimeConsentMutationLock<T>(
    run: () => Promise<T>,
  ): Promise<T> {
    return withSerializedLock(
      {
        get: () => this.runtimeConsentMutationLock,
        set: (value) => {
          this.runtimeConsentMutationLock = value;
        },
      },
      run,
    );
  }

  async validateRuntimeProviderEgressToken(input: {
    providerEgressToken: string;
    userId: string;
  }): Promise<WorkerProviderEgressTokenValidationResult> {
    const validation = await this.stateStore.validateProviderEgressToken(input);
    if (!validation.owns) {
      const record = validation.record ?? null;
      const writeFence = record?.writeFence ?? null;
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          activeWriteFencePresent: writeFence !== null,
          providerEgressTokenRejectReason: validation.reason,
          activeWriteFenceUserMatches: record?.userId === input.userId,
        },
        level: "warn",
        message: "Hosted runner provider egress token validation rejected.",
        phase: "wake.running",
        userId: input.userId,
      });
      return {
        owns: false,
        reason: validation.reason,
      };
    }
    return {
      attemptId: validation.attemptId,
      ...(validation.customInferenceEnvelope
        ? { customInferenceEnvelope: validation.customInferenceEnvelope }
        : {}),
      leaseGeneration: validation.leaseGeneration,
      owns: true,
      ...(validation.platformAiUsageAllowed === undefined
        ? {}
        : { platformAiUsageAllowed: validation.platformAiUsageAllowed }),
      userId: validation.userId,
      workspaceVersion: validation.workspaceVersion,
    };
  }

  async validateRuntimeProviderEgressCredential(input: {
    providerKind: string;
    runnerContainerName: string;
    userId: string;
  }): Promise<WorkerProviderEgressCredentialValidationResult> {
    const validation = await this.stateStore.validateProviderEgressCredential(input);
    if (!validation.owns) {
      const record = validation.record ?? null;
      const writeFence = record?.writeFence ?? null;
      emitHostedExecutionStructuredLog({
        component: "hosted.runner",
        details: {
          activeRunnerContainerMatches:
            writeFence?.runnerContainerName === input.runnerContainerName,
          activeWriteFencePresent: writeFence !== null,
          providerEgressCredentialProviderKind: input.providerKind,
          providerEgressCredentialRejectReason: validation.reason,
          activeWriteFenceUserMatches: record?.userId === input.userId,
        },
        level: "warn",
        message: "Hosted runner provider egress credential validation rejected.",
        phase: "wake.running",
        userId: input.userId,
      });
      return {
        owns: false,
        reason: validation.reason,
      };
    }
    return {
      attemptId: validation.attemptId,
      leaseGeneration: validation.leaseGeneration,
      owns: true,
      ...(validation.platformAiUsageAllowed === undefined
        ? {}
        : { platformAiUsageAllowed: validation.platformAiUsageAllowed }),
      userId: validation.userId,
      workspaceVersion: validation.workspaceVersion,
    };
  }

  async createHostedWorkspaceSnapshotUploadSession(
    input: HostedWorkspaceSnapshotUploadSession,
  ): Promise<HostedWorkspaceSnapshotUploadSession | null> {
    return await this.workspaceSnapshotSessions.create(input);
  }

  async heartbeatHostedWorkspaceSnapshotUploadSession(input: {
    attemptId: string;
    leaseGeneration: string;
    snapshotId: string;
    userId: string;
  }): Promise<boolean> {
    return await this.workspaceSnapshotSessions.heartbeatCurrentOwner(input);
  }

  async completeHostedWorkspaceSnapshotUploadSession(input: {
    attemptId: string;
    leaseGeneration: string;
    snapshotId: string;
    userId: string;
  }): Promise<boolean> {
    return await this.workspaceSnapshotSessions.completeCurrentOwner(input);
  }

  async rememberHostedWorkspaceSnapshotReplacedRef(input: {
    expectedSession: HostedWorkspaceSnapshotUploadSession;
    replacedSnapshotRef: NonNullable<HostedWorkspaceSnapshotUploadSession["replacedSnapshotRef"]>;
  }): Promise<boolean> {
    return await this.workspaceSnapshotSessions.rememberReplacedSnapshotRef(input);
  }

  async rememberHostedWorkspaceSnapshotPresignedPut(input: {
    drainUntil: string;
    expectedSession: HostedWorkspaceSnapshotUploadSession;
    expiresAt: string;
  }): Promise<HostedWorkspaceSnapshotUploadSession | null> {
    return await this.workspaceSnapshotSessions.rememberPresignedPut(input);
  }

  async admitHostedBrowserVaultReplicaDirectPut(input: {
    admittedAt: string;
    attemptId: string;
    leaseGeneration: string;
    userId: string;
    writeId: string;
  }): Promise<boolean> {
    return await this.workspaceSnapshotSessions.admitBrowserVaultReplicaDirectPut(input);
  }

  async releaseHostedBrowserVaultReplicaDirectPut(input: {
    userId: string;
    writeId: string;
  }): Promise<void> {
    await this.workspaceSnapshotSessions.releaseBrowserVaultReplicaDirectPut(input);
  }

  async recordHostedWorkspaceSnapshotOrphanCandidate(
    input: HostedWorkspaceSnapshotOrphanCandidate,
  ): Promise<HostedWorkspaceSnapshotOrphanCandidate> {
    return await this.workspaceSnapshotSessions.recordOrphanCandidate(input);
  }

  async recordHostedBrowserVaultReplicaOrphanCandidate(
    input: HostedBrowserVaultReplicaOrphanCandidate,
  ): Promise<HostedBrowserVaultReplicaOrphanCandidate> {
    return await this.workspaceSnapshotSessions.recordBrowserVaultReplicaOrphanCandidate(input);
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
      search: input.logLimit === undefined ? null : `?logLimit=${input.logLimit}`,
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

  private async readHostedRuntimeHealthDataAdmissionFromWeb(
    userId: string,
    input: { timeoutMs?: number } = {},
  ): Promise<HostedRuntimeHealthDataAdmissionResponse> {
    const response = await fetchHostedExecutionWebControlPlaneResponse({
      ...(this.env.hostedWebAllowHttpHosts
        ? { allowHttpHosts: this.env.hostedWebAllowHttpHosts }
        : {}),
      baseUrl: this.readHostedWebControlBaseUrl(),
      boundUserId: userId,
      callbackSigning: this.env.webCallbackSigning,
      method: "GET",
      path: HOSTED_RUNTIME_HEALTH_DATA_ADMISSION_PATH,
      timeoutMs: input.timeoutMs ?? this.env.webControlTimeoutMs,
    });

    if (!response.ok) {
      throw new Error(
        `Hosted runtime health-data admission read failed with HTTP ${response.status}.`,
      );
    }

    const admission = parseHostedRuntimeHealthDataAdmissionResponse(
      await response.json(),
    );
    if (admission.userId !== userId) {
      throw new Error(
        "Hosted runtime health-data admission returned a different user.",
      );
    }
    return admission;
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

function withRuntimeOrchestration(
  input: RuntimeProcessingInput,
  orchestration: NonNullable<RuntimeProcessingInput["orchestration"]>,
): RuntimeProcessingInput {
  return {
    ...input,
    orchestration: {
      ...(input.orchestration ?? {}),
      ...orchestration,
    },
  };
}
