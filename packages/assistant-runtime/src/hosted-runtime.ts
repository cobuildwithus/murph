import { access } from "node:fs/promises";
import path from "node:path";

import type {
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceCheckpointResponse,
  HostedWorkspaceInvocationResult,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
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
  readHostedMailboxImportState,
  resolveHostedMailboxImportStatePath,
  type HostedMailboxImportState,
} from "./hosted-runtime/mailbox-state.ts";
import type {
  HostedRuntimeDeviceSyncMessagingReturnTarget,
  HostedRuntimePlatform,
} from "./hosted-runtime/platform.ts";
import {
  startRuntimeLivenessHeartbeat,
  type RuntimeLivenessPort,
  type RuntimeLivenessRejectionReason,
  type RuntimeLivenessTouchResult,
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
  type HostedWorkspaceCheckpointRequestBuilder,
  type HostedWorkspaceRunnerInput,
} from "./hosted-runtime/workspace-runner.ts";
import {
  restoreHostedWorkspaceRuntimeJobWorkspace,
  tryOpenExistingWarmWorkspaceForIdleCheckpoint,
  writeHostedWorkspaceHotRestoreCacheForSnapshotRefBestEffort,
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
  invalidateHostedInboxSidecarReady,
  isHostedInboxSidecarReady,
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
  createHostedBrowserVaultReplicaRefreshFromWorkspace,
  createHostedBrowserVaultReplicaForSourceState,
  clearHostedBrowserVaultWarmSourceStateHash,
  readHostedBrowserVaultWarmSourceStateHash,
  summarizeHostedBrowserVaultReplicaContent,
  writeHostedBrowserVaultWarmSourceStateHashBestEffort,
} from "./hosted-runtime/browser-vault-replica.ts";
export type {
  HostedBrowserVaultReplicaContentSummary,
  HostedBrowserVaultReplicaRefreshPreparation,
  HostedBrowserVaultReplicaRestoreSummary,
  HostedBrowserVaultReplicaSourceSummary,
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
  HostedRuntimeUsageRecordPort,
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
  restoreHostedWorkspaceRuntimeJobWorkspace,
} from "./hosted-runtime/workspace-restore.ts";
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
  readHostedMaterializedArtifactPaths,
  recordHostedMaterializedArtifactPaths,
  resolveHostedMaterializedArtifactStateRelativePath,
} from "./hosted-runtime/materialized-artifact-state.ts";
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

class HostedIdleShutdownCheckpointInputAvailableError extends Error {
  constructor() {
    super("Hosted idle-shutdown checkpoint stopped because input became available.");
    this.name = "HostedIdleShutdownCheckpointInputAvailableError";
  }
}

class HostedForegroundInputAvailableError extends Error {
  readonly nextWakeAt: string | null | undefined;

  constructor(nextWakeAt: string | null | undefined) {
    super("Hosted foreground run stopped because fresher input became available.");
    this.name = "HostedForegroundInputAvailableError";
    this.nextWakeAt = nextWakeAt;
  }
}

export async function runHostedWorkspaceRuntimeJobInProcess(
  input: HostedAssistantWorkspaceRuntimeJobInput,
  options: HostedWorkspaceRuntimeJobOptions,
): Promise<HostedWorkspaceInvocationResult> {
  const runtime = normalizeHostedAssistantRuntimeConfig(input.runtime, options.platform);
  const mailboxPort = runtime.platform.mailboxPort ?? null;
  const workspacePort = runtime.platform.workspacePort ?? null;
  if (!workspacePort) {
    throw new TypeError("Hosted workspace runtime job workspace port must be injected.");
  }

  if (typeof workspacePort.read !== "function") {
    throw new TypeError("Hosted workspace runtime job workspace port must support read.");
  }

  if (input.request.reason !== "idle_shutdown_checkpoint" && !mailboxPort) {
    throw new TypeError("Hosted workspace runtime job mailbox port must be injected.");
  }

  assertHostedWorkspaceRuntimeBudgetSupported(input.request.budget?.maxRuntimeMs);

  const livenessAbortController = new AbortController();
  const isIdleShutdownCheckpoint = input.request.reason === "idle_shutdown_checkpoint";
  let idleShutdownInputAvailable = false;
  let idleShutdownInputNextWakeAt: string | null | undefined;
  let livenessRejectedReason: RuntimeLivenessRejectionReason | null = null;
  const requestId = `hosted-workspace-invocation:${input.request.attemptId}`;
  const assertRuntimeLiveness = () => {
    if (livenessRejectedReason) {
      throw new HostedWorkspaceRuntimeLivenessRejectedError(livenessRejectedReason);
    }
    if (livenessAbortController.signal.reason instanceof HostedForegroundInputAvailableError) {
      throw livenessAbortController.signal.reason;
    }
    if (isIdleShutdownCheckpoint && idleShutdownInputAvailable) {
      throw new HostedIdleShutdownCheckpointInputAvailableError();
    }
  };
  const heartbeat = startRuntimeLivenessHeartbeat({
    intervalMs: runtime.platform.runtimeLivenessIntervalMs ?? undefined,
    onRejected: (reason) => {
      livenessRejectedReason = reason;
      livenessAbortController.abort(new HostedWorkspaceRuntimeLivenessRejectedError(reason));
    },
    onInputAvailable: (result) => {
      if (isIdleShutdownCheckpoint) {
        idleShutdownInputAvailable = true;
        idleShutdownInputNextWakeAt = result.nextAlarmAt ?? null;
        livenessAbortController.abort(new HostedIdleShutdownCheckpointInputAvailableError());
        return undefined;
      }

      livenessAbortController.abort(
        new HostedForegroundInputAvailableError(result.nextAlarmAt ?? null),
      );
      return undefined;
    },
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
  let hotRestoreCacheVaultRoot: string | null = null;
  const recordHotRestoreCache = async (
    response: Awaited<ReturnType<NonNullable<typeof workspacePort>["checkpoint"]>>,
  ) => {
    if (response.checkpointed && hotRestoreCacheVaultRoot) {
      await recordHotRestoreCacheForSnapshotRef(response.workspace.snapshotRef);
    }
  };
  const recordHotRestoreCacheForSnapshotRef = async (
    snapshotRef: HostedWorkspaceState["snapshotRef"],
  ) => {
    if (!hotRestoreCacheVaultRoot) {
      return;
    }

    await writeHostedWorkspaceHotRestoreCacheForSnapshotRefBestEffort({
      snapshotRef,
      vaultRoot: hotRestoreCacheVaultRoot,
    });
  };
  const createLivenessGuardedCheckpointSnapshot: HostedWorkspaceSnapshotCheckpointBuilder =
    async (snapshotInput) => {
      assertRuntimeLiveness();
      const snapshot = await options.createCheckpointSnapshot(snapshotInput);
      assertRuntimeLiveness();
      return snapshot;
    };
  const runWarmOnlyIdleShutdownCheckpoint =
    async (): Promise<HostedWorkspaceInvocationResult> => {
      const workspaceRead = await raceHostedRuntimeLiveness(
        workspacePort.read!(),
        livenessAbortController.signal,
      );
      assertRuntimeLiveness();
      if (!workspaceRunVersionMatchesRequest({
        expectedWorkspaceVersion: input.request.workspaceVersion,
        workspace: workspaceRead.workspace,
      })) {
        return {
          idleShutdownCheckpointSkipped: "warm_workspace_unavailable",
          status: "idle",
        };
      }
      assertWorkspaceRunUserMatchesRequest({
        expectedUserId: input.request.userId,
        workspace: workspaceRead.workspace,
      });

      const warmWorkspace = await tryOpenExistingWarmWorkspaceForIdleCheckpoint({
        vaultRoot: options.vaultRoot,
        workspace: workspaceRead.workspace,
      });
      if (!warmWorkspace.ok) {
        return {
          idleShutdownCheckpointSkipped: "warm_workspace_unavailable",
          status: "idle",
        };
      }

      hotRestoreCacheVaultRoot = warmWorkspace.restored.vaultRoot;
      const checkpointNextWakeAt = Object.hasOwn(input.request, "checkpointNextWakeAt")
        ? input.request.checkpointNextWakeAt ?? null
        : workspaceRead.workspace?.nextWakeAt ?? null;
      const checkpointRequestBuilder = createHostedWorkspaceSnapshotCheckpointRequestBuilder({
        createSnapshot: createLivenessGuardedCheckpointSnapshot,
        metadata: {
          attemptId: input.request.attemptId,
          expectedWorkspaceVersion: workspaceRead.workspace?.version ?? input.request.workspaceVersion,
          leaseGeneration: input.request.leaseGeneration,
          nextWakeAt: checkpointNextWakeAt,
          nextWakeReason: workspaceRead.workspace?.nextWakeAt === checkpointNextWakeAt
            ? workspaceRead.workspace?.nextWakeReason ?? null
            : null,
        },
      });
      const idleShutdownCheckpointWorkspacePort: typeof workspacePort = {
        read: () => workspacePort.read!(),
        checkpoint: (request) => workspacePort.checkpoint(request),
      };
      const latestLiveness = await touchRuntimeLivenessOnce({
        port: runtime.platform.runtimeLivenessPort,
        requestId,
        signal: livenessAbortController.signal,
      });
      if (!latestLiveness.ok) {
        throw new HostedWorkspaceRuntimeLivenessRejectedError(latestLiveness.reason);
      }
      if (hasRuntimeInputAvailable(latestLiveness)) {
        return {
          nextWakeAt: latestLiveness.nextAlarmAt ?? null,
          status: "scheduled",
        };
      }

      return await runHostedWorkspaceIdleShutdownCheckpoint({
        assertRuntimeLiveness,
        checkpointRequestBuilder,
        expectedUserId: input.request.userId,
        livenessAbortSignal: livenessAbortController.signal,
        onCheckpointValidated: recordHotRestoreCache,
        readLivenessScheduledResult: () => idleShutdownInputAvailable
          ? {
              ...(idleShutdownInputNextWakeAt === undefined
                ? {}
                : { nextWakeAt: idleShutdownInputNextWakeAt }),
              status: "scheduled",
            }
          : null,
        redactedStatus: await buildHostedIdleShutdownCheckpointRedactedStatus({
          baseStatus: workspaceRead.workspace?.redactedStatus ?? null,
          vaultRoot: warmWorkspace.restored.vaultRoot,
        }),
        workspacePort: idleShutdownCheckpointWorkspacePort,
      });
    };

  try {
    const initialLiveness = await heartbeat.initialTouch;
    if (!initialLiveness.ok) {
      throw new HostedWorkspaceRuntimeLivenessRejectedError(initialLiveness.reason);
    }
    if (
      isIdleShutdownCheckpoint
      && hasRuntimeInputAvailable(initialLiveness)
    ) {
      return {
        nextWakeAt: initialLiveness.nextAlarmAt ?? null,
        status: "scheduled",
      };
    }
    if (
      !isIdleShutdownCheckpoint
      && hasRuntimeInputAvailable(initialLiveness)
    ) {
      return {
        nextWakeAt: initialLiveness.nextAlarmAt ?? null,
        status: "scheduled",
      };
    }
    if (isIdleShutdownCheckpoint) {
      return await runWarmOnlyIdleShutdownCheckpoint();
    }

    let workspaceRead = await raceHostedRuntimeLiveness(
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
    const runtimeLogContext = {
      attemptId: input.request.attemptId,
      leaseGeneration: input.request.leaseGeneration,
      workspaceVersion: input.request.workspaceVersion,
    };
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
        logContext: runtimeLogContext,
        platform: guardedRuntime.platform,
        vaultRoot: options.vaultRoot,
        workspace: workspaceRead.workspace,
      }),
      livenessAbortController.signal,
    );
    hotRestoreCacheVaultRoot = restored.vaultRoot;
    assertRuntimeLiveness();

    const runnerMailboxPort = guardedMailboxPort ?? mailboxPort;
    if (!runnerMailboxPort) {
      throw new TypeError("Hosted workspace runtime job mailbox port must be injected.");
    }
    const foregroundWorkspacePort: HostedRuntimePlatform["workspacePort"] = {
      read: () => guardedWorkspacePort.read!(),
      async checkpoint(request) {
        void request;
        throw new Error("Foreground hosted runner must not checkpoint workspace.");
      },
    };
    const foregroundCheckpointRequestBuilder: HostedWorkspaceCheckpointRequestBuilder = {
      async createRequest(requestInput) {
        void requestInput;
        throw new Error(
          "Foreground hosted runner must not build workspace checkpoint snapshots.",
        );
      },
    };
    const runnerPlatform = {
      ...guardedRuntime.platform,
      mailboxPort: runnerMailboxPort,
      workspacePort: foregroundWorkspacePort,
    };
    const foregroundRuntime = {
      ...guardedRuntime,
      platform: runnerPlatform,
    };
    const baseRunnerInput: HostedWorkspaceRunnerInput = {
      checkpointRequestBuilder: foregroundCheckpointRequestBuilder,
      expectedUserId: input.request.userId,
      importItem: importMailboxItem,
      limitPerLane: mailboxBudget.fetchLimitPerLane,
      materializeWorkspaceArtifacts: restored.materializeWorkspaceArtifacts,
      platform: runnerPlatform,
      requestId,
      runtimeLogContext,
      vaultRoot: restored.vaultRoot,
      workspace: workspaceRead.workspace,
    };
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
    const initialMailboxImport = await raceHostedRuntimeLiveness(
      withHostedProcessEnvironment(
        {
          envOverrides: hostedCodexRuntime.runtimeEnv,
          operatorHomeRoot: restored.operatorHomeRoot,
          vaultRoot: restored.vaultRoot,
        },
        async () =>
          importHostedMailboxForWorkspaceRunner({
            checkpointRequestBuilder: foregroundCheckpointRequestBuilder,
            checkpointReason: "import",
            deferCheckpoint: true,
            input: baseRunnerInput,
            requestId,
          }),
      ),
      livenessAbortController.signal,
    );
    assertRuntimeLiveness();
    if (restored.restoreWasCold) {
      invalidateHostedInboxSidecarReady(restored.vaultRoot);
    }
    const inboxReady = isHostedInboxSidecarReady(restored.vaultRoot);
    await raceHostedRuntimeLiveness(
      ensureHostedInboxSidecarReady({
        bestEffort: true,
        rebuild: !inboxReady && restored.restoreWasCold,
        requestId,
        vaultRoot: restored.vaultRoot,
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
                  runtime: foregroundRuntime,
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
    const effectiveMailboxImport = result.latestMailboxImport;
    if (shouldRefreshHotRestoreCacheAfterNoProgressRun(result)) {
      await recordHotRestoreCacheForSnapshotRef(committedWorkspace?.snapshotRef ?? null);
    }
    const mailboxImportRetryAt = result.initialMailboxImport.importResult.nextRetryAt ?? null;
    const nextWakeAt = resolveHostedWorkspaceRunNextWakeAt({
      assistantPhaseResult: result.assistantPhaseResult,
      committedWorkspace,
      mailboxImportRetryAt,
    });
    const mailboxRedactedStatus = buildHostedMailboxImportRedactedStatus(
      effectiveMailboxImport.importResult,
    );
    const redactedStatus = {
      ...mailboxRedactedStatus,
      ...(result.assistantPhaseResult?.progressed === true
        ? result.assistantPhaseResult.redactedStatus ?? {}
        : {}),
      hostedMailboxConversationImportedSeq:
        mailboxRedactedStatus["hostedMailboxConversationImportedSeq"],
      hostedMailboxSystemImportedSeq:
        mailboxRedactedStatus["hostedMailboxSystemImportedSeq"],
    };
    const deferredCheckpointRequired = foregroundRunRequiresDeferredCheckpoint(result);

    return {
      ...(deferredCheckpointRequired ? { deferredCheckpointRequired: true } : {}),
      ...(nextWakeAt === undefined ? {} : { nextWakeAt }),
      redactedStatus,
      status: resolveHostedWorkspaceInvocationStatus({
        mailboxBudgetExhausted: mailboxBudget.exhausted,
        nextWakeAt,
      }),
    };
  } catch (error) {
    if (error instanceof HostedIdleShutdownCheckpointInputAvailableError) {
      return {
        ...(idleShutdownInputNextWakeAt === undefined
          ? {}
          : { nextWakeAt: idleShutdownInputNextWakeAt }),
        status: "scheduled",
      };
    }
    if (error instanceof HostedForegroundInputAvailableError) {
      return {
        ...(error.nextWakeAt === undefined ? {} : { nextWakeAt: error.nextWakeAt }),
        status: "scheduled",
      };
    }

    throw error;
  } finally {
    await heartbeat.stop();
  }
}

async function runHostedWorkspaceIdleShutdownCheckpoint(input: {
  assertRuntimeLiveness: () => void;
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestBuilder;
  expectedUserId: string;
  livenessAbortSignal: AbortSignal;
  onCheckpointValidated?: (checkpoint: HostedWorkspaceCheckpointResponse) => Promise<void> | void;
  readLivenessScheduledResult: () => HostedWorkspaceInvocationResult | null;
  redactedStatus: HostedWorkspaceCheckpointRequest["redactedStatus"] | null;
  workspacePort: HostedRuntimePlatform["workspacePort"];
}): Promise<HostedWorkspaceInvocationResult> {
  if (!input.workspacePort) {
    throw new TypeError("Hosted idle-shutdown checkpoint requires workspace port support.");
  }

  input.assertRuntimeLiveness();
  const checkpointRequest = await raceHostedRuntimeLiveness(
    Promise.resolve(input.checkpointRequestBuilder.createRequest({
      reason: "idle_shutdown",
      redactedStatus: input.redactedStatus ?? null,
    })),
    input.livenessAbortSignal,
  );
  input.assertRuntimeLiveness();
  const checkpointPromise = input.workspacePort.checkpoint(checkpointRequest);
  let checkpoint: Awaited<typeof checkpointPromise>;
  try {
    checkpoint = await raceHostedRuntimeLiveness(
      checkpointPromise,
      input.livenessAbortSignal,
    );
  } catch (error) {
    const scheduled = input.readLivenessScheduledResult();
    if (!scheduled) {
      throw error;
    }
    observeIdleShutdownCheckpointAfterPreemption({
      checkpointPromise,
      expectedUserId: input.expectedUserId,
      onCheckpointValidated: input.onCheckpointValidated,
    });
    return scheduled;
  }
  input.assertRuntimeLiveness();
  assertIdleShutdownCheckpointAccepted(checkpoint, input.expectedUserId);
  await input.onCheckpointValidated?.(checkpoint);

  return {
    idleShutdownCheckpointed: true,
    ...(checkpoint.workspace.nextWakeAt
      ? { nextWakeAt: checkpoint.workspace.nextWakeAt }
      : {}),
    ...(checkpoint.workspace.redactedStatus
      ? { redactedStatus: checkpoint.workspace.redactedStatus }
      : {}),
    status: "idle",
  };
}

async function buildHostedIdleShutdownCheckpointRedactedStatus(input: {
  baseStatus: HostedWorkspaceCheckpointRequest["redactedStatus"] | null;
  vaultRoot: string;
}): Promise<HostedWorkspaceCheckpointRequest["redactedStatus"] | null> {
  if (!await hostedMailboxImportStateFileExists(input.vaultRoot)) {
    return cloneHostedRuntimeRedactedStatus(input.baseStatus);
  }

  const state = await readHostedMailboxImportState({
    vaultRoot: input.vaultRoot,
  });
  return mergeHostedMailboxImportStateRedactedStatus({
    baseStatus: input.baseStatus,
    state,
  });
}

async function hostedMailboxImportStateFileExists(vaultRoot: string): Promise<boolean> {
  try {
    await access(resolveHostedMailboxImportStatePath(vaultRoot));
    return true;
  } catch (error) {
    if (isNodeFileNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

function mergeHostedMailboxImportStateRedactedStatus(input: {
  baseStatus: HostedWorkspaceCheckpointRequest["redactedStatus"] | null;
  state: HostedMailboxImportState;
}): HostedWorkspaceCheckpointRequest["redactedStatus"] {
  return {
    ...(input.baseStatus ?? {}),
    hostedMailboxConversationImportedSeq: input.state.watermarks.conversation,
    hostedMailboxSystemImportedSeq: input.state.watermarks.system,
  };
}

function cloneHostedRuntimeRedactedStatus(
  value: HostedWorkspaceCheckpointRequest["redactedStatus"] | null,
): HostedWorkspaceCheckpointRequest["redactedStatus"] | null {
  return value ? { ...value } : null;
}

function isNodeFileNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error
    && "code" in error
    && error.code === "ENOENT"
  );
}

function observeIdleShutdownCheckpointAfterPreemption(input: {
  checkpointPromise: Promise<HostedWorkspaceCheckpointResponse>;
  expectedUserId: string;
  onCheckpointValidated?: (checkpoint: HostedWorkspaceCheckpointResponse) => Promise<void> | void;
}): void {
  void input.checkpointPromise
    .then(async (checkpoint) => {
      assertIdleShutdownCheckpointAccepted(checkpoint, input.expectedUserId);
      await input.onCheckpointValidated?.(checkpoint);
    })
    .catch(() => undefined);
}

function assertIdleShutdownCheckpointAccepted(
  checkpoint: HostedWorkspaceCheckpointResponse,
  expectedUserId: string,
): void {
  if (checkpoint.workspace.userId !== expectedUserId) {
    throw new HostedMailboxImportCheckpointUserMismatchError({
      actualUserId: checkpoint.workspace.userId,
      expectedUserId,
    });
  }
  if (!checkpoint.checkpointed) {
    throw new HostedMailboxImportCheckpointConflictError(checkpoint);
  }
}

function shouldRefreshHotRestoreCacheAfterNoProgressRun(
  result: Awaited<ReturnType<typeof runHostedWorkspaceUntilIdleOrBudget>>,
): boolean {
  const initialImport = result.initialMailboxImport;
  return (
    initialImport.checkpoint === null
    && !initialImport.checkpointDeferred
    && !initialImport.stateChanged
    && initialImport.importResult.importedCount === 0
    && initialImport.importResult.blocked.length === 0
    && !initialImport.importResult.nextRetryAt
    && result.assistantPhaseResult?.progressed !== true
  );
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

async function touchRuntimeLivenessOnce(input: {
  port?: RuntimeLivenessPort | null;
  requestId: string;
  signal: AbortSignal;
}): Promise<RuntimeLivenessTouchResult> {
  const port = input.port ?? null;
  if (!port) {
    return { ok: true };
  }

  return await raceHostedRuntimeLiveness(
    port.touch({
      requestId: input.requestId,
      signal: input.signal,
    }),
    input.signal,
  );
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
            ...(platform.browserVaultReplicaPort.publishRef
              ? {
                  publishRef: (publishInput) =>
                    guard(() => platform.browserVaultReplicaPort!.publishRef!(publishInput)),
                }
              : {}),
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
    ...(platform.usageRecordPort
      ? {
          usageRecordPort: {
            recordUsage: (usage) => guard(() => platform.usageRecordPort!.recordUsage(usage)),
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
  if (workspaceRunVersionMatchesRequest(input)) {
    return;
  }

  throw new HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError({
    actualWorkspaceVersion: input.workspace?.version ?? null,
    expectedWorkspaceVersion: input.expectedWorkspaceVersion,
  });
}

function workspaceRunVersionMatchesRequest(input: {
  expectedWorkspaceVersion: string;
  workspace: HostedWorkspaceState | null;
}): boolean {
  const actualWorkspaceVersion = input.workspace?.version ?? null;

  if (actualWorkspaceVersion === input.expectedWorkspaceVersion) {
    return true;
  }

  if (actualWorkspaceVersion === null && input.expectedWorkspaceVersion === "0") {
    return true;
  }

  return false;
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

function hasRuntimeInputAvailable(result: RuntimeLivenessTouchResult): boolean {
  return result.ok && result.inputAvailable === true;
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

function foregroundRunRequiresDeferredCheckpoint(
  result: Awaited<ReturnType<typeof runHostedWorkspaceUntilIdleOrBudget>>,
): boolean {
  return result.deferredCheckpointRequired;
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
