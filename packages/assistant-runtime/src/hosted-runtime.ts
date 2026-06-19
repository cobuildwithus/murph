import { existsSync } from "node:fs";
import path from "node:path";

import {
  HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_PHASE_KEYS,
  type HostedRuntimeLatencyPhaseBreakdown,
  type HostedRuntimeLatencyTraceMilestone,
  type HostedRuntimeLatencyTraceStagedMilestones,
  type HostedWorkspaceCheckpointResponse,
  type HostedWorkspaceInvocationResult,
  type HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  VAULT_LAYOUT,
} from "@murphai/contracts";
import {
  HOSTED_EXECUTION_DEVICE_SYNC_STAGED_DIRTY_ACK_PAYLOAD_ID_LIMIT,
  HOSTED_EXECUTION_DEVICE_SYNC_STAGED_DIRTY_ACK_RECORD_LIMIT,
} from "@murphai/device-syncd/hosted-runtime";
import {
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
} from "@murphai/hosted-execution/cli-runtime-bridge";
import {
  buildHostedExecutionSafeErrorDiagnostics,
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
  summarizeHostedExecutionError,
  type HostedExecutionLogPhase,
  type HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";
import {
  flushPendingAssistantRuntimeIssueWrites,
  findAssistantSessionIdByCodexThreadId,
  readAssistantInputEvent,
} from "@murphai/assistant-engine";
import {
  type AssistantCurrentDeliveryRoute,
} from "@murphai/operator-config/assistant/current-delivery-route";
import {
  normalizeHostedAssistantRuntimeConfig,
  projectHostedRuntimeTrustStoreEnv,
} from "./hosted-runtime/environment.ts";
import {
  prepareHostedCodexRuntimeEnvironment,
} from "./hosted-runtime/codex-config.ts";
import {
  HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV,
} from "./hosted-runtime/codex-runtime-env.ts";
import {
  resolveAssistantUsageCredentialSource,
} from "@murphai/hosted-execution/assistant-usage";
import {
  HOSTED_IDLE_COMPACT_TIMEOUT_MS,
  runHostedIdleCheckpointMaintenance,
} from "./hosted-runtime/idle-maintenance.ts";
import {
  getOrCreateHostedCliRuntimeBridge,
} from "./hosted-runtime/cli-runtime-bridge.ts";
import {
  readHostedAssistantInputCurrentDeliveryRoute,
  resolveUnambiguousCurrentDeliveryRoute,
} from "./hosted-runtime/current-delivery-route.ts";
import {
  executeHostedMailboxEvent,
} from "./hosted-runtime/events.ts";
import {
  createHostedAssistantChannelTypingDependencies,
} from "./hosted-runtime/channel-activity.ts";
import type {
  HostedAssistantWorkspaceRuntimeJobInput,
  HostedDeviceSyncDirtyProcessedPostCheckpointRecord,
} from "./hosted-runtime/models.ts";
import type {
  HostedMailboxResolvedImportItem,
} from "./hosted-runtime/mailbox-import.ts";
import {
  HOSTED_MAILBOX_ITEM_BUDGET_REASON_CODE,
  type HostedMailboxItemImportOutcome,
} from "./hosted-runtime/mailbox-import.ts";
import {
  offerHostedVaultShareProjectionBestEffort,
} from "./hosted-runtime/vault-share-projection.ts";
import type {
  HostedRuntimeDeviceSyncMessagingReturnTarget,
  HostedRuntimePlatform,
} from "./hosted-runtime/platform.ts";
import {
  buildHostedMailboxImportRedactedStatus,
  HostedMailboxImportCheckpointConflictError,
  HostedMailboxImportCheckpointUserMismatchError,
  importHostedMailboxPrefixAndCheckpoint,
  type HostedMailboxImportCheckpointResult,
} from "./hosted-runtime/mailbox-checkpoint.ts";
import {
  HostedRuntimeBridgeCheckpointLeaseError,
} from "./hosted-runtime/checkpoint-bridge.ts";
import type {
  HostedWorkspaceCheckpointRequestBuilder,
  HostedWorkspaceSnapshotCheckpointBuilder,
} from "./hosted-runtime/workspace-runner.ts";
import {
  createHostedWorkspaceCheckpointRequestBuilder,
  createHostedWorkspaceSnapshotCheckpointRequestBuilder,
  HostedWorkspaceRunnerUserMismatchError,
  importHostedMailboxForWorkspaceRunner,
  runHostedWorkspaceUntilIdleOrBudget,
  type HostedWorkspaceDurableCheckpointEffect,
  type HostedWorkspaceDurableCheckpointEffectResult,
  type HostedWorkspaceRunnerMailboxImportContext,
  type HostedWorkspaceRunnerInput,
  type HostedWorkspaceRunnerResult,
} from "./hosted-runtime/workspace-runner.ts";
import {
  restoreHostedWorkspaceRuntimeJobWorkspace,
  writeHostedWorkspaceCleanCheckpointMarkerBestEffort,
} from "./hosted-runtime/workspace-restore.ts";
import {
  refreshHostedBrowserVaultReplicaFromRuntime,
  type HostedBrowserVaultReplicaRefreshResult,
} from "./hosted-runtime/browser-vault-replica.ts";
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
  exportHostedPendingAssistantRuntimeIssues,
} from "./hosted-runtime/issues.ts";
import {
  normalizeHostedFutureWakeAt,
} from "./hosted-runtime/wake-time.ts";
import {
  selectHostedRuntimeWakeCandidate,
} from "./hosted-runtime/wake-candidates.ts";
export {
  createCoalescingRuntimeWakeSignal,
} from "./hosted-runtime/runtime-wake.ts";
export type {
  RuntimeWakeNotification,
  RuntimeWakeSignal,
} from "./hosted-runtime/runtime-wake.ts";
import type {
  RuntimeWakeNotification,
  RuntimeWakeSignal,
} from "./hosted-runtime/runtime-wake.ts";
export {
  createHostedBrowserVaultReplicaRefreshFromWorkspace,
  createHostedBrowserVaultReplicaForSourceState,
  clearHostedBrowserVaultWarmSourceStateHash,
  readHostedBrowserVaultWarmSourceStateHash,
  refreshHostedBrowserVaultReplicaFromRuntime,
  summarizeHostedBrowserVaultReplicaContent,
  writeHostedBrowserVaultWarmSourceStateHashBestEffort,
} from "./hosted-runtime/browser-vault-replica.ts";
export type {
  HostedBrowserVaultReplicaContentSummary,
  HostedBrowserVaultReplicaRefreshResult,
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
  HostedRuntimeArtifactReader,
  HostedRuntimeArtifactStore,
  HostedRuntimeArtifactWriter,
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
  HostedRuntimeLatencyTracePort,
  HostedRuntimeLatencyTraceRecordResponse,
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
  HostedRuntimeWorkspaceSnapshotDirectUploadTimingDetails,
  HostedRuntimeWorkspaceSnapshotDataKey,
  HostedRuntimeWorkspaceSnapshotPort,
} from "./hosted-runtime/platform.ts";
export {
  normalizeHostedAssistantRuntimeConfig,
  projectHostedRuntimeProcessEnv,
  sanitizeHostedAssistantRuntimeForwardedEnv,
} from "./hosted-runtime/environment.ts";
export {
  executeHostedMailboxEvent,
};
export {
  restoreHostedWorkspaceRuntimeJobWorkspace,
  writeHostedWorkspaceCleanCheckpointMarkerBestEffort,
} from "./hosted-runtime/workspace-restore.ts";
export {
  parseHostedRuntimeIssueRecordResponse,
  parseHostedRuntimeLatencyTraceResponse,
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

const HOSTED_INITIAL_CONVERSATION_MAILBOX_IMPORT_LANES = ["conversation"] as const;
const HOSTED_INITIAL_BOOTSTRAP_MAILBOX_IMPORT_LANES = ["system", "conversation"] as const;
const HOSTED_INITIAL_BOOTSTRAP_PENDING_REASON_CODE = "bootstrap.pending";
const HOSTED_RUNTIME_ISSUE_POST_CHECKPOINT_EXPORT_TIMEOUT_MS = 2_500;

interface HostedInitialMailboxImportResult {
  bootstrapPending: boolean;
  result: HostedMailboxImportCheckpointResult;
}

function resolveHostedInitialMailboxImportLanes(input: {
  vaultRoot: string;
}): typeof HOSTED_INITIAL_CONVERSATION_MAILBOX_IMPORT_LANES
  | typeof HOSTED_INITIAL_BOOTSTRAP_MAILBOX_IMPORT_LANES {
  return hasHostedVaultMetadata(input.vaultRoot)
    ? HOSTED_INITIAL_CONVERSATION_MAILBOX_IMPORT_LANES
    : HOSTED_INITIAL_BOOTSTRAP_MAILBOX_IMPORT_LANES;
}

function hasHostedVaultMetadata(vaultRoot: string): boolean {
  return existsSync(path.join(vaultRoot, VAULT_LAYOUT.metadata));
}

async function importHostedInitialMailboxForWorkspaceRunner(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestBuilder;
  importItemContext?: HostedWorkspaceRunnerMailboxImportContext | null;
  runnerInput: HostedWorkspaceRunnerInput;
  requestId: string;
}): Promise<HostedInitialMailboxImportResult> {
  const lanes = resolveHostedInitialMailboxImportLanes({
    vaultRoot: input.runnerInput.vaultRoot,
  });
  const result = await importHostedMailboxForWorkspaceRunner({
    checkpointRequestBuilder: input.checkpointRequestBuilder,
    checkpointReason: "import",
    deferCheckpoint: true,
    input: input.runnerInput,
    importItemContext: input.importItemContext ?? null,
    deferConversationUntil: lanes === HOSTED_INITIAL_BOOTSTRAP_MAILBOX_IMPORT_LANES
      ? {
          ready: () => hasHostedVaultMetadata(input.runnerInput.vaultRoot),
          reasonCode: HOSTED_INITIAL_BOOTSTRAP_PENDING_REASON_CODE,
        }
      : null,
    lanes,
    requestId: input.requestId,
  });

  return {
    bootstrapPending: isHostedInitialBootstrapPending({
      lanes,
      result,
      vaultRoot: input.runnerInput.vaultRoot,
    }),
    result,
  };
}

function isHostedInitialBootstrapPending(input: {
  lanes: readonly ("conversation" | "system")[];
  result: HostedMailboxImportCheckpointResult;
  vaultRoot: string;
}): boolean {
  return input.lanes === HOSTED_INITIAL_BOOTSTRAP_MAILBOX_IMPORT_LANES
    && !hasHostedVaultMetadata(input.vaultRoot)
    && input.result.importResult.blocked.some((item) =>
      item.lane === "system"
      || item.reasonCode === HOSTED_INITIAL_BOOTSTRAP_PENDING_REASON_CODE
    );
}

export interface HostedWorkspaceRuntimeJobOptions {
  createCheckpointSnapshot: HostedWorkspaceSnapshotCheckpointBuilder;
  importItem(
    item: HostedMailboxResolvedImportItem,
    context?: HostedWorkspaceRuntimeJobImportContext,
  ): Promise<HostedMailboxItemImportOutcome>;
  platform: HostedRuntimePlatform;
  latencyMilestones?: HostedRuntimeLatencyTraceStagedMilestones | null;
  runAssistantPhase?: HostedWorkspaceRuntimeAssistantPhase;
  runtimeWakeSignal?: RuntimeWakeSignal | null;
  /**
   * Fires when the container has been told to exit (for example a deploy
   * rollout SIGTERM). The runtime treats it as the idle window elapsing now:
   * the next dirty wait returns immediately so the normal idle_shutdown
   * checkpoint runs inside the termination grace period instead of the state
   * dying unsnapshotted. Active foreground work is not interrupted.
   */
  shutdownSignal?: AbortSignal | null;
  signal?: AbortSignal | null;
  vaultRoot: string;
}

export interface HostedWorkspaceRuntimeJobImportContext {
  recordMessagingReturnTarget?(
    target: HostedRuntimeDeviceSyncMessagingReturnTarget | null,
  ): void;
  latencyMilestones?: HostedRuntimeLatencyTraceStagedMilestones | null;
  runtimeAttemptId?: string | null;
  signal?: AbortSignal | null;
}

interface HostedRuntimeWakeLatencySeed {
  foregroundWaitResolvedAtEpochMs: number;
  runtimeWakeNotifiedAtEpochMs: number | null;
}

function mergeHostedRuntimeLatencyTraceStagedMilestones(
  base: HostedRuntimeLatencyTraceStagedMilestones | null | undefined,
  extra: HostedRuntimeLatencyTraceStagedMilestones | null | undefined,
): HostedRuntimeLatencyTraceStagedMilestones | null {
  if (!base && !extra) {
    return null;
  }

  const phaseBreakdown = mergeHostedRuntimeLatencyPhaseBreakdown(
    base?.phaseBreakdown ?? null,
    extra?.phaseBreakdown ?? null,
  );
  const merged: HostedRuntimeLatencyTraceStagedMilestones = {
    ...(base ?? {}),
    ...(extra ?? {}),
  };
  if (phaseBreakdown) {
    merged.phaseBreakdown = phaseBreakdown;
  } else {
    delete merged.phaseBreakdown;
  }
  return merged;
}

function mergeHostedRuntimeLatencyPhaseBreakdown(
  base: HostedRuntimeLatencyPhaseBreakdown | null | undefined,
  extra: HostedRuntimeLatencyPhaseBreakdown | null | undefined,
): HostedRuntimeLatencyPhaseBreakdown | null {
  if (!base && !extra) {
    return null;
  }

  const merged: HostedRuntimeLatencyPhaseBreakdown = {
    schemaVersion: extra?.schemaVersion ?? base?.schemaVersion ?? 1,
  };
  for (const phase of HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_PHASE_KEYS) {
    if (base?.[phase] || extra?.[phase]) {
      merged[phase] = { ...(base?.[phase] ?? {}), ...(extra?.[phase] ?? {}) };
    }
  }
  return merged;
}

function createHostedRuntimeWakeLatencySeed(
  notification: RuntimeWakeNotification | null | undefined,
): HostedRuntimeWakeLatencySeed | null {
  if (!notification) {
    return null;
  }

  return {
    foregroundWaitResolvedAtEpochMs: Date.now(),
    runtimeWakeNotifiedAtEpochMs: notification.notifiedAtEpochMs,
  };
}

function createHostedRuntimeWakeInitialImportContext(
  seed: HostedRuntimeWakeLatencySeed | null | undefined,
): HostedWorkspaceRunnerMailboxImportContext | null {
  if (!seed) {
    return null;
  }

  return {
    latencyMilestones: {
      phaseBreakdown: {
        schemaVersion: 1,
        wake: {
          ...(seed.runtimeWakeNotifiedAtEpochMs === null
            ? {}
            : { runtimeWakeNotifiedAtEpochMs: seed.runtimeWakeNotifiedAtEpochMs }),
          foregroundWaitResolvedAtEpochMs: seed.foregroundWaitResolvedAtEpochMs,
        },
      },
    },
  };
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

export class HostedRuntimeCheckpointInterruptedByWakeError extends Error {
  readonly code = "runtime_wake_during_checkpoint";
  readonly notification: RuntimeWakeNotification | null;

  constructor(input: {
    message?: string;
    notification?: RuntimeWakeNotification | null;
  } = {}) {
    super(input.message ?? "Hosted runtime checkpoint was interrupted by a pending runtime wake.");
    this.name = "HostedRuntimeCheckpointInterruptedByWakeError";
    this.notification = input.notification ?? null;
  }
}

function isHostedRuntimeCheckpointSupersededByWorkspaceProgress(
  error: unknown,
): boolean {
  if (
    !(error instanceof HostedRuntimeBridgeCheckpointLeaseError)
    || error.code !== "stale_workspace_version"
  ) {
    return false;
  }

  switch (error.stage) {
    case "before_snapshot":
    case "before_bundle_write":
    case "before_direct_r2_put":
    case "before_web_checkpoint":
      return true;
    case "after_web_checkpoint":
      return false;
  }
}

function recordHostedRuntimeLatencyMilestoneBestEffort(input: {
  at: string;
  latencyTracePort?: HostedRuntimePlatform["latencyTracePort"] | null;
  milestone: HostedRuntimeLatencyTraceMilestone;
  runtimeAttemptId: string;
}): void {
  if (!input.latencyTracePort) {
    return;
  }

  try {
    void input.latencyTracePort.record({
      event: {
        at: input.at,
        milestone: input.milestone,
        runtimeAttemptId: input.runtimeAttemptId,
        source: "linq",
        type: "runtime_milestone",
      },
    }).catch(() => {
      // Latency traces are diagnostic-only and must not affect runtime progress.
    });
  } catch {
    // Latency traces are diagnostic-only and must not affect runtime progress.
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
  const hostAbortSignal = options.signal ?? null;
  const abortFromHost = () => {
    if (!hostAbortSignal || runtimeAbortController.signal.aborted) {
      return;
    }
    runtimeAbortController.abort(readHostedRuntimeAbortReason(hostAbortSignal));
  };
  if (hostAbortSignal?.aborted) {
    abortFromHost();
  } else {
    hostAbortSignal?.addEventListener("abort", abortFromHost, { once: true });
  }
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
  let latestCheckpointSnapshotCleanForWarmReuse = false;
  const createAbortGuardedCheckpointSnapshot: HostedWorkspaceSnapshotCheckpointBuilder =
    async (snapshotInput) => {
      assertRuntimeNotAborted();
      const snapshot = await options.createCheckpointSnapshot(snapshotInput);
      assertRuntimeNotAborted();
      latestCheckpointSnapshotCleanForWarmReuse =
        snapshot.localWorkspaceCleanForWarmReuse === true;
      return snapshot;
    };
  const phaseLogger = createHostedRuntimePhaseLogger();
  const emitPhaseLog = phaseLogger.emit;

  try {
    const runtimePhaseStartedAt = new Date().toISOString();
    const initialAssistantInputLatencyMilestones: HostedRuntimeLatencyTraceStagedMilestones = {
      ...(options.latencyMilestones ?? {}),
      runtimePhaseStartedAt,
    };
    emitPhaseLog({
      input,
      requestId,
      stage: "workspace.read",
      status: "start",
    });
    const workspaceRead = Object.hasOwn(input.request, "workspace")
      ? {
          fetchedAt: new Date().toISOString(),
          workspace: input.request.workspace ?? null,
        }
      : await raceHostedRuntimeCancellation(
          workspacePort.read(),
          runtimeAbortController.signal,
        );
    emitPhaseLog({
      details: {
        actualWorkspaceVersion: workspaceRead.workspace?.version ?? null,
        workspaceReadSource: Object.hasOwn(input.request, "workspace")
          ? "invocation_request"
          : "workspace_port",
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
    const importMailboxItem: HostedWorkspaceRunnerInput["importItem"] = (item, context) =>
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
          latencyMilestones: mergeHostedRuntimeLatencyTraceStagedMilestones(
            initialAssistantInputLatencyMilestones,
            context?.latencyMilestones ?? null,
          ),
          runtimeAttemptId: input.request.attemptId,
          signal: context?.signal ?? runtimeAbortController.signal,
        },
      );
    const importForegroundMailboxItem: HostedWorkspaceRunnerInput["importItem"] = (item, context) =>
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
          latencyMilestones: mergeHostedRuntimeLatencyTraceStagedMilestones(
            initialAssistantInputLatencyMilestones,
            context?.latencyMilestones ?? null,
          ),
          runtimeAttemptId: input.request.attemptId,
          signal: context?.signal ?? runtimeAbortController.signal,
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
    const workspaceRestoreDoneAt = new Date().toISOString();
    initialAssistantInputLatencyMilestones.workspaceRestoreDoneAt = workspaceRestoreDoneAt;
    // Attach the in-memory cold-start phase breakdown to the SAME staged-milestone
    // object already passed to the assistant_input_staged event. No new request,
    // await, or I/O: restore timings were returned in-memory by the restore call,
    // and the boot.nodeStartupMs (if any) rode in via options.latencyMilestones.
    const incomingBoot = initialAssistantInputLatencyMilestones.phaseBreakdown?.boot;
    const incomingDispatch = initialAssistantInputLatencyMilestones.phaseBreakdown?.dispatch;
    initialAssistantInputLatencyMilestones.phaseBreakdown = {
      schemaVersion: 1,
      ...(incomingDispatch ? { dispatch: incomingDispatch } : {}),
      ...(restored.restoreTiming ? { restore: restored.restoreTiming } : {}),
      boot: {
        ...(incomingBoot ?? {}),
        restoreWasCold: restored.restoreWasCold,
      },
    };
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
    emitPhaseLog({
      input,
      requestId,
      stage: "cli.bridge",
      status: "start",
    });
    const hostedCliBridge = await raceHostedRuntimeCancellation(
      getOrCreateHostedCliRuntimeBridge(),
      runtimeAbortController.signal,
    );
    emitPhaseLog({
      details: {
        bridgeStarted: true,
      },
      input,
      requestId,
      stage: "cli.bridge",
      status: "done",
    });
    const imageCodexModelCatalogJson =
      process.env[HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]?.trim();
    const baseRuntimeEnv = {
      ...projectHostedRuntimeTrustStoreEnv(process.env),
      ...guardedRuntime.forwardedEnv,
      ...guardedRuntime.userEnv,
      ...hostedCliBridge.env,
      ...(imageCodexModelCatalogJson
        ? { [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]: imageCodexModelCatalogJson }
        : {}),
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
    const initialMailboxImportLanes = resolveHostedInitialMailboxImportLanes({
      vaultRoot: restored.vaultRoot,
    });
    const initialMailboxImportContext = createHostedRuntimeWakeInitialImportContext(
      consumePendingHostedRuntimeWake(options.runtimeWakeSignal ?? null),
    );
    emitPhaseLog({
      details: {
        foregroundMailboxLimitPerLane: foregroundMailboxBudget.fetchLimitPerLane,
        initialMailboxImportLanes: [...initialMailboxImportLanes],
        mailboxLimitPerLane: mailboxBudget.fetchLimitPerLane,
      },
      input,
      requestId,
      stage: "mailbox.import.initial",
      status: "start",
    });
    const initialMailboxImportResult = await raceHostedRuntimeCancellation(
      importHostedInitialMailboxForWorkspaceRunner({
        checkpointRequestBuilder,
        importItemContext: initialMailboxImportContext,
        runnerInput: baseRunnerInput,
        requestId,
      }),
      runtimeAbortController.signal,
    );
    const initialMailboxImport = initialMailboxImportResult.result;
    const mailboxImportDoneAt = new Date().toISOString();
    emitPhaseLog({
      details: {
        bootstrapPending: initialMailboxImportResult.bootstrapPending,
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
    recordHostedRuntimeLatencyMilestoneBestEffort({
      at: mailboxImportDoneAt,
      latencyTracePort: guardedRuntime.platform.latencyTracePort ?? null,
      milestone: "mailbox_import_done",
      runtimeAttemptId: input.request.attemptId,
    });
    assertRuntimeNotAborted();
    const returnInitialMailboxImportBeforeForeground = async () => {
      const redactedStatus = buildHostedMailboxImportRedactedStatus(
        initialMailboxImport.importResult,
      );
      const nextWake = resolveHostedWorkspaceRunNextWake({
        assistantPhaseResult: null,
        committedWorkspace: workspaceRead.workspace,
        mailboxImportRetryAt: initialMailboxImport.importResult.nextRetryAt ?? null,
        nowMs: Date.now(),
      });

      if (initialMailboxImport.checkpointDeferred && initialMailboxImport.stateChanged) {
        emitPhaseLog({
          details: {
            nextWakeAtPresent: nextWake.nextWakeAt !== null,
            nextWakeReasonPresent: nextWake.nextWakeReason !== null,
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
          nextWakeAt: nextWake.nextWakeAt,
          nextWakeReason: nextWake.nextWakeReason,
          issueExportPort: runtime.platform.issueExportPort ?? null,
          redactedStatus,
          runtimeAbortSignal: runtimeAbortController.signal,
          vaultRoot: restored.vaultRoot,
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
        const invocationResult = {
          nextWakeAt: checkpoint.workspace.nextWakeAt ?? null,
          redactedStatus: checkpoint.workspace.redactedStatus ?? redactedStatus,
          status: resolveHostedWorkspaceInvocationStatus({
            mailboxBudgetExhausted: mailboxBudgetExhausted(),
            nextWakeAt: checkpoint.workspace.nextWakeAt ?? null,
          }),
        };
        emitPhaseLog({
          details: {
            invocationStatus: invocationResult.status,
            nextWakeAtPresent: invocationResult.nextWakeAt !== null,
          },
          input,
          requestId,
          stage: "runtime.return",
          status: "done",
        });
        return invocationResult;
      }

      const invocationResult = {
        nextWakeAt: nextWake.nextWakeAt,
        redactedStatus,
        status: resolveHostedWorkspaceInvocationStatus({
          mailboxBudgetExhausted: mailboxBudgetExhausted(),
          nextWakeAt: nextWake.nextWakeAt,
        }),
      };
      emitPhaseLog({
        details: {
          invocationStatus: invocationResult.status,
          nextWakeAtPresent: invocationResult.nextWakeAt !== null,
        },
        input,
        requestId,
        stage: "runtime.return",
        status: "done",
      });
      return invocationResult;
    };
    if (initialMailboxImportResult.bootstrapPending) {
      return await returnInitialMailboxImportBeforeForeground();
    }
    if (
      shouldCheckpointHostedReplayBudgetProgressBeforeForeground({
        mailboxBudgetExhausted: mailboxBudget.exhausted,
        result: initialMailboxImport,
      })
    ) {
      return await returnInitialMailboxImportBeforeForeground();
    }
    if (restored.inboxSidecarNeedsRebuild) {
      invalidateHostedInboxSidecarReady(restored.vaultRoot);
    }
    const inboxReady = isHostedInboxSidecarReady(restored.vaultRoot);
    emitPhaseLog({
      details: {
        inboxReady,
        rebuild: !inboxReady && restored.inboxSidecarNeedsRebuild,
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
        rebuild: !inboxReady && restored.inboxSidecarNeedsRebuild,
        requestId,
        vaultRoot: restored.vaultRoot,
      }),
      runtimeAbortController.signal,
    );
    emitPhaseLog({
      details: {
        rebuild: !inboxReady && restored.inboxSidecarNeedsRebuild,
      },
      input,
      requestId,
      stage: "inbox.sidecar",
      status: "done",
    });
    assertRuntimeNotAborted();
    const runtimeEnv = hostedCodexRuntime.runtimeEnv;
    let stagedDeviceSyncDirtyAcks: HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] = [];
    let suppressDirtyPendingFetchUntilCheckpoint = false;
    const stageDeviceSyncDirtyAcks = (
      records: readonly HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] | null | undefined,
    ): void => {
      if (!records || records.length === 0) {
        return;
      }
      stagedDeviceSyncDirtyAcks = mergeHostedDeviceSyncStagedDirtyAckRecords([
        ...stagedDeviceSyncDirtyAcks,
        ...records,
      ]);
      if (
        stagedDeviceSyncDirtyAcks.length >= HOSTED_EXECUTION_DEVICE_SYNC_STAGED_DIRTY_ACK_RECORD_LIMIT
        || countHostedDeviceSyncStagedDirtyAckPayloadIds(stagedDeviceSyncDirtyAcks)
          >= HOSTED_EXECUTION_DEVICE_SYNC_STAGED_DIRTY_ACK_PAYLOAD_ID_LIMIT
      ) {
        suppressDirtyPendingFetchUntilCheckpoint = true;
      }
    };
    const clearStagedDeviceSyncDirtyAcks = (): void => {
      stagedDeviceSyncDirtyAcks = [];
      suppressDirtyPendingFetchUntilCheckpoint = false;
    };
    let browserVaultReplicaRefreshRequested = false;
    const recordBrowserVaultReplicaRefreshIntent = (
      passResult: HostedWorkspaceRunnerResult,
    ): void => {
      browserVaultReplicaRefreshRequested ||=
        passResult.assistantPhaseResult?.browserVaultReplicaRefreshRequested === true;
    };
    const runForegroundPass = async (passInput: {
      initialMailboxImport?: HostedWorkspaceRunnerInput["initialMailboxImport"];
      initialMailboxImportContext?: HostedWorkspaceRunnerMailboxImportContext | null;
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
        let currentDeliveryRoute = await resolveHostedForegroundCurrentDeliveryRoute({
          initialMailboxImport: passInput.initialMailboxImport,
          vaultRoot: restored.vaultRoot,
        });
        const passResult = await hostedCliBridge.runWithInvocation(
          {
            currentDeliveryRoute: () => currentDeliveryRoute,
            deviceSyncPort: guardedRuntime.platform.deviceSyncPort ?? null,
            messagingReturnTarget: () => hostedCliBridgeMessagingReturnTarget,
            signal: runtimeAbortController.signal,
          },
          async () =>
            await raceHostedRuntimeCancellation(
              runHostedWorkspaceUntilIdleOrBudget({
                ...baseRunnerInput,
                initialMailboxImport: passInput.initialMailboxImport,
                initialMailboxImportContext: passInput.initialMailboxImportContext ?? null,
                requestId: passInput.requestId,
                runAssistantPhase: async (phaseInput) => {
                  currentDeliveryRoute = await resolveHostedForegroundCurrentDeliveryRoute({
                    initialMailboxImport: phaseInput.initialMailboxImport,
                    vaultRoot: restored.vaultRoot,
                  });
                  return await (options.runAssistantPhase ?? runHostedWorkspaceAssistantPhase)({
                    ...phaseInput,
                    request: input.request,
                    restored,
                    runtime: foregroundRuntime,
                    runtimeEnv,
                    stagedDirtyAcks: stagedDeviceSyncDirtyAcks,
                    suppressDirtyPendingFetch: suppressDirtyPendingFetchUntilCheckpoint,
                    signal: runtimeAbortController.signal,
                  });
                },
                workspace: passInput.workspace,
              }),
              runtimeAbortController.signal,
            ),
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
        stageDeviceSyncDirtyAcks(passResult.assistantPhaseResult?.stagedDirtyAcks);
        recordBrowserVaultReplicaRefreshIntent(passResult);
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
    const runBrowserVaultRefreshMaintenance = async (maintenanceInput: {
      workspace: HostedWorkspaceState | null;
    }): Promise<HostedBrowserVaultReplicaRefreshResult> => {
      emitPhaseLog({
        details: {
          workspacePresent: maintenanceInput.workspace !== null,
          workspaceVersion: maintenanceInput.workspace?.version ?? null,
        },
        input,
        requestId,
        stage: "browser_vault.refresh",
        status: "start",
      });
      const refresh = await refreshHostedBrowserVaultReplicaFromRuntime({
        force: browserVaultReplicaRefreshRequested,
        generatedAt: new Date().toISOString(),
        platform: guardedRuntime.platform,
        runtimeWakeSignal: options.runtimeWakeSignal ?? null,
        signal: runtimeAbortController.signal,
        timeoutMs: null,
        vaultRoot: restored.vaultRoot,
        workspace: maintenanceInput.workspace,
      });
      emitPhaseLog({
        details: buildHostedBrowserVaultRefreshLogDetails(refresh),
        input,
        requestId,
        stage: "browser_vault.refresh",
        status: "done",
      });
      return refresh;
    };
    const idleCheckpointDelayMs = resolveHostedRuntimeIdleCheckpointDelayMs(
      input.request.idleCheckpointDelayMs,
    );
    let result: HostedWorkspaceRunnerResult;
    let runtimeStateDirty = false;
    const pendingDurableCheckpointEffects: HostedWorkspaceDurableCheckpointEffect[] = [];
    const pendingMailboxPostCheckpointEffectCompletions = new Set<Promise<void>>();
    let durableCheckpointWakeAt: string | null = null;
    let durableCheckpointWakeReason: string | null = null;
    let idleCheckpointStartByMs: number | null = null;
    let idleWakeOrdinal = 0;
    const markIdleCheckpointTimerAfterDirtyWork = () => {
      idleCheckpointStartByMs = Date.now() + idleCheckpointDelayMs;
    };
    const runDurableCheckpointEffectsBestEffort = async (): Promise<void> => {
      const effects = pendingDurableCheckpointEffects.splice(0);
      for (const effect of effects) {
        try {
          const effectResult = await effect();
          const effectWake = readHostedWorkspaceDurableCheckpointEffectWake(effectResult);
          if (effectWake.nextWakeAt) {
            const selectedWake = selectEarliestHostedRuntimeWake([
              {
                at: durableCheckpointWakeAt,
                reason: durableCheckpointWakeReason,
              },
              {
                at: effectWake.nextWakeAt,
                reason: effectWake.nextWakeReason,
              },
            ]);
            durableCheckpointWakeAt = selectedWake.nextWakeAt;
            durableCheckpointWakeReason = selectedWake.nextWakeReason;
          }
        } catch (error) {
          emitPhaseLog({
            error,
            input,
            requestId,
            stage: "workspace.checkpoint.durable_effect",
            status: "fail",
          });
        }
      }
    };
    const trackMailboxPostCheckpointEffects = (passResult: HostedWorkspaceRunnerResult): void => {
      const effectsFinished = passResult.mailboxPostCheckpointEffectsFinished;
      if (!effectsFinished) {
        return;
      }
      pendingMailboxPostCheckpointEffectCompletions.add(effectsFinished);
      void effectsFinished.finally(() => {
        pendingMailboxPostCheckpointEffectCompletions.delete(effectsFinished);
      });
    };
    const waitForMailboxPostCheckpointEffectsBeforeIdleCheckpoint =
      async (): Promise<HostedRuntimeMailboxEffectsWaitResult> => {
      while (pendingMailboxPostCheckpointEffectCompletions.size > 0) {
        const effectsFinished = Promise.all([
          ...pendingMailboxPostCheckpointEffectCompletions,
        ]);
        const runtimeWakeSignal = options.runtimeWakeSignal ?? null;
        if (!runtimeWakeSignal) {
          await raceHostedRuntimeCancellation(
            effectsFinished,
            runtimeAbortController.signal,
          );
          continue;
        }

        const wakeAbortController = new AbortController();
        const abortWake = () => {
          wakeAbortController.abort(readHostedRuntimeAbortReason(runtimeAbortController.signal));
        };
        runtimeAbortController.signal.addEventListener("abort", abortWake, { once: true });
        try {
          const wake = runtimeWakeSignal.wait(wakeAbortController.signal)
            .then((notification) => ({
              kind: "external_wake" as const,
              notification,
            }))
            .catch((error: unknown) => {
              if (
                wakeAbortController.signal.aborted
                && !runtimeAbortController.signal.aborted
              ) {
                return { kind: "finished" as const };
              }
              throw error;
            });
          const waitResult = await Promise.race([
            effectsFinished.then(() => ({ kind: "finished" as const })),
            wake,
          ]);
          if (waitResult.kind === "external_wake") {
            return waitResult;
          }
        } finally {
          runtimeAbortController.signal.removeEventListener("abort", abortWake);
          if (!wakeAbortController.signal.aborted) {
            wakeAbortController.abort();
          }
        }
      }
      return { kind: "finished" };
    };
      result = await runForegroundPass({
        initialMailboxImport,
        requestId,
        workspace: workspaceRead.workspace,
      });
      pendingDurableCheckpointEffects.push(...result.afterDurableCheckpoint);
      trackMailboxPostCheckpointEffects(result);
      runtimeStateDirty ||= result.runtimeStateDirty;
      if (result.runtimeStateDirty) {
        markIdleCheckpointTimerAfterDirtyWork();
      }
      // Best-effort consented vault-share offer: runs once per wake after the foreground
      // pass so it never delays user-facing work, holds no share state (web is the
      // authority), and never throws.
      const vaultShareOffer = await offerHostedVaultShareProjectionBestEffort({
        vaultRoot: restored.vaultRoot,
        vaultSharePort: guardedRuntime.platform.vaultSharePort ?? null,
      });
      if (vaultShareOffer.outcome === "error") {
        emitHostedExecutionStructuredLog({
          component: "runtime",
          details: {
            requestId,
            vaultShareOfferOutcome: vaultShareOffer.outcome,
          },
          level: "warn",
          message: "Hosted vault-share projection offer failed; continuing wake.",
          phase: "wake.running",
          userId: null,
        });
      }
      let accumulatedProjection = buildHostedWorkspaceInvocationProjection({
        mailboxBudgetExhausted: mailboxBudgetExhausted(),
        result,
        workspace: workspaceRead.workspace,
      });
      let servicedProjectedRuntimeWakeKey: string | null = null;
      const runIdleWakeForegroundPass = async (wakeInput: {
        latencySeed?: HostedRuntimeWakeLatencySeed | null;
        projectedWakeKeyBeingServiced: string | null;
        requestIdKind: "checkpoint-interrupt" | "idle-wake";
      }): Promise<void> => {
        idleWakeOrdinal += 1;
        const passWorkspace = projectHostedWorkspaceWakeForForegroundPass({
          projection: accumulatedProjection,
          workspace:
            result.latestWorkspace
            ?? accumulatedProjection.committedWorkspace
            ?? workspaceRead.workspace,
        });
        result = await runForegroundPass({
          initialMailboxImport: null,
          initialMailboxImportContext: createHostedRuntimeWakeInitialImportContext(
            wakeInput.latencySeed ?? null,
          ),
          requestId: `${requestId}:${wakeInput.requestIdKind}:${idleWakeOrdinal}`,
          workspace: passWorkspace,
        });
        pendingDurableCheckpointEffects.push(...result.afterDurableCheckpoint);
        trackMailboxPostCheckpointEffects(result);
        if (result.runtimeStateDirty) {
          markIdleCheckpointTimerAfterDirtyWork();
        }
        const nextProjection = buildHostedWorkspaceInvocationProjection({
          mailboxBudgetExhausted: mailboxBudgetExhausted(),
          result,
          workspace: passWorkspace,
        });
        accumulatedProjection = mergeHostedWorkspaceInvocationProjection(
          accumulatedProjection,
          nextProjection,
          {
            replaceWake: shouldReplaceHostedWorkspaceInvocationWake(result),
          },
        );
        servicedProjectedRuntimeWakeKey =
          wakeInput.projectedWakeKeyBeingServiced !== null
            && buildHostedRuntimeWakeKey({
              nextWakeAt: accumulatedProjection.nextWakeAt,
              nextWakeReason: accumulatedProjection.nextWakeReason,
            }) === wakeInput.projectedWakeKeyBeingServiced
            ? wakeInput.projectedWakeKeyBeingServiced
            : null;
        runtimeStateDirty ||= result.runtimeStateDirty;
      };
      while (runtimeStateDirty) {
        if (accumulatedProjection.status !== "budget_exhausted") {
          if (idleCheckpointStartByMs === null) {
            throw new Error("Dirty hosted runtime is missing an idle checkpoint timer.");
          }
          const projectedRuntimeWakeKey = buildHostedRuntimeWakeKey({
            nextWakeAt: accumulatedProjection.nextWakeAt,
            nextWakeReason: accumulatedProjection.nextWakeReason,
          });
          const projectedRuntimeWakeAt =
            !accumulatedProjection.projectedWakeRequiresCheckpoint
              && projectedRuntimeWakeKey !== servicedProjectedRuntimeWakeKey
              ? accumulatedProjection.nextWakeAt
              : null;
          const dirtyWaitResult = await waitForHostedRuntimeDirtyWindow({
            idleCheckpointStartByMs,
            projectedRuntimeWakeAt,
            runtimeAbortSignal: runtimeAbortController.signal,
            runtimeWakeSignal: options.runtimeWakeSignal ?? null,
            shutdownSignal: options.shutdownSignal ?? null,
          });
          const dirtyWakeLatencySeed =
            dirtyWaitResult.kind === "external_wake"
              ? createHostedRuntimeWakeLatencySeed(dirtyWaitResult.notification)
              : null;
          if (
            dirtyWaitResult.kind === "external_wake"
            || dirtyWaitResult.kind === "projected_runtime_wake"
          ) {
            const projectedWakeKeyBeingServiced: string | null =
              dirtyWaitResult.kind === "projected_runtime_wake"
                ? projectedRuntimeWakeKey
                : servicedProjectedRuntimeWakeKey;
            await runIdleWakeForegroundPass({
              latencySeed: dirtyWakeLatencySeed,
              projectedWakeKeyBeingServiced,
              requestIdKind: "idle-wake",
            });
            continue;
          }
        }

        emitPhaseLog({
          details: {
            idleCheckpointStartByMs,
            nextWakeAtPresent: accumulatedProjection.nextWakeAt !== null,
            nextWakeReasonPresent: accumulatedProjection.nextWakeReason !== null,
          },
          input,
          phase: "checkpoint",
          requestId,
          stage: "workspace.checkpoint.idle_shutdown",
          status: "start",
        });
        const mailboxEffectsWaitResult =
          await waitForMailboxPostCheckpointEffectsBeforeIdleCheckpoint();
        if (mailboxEffectsWaitResult.kind === "external_wake") {
          await runIdleWakeForegroundPass({
            latencySeed: createHostedRuntimeWakeLatencySeed(
              mailboxEffectsWaitResult.notification,
            ),
            projectedWakeKeyBeingServiced: servicedProjectedRuntimeWakeKey,
            requestIdKind: "idle-wake",
          });
          continue;
        }
        const pendingWakeLatencySeed =
          consumePendingHostedRuntimeWake(options.runtimeWakeSignal ?? null);
        if (pendingWakeLatencySeed) {
          await runIdleWakeForegroundPass({
            latencySeed: pendingWakeLatencySeed,
            projectedWakeKeyBeingServiced: servicedProjectedRuntimeWakeKey,
            requestIdKind: "idle-wake",
          });
          continue;
        }
        const idleMaintenance = await runHostedIdleCheckpointMaintenance({
          pendingWork:
            accumulatedProjection.status === "budget_exhausted"
            || (accumulatedProjection.nextWakeAt !== null
              && Date.parse(accumulatedProjection.nextWakeAt) - Date.now()
                < HOSTED_IDLE_COMPACT_TIMEOUT_MS),
          // The compact call rides the same warm-process credential as turns,
          // so attribute it the same way: members on their own OPENAI_API_KEY
          // must not have platform allowance debited for it.
          credentialSource: resolveAssistantUsageCredentialSource({
            apiKeyEnv: null,
            effectiveEnv: runtimeEnv,
            provider: "codex-cli",
            userEnvKeys: Object.keys(guardedRuntime.userEnv),
          }),
          memberId: input.request.userId,
          model: runtimeEnv.HOSTED_ASSISTANT_MODEL ?? null,
          providerName: runtimeEnv[HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV] ?? null,
          recordUsage: guardedRuntime.platform.usageRecordPort
            ? async (record) => {
                await guardedRuntime.platform.usageRecordPort?.recordUsage(record);
              }
            : null,
          resolveAssistantSessionId: (codexThreadId) =>
            findAssistantSessionIdByCodexThreadId(restored.vaultRoot, codexThreadId),
          shutdownSignal: options.shutdownSignal ?? null,
          wakeSignal: options.runtimeWakeSignal ?? null,
        });
        emitPhaseLog({
          details: {
            idleCompactKind: idleMaintenance.kind,
            ...("reason" in idleMaintenance ? { idleCompactReason: idleMaintenance.reason } : {}),
            ...(idleMaintenance.threadContextTokensBefore !== null
              ? { idleCompactThreadTokensBefore: idleMaintenance.threadContextTokensBefore }
              : {}),
            ...(idleMaintenance.kind === "compacted"
              ? {
                  idleCompactDurationMs: idleMaintenance.durationMs,
                  idleCompactUsageCaptured: idleMaintenance.usage !== null,
                }
              : {}),
          },
          input,
          phase: "checkpoint",
          requestId,
          stage: "workspace.checkpoint.idle_compact",
          // A wake/shutdown abort is expected behavior, not an error; only
          // genuine failures (timeout, rpc_error, process_exit, exception)
          // should page through the error-level phase log.
          status:
            idleMaintenance.kind === "failed" && idleMaintenance.reason !== "aborted"
              ? "fail"
              : "done",
        });
        const idleMaintenanceWakeLatencySeed =
          consumePendingHostedRuntimeWake(options.runtimeWakeSignal ?? null);
        if (idleMaintenanceWakeLatencySeed) {
          await runIdleWakeForegroundPass({
            latencySeed: idleMaintenanceWakeLatencySeed,
            projectedWakeKeyBeingServiced: servicedProjectedRuntimeWakeKey,
            requestIdKind: "idle-wake",
          });
          continue;
        }
        let checkpoint: HostedWorkspaceCheckpointResponse;
        try {
          latestCheckpointSnapshotCleanForWarmReuse = false;
          checkpoint = await checkpointHostedRuntimeDirtyWorkspace({
            assertRuntimeNotAborted,
            checkpointRequestBuilder,
            expectedUserId: input.request.userId,
            nextWakeAt: accumulatedProjection.nextWakeAt,
            nextWakeReason: accumulatedProjection.nextWakeReason,
            issueExportPort: runtime.platform.issueExportPort ?? null,
            redactedStatus: accumulatedProjection.redactedStatus,
            runtimeAbortSignal: runtimeAbortController.signal,
            vaultRoot: restored.vaultRoot,
            workspacePort: foregroundWorkspacePort,
          });
        } catch (error) {
          if (error instanceof HostedRuntimeCheckpointInterruptedByWakeError) {
            await runIdleWakeForegroundPass({
              latencySeed: createHostedRuntimeWakeLatencySeed(error.notification),
              projectedWakeKeyBeingServiced: servicedProjectedRuntimeWakeKey,
              requestIdKind: "checkpoint-interrupt",
            });
            continue;
          }
          if (isHostedRuntimeCheckpointSupersededByWorkspaceProgress(error)) {
            await runIdleWakeForegroundPass({
              latencySeed: null,
              projectedWakeKeyBeingServiced: servicedProjectedRuntimeWakeKey,
              requestIdKind: "checkpoint-interrupt",
            });
            continue;
          }
          throw error;
        }
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
        const durableCheckpointEffectCount = pendingDurableCheckpointEffects.length;
        await runDurableCheckpointEffectsBestEffort();
        if (
          latestCheckpointSnapshotCleanForWarmReuse
          && durableCheckpointEffectCount === 0
        ) {
          await writeHostedWorkspaceCleanCheckpointMarkerBestEffort({
            vaultRoot: restored.vaultRoot,
            workspace: checkpoint.workspace,
          });
        }
        clearStagedDeviceSyncDirtyAcks();
        checkpointMetadata.expectedWorkspaceVersion = checkpoint.workspace.version;
        checkpointMetadata.nextWakeAt = checkpoint.workspace.nextWakeAt ?? null;
        checkpointMetadata.nextWakeReason = checkpoint.workspace.nextWakeReason ?? null;
        servicedProjectedRuntimeWakeKey = null;
        const checkpointWakeLatencySeed =
          consumePendingHostedRuntimeWake(options.runtimeWakeSignal ?? null);
        if (checkpointWakeLatencySeed) {
          idleWakeOrdinal += 1;
          result = await runForegroundPass({
            initialMailboxImport: null,
            initialMailboxImportContext: createHostedRuntimeWakeInitialImportContext(
              checkpointWakeLatencySeed,
            ),
            requestId: `${requestId}:checkpoint-wake:${idleWakeOrdinal}`,
            workspace: checkpoint.workspace,
          });
          pendingDurableCheckpointEffects.push(...result.afterDurableCheckpoint);
          trackMailboxPostCheckpointEffects(result);
          idleCheckpointStartByMs = result.runtimeStateDirty
            ? Date.now() + idleCheckpointDelayMs
            : null;
          const nextProjection = buildHostedWorkspaceInvocationProjection({
            mailboxBudgetExhausted: mailboxBudgetExhausted(),
            result,
            workspace: checkpoint.workspace,
          });
          accumulatedProjection = {
            ...nextProjection,
            redactedStatus: {
              ...(checkpoint.workspace.redactedStatus ?? accumulatedProjection.redactedStatus),
              ...nextProjection.redactedStatus,
            },
          };
          runtimeStateDirty = result.runtimeStateDirty;
          continue;
        }
        const browserVaultRefresh = await runBrowserVaultRefreshMaintenance({
          workspace: checkpoint.workspace,
        });
        const refreshRequestedImmediateWake =
          browserVaultRefresh.status === "deferred_runtime_wake";
        const checkpointReturnWake = selectEarliestHostedRuntimeWake([
          {
            at: checkpoint.workspace.nextWakeAt ?? null,
            reason: checkpoint.workspace.nextWakeReason ?? null,
          },
          {
            at: durableCheckpointWakeAt,
            reason: durableCheckpointWakeReason,
          },
        ]);
        const checkpointReturnWakePresent = Object.hasOwn(checkpoint.workspace, "nextWakeAt")
          || durableCheckpointWakeAt !== null;
        const checkpointDurableWakeReason = readSelectedDurableCheckpointWakeReason({
          durableWakeAt: durableCheckpointWakeAt,
          durableWakeReason: durableCheckpointWakeReason,
          selectedWakeAt: checkpointReturnWake.nextWakeAt,
          selectedWakeReason: checkpointReturnWake.nextWakeReason,
        });
        const invocationResult = {
          ...(refreshRequestedImmediateWake
            ? { nextWakeAt: new Date().toISOString() }
            : !checkpointReturnWakePresent
            ? {}
            : { nextWakeAt: checkpointReturnWake.nextWakeAt ?? null }),
          ...(!refreshRequestedImmediateWake && checkpointDurableWakeReason !== null
            ? { nextWakeReason: checkpointDurableWakeReason }
            : {}),
          redactedStatus: checkpoint.workspace.redactedStatus ?? accumulatedProjection.redactedStatus,
          status: refreshRequestedImmediateWake
            ? "scheduled" as const
            : resolveHostedWorkspaceInvocationStatus({
                mailboxBudgetExhausted: mailboxBudgetExhausted(),
                nextWakeAt: checkpointReturnWake.nextWakeAt ?? null,
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
    assertRuntimeNotAborted();
    // Replay-only mailbox consume acks are already backed by the restored
    // durable checkpoint, so they still need to flush when no new state is dirty.
    await runDurableCheckpointEffectsBestEffort();
    const projection = buildHostedWorkspaceInvocationProjection({
      mailboxBudgetExhausted: mailboxBudgetExhausted(),
      result,
      workspace: workspaceRead.workspace,
    });
    const shouldRunNoProgressBrowserVaultRefresh =
      browserVaultReplicaRefreshRequested;
    const noProgressBrowserVaultRefresh =
      shouldRunNoProgressBrowserVaultRefresh
        ? await runBrowserVaultRefreshMaintenance({
            workspace: projection.committedWorkspace ?? workspaceRead.workspace,
          })
        : null;
    const refreshRequestedImmediateWake =
      noProgressBrowserVaultRefresh?.status === "deferred_runtime_wake";
    const noProgressReturnWake = selectEarliestHostedRuntimeWake([
      {
        at: projection.nextWakeAt,
        reason: projection.nextWakeReason,
      },
      {
        at: durableCheckpointWakeAt,
        reason: durableCheckpointWakeReason,
      },
    ]);
    const noProgressDurableWakeReason = readSelectedDurableCheckpointWakeReason({
      durableWakeAt: durableCheckpointWakeAt,
      durableWakeReason: durableCheckpointWakeReason,
      selectedWakeAt: noProgressReturnWake.nextWakeAt,
      selectedWakeReason: noProgressReturnWake.nextWakeReason,
    });
    const invocationResult = {
      nextWakeAt: refreshRequestedImmediateWake
        ? new Date().toISOString()
        : noProgressReturnWake.nextWakeAt,
      ...(!refreshRequestedImmediateWake && noProgressDurableWakeReason !== null
        ? { nextWakeReason: noProgressDurableWakeReason }
        : {}),
      redactedStatus: projection.redactedStatus,
      status: refreshRequestedImmediateWake
        ? "scheduled" as const
        : resolveHostedWorkspaceInvocationStatus({
            mailboxBudgetExhausted: mailboxBudgetExhausted(),
            nextWakeAt: noProgressReturnWake.nextWakeAt,
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
  } finally {
    hostAbortSignal?.removeEventListener("abort", abortFromHost);
  }
}

type HostedRuntimePhaseLogStatus = "done" | "fail" | "start";

const HOSTED_RUNTIME_PHASE_NAMES = [
  "browser_vault.refresh",
  "cli.bridge",
  "codex.prepare",
  "foreground.pass",
  "inbox.sidecar",
  "mailbox.import.initial",
  "runtime",
  "runtime.return",
  "workspace.checkpoint.durable_effect",
  "workspace.checkpoint.idle_compact",
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
  const diagnostics = buildHostedExecutionSafeErrorDiagnostics(error);

  return {
    failureDetailsPresent: hasHostedRuntimePhaseOwnProperty(error, "details"),
    ...(typeof diagnostics?.errorCode === "string"
      ? { failureErrorCode: diagnostics.errorCode }
      : {}),
    ...(typeof diagnostics?.errorName === "string"
      ? { failureErrorName: diagnostics.errorName }
      : {}),
    failureErrorDetailPresent: typeof diagnostics?.errorDetail === "string",
    ...(typeof diagnostics?.errorStatus === "number"
      ? { failureErrorStatus: diagnostics.errorStatus }
      : {}),
    failureMessagePresent: error instanceof Error && error.message.trim().length > 0,
    failureName: readHostedExecutionSafeErrorName(error) ?? null,
  };
}

function buildHostedBrowserVaultRefreshLogDetails(
  refresh: HostedBrowserVaultReplicaRefreshResult,
): HostedExecutionStructuredLogDetails {
  return {
    ...("byteLength" in refresh
      ? { browserVaultReplicaByteLength: refresh.byteLength }
      : {}),
    ...("freshness" in refresh
      ? {
          browserVaultReplicaFreshness: refresh.freshness.freshness,
          browserVaultReplicaFreshnessReason: refresh.freshness.reason,
          browserVaultReplicaRefreshPending: refresh.freshness.shouldRefresh,
        }
      : {}),
    ...("maxBytes" in refresh
      ? { browserVaultReplicaMaxBytes: refresh.maxBytes }
      : {}),
    ...("source" in refresh
      ? {
          browserVaultReplicaSourceFileCount: refresh.source.fileCount,
          browserVaultReplicaSourceTotalBytes: refresh.source.totalBytes,
        }
      : {}),
    browserVaultRefreshStatus: refresh.status,
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
const HOSTED_RUNTIME_MAX_TIMER_DELAY_MS = 2_147_483_647;

type HostedRuntimeDirtyWaitResult =
  | { kind: "external_wake"; notification: RuntimeWakeNotification }
  | { kind: "idle_checkpoint" }
  | { kind: "projected_runtime_wake" };

type HostedRuntimeMailboxEffectsWaitResult =
  | { kind: "external_wake"; notification: RuntimeWakeNotification }
  | { kind: "finished" };

function consumePendingHostedRuntimeWake(
  runtimeWakeSignal: RuntimeWakeSignal | null,
): HostedRuntimeWakeLatencySeed | null {
  return createHostedRuntimeWakeLatencySeed(
    runtimeWakeSignal?.consumePending() ?? null,
  );
}

interface HostedWorkspaceInvocationProjection {
  committedWorkspace: HostedWorkspaceState | null;
  nextWakeAt: string | null;
  nextWakeReason: string | null;
  projectedWakeRequiresCheckpoint: boolean;
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
  const mailboxImportRetryAt = input.result.mailboxRetryAt
    ?? effectiveMailboxImport.importResult.nextRetryAt
    ?? null;
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
    projectedWakeRequiresCheckpoint: input.result.projectedWakeRequiresCheckpoint,
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
  options: {
    replaceWake?: boolean;
  } = {},
): HostedWorkspaceInvocationProjection {
  const selectedWake = options.replaceWake
    ? {
        nextWakeAt: next.nextWakeAt,
        nextWakeReason: next.nextWakeReason,
      }
    : selectEarliestHostedRuntimeWake([
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
    projectedWakeRequiresCheckpoint: previous.projectedWakeRequiresCheckpoint
      || next.projectedWakeRequiresCheckpoint,
    redactedStatus: {
      ...previous.redactedStatus,
      ...next.redactedStatus,
    },
    status: options.replaceWake
      ? next.status
      : mergeHostedWorkspaceInvocationStatus(previous.status, next.status),
  };
}

function projectHostedWorkspaceWakeForForegroundPass(input: {
  projection: Pick<HostedWorkspaceInvocationProjection, "nextWakeAt" | "nextWakeReason">;
  workspace: HostedWorkspaceState | null;
}): HostedWorkspaceState | null {
  if (!input.workspace) {
    return null;
  }

  if (
    input.workspace.nextWakeAt === input.projection.nextWakeAt
    && input.workspace.nextWakeReason === input.projection.nextWakeReason
  ) {
    return input.workspace;
  }

  return {
    ...input.workspace,
    nextWakeAt: input.projection.nextWakeAt,
    nextWakeReason: input.projection.nextWakeReason,
  };
}

function shouldReplaceHostedWorkspaceInvocationWake(
  result: HostedWorkspaceRunnerResult,
): boolean {
  return Boolean(
    result.assistantPhaseResult
      && result.assistantPhaseResult.progressed === true
      && Object.hasOwn(result.assistantPhaseResult, "nextWakeAt"),
  );
}

function mergeHostedDeviceSyncStagedDirtyAckRecords(
  records: readonly HostedDeviceSyncDirtyProcessedPostCheckpointRecord[],
): HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] {
  const byConnection = new Map<string, {
    connectionId: string;
    processedDirtyPayloadIds: Set<string>;
    processedRevision: bigint;
  }>();

  for (const record of records) {
    const previous = byConnection.get(record.connectionId);
    const processedRevision = BigInt(record.processedRevision);
    const entry = previous ?? {
      connectionId: record.connectionId,
      processedDirtyPayloadIds: new Set<string>(),
      processedRevision,
    };
    if (processedRevision > entry.processedRevision) {
      entry.processedRevision = processedRevision;
    }
    for (const payloadId of record.processedDirtyPayloadIds ?? []) {
      entry.processedDirtyPayloadIds.add(payloadId);
    }
    byConnection.set(record.connectionId, entry);
  }

  return [...byConnection.values()].map((entry) => ({
    connectionId: entry.connectionId,
    ...(entry.processedDirtyPayloadIds.size > 0
      ? { processedDirtyPayloadIds: [...entry.processedDirtyPayloadIds] }
      : {}),
    processedRevision: entry.processedRevision.toString(),
  }));
}

function countHostedDeviceSyncStagedDirtyAckPayloadIds(
  records: readonly HostedDeviceSyncDirtyProcessedPostCheckpointRecord[],
): number {
  return records.reduce(
    (count, record) => count + (record.processedDirtyPayloadIds?.length ?? 0),
    0,
  );
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

function buildHostedRuntimeWakeKey(input: {
  nextWakeAt: string | null;
  nextWakeReason: string | null;
}): string | null {
  if (input.nextWakeAt === null) {
    return null;
  }

  return JSON.stringify([input.nextWakeAt, input.nextWakeReason]);
}

async function waitForHostedRuntimeDirtyWindow(input: {
  idleCheckpointStartByMs: number;
  projectedRuntimeWakeAt: string | null;
  runtimeAbortSignal: AbortSignal;
  runtimeWakeSignal: RuntimeWakeSignal | null;
  shutdownSignal: AbortSignal | null;
}): Promise<HostedRuntimeDirtyWaitResult> {
  const nowMs = Date.now();
  if (input.shutdownSignal?.aborted === true) {
    return { kind: "idle_checkpoint" };
  }
  if (input.idleCheckpointStartByMs <= nowMs) {
    return { kind: "idle_checkpoint" };
  }

  const idleCheckpointDelayMs = Math.max(0, input.idleCheckpointStartByMs - nowMs);
  const projectedWakeDelayMs = resolveHostedProjectedRuntimeWakeDelayMs(
    input.projectedRuntimeWakeAt,
    nowMs,
  );
  let timeoutDelayMs = idleCheckpointDelayMs;
  let timeoutResult: HostedRuntimeDirtyWaitResult = { kind: "idle_checkpoint" };
  if (projectedWakeDelayMs !== null && projectedWakeDelayMs < timeoutDelayMs) {
    timeoutDelayMs = projectedWakeDelayMs;
    timeoutResult = { kind: "projected_runtime_wake" };
  }
  timeoutDelayMs = Math.min(timeoutDelayMs, HOSTED_RUNTIME_MAX_TIMER_DELAY_MS);
  if (timeoutDelayMs <= 0) {
    return timeoutResult;
  }

  return await new Promise<HostedRuntimeDirtyWaitResult>((resolve, reject) => {
    if (input.runtimeAbortSignal.aborted) {
      reject(readHostedRuntimeAbortReason(input.runtimeAbortSignal));
      return;
    }

    let settled = false;
    const wakeAbortController = new AbortController();
    const timer = setTimeout(() => {
      settle(() => resolve(timeoutResult));
    }, timeoutDelayMs);
    const abort = () => {
      settle(() => reject(readHostedRuntimeAbortReason(input.runtimeAbortSignal)));
    };
    const shutdown = () => {
      settle(() => resolve({ kind: "idle_checkpoint" }));
    };
    const cleanup = () => {
      clearTimeout(timer);
      input.runtimeAbortSignal.removeEventListener("abort", abort);
      input.shutdownSignal?.removeEventListener("abort", shutdown);
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
    input.shutdownSignal?.addEventListener("abort", shutdown, { once: true });
    input.runtimeWakeSignal?.wait(wakeAbortController.signal).then(
      (notification) => settle(() => resolve({ kind: "external_wake", notification })),
      (error) => {
        if (settled && wakeAbortController.signal.aborted) {
          return;
        }
        settle(() => reject(error));
      },
    );
  });
}

function resolveHostedProjectedRuntimeWakeDelayMs(
  nextWakeAt: string | null,
  nowMs: number,
): number | null {
  if (nextWakeAt === null) {
    return null;
  }

  const wakeMs = Date.parse(nextWakeAt);
  if (!Number.isFinite(wakeMs)) {
    return null;
  }

  return Math.max(0, wakeMs - nowMs);
}

async function checkpointHostedRuntimeDirtyWorkspace(input: {
  assertRuntimeNotAborted: () => void;
  checkpointRequestBuilder: ReturnType<typeof createHostedWorkspaceSnapshotCheckpointRequestBuilder>;
  expectedUserId: string;
  issueExportPort?: HostedRuntimePlatform["issueExportPort"] | null;
  nextWakeAt: string | null;
  nextWakeReason: string | null;
  runtimeAbortSignal: AbortSignal;
  onCheckpointValidated?: (checkpoint: HostedWorkspaceCheckpointResponse) => Promise<void> | void;
  redactedStatus: HostedWorkspaceInvocationResult["redactedStatus"] | null;
  vaultRoot: string;
  workspacePort: HostedRuntimePlatform["workspacePort"];
}): Promise<HostedWorkspaceCheckpointResponse> {
  if (!input.workspacePort) {
    throw new TypeError("Hosted runtime dirty workspace checkpoint requires workspace port support.");
  }

  input.assertRuntimeNotAborted();
  const checkpointInput = {
    nextWakeAt: input.nextWakeAt,
    nextWakeReason: input.nextWakeReason,
    reason: "idle_shutdown" as const,
    redactedStatus: input.redactedStatus ?? null,
  };
  input.assertRuntimeNotAborted();
  const checkpoint = input.checkpointRequestBuilder.checkpoint
    ? await raceHostedRuntimeCancellation(
      Promise.resolve(input.checkpointRequestBuilder.checkpoint(
        checkpointInput,
        input.workspacePort,
      )),
      input.runtimeAbortSignal,
    )
    : await raceHostedRuntimeCancellation(
      Promise.resolve(input.checkpointRequestBuilder.createRequest(checkpointInput))
        .then((checkpointRequest) => input.workspacePort!.checkpoint(checkpointRequest)),
      input.runtimeAbortSignal,
    );
  input.assertRuntimeNotAborted();
  assertIdleShutdownCheckpointAccepted(checkpoint, input.expectedUserId);
  await input.onCheckpointValidated?.(checkpoint);
  await flushAndExportHostedRuntimeIssuesAfterCheckpointBestEffort({
    issueExportPort: input.issueExportPort ?? null,
    runtimeAbortSignal: input.runtimeAbortSignal,
    vaultRoot: input.vaultRoot,
  });
  return checkpoint;
}

async function flushAndExportHostedRuntimeIssuesAfterCheckpointBestEffort(input: {
  issueExportPort: HostedRuntimePlatform["issueExportPort"] | null;
  runtimeAbortSignal: AbortSignal;
  vaultRoot: string;
}): Promise<void> {
  const work = async () => {
    await flushPendingAssistantRuntimeIssueWrites();
    if (!input.issueExportPort) {
      return;
    }
    await exportHostedPendingAssistantRuntimeIssues({
      issueExportPort: input.issueExportPort,
      vaultRoot: input.vaultRoot,
    });
  };

  await withHostedRuntimeTimeout(
    raceHostedRuntimeCancellation(work(), input.runtimeAbortSignal),
    HOSTED_RUNTIME_ISSUE_POST_CHECKPOINT_EXPORT_TIMEOUT_MS,
    "Timed out exporting hosted assistant runtime issues after idle checkpoint.",
  ).catch((error) => {
    console.warn(
      `Failed to export hosted assistant runtime issues after idle checkpoint: ${summarizeHostedExecutionError(error)}`,
    );
  });
}

async function withHostedRuntimeTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
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
            fetchSnapshot: (snapshotInput) =>
              guard(() => platform.deviceSyncPort!.fetchSnapshot(snapshotInput)),
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
      ...(platform.effectsPort.downloadTelegramFile
        ? {
            downloadTelegramFile: (downloadInput, context) =>
              guard(() => platform.effectsPort.downloadTelegramFile!(downloadInput, context)),
          }
        : {}),
      ...(platform.effectsPort.getTelegramFile
        ? {
            getTelegramFile: (getInput, context) =>
              guard(() => platform.effectsPort.getTelegramFile!(getInput, context)),
          }
        : {}),
      ...(platform.effectsPort.readAssistantDeliveryRecord
        ? {
            readAssistantDeliveryRecord: (readInput) =>
              guard(() => platform.effectsPort.readAssistantDeliveryRecord!(readInput)),
          }
        : {}),
      readRawEmailMessage: (rawMessageKey) =>
        guard(() => platform.effectsPort.readRawEmailMessage(rawMessageKey)),
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
    ...(platform.latencyTracePort
      ? {
          latencyTracePort: {
            record: (request) => guard(() => platform.latencyTracePort!.record(request)),
          },
        }
      : {}),
    ...(platform.mailboxPort
      ? {
          mailboxPort: {
            // Spread so optional port methods survive this wrapper; the
            // consumed-watermark ack silently vanished here when consume was
            // added to the port but not to this enumeration (2026-06 prod
            // consume_port_missing incident). Reads stay unguarded because
            // they are replay-safe; consume is a durable write and takes the
            // abort guard like every other write port.
            ...platform.mailboxPort,
            fetch: (request) => platform.mailboxPort!.fetch(request),
            fetchPayload: (request) => platform.mailboxPort!.fetchPayload(request),
            ...(platform.mailboxPort.consume
              ? {
                  consume: (request) =>
                    guard(() => platform.mailboxPort!.consume!(request)),
                }
              : {}),
          },
        }
      : {}),
    ...(platform.publicInternetFetch
      ? {
          publicInternetFetch: (async (request, init) =>
            guard(() => platform.publicInternetFetch!(request, init))) as typeof fetch,
        }
      : {}),
    ...(platform.providerFetch
      ? {
          providerFetch: (async (request, init) =>
            guard(() => platform.providerFetch!(request, init))) as typeof fetch,
        }
      : {}),
    ...(platform.generatedImageUploader
      ? {
          generatedImageUploader: {
            uploadGeneratedImage: (request) =>
              guard(() => platform.generatedImageUploader!.uploadGeneratedImage(request)),
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
    ...(platform.vaultSharePort
      ? {
          vaultSharePort: {
            deliver: (deliverInput) =>
              guard(() => platform.vaultSharePort!.deliver(deliverInput)),
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

function createHostedWorkspaceMailboxImportBudget(
  maxMailboxItems: number | null | undefined,
): {
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
          reasonCode: HOSTED_MAILBOX_ITEM_BUDGET_REASON_CODE,
          status: "deferred",
        };
      }

      importAttempts += 1;
      return importItem(item, context);
    },
  };
}

function shouldCheckpointHostedReplayBudgetProgressBeforeForeground(input: {
  mailboxBudgetExhausted: boolean;
  result: HostedMailboxImportCheckpointResult;
}): boolean {
  if (
    !input.mailboxBudgetExhausted
    || !input.result.checkpointDeferred
    || !input.result.stateChanged
  ) {
    return false;
  }
  if (
    (input.result.importResult.assistantInputIds?.length ?? 0) > 0
    || (input.result.importResult.conversationImportedCount ?? 0) > 0
  ) {
    return false;
  }

  const previousConversationSeq = parseHostedMailboxSeqOrNull(
    input.result.previousState.watermarks.conversation,
  );
  const nextConversationSeq = parseHostedMailboxSeqOrNull(
    input.result.state.watermarks.conversation,
  );
  const consumedConversationSeq = parseHostedMailboxSeqOrNull(
    input.result.importResult.consumedSeqByLane.conversation,
  );

  return previousConversationSeq !== null
    && nextConversationSeq !== null
    && consumedConversationSeq !== null
    && nextConversationSeq > previousConversationSeq
    && nextConversationSeq <= consumedConversationSeq;
}

function parseHostedMailboxSeqOrNull(value: string | null | undefined): bigint | null {
  return value !== undefined
    && value !== null
    && /^(?:0|[1-9][0-9]*)$/u.test(value)
    ? BigInt(value)
    : null;
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

async function resolveHostedForegroundCurrentDeliveryRoute(input: {
  initialMailboxImport: HostedWorkspaceRunnerInput["initialMailboxImport"] | undefined;
  vaultRoot: string;
}): Promise<AssistantCurrentDeliveryRoute | null> {
  const assistantInputIds = input.initialMailboxImport?.importResult.assistantInputIds ?? [];
  const routes: AssistantCurrentDeliveryRoute[] = [];
  for (const inputId of assistantInputIds) {
    if (!inputId) {
      continue;
    }
    try {
      const event = await readAssistantInputEvent({
        inputId,
        vault: input.vaultRoot,
      });
      const route = readHostedAssistantInputCurrentDeliveryRoute({
        conversation: event?.conversation ?? null,
        replyTarget: event?.replyTarget ?? null,
      });
      if (route) {
        routes.push(route);
      }
    } catch {
      return null;
    }
  }

  return resolveUnambiguousCurrentDeliveryRoute(routes);
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
        reason: input.assistantPhaseResult.nextWakeAt
          ? input.assistantPhaseResult.nextWakeReason ?? "assistant"
          : null,
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
  const selected = selectHostedRuntimeWakeCandidate(candidates);

  return {
    nextWakeAt: selected.at,
    nextWakeReason: selected.reason,
  };
}

function readHostedWorkspaceDurableCheckpointEffectWake(
  result: HostedWorkspaceDurableCheckpointEffectResult | null | void,
): {
  nextWakeAt: string | null;
  nextWakeReason: string | null;
} {
  if (!result?.nextWakeAt) {
    return {
      nextWakeAt: null,
      nextWakeReason: null,
    };
  }

  return {
    nextWakeAt: result.nextWakeAt,
    nextWakeReason: result.nextWakeReason ?? null,
  };
}

function readSelectedDurableCheckpointWakeReason(input: {
  durableWakeAt: string | null;
  durableWakeReason: string | null;
  selectedWakeAt: string | null;
  selectedWakeReason: string | null;
}): string | null {
  if (
    input.durableWakeAt === null
    || input.durableWakeReason === null
    || input.selectedWakeAt !== input.durableWakeAt
    || input.selectedWakeReason !== input.durableWakeReason
  ) {
    return null;
  }

  return input.durableWakeReason;
}
