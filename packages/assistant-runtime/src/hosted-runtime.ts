import type {
  HostedWorkspaceInvocationResult,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  notifyAssistantActiveTurnInputsAvailableForVault,
} from "@murphai/assistant-engine";
import {
  normalizeHostedAssistantRuntimeConfig,
  withHostedProcessEnvironment,
} from "./hosted-runtime/environment.ts";
import {
  prepareHostedCodexRuntimeEnvironment,
} from "./hosted-runtime/codex-config.ts";
import {
  startHostedCliRuntimeBridge,
} from "./hosted-runtime/cli-runtime-bridge.ts";
import {
  executeHostedMailboxEvent,
} from "./hosted-runtime/events.ts";
import {
  createHostedAssistantChannelTypingDependencies,
} from "./hosted-runtime/channel-activity.ts";
import type {
  HostedAssistantWorkspaceRuntimeJobInput,
} from "./hosted-runtime/models.ts";
import type {
  HostedMailboxItemImportOutcome,
  HostedMailboxResolvedImportItem,
} from "./hosted-runtime/mailbox-import.ts";
import {
  createEmptyHostedMailboxImportState,
  type HostedMailboxImportState,
} from "./hosted-runtime/mailbox-state.ts";
import type {
  HostedRuntimeDeviceSyncMessagingReturnTarget,
  HostedRuntimePlatform,
} from "./hosted-runtime/platform.ts";
import {
  startRuntimeLivenessHeartbeat,
  type RuntimeLivenessRejectionReason,
} from "./hosted-runtime/liveness.ts";
import {
  buildHostedMailboxImportRedactedStatus,
  HostedMailboxImportCheckpointConflictError,
  HostedMailboxImportCheckpointUserMismatchError,
  importHostedMailboxPrefixAndCheckpoint,
} from "./hosted-runtime/mailbox-checkpoint.ts";
import type {
  HostedWorkspaceSnapshotCheckpointBuilder,
} from "./hosted-runtime/workspace-runner.ts";
import {
  createHostedWorkspaceCheckpointRequestBuilder,
  createHostedWorkspaceSnapshotCheckpointRequestBuilder,
  HostedWorkspaceRunnerUserMismatchError,
  importHostedMailboxForWorkspaceRunner,
  runHostedWorkspaceUntilIdleOrBudget,
  type HostedWorkspaceRunnerInput,
} from "./hosted-runtime/workspace-runner.ts";
import {
  restoreHostedWorkspaceRuntimeJobWorkspace,
} from "./hosted-runtime/workspace-restore.ts";
import {
  runHostedWorkspaceAssistantPhase,
  type HostedWorkspaceRuntimeAssistantPhase,
} from "./hosted-runtime/workspace-assistant-phase.ts";
import {
  createHostedConversationMailboxImportItem,
} from "./hosted-runtime/mailbox-conversation-import.ts";
import {
  ensureHostedInboxSidecarReady,
} from "./hosted-runtime/context.ts";
import {
  enqueueHostedSystemMailboxItem,
} from "./hosted-runtime/system-mailbox.ts";
import {
  computeHostedRuntimeElapsedMs,
} from "./hosted-runtime/utils.ts";
export {
  formatHostedRuntimeChildResult,
  parseHostedRuntimeChildResult,
} from "./hosted-runtime/child-result.ts";
export {
  createHostedBrowserVaultReplicaForSnapshot,
} from "./hosted-runtime/browser-vault-replica.ts";

export type {
  HostedAssistantRuntimeChannelCapabilities,
  HostedAssistantRuntimeConfig,
  HostedAssistantRuntimeDeviceSyncConfig,
  HostedAssistantWorkspaceRuntimeJobInput,
  HostedAssistantWorkspaceRuntimeJobResult,
  HostedAssistantRuntimeManagedAutoReplyChannel,
  HostedAssistantRuntimeResolvedConfig,
} from "./hosted-runtime/models.ts";
export type {
  HostedRuntimeArtifactStore,
  HostedRuntimeActiveTurnInputCheckpoint,
  HostedRuntimeActiveTurnInputCheckpointInput,
  HostedRuntimeActiveTurnInputMailboxRefresh,
  HostedRuntimeActiveTurnInputMailboxRefreshInput,
  HostedRuntimeBrowserVaultReplicaPort,
  HostedRuntimeDeviceSyncMessagingReturnTarget,
  HostedRuntimeDeviceSyncPort,
  HostedRuntimeEffectsPort,
  HostedRuntimeIssueExportPort,
  HostedRuntimeIssueRecordResponse,
  HostedRuntimeLinqChatActionRequest,
  HostedRuntimeLinqDeleteMessagesRequest,
  HostedRuntimeLinqMarkReadRequest,
  HostedRuntimeLinqSendRequest,
  HostedRuntimeLinqSendResponse,
  HostedRuntimeLogPort,
  HostedRuntimeMailboxPort,
  HostedRuntimePlatform,
  HostedRuntimeProviderFileResponse,
  HostedRuntimeProviderTargetKind,
  HostedRuntimeTelegramChatActionRequest,
  HostedRuntimeTelegramCleanupMessage,
  HostedRuntimeTelegramDownloadFileRequest,
  HostedRuntimeTelegramFile,
  HostedRuntimeTelegramGetFileRequest,
  HostedRuntimeTelegramSendRequest,
  HostedRuntimeTelegramSendResponse,
  HostedRuntimeUsageRecordResponse,
  HostedRuntimeUsageExportPort,
  HostedRuntimeWorkspacePort,
} from "./hosted-runtime/platform.ts";
export type {
  RuntimeLivenessPort,
  RuntimeLivenessRejectionReason,
  RuntimeLivenessTouchResult,
} from "./hosted-runtime/liveness.ts";
export {
  normalizeHostedAssistantRuntimeConfig,
  projectHostedRuntimeToChildEnv,
  sanitizeHostedAssistantRuntimeForwardedEnv,
} from "./hosted-runtime/environment.ts";
export {
  executeHostedMailboxEvent,
};
export {
  parseHostedRuntimeIssueRecordResponse,
  parseHostedRuntimeUsageRecordResponse,
} from "./hosted-runtime/platform.ts";
export {
  computeHostedRuntimeElapsedMs,
} from "./hosted-runtime/utils.ts";
export {
  createHostedAssistantChannelTypingDependencies,
} from "./hosted-runtime/channel-activity.ts";
export {
  readHostedRunnerCommitTimeoutMs,
} from "./hosted-runtime/timeouts.ts";
export type {
  HostedMailboxImportCheckpointInput,
  HostedMailboxImportCheckpointRequestInput,
  HostedMailboxImportCheckpointResult,
} from "./hosted-runtime/mailbox-checkpoint.ts";
export {
  buildHostedMailboxImportRedactedStatus,
  HostedMailboxImportCheckpointConflictError,
  HostedMailboxImportCheckpointUserMismatchError,
  importHostedMailboxPrefixAndCheckpoint,
};
export type {
  HostedWorkspaceCheckpointMetadata,
  HostedWorkspaceCheckpointRequestBuilder,
  HostedWorkspaceSnapshotCheckpointBuilder,
  HostedWorkspaceSnapshotCheckpointMetadata,
  HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
  HostedWorkspaceSnapshotCheckpointResult,
  HostedWorkspaceRunnerAssistantPhaseInput,
  HostedWorkspaceRunnerAssistantPhaseResult,
  HostedWorkspaceRunnerCheckpointRequestInput,
  HostedWorkspaceRunnerInput,
  HostedWorkspaceRunnerPlatform,
  HostedWorkspaceRunnerResult,
} from "./hosted-runtime/workspace-runner.ts";
export {
  createHostedWorkspaceCheckpointRequestBuilder,
  createHostedWorkspaceSnapshotCheckpointRequestBuilder,
  HostedWorkspaceRunnerUserMismatchError,
  runHostedWorkspaceUntilIdleOrBudget,
};
export {
  createHostedConversationMailboxImportItem,
};
export {
  enqueueHostedSystemMailboxItem,
};
export {
  parseHostedAssistantRuntimeConfig,
  parseHostedAssistantWorkspaceRuntimeJobInput,
  parseHostedAssistantWorkspaceRuntimeJobRequest,
} from "./hosted-runtime/parsers.ts";

export interface HostedWorkspaceRuntimeJobOptions {
  createCheckpointSnapshot: HostedWorkspaceSnapshotCheckpointBuilder;
  importItem(
    item: HostedMailboxResolvedImportItem,
    context?: HostedWorkspaceRuntimeJobImportContext,
  ): Promise<HostedMailboxItemImportOutcome>;
  platform: HostedRuntimePlatform;
  runAssistantPhase?: HostedWorkspaceRuntimeAssistantPhase;
  vaultRoot: string;
}

export interface HostedWorkspaceRuntimeJobImportContext {
  recordMessagingReturnTarget?(
    target: HostedRuntimeDeviceSyncMessagingReturnTarget | null,
  ): void;
  signal?: AbortSignal | null;
}

export class HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError extends Error {
  readonly actualWorkspaceVersion: string | null;
  readonly expectedWorkspaceVersion: string;

  constructor(input: {
    actualWorkspaceVersion: string | null;
    expectedWorkspaceVersion: string;
  }) {
    super("Hosted workspace runtime job read a stale workspace version.");
    this.name = "HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError";
    this.actualWorkspaceVersion = input.actualWorkspaceVersion;
    this.expectedWorkspaceVersion = input.expectedWorkspaceVersion;
  }
}

export class HostedWorkspaceRuntimeLivenessRejectedError extends Error {
  readonly reason: RuntimeLivenessRejectionReason;

  constructor(reason: RuntimeLivenessRejectionReason) {
    super(`Hosted workspace runtime liveness heartbeat was rejected: ${reason}.`);
    this.name = "HostedWorkspaceRuntimeLivenessRejectedError";
    this.reason = reason;
  }
}

export async function runHostedWorkspaceRuntimeJobInProcess(
  input: HostedAssistantWorkspaceRuntimeJobInput,
  options: HostedWorkspaceRuntimeJobOptions,
): Promise<HostedWorkspaceInvocationResult> {
  const runtime = normalizeHostedAssistantRuntimeConfig(input.runtime, options.platform);
  const mailboxPort = runtime.platform.mailboxPort ?? null;
  const workspacePort = runtime.platform.workspacePort ?? null;
  if (!mailboxPort) {
    throw new TypeError("Hosted workspace runtime job mailbox port must be injected.");
  }

  if (!workspacePort) {
    throw new TypeError("Hosted workspace runtime job workspace port must be injected.");
  }

  if (typeof workspacePort.read !== "function") {
    throw new TypeError("Hosted workspace runtime job workspace port must support read.");
  }

  assertHostedWorkspaceRuntimeBudgetSupported(input.request.budget?.maxRuntimeMs);

  const livenessAbortController = new AbortController();
  let livenessRejectedReason: RuntimeLivenessRejectionReason | null = null;
  let activeVaultRoot = options.vaultRoot;
  const requestId = `hosted-workspace-invocation:${input.request.attemptId}`;
  const assertRuntimeLiveness = () => {
    if (livenessRejectedReason) {
      throw new HostedWorkspaceRuntimeLivenessRejectedError(livenessRejectedReason);
    }
  };
  const heartbeat = startRuntimeLivenessHeartbeat({
    intervalMs: runtime.platform.runtimeLivenessIntervalMs ?? undefined,
    onRejected: (reason) => {
      livenessRejectedReason = reason;
      livenessAbortController.abort(new HostedWorkspaceRuntimeLivenessRejectedError(reason));
    },
    onInputAvailable: () =>
      notifyAssistantActiveTurnInputsAvailableForVault({
        signal: livenessAbortController.signal,
        vault: activeVaultRoot,
      }).then(() => undefined),
    port: runtime.platform.runtimeLivenessPort,
    requestId,
    signal: livenessAbortController.signal,
  });
  const guardedPlatform = createLivenessGuardedHostedRuntimePlatform(
    runtime.platform,
    assertRuntimeLiveness,
  );
  const guardedRuntime = {
    ...runtime,
    platform: guardedPlatform,
  };
  const guardedMailboxPort = guardedRuntime.platform.mailboxPort ?? mailboxPort;
  const guardedWorkspacePort = guardedRuntime.platform.workspacePort ?? workspacePort;
  const createLivenessGuardedCheckpointSnapshot: HostedWorkspaceSnapshotCheckpointBuilder =
    async (snapshotInput) => {
      assertRuntimeLiveness();
      const snapshot = await options.createCheckpointSnapshot(snapshotInput);
      assertRuntimeLiveness();
      return snapshot;
    };

  try {
    const initialLiveness = await heartbeat.initialTouch;
    if (!initialLiveness.ok) {
      throw new HostedWorkspaceRuntimeLivenessRejectedError(initialLiveness.reason);
    }

    const workspaceRead = await raceHostedRuntimeLiveness(
      workspacePort.read(),
      livenessAbortController.signal,
    );
    assertRuntimeLiveness();
    assertWorkspaceRunVersionMatchesRequest({
      expectedWorkspaceVersion: input.request.workspaceVersion,
      workspace: workspaceRead.workspace,
    });
    assertWorkspaceRunUserMatchesRequest({
      expectedUserId: input.request.userId,
      workspace: workspaceRead.workspace,
    });
    const mailboxBudget = createHostedWorkspaceMailboxImportBudget(
      input.request.budget?.maxMailboxItems,
    );
    let hostedCliBridgeMessagingReturnTarget: HostedRuntimeDeviceSyncMessagingReturnTarget | null =
      null;
    const runnerPlatform = {
      ...guardedRuntime.platform,
      mailboxPort: guardedMailboxPort,
      workspacePort: guardedWorkspacePort,
    };
    const runtimeLogContext = {
      attemptId: input.request.attemptId,
      leaseGeneration: input.request.leaseGeneration,
      workspaceVersion: input.request.workspaceVersion,
    };
    const checkpointRequestBuilder = createHostedWorkspaceSnapshotCheckpointRequestBuilder({
      createSnapshot: createLivenessGuardedCheckpointSnapshot,
      metadata: {
        attemptId: input.request.attemptId,
        expectedWorkspaceVersion: input.request.workspaceVersion,
        leaseGeneration: input.request.leaseGeneration,
        nextWakeAt: workspaceRead.workspace?.nextWakeAt ?? null,
        nextWakeReason: workspaceRead.workspace?.nextWakeReason ?? null,
      },
    });
    const importMailboxItem: HostedWorkspaceRunnerInput["importItem"] = (item) =>
      mailboxBudget.importItem(
        item,
        async (importItem, context) => {
          assertRuntimeLiveness();
          const outcome = await options.importItem(importItem, context);
          assertRuntimeLiveness();
          return outcome;
        },
        {
          recordMessagingReturnTarget: (target) => {
            hostedCliBridgeMessagingReturnTarget = target;
          },
          signal: livenessAbortController.signal,
        },
      );
    const restored = await raceHostedRuntimeLiveness(
      restoreHostedWorkspaceRuntimeJobWorkspace({
        platform: guardedRuntime.platform,
        vaultRoot: options.vaultRoot,
        workspace: workspaceRead.workspace,
      }),
      livenessAbortController.signal,
    );
    activeVaultRoot = restored.vaultRoot;
    assertRuntimeLiveness();
    const baseRunnerInput: HostedWorkspaceRunnerInput = {
      checkpointRequestBuilder,
      expectedUserId: input.request.userId,
      importItem: importMailboxItem,
      limitPerLane: mailboxBudget.fetchLimitPerLane,
      platform: runnerPlatform,
      requestId,
      runtimeLogContext,
      vaultRoot: restored.vaultRoot,
      workspace: workspaceRead.workspace,
    };
    const initialMailboxImport = await raceHostedRuntimeLiveness(
      importHostedMailboxForWorkspaceRunner({
        checkpointRequestBuilder,
        checkpointReason: "import",
        input: baseRunnerInput,
        requestId,
      }),
      livenessAbortController.signal,
    );
    assertRuntimeLiveness();
    await raceHostedRuntimeLiveness(
      ensureHostedInboxSidecarReady({
        bestEffort: true,
        rebuild: true,
        requestId,
        vaultRoot: restored.vaultRoot,
      }),
      livenessAbortController.signal,
    );
    assertRuntimeLiveness();
    const baseRuntimeEnv = {
      ...guardedRuntime.forwardedEnv,
      ...guardedRuntime.userEnv,
    };
    const hostedCodexRuntime = await raceHostedRuntimeLiveness(
      prepareHostedCodexRuntimeEnvironment({
        operatorHomeRoot: restored.operatorHomeRoot,
        runtimeEnv: baseRuntimeEnv,
      }),
      livenessAbortController.signal,
    );
    assertRuntimeLiveness();
    const hostedCliBridge = await startHostedCliRuntimeBridge({
      deviceSyncPort: guardedRuntime.platform.deviceSyncPort,
      messagingReturnTarget: () => hostedCliBridgeMessagingReturnTarget,
    });
    const runtimeEnv = {
      ...hostedCodexRuntime.runtimeEnv,
      ...(hostedCliBridge?.env ?? {}),
    };

    let result: Awaited<ReturnType<typeof runHostedWorkspaceUntilIdleOrBudget>>;
    try {
      result = await raceHostedRuntimeLiveness(
        withHostedProcessEnvironment(
          {
            envOverrides: runtimeEnv,
            operatorHomeRoot: restored.operatorHomeRoot,
            vaultRoot: restored.vaultRoot,
          },
          async () =>
            runHostedWorkspaceUntilIdleOrBudget({
              ...baseRunnerInput,
              initialMailboxImport,
              runAssistantPhase: (phaseInput) =>
                (options.runAssistantPhase ?? runHostedWorkspaceAssistantPhase)({
                  ...phaseInput,
                  request: input.request,
                  restored,
                  runtime: guardedRuntime,
                  runtimeEnv,
                  signal: livenessAbortController.signal,
                }),
            }),
        ),
        livenessAbortController.signal,
      );
    } finally {
      await hostedCliBridge?.stop();
    }
    assertRuntimeLiveness();
    const committedWorkspace = result.latestWorkspace
      ?? result.initialMailboxImport.checkpoint?.workspace
      ?? workspaceRead.workspace;
    const mailboxImportRetryAt = result.initialMailboxImport.importResult.nextRetryAt ?? null;
    const nextWakeAt = resolveHostedWorkspaceRunNextWakeAt({
      assistantPhaseResult: result.assistantPhaseResult,
      committedWorkspace,
      mailboxImportRetryAt,
    });

    return {
      ...(nextWakeAt === undefined ? {} : { nextWakeAt }),
      ...(committedWorkspace?.redactedStatus
        ? { redactedStatus: committedWorkspace.redactedStatus }
        : { redactedStatus: buildHostedMailboxImportRedactedStatus(result.initialMailboxImport.importResult) }),
      status: resolveHostedWorkspaceInvocationStatus({
        mailboxBudgetExhausted: mailboxBudget.exhausted,
        nextWakeAt,
      }),
    };
  } finally {
    await heartbeat.stop();
  }
}

function raceHostedRuntimeLiveness<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(readHostedRuntimeAbortReason(signal));
  }

  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      reject(readHostedRuntimeAbortReason(signal));
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function readHostedRuntimeAbortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Hosted workspace runtime liveness was aborted.");
}

function assertHostedWorkspaceRuntimeBudgetSupported(maxRuntimeMs: number | null | undefined): void {
  if (maxRuntimeMs === undefined || maxRuntimeMs === null) {
    return;
  }

  throw new TypeError("Hosted workspace runtime job budget.maxRuntimeMs is not supported yet.");
}

function createLivenessGuardedHostedRuntimePlatform(
  platform: HostedRuntimePlatform,
  assertLive: () => void,
): HostedRuntimePlatform {
  const guard = async <T>(run: () => Promise<T>): Promise<T> => {
    assertLive();
    const result = await run();
    assertLive();
    return result;
  };

  return {
    ...platform,
    artifactStore: {
      get: platform.artifactStore.get,
      put: (putInput) => guard(() => platform.artifactStore.put(putInput)),
    },
    ...(platform.checkpointActiveTurnInput
      ? {
          checkpointActiveTurnInput: (checkpointInput) =>
            guard(() => platform.checkpointActiveTurnInput!(checkpointInput)),
        }
      : {}),
    ...(platform.browserVaultReplicaPort
      ? {
          browserVaultReplicaPort: {
            write: (writeInput) =>
              guard(() => platform.browserVaultReplicaPort!.write(writeInput)),
          },
        }
      : {}),
    ...(platform.deviceSyncPort
      ? {
          deviceSyncPort: {
            ackDirtyStateProcessed: (ackInput) =>
              guard(() => platform.deviceSyncPort!.ackDirtyStateProcessed(ackInput)),
            applyUpdates: (applyInput) =>
              guard(() => platform.deviceSyncPort!.applyUpdates(applyInput)),
            createConnectLink: (connectInput) =>
              guard(() => platform.deviceSyncPort!.createConnectLink(connectInput)),
            fetchDirtyStates: (dirtyInput) =>
              guard(() => platform.deviceSyncPort!.fetchDirtyStates(dirtyInput)),
            fetchSnapshot: platform.deviceSyncPort.fetchSnapshot,
          },
        }
      : {}),
    effectsPort: {
      ...platform.effectsPort,
      ...(platform.effectsPort.deletePreparedAssistantDelivery
        ? {
            deletePreparedAssistantDelivery: (deleteInput) =>
              guard(() => platform.effectsPort.deletePreparedAssistantDelivery!(deleteInput)),
          }
        : {}),
      ...(platform.effectsPort.readAssistantDeliveryRecord
        ? {
            readAssistantDeliveryRecord: platform.effectsPort.readAssistantDeliveryRecord,
          }
        : {}),
      readRawEmailMessage: platform.effectsPort.readRawEmailMessage,
      sendEmail: (request) => guard(() => platform.effectsPort.sendEmail(request)),
      ...(platform.effectsPort.writeAssistantDeliveryRecord
        ? {
            writeAssistantDeliveryRecord: (record) =>
              guard(() => platform.effectsPort.writeAssistantDeliveryRecord!(record)),
          }
        : {}),
    },
    ...(platform.issueExportPort
      ? {
          issueExportPort: {
            recordIssues: (issues) => guard(() => platform.issueExportPort!.recordIssues(issues)),
          },
        }
      : {}),
    ...(platform.logPort
      ? {
          logPort: {
            write: (request) => guard(() => platform.logPort!.write(request)),
          },
        }
      : {}),
    ...(platform.mailboxPort
      ? {
          mailboxPort: {
            fetch: platform.mailboxPort.fetch,
            fetchPayload: platform.mailboxPort.fetchPayload,
          },
        }
      : {}),
    ...(platform.refreshMailboxForActiveTurnInput
      ? {
          refreshMailboxForActiveTurnInput: (refreshInput) =>
            guard(() => platform.refreshMailboxForActiveTurnInput!(refreshInput)),
        }
      : {}),
    ...(platform.usageExportPort
      ? {
          usageExportPort: {
            recordUsage: (usage) => guard(() => platform.usageExportPort!.recordUsage(usage)),
          },
        }
      : {}),
    ...(platform.workspacePort
      ? {
          workspacePort: {
            ...(platform.workspacePort.read
              ? {
                  read: platform.workspacePort.read,
                }
              : {}),
            checkpoint: (request) => guard(() => platform.workspacePort!.checkpoint(request)),
          },
        }
      : {}),
  };
}

function createHostedWorkspaceMailboxImportBudget(maxMailboxItems: number | null | undefined): {
  readonly exhausted: boolean;
  readonly fetchLimitPerLane: number;
  importItem(
    item: HostedMailboxResolvedImportItem,
    importItem: HostedWorkspaceRuntimeJobOptions["importItem"],
    context: HostedWorkspaceRuntimeJobImportContext,
  ): Promise<HostedMailboxItemImportOutcome>;
} {
  const importLimit = resolveHostedWorkspaceRunMailboxLimit(maxMailboxItems);
  let importAttempts = 0;
  let exhausted = false;

  return {
    get exhausted() {
      return exhausted;
    },
    fetchLimitPerLane: resolveHostedWorkspaceRunMailboxFetchLimit(importLimit),
    async importItem(item, importItem, context) {
      if (importAttempts >= importLimit) {
        exhausted = true;
        return {
          reasonCode: "budget.mailbox_items",
          status: "deferred",
        };
      }

      importAttempts += 1;
      return importItem(item, context);
    },
  };
}

function assertWorkspaceRunVersionMatchesRequest(input: {
  expectedWorkspaceVersion: string;
  workspace: HostedWorkspaceState | null;
}): void {
  const actualWorkspaceVersion = input.workspace?.version ?? null;

  if (actualWorkspaceVersion === input.expectedWorkspaceVersion) {
    return;
  }

  if (actualWorkspaceVersion === null && input.expectedWorkspaceVersion === "0") {
    return;
  }

  throw new HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError({
    actualWorkspaceVersion,
    expectedWorkspaceVersion: input.expectedWorkspaceVersion,
  });
}

function assertWorkspaceRunUserMatchesRequest(input: {
  expectedUserId: string;
  workspace: HostedWorkspaceState | null;
}): void {
  if (input.workspace === null || input.workspace.userId === input.expectedUserId) {
    return;
  }

  throw new HostedWorkspaceRunnerUserMismatchError({
    actualUserId: input.workspace.userId,
    expectedUserId: input.expectedUserId,
  });
}

function resolveHostedWorkspaceRunMailboxLimit(value: number | null | undefined): number {
  return value ?? 50;
}

function resolveHostedWorkspaceRunMailboxFetchLimit(importLimit: number): number {
  return importLimit >= Number.MAX_SAFE_INTEGER ? importLimit : importLimit + 1;
}

function resolveHostedWorkspaceInvocationStatus(input: {
  mailboxBudgetExhausted: boolean;
  nextWakeAt: string | null;
}): HostedWorkspaceInvocationResult["status"] {
  if (input.mailboxBudgetExhausted) {
    return "budget_exhausted";
  }

  if (input.nextWakeAt !== null) {
    return "scheduled";
  }

  return "idle";
}

function resolveHostedWorkspaceRunNextWakeAt(input: {
  assistantPhaseResult: Awaited<ReturnType<typeof runHostedWorkspaceUntilIdleOrBudget>>[
    "assistantPhaseResult"
  ];
  committedWorkspace: HostedWorkspaceState | null;
  mailboxImportRetryAt?: string | null;
}): string | null {
  const mailboxImportRetryAt = input.mailboxImportRetryAt ?? null;
  if (
    input.assistantPhaseResult
    && Object.hasOwn(input.assistantPhaseResult, "nextWakeAt")
  ) {
    return earliestHostedRuntimeWakeAt(input.assistantPhaseResult.nextWakeAt ?? null, mailboxImportRetryAt);
  }

  return earliestHostedRuntimeWakeAt(input.committedWorkspace?.nextWakeAt ?? null, mailboxImportRetryAt);
}

function earliestHostedRuntimeWakeAt(
  left: string | null,
  right: string | null,
): string | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs)) {
    return right;
  }
  if (!Number.isFinite(rightMs)) {
    return left;
  }
  return rightMs < leftMs ? right : left;
}
