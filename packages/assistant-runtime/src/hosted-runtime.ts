import type {
  HostedWorkspaceCheckpointResponse,
  HostedWorkspaceInvocationResult,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
  type HostedExecutionLogPhase,
  type HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";
import {
  normalizeHostedAssistantRuntimeConfig,
  withHostedProcessEnvironment,
} from "./hosted-runtime/environment.ts";
import {
  HOSTED_CODEX_RUNTIME_AUTHORITY_ENV,
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
import type {
  HostedRuntimeDeviceSyncMessagingReturnTarget,
  HostedRuntimePlatform,
} from "./hosted-runtime/platform.ts";
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
  type HostedWorkspaceRunnerResult,
} from "./hosted-runtime/workspace-runner.ts";
import {
  restoreHostedWorkspaceRuntimeJobWorkspace,
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
import {
  readHostedRunnerCommitTimeoutMs,
} from "./hosted-runtime/timeouts.ts";
import {
  normalizeHostedFutureWakeAt,
} from "./hosted-runtime/wake-time.ts";
export {
  createCoalescingRuntimeWakeSignal,
} from "./hosted-runtime/runtime-wake.ts";
export type {
  RuntimeWakeSignal,
} from "./hosted-runtime/runtime-wake.ts";
import type {
  RuntimeWakeSignal,
} from "./hosted-runtime/runtime-wake.ts";
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
  runtimeWakeSignal?: RuntimeWakeSignal | null;
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

  if (!mailboxPort) {
    throw new TypeError("Hosted workspace runtime job mailbox port must be injected.");
  }

  assertHostedWorkspaceRuntimeBudgetSupported(input.request.budget?.maxRuntimeMs);

  const runtimeAbortController = new AbortController();
  const requestId = `hosted-workspace-invocation:${input.request.attemptId}`;
  const runtimeLogContext = {
    attemptId: input.request.attemptId,
    leaseGeneration: input.request.leaseGeneration,
    workspaceVersion: input.request.workspaceVersion,
  };
  const assertRuntimeNotAborted = () => {
    if (runtimeAbortController.signal.aborted) {
      throw readHostedRuntimeAbortReason(runtimeAbortController.signal);
    }
  };
  const guardedPlatform = createAbortGuardedHostedRuntimePlatform(
    runtime.platform,
    assertRuntimeNotAborted,
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
  const createAbortGuardedCheckpointSnapshot: HostedWorkspaceSnapshotCheckpointBuilder =
    async (snapshotInput) => {
      assertRuntimeNotAborted();
      const snapshot = await options.createCheckpointSnapshot(snapshotInput);
      assertRuntimeNotAborted();
      return snapshot;
    };
  const phaseLogger = createHostedRuntimePhaseLogger();
  const emitPhaseLog = phaseLogger.emit;

  try {
    emitPhaseLog({
      input,
      requestId,
      stage: "workspace.read",
      status: "start",
    });
    const workspaceRead = await raceHostedRuntimeCancellation(
      workspacePort.read(),
      runtimeAbortController.signal,
    );
    emitPhaseLog({
      details: {
        actualWorkspaceVersion: workspaceRead.workspace?.version ?? null,
        workspacePresent: workspaceRead.workspace !== null,
      },
      input,
      requestId,
      stage: "workspace.read",
      status: "done",
    });
    assertRuntimeNotAborted();
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
    const foregroundMailboxBudget = createHostedWorkspaceMailboxImportBudget(
      resolveHostedWorkspaceForegroundMailboxLimit(input.request.budget?.maxMailboxItems),
    );
    const mailboxBudgetExhausted = () =>
      mailboxBudget.exhausted || foregroundMailboxBudget.exhausted;
    let hostedCliBridgeMessagingReturnTarget: HostedRuntimeDeviceSyncMessagingReturnTarget | null =
      null;
    const importMailboxItem: HostedWorkspaceRunnerInput["importItem"] = (item) =>
      mailboxBudget.importItem(
        item,
        async (importItem, context) => {
          assertRuntimeNotAborted();
          const outcome = await options.importItem(importItem, context);
          assertRuntimeNotAborted();
          return outcome;
        },
        {
          recordMessagingReturnTarget: (target) => {
            hostedCliBridgeMessagingReturnTarget = target;
          },
          signal: runtimeAbortController.signal,
        },
      );
    const importForegroundMailboxItem: HostedWorkspaceRunnerInput["importItem"] = (item) =>
      foregroundMailboxBudget.importItem(
        item,
        async (importItem, context) => {
          assertRuntimeNotAborted();
          const outcome = await options.importItem(importItem, context);
          assertRuntimeNotAborted();
          return outcome;
        },
        {
          recordMessagingReturnTarget: (target) => {
            hostedCliBridgeMessagingReturnTarget = target;
          },
          signal: runtimeAbortController.signal,
        },
      );
    emitPhaseLog({
      input,
      requestId,
      stage: "workspace.restore",
      status: "start",
    });
    const restored = await raceHostedRuntimeCancellation(
      restoreHostedWorkspaceRuntimeJobWorkspace({
        logContext: runtimeLogContext,
        platform: guardedRuntime.platform,
        vaultRoot: options.vaultRoot,
        workspace: workspaceRead.workspace,
      }),
      runtimeAbortController.signal,
    );
    emitPhaseLog({
      details: {
        materializedArtifactPathCount: restored.materializedArtifactPaths.size,
        restoreMode: restored.mode,
        restoreWasCold: restored.restoreWasCold,
      },
      input,
      requestId,
      stage: "workspace.restore",
      status: "done",
    });
    hotRestoreCacheVaultRoot = restored.vaultRoot;
    assertRuntimeNotAborted();

    const runnerMailboxPort = guardedMailboxPort ?? mailboxPort;
    if (!runnerMailboxPort) {
      throw new TypeError("Hosted workspace runtime job mailbox port must be injected.");
    }
    const checkpointMetadata = {
      attemptId: input.request.attemptId,
      expectedWorkspaceVersion: workspaceRead.workspace?.version ?? input.request.workspaceVersion,
      leaseGeneration: input.request.leaseGeneration,
      nextWakeAt: workspaceRead.workspace?.nextWakeAt ?? null,
      nextWakeReason: workspaceRead.workspace?.nextWakeReason ?? null,
    };
    const checkpointRequestBuilder = createHostedWorkspaceSnapshotCheckpointRequestBuilder({
      createSnapshot: createAbortGuardedCheckpointSnapshot,
      metadata: checkpointMetadata,
    });
    const foregroundWorkspacePort = guardedWorkspacePort;
    const foregroundRunnerWorkspacePort: HostedRuntimePlatform["workspacePort"] = {
      read: () => guardedWorkspacePort.read!(),
      async checkpoint() {
        throw new TypeError("Foreground hosted runner must not checkpoint workspace.");
      },
    };
    const runnerPlatform = {
      ...guardedRuntime.platform,
      mailboxPort: runnerMailboxPort,
      workspacePort: foregroundRunnerWorkspacePort,
    };
    const foregroundRuntime = {
      ...guardedRuntime,
      platform: runnerPlatform,
    };
    const baseRunnerInput: HostedWorkspaceRunnerInput = {
      checkpointRequestBuilder,
      expectedUserId: input.request.userId,
      foregroundImportItem: importForegroundMailboxItem,
      foregroundLimitPerLane: foregroundMailboxBudget.fetchLimitPerLane,
      importItem: importMailboxItem,
      limitPerLane: mailboxBudget.fetchLimitPerLane,
      materializeWorkspaceArtifacts: restored.materializeWorkspaceArtifacts,
      platform: runnerPlatform,
      requestId,
      runtimeWakeSignal: options.runtimeWakeSignal ?? null,
      signal: runtimeAbortController.signal,
      runtimeLogContext,
      vaultRoot: restored.vaultRoot,
      workspace: workspaceRead.workspace,
    };
    const baseRuntimeEnv = {
      ...guardedRuntime.forwardedEnv,
      ...guardedRuntime.userEnv,
      [HOSTED_CODEX_RUNTIME_AUTHORITY_ENV.attemptId]: input.request.attemptId,
      [HOSTED_CODEX_RUNTIME_AUTHORITY_ENV.boundUserId]: input.request.userId,
      [HOSTED_CODEX_RUNTIME_AUTHORITY_ENV.leaseGeneration]: input.request.leaseGeneration,
      [HOSTED_CODEX_RUNTIME_AUTHORITY_ENV.workspaceVersion]: input.request.workspaceVersion,
    };
    emitPhaseLog({
      details: {
        runtimeEnvKeyCount: Object.keys(baseRuntimeEnv).length,
      },
      input,
      requestId,
      stage: "codex.prepare",
      status: "start",
    });
    const hostedCodexRuntime = await raceHostedRuntimeCancellation(
      prepareHostedCodexRuntimeEnvironment({
        operatorHomeRoot: restored.operatorHomeRoot,
        runtimeEnv: baseRuntimeEnv,
      }),
      runtimeAbortController.signal,
    );
    emitPhaseLog({
      details: {
        runtimeEnvKeyCount: Object.keys(hostedCodexRuntime.runtimeEnv).length,
      },
      input,
      requestId,
      stage: "codex.prepare",
      status: "done",
    });
    assertRuntimeNotAborted();
    emitPhaseLog({
      details: {
        foregroundMailboxLimitPerLane: foregroundMailboxBudget.fetchLimitPerLane,
        mailboxLimitPerLane: mailboxBudget.fetchLimitPerLane,
      },
      input,
      requestId,
      stage: "mailbox.import.initial",
      status: "start",
    });
    const initialMailboxImport = await raceHostedRuntimeCancellation(
      withHostedProcessEnvironment(
        {
          envOverrides: hostedCodexRuntime.runtimeEnv,
          operatorHomeRoot: restored.operatorHomeRoot,
          vaultRoot: restored.vaultRoot,
        },
        async () =>
          importHostedMailboxForWorkspaceRunner({
            checkpointRequestBuilder,
            checkpointReason: "import",
            deferCheckpoint: true,
            input: baseRunnerInput,
            requestId,
          }),
      ),
      runtimeAbortController.signal,
    );
    emitPhaseLog({
      details: {
        checkpointDeferred: initialMailboxImport.checkpointDeferred,
        checkpointed: initialMailboxImport.checkpoint?.checkpointed ?? false,
        fetchedCount: initialMailboxImport.importResult.fetchedCount,
        importedCount: initialMailboxImport.importResult.importedCount,
        stateChanged: initialMailboxImport.stateChanged,
      },
      input,
      requestId,
      stage: "mailbox.import.initial",
      status: "done",
    });
    assertRuntimeNotAborted();
    if (restored.restoreWasCold) {
      invalidateHostedInboxSidecarReady(restored.vaultRoot);
    }
    const inboxReady = isHostedInboxSidecarReady(restored.vaultRoot);
    emitPhaseLog({
      details: {
        inboxReady,
        rebuild: !inboxReady && restored.restoreWasCold,
        restoreWasCold: restored.restoreWasCold,
      },
      input,
      requestId,
      stage: "inbox.sidecar",
      status: "start",
    });
    await raceHostedRuntimeCancellation(
      ensureHostedInboxSidecarReady({
        bestEffort: true,
        rebuild: !inboxReady && restored.restoreWasCold,
        requestId,
        vaultRoot: restored.vaultRoot,
      }),
      runtimeAbortController.signal,
    );
    emitPhaseLog({
      details: {
        rebuild: !inboxReady && restored.restoreWasCold,
      },
      input,
      requestId,
      stage: "inbox.sidecar",
      status: "done",
    });
    assertRuntimeNotAborted();
    emitPhaseLog({
      input,
      requestId,
      stage: "cli.bridge",
      status: "start",
    });
    const hostedCliBridge = await startHostedCliRuntimeBridge({
      deviceSyncPort: guardedRuntime.platform.deviceSyncPort,
      messagingReturnTarget: () => hostedCliBridgeMessagingReturnTarget,
    });
    emitPhaseLog({
      details: {
        bridgeStarted: hostedCliBridge !== null,
      },
      input,
      requestId,
      stage: "cli.bridge",
      status: "done",
    });
    const runtimeEnv = {
      ...hostedCodexRuntime.runtimeEnv,
      ...(hostedCliBridge?.env ?? {}),
    };
    const runForegroundPass = async (passInput: {
      initialMailboxImport?: HostedWorkspaceRunnerInput["initialMailboxImport"];
      requestId: string;
      workspace: HostedWorkspaceState | null;
    }): Promise<HostedWorkspaceRunnerResult> => {
      emitPhaseLog({
        details: {
          initialMailboxImportProvided: passInput.initialMailboxImport !== undefined,
          passRequestId: passInput.requestId,
          passWorkspaceVersion: passInput.workspace?.version ?? null,
          workspacePresent: passInput.workspace !== null,
        },
        input,
        requestId,
        stage: "foreground.pass",
        status: "start",
      });
      try {
        const passResult = await raceHostedRuntimeCancellation(
          withHostedProcessEnvironment(
            {
              envOverrides: runtimeEnv,
              operatorHomeRoot: restored.operatorHomeRoot,
              vaultRoot: restored.vaultRoot,
            },
            async () =>
              runHostedWorkspaceUntilIdleOrBudget({
                ...baseRunnerInput,
                initialMailboxImport: passInput.initialMailboxImport,
                requestId: passInput.requestId,
                runAssistantPhase: (phaseInput) =>
                  (options.runAssistantPhase ?? runHostedWorkspaceAssistantPhase)({
                    ...phaseInput,
                    request: input.request,
                    restored,
                    runtime: foregroundRuntime,
                    runtimeEnv,
                    signal: runtimeAbortController.signal,
                  }),
                workspace: passInput.workspace,
              }),
          ),
          runtimeAbortController.signal,
        );
        emitPhaseLog({
          details: {
            assistantProgressed: passResult.assistantPhaseResult?.progressed === true,
            latestWorkspacePresent: passResult.latestWorkspace !== null,
            latestWorkspaceVersion: passResult.latestWorkspace?.version ?? null,
            passRequestId: passInput.requestId,
            runtimeStateDirty: passResult.runtimeStateDirty,
          },
          input,
          requestId,
          stage: "foreground.pass",
          status: "done",
        });
        return passResult;
      } catch (error) {
        emitPhaseLog({
          details: {
            passRequestId: passInput.requestId,
          },
          error,
          input,
          requestId,
          stage: "foreground.pass",
          status: "fail",
        });
        throw error;
      }
    };
    const idleCheckpointDelayMs = resolveHostedRuntimeIdleCheckpointDelayMs(
      input.request.idleCheckpointDelayMs,
    );
    const commitTimeoutMs = readHostedRunnerCommitTimeoutMs(runtime.commitTimeoutMs);
    const hostDeadlineCheckpointStartByMs = resolveHostedRuntimeCheckpointStartByMs({
      commitTimeoutMs,
      deadlineAt: input.request.deadlineAt ?? null,
    });
    let result: HostedWorkspaceRunnerResult;
    let runtimeStateDirty = false;
    let idleWakeOrdinal = 0;
    try {
      result = await runForegroundPass({
        initialMailboxImport,
        requestId,
        workspace: workspaceRead.workspace,
      });
      runtimeStateDirty ||= result.runtimeStateDirty;
      let accumulatedProjection = buildHostedWorkspaceInvocationProjection({
        mailboxBudgetExhausted: mailboxBudgetExhausted(),
        result,
        workspace: workspaceRead.workspace,
      });
      const resolveActiveCheckpointStartByMs = () => {
        const projectedWakeCheckpointStartByMs = resolveHostedRuntimeCheckpointStartByMs({
          commitTimeoutMs,
          deadlineAt: accumulatedProjection.nextWakeAt,
        });
        return earliestHostedRuntimeFiniteMs(
          hostDeadlineCheckpointStartByMs,
          projectedWakeCheckpointStartByMs,
        );
      };
      while (runtimeStateDirty) {
        if (accumulatedProjection.status !== "budget_exhausted") {
          const checkpointStartByMs = resolveActiveCheckpointStartByMs();
          const checkpointWaitResult = await waitForHostedRuntimeIdleCheckpointWindow({
            checkpointStartByMs,
            idleCheckpointDelayMs,
            runtimeAbortSignal: runtimeAbortController.signal,
            runtimeWakeSignal: options.runtimeWakeSignal ?? null,
          });
          if (checkpointWaitResult === "wake") {
            idleWakeOrdinal += 1;
            result = await runForegroundPass({
              initialMailboxImport: null,
              requestId: `${requestId}:idle-wake:${idleWakeOrdinal}`,
              workspace: result.latestWorkspace ?? workspaceRead.workspace,
            });
            const nextProjection = buildHostedWorkspaceInvocationProjection({
              mailboxBudgetExhausted: mailboxBudgetExhausted(),
              result,
              workspace: accumulatedProjection.committedWorkspace ?? workspaceRead.workspace,
            });
            accumulatedProjection = mergeHostedWorkspaceInvocationProjection(
              accumulatedProjection,
              nextProjection,
            );
            runtimeStateDirty ||= result.runtimeStateDirty;
            continue;
          }
        }

        const checkpointStartByMs = resolveActiveCheckpointStartByMs();
        emitPhaseLog({
          details: {
            checkpointStartByMs,
            nextWakeAtPresent: accumulatedProjection.nextWakeAt !== null,
            nextWakeReasonPresent: accumulatedProjection.nextWakeReason !== null,
          },
          input,
          phase: "checkpoint",
          requestId,
          stage: "workspace.checkpoint.idle_shutdown",
          status: "start",
        });
        const checkpoint = await checkpointHostedRuntimeDirtyWorkspace({
          assertRuntimeNotAborted,
          checkpointRequestBuilder,
          expectedUserId: input.request.userId,
          nextWakeAt: accumulatedProjection.nextWakeAt,
          nextWakeReason: accumulatedProjection.nextWakeReason,
          onCheckpointValidated: recordHotRestoreCache,
          redactedStatus: accumulatedProjection.redactedStatus,
          runtimeAbortSignal: runtimeAbortController.signal,
          workspacePort: foregroundWorkspacePort,
        });
        emitPhaseLog({
          details: {
            checkpointed: checkpoint.checkpointed,
            checkpointWorkspaceVersion: checkpoint.workspace.version,
          },
          input,
          phase: "checkpoint",
          requestId,
          stage: "workspace.checkpoint.idle_shutdown",
          status: "done",
        });
        checkpointMetadata.expectedWorkspaceVersion = checkpoint.workspace.version;
        checkpointMetadata.nextWakeAt = checkpoint.workspace.nextWakeAt ?? null;
        checkpointMetadata.nextWakeReason = checkpoint.workspace.nextWakeReason ?? null;
        if (consumePendingHostedRuntimeWake(options.runtimeWakeSignal ?? null)) {
          idleWakeOrdinal += 1;
          result = await runForegroundPass({
            initialMailboxImport: null,
            requestId: `${requestId}:checkpoint-wake:${idleWakeOrdinal}`,
            workspace: checkpoint.workspace,
          });
          const nextProjection = buildHostedWorkspaceInvocationProjection({
            mailboxBudgetExhausted: mailboxBudgetExhausted(),
            result,
            workspace: checkpoint.workspace,
          });
          accumulatedProjection = mergeHostedWorkspaceInvocationProjection(
            {
              ...accumulatedProjection,
              committedWorkspace: checkpoint.workspace,
              redactedStatus: checkpoint.workspace.redactedStatus ?? accumulatedProjection.redactedStatus,
            },
            nextProjection,
          );
          runtimeStateDirty = result.runtimeStateDirty;
          continue;
        }
        const invocationResult = {
          ...(checkpoint.workspace.nextWakeAt === undefined
            ? {}
            : { nextWakeAt: checkpoint.workspace.nextWakeAt ?? null }),
          redactedStatus: checkpoint.workspace.redactedStatus ?? accumulatedProjection.redactedStatus,
          status: resolveHostedWorkspaceInvocationStatus({
            mailboxBudgetExhausted: mailboxBudgetExhausted(),
            nextWakeAt: checkpoint.workspace.nextWakeAt ?? null,
          }),
        };
        emitPhaseLog({
          details: {
            invocationStatus: invocationResult.status,
            nextWakeAtPresent: Object.hasOwn(invocationResult, "nextWakeAt")
              && invocationResult.nextWakeAt !== null,
          },
          input,
          requestId,
          stage: "runtime.return",
          status: "done",
        });
        return invocationResult;
      }
    } finally {
      if (hostedCliBridge) {
        emitPhaseLog({
          input,
          requestId,
          stage: "cli.bridge.stop",
          status: "start",
        });
        await hostedCliBridge.stop();
        emitPhaseLog({
          input,
          requestId,
          stage: "cli.bridge.stop",
          status: "done",
        });
      }
    }
    assertRuntimeNotAborted();
    const projection = buildHostedWorkspaceInvocationProjection({
      mailboxBudgetExhausted: mailboxBudgetExhausted(),
      result,
      workspace: workspaceRead.workspace,
    });
    if (shouldRefreshHotRestoreCacheAfterNoProgressRun(result)) {
      await recordHotRestoreCacheForSnapshotRef(
        projection.committedWorkspace?.snapshotRef ?? null,
      );
    }
    const invocationResult = {
      ...(projection.nextWakeAt === undefined ? {} : { nextWakeAt: projection.nextWakeAt }),
      redactedStatus: projection.redactedStatus,
      status: projection.status,
    };
    emitPhaseLog({
      details: {
        invocationStatus: invocationResult.status,
        nextWakeAtPresent: Object.hasOwn(invocationResult, "nextWakeAt")
          && invocationResult.nextWakeAt !== null,
      },
      input,
      requestId,
      stage: "runtime.return",
      status: "done",
    });
    return invocationResult;
  } catch (error) {
    phaseLogger.failOpenPhases({
      error,
      input,
      requestId,
    });
    emitPhaseLog({
      error,
      input,
      requestId,
      stage: "runtime",
      status: "fail",
    });
    throw error;
  }
}

type HostedRuntimePhaseLogStatus = "done" | "fail" | "start";

const HOSTED_RUNTIME_PHASE_NAMES = [
  "cli.bridge",
  "cli.bridge.stop",
  "codex.prepare",
  "foreground.pass",
  "inbox.sidecar",
  "mailbox.import.initial",
  "runtime",
  "runtime.return",
  "workspace.checkpoint.idle_shutdown",
  "workspace.read",
  "workspace.restore",
] as const;

type HostedRuntimePhaseName = typeof HOSTED_RUNTIME_PHASE_NAMES[number];

interface HostedRuntimePhaseLogState {
  ordinal: number;
  runtimeStartedAtMs: number;
  startedAtMsByStage: Map<HostedRuntimePhaseName, number>;
}

interface HostedRuntimePhaseLogger {
  emit(input: HostedRuntimePhaseLogInput): void;
  failOpenPhases(input: Omit<HostedRuntimePhaseLogInput, "stage" | "status">): void;
}

interface HostedRuntimePhaseLogInput {
  details?: HostedExecutionStructuredLogDetails;
  error?: unknown;
  input: HostedAssistantWorkspaceRuntimeJobInput;
  phase?: HostedExecutionLogPhase;
  requestId: string;
  stage: HostedRuntimePhaseName;
  status: HostedRuntimePhaseLogStatus;
}

function createHostedRuntimePhaseLogger(): HostedRuntimePhaseLogger {
  const state: HostedRuntimePhaseLogState = {
    ordinal: 0,
    runtimeStartedAtMs: Date.now(),
    startedAtMsByStage: new Map(),
  };

  return {
    emit(input) {
      emitHostedRuntimePhaseLog(input, state);
    },
    failOpenPhases(input) {
      const openStages = Array.from(state.startedAtMsByStage.keys()).reverse();
      for (const stage of openStages) {
        emitHostedRuntimePhaseLog({
          ...input,
          stage,
          status: "fail",
        }, state);
      }
    },
  };
}

function emitHostedRuntimePhaseLog(
  input: HostedRuntimePhaseLogInput,
  state: HostedRuntimePhaseLogState,
): void {
  const phaseTrace = buildHostedRuntimePhaseTraceMetadata(input, state);
  emitHostedExecutionStructuredLog({
    component: "runtime",
    details: {
      attemptId: input.input.request.attemptId,
      leaseGeneration: input.input.request.leaseGeneration,
      requestId: input.requestId,
      runtimePhase: input.stage,
      ...phaseTrace,
      runtimePhaseStatus: input.status,
      workspaceVersion: input.input.request.workspaceVersion,
      ...buildHostedRuntimePhaseFailureMetadata(input.error),
      ...(input.details ?? {}),
    },
    level: input.status === "fail" ? "error" : "info",
    message: "Hosted workspace runtime phase boundary.",
    phase: input.phase ?? (input.status === "fail" ? "failed" : "wake.running"),
    userId: null,
  });
}

function buildHostedRuntimePhaseFailureMetadata(
  error: unknown,
): HostedExecutionStructuredLogDetails {
  if (error === undefined) {
    return {};
  }

  return {
    failureDetailsPresent: hasHostedRuntimePhaseOwnProperty(error, "details"),
    failureMessagePresent: error instanceof Error && error.message.trim().length > 0,
    failureName: readHostedExecutionSafeErrorName(error) ?? null,
  };
}

function hasHostedRuntimePhaseOwnProperty(error: unknown, key: string): boolean {
  return Boolean(
    error
      && typeof error === "object"
      && Object.prototype.hasOwnProperty.call(error, key),
  );
}

function buildHostedRuntimePhaseTraceMetadata(
  input: Pick<HostedRuntimePhaseLogInput, "stage" | "status">,
  state: HostedRuntimePhaseLogState,
): HostedExecutionStructuredLogDetails {
  const nowMs = Date.now();
  state.ordinal += 1;
  const phaseStartedAtMs = state.startedAtMsByStage.get(input.stage) ?? null;
  const details: HostedExecutionStructuredLogDetails = {
    runtimeElapsedMs: Math.max(0, nowMs - state.runtimeStartedAtMs),
    runtimePhaseOrdinal: state.ordinal,
    ...(phaseStartedAtMs === null || input.status === "start"
      ? {}
      : { runtimePhaseDurationMs: Math.max(0, nowMs - phaseStartedAtMs) }),
  };

  if (input.status === "start") {
    state.startedAtMsByStage.set(input.stage, nowMs);
  } else {
    state.startedAtMsByStage.delete(input.stage);
  }

  return details;
}

const DEFAULT_HOSTED_RUNTIME_IDLE_CHECKPOINT_DELAY_MS = 180_000;
const DEFAULT_HOSTED_FOREGROUND_MAILBOX_IMPORT_LIMIT = 10;
const HOSTED_RUNTIME_DEADLINE_MARGIN_MS = 5_000;
const HOSTED_RUNTIME_MAX_TIMER_DELAY_MS = 2_147_483_647;

type HostedRuntimeIdleCheckpointWaitResult = "deadline" | "idle" | "wake";

function consumePendingHostedRuntimeWake(
  runtimeWakeSignal: RuntimeWakeSignal | null,
): boolean {
  return runtimeWakeSignal?.consumePending() === true;
}

interface HostedWorkspaceInvocationProjection {
  committedWorkspace: HostedWorkspaceState | null;
  nextWakeAt: string | null;
  nextWakeReason: string | null;
  redactedStatus: NonNullable<HostedWorkspaceInvocationResult["redactedStatus"]>;
  status: HostedWorkspaceInvocationResult["status"];
}

function buildHostedWorkspaceInvocationProjection(input: {
  mailboxBudgetExhausted: boolean;
  result: HostedWorkspaceRunnerResult;
  workspace: HostedWorkspaceState | null;
}): HostedWorkspaceInvocationProjection {
  const projectionNowMs = Date.now();
  const committedWorkspace = input.result.latestWorkspace
    ?? input.result.initialMailboxImport.checkpoint?.workspace
    ?? input.workspace;
  const effectiveMailboxImport = input.result.latestMailboxImport;
  const mailboxImportRetryAt = effectiveMailboxImport.importResult.nextRetryAt ?? null;
  const nextWake = resolveHostedWorkspaceRunNextWake({
    assistantPhaseResult: input.result.assistantPhaseResult,
    committedWorkspace,
    mailboxImportRetryAt,
    nowMs: projectionNowMs,
  });
  const mailboxRedactedStatus = buildHostedMailboxImportRedactedStatus(
    effectiveMailboxImport.importResult,
  );
  const redactedStatus = {
    ...mailboxRedactedStatus,
    ...(input.result.assistantPhaseResult?.progressed === true
      ? input.result.assistantPhaseResult.redactedStatus ?? {}
      : {}),
    hostedMailboxConversationImportedSeq:
      mailboxRedactedStatus["hostedMailboxConversationImportedSeq"],
    hostedMailboxSystemImportedSeq:
      mailboxRedactedStatus["hostedMailboxSystemImportedSeq"],
  };

  return {
    committedWorkspace,
    nextWakeAt: nextWake.nextWakeAt,
    nextWakeReason: nextWake.nextWakeReason,
    redactedStatus,
    status: resolveHostedWorkspaceInvocationStatus({
      mailboxBudgetExhausted: input.mailboxBudgetExhausted,
      nextWakeAt: nextWake.nextWakeAt,
    }),
  };
}

function mergeHostedWorkspaceInvocationProjection(
  previous: HostedWorkspaceInvocationProjection,
  next: HostedWorkspaceInvocationProjection,
): HostedWorkspaceInvocationProjection {
  const selectedWake = selectEarliestHostedRuntimeWake([
    {
      at: previous.nextWakeAt,
      reason: previous.nextWakeReason,
    },
    {
      at: next.nextWakeAt,
      reason: next.nextWakeReason,
    },
  ]);

  return {
    committedWorkspace: next.committedWorkspace ?? previous.committedWorkspace,
    nextWakeAt: selectedWake.nextWakeAt,
    nextWakeReason: selectedWake.nextWakeReason,
    redactedStatus: {
      ...previous.redactedStatus,
      ...next.redactedStatus,
    },
    status: mergeHostedWorkspaceInvocationStatus(previous.status, next.status),
  };
}

function mergeHostedWorkspaceInvocationStatus(
  previous: HostedWorkspaceInvocationResult["status"],
  next: HostedWorkspaceInvocationResult["status"],
): HostedWorkspaceInvocationResult["status"] {
  return readHostedWorkspaceInvocationStatusPriority(next)
      > readHostedWorkspaceInvocationStatusPriority(previous)
    ? next
    : previous;
}

function readHostedWorkspaceInvocationStatusPriority(
  status: HostedWorkspaceInvocationResult["status"],
): number {
  switch (status) {
    case "budget_exhausted":
      return 2;
    case "scheduled":
      return 1;
    case "idle":
      return 0;
  }

  return 0;
}

function resolveHostedRuntimeIdleCheckpointDelayMs(value: number | null | undefined): number {
  if (value !== null && value !== undefined && Number.isFinite(value) && value > 0) {
    return Math.min(Math.trunc(value), HOSTED_RUNTIME_MAX_TIMER_DELAY_MS);
  }

  return DEFAULT_HOSTED_RUNTIME_IDLE_CHECKPOINT_DELAY_MS;
}

function resolveHostedRuntimeCheckpointStartByMs(input: {
  commitTimeoutMs: number;
  deadlineAt?: string | null;
}): number | null {
  if (!input.deadlineAt) {
    return null;
  }

  const deadlineMs = Date.parse(input.deadlineAt);
  if (!Number.isFinite(deadlineMs)) {
    return null;
  }

  return deadlineMs - input.commitTimeoutMs - HOSTED_RUNTIME_DEADLINE_MARGIN_MS;
}

function earliestHostedRuntimeFiniteMs(...values: (number | null)[]): number | null {
  let earliest: number | null = null;
  for (const value of values) {
    if (value === null || !Number.isFinite(value)) {
      continue;
    }
    if (earliest === null || value < earliest) {
      earliest = value;
    }
  }

  return earliest;
}

async function waitForHostedRuntimeIdleCheckpointWindow(input: {
  checkpointStartByMs: number | null;
  idleCheckpointDelayMs: number;
  runtimeAbortSignal: AbortSignal;
  runtimeWakeSignal: RuntimeWakeSignal | null;
}): Promise<HostedRuntimeIdleCheckpointWaitResult> {
  const nowMs = Date.now();
  if (input.checkpointStartByMs !== null && input.checkpointStartByMs <= nowMs) {
    return "deadline";
  }

  const deadlineDelayMs = input.checkpointStartByMs === null
    ? null
    : Math.max(0, input.checkpointStartByMs - nowMs);
  const timeoutMs = Math.min(
    input.idleCheckpointDelayMs,
    deadlineDelayMs ?? input.idleCheckpointDelayMs,
    HOSTED_RUNTIME_MAX_TIMER_DELAY_MS,
  );
  const timeoutResult: HostedRuntimeIdleCheckpointWaitResult =
    deadlineDelayMs !== null && deadlineDelayMs <= input.idleCheckpointDelayMs
      ? "deadline"
      : "idle";

  return await new Promise<HostedRuntimeIdleCheckpointWaitResult>((resolve, reject) => {
    if (input.runtimeAbortSignal.aborted) {
      reject(readHostedRuntimeAbortReason(input.runtimeAbortSignal));
      return;
    }

    let settled = false;
    const wakeAbortController = new AbortController();
    const timeout = setTimeout(() => {
      settle(() => resolve(timeoutResult));
    }, timeoutMs);
    const abort = () => {
      settle(() => reject(readHostedRuntimeAbortReason(input.runtimeAbortSignal)));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      input.runtimeAbortSignal.removeEventListener("abort", abort);
      if (!wakeAbortController.signal.aborted) {
        wakeAbortController.abort(
          new DOMException("Hosted runtime idle checkpoint wait finished.", "AbortError"),
        );
      }
    };
    const settle = (finish: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      finish();
    };

    input.runtimeAbortSignal.addEventListener("abort", abort, { once: true });
    input.runtimeWakeSignal?.wait(wakeAbortController.signal).then(
      () => settle(() => resolve("wake")),
      (error) => {
        if (settled && wakeAbortController.signal.aborted) {
          return;
        }
        settle(() => reject(error));
      },
    );
  });
}

async function checkpointHostedRuntimeDirtyWorkspace(input: {
  assertRuntimeNotAborted: () => void;
  checkpointRequestBuilder: ReturnType<typeof createHostedWorkspaceSnapshotCheckpointRequestBuilder>;
  expectedUserId: string;
  nextWakeAt: string | null;
  nextWakeReason: string | null;
  runtimeAbortSignal: AbortSignal;
  onCheckpointValidated?: (checkpoint: HostedWorkspaceCheckpointResponse) => Promise<void> | void;
  redactedStatus: HostedWorkspaceInvocationResult["redactedStatus"] | null;
  workspacePort: HostedRuntimePlatform["workspacePort"];
}): Promise<HostedWorkspaceCheckpointResponse> {
  if (!input.workspacePort) {
    throw new TypeError("Hosted runtime dirty workspace checkpoint requires workspace port support.");
  }

  input.assertRuntimeNotAborted();
  const checkpointRequest = await raceHostedRuntimeCancellation(
    Promise.resolve(input.checkpointRequestBuilder.createRequest({
      nextWakeAt: input.nextWakeAt,
      nextWakeReason: input.nextWakeReason,
      reason: "idle_shutdown",
      redactedStatus: input.redactedStatus ?? null,
    })),
    input.runtimeAbortSignal,
  );
  input.assertRuntimeNotAborted();
  const checkpoint = await raceHostedRuntimeCancellation(
    input.workspacePort.checkpoint(checkpointRequest),
    input.runtimeAbortSignal,
  );
  input.assertRuntimeNotAborted();
  assertIdleShutdownCheckpointAccepted(checkpoint, input.expectedUserId);
  await input.onCheckpointValidated?.(checkpoint);
  return checkpoint;
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

function raceHostedRuntimeCancellation<T>(
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
    : new Error("Hosted workspace runtime was aborted.");
}

function assertHostedWorkspaceRuntimeBudgetSupported(maxRuntimeMs: number | null | undefined): void {
  if (maxRuntimeMs === undefined || maxRuntimeMs === null) {
    return;
  }

  throw new TypeError("Hosted workspace runtime job budget.maxRuntimeMs is not supported yet.");
}

function createAbortGuardedHostedRuntimePlatform(
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

function resolveHostedWorkspaceRunMailboxLimit(value: number | null | undefined): number {
  return value ?? 50;
}

function resolveHostedWorkspaceForegroundMailboxLimit(value: number | null | undefined): number {
  return Math.max(
    1,
    Math.min(
      DEFAULT_HOSTED_FOREGROUND_MAILBOX_IMPORT_LIMIT,
      resolveHostedWorkspaceRunMailboxLimit(value),
    ),
  );
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

function resolveHostedWorkspaceRunNextWake(input: {
  assistantPhaseResult: Awaited<ReturnType<typeof runHostedWorkspaceUntilIdleOrBudget>>[
    "assistantPhaseResult"
  ];
  committedWorkspace: HostedWorkspaceState | null;
  mailboxImportRetryAt?: string | null;
  nowMs: number;
}): {
  nextWakeAt: string | null;
  nextWakeReason: string | null;
} {
  const mailboxImportRetryAt = input.mailboxImportRetryAt ?? null;
  if (
    input.assistantPhaseResult
    && Object.hasOwn(input.assistantPhaseResult, "nextWakeAt")
  ) {
    return selectEarliestHostedRuntimeWake([
      {
        at: input.assistantPhaseResult.nextWakeAt ?? null,
        reason: input.assistantPhaseResult.nextWakeAt ? "assistant" : null,
      },
      {
        at: mailboxImportRetryAt,
        reason: mailboxImportRetryAt ? "mailbox" : null,
      },
    ]);
  }

  const committedWorkspaceNextWakeAt = normalizeHostedFutureWakeAt(
    input.committedWorkspace?.nextWakeAt ?? null,
    input.nowMs,
  );

  return selectEarliestHostedRuntimeWake([
    {
      at: committedWorkspaceNextWakeAt,
      reason: committedWorkspaceNextWakeAt
        ? input.committedWorkspace?.nextWakeReason ?? null
        : null,
    },
    {
      at: mailboxImportRetryAt,
      reason: mailboxImportRetryAt ? "mailbox" : null,
    },
  ]);
}

function selectEarliestHostedRuntimeWake(
  candidates: readonly { at: string | null; reason: string | null }[],
): {
  nextWakeAt: string | null;
  nextWakeReason: string | null;
} {
  let selected: { at: string; reason: string | null } | null = null;
  for (const candidate of candidates) {
    if (!candidate.at) {
      continue;
    }
    if (
      !selected
      || compareHostedRuntimeWakeAt(candidate.at, selected.at) < 0
    ) {
      selected = {
        at: candidate.at,
        reason: candidate.reason,
      };
    }
  }

  return {
    nextWakeAt: selected?.at ?? null,
    nextWakeReason: selected?.reason ?? null,
  };
}

function compareHostedRuntimeWakeAt(left: string, right: string): number {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs) && !Number.isFinite(rightMs)) {
    return 0;
  }
  if (!Number.isFinite(leftMs)) {
    return 1;
  }
  if (!Number.isFinite(rightMs)) {
    return -1;
  }
  return leftMs - rightMs;
}
