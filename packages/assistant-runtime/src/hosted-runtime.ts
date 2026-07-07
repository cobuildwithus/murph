import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_PHASE_KEYS,
  type HostedRuntimeLatencyPhaseBreakdown,
  type HostedRuntimeOrchestrationLatencyDiagnostics,
  type HostedRuntimeLatencyTraceMilestone,
  type HostedRuntimeLatencyTraceStagedMilestones,
  type HostedWorkspaceCheckpointResponse,
  type HostedWorkspaceInvocationResult,
  type HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  detectVaultMetadataFormatVersion,
  VAULT_LAYOUT,
} from "@murphai/contracts";
import {
  CURRENT_VAULT_FORMAT_VERSION,
  runIntegrationIngestMigration,
  VaultError,
} from "@murphai/core";
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
  HOSTED_CODEX_OPERATOR_MEMORY_DIAGNOSTICS,
  HOSTED_CODEX_PROVIDER_TRANSPORT_DIAGNOSTICS,
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
  type HostedIdleMaintenanceOutcome,
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
  HostedAssistantWorkspaceRuntimeJobResult,
  HostedAssistantWorkspaceRuntimeJobInput,
  HostedDeviceSyncDirtyProcessedPostCheckpointRecord,
  HostedWorkspaceArtifactMaterializer,
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
  type HostedWorkspaceRunnerDeferredUsageCapture,
  type HostedWorkspaceRunnerHandledDeviceSyncWake,
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
  collectHostedPendingAssistantInputMediaRetentionProtections,
} from "./hosted-runtime/pending-input-index.ts";
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
  HOSTED_ASSISTANT_WAKE_REASON,
  HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
  selectHostedRuntimeWakeCandidate,
} from "./hosted-runtime/wake-candidates.ts";
import {
  consumePendingRuntimeWakeUnlessShuttingDown,
} from "./hosted-runtime/runtime-wake.ts";
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
const HOSTED_VAULT_FORMAT_MIGRATION_MAX_BUNDLES = 500;

interface HostedInitialMailboxImportPlan {
  bootstrapRequired: boolean;
  lanes: readonly ("conversation" | "system")[];
}

interface HostedInitialMailboxImportResult {
  bootstrapPending: boolean;
  result: HostedMailboxImportCheckpointResult;
}

interface HostedVaultFormatMigrationRuntimeResult {
  mutated: boolean;
}

function resolveHostedInitialMailboxImportPlan(input: {
  vaultRoot: string;
}): HostedInitialMailboxImportPlan {
  if (hasHostedVaultMetadata(input.vaultRoot)) {
    return {
      bootstrapRequired: false,
      lanes: HOSTED_INITIAL_CONVERSATION_MAILBOX_IMPORT_LANES,
    };
  }

  return {
    bootstrapRequired: true,
    lanes: HOSTED_INITIAL_BOOTSTRAP_MAILBOX_IMPORT_LANES,
  };
}

function hasHostedVaultMetadata(vaultRoot: string): boolean {
  return existsSync(path.join(vaultRoot, VAULT_LAYOUT.metadata));
}

async function ensureHostedVaultFormatCurrentForRuntime(input: {
  assertRuntimeNotAborted: () => void;
  vaultRoot: string;
}): Promise<HostedVaultFormatMigrationRuntimeResult> {
  const { assertRuntimeNotAborted, vaultRoot } = input;
  if (!hasHostedVaultMetadata(vaultRoot)) {
    return { mutated: false };
  }

  if (await readHostedVaultStoredFormatVersion(vaultRoot) === CURRENT_VAULT_FORMAT_VERSION) {
    return { mutated: false };
  }

  let mutated = false;
  while (true) {
    assertRuntimeNotAborted();
    const result = await runIntegrationIngestMigration({
      vaultRoot,
      apply: true,
      maxBundles: HOSTED_VAULT_FORMAT_MIGRATION_MAX_BUNDLES,
    });
    assertRuntimeNotAborted();
    mutated ||= result.mutated;
    if (result.storedFormatVersion === CURRENT_VAULT_FORMAT_VERSION) {
      return { mutated };
    }
    if (result.blockerCount > 0) {
      throw new VaultError(
        "HOSTED_VAULT_FORMAT_MIGRATION_BLOCKED",
        "Hosted vault format migration is blocked; repair the legacy integration ingest data before serving the workspace.",
        { blockersByCode: result.blockersByCode },
      );
    }
    if (!result.mutated) {
      throw new VaultError(
        "HOSTED_VAULT_FORMAT_MIGRATION_STALLED",
        "Hosted vault format migration made no progress before the workspace could be served.",
        { hasMore: result.hasMore, storedFormatVersion: result.storedFormatVersion },
      );
    }
  }
}

async function readHostedVaultStoredFormatVersion(vaultRoot: string): Promise<number> {
  const rawMetadata = JSON.parse(
    await readFile(path.join(vaultRoot, VAULT_LAYOUT.metadata), "utf8"),
  ) as unknown;
  const result = detectVaultMetadataFormatVersion(rawMetadata, {
    relativePath: VAULT_LAYOUT.metadata,
  });
  if (!result.success) {
    throw new VaultError(result.error.code, result.error.message, result.error.details);
  }
  return result.storedFormatVersion;
}

async function importHostedInitialMailboxForWorkspaceRunner(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestBuilder;
  importItemContext?: HostedWorkspaceRunnerMailboxImportContext | null;
  runnerInput: HostedWorkspaceRunnerInput;
  requestId: string;
}): Promise<HostedInitialMailboxImportResult> {
  const plan = resolveHostedInitialMailboxImportPlan({
    vaultRoot: input.runnerInput.vaultRoot,
  });
  const result = await importHostedMailboxForWorkspaceRunner({
    checkpointRequestBuilder: input.checkpointRequestBuilder,
    checkpointReason: "import",
    deferCheckpoint: true,
    input: input.runnerInput,
    importItemContext: input.importItemContext ?? null,
    deferConversationUntil: plan.bootstrapRequired
      ? {
          ready: () => hasHostedVaultMetadata(input.runnerInput.vaultRoot),
          reasonCode: HOSTED_INITIAL_BOOTSTRAP_PENDING_REASON_CODE,
        }
      : null,
    lanes: plan.lanes,
    requestId: input.requestId,
  });

  return {
    bootstrapPending: isHostedInitialBootstrapPending({
      bootstrapRequired: plan.bootstrapRequired,
      result,
      vaultRoot: input.runnerInput.vaultRoot,
    }),
    result,
  };
}

function isHostedInitialBootstrapPending(input: {
  bootstrapRequired: boolean;
  result: HostedMailboxImportCheckpointResult;
  vaultRoot: string;
}): boolean {
  return input.bootstrapRequired
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
  onConversationInputStaged?: (() => void) | null;
  recordMessagingReturnTarget?(
    target: HostedRuntimeDeviceSyncMessagingReturnTarget | null,
  ): void;
  latencyMilestones?: HostedRuntimeLatencyTraceStagedMilestones | null;
  runtimeAttemptId?: string | null;
  signal?: AbortSignal | null;
}

interface HostedRuntimeWakeLatencySeed {
  foregroundWaitResolvedAtEpochMs?: number;
  orchestration?: HostedRuntimeOrchestrationLatencyDiagnostics | null;
  runtimeWakeNotifiedAtEpochMs?: number | null;
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

function readHostedRuntimeInvocationOrchestrationLatencyDiagnostics(
  milestones: HostedRuntimeLatencyTraceStagedMilestones | null | undefined,
): HostedRuntimeOrchestrationLatencyDiagnostics | null {
  const orchestration = milestones?.phaseBreakdown?.orchestration;
  return orchestration && Object.keys(orchestration).length > 0
    ? { ...orchestration }
    : null;
}

function withoutHostedRuntimeInvocationOrchestrationLatencyDiagnostics(
  milestones: HostedRuntimeLatencyTraceStagedMilestones | null | undefined,
): HostedRuntimeLatencyTraceStagedMilestones | null {
  if (!milestones?.phaseBreakdown?.orchestration) {
    return milestones ?? null;
  }

  const { orchestration: _orchestration, ...phaseBreakdown } = milestones.phaseBreakdown;
  const nextMilestones: HostedRuntimeLatencyTraceStagedMilestones = { ...milestones };
  const hasRemainingPhase = Boolean(
    phaseBreakdown.dispatch
      || phaseBreakdown.restore
      || phaseBreakdown.boot
      || phaseBreakdown.wake
      || phaseBreakdown.import
      || phaseBreakdown.provider,
  );
  if (hasRemainingPhase) {
    nextMilestones.phaseBreakdown = phaseBreakdown;
  } else {
    delete nextMilestones.phaseBreakdown;
  }
  return nextMilestones;
}

function createHostedRuntimeWakeLatencySeed(
  notification: RuntimeWakeNotification | null | undefined,
): HostedRuntimeWakeLatencySeed | null {
  if (!notification) {
    return null;
  }

  return {
    foregroundWaitResolvedAtEpochMs: Date.now(),
    ...(notification.orchestration ? { orchestration: notification.orchestration } : {}),
    runtimeWakeNotifiedAtEpochMs: notification.notifiedAtEpochMs,
  };
}

function createHostedRuntimeOrchestrationLatencySeed(
  orchestration: HostedRuntimeOrchestrationLatencyDiagnostics | null | undefined,
): HostedRuntimeWakeLatencySeed | null {
  return orchestration ? { orchestration } : null;
}

function mergeHostedRuntimeWakeLatencySeeds(
  base: HostedRuntimeWakeLatencySeed | null | undefined,
  extra: HostedRuntimeWakeLatencySeed | null | undefined,
): HostedRuntimeWakeLatencySeed | null {
  if (!base && !extra) {
    return null;
  }

  const orchestration = {
    ...(base?.orchestration ?? {}),
    ...(extra?.orchestration ?? {}),
  };
  return {
    ...(base ?? {}),
    ...(extra ?? {}),
    ...(Object.keys(orchestration).length > 0 ? { orchestration } : {}),
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
        ...(seed.orchestration ? { orchestration: seed.orchestration } : {}),
        ...(seed.foregroundWaitResolvedAtEpochMs === undefined
          ? {}
          : {
              wake: {
                ...(seed.runtimeWakeNotifiedAtEpochMs === null
                  || seed.runtimeWakeNotifiedAtEpochMs === undefined
                  ? {}
                  : { runtimeWakeNotifiedAtEpochMs: seed.runtimeWakeNotifiedAtEpochMs }),
                foregroundWaitResolvedAtEpochMs: seed.foregroundWaitResolvedAtEpochMs,
              },
            }),
      },
    },
  };
}

function hostedMailboxImportHasForegroundConversationWork(
  result: HostedMailboxImportCheckpointResult | null | undefined,
): boolean {
  return (
    (result?.importResult.assistantInputIds?.length ?? 0) > 0
    || (result?.importResult.conversationImportedCount ?? 0) > 0
    || result?.importResult.blocked.some((item) =>
      item.retryable && item.lane === "conversation"
    ) === true
  );
}

function hostedMailboxImportHasAssistantInputWork(
  result: HostedMailboxImportCheckpointResult | null | undefined,
): boolean {
  return (result?.importResult.assistantInputIds?.length ?? 0) > 0;
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
  let hostAbortReason: unknown = null;
  let hostAbortObserved = false;
  const abortFromHost = () => {
    if (!hostAbortSignal || runtimeAbortController.signal.aborted) {
      return;
    }
    hostAbortReason = readHostedRuntimeAbortReason(hostAbortSignal);
    hostAbortObserved = true;
    runtimeAbortController.abort(hostAbortReason);
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
  const pendingDeferredUsageCaptures = new Set<HostedWorkspaceRunnerDeferredUsageCapture>();
  const pendingMailboxPostCheckpointEffectCompletions = new Set<Promise<void>>();
  const trackCompletion = (
    pendingCompletions: Set<Promise<void>>,
    completion: Promise<void> | null,
  ): void => {
    if (completion === null) {
      return;
    }

    pendingCompletions.add(completion);
    void completion.finally(() => {
      pendingCompletions.delete(completion);
    });
  };
  const trackDeferredUsageCapture = (
    capture: HostedWorkspaceRunnerDeferredUsageCapture,
  ): void => {
    pendingDeferredUsageCaptures.add(capture);
    void capture.completion.finally(() => {
      pendingDeferredUsageCaptures.delete(capture);
    });
    trackHostedRuntimeDeferredUsageCapture(capture);
  };
  const trackMailboxPostCheckpointEffects = (completion: Promise<void> | null): void => {
    trackCompletion(pendingMailboxPostCheckpointEffectCompletions, completion);
  };
  const drainDeferredUsageBestEffort = async (): Promise<void> => {
    await Promise.allSettled(
      [...pendingDeferredUsageCaptures].map((capture) => capture.completion),
    );
  };

  try {
    const runtimePhaseStartedAt = new Date().toISOString();
    const invocationOrchestrationLatencySeed = createHostedRuntimeOrchestrationLatencySeed(
      readHostedRuntimeInvocationOrchestrationLatencyDiagnostics(options.latencyMilestones),
    );
    const baseLatencyMilestones =
      withoutHostedRuntimeInvocationOrchestrationLatencyDiagnostics(options.latencyMilestones);
    const initialAssistantInputLatencyMilestones: HostedRuntimeLatencyTraceStagedMilestones = {
      ...(baseLatencyMilestones ?? {}),
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
    const mailboxBudgetExhausted = () => mailboxBudget.exhausted;
    let hostedCliBridgeMessagingReturnTarget: HostedRuntimeDeviceSyncMessagingReturnTarget | null =
      null;
    const createMailboxImportContext = (
      context: HostedWorkspaceRunnerMailboxImportContext | undefined,
    ): HostedWorkspaceRuntimeJobImportContext => ({
      recordMessagingReturnTarget: (target) => {
        hostedCliBridgeMessagingReturnTarget = target;
      },
      latencyMilestones: mergeHostedRuntimeLatencyTraceStagedMilestones(
        initialAssistantInputLatencyMilestones,
        context?.latencyMilestones ?? null,
      ),
      onConversationInputStaged: context?.onConversationInputStaged ?? null,
      runtimeAttemptId: input.request.attemptId,
      signal: context?.signal ?? runtimeAbortController.signal,
    });
    const importMailboxItem: HostedWorkspaceRunnerInput["importItem"] = (item, context) =>
      mailboxBudget.importItem(
        item,
        async (importItem, context) => {
          assertRuntimeNotAborted();
          const outcome = await options.importItem(importItem, context);
          assertRuntimeNotAborted();
          return outcome;
        },
        createMailboxImportContext(context),
      );
    const importForegroundMailboxItem: HostedWorkspaceRunnerInput["importItem"] = async (
      item,
      context,
    ) => {
      assertRuntimeNotAborted();
      const outcome = await options.importItem(item, createMailboxImportContext(context));
      assertRuntimeNotAborted();
      return outcome;
    };
    emitPhaseLog({
      input,
      requestId,
      stage: "workspace.restore",
      status: "start",
    });
    const restored = await restoreHostedWorkspaceRuntimeJobWorkspace({
      logContext: runtimeLogContext,
      platform: guardedRuntime.platform,
      signal: runtimeAbortController.signal,
      vaultRoot: options.vaultRoot,
      workspace: workspaceRead.workspace,
    });
    assertRuntimeNotAborted();
    const workspaceRestoreDoneAt = new Date().toISOString();
    initialAssistantInputLatencyMilestones.workspaceRestoreDoneAt = workspaceRestoreDoneAt;
    // Attach the in-memory cold-start phase breakdown to the SAME staged-milestone
    // object already passed to the assistant_input_staged event. No new request,
    // await, or I/O: restore timings were returned in-memory by the restore call,
    // and the boot.nodeStartupMs (if any) rode in via options.latencyMilestones.
    initialAssistantInputLatencyMilestones.phaseBreakdown =
      mergeHostedRuntimeLatencyPhaseBreakdown(
        initialAssistantInputLatencyMilestones.phaseBreakdown ?? null,
        {
          schemaVersion: 1,
          ...(restored.restoreTiming ? { restore: restored.restoreTiming } : {}),
          boot: {
            restoreWasCold: restored.restoreWasCold,
          },
        },
      ) ?? {
        schemaVersion: 1,
        boot: {
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
    const hostedVaultFormatMigration = await ensureHostedVaultFormatCurrentForRuntime({
      assertRuntimeNotAborted,
      vaultRoot: restored.vaultRoot,
    });
    assertRuntimeNotAborted();

    const runnerMailboxPort = guardedMailboxPort ?? mailboxPort;
    if (!runnerMailboxPort) {
      throw new TypeError("Hosted workspace runtime job mailbox port must be injected.");
    }
    const checkpointMetadata = {
      attemptId: input.request.attemptId,
      expectedWorkspaceVersion: workspaceRead.workspace?.version ?? input.request.workspaceVersion,
      inboxMediaRetentionWakeAt: workspaceRead.workspace?.inboxMediaRetentionWakeAt ?? null,
      leaseGeneration: input.request.leaseGeneration,
      nextWakeAt: workspaceRead.workspace?.nextWakeAt ?? null,
      nextWakeReason: workspaceRead.workspace?.nextWakeReason ?? null,
    };
    const checkpointRequestBuilder = createHostedWorkspaceSnapshotCheckpointRequestBuilder({
      createSnapshot: createAbortGuardedCheckpointSnapshot,
      metadata: checkpointMetadata,
    });
    const foregroundWorkspacePort = guardedWorkspacePort;
    if (input.request.processingMode === "inbox_media_retention") {
      return await runHostedInboxMediaRetentionOnlyCheckpoint({
        assertRuntimeNotAborted,
        checkpointRequestBuilder,
        expectedUserId: input.request.userId,
        input,
        issueExportPort: runtime.platform.issueExportPort ?? null,
        materializeWorkspaceArtifacts: restored.materializeWorkspaceArtifacts,
        runtimeAbortSignal: runtimeAbortController.signal,
        shutdownSignal: options.shutdownSignal ?? null,
        vaultRoot: restored.vaultRoot,
        wakeSignal: options.runtimeWakeSignal ?? null,
        workspace: workspaceRead.workspace,
        workspacePort: foregroundWorkspacePort,
      });
    }
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
      importItem: importMailboxItem,
      limitPerLane: mailboxBudget.fetchLimitPerLane,
      materializeWorkspaceArtifacts: restored.materializeWorkspaceArtifacts,
      trackDeferredUsageCapture,
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
        voiceMemoElevenLabsApiKeyConfigured:
          hasHostedRuntimeEnvValue(baseRuntimeEnv, "ELEVENLABS_API_KEY"),
        voiceMemoElevenLabsModelConfigured:
          hasHostedRuntimeEnvValue(baseRuntimeEnv, "MURPH_ELEVENLABS_MODEL_ID"),
        voiceMemoElevenLabsVoiceConfigured:
          hasHostedRuntimeEnvValue(baseRuntimeEnv, "MURPH_ELEVENLABS_VOICE_ID"),
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
        codexEffectiveModelProviderId:
          hostedCodexRuntime.runtimeEnv[HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV] ?? null,
        ...HOSTED_CODEX_OPERATOR_MEMORY_DIAGNOSTICS,
        ...HOSTED_CODEX_PROVIDER_TRANSPORT_DIAGNOSTICS,
        runtimeEnvKeyCount: Object.keys(hostedCodexRuntime.runtimeEnv).length,
        voiceMemoElevenLabsApiKeyConfigured:
          hasHostedRuntimeEnvValue(hostedCodexRuntime.runtimeEnv, "ELEVENLABS_API_KEY"),
        voiceMemoElevenLabsModelConfigured:
          hasHostedRuntimeEnvValue(hostedCodexRuntime.runtimeEnv, "MURPH_ELEVENLABS_MODEL_ID"),
        voiceMemoElevenLabsVoiceConfigured:
          hasHostedRuntimeEnvValue(hostedCodexRuntime.runtimeEnv, "MURPH_ELEVENLABS_VOICE_ID"),
      },
      input,
      requestId,
      stage: "codex.prepare",
      status: "done",
    });
    assertRuntimeNotAborted();
    const initialMailboxImportPlan = resolveHostedInitialMailboxImportPlan({
      vaultRoot: restored.vaultRoot,
    });
    const initialMailboxImportContext = createHostedRuntimeWakeInitialImportContext(
      mergeHostedRuntimeWakeLatencySeeds(
        invocationOrchestrationLatencySeed,
        consumePendingHostedRuntimeWake(
          options.runtimeWakeSignal ?? null,
          options.shutdownSignal ?? null,
        ),
      ),
    );
    emitPhaseLog({
      details: {
        initialMailboxImportLanes: [...initialMailboxImportPlan.lanes],
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
      const returnedNextWake = selectEarliestHostedRuntimeWake([
        {
          at: nextWake.nextWakeAt,
          reason: nextWake.nextWakeReason,
        },
        {
          at: workspaceRead.workspace?.inboxMediaRetentionWakeAt ?? null,
          reason: workspaceRead.workspace?.inboxMediaRetentionWakeAt
            ? "inbox_media_retention"
            : null,
        },
      ]);
      const initialMailboxImportRequiresCheckpoint = initialMailboxImport.checkpointDeferred
        && initialMailboxImport.stateChanged;
      const hostedVaultFormatMigrationRequiresCheckpoint = hostedVaultFormatMigration.mutated;

      if (initialMailboxImportRequiresCheckpoint || hostedVaultFormatMigrationRequiresCheckpoint) {
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
          inboxMediaRetentionWakeAt: workspaceRead.workspace?.inboxMediaRetentionWakeAt ?? null,
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
        const checkpointReturnedNextWake = selectEarliestHostedRuntimeWake([
          {
            at: checkpoint.workspace.nextWakeAt ?? null,
            reason: checkpoint.workspace.nextWakeReason ?? null,
          },
          {
            at: checkpoint.workspace.inboxMediaRetentionWakeAt ?? null,
            reason: checkpoint.workspace.inboxMediaRetentionWakeAt
              ? "inbox_media_retention"
              : null,
          },
        ]);
        const invocationResult = {
          nextWakeAt: checkpointReturnedNextWake.nextWakeAt,
          redactedStatus: checkpoint.workspace.redactedStatus ?? redactedStatus,
          status: resolveHostedWorkspaceInvocationStatus({
            mailboxBudgetExhausted: mailboxBudgetExhausted(),
            nextWakeAt: checkpointReturnedNextWake.nextWakeAt,
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
        nextWakeAt: returnedNextWake.nextWakeAt,
        redactedStatus,
        status: resolveHostedWorkspaceInvocationStatus({
          mailboxBudgetExhausted: mailboxBudgetExhausted(),
          nextWakeAt: returnedNextWake.nextWakeAt,
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
    let deviceSyncWorkspaceWakeHandledUntilCheckpoint: HostedWorkspaceRunnerHandledDeviceSyncWake | null = null;
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
      deviceSyncWorkspaceWakeHandledUntilCheckpoint = null;
    };
    let browserVaultReplicaRefreshRequested = false;
    const recordBrowserVaultReplicaRefreshIntent = (
      passResult: HostedWorkspaceRunnerResult,
    ): void => {
      browserVaultReplicaRefreshRequested ||=
        passResult.assistantPhaseResult?.browserVaultReplicaRefreshRequested === true;
    };
    let runtimePassOrdinal = 0;
    const runWorkspaceForegroundPass = async (passInput: {
      initialMailboxImport?: HostedWorkspaceRunnerInput["initialMailboxImport"];
      initialMailboxImportContext?: HostedWorkspaceRunnerMailboxImportContext | null;
      requestId: string;
      workspace: HostedWorkspaceState | null;
    }): Promise<HostedWorkspaceRunnerResult> => {
      const passOrdinal = runtimePassOrdinal + 1;
      runtimePassOrdinal = passOrdinal;
      const passStartedAtEpochMs = Date.now();
      const passForeground = hostedMailboxImportHasForegroundConversationWork(
        passInput.initialMailboxImport ?? null,
      );
      emitPhaseLog({
        details: {
          initialMailboxImportProvided: passInput.initialMailboxImport !== undefined,
          passForeground,
          passOrdinal,
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
                runtimePassDiagnostics: {
                  foreground: passForeground,
                  ordinal: passOrdinal,
                  startedAtEpochMs: passStartedAtEpochMs,
                },
                runAssistantPhase: async (phaseInput) => {
                  currentDeliveryRoute = await resolveHostedForegroundCurrentDeliveryRoute({
                    initialMailboxImport: phaseInput.initialMailboxImport,
                    vaultRoot: restored.vaultRoot,
                  });
                  return await (options.runAssistantPhase ?? runHostedWorkspaceAssistantPhase)({
                    ...phaseInput,
                    deviceSyncWorkspaceWakeHandled: deviceSyncWorkspaceWakeHandledUntilCheckpoint,
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
        trackMailboxPostCheckpointEffects(passResult.mailboxPostCheckpointEffectsFinished);
        emitPhaseLog({
          details: {
            assistantProgressed: passResult.assistantPhaseResult?.progressed === true,
            latestWorkspacePresent: passResult.latestWorkspace !== null,
            latestWorkspaceVersion: passResult.latestWorkspace?.version ?? null,
            passForeground,
            passOrdinal,
            passRequestId: passInput.requestId,
            runtimeStateDirty: passResult.runtimeStateDirty,
          },
          input,
          requestId,
          stage: "foreground.pass",
          status: "done",
        });
        stageDeviceSyncDirtyAcks(passResult.assistantPhaseResult?.stagedDirtyAcks);
        deviceSyncWorkspaceWakeHandledUntilCheckpoint =
          resolveHandledDeviceSyncWorkspaceWake({
            current: deviceSyncWorkspaceWakeHandledUntilCheckpoint,
            result: passResult,
            workspace: passInput.workspace,
          });
        recordBrowserVaultReplicaRefreshIntent(passResult);
        return passResult;
      } catch (error) {
        emitPhaseLog({
          details: {
            passForeground,
            passOrdinal,
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
    let committedWorkspace = workspaceRead.workspace;
    let pendingWake: HostedRuntimePendingWake = {
      nextWakeAt: committedWorkspace?.nextWakeAt ?? null,
      nextWakeReason: committedWorkspace?.nextWakeReason ?? null,
    };
    // irreducible: "checkpoint-gated due projected wakes wait for the idle delay before service" fails without this.
    let pendingWakeAfterDueAssistantService: HostedRuntimeHeldDurableWake | null = null;
    let redactedStatus: NonNullable<HostedWorkspaceInvocationResult["redactedStatus"]> = {};
    let invocationStatus: HostedWorkspaceInvocationResult["status"] =
      resolveHostedWorkspaceInvocationStatus({
        mailboxBudgetExhausted: mailboxBudgetExhausted(),
        nextWakeAt: pendingWake.nextWakeAt,
      });
    let runtimeStateDirty = false;
    const pendingDurableCheckpointEffects: HostedWorkspaceDurableCheckpointEffect[] = [];
    let idleCheckpointStartByMs: number | null = null;
    let idleWakeOrdinal = 0;
    const markIdleCheckpointTimerAfterDirtyWork = () => {
      idleCheckpointStartByMs = Date.now() + idleCheckpointDelayMs;
    };
    const runDurableCheckpointEffectsBestEffort = async (): Promise<{
      requiresFollowUpCheckpoint: boolean;
      wake: HostedRuntimePendingWake;
    }> => {
      const effects = pendingDurableCheckpointEffects.splice(0);
      let requiresFollowUpCheckpoint = false;
      let durableWake: HostedRuntimePendingWake = {
        nextWakeAt: null,
        nextWakeReason: null,
      };
      for (const effect of effects) {
        try {
          const effectResult = await effect();
          requiresFollowUpCheckpoint ||= effectResult?.requiresFollowUpCheckpoint === true;
          const effectWake = readHostedWorkspaceDurableCheckpointEffectWake(effectResult);
          if (effectWake.nextWakeAt) {
            requiresFollowUpCheckpoint = true;
            const selectedWake = selectEarliestHostedRuntimeWake([
              {
                at: durableWake.nextWakeAt,
                reason: durableWake.nextWakeReason,
              },
              {
                at: effectWake.nextWakeAt,
                reason: effectWake.nextWakeReason,
              },
            ]);
            durableWake = selectedWake;
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
      return { requiresFollowUpCheckpoint, wake: durableWake };
    };
    const waitForMailboxPostCheckpointEffects = async (): Promise<
      HostedRuntimeMailboxPostCheckpointEffectWaitResult
    > => {
      const pendingCompletions = pendingMailboxPostCheckpointEffectCompletions;
      while (pendingCompletions.size > 0) {
        const effectsFinished = Promise.all([
          ...pendingCompletions,
        ]);
        const runtimeWakeSignal =
          options.shutdownSignal?.aborted === true
            ? null
            : options.runtimeWakeSignal ?? null;
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
        const abortWakeAfterShutdown = () => {
          wakeAbortController.abort(
            options.shutdownSignal?.reason instanceof Error
              ? options.shutdownSignal.reason
              : new Error("Hosted runtime wake wait skipped after shutdown."),
          );
        };
        runtimeAbortController.signal.addEventListener("abort", abortWake, { once: true });
        options.shutdownSignal?.addEventListener("abort", abortWakeAfterShutdown, { once: true });
        let waitResult: HostedRuntimeMailboxPostCheckpointEffectWaitResult;
        let wake: Promise<HostedRuntimeMailboxPostCheckpointEffectWaitResult> =
          Promise.resolve({ kind: "finished" });
        try {
          wake = runtimeWakeSignal.wait(wakeAbortController.signal)
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
          waitResult = await Promise.race([
            effectsFinished.then(() => ({ kind: "finished" as const })),
            wake,
          ]);
        } finally {
          runtimeAbortController.signal.removeEventListener("abort", abortWake);
          options.shutdownSignal?.removeEventListener("abort", abortWakeAfterShutdown);
          if (!wakeAbortController.signal.aborted) {
            wakeAbortController.abort();
          }
        }
        if (waitResult.kind === "external_wake") {
          return waitResult;
        }
        const deliveredWakeResult = await wake;
        if (deliveredWakeResult.kind === "external_wake") {
          return deliveredWakeResult;
        }
        const pendingWake = consumePendingRuntimeWakeUnlessShuttingDown({
          runtimeWakeSignal,
          shutdownSignal: options.shutdownSignal ?? null,
        });
        if (pendingWake) {
          return {
            kind: "external_wake",
            notification: pendingWake,
          };
        }
      }
      return { kind: "finished" };
    };
    const rebaseCommittedWorkspace = (workspace: HostedWorkspaceState): void => {
      committedWorkspace = workspace;
      pendingWake = {
        nextWakeAt: workspace.nextWakeAt ?? null,
        nextWakeReason: workspace.nextWakeReason ?? null,
      };
      redactedStatus = workspace.redactedStatus ?? redactedStatus;
      invocationStatus = resolveHostedWorkspaceInvocationStatus({
        mailboxBudgetExhausted: mailboxBudgetExhausted(),
        nextWakeAt: pendingWake.nextWakeAt,
      });
    };
    const stageDurableCheckpointFollowUp = (
      workspace: HostedWorkspaceState | null,
      durableWake: HostedRuntimePendingWake,
    ): void => {
      if (workspace) {
        rebaseCommittedWorkspace(workspace);
      }
      const durableWakeFollowsDueAssistant =
        durableWake.nextWakeAt !== null
        && pendingWake.nextWakeAt !== null
        && hostedRuntimeWakeReasonIsAssistant(pendingWake.nextWakeReason)
        && hostedRuntimeWakeIsDue(pendingWake.nextWakeAt)
        && Date.parse(durableWake.nextWakeAt) > Date.parse(pendingWake.nextWakeAt);
      const followUpCheckpointWake = selectEarliestHostedRuntimeWake([
        {
          at: pendingWake.nextWakeAt,
          reason: pendingWake.nextWakeReason,
        },
        {
          at: durableWake.nextWakeAt,
          reason: durableWake.nextWakeReason,
        },
      ]);
      pendingWake = {
        nextWakeAt: followUpCheckpointWake.nextWakeAt,
        nextWakeReason: followUpCheckpointWake.nextWakeReason,
      };
      pendingWakeAfterDueAssistantService = durableWakeFollowsDueAssistant
        ? {
            dueAssistantWake: copyHostedRuntimePendingWake(pendingWake),
            durableWake: copyHostedRuntimePendingWake(durableWake),
          }
        : null;
      runtimeStateDirty = true;
      idleCheckpointStartByMs ??= Date.now();
    };
    const reconcilePendingWakeAfterDueAssistantPass = (input: {
      preservedDueAssistantWakeOnNoProgress: boolean;
    }): void => {
      const heldWake = pendingWakeAfterDueAssistantService;
      if (heldWake === null) {
        return;
      }
      if (input.preservedDueAssistantWakeOnNoProgress) {
        pendingWake = copyHostedRuntimePendingWake(heldWake.durableWake);
        pendingWakeAfterDueAssistantService = null;
        runtimeStateDirty = true;
        idleCheckpointStartByMs ??= Date.now();
        return;
      }
      if (hostedRuntimePendingWakeMatches(pendingWake, heldWake.dueAssistantWake)) {
        return;
      }

      const reconciledWake = selectEarliestHostedRuntimeWake([
        {
          at: pendingWake.nextWakeAt,
          reason: pendingWake.nextWakeReason,
        },
        {
          at: heldWake.durableWake.nextWakeAt,
          reason: heldWake.durableWake.nextWakeReason,
        },
      ]);
      const wakeChanged = !hostedRuntimePendingWakeMatches(pendingWake, reconciledWake);
      pendingWake = reconciledWake;
      pendingWakeAfterDueAssistantService = null;
      if (wakeChanged) {
        runtimeStateDirty = true;
        idleCheckpointStartByMs ??= Date.now();
      }
    };
    const drainCleanDurableCheckpointEffects = async (): Promise<boolean> => {
      if (runtimeStateDirty || pendingDurableCheckpointEffects.length === 0) {
        return false;
      }
      assertRuntimeNotAborted();
      const durableCheckpointEffects = await runDurableCheckpointEffectsBestEffort();
      if (!durableCheckpointEffects.requiresFollowUpCheckpoint) {
        return false;
      }
      stageDurableCheckpointFollowUp(committedWorkspace, durableCheckpointEffects.wake);
      return true;
    };
      const logHostedVaultShareProjectionOfferOutcome = (
        vaultShareOffer: Awaited<ReturnType<typeof offerHostedVaultShareProjectionBestEffort>>,
      ): void => {
        if (vaultShareOffer.outcome !== "error") {
          return;
        }

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
      };
      const offerHostedVaultShareProjectionDuringIdle = async (): Promise<
        HostedRuntimeWakeLatencySeed | null
      > => {
        const vaultSharePort = guardedRuntime.platform.vaultSharePort ?? null;
        if (!vaultSharePort) {
          return null;
        }

        const pendingWakeLatencySeed = consumePendingHostedRuntimeWake(
          options.runtimeWakeSignal ?? null,
          options.shutdownSignal ?? null,
        );
        if (pendingWakeLatencySeed) {
          return pendingWakeLatencySeed;
        }

        const offer = offerHostedVaultShareProjectionBestEffort({
          vaultRoot: restored.vaultRoot,
          vaultSharePort,
        });
        const runtimeWakeSignal =
          options.shutdownSignal?.aborted === true
            ? null
            : options.runtimeWakeSignal ?? null;
        if (!runtimeWakeSignal) {
          logHostedVaultShareProjectionOfferOutcome(
            await raceHostedRuntimeCancellation(offer, runtimeAbortController.signal),
          );
          return null;
        }

        type VaultShareOfferWaitResult =
          | { kind: "external_wake"; notification: RuntimeWakeNotification }
          | { kind: "finished" }
          | {
            kind: "offer";
            offer: Awaited<ReturnType<typeof offerHostedVaultShareProjectionBestEffort>>;
          };

        const wakeAbortController = new AbortController();
        const abortWake = () => {
          wakeAbortController.abort(readHostedRuntimeAbortReason(runtimeAbortController.signal));
        };
        const abortWakeAfterShutdown = () => {
          wakeAbortController.abort(
            options.shutdownSignal?.reason instanceof Error
              ? options.shutdownSignal.reason
              : new Error("Hosted vault-share projection offer skipped after shutdown."),
          );
        };
        runtimeAbortController.signal.addEventListener("abort", abortWake, { once: true });
        options.shutdownSignal?.addEventListener("abort", abortWakeAfterShutdown, { once: true });
        const offerWithAbort = raceHostedRuntimeCancellation(offer, runtimeAbortController.signal);
        let waitResult: VaultShareOfferWaitResult = { kind: "finished" };
        let wake: Promise<VaultShareOfferWaitResult> = Promise.resolve({
          kind: "finished",
        });
        try {
          wake = runtimeWakeSignal.wait(wakeAbortController.signal)
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
          waitResult = await Promise.race([
            offerWithAbort.then((vaultShareOffer) => ({
              kind: "offer" as const,
              offer: vaultShareOffer,
            })),
            wake,
          ]);
        } finally {
          runtimeAbortController.signal.removeEventListener("abort", abortWake);
          options.shutdownSignal?.removeEventListener("abort", abortWakeAfterShutdown);
          if (!wakeAbortController.signal.aborted) {
            wakeAbortController.abort();
          }
        }

        if (waitResult.kind === "external_wake") {
          void offerWithAbort.then(logHostedVaultShareProjectionOfferOutcome, () => undefined);
          return createHostedRuntimeWakeLatencySeed(waitResult.notification);
        }

        const deliveredWakeResult = await wake;
        if (deliveredWakeResult.kind === "external_wake") {
          return createHostedRuntimeWakeLatencySeed(deliveredWakeResult.notification);
        }

        if (waitResult.kind === "offer") {
          logHostedVaultShareProjectionOfferOutcome(waitResult.offer);
        }
        return consumePendingHostedRuntimeWake(
          options.runtimeWakeSignal ?? null,
          options.shutdownSignal ?? null,
        );
      };
      const overlayPendingWakeOnCommittedWorkspace = (
        checkpointPendingBeforePass: boolean,
      ): HostedWorkspaceState | null => {
        if (committedWorkspace === null) {
          return null;
        }
        let passWake = pendingWake;
        if (
          checkpointPendingBeforePass
          && hostedRuntimeWakeReasonIsAssistant(committedWorkspace.nextWakeReason ?? null)
          && hostedRuntimeWakeIsDue(committedWorkspace.nextWakeAt ?? null)
        ) {
          passWake =
            pendingWake.nextWakeAt !== null
              && hostedRuntimeWakeReasonIsAssistant(pendingWake.nextWakeReason)
              && !hostedRuntimeWakeIsDue(pendingWake.nextWakeAt)
              ? pendingWake
              : { nextWakeAt: null, nextWakeReason: null };
        } else if (checkpointPendingBeforePass) {
          passWake = {
            nextWakeAt: committedWorkspace.nextWakeAt ?? null,
            nextWakeReason: committedWorkspace.nextWakeReason ?? null,
          };
        }
        return {
          ...committedWorkspace,
          nextWakeAt: passWake.nextWakeAt,
          nextWakeReason: passWake.nextWakeReason,
        };
      };
      const absorbForegroundPassResult = (
        passResult: HostedWorkspaceRunnerResult,
        passWorkspace: HostedWorkspaceState | null,
        previousPendingWake: HostedRuntimePendingWake,
        preserveDueAssistantWakeOnNoProgress: boolean,
      ): void => {
        const checkpointPendingBeforePass = runtimeStateDirty;
        pendingDurableCheckpointEffects.push(...passResult.afterDurableCheckpoint);
        if (passResult.runtimeStateDirty) {
          markIdleCheckpointTimerAfterDirtyWork();
        }

        const committedPassWorkspace = resolveHostedWorkspaceRunnerCommittedWorkspace({
          result: passResult,
          workspace: passWorkspace,
        });
        const passWake = resolveHostedWorkspaceRunNextWake({
          assistantPhaseResult: passResult.assistantPhaseResult,
          committedWorkspace: committedPassWorkspace,
          mailboxImportRetryAt: passResult.mailboxRetryAt
            ?? passResult.latestMailboxImport.importResult.nextRetryAt
            ?? null,
          nowMs: Date.now(),
        });
        const replaceWake = shouldReplaceHostedWorkspaceInvocationWake(passResult);
        const wakeResolution = resolvePendingWakeAfterForegroundPass({
          checkpointPendingBeforePass,
          passWake,
          previousPendingWake,
          preserveDueAssistantWakeOnNoProgress,
          replaceWake,
          nowMs: Date.now(),
        });
        pendingWake = wakeResolution.pendingWake;
        reconcilePendingWakeAfterDueAssistantPass({
          preservedDueAssistantWakeOnNoProgress:
            wakeResolution.preservedDueAssistantWakeOnNoProgress,
        });
        redactedStatus = mergeHostedWorkspaceInvocationRedactedStatus(
          redactedStatus,
          buildHostedWorkspaceRunnerRedactedStatus(passResult),
        );
        const passStatus = resolveHostedWorkspaceInvocationStatus({
          mailboxBudgetExhausted: mailboxBudgetExhausted(),
          nextWakeAt: passWake.nextWakeAt,
        });
        const baseStatus = replaceWake
          ? passStatus
          : mergeHostedWorkspaceInvocationStatus(invocationStatus, passStatus);
        invocationStatus = baseStatus === "budget_exhausted"
          ? baseStatus
          : pendingWake.nextWakeAt !== null
          ? "scheduled"
          : baseStatus;
        runtimeStateDirty ||= passResult.runtimeStateDirty;
      };
      const runForegroundPass = async (wakeInput: {
        initialMailboxImport?: HostedWorkspaceRunnerInput["initialMailboxImport"];
        initialMailboxImportContext?: HostedWorkspaceRunnerMailboxImportContext | null;
        latencySeed?: HostedRuntimeWakeLatencySeed | null;
        preserveDueAssistantWakeOnNoProgress?: boolean;
        requestIdKind: "checkpoint-interrupt" | "checkpoint-wake" | "idle-wake";
      }): Promise<HostedWorkspaceRunnerResult> => {
        const runSingleForegroundPass = async (
          singleWakeInput: typeof wakeInput,
        ): Promise<HostedWorkspaceRunnerResult> => {
          idleWakeOrdinal += 1;
          const previousPendingWake = pendingWake;
          const checkpointPendingBeforePass = runtimeStateDirty;
          const passWorkspace = overlayPendingWakeOnCommittedWorkspace(
            checkpointPendingBeforePass,
          );
          result = await runWorkspaceForegroundPass({
            initialMailboxImport: singleWakeInput.initialMailboxImport ?? null,
            initialMailboxImportContext: singleWakeInput.initialMailboxImportContext
              ?? createHostedRuntimeWakeInitialImportContext(singleWakeInput.latencySeed ?? null),
            requestId: `${requestId}:${singleWakeInput.requestIdKind}:${idleWakeOrdinal}`,
            workspace: passWorkspace,
          });
          absorbForegroundPassResult(
            result,
            passWorkspace,
            previousPendingWake,
            singleWakeInput.preserveDueAssistantWakeOnNoProgress === true,
          );
          return result;
        };

        let passResult = await runSingleForegroundPass(wakeInput);
        // irreducible: "late foreground input during system work runs before idle checkpointing" fails without this.
        while (
          !mailboxBudgetExhausted()
          && passResult.latestMailboxImport !== passResult.initialMailboxImport
          && hostedMailboxImportHasAssistantInputWork(
            passResult.latestMailboxImport,
          )
          && (
            passResult.assistantPhaseResult?.checkpointReason !== "assistant_runtime_commit"
            || passResult.assistantPhaseResult?.deviceSyncMaintenanceRan === true
          )
        ) {
          passResult = await runSingleForegroundPass({
            initialMailboxImport: passResult.latestMailboxImport,
            initialMailboxImportContext: null,
            latencySeed: wakeInput.latencySeed ?? null,
            requestIdKind: "checkpoint-interrupt",
          });
        }
        return passResult;
      };
      const importThenRunForegroundPassIfWork = async (input: {
        importItem?: HostedWorkspaceRunnerInput["importItem"];
        lanes: readonly ("conversation" | "system")[];
        latencySeed: HostedRuntimeWakeLatencySeed | null;
        limitPerLane?: number;
        requestIdKind: "checkpoint-interrupt" | "checkpoint-wake" | "idle-wake";
        requestIdLane?: "conversation" | "system";
        shouldRun(initialMailboxImport: HostedMailboxImportCheckpointResult): boolean;
      }): Promise<boolean> => {
        const initialMailboxImportContext = createHostedRuntimeWakeInitialImportContext(
          input.latencySeed,
        );
        const initialMailboxImport = await importHostedMailboxForWorkspaceRunner({
          checkpointRequestBuilder,
          checkpointReason: "active_turn_input",
          deferCheckpoint: true,
          importItem: input.importItem ?? importForegroundMailboxItem,
          importItemContext: initialMailboxImportContext,
          input: baseRunnerInput,
          lanes: input.lanes,
          limitPerLane: input.limitPerLane ?? mailboxBudget.fetchLimitPerLane,
          requestId:
            `${requestId}:${input.requestIdKind}-foreground-import:${idleWakeOrdinal + 1}${
              input.requestIdLane ? `:${input.requestIdLane}` : ""
            }`,
          signal: runtimeAbortController.signal,
        });
        if (!input.shouldRun(initialMailboxImport)) {
          return false;
        }
        await runForegroundPass({
          initialMailboxImport,
          initialMailboxImportContext,
          latencySeed: input.latencySeed,
          requestIdKind: input.requestIdKind,
        });
        return true;
      };
      const runPreCheckpointConversationWake = async (
        latencySeed: HostedRuntimeWakeLatencySeed | null,
      ): Promise<boolean> =>
        await importThenRunForegroundPassIfWork({
          lanes: HOSTED_INITIAL_CONVERSATION_MAILBOX_IMPORT_LANES,
          latencySeed,
          requestIdKind: "checkpoint-interrupt",
          shouldRun: (initialMailboxImport) =>
            hostedMailboxImportHasForegroundConversationWork(initialMailboxImport)
            || (
              pendingWake.nextWakeAt !== null
              && hostedRuntimeWakeReasonIsAssistant(pendingWake.nextWakeReason)
              && !hostedRuntimeWakeIsDue(pendingWake.nextWakeAt)
              && !(
                hostedRuntimeWakeReasonIsAssistant(committedWorkspace?.nextWakeReason ?? null)
                && hostedRuntimeWakeIsDue(committedWorkspace?.nextWakeAt ?? null)
              )
            ),
        });
      const runPostCheckpointMailboxWake = async (
        latencySeed: HostedRuntimeWakeLatencySeed | null,
      ): Promise<boolean> => {
        const conversationWakeHandled = await importThenRunForegroundPassIfWork({
          lanes: HOSTED_INITIAL_CONVERSATION_MAILBOX_IMPORT_LANES,
          latencySeed,
          requestIdKind: "checkpoint-wake",
          requestIdLane: "conversation",
          shouldRun: (initialMailboxImport) =>
            hostedMailboxImportHasForegroundConversationWork(initialMailboxImport),
        });
        if (conversationWakeHandled) {
          return true;
        }

        return await importThenRunForegroundPassIfWork({
          importItem: importMailboxItem,
          lanes: ["system"],
          latencySeed,
          limitPerLane: mailboxBudget.fetchLimitPerLane,
          requestIdKind: "checkpoint-wake",
          requestIdLane: "system",
          shouldRun: (initialMailboxImport) =>
            initialMailboxImport.importResult.importedCount > 0
            || initialMailboxImport.importResult.blocked.some((item) => item.retryable),
        });
      };

      result = await runForegroundPass({
        initialMailboxImport,
        initialMailboxImportContext,
        latencySeed: null,
        requestIdKind: "idle-wake",
      });
      const committedInboxMediaRetentionWakeDue = isHostedInboxMediaRetentionWakeDue({
        nowMs: Date.now(),
        workspace: committedWorkspace,
      });
      const runtimeDirtyAfterForeground = result.runtimeStateDirty
        || hostedVaultFormatMigration.mutated;
      runtimeStateDirty ||= runtimeDirtyAfterForeground || committedInboxMediaRetentionWakeDue;
      if (runtimeDirtyAfterForeground) {
        markIdleCheckpointTimerAfterDirtyWork();
      } else if (committedInboxMediaRetentionWakeDue) {
        idleCheckpointStartByMs = Date.now();
      }
      if (!runtimeStateDirty) {
        const vaultShareOfferWakeLatencySeed =
          await offerHostedVaultShareProjectionDuringIdle();
        if (vaultShareOfferWakeLatencySeed) {
          await runForegroundPass({
            latencySeed: vaultShareOfferWakeLatencySeed,
            requestIdKind: "idle-wake",
          });
        }
      }
      if (!runtimeStateDirty) {
        // Replay-only mailbox consume acks are already backed by the restored
        // durable checkpoint. If the ack fails and returns a retry wake, route
        // that wake through the same follow-up checkpoint path as dirty turns.
        await drainCleanDurableCheckpointEffects();
      }
      let pendingCheckpointWakeLatencySeed: HostedRuntimeWakeLatencySeed | null = null;
      while (runtimeStateDirty) {
        let checkpointWakeLatencySeed = pendingCheckpointWakeLatencySeed;
        pendingCheckpointWakeLatencySeed = null;
        if (idleCheckpointStartByMs === null) {
          throw new Error("Dirty hosted runtime is missing an idle checkpoint timer.");
        }
        const queuedWakeLatencySeed = consumePendingHostedRuntimeWake(
          options.runtimeWakeSignal ?? null,
          options.shutdownSignal ?? null,
        );
        if (queuedWakeLatencySeed) {
          if (await runPreCheckpointConversationWake(queuedWakeLatencySeed)) {
            continue;
          }
          checkpointWakeLatencySeed = queuedWakeLatencySeed;
        }
        const dirtyWaitResult = await waitForHostedRuntimeDirtyWindow({
          idleCheckpointStartByMs,
          runtimeAbortSignal: runtimeAbortController.signal,
          runtimeWakeSignal: options.runtimeWakeSignal ?? null,
          shutdownSignal: options.shutdownSignal ?? null,
        });
        if (dirtyWaitResult.kind === "external_wake") {
          const latencySeed = createHostedRuntimeWakeLatencySeed(
            dirtyWaitResult.notification,
          );
          if (await runPreCheckpointConversationWake(latencySeed)) {
            continue;
          }
          checkpointWakeLatencySeed = latencySeed;
        }
        const idleCheckpointPhaseLogDetails =
          buildHostedRuntimeIdleCheckpointPhaseLogDetails({
            checkpointWakeLatencySeed,
            dirtyWaitResult,
            idleCheckpointStartByMs,
            pendingWake,
            shutdownSignal: options.shutdownSignal ?? null,
          });

        emitPhaseLog({
          details: idleCheckpointPhaseLogDetails,
          input,
          phase: "checkpoint",
          requestId,
          stage: "workspace.checkpoint.idle_shutdown",
          status: "start",
        });
        let idleCheckpointWake: {
          inboxMediaRetentionWakeAt: string | null;
          nextWakeAt: string | null;
          nextWakeReason: string | null;
        };
        const mailboxEffectsWaitResult =
          await waitForMailboxPostCheckpointEffects();
        if (mailboxEffectsWaitResult.kind === "external_wake") {
          const latencySeed = createHostedRuntimeWakeLatencySeed(
            mailboxEffectsWaitResult.notification,
          );
          if (await runPreCheckpointConversationWake(latencySeed)) {
            continue;
          }
          pendingCheckpointWakeLatencySeed ??= latencySeed;
          continue;
        }
        const pendingWakeLatencySeed =
          consumePendingHostedRuntimeWake(
            options.runtimeWakeSignal ?? null,
            options.shutdownSignal ?? null,
          );
        if (pendingWakeLatencySeed) {
          if (await runPreCheckpointConversationWake(pendingWakeLatencySeed)) {
            continue;
          }
          checkpointWakeLatencySeed ??= pendingWakeLatencySeed;
        }
        const idleMaintenancePendingWork =
          invocationStatus === "budget_exhausted"
          || (pendingWake.nextWakeAt !== null
            && Date.parse(pendingWake.nextWakeAt) - Date.now()
              < HOSTED_IDLE_COMPACT_TIMEOUT_MS);
        const idleMaintenance = await runHostedPendingInputProtectedIdleMaintenance({
          // The compact call rides the same warm-process credential as turns,
          // so attribute it the same way: members using their own provider key
          // must not have platform allowance debited for it.
          credentialSource: resolveAssistantUsageCredentialSource({
            apiKeyEnv: null,
            effectiveEnv: runtimeEnv,
            provider: "codex-cli",
            userEnvKeys: Object.keys(guardedRuntime.userEnv),
          }),
          materializeWorkspaceArtifacts: restored.materializeWorkspaceArtifacts,
          memberId: input.request.userId,
          model: runtimeEnv.HOSTED_ASSISTANT_MODEL ?? null,
          pendingWork: idleMaintenancePendingWork,
          providerName: runtimeEnv[HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV] ?? null,
          recordUsage: guardedRuntime.platform.usageRecordPort
            ? async (record) => {
                await guardedRuntime.platform.usageRecordPort?.recordUsage(record);
              }
            : null,
          resolveAssistantSessionId: (codexThreadId) =>
            findAssistantSessionIdByCodexThreadId(restored.vaultRoot, codexThreadId),
          shutdownSignal: options.shutdownSignal ?? null,
          vaultRoot: restored.vaultRoot,
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
          consumePendingHostedRuntimeWake(
            options.runtimeWakeSignal ?? null,
            options.shutdownSignal ?? null,
          );
        if (idleMaintenanceWakeLatencySeed) {
          if (await runPreCheckpointConversationWake(idleMaintenanceWakeLatencySeed)) {
            continue;
          }
          checkpointWakeLatencySeed ??= idleMaintenanceWakeLatencySeed;
        }
        idleCheckpointWake = selectHostedIdleCheckpointWake({
          idleMaintenance,
          previousInboxMediaRetentionWakeAt:
            committedWorkspace?.inboxMediaRetentionWakeAt ?? null,
          projectedWakeAt: pendingWake.nextWakeAt,
          projectedWakeReason: pendingWake.nextWakeReason,
        });
        let checkpoint: HostedWorkspaceCheckpointResponse;
        try {
          latestCheckpointSnapshotCleanForWarmReuse = false;
          checkpoint = await checkpointHostedRuntimeDirtyWorkspace({
            assertRuntimeNotAborted,
            checkpointRequestBuilder,
            expectedUserId: input.request.userId,
            idleCheckpointTrigger: idleCheckpointPhaseLogDetails.idleCheckpointTrigger,
            nextWakeAt: idleCheckpointWake.nextWakeAt,
            nextWakeReason: idleCheckpointWake.nextWakeReason,
            inboxMediaRetentionWakeAt: idleCheckpointWake.inboxMediaRetentionWakeAt,
            issueExportPort: runtime.platform.issueExportPort ?? null,
            redactedStatus,
            runtimeAbortSignal: runtimeAbortController.signal,
            vaultRoot: restored.vaultRoot,
            workspacePort: foregroundWorkspacePort,
          });
        } catch (error) {
          if (error instanceof HostedRuntimeCheckpointInterruptedByWakeError) {
            const latencySeed = createHostedRuntimeWakeLatencySeed(error.notification);
            if (!(await runPreCheckpointConversationWake(latencySeed))) {
              pendingCheckpointWakeLatencySeed ??= latencySeed;
            }
            continue;
          }
          if (isHostedRuntimeCheckpointSupersededByWorkspaceProgress(error)) {
            await runForegroundPass({
              latencySeed: null,
              requestIdKind: "checkpoint-interrupt",
            });
            continue;
          }
          throw error;
        }
        emitPhaseLog({
          details: {
            ...idleCheckpointPhaseLogDetails,
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
        const durableCheckpointEffects = await runDurableCheckpointEffectsBestEffort();
        rebaseCommittedWorkspace(checkpoint.workspace);
        runtimeStateDirty = false;
        idleCheckpointStartByMs = null;
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
        // checkpointMetadata is mirrored from the committed workspace inside
        // createHostedWorkspaceSnapshotCheckpointRequestBuilder.recordCheckpoint;
        // re-mutating it here would be a duplicate state owner and is the seam
        // that previously let inboxMediaRetentionWakeAt drift.
        if (durableCheckpointEffects.requiresFollowUpCheckpoint) {
          stageDurableCheckpointFollowUp(checkpoint.workspace, durableCheckpointEffects.wake);
          continue;
        }
        checkpointWakeLatencySeed ??= consumePendingHostedRuntimeWake(
          options.runtimeWakeSignal ?? null,
          options.shutdownSignal ?? null,
        );
        if (checkpointWakeLatencySeed) {
          if (
            await runPostCheckpointMailboxWake(checkpointWakeLatencySeed)
            && (runtimeStateDirty || await drainCleanDurableCheckpointEffects())
          ) {
            continue;
          }
        }
        if (
          invocationStatus !== "budget_exhausted"
          && hostedRuntimeWakeReasonIsAssistant(committedWorkspace?.nextWakeReason ?? null)
          && hostedRuntimeWakeIsDue(committedWorkspace?.nextWakeAt ?? null)
        ) {
          await runForegroundPass({
            latencySeed: null,
            preserveDueAssistantWakeOnNoProgress: true,
            requestIdKind: "checkpoint-wake",
          });
          if (runtimeStateDirty || await drainCleanDurableCheckpointEffects()) {
            continue;
          }
        }
        const vaultShareOfferWakeLatencySeed =
          await offerHostedVaultShareProjectionDuringIdle();
        if (vaultShareOfferWakeLatencySeed) {
          await runForegroundPass({
            latencySeed: vaultShareOfferWakeLatencySeed,
            requestIdKind: "idle-wake",
          });
          if (runtimeStateDirty || await drainCleanDurableCheckpointEffects()) {
            continue;
          }
        }
        const browserVaultRefresh = await runBrowserVaultRefreshMaintenance({
          workspace: committedWorkspace,
        });
        const refreshRequestedImmediateWake =
          browserVaultRefresh.status === "deferred_runtime_wake";
        const checkpointReturnWake = selectEarliestHostedRuntimeWake([
          {
            at: pendingWake.nextWakeAt,
            reason: pendingWake.nextWakeReason,
          },
          {
            at: committedWorkspace?.inboxMediaRetentionWakeAt ?? null,
            reason: committedWorkspace?.inboxMediaRetentionWakeAt
              ? "inbox_media_retention"
              : null,
          },
        ]);
        const checkpointReturnWakePresent = Object.hasOwn(committedWorkspace ?? {}, "nextWakeAt")
          || pendingWake.nextWakeAt !== null
          || committedWorkspace?.inboxMediaRetentionWakeAt !== null;
        const invocationResult = {
          ...(refreshRequestedImmediateWake
            ? { nextWakeAt: new Date().toISOString() }
            : !checkpointReturnWakePresent
            ? {}
            : { nextWakeAt: checkpointReturnWake.nextWakeAt ?? null }),
          redactedStatus,
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
    // Mailbox post-checkpoint effects are backed by the restored durable
    // checkpoint, so they still need to flush when no new state is dirty.
    await runDurableCheckpointEffectsBestEffort();
    const shouldRunNoProgressBrowserVaultRefresh =
      browserVaultReplicaRefreshRequested;
    const noProgressBrowserVaultRefresh =
      shouldRunNoProgressBrowserVaultRefresh
        ? await runBrowserVaultRefreshMaintenance({
            workspace: committedWorkspace,
          })
        : null;
    const refreshRequestedImmediateWake =
      noProgressBrowserVaultRefresh?.status === "deferred_runtime_wake";
    const noProgressReturnWake = selectEarliestHostedRuntimeWake([
      {
        at: pendingWake.nextWakeAt,
        reason: pendingWake.nextWakeReason,
      },
      {
        at: committedWorkspace?.inboxMediaRetentionWakeAt ?? null,
        reason: committedWorkspace?.inboxMediaRetentionWakeAt ? "inbox_media_retention" : null,
      },
    ]);
    const invocationResult = {
      nextWakeAt: refreshRequestedImmediateWake
        ? new Date().toISOString()
        : noProgressReturnWake.nextWakeAt,
      redactedStatus,
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
    if (!hostAbortObserved || error !== hostAbortReason) {
      await drainDeferredUsageBestEffort();
    }
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

// Single owner for the protections + materializer + retention wiring used by
// both the normal idle path and the retention-only checkpoint. Routing every
// idle retention pass through this helper makes the pending-input protection
// contract a structural invariant: a new retention call site cannot omit it
// without changing this signature.
export async function runHostedPendingInputProtectedIdleMaintenance(input: {
  credentialSource: Parameters<typeof runHostedIdleCheckpointMaintenance>[0]["credentialSource"];
  materializeWorkspaceArtifacts: HostedWorkspaceArtifactMaterializer;
  memberId: string;
  model: string | null;
  pendingWork: boolean;
  providerName: string | null;
  recordUsage: Parameters<typeof runHostedIdleCheckpointMaintenance>[0]["recordUsage"];
  resolveAssistantSessionId: Parameters<typeof runHostedIdleCheckpointMaintenance>[0]["resolveAssistantSessionId"];
  shutdownSignal: AbortSignal | null;
  vaultRoot: string;
  wakeSignal: RuntimeWakeSignal | null;
}): Promise<HostedIdleMaintenanceOutcome> {
  const mediaRetentionProtections =
    await collectHostedPendingAssistantInputMediaRetentionProtections({
      vaultRoot: input.vaultRoot,
    });
  return await runHostedIdleCheckpointMaintenance({
    credentialSource: input.credentialSource,
    materializeRetentionCandidatePaths: async (storedPaths) => {
      const materialized = await input.materializeWorkspaceArtifacts(storedPaths);
      return {
        missingStoredPaths: [...materialized.missingArtifactPaths]
          .map((artifactPath) =>
            artifactPath.startsWith("vault:")
              ? artifactPath.slice("vault:".length)
              : artifactPath
          ),
      };
    },
    memberId: input.memberId,
    model: input.model,
    pendingWork: input.pendingWork,
    protectedAttachmentIds: mediaRetentionProtections.protectedAttachmentIds,
    protectedCaptureIds: mediaRetentionProtections.protectedCaptureIds,
    protectedStoredPaths: mediaRetentionProtections.protectedStoredPaths,
    providerName: input.providerName,
    recordUsage: input.recordUsage,
    resolveAssistantSessionId: input.resolveAssistantSessionId,
    shutdownSignal: input.shutdownSignal,
    vaultRoot: input.vaultRoot,
    wakeSignal: input.wakeSignal,
  });
}

async function runHostedInboxMediaRetentionOnlyCheckpoint(input: {
  assertRuntimeNotAborted: () => void;
  checkpointRequestBuilder: ReturnType<typeof createHostedWorkspaceSnapshotCheckpointRequestBuilder>;
  expectedUserId: string;
  input: HostedAssistantWorkspaceRuntimeJobInput;
  issueExportPort?: HostedRuntimePlatform["issueExportPort"] | null;
  materializeWorkspaceArtifacts: HostedWorkspaceArtifactMaterializer;
  runtimeAbortSignal: AbortSignal;
  shutdownSignal: AbortSignal | null;
  vaultRoot: string;
  wakeSignal: RuntimeWakeSignal | null;
  workspace: HostedWorkspaceState | null;
  workspacePort: HostedRuntimePlatform["workspacePort"];
}): Promise<HostedAssistantWorkspaceRuntimeJobResult> {
  if (!input.workspace) {
    return {
      nextWakeAt: null,
      status: "idle",
    };
  }

  const idleMaintenance = await runHostedPendingInputProtectedIdleMaintenance({
    credentialSource: "platform",
    materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts,
    memberId: input.input.request.userId,
    model: null,
    pendingWork: false,
    providerName: null,
    recordUsage: null,
    resolveAssistantSessionId: null,
    shutdownSignal: input.shutdownSignal,
    vaultRoot: input.vaultRoot,
    wakeSignal: input.wakeSignal,
  });
  const pendingWakeNotification = consumePendingRuntimeWakeUnlessShuttingDown({
    runtimeWakeSignal: input.wakeSignal,
    shutdownSignal: input.shutdownSignal,
  });
  if (pendingWakeNotification) {
    throw new HostedRuntimeCheckpointInterruptedByWakeError({
      notification: pendingWakeNotification,
    });
  }
  const checkpoint = await checkpointHostedRuntimeDirtyWorkspace({
    assertRuntimeNotAborted: input.assertRuntimeNotAborted,
    checkpointRequestBuilder: input.checkpointRequestBuilder,
    expectedUserId: input.expectedUserId,
    inboxMediaRetentionWakeAt: selectHostedRetentionOnlyCheckpointWake({
      idleMaintenance,
      previousInboxMediaRetentionWakeAt:
        input.workspace.inboxMediaRetentionWakeAt ?? null,
    }),
    issueExportPort: input.issueExportPort ?? null,
    nextWakeAt: input.workspace.nextWakeAt ?? null,
    nextWakeReason: input.workspace.nextWakeReason ?? null,
    redactedStatus: input.workspace.redactedStatus ?? null,
    runtimeAbortSignal: input.runtimeAbortSignal,
    vaultRoot: input.vaultRoot,
    workspacePort: input.workspacePort,
  });
  const nextWake = selectEarliestHostedRuntimeWake([
    {
      at: checkpoint.workspace.nextWakeAt ?? null,
      reason: checkpoint.workspace.nextWakeReason ?? null,
    },
    {
      at: checkpoint.workspace.inboxMediaRetentionWakeAt ?? null,
      reason: checkpoint.workspace.inboxMediaRetentionWakeAt
        ? "inbox_media_retention"
        : null,
    },
  ]);

  return {
    nextWakeAt: nextWake.nextWakeAt,
    ...(nextWake.nextWakeReason ? { nextWakeReason: nextWake.nextWakeReason } : {}),
    redactedStatus: checkpoint.workspace.redactedStatus ?? null,
    status: resolveHostedWorkspaceInvocationStatus({
      mailboxBudgetExhausted: false,
      nextWakeAt: nextWake.nextWakeAt,
    }),
  };
}

const DEFAULT_HOSTED_RUNTIME_IDLE_CHECKPOINT_DELAY_MS = 180_000;
const HOSTED_RUNTIME_MAX_TIMER_DELAY_MS = 2_147_483_647;
const activeHostedRuntimeDeferredUsageCaptures =
  new Set<HostedWorkspaceRunnerDeferredUsageCapture>();

type HostedRuntimeDirtyWaitResult =
  | { kind: "external_wake"; notification: RuntimeWakeNotification }
  | { kind: "idle_checkpoint"; trigger: "idle_window" | "shutdown_signal" };

type HostedRuntimeIdleCheckpointTrigger =
  | "idle_window"
  | "runtime_wake"
  | "shutdown_signal";

type HostedRuntimeMailboxPostCheckpointEffectWaitResult =
  | { kind: "external_wake"; notification: RuntimeWakeNotification }
  | { kind: "finished" };

interface HostedRuntimePendingWake {
  nextWakeAt: string | null;
  nextWakeReason: string | null;
}

interface HostedRuntimeHeldDurableWake {
  dueAssistantWake: HostedRuntimePendingWake;
  durableWake: HostedRuntimePendingWake;
}

interface HostedRuntimePendingWakeResolution {
  pendingWake: HostedRuntimePendingWake;
  preservedDueAssistantWakeOnNoProgress: boolean;
}

function copyHostedRuntimePendingWake(
  wake: HostedRuntimePendingWake,
): HostedRuntimePendingWake {
  return {
    nextWakeAt: wake.nextWakeAt,
    nextWakeReason: wake.nextWakeReason,
  };
}

function hostedRuntimePendingWakeMatches(
  left: HostedRuntimePendingWake,
  right: HostedRuntimePendingWake,
): boolean {
  return left.nextWakeAt === right.nextWakeAt
    && left.nextWakeReason === right.nextWakeReason;
}

function consumePendingHostedRuntimeWake(
  runtimeWakeSignal: RuntimeWakeSignal | null,
  shutdownSignal: AbortSignal | null,
): HostedRuntimeWakeLatencySeed | null {
  return createHostedRuntimeWakeLatencySeed(
    consumePendingRuntimeWakeUnlessShuttingDown({
      runtimeWakeSignal,
      shutdownSignal,
    }),
  );
}

function trackHostedRuntimeDeferredUsageCapture(
  capture: HostedWorkspaceRunnerDeferredUsageCapture,
): void {
  activeHostedRuntimeDeferredUsageCaptures.add(capture);
  void capture.completion.finally(() => {
    activeHostedRuntimeDeferredUsageCaptures.delete(capture);
  });
}

export async function drainHostedRuntimeDeferredUsageCompletionsBestEffort(input: {
  closeActiveCaptures?: boolean | null;
  timeoutMs?: number | null;
} = {}): Promise<void> {
  const pendingCompletions = [...activeHostedRuntimeDeferredUsageCaptures]
    .map((capture) => {
      if (input.closeActiveCaptures !== true) {
        return capture.completion;
      }

      try {
        return capture.drainForProcessFatal();
      } catch {
        // Best-effort fatal drain: keep awaiting the registered completion.
        return capture.completion;
      }
    });
  if (pendingCompletions.length === 0) {
    return;
  }

  const finished = Promise.allSettled(pendingCompletions);
  const timeoutMs = input.timeoutMs ?? null;
  if (timeoutMs === null) {
    await finished;
    return;
  }

  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      finished,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, Math.max(0, timeoutMs));
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

type HostedWorkspaceInvocationRedactedStatus =
  NonNullable<HostedWorkspaceInvocationResult["redactedStatus"]>;

function resolveHostedWorkspaceRunnerCommittedWorkspace(input: {
  result: HostedWorkspaceRunnerResult;
  workspace: HostedWorkspaceState | null;
}): HostedWorkspaceState | null {
  return input.result.latestWorkspace
    ?? input.result.initialMailboxImport.checkpoint?.workspace
    ?? input.workspace;
}

function buildHostedWorkspaceRunnerRedactedStatus(
  result: HostedWorkspaceRunnerResult,
): HostedWorkspaceInvocationRedactedStatus {
  const mailboxRedactedStatus = buildHostedMailboxImportRedactedStatus(
    result.latestMailboxImport.importResult,
  );

  return {
    ...mailboxRedactedStatus,
    ...(result.assistantPhaseResult?.progressed === true
      ? result.assistantPhaseResult.redactedStatus ?? {}
      : {}),
    hostedMailboxConversationImportedSeq:
      mailboxRedactedStatus["hostedMailboxConversationImportedSeq"],
    hostedMailboxSystemImportedSeq:
      mailboxRedactedStatus["hostedMailboxSystemImportedSeq"],
  };
}

function mergeHostedWorkspaceInvocationRedactedStatus(
  previous: HostedWorkspaceInvocationRedactedStatus,
  next: HostedWorkspaceInvocationRedactedStatus,
): HostedWorkspaceInvocationRedactedStatus {
  const merged = {
    ...previous,
    ...next,
  };
  const counterKeys = [
    "hostedSystemMailboxPrepared",
    "hostedSystemMailboxRecordFailed",
    "hostedSystemMailboxRecorded",
    "hostedSystemMailboxRetryableFailed",
  ];
  for (const key of counterKeys) {
    const total =
      readHostedWorkspaceInvocationRedactedNumber(previous, key)
      + readHostedWorkspaceInvocationRedactedNumber(next, key);
    if (total > 0) {
      merged[key] = total;
    }
  }
  if (
    previous.hostedAssistantProgressed === true
    || next.hostedAssistantProgressed === true
  ) {
    merged.hostedAssistantProgressed = true;
  }
  return merged;
}

function readHostedWorkspaceInvocationRedactedNumber(
  value: HostedWorkspaceInvocationRedactedStatus,
  key: string,
): number {
  const field = value[key];
  return typeof field === "number" ? field : 0;
}

function resolveHandledDeviceSyncWorkspaceWake(input: {
  current: HostedWorkspaceRunnerHandledDeviceSyncWake | null;
  result: HostedWorkspaceRunnerResult;
  workspace: HostedWorkspaceState | null;
}): HostedWorkspaceRunnerHandledDeviceSyncWake | null {
  if (input.result.assistantPhaseResult?.deviceSyncMaintenanceRan !== true) {
    return input.current;
  }

  const nextWakeAt = input.workspace?.nextWakeAt ?? null;
  if (!nextWakeAt) {
    return input.current;
  }

  const nextWakeReason = input.workspace?.nextWakeReason ?? null;
  if (nextWakeReason !== HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON) {
    return input.current;
  }

  return {
    nextWakeAt,
    nextWakeReason,
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

function resolvePendingWakeAfterForegroundPass(input: {
  checkpointPendingBeforePass: boolean;
  nowMs: number;
  passWake: HostedRuntimePendingWake;
  previousPendingWake: HostedRuntimePendingWake;
  preserveDueAssistantWakeOnNoProgress: boolean;
  replaceWake: boolean;
}): HostedRuntimePendingWakeResolution {
  const preservePendingWakeThroughPreCheckpointPass =
    input.checkpointPendingBeforePass
    && input.previousPendingWake.nextWakeAt !== null
    && (
      !hostedRuntimeWakeReasonIsAssistant(input.previousPendingWake.nextWakeReason)
      || hostedRuntimeWakeIsDue(input.previousPendingWake.nextWakeAt, input.nowMs)
    );
  if (preservePendingWakeThroughPreCheckpointPass) {
    return {
      pendingWake: copyHostedRuntimePendingWake(input.previousPendingWake),
      preservedDueAssistantWakeOnNoProgress: false,
    };
  }

  const previousWakeAt = input.checkpointPendingBeforePass
    ? input.previousPendingWake.nextWakeAt
    : normalizeHostedFutureWakeAt(input.previousPendingWake.nextWakeAt, input.nowMs);
  const previousWake = {
    nextWakeAt: previousWakeAt,
    nextWakeReason: previousWakeAt ? input.previousPendingWake.nextWakeReason : null,
  };

  if (input.replaceWake) {
    return {
      pendingWake: copyHostedRuntimePendingWake(input.passWake),
      preservedDueAssistantWakeOnNoProgress: false,
    };
  }

  if (
    input.preserveDueAssistantWakeOnNoProgress
    && input.passWake.nextWakeAt === null
    && input.previousPendingWake.nextWakeAt !== null
    && hostedRuntimeWakeReasonIsAssistant(input.previousPendingWake.nextWakeReason)
    && hostedRuntimeWakeIsDue(input.previousPendingWake.nextWakeAt, input.nowMs)
  ) {
    return {
      pendingWake: copyHostedRuntimePendingWake(input.previousPendingWake),
      preservedDueAssistantWakeOnNoProgress: true,
    };
  }

  return {
    pendingWake: selectEarliestHostedRuntimeWake([
      {
        at: previousWake.nextWakeAt,
        reason: previousWake.nextWakeReason,
      },
      {
        at: input.passWake.nextWakeAt,
        reason: input.passWake.nextWakeReason,
      },
    ]),
    preservedDueAssistantWakeOnNoProgress: false,
  };
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

  return JSON.stringify([
    input.nextWakeAt,
    normalizeHostedRuntimeWakeReason(input.nextWakeReason),
  ]);
}

function normalizeHostedRuntimeWakeReason(nextWakeReason: string | null): string {
  return nextWakeReason ?? HOSTED_ASSISTANT_WAKE_REASON;
}

function hostedRuntimeWakeReasonIsAssistant(nextWakeReason: string | null): boolean {
  return normalizeHostedRuntimeWakeReason(nextWakeReason) === HOSTED_ASSISTANT_WAKE_REASON;
}

function buildHostedRuntimeIdleCheckpointPhaseLogDetails(input: {
  checkpointWakeLatencySeed: HostedRuntimeWakeLatencySeed | null;
  dirtyWaitResult: HostedRuntimeDirtyWaitResult;
  idleCheckpointStartByMs: number;
  pendingWake: HostedRuntimePendingWake;
  shutdownSignal: AbortSignal | null;
}): HostedExecutionStructuredLogDetails & {
  idleCheckpointTrigger: HostedRuntimeIdleCheckpointTrigger;
} {
  const checkpointWakeLatencySeedPresent = input.checkpointWakeLatencySeed !== null;
  const idleCheckpointTrigger = resolveHostedRuntimeIdleCheckpointTrigger({
    checkpointWakeLatencySeedPresent,
    dirtyWaitResult: input.dirtyWaitResult,
  });

  return {
    idleCheckpointStartByMs: input.idleCheckpointStartByMs,
    idleCheckpointTrigger,
    nextWakeAtPresent: input.pendingWake.nextWakeAt !== null,
    nextWakeReasonPresent: input.pendingWake.nextWakeReason !== null,
    runtimeWakePendingAtCheckpoint: checkpointWakeLatencySeedPresent,
    shutdownSignalAbortedAtCheckpoint: input.shutdownSignal?.aborted === true,
  };
}

function resolveHostedRuntimeIdleCheckpointTrigger(input: {
  checkpointWakeLatencySeedPresent: boolean;
  dirtyWaitResult: HostedRuntimeDirtyWaitResult;
}): HostedRuntimeIdleCheckpointTrigger {
  if (
    input.dirtyWaitResult.kind === "idle_checkpoint"
    && input.dirtyWaitResult.trigger === "shutdown_signal"
  ) {
    return "shutdown_signal";
  }

  if (input.dirtyWaitResult.kind === "external_wake" || input.checkpointWakeLatencySeedPresent) {
    return "runtime_wake";
  }

  return "idle_window";
}

async function waitForHostedRuntimeDirtyWindow(input: {
  idleCheckpointStartByMs: number;
  runtimeAbortSignal: AbortSignal;
  runtimeWakeSignal: RuntimeWakeSignal | null;
  shutdownSignal: AbortSignal | null;
}): Promise<HostedRuntimeDirtyWaitResult> {
  const nowMs = Date.now();
  if (input.shutdownSignal?.aborted === true) {
    return { kind: "idle_checkpoint", trigger: "shutdown_signal" };
  }
  if (input.idleCheckpointStartByMs <= nowMs) {
    return { kind: "idle_checkpoint", trigger: "idle_window" };
  }

  const timeoutDelayMs = Math.min(
    Math.max(0, input.idleCheckpointStartByMs - nowMs),
    HOSTED_RUNTIME_MAX_TIMER_DELAY_MS,
  );
  if (timeoutDelayMs <= 0) {
    return { kind: "idle_checkpoint", trigger: "idle_window" };
  }

  return await new Promise<HostedRuntimeDirtyWaitResult>((resolve, reject) => {
    if (input.runtimeAbortSignal.aborted) {
      reject(readHostedRuntimeAbortReason(input.runtimeAbortSignal));
      return;
    }

    let settled = false;
    const wakeAbortController = new AbortController();
    const timer = setTimeout(() => {
      settle(() => resolve({ kind: "idle_checkpoint", trigger: "idle_window" }));
    }, timeoutDelayMs);
    const abort = () => {
      settle(() => reject(readHostedRuntimeAbortReason(input.runtimeAbortSignal)));
    };
    const shutdown = () => {
      settle(() => resolve({ kind: "idle_checkpoint", trigger: "shutdown_signal" }));
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

function hostedRuntimeWakeIsDue(
  nextWakeAt: string | null,
  nowMs = Date.now(),
): boolean {
  return resolveHostedProjectedRuntimeWakeDelayMs(nextWakeAt, nowMs) === 0;
}

async function checkpointHostedRuntimeDirtyWorkspace(input: {
  assertRuntimeNotAborted: () => void;
  checkpointRequestBuilder: ReturnType<typeof createHostedWorkspaceSnapshotCheckpointRequestBuilder>;
  expectedUserId: string;
  idleCheckpointTrigger?: HostedRuntimeIdleCheckpointTrigger;
  inboxMediaRetentionWakeAt: string | null;
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
    ...(input.idleCheckpointTrigger
      ? { idleCheckpointTrigger: input.idleCheckpointTrigger }
      : {}),
    inboxMediaRetentionWakeAt: input.inboxMediaRetentionWakeAt,
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
    if (checkpoint.checkpointConflictReason === "foreground_pending") {
      throw new HostedRuntimeCheckpointInterruptedByWakeError({
        message:
          "Hosted runtime checkpoint was interrupted by pending foreground mailbox input.",
      });
    }
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
            fetch: (request) => platform.mailboxPort!.fetch(request),
            fetchPayload: (request) => platform.mailboxPort!.fetchPayload(request),
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
    // usageRecordPort is inherited unguarded from platform. Deferred records
    // are captured before abort and must still reach the idempotent web ledger
    // after user-visible post-checkpoint work has happened.
    ...(platform.vaultSharePort
      ? {
          vaultSharePort: {
            deliver: (deliverInput) =>
              guard(() => platform.vaultSharePort!.deliver(deliverInput)),
            listActiveProjectionScopes: () =>
              guard(() => platform.vaultSharePort!.listActiveProjectionScopes()),
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

function isHostedInboxMediaRetentionWakeDue(input: {
  nowMs: number;
  workspace: HostedWorkspaceState | null;
}): boolean {
  const wakeAt = input.workspace?.inboxMediaRetentionWakeAt ?? null;
  if (!wakeAt) {
    return false;
  }

  const wakeMs = Date.parse(wakeAt);
  return Number.isFinite(wakeMs) && wakeMs <= input.nowMs;
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

function selectHostedIdleCheckpointWake(input: {
  idleMaintenance: HostedIdleMaintenanceOutcome;
  previousInboxMediaRetentionWakeAt: string | null;
  projectedWakeAt: string | null;
  projectedWakeReason: string | null;
}): {
  inboxMediaRetentionWakeAt: string | null;
  nextWakeAt: string | null;
  nextWakeReason: string | null;
} {
  const preservePreviousRetentionWake =
    "reason" in input.idleMaintenance
    && (
      input.idleMaintenance.reason === "pending_work"
      || input.idleMaintenance.reason === "shutdown"
    )
    && !input.idleMaintenance.nextWakeAt;

  return {
    inboxMediaRetentionWakeAt: preservePreviousRetentionWake
      ? input.previousInboxMediaRetentionWakeAt
      : input.idleMaintenance.nextWakeAt ?? null,
    nextWakeAt: input.projectedWakeAt,
    nextWakeReason: input.projectedWakeReason,
  };
}

function selectHostedRetentionOnlyCheckpointWake(input: {
  idleMaintenance: HostedIdleMaintenanceOutcome;
  previousInboxMediaRetentionWakeAt: string | null;
}): string | null {
  if (input.idleMaintenance.nextWakeAt) {
    return input.idleMaintenance.nextWakeAt;
  }

  const preservePreviousRetentionWake =
    "reason" in input.idleMaintenance
    && input.idleMaintenance.reason === "pending_work";

  return preservePreviousRetentionWake
    ? input.previousInboxMediaRetentionWakeAt
    : null;
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

function hasHostedRuntimeEnvValue(
  env: Readonly<Record<string, string | undefined>>,
  key: string,
): boolean {
  return typeof env[key] === "string" && env[key].trim().length > 0;
}
