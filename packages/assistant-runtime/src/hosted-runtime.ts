import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  HOSTED_RUNTIME_LATENCY_PHASE_BREAKDOWN_PHASE_KEYS,
  attachHostedRuntimeFailurePhaseCode,
  type HostedRuntimeAssistantConfigurationSnapshot,
  type HostedRuntimeFailurePhaseName,
  type HostedRuntimeLatencyPhaseBreakdown,
  type HostedRuntimeLatencyTraceMilestone,
  type HostedRuntimeLatencyTraceStagedMilestones,
  type HostedRuntimeOrchestrationLatencyDiagnostics,
  type HostedRuntimeRedactedJson,
  type HostedMailboxLane,
  type HostedWorkspaceCheckpointResponse,
  type HostedWorkspaceInvocationResult,
  type HostedWorkspaceState,
  isHostedRuntimeFutureMailboxContinuation,
} from "@murphai/hosted-execution/runtime-control";
import {
  detectVaultMetadataFormatVersion,
  VAULT_LAYOUT,
} from "@murphai/contracts";
import {
  recoverInterruptedClosedIntegrationIngestArchives,
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
  isMurphAndroidAppEnabled,
  MURPH_ANDROID_APP_ENABLED_ENV,
} from "@murphai/hosted-execution/env";
import {
  buildHostedExecutionSafeErrorDiagnostics,
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
  readHostedExecutionSafeErrorName,
  summarizeHostedExecutionError,
  type HostedExecutionConversationMessageChannel,
  type HostedExecutionLogPhase,
  type HostedExecutionStructuredLogDetails,
} from "@murphai/hosted-execution";
import {
  createAssistantProviderStartCriticalPathContext,
  flushPendingAssistantRuntimeIssueWrites,
  findAssistantSessionIdByCodexThreadId,
  getAssistantCronStatus,
  readAssistantProviderStartMonotonicTickMs,
  recordAssistantRuntimeIssueInputsBestEffort,
  resolveAssistantDiagnosticsPolicy,
  type AssistantProviderStartCriticalPathContext,
} from "@murphai/assistant-engine";
import {
  prepareHostedCodexAssistantProcess,
  type HostedCodexAssistantProcessPreparation,
} from "@murphai/assistant-engine/assistant-runtime";
import {
  AssistantActiveTurnInputUnavailableError,
  hasCompleteAssistantAutoReplyDeliveryTerminalEvidence,
} from "@murphai/assistant-engine/assistant-automation";
import {
  isHostedAssistantProvider,
  type HostedAssistantProvider,
} from "@murphai/hosted-execution/assistant-model";
import {
  createHostedAssistantTurnEnvironment,
  normalizeHostedAssistantRuntimeConfig,
  projectHostedRuntimeTrustStoreEnv,
} from "./hosted-runtime/environment.ts";
import {
  HOSTED_CODEX_OPERATOR_MEMORY_DIAGNOSTICS,
  HOSTED_CODEX_PROVIDER_TRANSPORT_DIAGNOSTICS,
  prepareHostedCodexRuntimeEnvironment,
  projectHostedRuntimeProcessEnvironment,
} from "./hosted-runtime/codex-config.ts";
import {
  HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV,
} from "./hosted-runtime/codex-runtime-env.ts";
import {
  resolveAssistantUsageCredentialSource,
} from "@murphai/hosted-execution/assistant-usage";
import {
  HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID,
} from "@murphai/operator-config/assistant/target-runtime";
import {
  HOSTED_IDLE_COMPACT_TIMEOUT_MS,
  runHostedIdleCheckpointMaintenance,
  type HostedIdleMaintenanceOutcome,
} from "./hosted-runtime/idle-maintenance.ts";
import {
  resolveHostedRuntimeCheckpointPublicationExpectedByMs,
  resolveHostedRuntimeIdleCheckpointDelayMs,
} from "./hosted-runtime/checkpoint-publication.ts";
import {
  executeHostedMailboxEvent,
} from "./hosted-runtime/events.ts";
import {
  createHostedAssistantChannelTypingDependencies,
} from "./hosted-runtime/channel-activity.ts";
import {
  resolveHostedCurrentInputIdForAcceptedInputs,
  type HostedConversationActivityObservation,
} from "./hosted-runtime/turn-input.ts";
import {
  readHostedAssistantExecutionDefaultTarget,
} from "./hosted-runtime/context.ts";
import type {
  HostedAssistantWorkspaceRuntimeJobResult,
  HostedAssistantWorkspaceRuntimeJobInput,
  HostedDeviceSyncDirtyProcessedPostCheckpointRecord,
  HostedWorkspaceArtifactMaterializer,
} from "./hosted-runtime/models.ts";
import {
  HOSTED_MAILBOX_ITEM_BUDGET_REASON_CODE,
  prefetchHostedMailboxPrefix,
  type HostedMailboxItemImportOutcome,
  type HostedMailboxImportLoopResult,
  type HostedMailboxPrefixPrefetch,
  type HostedMailboxResolvedImportItem,
} from "./hosted-runtime/mailbox-import.ts";
import {
  readHostedMailboxImportState,
} from "./hosted-runtime/mailbox-state.ts";
import {
  buildHostedRuntimeLogContextFields,
  writeHostedRuntimeLogBestEffort,
} from "./hosted-runtime/runtime-logs.ts";
import {
  offerHostedVaultShareProjectionBestEffort,
} from "./hosted-runtime/vault-share-projection.ts";
import { createHostedGroupSharedReader } from "./hosted-runtime/group-shared-reader.ts";
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
  HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
} from "./hosted-runtime/workspace-runner.ts";
import {
  createHostedWorkspaceCheckpointRequestBuilder,
  createHostedWorkspaceSnapshotCheckpointRequestBuilder,
  finishHostedMailboxImportPostCheckpointEffects,
  HostedWorkspaceRunnerUserMismatchError,
  runHostedWorkspaceCanonicalWriteAtBoundary,
  runHostedWorkspaceUntilIdleOrBudget,
  type HostedWorkspaceDurableCheckpointEffect,
  type HostedWorkspaceDurableCheckpointEffectResult,
  type HostedWorkspaceRunnerDeferredUsageCapture,
  type HostedWorkspaceRunnerHandledDeviceSyncWake,
  type HostedWorkspaceRunnerAssistantInputBatch,
  type HostedWorkspaceRunnerMailboxImportContext,
  type HostedWorkspaceRunnerInput,
  type HostedWorkspaceRunnerResult,
  type HostedWorkspaceRunnerRuntimeStatusCheckpointInput,
} from "./hosted-runtime/workspace-runner.ts";
import {
  restoreHostedWorkspaceRuntimeJobWorkspace,
  writeHostedWorkspaceCleanCheckpointMarkerBestEffort,
} from "./hosted-runtime/workspace-restore.ts";
import {
  HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES,
  hostedCanonicalWriteReceiptRecoveryStatusFields,
  omitHostedCanonicalWriteReceiptLogStatusFields,
  readHostedCanonicalWriteReceiptLogStatusFingerprint,
  readHostedCanonicalWriteReceiptRecoveryWake,
} from "./hosted-runtime/canonical-write-receipt-log.ts";
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
  enqueueHostedSystemMailboxItem,
  prepareHostedSystemMailboxItemForCheckpoint,
  recordHostedSystemMailboxItemAfterCheckpoint,
  resolveHostedSystemMailboxNextWakeCandidate,
  type HostedSystemMailboxCheckpointPreparation,
} from "./hosted-runtime/system-mailbox.ts";
import {
  createHostedDetachedAssistantAskController,
  type HostedDetachedAssistantAskController,
} from "./hosted-runtime/detached-assistant-ask.ts";
import type {
  HostedImageGenerationController,
} from "./hosted-runtime/image-generation.ts";
import {
  findNextHostedSystemMailboxQueueItem,
  readHostedSystemMailboxState,
  readHostedSystemMailboxHandledThroughSeq,
} from "./hosted-runtime/system-mailbox-state.ts";
import {
  compactHostedConversationMailboxHandledItemSelection,
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
  createHostedRuntimeWakeCandidate,
  selectHostedRuntimeWakeCandidate,
  type HostedRuntimeWakeCandidate,
} from "./hosted-runtime/wake-candidates.ts";
import {
  consumePendingRuntimeWakeUnlessShuttingDown,
} from "./hosted-runtime/runtime-wake.ts";
import {
  resolveHostedAssistantOutboxNextWakeAt,
} from "./hosted-runtime/callbacks.ts";
import {
  resolveHostedPendingAssistantInputWakeAt,
} from "./hosted-runtime/pending-assistant-input.ts";
import {
  resolveHostedProviderCleanupScheduledWakeAt,
} from "./hosted-runtime/provider-cleanup.ts";
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
  HostedWorkspaceRunnerRuntimeStatusCheckpointInput,
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
const HOSTED_FOREGROUND_MAILBOX_PREFETCH_LANES = ["conversation", "system"] as const;
const HOSTED_SYSTEM_MAILBOX_DEVICE_SYNC_ROUTE_ACTIONS = ["run-device-sync-wake"] as const;
const HOSTED_SYSTEM_MAILBOX_DEVICE_SYNC_WAKE_KINDS = ["device-sync.wake"] as const;
const HOSTED_INITIAL_BOOTSTRAP_PENDING_REASON_CODE = "bootstrap.pending";
const HOSTED_RUNTIME_ISSUE_POST_CHECKPOINT_EXPORT_TIMEOUT_MS = 2_500;
const HOSTED_VAULT_FORMAT_MIGRATION_MAX_BUNDLES = 500;

interface HostedInitialMailboxImportPlan {
  bootstrapRequired: boolean;
  lanes: readonly ("conversation" | "system")[];
}

interface HostedInitialMailboxImportResult {
  bootstrapPending: boolean;
  prefetch: HostedMailboxPrefixPrefetch | null;
  result: HostedMailboxImportCheckpointResult;
  workspace: HostedWorkspaceState | null;
}

interface HostedVaultStartupPreparationResult {
  mutated: boolean;
}

type HostedSystemMailboxCheckpointPreparationRecordItem = Extract<
  HostedSystemMailboxCheckpointPreparation,
  { item: unknown }
>["item"];

type HostedSystemMailboxPreparationInput = Parameters<
  typeof prepareHostedSystemMailboxItemForCheckpoint
>[0];

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

async function prepareHostedVaultForRuntime(input: {
  assertRuntimeNotAborted: () => void;
  runtimeAbortSignal: AbortSignal;
  vaultRoot: string;
}): Promise<HostedVaultStartupPreparationResult> {
  const { assertRuntimeNotAborted, runtimeAbortSignal, vaultRoot } = input;
  if (!hasHostedVaultMetadata(vaultRoot)) {
    return { mutated: false };
  }

  let mutated = false;
  while (await readHostedVaultStoredFormatVersion(vaultRoot) !== CURRENT_VAULT_FORMAT_VERSION) {
    assertRuntimeNotAborted();
    const result = await runIntegrationIngestMigration({
      vaultRoot,
      apply: true,
      maxBundles: HOSTED_VAULT_FORMAT_MIGRATION_MAX_BUNDLES,
    });
    assertRuntimeNotAborted();
    mutated ||= result.mutated;
    if (result.storedFormatVersion === CURRENT_VAULT_FORMAT_VERSION) {
      break;
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

  assertRuntimeNotAborted();
  const archiveRecovery = await recoverInterruptedClosedIntegrationIngestArchives({
    signal: runtimeAbortSignal,
    vaultRoot,
  });
  assertRuntimeNotAborted();
  if (archiveRecovery.blockedConflictCount > 0) {
    throw new VaultError(
      "INTEGRATION_INGEST_SHARD_REPRESENTATION_CONFLICT",
      "Hosted vault startup found conflicting integration ingest shard representations that could not be repaired safely.",
      { blockedConflictCount: archiveRecovery.blockedConflictCount },
    );
  }
  mutated ||= archiveRecovery.repairedShardCount > 0;
  return { mutated };
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
  importItemContext?: HostedWorkspaceRunnerMailboxImportContext | null;
  lanes: readonly HostedMailboxLane[];
  mailboxFetchSignal?: AbortSignal | null;
  prefetchLanes: readonly HostedMailboxLane[];
  runnerInput: HostedWorkspaceRunnerInput;
  requestId: string;
}): Promise<HostedInitialMailboxImportResult> {
  const plan = resolveHostedInitialMailboxImportPlan({
    vaultRoot: input.runnerInput.vaultRoot,
  });
  const prefetch = plan.bootstrapRequired
    ? null
    : await createHostedForegroundMailboxPrefetch({
        lanes: input.prefetchLanes,
        limitPerLane: input.runnerInput.limitPerLane,
        requestId: input.requestId,
        runnerInput: input.runnerInput,
        signal: input.mailboxFetchSignal ?? null,
      });
  const runnerResult = await runHostedWorkspaceUntilIdleOrBudget({
    ...input.runnerInput,
    deferInitialMailboxPostCheckpointEffects: true,
    initialMailboxConversationDeferral: plan.bootstrapRequired
      ? {
          ready: () => hasHostedVaultMetadata(input.runnerInput.vaultRoot),
          reasonCode: HOSTED_INITIAL_BOOTSTRAP_PENDING_REASON_CODE,
        }
      : null,
    initialMailboxImportContext: input.importItemContext ?? null,
    initialMailboxImportLanes: input.lanes,
    initialMailboxFetchSignal: input.mailboxFetchSignal ?? null,
    initialMailboxPrefetch: prefetch,
    requestId: input.requestId,
  });
  const result = runnerResult.initialMailboxImport;

  return {
    bootstrapPending: isHostedInitialBootstrapPending({
      bootstrapRequired: plan.bootstrapRequired,
      result,
      vaultRoot: input.runnerInput.vaultRoot,
    }),
    prefetch,
    result,
    workspace: runnerResult.latestWorkspace,
  };
}

async function createHostedForegroundMailboxPrefetch(input: {
  lanes: readonly HostedMailboxLane[];
  limitPerLane: number;
  requestId: string;
  runnerInput: HostedWorkspaceRunnerInput;
  signal?: AbortSignal | null;
}): Promise<HostedMailboxPrefixPrefetch> {
  const state = await readHostedMailboxImportState({
    vaultRoot: input.runnerInput.vaultRoot,
  });
  return prefetchHostedMailboxPrefix({
    lanes: input.lanes,
    limitPerLane: input.limitPerLane,
    mailboxPort: input.runnerInput.platform.mailboxPort,
    requestId: input.requestId,
    signal: input.signal ?? null,
    state,
  });
}

const HOSTED_PRE_CHECKPOINT_EXTERNAL_COMPLETION_DEDUPE_KEY_PREFIXES = [
  "assistant.notification.requested:phone-call-result:",
  "assistant.notification.requested:usage-referral-reward:",
  "aask_done_",
  "aask_private_",
] as const;

function isHostedPreCheckpointExternalCompletionDedupeKey(
  dedupeKey: string,
): boolean {
  return HOSTED_PRE_CHECKPOINT_EXTERNAL_COMPLETION_DEDUPE_KEY_PREFIXES.some(
    (prefix) => dedupeKey.startsWith(prefix),
  );
}

async function hasHostedPreCheckpointLocalExternalCompletion(input: {
  now: string;
  vaultRoot: string;
}): Promise<boolean> {
  const state = await readHostedSystemMailboxState(input.vaultRoot);
  return findNextHostedSystemMailboxQueueItem({
    allowedRouteActions: ["dispatch-assistant-notification"],
    now: input.now,
    state: {
      pending: state.pending.filter((item) =>
        item.wake.kind === "assistant.notification.requested"
        && isHostedPreCheckpointExternalCompletionDedupeKey(
          item.mailboxDedupeKey,
        )
      ),
    },
  }) !== null;
}

async function inspectHostedPreCheckpointSystemMailboxPrefetch(
  prefetch: HostedMailboxPrefixPrefetch,
): Promise<{
  containsOnlyBrowserVaultRefreshWakes: boolean;
  containsOnlyDeviceSyncDirtyWakes: boolean;
  containsOnlySafeSystemWakes: boolean;
  hasSystemWork: boolean;
}> {
  const response = await prefetch.response;
  const reachesEveryLaneHighWater = prefetch.lanes.every((lane) => {
    const laneHighWaters = response.maxSeqByLane.filter((entry) => entry.lane === lane);
    if (laneHighWaters.length !== 1) {
      return false;
    }

    const importedSeq = parseHostedMailboxSeqOrNull(prefetch.importedSeqByLane[lane]);
    const maxSeq = parseHostedMailboxSeqOrNull(laneHighWaters[0]?.maxSeq);
    if (importedSeq === null || maxSeq === null) {
      return false;
    }

    let visibleMaxSeq: bigint | null = null;
    for (const item of response.items) {
      if (item.lane !== lane) {
        continue;
      }
      const itemSeq = parseHostedMailboxSeqOrNull(item.laneSeq);
      if (itemSeq === null) {
        return false;
      }
      if (visibleMaxSeq === null || itemSeq > visibleMaxSeq) {
        visibleMaxSeq = itemSeq;
      }
    }

    return visibleMaxSeq === null
      ? maxSeq <= importedSeq
      : visibleMaxSeq === maxSeq;
  });
  return {
    containsOnlyBrowserVaultRefreshWakes: response.items.length > 0
      && response.items.every((item) =>
        item.lane === "system"
        && item.kind === "runtime.browser-vault-refresh-requested"
      ),
    containsOnlyDeviceSyncDirtyWakes: reachesEveryLaneHighWater
      && response.items.length > 0
      && response.items.every((item) =>
        item.lane === "system"
        && item.kind === "device-sync.wake"
        && item.dedupeKey.startsWith("device-sync:dirty:")
      ),
    containsOnlySafeSystemWakes: response.items.length > 0
      && response.items.every((item) =>
        item.lane === "system"
        && (
          item.kind === "runtime.pending-effects-reconcile-requested"
          || item.kind === "assistant.ask.requested"
          || item.kind === "assistant.ask.completed"
          || (
            item.kind === "assistant.notification.requested"
            && isHostedPreCheckpointExternalCompletionDedupeKey(
              item.dedupeKey,
            )
          )
        )
      ),
    hasSystemWork: response.items.some((item) => item.lane === "system"),
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
  onConversationActivityObserved?: (
    observation: Exclude<HostedConversationActivityObservation, "not_observed">,
  ) => void;
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
  assistantAskRequestTargetKind?: "joined_group";
  onConversationActivityObserved?: (() => void) | null;
  onConversationInputStaged?: ((
    channel: HostedExecutionConversationMessageChannel,
  ) => void) | null;
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

function notifyHostedConversationActivityObservedBestEffort(
  callback: HostedWorkspaceRuntimeJobOptions["onConversationActivityObserved"],
  observation: Exclude<HostedConversationActivityObservation, "not_observed">,
): void {
  try {
    callback?.(observation);
  } catch (error) {
    console.warn("Hosted conversation activity callback failed.", error);
  }
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

function hostedMailboxImportStagedConversationInput(
  result: HostedMailboxImportCheckpointResult | null | undefined,
): boolean {
  return (
    (result?.importResult.assistantInputIds?.length ?? 0) > 0
    || (result?.importResult.conversationImportedCount ?? 0) > 0
  );
}

function hostedAssistantInputBatchHasWork(
  batch: HostedWorkspaceRunnerAssistantInputBatch | null | undefined,
): boolean {
  return (batch?.assistantInputIds.length ?? 0) > 0;
}

async function resolveHostedSystemMailboxProcessingModeWake(input: {
  extraCandidates?: readonly HostedRuntimeWakeCandidate[] | null;
  mailboxImportRetryAt?: string | null;
  nowMs: number;
  operatorHomeRoot: string;
  runtimeEnv: Readonly<Record<string, string>>;
  vaultRoot: string;
}): Promise<{
  nextWakeAt: string | null;
  nextWakeReason: string | null;
}> {
  const now = new Date(input.nowMs);
  const pendingAssistantInputWakeAt =
    await resolveHostedPendingAssistantInputWakeAt({
      inspectOnly: true,
      now: () => now.toISOString(),
      vaultRoot: input.vaultRoot,
    });
  const outboxWakeAt = await resolveHostedAssistantOutboxNextWakeAt({
    now,
    vaultRoot: input.vaultRoot,
  });
  const providerCleanupWakeAt = await resolveHostedProviderCleanupScheduledWakeAt({
    nowMs: input.nowMs,
    vaultRoot: input.vaultRoot,
  });
  const systemMailboxWake = await resolveHostedSystemMailboxNextWakeCandidate({
    vaultRoot: input.vaultRoot,
  });
  const assistantCronWake = await resolveHostedAssistantCronWakeAfterInitialImport({
    operatorHomeRoot: input.operatorHomeRoot,
    runtimeEnv: input.runtimeEnv,
    vaultRoot: input.vaultRoot,
  });

  return selectEarliestHostedRuntimeWake([
    ...(input.extraCandidates ?? []),
    {
      at: systemMailboxWake.at,
      reason: systemMailboxWake.reason,
    },
    {
      at: input.mailboxImportRetryAt ?? null,
      reason: input.mailboxImportRetryAt ? "mailbox" : null,
    },
    {
      at: outboxWakeAt,
      reason: outboxWakeAt ? HOSTED_ASSISTANT_WAKE_REASON : null,
    },
    {
      at: pendingAssistantInputWakeAt,
      reason: pendingAssistantInputWakeAt ? HOSTED_ASSISTANT_WAKE_REASON : null,
    },
    {
      at: providerCleanupWakeAt,
      reason: providerCleanupWakeAt ? HOSTED_ASSISTANT_WAKE_REASON : null,
    },
    {
      at: assistantCronWake.at,
      reason: assistantCronWake.reason,
    },
  ]);
}

function hostedSystemMailboxCheckpointPreparationNeedsCheckpoint(
  preparation: HostedSystemMailboxCheckpointPreparation | null,
): boolean {
  return preparation !== null && preparation.status !== "preempted";
}

function readHostedSystemMailboxCheckpointPreparationRecordItem(
  preparation: HostedSystemMailboxCheckpointPreparation | null,
): HostedSystemMailboxCheckpointPreparationRecordItem | null {
  return preparation && "item" in preparation ? preparation.item : null;
}

function resolveHostedSystemMailboxCheckpointPreparationWake(
  preparation: HostedSystemMailboxCheckpointPreparation | null,
): HostedRuntimeWakeCandidate | null {
  if (preparation?.status === "processed") {
    return createHostedRuntimeWakeCandidate(
      preparation.metrics.nextWakeAt ?? null,
      preparation.metrics.nextWakeReason ?? null,
    );
  }
  if (preparation?.status !== "retryable_failed") {
    return null;
  }
  return createHostedRuntimeWakeCandidate(
    preparation.nextWakeAt,
    preparation.nextWakeReason,
  );
}

function hostedSystemMailboxWakeChangedFromWorkspace(input: {
  nextWakeAt: string | null;
  nextWakeReason: string | null;
  workspace: HostedWorkspaceState | null;
}): boolean {
  return buildHostedRuntimeWakeKey(input)
    !== buildHostedRuntimeWakeKey({
      nextWakeAt: input.workspace?.nextWakeAt ?? null,
      nextWakeReason: input.workspace?.nextWakeReason ?? null,
    });
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
  readonly checkpointConflictReason: "foreground_pending" | null;
  readonly notification: RuntimeWakeNotification | null;

  constructor(input: {
    checkpointConflictReason?: "foreground_pending" | null;
    message?: string;
    notification?: RuntimeWakeNotification | null;
  } = {}) {
    super(input.message ?? "Hosted runtime checkpoint was interrupted by a pending runtime wake.");
    this.name = "HostedRuntimeCheckpointInterruptedByWakeError";
    this.checkpointConflictReason = input.checkpointConflictReason ?? null;
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
  let canonicalWritePersistenceDepth = 0;
  let hostAbortDuringCanonicalWritePersistence = false;
  const abortRuntimeFromObservedHostAbort = () => {
    if (runtimeAbortController.signal.aborted || !hostAbortObserved) {
      return;
    }
    runtimeAbortController.abort(hostAbortReason);
  };
  const withCanonicalWritePersistence = async <T>(
    run: () => Promise<T>,
  ): Promise<T> => {
    canonicalWritePersistenceDepth += 1;
    try {
      return await run();
    } finally {
      canonicalWritePersistenceDepth -= 1;
      if (canonicalWritePersistenceDepth === 0) {
        abortRuntimeFromObservedHostAbort();
      }
    }
  };
  const abortFromHost = () => {
    if (!hostAbortSignal || runtimeAbortController.signal.aborted) {
      return;
    }
    hostAbortReason = readHostedRuntimeAbortReason(hostAbortSignal);
    hostAbortObserved = true;
    if (canonicalWritePersistenceDepth > 0) {
      hostAbortDuringCanonicalWritePersistence = true;
      return;
    }
    abortRuntimeFromObservedHostAbort();
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
  let detachedAssistantAskController: HostedDetachedAssistantAskController | null = null;
  let imageGenerationController: HostedImageGenerationController | null = null;
  let pauseDetachedAssistantAskBeforeWorkspaceBoundary = async (): Promise<void> => undefined;
  let resumeDetachedAssistantAskAfterWorkspaceBoundary = (): void => undefined;
  let closeDetachedAssistantAskBeforeWorkspaceRelease = async (): Promise<void> => undefined;
  let codexProcessPreparationStart:
    | Promise<HostedCodexAssistantProcessPreparation | null>
    | null = null;
  let startCodexProcessPreparationForConversation:
    | ((channel: HostedExecutionConversationMessageChannel) => void)
    | null = null;
  const settleCodexProcessPreparation = async (): Promise<void> => {
    startCodexProcessPreparationForConversation = null;
    const started = codexProcessPreparationStart ?? Promise.resolve(null);
    codexProcessPreparationStart ??= started;
    const preparation = await started;
    await preparation?.cancelPending();
    if (codexProcessPreparationStart === started) {
      codexProcessPreparationStart = Promise.resolve(null);
    }
  };
  let latestCheckpointSnapshotCleanForWarmReuse = false;
  const createAbortGuardedCheckpointSnapshot: HostedWorkspaceSnapshotCheckpointBuilder =
    async (snapshotInput, context) => {
      await settleCodexProcessPreparation();
      await pauseDetachedAssistantAskBeforeWorkspaceBoundary();
      assertRuntimeNotAborted();
      const checkpointSignal = context?.signal
        ? AbortSignal.any([context.signal, runtimeAbortController.signal])
        : runtimeAbortController.signal;
      const snapshot = await options.createCheckpointSnapshot(snapshotInput, {
        signal: checkpointSignal,
      });
      assertRuntimeNotAborted();
      latestCheckpointSnapshotCleanForWarmReuse =
        snapshot.localWorkspaceCleanForWarmReuse === true;
      return snapshot;
    };
  const phaseLogger = createHostedRuntimePhaseLogger();
  const emitPhaseLog = phaseLogger.emit;
  const pendingDeferredUsageCaptures = new Set<HostedWorkspaceRunnerDeferredUsageCapture>();
  const pendingLocalWorkspaceMutationCompletions = new Set<Promise<void>>();
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
  const trackLocalWorkspaceMutationCompletion = (completion: Promise<void> | null): void => {
    trackCompletion(pendingLocalWorkspaceMutationCompletions, completion);
  };
  const drainDeferredUsageBestEffort = async (): Promise<void> => {
    await Promise.allSettled(
      [...pendingDeferredUsageCaptures].map((capture) => capture.completion),
    );
  };
  const drainLocalWorkspaceMutationsBestEffort = async (): Promise<void> => {
    await Promise.allSettled([...pendingLocalWorkspaceMutationCompletions]);
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
    let preCheckpointExternalCompletionImported = false;
    let deviceSyncMessagingReturnTarget: HostedRuntimeDeviceSyncMessagingReturnTarget | null =
      null;
    const createMailboxImportContext = (
      context: HostedWorkspaceRunnerMailboxImportContext | undefined,
    ): HostedWorkspaceRuntimeJobImportContext => ({
      ...(context?.assistantAskRequestTargetKind
        ? { assistantAskRequestTargetKind: context.assistantAskRequestTargetKind }
        : {}),
      recordMessagingReturnTarget: (target) => {
        deviceSyncMessagingReturnTarget = target;
      },
      latencyMilestones: mergeHostedRuntimeLatencyTraceStagedMilestones(
        initialAssistantInputLatencyMilestones,
        context?.latencyMilestones ?? null,
      ),
      onConversationActivityObserved: () => {
        options.onConversationActivityObserved?.("observed");
      },
      onConversationInputStaged:
        context?.onConversationInputStaged
        ?? startCodexProcessPreparationForConversation,
      runtimeAttemptId: input.request.attemptId,
      signal: context?.signal ?? runtimeAbortController.signal,
    });
    const kickDetachedAssistantAskAfterImport = (
      item: HostedMailboxResolvedImportItem,
      outcome: HostedMailboxItemImportOutcome,
    ): void => {
      if (
        item.route.action === "run-assistant-ask"
        && (outcome.status === "imported" || outcome.status === "skipped")
      ) {
        detachedAssistantAskController?.kick();
      }
      if (
        outcome.status === "imported"
        && item.item.kind === "assistant.notification.requested"
        && isHostedPreCheckpointExternalCompletionDedupeKey(
          item.item.dedupeKey,
        )
      ) {
        preCheckpointExternalCompletionImported = true;
      }
    };
    const importMailboxItem: HostedWorkspaceRunnerInput["importItem"] = (item, context) =>
      mailboxBudget.importItem(
        item,
        async (importItem, context) => {
          assertRuntimeNotAborted();
          const outcome = await options.importItem(importItem, context);
          assertRuntimeNotAborted();
          kickDetachedAssistantAskAfterImport(importItem, outcome);
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
      kickDetachedAssistantAskAfterImport(item, outcome);
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
    const hostedVaultStartupPreparation = await prepareHostedVaultForRuntime({
      assertRuntimeNotAborted,
      runtimeAbortSignal: runtimeAbortController.signal,
      vaultRoot: restored.vaultRoot,
    });
    assertRuntimeNotAborted();
    let activeWorkspace = workspaceRead.workspace;
    const pendingCanonicalReceiptCount = restored.canonicalWriteReceiptCount;
    const canonicalWriteReceiptRecoveryFailed =
      restored.canonicalWriteReceiptRecoveryFailed;
    if (activeWorkspace && canonicalWriteReceiptRecoveryFailed) {
      activeWorkspace = {
        ...activeWorkspace,
        redactedStatus: omitHostedCanonicalWriteReceiptLogStatusFields(
          activeWorkspace.redactedStatus,
        ),
      };
    }
    const pendingCanonicalReceiptRecoveryWake = readHostedCanonicalWriteReceiptRecoveryWake(
      activeWorkspace?.redactedStatus ?? null,
    );
    if (
      pendingCanonicalReceiptRecoveryWake
      && pendingCanonicalReceiptCount < HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES
    ) {
      throw new Error(
        "Hosted canonical write receipt recovery requires a saturated receipt log.",
      );
    }

    const runnerMailboxPort = guardedMailboxPort ?? mailboxPort;
    if (!runnerMailboxPort) {
      throw new TypeError("Hosted workspace runtime job mailbox port must be injected.");
    }
    const checkpointMetadata = {
      attemptId: input.request.attemptId,
      expectedWorkspaceVersion: activeWorkspace?.version ?? input.request.workspaceVersion,
      inboxMediaRetentionWakeAt: activeWorkspace?.inboxMediaRetentionWakeAt ?? null,
      leaseGeneration: input.request.leaseGeneration,
      nextWakeAt: activeWorkspace?.nextWakeAt ?? null,
      nextWakeReason: activeWorkspace?.nextWakeReason ?? null,
    };
    const checkpointRequestBuilder = createHostedWorkspaceSnapshotCheckpointRequestBuilder({
      createSnapshot: createAbortGuardedCheckpointSnapshot,
      metadata: checkpointMetadata,
    });
    const startingDefaultWakeKey = buildHostedRuntimeWakeKey({
      nextWakeAt: workspaceRead.workspace?.nextWakeAt ?? null,
      nextWakeReason: workspaceRead.workspace?.nextWakeReason ?? null,
    });
    const foregroundWorkspacePort = guardedWorkspacePort;
    const checkpointRuntimeRedactedStatus = async (
      checkpointInput: HostedWorkspaceRunnerRuntimeStatusCheckpointInput,
    ): Promise<HostedWorkspaceCheckpointResponse> => {
      if (!foregroundWorkspacePort) {
        throw new TypeError("Hosted runtime redacted status checkpoint requires workspace port support.");
      }

      await pauseDetachedAssistantAskBeforeWorkspaceBoundary();
      try {
        assertRuntimeNotAborted();
        const workspace = checkpointInput.workspace;
        const requestedCheckpointNextWakeAt = Object.hasOwn(checkpointInput, "nextWakeAt")
          ? checkpointInput.nextWakeAt ?? null
          : workspace?.nextWakeAt ?? null;
        const requestedCheckpointNextWakeReason = Object.hasOwn(
          checkpointInput,
          "nextWakeReason",
        )
          ? checkpointInput.nextWakeReason ?? null
          : workspace?.nextWakeReason ?? null;
        const systemMailboxWake = await resolveHostedSystemMailboxNextWakeCandidate({
          allowedRouteActions: ["run-assistant-ask"],
          vaultRoot: restored.vaultRoot,
        });
        const checkpointWake = selectEarliestHostedRuntimeWake([
          {
            at: requestedCheckpointNextWakeAt,
            reason: requestedCheckpointNextWakeReason,
          },
          {
            at: systemMailboxWake.at,
            reason: systemMailboxWake.reason,
          },
        ]);
        const canonicalRuntimeCommit = checkpointInput.reason === "canonical_runtime_commit";
        const checkpointWorkspacePort = canonicalRuntimeCommit
          ? workspacePort
          : foregroundWorkspacePort;
        const redactedStatus = await withHostedSystemMailboxHandledThroughStatus({
          redactedStatus: checkpointInput.redactedStatus,
          vaultRoot: restored.vaultRoot,
        });
        const checkpointOperation = checkpointWorkspacePort.checkpoint({
          attemptId: checkpointMetadata.attemptId,
          expectedWorkspaceVersion: checkpointMetadata.expectedWorkspaceVersion,
          inboxMediaRetentionWakeAt: workspace?.inboxMediaRetentionWakeAt ?? null,
          leaseGeneration: checkpointMetadata.leaseGeneration,
          nextWakeAt: checkpointWake.nextWakeAt,
          nextWakeReason: checkpointWake.nextWakeReason,
          reason: checkpointInput.reason,
          redactedStatus,
          snapshotRef: workspace?.snapshotRef ?? null,
        });
        const checkpoint = canonicalRuntimeCommit
          ? await checkpointOperation
          : await raceHostedRuntimeCancellation(
              checkpointOperation,
              runtimeAbortController.signal,
            );
        if (!canonicalRuntimeCommit) {
          assertRuntimeNotAborted();
        }
        assertHostedWorkspaceCheckpointAccepted(checkpoint, input.request.userId);
        return checkpoint;
      } finally {
        resumeDetachedAssistantAskAfterWorkspaceBoundary();
      }
    };
    if (
      input.request.processingMode !== "inbox_media_retention"
      && pendingCanonicalReceiptCount >= HOSTED_CANONICAL_WRITE_RECEIPT_LOG_MAX_ENTRIES
    ) {
      const priorNextWakeAt = pendingCanonicalReceiptRecoveryWake
        ? pendingCanonicalReceiptRecoveryWake.nextWakeAt
        : activeWorkspace?.nextWakeAt ?? null;
      const priorNextWakeReason = pendingCanonicalReceiptRecoveryWake
        ? pendingCanonicalReceiptRecoveryWake.nextWakeReason
        : activeWorkspace?.nextWakeReason ?? null;
      const recoveryCheckpoint = await checkpointHostedRuntimeDirtyWorkspace({
        assertRuntimeNotAborted,
        checkpointRequestBuilder,
        expectedUserId: input.request.userId,
        inboxMediaRetentionWakeAt: activeWorkspace?.inboxMediaRetentionWakeAt ?? null,
        issueExportPort: runtime.platform.issueExportPort ?? null,
        nextWakeAt: new Date().toISOString(),
        nextWakeReason: "mailbox",
        redactedStatus: {
          ...(activeWorkspace?.redactedStatus ?? {}),
          ...hostedCanonicalWriteReceiptRecoveryStatusFields({
            nextWakeAt: priorNextWakeAt,
            nextWakeReason: priorNextWakeReason,
          }),
        },
        retainCanonicalWriteReceiptLogStatus: true,
        runtimeAbortSignal: runtimeAbortController.signal,
        vaultRoot: restored.vaultRoot,
        workspacePort: foregroundWorkspacePort,
      });
      // The mailbox wake only authorizes the recovery snapshot. Clear it
      // durably before any no-op or early-return path can leave it due forever.
      const wakeResetCheckpoint = await checkpointRuntimeRedactedStatus({
        nextWakeAt: priorNextWakeAt,
        nextWakeReason: priorNextWakeReason,
        reason: "import",
        redactedStatus: omitHostedCanonicalWriteReceiptLogStatusFields(
          recoveryCheckpoint.workspace.redactedStatus,
        ),
        workspace: recoveryCheckpoint.workspace,
      });
      checkpointRequestBuilder.recordCheckpoint?.(wakeResetCheckpoint);
      activeWorkspace = wakeResetCheckpoint.workspace;
    }
    if (input.request.processingMode === "inbox_media_retention") {
      return await runHostedInboxMediaRetentionOnlyCheckpoint({
        assertRuntimeNotAborted,
        canonicalWriteRunnerInput: {
          checkpointRuntimeRedactedStatus,
          checkpointRequestBuilder,
          expectedUserId: input.request.userId,
          importItem: importMailboxItem,
          limitPerLane: mailboxBudget.fetchLimitPerLane,
          materializeWorkspaceArtifacts: restored.materializeWorkspaceArtifacts,
          platform: {
            ...guardedRuntime.platform,
            mailboxPort: runnerMailboxPort,
            workspacePort: foregroundWorkspacePort,
          },
          requestId,
          runtimeLogContext,
          runtimeWakeSignal: options.runtimeWakeSignal ?? null,
          signal: runtimeAbortController.signal,
          withCanonicalWritePersistence,
          vaultRoot: restored.vaultRoot,
          workspace: activeWorkspace,
        },
        checkpointRequestBuilder,
        expectedUserId: input.request.userId,
        input,
        issueExportPort: runtime.platform.issueExportPort ?? null,
        materializeWorkspaceArtifacts: restored.materializeWorkspaceArtifacts,
        runtimeAbortSignal: runtimeAbortController.signal,
        shutdownSignal: options.shutdownSignal ?? null,
        vaultRoot: restored.vaultRoot,
        wakeSignal: options.runtimeWakeSignal ?? null,
        workspace: activeWorkspace,
        workspacePort: foregroundWorkspacePort,
      });
    }
    const foregroundRunnerWorkspacePort: HostedRuntimePlatform["workspacePort"] = {
      read: () => guardedWorkspacePort.read!(),
      async checkpoint() {
        throw new TypeError("Foreground hosted runner must not checkpoint workspace.");
      },
    };
    type InvocationAssistantTarget = Pick<
      HostedRuntimeAssistantConfigurationSnapshot,
      "model" | "reasoningEffort"
    >;
    let confirmedAssistantTarget: InvocationAssistantTarget | null = null;
    const readConfirmedAssistantTarget = (): InvocationAssistantTarget | null =>
      confirmedAssistantTarget;
    const assistantConfigurationToolPort =
      guardedRuntime.platform.assistantConfigurationToolPort ?? null;
    let assistantProviderHandoffRequested = false;
    const invocationAssistantConfigurationToolPort: HostedRuntimePlatform[
      "assistantConfigurationToolPort"
    ] = assistantConfigurationToolPort
      ? {
          async request(request) {
            const response = await assistantConfigurationToolPort.request(request);
            if (
              request.action === "update"
              && response.action === "update"
              && (response.result.status === "updated"
                || response.result.status === "unchanged")
            ) {
              confirmedAssistantTarget = {
                model: response.result.model,
                reasoningEffort: response.result.reasoningEffort,
              };
            }
            return response;
          },
        }
      : null;
    const runnerPlatform = {
      ...guardedRuntime.platform,
      ...(invocationAssistantConfigurationToolPort
        ? { assistantConfigurationToolPort: invocationAssistantConfigurationToolPort }
        : {}),
      mailboxPort: runnerMailboxPort,
      workspacePort: foregroundRunnerWorkspacePort,
    };
    const foregroundRuntime = {
      ...guardedRuntime,
      platform: runnerPlatform,
    };
    const baseRunnerInput: HostedWorkspaceRunnerInput = {
      checkpointRuntimeRedactedStatus,
      checkpointRequestBuilder,
      expectedUserId: input.request.userId,
      foregroundImportItem: importForegroundMailboxItem,
      importItem: importMailboxItem,
      limitPerLane: mailboxBudget.fetchLimitPerLane,
      materializeWorkspaceArtifacts: restored.materializeWorkspaceArtifacts,
      trackDeferredUsageCapture,
      trackLocalWorkspaceMutationCompletion,
      platform: runnerPlatform,
      requestId,
      runtimeWakeSignal: options.runtimeWakeSignal ?? null,
      signal: runtimeAbortController.signal,
      runtimeLogContext,
      withCanonicalWritePersistence,
      vaultRoot: restored.vaultRoot,
      workspace: activeWorkspace,
    };
    const imageCodexModelCatalogJson =
      process.env[HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]?.trim();
    const imageHealthCommonsPackageRoot =
      process.env["MURPH_HEALTH_COMMONS_PACKAGE_ROOT"]?.trim();
    const baseRuntimeEnv = {
      ...projectHostedRuntimeTrustStoreEnv(process.env),
      ...guardedRuntime.forwardedEnv,
      ...guardedRuntime.userEnv,
      ...(isMurphAndroidAppEnabled(guardedRuntime.platformEnv)
        ? { [MURPH_ANDROID_APP_ENABLED_ENV]: "1" }
        : {}),
      ...(imageCodexModelCatalogJson
        ? { [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]: imageCodexModelCatalogJson }
        : {}),
      ...(imageHealthCommonsPackageRoot
        ? { MURPH_HEALTH_COMMONS_PACKAGE_ROOT: imageHealthCommonsPackageRoot }
        : {}),
    };
    const systemMailboxProcessingMode =
      input.request.processingMode === "system_mailbox";
    let hostedCodexRuntime: Awaited<
      ReturnType<typeof prepareHostedCodexRuntimeEnvironment>
    > | null = null;
    if (!systemMailboxProcessingMode) {
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
      hostedCodexRuntime = await prepareHostedCodexRuntimeEnvironment({
        operatorHomeRoot: restored.operatorHomeRoot,
        runtimeEnv: baseRuntimeEnv,
      });
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
    }
    const invocationRuntimeEnv = hostedCodexRuntime?.runtimeEnv
      ?? projectHostedRuntimeProcessEnvironment({
        runtimeEnv: baseRuntimeEnv,
      });
    assertRuntimeNotAborted();
    const initialMailboxImportPlan = resolveHostedInitialMailboxImportPlan({
      vaultRoot: restored.vaultRoot,
    });
    if (
      (input.request.processingMode ?? "default") === "default"
      && !initialMailboxImportPlan.bootstrapRequired
    ) {
      if (!hostedCodexRuntime) {
        throw new TypeError("Default hosted runtime processing requires Codex setup.");
      }
      const preparedHostedCodexRuntime = hostedCodexRuntime;
      startCodexProcessPreparationForConversation = (channel) => {
        if (codexProcessPreparationStart) {
          return;
        }
        if (channel !== "linq" && channel !== "telegram") {
          codexProcessPreparationStart = Promise.resolve(null);
          return;
        }
        codexProcessPreparationStart = (async () => {
          try {
            const target = await readHostedAssistantExecutionDefaultTarget({
              homeDirectory: restored.operatorHomeRoot,
              runtimeEnv: preparedHostedCodexRuntime.runtimeEnv,
            });
            assertRuntimeNotAborted();
            if (!target) {
              return null;
            }
            const turnEnvironment = createHostedAssistantTurnEnvironment({
              operatorHomeRoot: restored.operatorHomeRoot,
              runtimeEnv: preparedHostedCodexRuntime.runtimeEnv,
              vaultRoot: restored.vaultRoot,
            });
            return await prepareHostedCodexAssistantProcess({
              env: turnEnvironment.env,
              signal: runtimeAbortController.signal,
              target,
              workingDirectory: restored.vaultRoot,
            });
          } catch {
            // Process preparation is only a latency optimization. Foreground
            // execution remains authoritative for config errors and startup.
            return null;
          }
        })();
      };
    }
    assertRuntimeNotAborted();
    const initialMailboxImportLanes =
      input.request.processingMode === "system_mailbox"
        ? (["system"] as const)
        : initialMailboxImportPlan.lanes;
    const initialPendingRuntimeWake = consumePendingHostedRuntimeWake(
      options.runtimeWakeSignal ?? null,
      options.shutdownSignal ?? null,
    );
    const returnSystemMailboxBeforeInitialImport =
      input.request.processingMode === "system_mailbox"
        ? async () => {
            const projectedWake = await resolveHostedSystemMailboxProcessingModeWake({
              mailboxImportRetryAt: null,
              nowMs: Date.now(),
              operatorHomeRoot: restored.operatorHomeRoot,
              runtimeEnv: invocationRuntimeEnv,
              vaultRoot: restored.vaultRoot,
            });
            const returnedWake = selectEarliestHostedRuntimeWake([
              {
                at: projectedWake.nextWakeAt,
                reason: projectedWake.nextWakeReason,
              },
              {
                at: activeWorkspace?.inboxMediaRetentionWakeAt ?? null,
                reason: activeWorkspace?.inboxMediaRetentionWakeAt
                  ? "inbox_media_retention"
                  : null,
              },
            ]);
            const redactedStatus = await withHostedSystemMailboxHandledThroughStatus({
              redactedStatus: activeWorkspace?.redactedStatus ?? null,
              vaultRoot: restored.vaultRoot,
            });
            const invocationResult = {
              immediateRecheckRequested: true as const,
              nextWakeAt: returnedWake.nextWakeAt,
              ...(returnedWake.nextWakeReason
                ? { nextWakeReason: returnedWake.nextWakeReason }
                : {}),
              redactedStatus,
              status: resolveHostedWorkspaceInvocationStatus({
                mailboxBudgetExhausted: mailboxBudgetExhausted(),
                nextWakeAt: returnedWake.nextWakeAt,
              }),
            };
            emitPhaseLog({
              details: {
                immediateRecheckRequested: true,
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
        : null;
    if (
      returnSystemMailboxBeforeInitialImport
      && initialPendingRuntimeWake !== null
    ) {
      return await returnSystemMailboxBeforeInitialImport();
    }
    const initialMailboxImportContext = createHostedRuntimeWakeInitialImportContext(
      mergeHostedRuntimeWakeLatencySeeds(
        initialPendingRuntimeWake,
        invocationOrchestrationLatencySeed,
      ),
    );
    emitPhaseLog({
      details: {
        initialMailboxImportLanes: [...initialMailboxImportLanes],
        mailboxLimitPerLane: mailboxBudget.fetchLimitPerLane,
      },
      input,
      requestId,
      stage: "mailbox.import.initial",
      status: "start",
    });
    // Mailbox import can mutate the restored vault through the inbox sidecar.
    // Keep the container's single-runner ownership until that work settles so
    // an aborted invocation cannot write into a newer restore at the same path.
    let initialMailboxImportResult: HostedInitialMailboxImportResult;
    if (returnSystemMailboxBeforeInitialImport === null) {
      initialMailboxImportResult = await importHostedInitialMailboxForWorkspaceRunner({
        importItemContext: initialMailboxImportContext,
        lanes: initialMailboxImportLanes,
        prefetchLanes: HOSTED_FOREGROUND_MAILBOX_PREFETCH_LANES,
        runnerInput: baseRunnerInput,
        requestId,
      });
    } else {
      const initialMailboxFetchWakeInterruption =
        createHostedRuntimeCheckpointWakeInterruption({
          enabled: true,
          runtimeWakeSignal: options.runtimeWakeSignal ?? null,
        });
      const restoreInitialMailboxFetchWake = (
        notification: RuntimeWakeNotification | null,
      ) => {
        if (!notification || options.shutdownSignal?.aborted === true) {
          return;
        }
        options.runtimeWakeSignal?.notify({
          ...(notification.orchestration
            ? { orchestration: notification.orchestration }
            : {}),
          notifiedAtEpochMs: notification.notifiedAtEpochMs,
        });
        if (
          notification.latestNotifiedAtEpochMs !== undefined
          && notification.latestNotifiedAtEpochMs !== notification.notifiedAtEpochMs
        ) {
          options.runtimeWakeSignal?.notify(notification.latestNotifiedAtEpochMs);
        }
      };
      try {
        initialMailboxImportResult = await importHostedInitialMailboxForWorkspaceRunner({
          importItemContext: initialMailboxImportContext,
          lanes: initialMailboxImportLanes,
          mailboxFetchSignal: initialMailboxFetchWakeInterruption.signal,
          prefetchLanes: initialMailboxImportLanes,
          runnerInput: baseRunnerInput,
          requestId,
        });
      } catch (error) {
        await initialMailboxFetchWakeInterruption.dispose();
        const notification = initialMailboxFetchWakeInterruption.takeNotification();
        if (
          notification
          && options.shutdownSignal?.aborted !== true
          && error instanceof HostedRuntimeCheckpointInterruptedByWakeError
        ) {
          return await returnSystemMailboxBeforeInitialImport();
        }
        restoreInitialMailboxFetchWake(notification);
        throw error;
      }
      await initialMailboxFetchWakeInterruption.dispose();
      restoreInitialMailboxFetchWake(
        initialMailboxFetchWakeInterruption.takeNotification(),
      );
    }
    const initialMailboxImportDoneAtMonotonicMs =
      readAssistantProviderStartMonotonicTickMs();
    assertRuntimeNotAborted();
    activeWorkspace = initialMailboxImportResult.workspace ?? activeWorkspace;
    const initialMailboxImport = initialMailboxImportResult.result;
    const mailboxImportDoneAt = new Date().toISOString();
    const initialProviderStartCriticalPath =
      (initialMailboxImport.importResult.assistantInputIds?.length ?? 0) > 0
        ? createAssistantProviderStartCriticalPathContext(
            initialMailboxImportDoneAtMonotonicMs,
          )
        : null;
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
    let initialMailboxImportPostCheckpointEffectsFinished = false;
    const returnInitialMailboxImportBeforeForeground = async () => {
      const redactedStatus = buildHostedMailboxImportRedactedStatus(
        initialMailboxImport.importResult,
      );
      const systemMailboxWake = await resolveDeferredMailboxImportSystemMailboxWake(
        initialMailboxImport.importResult,
        restored.vaultRoot,
      );
      const assistantCronWake =
        input.request.processingMode === "system_mailbox"
          ? await resolveHostedAssistantCronWakeAfterInitialImport({
              operatorHomeRoot: restored.operatorHomeRoot,
              runtimeEnv: invocationRuntimeEnv,
              vaultRoot: restored.vaultRoot,
            })
          : null;
      const nextWake = input.request.processingMode === "system_mailbox"
        ? await resolveHostedSystemMailboxProcessingModeWake({
            mailboxImportRetryAt: initialMailboxImport.importResult.nextRetryAt ?? null,
            nowMs: Date.now(),
            operatorHomeRoot: restored.operatorHomeRoot,
            runtimeEnv: invocationRuntimeEnv,
            vaultRoot: restored.vaultRoot,
          })
        : resolveHostedWorkspaceRunNextWake({
            assistantPhaseResult: null,
            committedWorkspace: activeWorkspace,
            mailboxImportRetryAt: initialMailboxImport.importResult.nextRetryAt ?? null,
            nowMs: Date.now(),
          });
      const stagedAssistantInput =
        hostedMailboxImportStagedConversationInput(initialMailboxImport);
      const checkpointNextWake = selectEarliestHostedRuntimeWake([
        {
          at: nextWake.nextWakeAt,
          reason: nextWake.nextWakeReason,
        },
        {
          at: systemMailboxWake.at,
          reason: systemMailboxWake.reason,
        },
        {
          at: assistantCronWake?.at ?? null,
          reason: assistantCronWake?.reason ?? null,
        },
        {
          at: stagedAssistantInput ? new Date().toISOString() : null,
          reason: stagedAssistantInput ? "assistant" : null,
        },
      ]);
      const returnedNextWake = selectEarliestHostedRuntimeWake([
        {
          at: checkpointNextWake.nextWakeAt,
          reason: checkpointNextWake.nextWakeReason,
        },
        {
          at: activeWorkspace?.inboxMediaRetentionWakeAt ?? null,
          reason: activeWorkspace?.inboxMediaRetentionWakeAt
            ? "inbox_media_retention"
            : null,
        },
      ]);
      const initialMailboxImportRequiresCheckpoint = initialMailboxImport.checkpointDeferred
        && initialMailboxImport.stateChanged;
      const hostedVaultStartupPreparationRequiresCheckpoint =
        hostedVaultStartupPreparation.mutated;

      if (
        initialMailboxImportRequiresCheckpoint
        || hostedVaultStartupPreparationRequiresCheckpoint
      ) {
        emitPhaseLog({
          details: {
            nextWakeAtPresent: checkpointNextWake.nextWakeAt !== null,
            nextWakeReasonPresent: checkpointNextWake.nextWakeReason !== null,
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
          nextWakeAt: checkpointNextWake.nextWakeAt,
          nextWakeReason: checkpointNextWake.nextWakeReason,
          inboxMediaRetentionWakeAt: activeWorkspace?.inboxMediaRetentionWakeAt ?? null,
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
        initialMailboxImportPostCheckpointEffectsFinished = true;
        await finishHostedMailboxImportPostCheckpointEffects({
          importResult: initialMailboxImport,
          runnerInput: baseRunnerInput,
          signal: runtimeAbortController.signal,
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
        const checkpointDefaultWakeKey = buildHostedRuntimeWakeKey({
          nextWakeAt: checkpoint.workspace.nextWakeAt ?? null,
          nextWakeReason: checkpoint.workspace.nextWakeReason ?? null,
        });
        const immediateRecheckCandidate =
          checkpointDefaultWakeKey !== null
          && (
            checkpointDefaultWakeKey !== startingDefaultWakeKey
            || stagedAssistantInput
          );
        const checkpointRedactedStatus =
          checkpoint.workspace.redactedStatus ?? redactedStatus;
        const immediateRecheckRequested =
          immediateRecheckCandidate
          && !isHostedRuntimeFutureMailboxContinuation({
            nextWakeAt: checkpointReturnedNextWake.nextWakeAt,
            nextWakeReason: checkpointReturnedNextWake.nextWakeReason,
            redactedStatus: checkpointRedactedStatus,
          });
        const invocationResult = {
          ...(immediateRecheckRequested
            ? { immediateRecheckRequested: true as const }
            : {}),
          nextWakeAt: checkpointReturnedNextWake.nextWakeAt,
          ...(checkpointReturnedNextWake.nextWakeReason
            ? { nextWakeReason: checkpointReturnedNextWake.nextWakeReason }
            : {}),
          redactedStatus: checkpointRedactedStatus,
          status: resolveHostedWorkspaceInvocationStatus({
            mailboxBudgetExhausted: mailboxBudgetExhausted(),
            nextWakeAt: checkpointReturnedNextWake.nextWakeAt,
          }),
        };
        emitPhaseLog({
          details: {
            immediateRecheckRequested,
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
        ...(returnedNextWake.nextWakeReason
          ? { nextWakeReason: returnedNextWake.nextWakeReason }
          : {}),
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
    const returnSystemMailboxProcessingModeAfterInitialImport = async () => {
      let currentRedactedStatus = buildHostedMailboxImportRedactedStatus(
        initialMailboxImport.importResult,
      );
      let importOrStartupCheckpointPending =
        initialMailboxImport.checkpointDeferred && initialMailboxImport.stateChanged
        || hostedVaultStartupPreparation.mutated;
      let checkpointed = false;
      let foregroundWakeObserved = false;
      const consumeForegroundWake = (): boolean => {
        if (foregroundWakeObserved) {
          return true;
        }
        const notification = consumePendingRuntimeWakeUnlessShuttingDown({
          runtimeWakeSignal: options.runtimeWakeSignal ?? null,
          shutdownSignal: options.shutdownSignal ?? null,
        });
        if (!notification) {
          return false;
        }
        foregroundWakeObserved = true;
        return true;
      };
      const shouldYieldSystemMailboxWork = (): boolean => consumeForegroundWake();
      const resolveSystemMailboxModeWake = async (
        extraCandidates: readonly HostedRuntimeWakeCandidate[] = [],
      ) => await resolveHostedSystemMailboxProcessingModeWake({
        extraCandidates,
        mailboxImportRetryAt: initialMailboxImport.importResult.nextRetryAt ?? null,
        nowMs: Date.now(),
        operatorHomeRoot: restored.operatorHomeRoot,
        runtimeEnv: invocationRuntimeEnv,
        vaultRoot: restored.vaultRoot,
      });
      let systemMailboxPostRecordWake: HostedRuntimeWakeCandidate | null = null;
      const rememberSystemMailboxPostRecordWake = (
        candidate: HostedRuntimeWakeCandidate,
      ) => {
        if (!candidate.at) {
          return;
        }
        systemMailboxPostRecordWake = selectHostedRuntimeWakeCandidate([
          systemMailboxPostRecordWake,
          candidate,
        ]);
      };
      const resolveCurrentSystemMailboxModeWake = async (
        extraCandidates: readonly HostedRuntimeWakeCandidate[] = [],
      ) => await resolveSystemMailboxModeWake([
        ...(systemMailboxPostRecordWake?.at ? [systemMailboxPostRecordWake] : []),
        ...extraCandidates,
      ]);
      const finishInitialImportEffectsOnce = async () => {
        if (!checkpointed) {
          return;
        }
        if (!initialMailboxImportPostCheckpointEffectsFinished) {
          initialMailboxImportPostCheckpointEffectsFinished = true;
          await finishHostedMailboxImportPostCheckpointEffects({
            importResult: initialMailboxImport,
            runnerInput: baseRunnerInput,
            signal: runtimeAbortController.signal,
          });
        }
      };
      const checkpointSystemMailboxMode = async (
        systemMailboxCheckpointStage: string,
        extraCandidates: readonly HostedRuntimeWakeCandidate[] = [],
        checkpointSignal: AbortSignal | null = null,
      ): Promise<HostedWorkspaceCheckpointResponse> => {
        const checkpointWake = await resolveCurrentSystemMailboxModeWake(extraCandidates);
        emitPhaseLog({
          details: {
            nextWakeAtPresent: checkpointWake.nextWakeAt !== null,
            nextWakeReasonPresent: checkpointWake.nextWakeReason !== null,
            systemMailboxCheckpointStage,
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
          checkpointSignal,
          expectedUserId: input.request.userId,
          inboxMediaRetentionWakeAt: activeWorkspace?.inboxMediaRetentionWakeAt ?? null,
          issueExportPort: runtime.platform.issueExportPort ?? null,
          nextWakeAt: checkpointWake.nextWakeAt,
          nextWakeReason: checkpointWake.nextWakeReason,
          redactedStatus: currentRedactedStatus,
          runtimeAbortSignal: runtimeAbortController.signal,
          vaultRoot: restored.vaultRoot,
          workspacePort: foregroundWorkspacePort,
        });
        emitPhaseLog({
          details: {
            checkpointed: checkpoint.checkpointed,
            checkpointWorkspaceVersion: checkpoint.workspace.version,
            systemMailboxCheckpointStage,
          },
          input,
          phase: "checkpoint",
          requestId,
          stage: "workspace.checkpoint.idle_shutdown",
          status: "done",
        });
        checkpointed = true;
        importOrStartupCheckpointPending = false;
        activeWorkspace = checkpoint.workspace;
        currentRedactedStatus = checkpoint.workspace.redactedStatus ?? currentRedactedStatus;
        if (checkpoint.conversationInputAhead === true) {
          foregroundWakeObserved = true;
        }
        await finishInitialImportEffectsOnce();
        return checkpoint;
      };
      const returnSystemMailboxModeResult = async (
        extraCandidates: readonly HostedRuntimeWakeCandidate[] = [],
      ): Promise<HostedWorkspaceInvocationResult> => {
        const projectedWake = await resolveCurrentSystemMailboxModeWake(extraCandidates);
        const returnedWake = selectEarliestHostedRuntimeWake([
          {
            at: projectedWake.nextWakeAt,
            reason: projectedWake.nextWakeReason,
          },
          {
            at: activeWorkspace?.inboxMediaRetentionWakeAt ?? null,
            reason: activeWorkspace?.inboxMediaRetentionWakeAt
              ? "inbox_media_retention"
              : null,
          },
        ]);
        const invocationResult = {
          ...(foregroundWakeObserved ? { immediateRecheckRequested: true as const } : {}),
          nextWakeAt: returnedWake.nextWakeAt,
          ...(returnedWake.nextWakeReason
            ? { nextWakeReason: returnedWake.nextWakeReason }
            : {}),
          redactedStatus: currentRedactedStatus,
          status: resolveHostedWorkspaceInvocationStatus({
            mailboxBudgetExhausted: mailboxBudgetExhausted(),
            nextWakeAt: returnedWake.nextWakeAt,
          }),
        };
        emitPhaseLog({
          details: {
            immediateRecheckRequested: foregroundWakeObserved,
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
      const runSystemMailboxLifecycleItem = async (inputItem: {
        allowedRouteActions: HostedSystemMailboxPreparationInput["allowedRouteActions"];
        allowedWakeKinds: HostedSystemMailboxPreparationInput["allowedWakeKinds"];
        stagePrefix: string;
      }): Promise<{
        preempted: boolean;
        prepared: boolean;
      }> => {
        if (consumeForegroundWake()) {
          return { preempted: true, prepared: false };
        }
        return await withCanonicalWritePersistence(async () => {
          const persistedPreparation = await runHostedWorkspaceCanonicalWriteAtBoundary({
            previousRedactedStatus: currentRedactedStatus,
            runnerInput: {
              ...baseRunnerInput,
              workspace: activeWorkspace,
            },
            write: async () => await prepareHostedSystemMailboxItemForCheckpoint({
              allowedRouteActions: inputItem.allowedRouteActions,
              allowedWakeKinds: inputItem.allowedWakeKinds,
              operatorHomeRoot: restored.operatorHomeRoot,
              retainProcessedItemUntilRecorded: true,
              runtime: foregroundRuntime,
              runtimeEnv: invocationRuntimeEnv,
              shouldYieldBackgroundMaintenance: shouldYieldSystemMailboxWork,
              signal: runtimeAbortController.signal,
              vaultRoot: restored.vaultRoot,
            }),
          });
          const preparation = persistedPreparation.result;
          if (persistedPreparation.canonicalWritePersisted) {
            activeWorkspace = persistedPreparation.workspace;
            currentRedactedStatus =
              persistedPreparation.redactedStatus
              ?? persistedPreparation.workspace?.redactedStatus
              ?? currentRedactedStatus;
          }
          if (preparation?.status === "preempted") {
            return { preempted: true, prepared: true };
          }
          const preparationWake =
            resolveHostedSystemMailboxCheckpointPreparationWake(preparation);
          const projectedWake = await resolveCurrentSystemMailboxModeWake(
            preparationWake ? [preparationWake] : [],
          );
          const mustCheckpoint = importOrStartupCheckpointPending
            || hostedSystemMailboxCheckpointPreparationNeedsCheckpoint(preparation)
            || hostedSystemMailboxWakeChangedFromWorkspace({
              nextWakeAt: projectedWake.nextWakeAt,
              nextWakeReason: projectedWake.nextWakeReason,
              workspace: activeWorkspace,
            });
          if (mustCheckpoint) {
            await checkpointSystemMailboxMode(
              `${inputItem.stagePrefix}.checkpoint.prepare`,
              preparationWake ? [preparationWake] : [],
            );
          }
          if (hostAbortObserved || consumeForegroundWake()) {
            return { preempted: true, prepared: preparation !== null };
          }
          const recordItem = readHostedSystemMailboxCheckpointPreparationRecordItem(preparation);
          if (!recordItem) {
            return { preempted: false, prepared: preparation !== null };
          }
          emitPhaseLog({
            details: {
              workspacePresent: activeWorkspace !== null,
              workspaceVersion: activeWorkspace?.version ?? null,
            },
            input,
            requestId,
            stage: "browser_vault.refresh",
            status: "start",
          });
          let refresh: HostedBrowserVaultReplicaRefreshResult;
          try {
            refresh = await refreshHostedBrowserVaultReplicaFromRuntime({
              force: true,
              generatedAt: new Date().toISOString(),
              platform: foregroundRuntime.platform,
              runtimeWakeSignal: options.runtimeWakeSignal ?? null,
              signal: hostAbortSignal
                ? AbortSignal.any([runtimeAbortController.signal, hostAbortSignal])
                : runtimeAbortController.signal,
              timeoutMs: null,
              vaultRoot: restored.vaultRoot,
              workspace: activeWorkspace,
            });
            emitPhaseLog({
              details: buildHostedBrowserVaultRefreshLogDetails(refresh),
              input,
              requestId,
              stage: "browser_vault.refresh",
              status: "done",
            });
          } catch (error) {
            emitPhaseLog({
              error,
              input,
              requestId,
              stage: "browser_vault.refresh",
              status: "fail",
            });
            throw attachHostedRuntimeFailurePhase(error, "browser_vault.refresh");
          }
          if (hostedBrowserVaultReplicaRefreshRequiresRetry(refresh)) {
            if (refresh.status === "deferred_runtime_wake") {
              foregroundWakeObserved = true;
            }
            consumeForegroundWake();
            return {
              preempted: foregroundWakeObserved || hostAbortObserved,
              prepared: true,
            };
          }
          const recordWakeInterruption = createHostedRuntimeCheckpointWakeInterruption({
            enabled: true,
            runtimeWakeSignal: options.runtimeWakeSignal ?? null,
          });
          const recordSignal = recordWakeInterruption.signal
            ? AbortSignal.any([
                runtimeAbortController.signal,
                recordWakeInterruption.signal,
              ])
            : runtimeAbortController.signal;
          try {
            const recordResult = await recordHostedSystemMailboxItemAfterCheckpoint({
              item: recordItem,
              operatorHomeRoot: restored.operatorHomeRoot,
              runtime: foregroundRuntime,
              signal: recordSignal,
              vaultRoot: restored.vaultRoot,
            });
            const recordWake = selectHostedRuntimeWakeCandidate([
              createHostedRuntimeWakeCandidate(
                recordResult.nextWakeAt,
                recordResult.nextWakeReason ?? null,
              ),
              recordItem.postCheckpointRecord
                ? null
                : preparationWake,
            ]);
            rememberSystemMailboxPostRecordWake(recordWake);
            await checkpointSystemMailboxMode(
              `${inputItem.stagePrefix}.checkpoint.record`,
              recordWake.at ? [recordWake] : [],
              recordWakeInterruption.signal,
            );
          } catch (error) {
            await recordWakeInterruption.dispose();
            if (recordWakeInterruption.takeNotification()) {
              foregroundWakeObserved = true;
              return { preempted: true, prepared: true };
            }
            throw error;
          }
          await recordWakeInterruption.dispose();
          if (recordWakeInterruption.takeNotification()) {
            foregroundWakeObserved = true;
          }
          return { preempted: foregroundWakeObserved, prepared: true };
        });
      };

      if (consumeForegroundWake()) {
        return await returnSystemMailboxModeResult();
      }

      const devicePass = await runSystemMailboxLifecycleItem({
        allowedRouteActions: HOSTED_SYSTEM_MAILBOX_DEVICE_SYNC_ROUTE_ACTIONS,
        allowedWakeKinds: HOSTED_SYSTEM_MAILBOX_DEVICE_SYNC_WAKE_KINDS,
        stagePrefix: "system_mailbox.device_sync",
      });
      assertRuntimeNotAborted();
      if (devicePass.preempted) {
        return await returnSystemMailboxModeResult();
      }

      const projectedWake = await resolveCurrentSystemMailboxModeWake();
      if (
        importOrStartupCheckpointPending
        || hostedSystemMailboxWakeChangedFromWorkspace({
          nextWakeAt: projectedWake.nextWakeAt,
          nextWakeReason: projectedWake.nextWakeReason,
          workspace: activeWorkspace,
        })
      ) {
        await checkpointSystemMailboxMode(
          "system_mailbox.checkpoint.projected_wake",
        );
      }

      if (consumeForegroundWake()) {
        return await returnSystemMailboxModeResult();
      }
      consumeForegroundWake();
      return await returnSystemMailboxModeResult();
    };
    if (initialMailboxImportResult.bootstrapPending) {
      return await returnInitialMailboxImportBeforeForeground();
    }
    if (input.request.processingMode === "system_mailbox") {
      return await returnSystemMailboxProcessingModeAfterInitialImport();
    }
    if (
      shouldCheckpointHostedReplayBudgetProgressBeforeForeground({
        mailboxBudgetExhausted: mailboxBudget.exhausted,
        result: initialMailboxImport,
      })
    ) {
      return await returnInitialMailboxImportBeforeForeground();
    }
    if (!hostedCodexRuntime) {
      throw new TypeError("Default hosted runtime processing requires Codex setup.");
    }
    const runtimeEnv = hostedCodexRuntime.runtimeEnv;
    const invocationAssistantProvider = runtimeEnv.HOSTED_ASSISTANT_PROVIDER;
    if (!isHostedAssistantProvider(invocationAssistantProvider)) {
      throw new TypeError(
        "Hosted runtime invocation assistant provider is not supported.",
      );
    }
    const readLiveAssistantProvider = async (): Promise<HostedAssistantProvider> => {
      if (!assistantConfigurationToolPort) {
        throw new AssistantActiveTurnInputUnavailableError(
          "Assistant provider choice is temporarily unavailable; retry the turn later.",
        );
      }
      let response: Awaited<
        ReturnType<typeof assistantConfigurationToolPort.request>
      >;
      try {
        response = await assistantConfigurationToolPort.request({ action: "read" });
      } catch {
        throw new AssistantActiveTurnInputUnavailableError(
          "Assistant provider choice is temporarily unavailable; retry the turn later.",
        );
      }
      if (response.action !== "read") {
        throw new AssistantActiveTurnInputUnavailableError(
          "Assistant provider choice is temporarily unavailable; retry the turn later.",
        );
      }
      return response.result.provider;
    };
    const resolveInvocationAssistantProviderAuthority = async (): Promise<
      "current" | "handoff"
    > => {
      const liveAssistantProvider = await readLiveAssistantProvider();
      if (liveAssistantProvider === invocationAssistantProvider) {
        return "current";
      }
      assistantProviderHandoffRequested = true;
      return "handoff";
    };
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
    const unservicedRecheckWakeKeys = new Set<string>();
    const recordUnservicedRecheckWake = (
      wake: HostedRuntimePendingWake,
    ): void => {
      const wakeKey = buildHostedRuntimeWakeKey(wake);
      if (wakeKey !== null) {
        unservicedRecheckWakeKeys.add(wakeKey);
      }
    };
    let runtimePassOrdinal = 0;
    const runWorkspaceForegroundPass = async (passInput: {
      foregroundCausalOnly?: boolean;
      initialAssistantInputBatch?: HostedWorkspaceRunnerAssistantInputBatch | null;
      initialMailboxImport?: HostedWorkspaceRunnerInput["initialMailboxImport"];
      initialMailboxImportContext?: HostedWorkspaceRunnerMailboxImportContext | null;
      initialMailboxImportLanes?: HostedWorkspaceRunnerInput["initialMailboxImportLanes"];
      initialMailboxPrefetch?: HostedMailboxPrefixPrefetch | null;
      providerStartCriticalPath?: AssistantProviderStartCriticalPathContext | null;
      requestId: string;
      signal?: AbortSignal;
      workspace: HostedWorkspaceState | null;
    }): Promise<HostedWorkspaceRunnerResult> => {
      const passSignal = passInput.signal ?? runtimeAbortController.signal;
      if (passSignal.aborted) {
        throw readHostedRuntimeAbortReason(passSignal);
      }
      const passOrdinal = runtimePassOrdinal + 1;
      runtimePassOrdinal = passOrdinal;
      const passStartedAtEpochMs = Date.now();
      const passForeground = hostedMailboxImportHasForegroundConversationWork(
        passInput.initialMailboxImport ?? null,
      ) || hostedAssistantInputBatchHasWork(passInput.initialAssistantInputBatch ?? null);
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
        let currentAssistantInputId: string | null = null;
        const passPromise = runHostedWorkspaceUntilIdleOrBudget({
          ...baseRunnerInput,
          initialAssistantInputBatch: passInput.initialAssistantInputBatch ?? null,
          initialMailboxImport: passInput.initialMailboxImport,
          initialMailboxImportContext: passInput.initialMailboxImportContext ?? null,
          initialMailboxImportLanes: passInput.initialMailboxImportLanes,
          initialMailboxPrefetch: passInput.initialMailboxPrefetch ?? null,
          requestId: passInput.requestId,
          ...(passInput.providerStartCriticalPath
            ? {
                providerStartCriticalPath:
                  passInput.providerStartCriticalPath,
              }
            : {}),
          runtimePassDiagnostics: {
            foreground: passForeground,
            ordinal: passOrdinal,
            startedAtEpochMs: passStartedAtEpochMs,
          },
          runAssistantPhase: async (phaseInput) => {
            currentAssistantInputId = null;
            const acceptedAssistantInputIds = new Set<string>();
            const releaseAcceptedImageGenerationInputs = async (
              inputIds: readonly string[],
            ) => {
              await imageGenerationController?.releaseAcceptedInputs(
                inputIds,
                async (inputId) =>
                  await hasCompleteAssistantAutoReplyDeliveryTerminalEvidence({
                    inputId,
                    vault: restored.vaultRoot,
                  }),
              );
            };
            // Retry any previously accepted completion whose terminal-evidence
            // read was incomplete or transiently unavailable before planning a
            // new turn, so stale advisory status cannot block another image.
            await releaseAcceptedImageGenerationInputs([]);
            try {
              const phaseAssistantTarget = readConfirmedAssistantTarget();
              const confirmedAssistantTargetEnv = phaseAssistantTarget
                ? {
                    HOSTED_ASSISTANT_MODEL: phaseAssistantTarget.model,
                    HOSTED_ASSISTANT_REASONING_EFFORT:
                      phaseAssistantTarget.reasoningEffort,
                  }
                : null;
              const phaseRuntime = confirmedAssistantTargetEnv
                ? {
                    ...foregroundRuntime,
                    forwardedEnv: {
                      ...foregroundRuntime.forwardedEnv,
                      ...confirmedAssistantTargetEnv,
                    },
                  }
                : foregroundRuntime;
              return await (
                options.runAssistantPhase ?? runHostedWorkspaceAssistantPhase
              )({
                ...phaseInput,
                foregroundCausalOnly:
                  passInput.foregroundCausalOnly === true,
                currentAssistantInputId: () => currentAssistantInputId,
                imageGenerationLauncher:
                  imageGenerationController?.launcher ?? null,
                deviceSyncMessagingReturnTarget,
                deviceSyncWorkspaceWakeHandled: deviceSyncWorkspaceWakeHandledUntilCheckpoint,
                request: input.request,
                restored,
                runtime: phaseRuntime,
                runtimeEnv: {
                  ...runtimeEnv,
                  ...(confirmedAssistantTargetEnv ?? {}),
                },
                beforeProviderAcceptedInputs: async ({
                  acceptedInputs,
                }) => {
                  if (
                    await resolveInvocationAssistantProviderAuthority()
                      === "handoff"
                  ) {
                    throw new AssistantActiveTurnInputUnavailableError(
                      "Assistant provider changed; retrying the turn with the saved provider.",
                    );
                  }
                  const acceptedInputsOnlyAssistant = acceptedInputs.every(
                    (acceptedInput) => acceptedInput.source === "assistant-input",
                  );
                  const assistantInputIds = acceptedInputs
                    .filter((acceptedInput) => acceptedInput.source === "assistant-input")
                    .map((acceptedInput) => acceptedInput.id);
                  for (const assistantInputId of assistantInputIds) {
                    acceptedAssistantInputIds.add(assistantInputId);
                  }
                  const acceptedInputContext =
                    await resolveHostedCurrentInputIdForAcceptedInputs({
                      assistantInputIds,
                      vaultRoot: restored.vaultRoot,
                    });
                  currentAssistantInputId = acceptedInputsOnlyAssistant
                    ? acceptedInputContext.currentInputId
                    : null;
                  if (acceptedInputContext.conversationActivity !== "not_observed") {
                    notifyHostedConversationActivityObservedBestEffort(
                      options.onConversationActivityObserved,
                      acceptedInputContext.conversationActivity,
                    );
                  }
                  consumeReadyImageCompletionInputs(assistantInputIds);
                  return () => {
                    currentAssistantInputId = null;
                  };
                },
                stagedDirtyAcks: stagedDeviceSyncDirtyAcks,
                suppressDirtyPendingFetch: suppressDirtyPendingFetchUntilCheckpoint,
                signal: passSignal,
              });
            } finally {
              currentAssistantInputId = null;
              // A reply can acquire terminal evidence before a later phase error.
              // Release invocation-local image status from that durable truth in
              // both success and failure paths; evidence read errors retain it.
              await releaseAcceptedImageGenerationInputs(
                [...acceptedAssistantInputIds],
              );
            }
          },
          signal: passSignal,
          workspace: passInput.workspace,
        });
        let passResult: HostedWorkspaceRunnerResult;
        try {
          passResult = await raceHostedRuntimeCancellation(passPromise, passSignal);
        } catch (error) {
          if (passSignal.aborted && hostAbortDuringCanonicalWritePersistence) {
            passResult = await passPromise;
          } else {
            throw error;
          }
        }
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
        throw attachHostedRuntimeFailurePhase(error, "foreground.pass");
      }
    };
    const runBrowserVaultRefreshMaintenance = async (maintenanceInput: {
      signal?: AbortSignal;
      workspace: HostedWorkspaceState | null;
    }): Promise<HostedBrowserVaultReplicaRefreshResult> => {
      const maintenanceSignal = maintenanceInput.signal ?? runtimeAbortController.signal;
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
      try {
        const refresh = await refreshHostedBrowserVaultReplicaFromRuntime({
          force: browserVaultReplicaRefreshRequested,
          generatedAt: new Date().toISOString(),
          platform: guardedRuntime.platform,
          runtimeWakeSignal: options.runtimeWakeSignal ?? null,
          signal: maintenanceSignal,
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
      } catch (error) {
        if (maintenanceSignal.aborted) {
          phaseLogger.close("browser_vault.refresh");
        } else {
          emitPhaseLog({
            error,
            input,
            requestId,
            stage: "browser_vault.refresh",
            status: "fail",
          });
        }
        throw attachHostedRuntimeFailurePhase(error, "browser_vault.refresh");
      }
    };
    const idleCheckpointDelayMs = resolveHostedRuntimeIdleCheckpointDelayMs(
      input.request.idleCheckpointDelayMs,
    );
    let result: HostedWorkspaceRunnerResult;
    let committedWorkspace = activeWorkspace;
    let pendingWake: HostedRuntimePendingWake = {
      nextWakeAt: committedWorkspace?.nextWakeAt ?? null,
      nextWakeReason: committedWorkspace?.nextWakeReason ?? null,
    };
    // Hold a later durable wake while its earlier assistant predecessor is
    // checkpointed and serviced.
    let pendingWakeAfterDueAssistantService: HostedRuntimeHeldDurableWake | null = null;
    let invocationLocalProjectedAssistantWakeKey: string | null = null;
    let hotProjectedAssistantWakeAttemptedKey: string | null = null;
    let durableCheckpointFollowUpPending = false;
    let redactedStatus: NonNullable<HostedWorkspaceInvocationResult["redactedStatus"]> = {};
    let invocationStatus: HostedWorkspaceInvocationResult["status"] =
      resolveHostedWorkspaceInvocationStatus({
        mailboxBudgetExhausted: mailboxBudgetExhausted(),
        nextWakeAt: pendingWake.nextWakeAt,
      });
    let runtimeStateDirty =
      canonicalWriteReceiptRecoveryFailed
      || readHostedCanonicalWriteReceiptLogStatusFingerprint(
        activeWorkspace?.redactedStatus ?? null,
      ) !== null;
    const pendingDurableCheckpointEffects: HostedWorkspaceDurableCheckpointEffect[] = [];
    let idleCheckpointStartByMs: number | null = null;
    let idleWakeOrdinal = 0;
    const publishCheckpointPublicationExpectation = (
      checkpointStartByMs: number,
    ) => {
      recordHostedRuntimeLatencyMilestoneBestEffort({
        at: new Date(resolveHostedRuntimeCheckpointPublicationExpectedByMs({
          checkpointStartByMs,
          commitTimeoutMs: runtime.commitTimeoutMs,
        })).toISOString(),
        latencyTracePort: runtime.platform.latencyTracePort,
        milestone: "checkpoint_publication_expected_by",
        runtimeAttemptId: input.request.attemptId,
      });
    };
    const setIdleCheckpointStartBy = (checkpointStartByMs: number) => {
      idleCheckpointStartByMs = checkpointStartByMs;
      publishCheckpointPublicationExpectation(checkpointStartByMs);
    };
    const ensureIdleCheckpointStartBy = (checkpointStartByMs: number) => {
      if (idleCheckpointStartByMs === null) {
        setIdleCheckpointStartBy(checkpointStartByMs);
      }
    };
    const markIdleCheckpointTimerAfterDirtyWork = () => {
      setIdleCheckpointStartBy(
        Date.now() + (assistantProviderHandoffRequested ? 0 : idleCheckpointDelayMs),
      );
    };
    if (runtimeStateDirty) {
      markIdleCheckpointTimerAfterDirtyWork();
    }
    const imageGenerationSignal = options.shutdownSignal
      ? AbortSignal.any([
          runtimeAbortController.signal,
          options.shutdownSignal,
        ])
      : runtimeAbortController.signal;
    const { createHostedImageGenerationController } = await import(
      "./hosted-runtime/image-generation.ts"
    );
    imageGenerationController = createHostedImageGenerationController({
      notifyReady() {
        options.runtimeWakeSignal?.notify();
      },
      onStarted() {
        runtimeStateDirty = true;
        markIdleCheckpointTimerAfterDirtyWork();
      },
      recordRuntimeIssue(issue) {
        recordAssistantRuntimeIssueInputsBestEffort({
          issues: [issue],
          policy: resolveAssistantDiagnosticsPolicy({
            channel: null,
            env: baseRuntimeEnv,
            executionContext: {
              hosted: {
                memberId: input.request.userId,
                userEnvKeys: Object.keys(runtime.userEnv),
              },
            },
          }),
          vault: restored.vaultRoot,
        });
      },
      signal: imageGenerationSignal,
      shutdownSignal: options.shutdownSignal ?? null,
      vaultRoot: restored.vaultRoot,
      withCanonicalWritePersistence,
    });
    detachedAssistantAskController = createHostedDetachedAssistantAskController({
      assistantAskPort: runtime.platform.assistantAskPort ?? null,
      createGroupSharedReader() {
        return createHostedGroupSharedReader({
          groupToolPort: runtime.platform.groupToolPort ?? null,
        });
      },
      codexHome: hostedCodexRuntime.codexHome,
      deferUsageUntilAfterDurableCheckpoint(effect) {
        pendingDurableCheckpointEffects.push(effect);
      },
      env: hostedCodexRuntime.runtimeEnv,
      memberId: input.request.userId,
      model: hostedCodexRuntime.runtimeEnv.HOSTED_ASSISTANT_MODEL ?? null,
      modelProvider:
        hostedCodexRuntime.runtimeEnv[
          HOSTED_CODEX_EFFECTIVE_MODEL_PROVIDER_ID_ENV
        ] ?? null,
      onStateMutation() {
        runtimeStateDirty = true;
        markIdleCheckpointTimerAfterDirtyWork();
        options.runtimeWakeSignal?.notify();
      },
      resolveProviderAuthority:
        resolveInvocationAssistantProviderAuthority,
      usageRecordPort: runtime.platform.usageRecordPort ?? null,
      userEnvKeys: Object.keys(runtime.userEnv),
      vaultRoot: restored.vaultRoot,
    });
    pauseDetachedAssistantAskBeforeWorkspaceBoundary = async () => {
      await detachedAssistantAskController?.pauseAndRequeue();
    };
    resumeDetachedAssistantAskAfterWorkspaceBoundary = () => {
      if (
        !runtimeAbortController.signal.aborted
        && options.shutdownSignal?.aborted !== true
      ) {
        detachedAssistantAskController?.resume();
      }
    };
    closeDetachedAssistantAskBeforeWorkspaceRelease = async () => {
      await detachedAssistantAskController?.closeAndRequeue();
    };
    // Resume an exact request retained by an interrupted earlier invocation.
    // kick() only owns the invocation-local promise; it never awaits the ask.
    detachedAssistantAskController.kick();
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
      const shutdownWasSignaled = () => options.shutdownSignal?.aborted === true;
      while (pendingCompletions.size > 0) {
        if (shutdownWasSignaled()) {
          return { kind: "finished" };
        }
        const effectsFinished = Promise.all([
          ...pendingCompletions,
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
        if (shutdownWasSignaled()) {
          return { kind: "finished" };
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
      invocationLocalProjectedAssistantWakeKey = null;
      redactedStatus = workspace.redactedStatus
        ?? omitHostedCanonicalWriteReceiptLogStatusFields(redactedStatus)
        ?? {};
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
      if (durableWake.nextWakeAt !== null) {
        // The selected predecessor is the next step required to expose a
        // masked durable continuation. Presenting it removes only that key;
        // the durable wake stays marked until it is committed or serviced.
        recordUnservicedRecheckWake(pendingWake);
        recordUnservicedRecheckWake(durableWake);
      }
      pendingWakeAfterDueAssistantService = durableWakeFollowsDueAssistant
        ? {
            durableWake: copyHostedRuntimePendingWake(durableWake),
          }
        : null;
      invocationLocalProjectedAssistantWakeKey = null;
      durableCheckpointFollowUpPending = true;
      runtimeStateDirty = true;
      ensureIdleCheckpointStartBy(Date.now());
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
        ensureIdleCheckpointStartBy(Date.now());
        return;
      }
      const pendingAssistantWakeMs = pendingWake.nextWakeAt === null
        ? Number.NaN
        : Date.parse(pendingWake.nextWakeAt);
      const heldDurableWakeMs = heldWake.durableWake.nextWakeAt === null
        ? Number.NaN
        : Date.parse(heldWake.durableWake.nextWakeAt);
      if (
        hostedRuntimeWakeReasonIsAssistant(pendingWake.nextWakeReason)
        && Number.isFinite(pendingAssistantWakeMs)
        && Number.isFinite(heldDurableWakeMs)
        && pendingAssistantWakeMs <= heldDurableWakeMs
      ) {
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
        ensureIdleCheckpointStartBy(Date.now());
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
    type HostedVaultShareOfferWake = {
      initialMailboxPrefetch: HostedMailboxPrefixPrefetch | null;
      latencySeed: HostedRuntimeWakeLatencySeed;
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
    const classifyHostedPostCheckpointWake = async (input: {
      latencySeed: HostedRuntimeWakeLatencySeed;
      requestId: string;
    }): Promise<{
      containsOnlyBrowserVaultRefreshWakes: boolean;
      containsOnlyDeviceSyncDirtyWakes: boolean;
      wake: HostedVaultShareOfferWake;
    }> => {
      try {
        const initialMailboxPrefetch = await createHostedForegroundMailboxPrefetch({
          lanes: HOSTED_FOREGROUND_MAILBOX_PREFETCH_LANES,
          limitPerLane: mailboxBudget.fetchLimitPerLane,
          requestId: input.requestId,
          runnerInput: baseRunnerInput,
        });
        const inspection =
          await inspectHostedPreCheckpointSystemMailboxPrefetch(
            initialMailboxPrefetch,
          );
        return {
          containsOnlyBrowserVaultRefreshWakes:
            inspection.containsOnlyBrowserVaultRefreshWakes,
          containsOnlyDeviceSyncDirtyWakes:
            inspection.containsOnlyDeviceSyncDirtyWakes,
          wake: {
            initialMailboxPrefetch,
            latencySeed: input.latencySeed,
          },
        };
      } catch {
        // Empty, mixed, or uninspectable wakes preserve foreground priority.
        return {
          containsOnlyBrowserVaultRefreshWakes: false,
          containsOnlyDeviceSyncDirtyWakes: false,
          wake: {
            initialMailboxPrefetch: null,
            latencySeed: input.latencySeed,
          },
        };
      }
    };
    let vaultShareWakeClassificationOrdinal = 0;
    const offerHostedVaultShareProjectionDuringIdle = async (input: {
      deferDeviceSyncWakes?: boolean;
      deferredDeviceSyncWake?: HostedVaultShareOfferWake | null;
    } = {}): Promise<HostedVaultShareOfferWake | null> => {
      const vaultSharePort = guardedRuntime.platform.vaultSharePort ?? null;
      if (!vaultSharePort) {
        return input.deferredDeviceSyncWake ?? null;
      }

      let deferredDeviceSyncWake = input.deferredDeviceSyncWake ?? null;
      const shutdownWasSignaled = (): boolean =>
        options.shutdownSignal?.aborted === true;
      const classifyWake = async (
        latencySeed: HostedRuntimeWakeLatencySeed,
      ): Promise<{
        mayWaitForProjection: boolean;
        wake: HostedVaultShareOfferWake;
      }> => {
        const foregroundWake = {
          initialMailboxPrefetch: null,
          latencySeed: deferredDeviceSyncWake?.latencySeed ?? latencySeed,
        };
        if (
          input.deferDeviceSyncWakes !== true
          || shutdownWasSignaled()
        ) {
          return {
            mayWaitForProjection: false,
            wake: foregroundWake,
          };
        }
        vaultShareWakeClassificationOrdinal += 1;
        const classification = await classifyHostedPostCheckpointWake({
          latencySeed,
          requestId:
            `${requestId}:vault-share-wake-classify:${vaultShareWakeClassificationOrdinal}`,
        });
        return {
          mayWaitForProjection:
            !shutdownWasSignaled()
            && classification.containsOnlyDeviceSyncDirtyWakes,
          wake: {
            ...classification.wake,
            latencySeed: deferredDeviceSyncWake?.latencySeed ?? latencySeed,
          },
        };
      };
      const rememberDeferredDeviceSyncWake = (
        wake: HostedVaultShareOfferWake,
      ): void => {
        deferredDeviceSyncWake = wake;
      };
      const pendingWakeLatencySeed = consumePendingHostedRuntimeWake(
        options.runtimeWakeSignal ?? null,
        options.shutdownSignal ?? null,
      );
      if (pendingWakeLatencySeed) {
        const classification = await classifyWake(pendingWakeLatencySeed);
        if (!classification.mayWaitForProjection) {
          return classification.wake;
        }
        rememberDeferredDeviceSyncWake(classification.wake);
      }
      if (shutdownWasSignaled()) {
        return deferredDeviceSyncWake;
      }

      const offer = offerHostedVaultShareProjectionBestEffort({
        vaultRoot: restored.vaultRoot,
        vaultSharePort,
      });
      const runtimeWakeSignal = options.runtimeWakeSignal ?? null;
      if (!runtimeWakeSignal) {
        const offerSignal = options.shutdownSignal
          ? AbortSignal.any([runtimeAbortController.signal, options.shutdownSignal])
          : runtimeAbortController.signal;
        try {
          logHostedVaultShareProjectionOfferOutcome(
            await raceHostedRuntimeCancellation(offer, offerSignal),
          );
        } catch (error) {
          if (shutdownWasSignaled() && !runtimeAbortController.signal.aborted) {
            return deferredDeviceSyncWake;
          }
          throw error;
        }
        return deferredDeviceSyncWake;
      }

      type VaultShareOfferWaitResult =
        | { kind: "external_wake"; notification: RuntimeWakeNotification }
        | { kind: "finished" }
        | {
          kind: "offer";
          offer: Awaited<ReturnType<typeof offerHostedVaultShareProjectionBestEffort>>;
        };

      const offerWithAbort = raceHostedRuntimeCancellation(
        offer,
        runtimeAbortController.signal,
      );
      const offerResult = offerWithAbort.then((vaultShareOffer) => ({
        kind: "offer" as const,
        offer: vaultShareOffer,
      }));
      while (true) {
        if (shutdownWasSignaled()) {
          void offerWithAbort.then(logHostedVaultShareProjectionOfferOutcome, () => undefined);
          return deferredDeviceSyncWake;
        }

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
        if (shutdownWasSignaled()) {
          abortWakeAfterShutdown();
        }
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
          waitResult = await Promise.race([offerResult, wake]);
        } finally {
          runtimeAbortController.signal.removeEventListener("abort", abortWake);
          options.shutdownSignal?.removeEventListener("abort", abortWakeAfterShutdown);
          if (!wakeAbortController.signal.aborted) {
            wakeAbortController.abort();
          }
        }

        if (waitResult.kind === "external_wake") {
          const latencySeed = createHostedRuntimeWakeLatencySeed(waitResult.notification);
          if (!latencySeed) {
            continue;
          }
          const classification = await classifyWake(latencySeed);
          if (!classification.mayWaitForProjection) {
            void offerWithAbort.then(logHostedVaultShareProjectionOfferOutcome, () => undefined);
            return classification.wake;
          }
          rememberDeferredDeviceSyncWake(classification.wake);
          continue;
        }

        const deliveredWakeResult = await wake;
        if (deliveredWakeResult.kind === "external_wake") {
          const latencySeed = createHostedRuntimeWakeLatencySeed(
            deliveredWakeResult.notification,
          );
          if (latencySeed) {
            const classification = await classifyWake(latencySeed);
            if (!classification.mayWaitForProjection) {
              return classification.wake;
            }
            rememberDeferredDeviceSyncWake(classification.wake);
          }
        }

        if (waitResult.kind === "offer") {
          logHostedVaultShareProjectionOfferOutcome(waitResult.offer);
        } else {
          void offerWithAbort.then(logHostedVaultShareProjectionOfferOutcome, () => undefined);
          return deferredDeviceSyncWake;
        }

        const finalWakeLatencySeed = consumePendingHostedRuntimeWake(
          options.runtimeWakeSignal ?? null,
          options.shutdownSignal ?? null,
        );
        if (finalWakeLatencySeed) {
          const classification = await classifyWake(finalWakeLatencySeed);
          if (!classification.mayWaitForProjection) {
            return classification.wake;
          }
          rememberDeferredDeviceSyncWake(classification.wake);
        }
        return deferredDeviceSyncWake;
      }
    };
    const overlayPendingWakeOnCommittedWorkspace = (
      checkpointPendingBeforePass: boolean,
      presentedInvocationLocalProjectedAssistantWakeKey: string | null,
    ): HostedWorkspaceState | null => {
        if (committedWorkspace === null) {
          return null;
        }
        let passWake = pendingWake;
        if (presentedInvocationLocalProjectedAssistantWakeKey !== null) {
          return {
            ...committedWorkspace,
            nextWakeAt: pendingWake.nextWakeAt,
            nextWakeReason: pendingWake.nextWakeReason,
            redactedStatus: overlayHostedRuntimePendingRedactedStatus({
              committedStatus: committedWorkspace.redactedStatus ?? null,
              pendingStatus: redactedStatus,
            }),
          };
        }
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
          redactedStatus: overlayHostedRuntimePendingRedactedStatus({
            committedStatus: committedWorkspace.redactedStatus ?? null,
            pendingStatus: redactedStatus,
          }),
        };
      };
      let readyImageCompletionInputBatch:
        HostedWorkspaceRunnerAssistantInputBatch | null = null;
      const flushImageGenerationWork = async (): Promise<void> => {
        const controller = imageGenerationController;
        if (!controller) {
          return;
        }
        const canonicalWriteCount = await controller.flushCanonicalWrites(
          async (write, metadata) => {
            const workspace = mergeGeneratedImageRetentionWakeIntoWorkspace(
              overlayPendingWakeOnCommittedWorkspace(runtimeStateDirty, null),
              metadata.retentionWakeAt,
            );
            const persisted = await runHostedWorkspaceCanonicalWriteAtBoundary({
              previousRedactedStatus: workspace?.redactedStatus ?? redactedStatus,
              runnerInput: {
                ...baseRunnerInput,
                workspace,
              },
              write,
            });
            if (persisted.canonicalWritePersisted && persisted.workspace) {
              rebaseCommittedWorkspace(persisted.workspace);
            } else {
              redactedStatus = mergeHostedWorkspaceInvocationRedactedStatus(
                redactedStatus,
                persisted.redactedStatus ?? {},
              );
            }
          },
        );
        const stagedInputIds = await controller.stageCompleted();
        if (canonicalWriteCount > 0 || stagedInputIds.length > 0) {
          runtimeStateDirty = true;
          markIdleCheckpointTimerAfterDirtyWork();
        }
        if (stagedInputIds.length > 0) {
          readyImageCompletionInputBatch = {
            assistantInputIds: [
              ...(readyImageCompletionInputBatch?.assistantInputIds ?? []),
              ...stagedInputIds,
            ],
            emailDeliveryContexts: [],
            linqDeliveryContexts: [],
          };
        }
      };
      const prependReadyImageCompletionInputs = (
        batch: HostedWorkspaceRunnerAssistantInputBatch | null,
      ): HostedWorkspaceRunnerAssistantInputBatch | null => {
        const completionBatch = readyImageCompletionInputBatch;
        if (!completionBatch || completionBatch.assistantInputIds.length === 0) {
          return batch;
        }
        if (!batch || batch.assistantInputIds.length === 0) {
          return completionBatch;
        }
        const readBatchRecords = (
          inputBatch: HostedWorkspaceRunnerAssistantInputBatch,
        ) => inputBatch.assistantInputRecords
          ? [...inputBatch.assistantInputRecords]
          : inputBatch.assistantInputIds.map((assistantInputId, index) => ({
              assistantInputId,
              ...(inputBatch.emailDeliveryContexts[index]
                ? {
                    emailDeliveryContext:
                      inputBatch.emailDeliveryContexts[index],
                  }
                : {}),
              ...(inputBatch.linqDeliveryContexts[index]
                ? {
                    linqDeliveryContext:
                      inputBatch.linqDeliveryContexts[index],
                  }
                : {}),
            }));
        const completionInputIdSet = new Set(
          completionBatch.assistantInputIds,
        );
        const combinedRecords = [
          ...readBatchRecords(completionBatch),
          ...readBatchRecords(batch).filter((record) =>
            !completionInputIdSet.has(record.assistantInputId)
          ),
        ];
        return {
          assistantInputIds: combinedRecords.map((record) =>
            record.assistantInputId
          ),
          assistantInputRecords: combinedRecords,
          emailDeliveryContexts: combinedRecords.flatMap((record) =>
            record.emailDeliveryContext ? [record.emailDeliveryContext] : []
          ),
          linqDeliveryContexts: combinedRecords.flatMap((record) =>
            record.linqDeliveryContext ? [record.linqDeliveryContext] : []
          ),
        };
      };
      const consumeReadyImageCompletionInputs = (
        acceptedInputIds: readonly string[],
      ): void => {
        const readyBatch = readyImageCompletionInputBatch;
        if (!readyBatch) {
          return;
        }
        const acceptedInputIdSet = new Set(acceptedInputIds);
        const retainedInputIds = readyBatch.assistantInputIds.filter(
          (inputId) => !acceptedInputIdSet.has(inputId),
        );
        if (retainedInputIds.length === readyBatch.assistantInputIds.length) {
          return;
        }
        readyImageCompletionInputBatch = retainedInputIds.length === 0
          ? null
          : {
              ...readyBatch,
              assistantInputIds: retainedInputIds,
            };
      };
      const absorbForegroundPassResult = (
        passResult: HostedWorkspaceRunnerResult,
        passWorkspace: HostedWorkspaceState | null,
        previousPendingWake: HostedRuntimePendingWake,
        presentedInvocationLocalProjectedAssistantWakeKey: string | null,
        preserveDueAssistantWakeOnNoProgress: boolean,
      ): void => {
        const checkpointPendingBeforePass = runtimeStateDirty;
        const previousInvocationLocalProjectedAssistantWakeKey =
          invocationLocalProjectedAssistantWakeKey;
        const previousPendingWakeKey = buildHostedRuntimeWakeKey(previousPendingWake);
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
        const invocationLocalAssistantWakeAt =
          passResult.assistantPhaseResult?.invocationLocalAssistantWakeAt ?? null;
        const passProjectedAssistantWakeKey =
          invocationLocalAssistantWakeAt !== null
          && passResult.assistantPhaseResult?.nextWakeAt === invocationLocalAssistantWakeAt
          && hostedRuntimeWakeReasonIsAssistant(
            passResult.assistantPhaseResult.nextWakeReason ?? null,
          )
            ? buildHostedRuntimeWakeKey({
                nextWakeAt: invocationLocalAssistantWakeAt,
                nextWakeReason: passResult.assistantPhaseResult.nextWakeReason ?? null,
              })
            : null;
        const passProducedDefaultWake =
          replaceWake
          || passProjectedAssistantWakeKey !== null
          || passResult.mailboxRetryAt !== null
          || (passResult.latestMailboxImport.importResult.nextRetryAt ?? null) !== null;
        const presentedDefaultWakeKey =
          passResult.assistantPhaseResult
          && hostedRuntimeWakeIsDue(passWorkspace?.nextWakeAt ?? null)
            ? buildHostedRuntimeWakeKey({
                nextWakeAt: passWorkspace?.nextWakeAt ?? null,
                nextWakeReason: passWorkspace?.nextWakeReason ?? null,
              })
            : null;
        if (presentedDefaultWakeKey !== null) {
          unservicedRecheckWakeKeys.delete(presentedDefaultWakeKey);
        }
        const wakeResolution = resolvePendingWakeAfterForegroundPass({
          assistantProjectedWakeKey: passProjectedAssistantWakeKey,
          checkpointPendingBeforePass,
          passWake,
          presentedInvocationLocalProjectedAssistantWakeKey,
          previousPendingWake,
          preserveDueAssistantWakeOnNoProgress,
          replaceWake,
          nowMs: Date.now(),
        });
        pendingWake = wakeResolution.pendingWake;
        if (passProducedDefaultWake && passWake.nextWakeAt !== null) {
          recordUnservicedRecheckWake(passWake);
        }
        if (passResult.assistantPhaseResult !== null) {
          reconcilePendingWakeAfterDueAssistantPass({
            preservedDueAssistantWakeOnNoProgress:
              wakeResolution.preservedDueAssistantWakeOnNoProgress,
          });
        }
        const pendingWakeKey = buildHostedRuntimeWakeKey(pendingWake);
        const committedWakeKey = buildHostedRuntimeWakeKey({
          nextWakeAt: committedWorkspace?.nextWakeAt ?? null,
          nextWakeReason: committedWorkspace?.nextWakeReason ?? null,
        });
        const passProjectedAssistantWake =
          passProjectedAssistantWakeKey !== null
          && pendingWakeKey !== null
          && pendingWakeKey === passProjectedAssistantWakeKey
          && hostedRuntimeWakeReasonIsAssistant(pendingWake.nextWakeReason);
        if (passProjectedAssistantWake) {
          const preservesUnprovenPreviousWake =
            pendingWakeKey === previousPendingWakeKey
            && previousInvocationLocalProjectedAssistantWakeKey !== previousPendingWakeKey;
          invocationLocalProjectedAssistantWakeKey =
            pendingWakeKey !== presentedDefaultWakeKey
              && pendingWakeKey !== committedWakeKey
              && !preservesUnprovenPreviousWake
              ? pendingWakeKey
              : null;
        } else if (pendingWakeKey !== invocationLocalProjectedAssistantWakeKey) {
          invocationLocalProjectedAssistantWakeKey = null;
        }
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
        foregroundCausalOnly?: boolean;
        initialAssistantInputBatch?: HostedWorkspaceRunnerAssistantInputBatch | null;
        initialMailboxImport?: HostedWorkspaceRunnerInput["initialMailboxImport"];
        initialMailboxImportContext?: HostedWorkspaceRunnerMailboxImportContext | null;
        initialMailboxImportLanes?: HostedWorkspaceRunnerInput["initialMailboxImportLanes"];
        initialMailboxPrefetch?: HostedMailboxPrefixPrefetch | null;
        providerStartCriticalPath?: AssistantProviderStartCriticalPathContext | null;
        latencySeed?: HostedRuntimeWakeLatencySeed | null;
        invocationLocalProjectedAssistantWakeKey?: string | null;
        preserveDueAssistantWakeOnNoProgress?: boolean;
        requestIdKind: "checkpoint-interrupt" | "checkpoint-wake" | "idle-wake";
        signal?: AbortSignal;
      }): Promise<HostedWorkspaceRunnerResult> => {
        const resolveForegroundRerunAssistantInputBatch = (
          passResult: HostedWorkspaceRunnerResult,
        ): HostedWorkspaceRunnerAssistantInputBatch | null =>
          hostedAssistantInputBatchHasWork(passResult.latestAssistantInputBatch)
            ? passResult.latestAssistantInputBatch
            : null;
        const shouldContinueForegroundCausalPass = (
          passResult: HostedWorkspaceRunnerResult,
        ): boolean =>
          wakeInput.foregroundCausalOnly === true
          && passResult.assistantPhaseResult?.progressed === true
          && !mailboxBudgetExhausted()
          && readHostedWorkspaceInvocationRedactedNumber(
            buildHostedWorkspaceRunnerRedactedStatus(passResult),
            "hostedSystemMailboxRetryableFailed",
          ) === 0;
        const runSingleForegroundPass = async (
          singleWakeInput: typeof wakeInput,
        ): Promise<HostedWorkspaceRunnerResult> => {
          idleWakeOrdinal += 1;
          const previousPendingWake = pendingWake;
          const checkpointPendingBeforePass = runtimeStateDirty;
          const requestedInvocationLocalProjectedAssistantWakeKey =
            singleWakeInput.invocationLocalProjectedAssistantWakeKey ?? null;
          const presentedInvocationLocalProjectedAssistantWakeKey =
            requestedInvocationLocalProjectedAssistantWakeKey !== null
            && requestedInvocationLocalProjectedAssistantWakeKey
              === buildHostedRuntimeWakeKey(previousPendingWake)
            && hostedRuntimeWakeReasonIsAssistant(previousPendingWake.nextWakeReason)
            && hostedRuntimeWakeIsDue(previousPendingWake.nextWakeAt)
              ? requestedInvocationLocalProjectedAssistantWakeKey
              : null;
          const passWorkspace = overlayPendingWakeOnCommittedWorkspace(
            checkpointPendingBeforePass,
            presentedInvocationLocalProjectedAssistantWakeKey,
          );
          result = await runWorkspaceForegroundPass({
            foregroundCausalOnly:
              singleWakeInput.foregroundCausalOnly === true,
            initialAssistantInputBatch: singleWakeInput.initialAssistantInputBatch ?? null,
            initialMailboxImport: singleWakeInput.initialMailboxImport ?? null,
            initialMailboxImportContext: singleWakeInput.initialMailboxImportContext
              ?? createHostedRuntimeWakeInitialImportContext(singleWakeInput.latencySeed ?? null),
            initialMailboxImportLanes: singleWakeInput.initialMailboxImportLanes,
            initialMailboxPrefetch: singleWakeInput.initialMailboxPrefetch ?? null,
            ...(singleWakeInput.providerStartCriticalPath
              ? {
                  providerStartCriticalPath:
                    singleWakeInput.providerStartCriticalPath,
                }
              : {}),
            requestId: `${requestId}:${singleWakeInput.requestIdKind}:${idleWakeOrdinal}`,
            signal: singleWakeInput.signal,
            workspace: passWorkspace,
          });
          absorbForegroundPassResult(
            result,
            passWorkspace,
            previousPendingWake,
            presentedInvocationLocalProjectedAssistantWakeKey,
            singleWakeInput.preserveDueAssistantWakeOnNoProgress === true,
          );
          return result;
        };

        let passResult = await runSingleForegroundPass(wakeInput);
        // Generation can finish during a provider pass. Stage it before
        // choosing the rerun batch so it enters the next Codex context ahead
        // of conversation input captured by the live foreground watcher.
        await flushImageGenerationWork();
        // irreducible: "late foreground input during system work runs before idle checkpointing" fails without this.
        let rerunAssistantInputBatch =
          assistantProviderHandoffRequested
            ? null
            : prependReadyImageCompletionInputs(
                resolveForegroundRerunAssistantInputBatch(passResult),
              );
        let continueForegroundCausalPass =
          !assistantProviderHandoffRequested
          && shouldContinueForegroundCausalPass(passResult);
        while (
          options.shutdownSignal?.aborted !== true
          && (rerunAssistantInputBatch || continueForegroundCausalPass)
        ) {
          // The mailbox-import boundary belongs only to the first foreground
          // pass. A rerun is a new causal pass and must not inherit that tick.
          passResult = await runSingleForegroundPass({
            foregroundCausalOnly:
              rerunAssistantInputBatch === null
              && wakeInput.foregroundCausalOnly === true,
            initialAssistantInputBatch: rerunAssistantInputBatch,
            initialMailboxImport: passResult.latestMailboxImport,
            initialMailboxImportContext:
              wakeInput.initialMailboxImportContext?.assistantAskRequestTargetKind
                ? {
                    assistantAskRequestTargetKind:
                      wakeInput.initialMailboxImportContext
                        .assistantAskRequestTargetKind,
                  }
                : null,
            latencySeed: wakeInput.latencySeed ?? null,
            requestIdKind: "checkpoint-interrupt",
            signal: wakeInput.signal,
          });
          await flushImageGenerationWork();
          rerunAssistantInputBatch =
            assistantProviderHandoffRequested
              ? null
              : prependReadyImageCompletionInputs(
                  resolveForegroundRerunAssistantInputBatch(passResult),
                );
          continueForegroundCausalPass =
            !assistantProviderHandoffRequested
            && shouldContinueForegroundCausalPass(passResult);
        }
        return passResult;
      };
      const runForegroundMailboxWakeIfWork = async (input: {
        includeReadyImageCompletion?: boolean;
        initialMailboxPrefetch?: HostedMailboxPrefixPrefetch | null;
        latencySeed: HostedRuntimeWakeLatencySeed | null;
        rearmIdleCheckpointAfterEmptyProbe: boolean;
        requestIdKind: "checkpoint-interrupt" | "checkpoint-wake" | "idle-wake";
        runAssistantWithoutMailboxWork?: boolean;
        shouldContinue?: () => boolean;
        signal?: AbortSignal;
        systemMailboxAdmission: "all" | "pre_checkpoint_safe";
      }): Promise<boolean> => {
        if (assistantProviderHandoffRequested) {
          return false;
        }
        // Graceful shutdown hands staged work to the durable checkpoint before
        // this invocation starts another assistant or provider turn.
        const shouldContinue = () =>
          options.shutdownSignal?.aborted !== true
          && (input.shouldContinue?.() ?? true);
        const runtimeStateDirtyBeforeMailboxImport = runtimeStateDirty;
        let invocationLocalAssistantInputBatch:
          HostedWorkspaceRunnerAssistantInputBatch | null = null;
        const stageMailboxImportWake = async (
          mailboxImport: HostedMailboxImportCheckpointResult,
        ): Promise<void> => {
          const wakeCandidates = [
            {
              at: pendingWake.nextWakeAt,
              reason: pendingWake.nextWakeReason,
            },
          ];
          if (hostedMailboxImportStagedConversationInput(mailboxImport)) {
            wakeCandidates.push({
              at: new Date().toISOString(),
              reason: "assistant",
            });
          }
          const systemMailboxWake = await resolveDeferredMailboxImportSystemMailboxWake(
            mailboxImport.importResult,
            restored.vaultRoot,
          );
          wakeCandidates.push({
            at: systemMailboxWake.at,
            reason: systemMailboxWake.reason,
          });
          pendingWake = selectEarliestHostedRuntimeWake(wakeCandidates);
          if (pendingWake.nextWakeAt !== null) {
            invocationStatus = "scheduled";
            if (mailboxImport.stateChanged) {
              recordUnservicedRecheckWake(pendingWake);
            }
          }
        };
        const finishMailboxImportWithoutAssistant = async (
          mailboxImport: HostedMailboxImportCheckpointResult,
        ): Promise<void> => {
          await finishHostedMailboxImportPostCheckpointEffects({
            importResult: mailboxImport,
            runnerInput: baseRunnerInput,
            signal: runtimeAbortController.signal,
          });
          await stageMailboxImportWake(mailboxImport);
        };
        const deferCheckpointAfterEmptyForegroundProbe = (
          mailboxImport: HostedMailboxImportCheckpointResult,
        ): void => {
          if (
            input.rearmIdleCheckpointAfterEmptyProbe !== true
            || input.latencySeed === null
            || !shouldContinue()
          ) {
            return;
          }

          markIdleCheckpointTimerAfterDirtyWork();
          const importResult = mailboxImport.importResult;
          void writeHostedRuntimeLogBestEffort({
            entry: {
              ...buildHostedRuntimeLogContextFields(runtimeLogContext),
              component: "mailbox",
              eventCode: "mailbox.imported",
              level: "info",
              phase: "checkpoint",
              redactedJson: {
                assistantInputPresent:
                  (importResult.assistantInputIds?.length ?? 0) > 0,
                blockedCount: importResult.blocked.length,
                checkpointDeferred: true,
                conversationImportedCount:
                  importResult.conversationImportedCount ?? 0,
                conversationSeqEnd: mailboxImport.state.watermarks.conversation,
                conversationSeqStart:
                  mailboxImport.previousState.watermarks.conversation,
                fetchedCount: importResult.fetchedCount,
                foregroundProbeOutcome: "no_runnable_work",
                idleCheckpointTimerRearmed: true,
                importedCount: importResult.importedCount,
                runtimeWakePresent: true,
                stateChanged: mailboxImport.stateChanged,
              },
            },
            now: baseRunnerInput.now,
            platform: baseRunnerInput.platform,
          });
        };
        const runForegroundPassAfterMailboxImport = async (
          wakeInput: Parameters<typeof runForegroundPass>[0],
        ): Promise<HostedWorkspaceRunnerResult> => {
          const runtimeStateDirtyAfterMailboxImport = runtimeStateDirty;
          runtimeStateDirty = runtimeStateDirtyBeforeMailboxImport;
          try {
            return await runForegroundPass(wakeInput);
          } finally {
            runtimeStateDirty ||= runtimeStateDirtyAfterMailboxImport;
          }
        };
        if (!shouldContinue()) {
          return false;
        }
        // A wake that has started importing finishes before shutdown
        // checkpointing; shutdown only suppresses the follow-up assistant pass.
        const importSignal = runtimeAbortController.signal;
        const wakeInitialMailboxImportContext =
          createHostedRuntimeWakeInitialImportContext(input.latencySeed);
        const initialMailboxImportContext =
          input.systemMailboxAdmission === "pre_checkpoint_safe"
            ? {
                ...(wakeInitialMailboxImportContext ?? {}),
                assistantAskRequestTargetKind: "joined_group" as const,
              }
            : wakeInitialMailboxImportContext;
        const foregroundProbeRequestIdKind =
          input.rearmIdleCheckpointAfterEmptyProbe
            ? `${input.requestIdKind}-rearm`
            : input.requestIdKind;
        const initialMailboxPrefetch = input.initialMailboxPrefetch
          ?? await createHostedForegroundMailboxPrefetch({
            lanes: HOSTED_FOREGROUND_MAILBOX_PREFETCH_LANES,
            limitPerLane: mailboxBudget.fetchLimitPerLane,
            requestId:
              `${requestId}:${foregroundProbeRequestIdKind}-foreground-prefetch:${idleWakeOrdinal + 1}`,
            runnerInput: baseRunnerInput,
          });
        if (input.signal) {
          try {
            await raceHostedRuntimeCancellation(
              initialMailboxPrefetch.response,
              input.signal,
            );
          } catch (error) {
            if (input.signal.aborted) {
              throw error;
            }
            // The mailbox-import owner performs its existing one-shot refetch.
          }
        }
        if (!shouldContinue()) {
          return false;
        }
        const importMailboxLanes = async (
          lanes: readonly ("conversation" | "system")[],
          importItem: HostedWorkspaceRunnerInput["importItem"],
        ): Promise<HostedMailboxImportCheckpointResult> => {
          idleWakeOrdinal += 1;
          const previousPendingWake = pendingWake;
          const passWorkspace = overlayPendingWakeOnCommittedWorkspace(
            runtimeStateDirty,
            null,
          );
          result = await runHostedWorkspaceUntilIdleOrBudget({
            ...baseRunnerInput,
            deferInitialMailboxPostCheckpointEffects: true,
            importItem,
            initialMailboxImportContext,
            initialMailboxImportLanes: lanes,
            initialMailboxPrefetch,
            requestId:
              `${requestId}:${foregroundProbeRequestIdKind}-foreground-import:${idleWakeOrdinal}`,
            signal: importSignal,
            workspace: passWorkspace,
          });
          invocationLocalAssistantInputBatch =
            result.latestAssistantInputBatch
            ?? invocationLocalAssistantInputBatch;
          absorbForegroundPassResult(
            result,
            passWorkspace,
            previousPendingWake,
            null,
            false,
          );
          // Importing mailbox state never services an already-selected wake.
          pendingWake = selectEarliestHostedRuntimeWake([
            {
              at: previousPendingWake.nextWakeAt,
              reason: previousPendingWake.nextWakeReason,
            },
            {
              at: pendingWake.nextWakeAt,
              reason: pendingWake.nextWakeReason,
            },
          ]);
          if (pendingWake.nextWakeAt !== null && invocationStatus !== "budget_exhausted") {
            invocationStatus = "scheduled";
          }
          return result.initialMailboxImport;
        };
        const conversationImport = await importMailboxLanes(
          HOSTED_INITIAL_CONVERSATION_MAILBOX_IMPORT_LANES,
          importForegroundMailboxItem,
        );
        if (input.includeReadyImageCompletion === true) {
          invocationLocalAssistantInputBatch =
            prependReadyImageCompletionInputs(
              invocationLocalAssistantInputBatch,
            );
        }
        const preCheckpointSystemPrefetch =
          input.systemMailboxAdmission === "pre_checkpoint_safe"
          && runtimeStateDirtyBeforeMailboxImport
            ? await inspectHostedPreCheckpointSystemMailboxPrefetch(
                initialMailboxPrefetch,
              )
            : null;
        const hasForegroundConversationWork =
          hostedAssistantInputBatchHasWork(
            invocationLocalAssistantInputBatch,
          )
          || hostedMailboxImportHasForegroundConversationWork(
            conversationImport,
          );
        const shouldRunLocalPreCheckpointSystemWork =
          input.systemMailboxAdmission === "pre_checkpoint_safe"
          && !hasForegroundConversationWork
          && await hasHostedPreCheckpointLocalExternalCompletion({
            now: baseRunnerInput.now?.() ?? new Date().toISOString(),
            vaultRoot: restored.vaultRoot,
          });
        const shouldRunConversationAssistant = shouldContinue() && (
          input.runAssistantWithoutMailboxWork === true
          || hasForegroundConversationWork
          || shouldRunLocalPreCheckpointSystemWork
        );
        if (!shouldContinue()) {
          await finishMailboxImportWithoutAssistant(conversationImport);
          return false;
        }
        if (shouldRunConversationAssistant) {
          try {
            await runForegroundPassAfterMailboxImport({
              ...(shouldRunLocalPreCheckpointSystemWork
                ? { foregroundCausalOnly: true }
                : {}),
              initialAssistantInputBatch:
                invocationLocalAssistantInputBatch,
              initialMailboxImport: conversationImport,
              initialMailboxImportContext,
              initialMailboxPrefetch,
              latencySeed: input.latencySeed,
              requestIdKind: input.requestIdKind,
              signal: input.signal,
            });
          } catch (error) {
            if (!runtimeAbortController.signal.aborted && !shouldContinue()) {
              await stageMailboxImportWake(conversationImport);
            }
            throw error;
          }
          return true;
        }
        const shouldImportSystemMailbox = input.systemMailboxAdmission === "all"
          || preCheckpointSystemPrefetch?.containsOnlySafeSystemWakes === true;
        if (!shouldImportSystemMailbox) {
          if (preCheckpointSystemPrefetch?.hasSystemWork !== true) {
            deferCheckpointAfterEmptyForegroundProbe(conversationImport);
          }
          await finishMailboxImportWithoutAssistant(conversationImport);
          return false;
        }

        await finishMailboxImportWithoutAssistant(conversationImport);

        const systemImport = await importMailboxLanes(
          ["system"],
          importMailboxItem,
        );
        if (!shouldContinue()) {
          await finishMailboxImportWithoutAssistant(systemImport);
          return false;
        }
        if (
          !hostedAssistantInputBatchHasWork(
            invocationLocalAssistantInputBatch,
          )
          &&
          systemImport.importResult.importedCount === 0
          && !systemImport.importResult.blocked.some((item) => item.retryable)
        ) {
          deferCheckpointAfterEmptyForegroundProbe(systemImport);
          await finishMailboxImportWithoutAssistant(systemImport);
          return false;
        }
        try {
          await runForegroundPassAfterMailboxImport({
            foregroundCausalOnly:
              input.systemMailboxAdmission === "pre_checkpoint_safe",
            initialAssistantInputBatch:
              invocationLocalAssistantInputBatch,
            initialMailboxImport: systemImport,
            initialMailboxImportContext,
            latencySeed: input.latencySeed,
            requestIdKind: input.requestIdKind,
            signal: input.signal,
          });
        } catch (error) {
          if (!runtimeAbortController.signal.aborted && !shouldContinue()) {
            await stageMailboxImportWake(systemImport);
          }
          throw error;
        }
        return true;
      };
      const runPreCheckpointConversationWake = async (
        latencySeed: HostedRuntimeWakeLatencySeed | null,
        wakeOptions: {
          rearmIdleCheckpointAfterEmptyProbe?: boolean;
          shouldContinue?: () => boolean;
          signal?: AbortSignal;
        } = {},
      ): Promise<boolean> => {
        await flushImageGenerationWork();
        if (
          latencySeed !== null
          && !assistantProviderHandoffRequested
          && !runtimeAbortController.signal.aborted
          && options.shutdownSignal?.aborted !== true
        ) {
          try {
            if (await resolveInvocationAssistantProviderAuthority() === "handoff") {
              markIdleCheckpointTimerAfterDirtyWork();
              return false;
            }
          } catch {
            // A runtime wake is only a handoff hint. The provider-entry gate
            // remains the fail-closed authority when the live read is
            // temporarily unavailable.
          }
        }
        if (
          !assistantProviderHandoffRequested
          && options.shutdownSignal?.aborted !== true
          && !runtimeAbortController.signal.aborted
          && (wakeOptions.shouldContinue?.() ?? true)
          && hostedAssistantInputBatchHasWork(readyImageCompletionInputBatch)
        ) {
          return await runForegroundMailboxWakeIfWork({
            includeReadyImageCompletion: true,
            latencySeed,
            rearmIdleCheckpointAfterEmptyProbe:
              wakeOptions.rearmIdleCheckpointAfterEmptyProbe === true,
            requestIdKind: "checkpoint-interrupt",
            runAssistantWithoutMailboxWork: true,
            shouldContinue: wakeOptions.shouldContinue,
            signal: wakeOptions.signal,
            systemMailboxAdmission: "pre_checkpoint_safe",
          });
        }
        const ran = await runForegroundMailboxWakeIfWork({
          latencySeed,
          rearmIdleCheckpointAfterEmptyProbe:
            wakeOptions.rearmIdleCheckpointAfterEmptyProbe === true,
          requestIdKind: "checkpoint-interrupt",
          runAssistantWithoutMailboxWork:
            pendingWake.nextWakeAt !== null
              && hostedRuntimeWakeReasonIsAssistant(pendingWake.nextWakeReason)
              && !hostedRuntimeWakeIsDue(pendingWake.nextWakeAt)
              && !(
                hostedRuntimeWakeReasonIsAssistant(
                  committedWorkspace?.nextWakeReason ?? null,
                )
                && hostedRuntimeWakeIsDue(committedWorkspace?.nextWakeAt ?? null)
              ),
          shouldContinue: wakeOptions.shouldContinue,
          signal: wakeOptions.signal,
          systemMailboxAdmission: "pre_checkpoint_safe",
        });
        return ran;
      };
      const runPostCheckpointMailboxWake = async (input: {
        initialMailboxPrefetch?: HostedMailboxPrefixPrefetch | null;
        latencySeed: HostedRuntimeWakeLatencySeed | null;
        shouldContinue: () => boolean;
        signal: AbortSignal;
      }): Promise<boolean> => {
        return await runForegroundMailboxWakeIfWork({
          latencySeed: input.latencySeed,
          rearmIdleCheckpointAfterEmptyProbe: false,
          requestIdKind: "checkpoint-wake",
          initialMailboxPrefetch: input.initialMailboxPrefetch ?? null,
          shouldContinue: input.shouldContinue,
          signal: input.signal,
          systemMailboxAdmission: "all",
        });
      };
      const resolveHotProjectedAssistantWake = (): {
        key: string;
        wakeAtMs: number;
      } | null => {
        if (
          hotProjectedAssistantWakeAttemptedKey !== null
          || !runtimeStateDirty
          || invocationStatus === "budget_exhausted"
          || mailboxBudgetExhausted()
          || options.shutdownSignal?.aborted === true
          || pendingDurableCheckpointEffects.length > 0
          || durableCheckpointFollowUpPending
          || committedWorkspace === null
        ) {
          return null;
        }

        const pendingWakeKey = buildHostedRuntimeWakeKey(pendingWake);
        if (
          pendingWakeKey === null
          || pendingWakeKey !== invocationLocalProjectedAssistantWakeKey
          || !hostedRuntimeWakeReasonIsAssistant(pendingWake.nextWakeReason)
        ) {
          return null;
        }

        const committedWakeKey = buildHostedRuntimeWakeKey({
          nextWakeAt: committedWorkspace?.nextWakeAt ?? null,
          nextWakeReason: committedWorkspace?.nextWakeReason ?? null,
        });
        if (pendingWakeKey === committedWakeKey) {
          return null;
        }

        const wakeAtMs = Date.parse(pendingWake.nextWakeAt ?? "");
        if (
          !Number.isFinite(wakeAtMs)
          || idleCheckpointStartByMs === null
          || wakeAtMs >= idleCheckpointStartByMs
          || Date.now() >= idleCheckpointStartByMs
        ) {
          return null;
        }
        return {
          key: pendingWakeKey,
          wakeAtMs,
        };
      };

      result = await runForegroundPass({
        initialMailboxImport,
        initialMailboxImportContext,
        initialMailboxPrefetch: initialMailboxImportResult.prefetch,
        latencySeed: null,
        ...(initialProviderStartCriticalPath
          ? { providerStartCriticalPath: initialProviderStartCriticalPath }
          : {}),
        requestIdKind: "idle-wake",
      });
      const committedInboxMediaRetentionWakeDue = isHostedInboxMediaRetentionWakeDue({
        nowMs: Date.now(),
        workspace: committedWorkspace,
      });
      const runtimeDirtyAfterForeground = result.runtimeStateDirty
        || hostedVaultStartupPreparation.mutated;
      runtimeStateDirty ||= runtimeDirtyAfterForeground || committedInboxMediaRetentionWakeDue;
      if (runtimeDirtyAfterForeground) {
        markIdleCheckpointTimerAfterDirtyWork();
      } else if (committedInboxMediaRetentionWakeDue) {
        setIdleCheckpointStartBy(Date.now());
      }
      if (!runtimeStateDirty) {
        const vaultShareOfferWake =
          await offerHostedVaultShareProjectionDuringIdle();
        if (vaultShareOfferWake) {
          await runForegroundPass({
            initialMailboxPrefetch: vaultShareOfferWake.initialMailboxPrefetch,
            latencySeed: vaultShareOfferWake.latencySeed,
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
      if (!runtimeStateDirty) {
        // Closing is terminal for this invocation. Do it at the clean-return
        // decision point so a just-claimed request is requeued and included in
        // the same checkpoint loop before the restored workspace is released.
        await closeDetachedAssistantAskBeforeWorkspaceRelease();
      }
      while (runtimeStateDirty) {
        let checkpointWakeLatencySeed: HostedRuntimeWakeLatencySeed | null =
          pendingCheckpointWakeLatencySeed;
        pendingCheckpointWakeLatencySeed = null;
        if (idleCheckpointStartByMs === null) {
          throw new Error("Dirty hosted runtime is missing an idle checkpoint timer.");
        }
        await flushImageGenerationWork();
        if (
          hostedAssistantInputBatchHasWork(readyImageCompletionInputBatch)
          && await runPreCheckpointConversationWake(null)
        ) {
          continue;
        }
        const queuedWakeLatencySeed = consumePendingHostedRuntimeWake(
          options.runtimeWakeSignal ?? null,
          options.shutdownSignal ?? null,
        );
        if (queuedWakeLatencySeed) {
          if (await runPreCheckpointConversationWake(queuedWakeLatencySeed)) {
            continue;
          }
          checkpointWakeLatencySeed ??= queuedWakeLatencySeed;
        }
        if (preCheckpointExternalCompletionImported) {
          preCheckpointExternalCompletionImported = false;
          if (
            await hasHostedPreCheckpointLocalExternalCompletion({
              now: baseRunnerInput.now?.() ?? new Date().toISOString(),
              vaultRoot: restored.vaultRoot,
            })
            && await runPreCheckpointConversationWake(null)
          ) {
            continue;
          }
        }
        const hotProjectedAssistantWake = resolveHotProjectedAssistantWake();
        if (
          hotProjectedAssistantWake !== null
          && hotProjectedAssistantWake.wakeAtMs <= Date.now()
        ) {
          hotProjectedAssistantWakeAttemptedKey = hotProjectedAssistantWake.key;
          await runForegroundPass({
            invocationLocalProjectedAssistantWakeKey: hotProjectedAssistantWake.key,
            latencySeed: null,
            preserveDueAssistantWakeOnNoProgress: true,
            requestIdKind: "idle-wake",
          });
          pendingCheckpointWakeLatencySeed ??= checkpointWakeLatencySeed;
          continue;
        }
        const dirtyWaitResult = await waitForHostedRuntimeDirtyWindow({
          idleCheckpointStartByMs,
          projectedAssistantWakeAtMs: hotProjectedAssistantWake?.wakeAtMs ?? null,
          runtimeAbortSignal: runtimeAbortController.signal,
          runtimeWakeSignal: options.runtimeWakeSignal ?? null,
          shutdownSignal: options.shutdownSignal ?? null,
        });
        if (options.shutdownSignal?.aborted === true) {
          await flushImageGenerationWork();
          if (hostedAssistantInputBatchHasWork(readyImageCompletionInputBatch)) {
            pendingWake = selectEarliestHostedRuntimeWake([
              {
                at: pendingWake.nextWakeAt,
                reason: pendingWake.nextWakeReason,
              },
              {
                at: new Date().toISOString(),
                reason: "assistant",
              },
            ]);
          }
        }
        if (dirtyWaitResult.kind === "external_wake") {
          const latencySeed = createHostedRuntimeWakeLatencySeed(
            dirtyWaitResult.notification,
          );
          if (await runPreCheckpointConversationWake(latencySeed)) {
            continue;
          }
          pendingCheckpointWakeLatencySeed ??= latencySeed;
          continue;
        }
        if (dirtyWaitResult.kind === "projected_assistant_wake") {
          pendingCheckpointWakeLatencySeed ??= checkpointWakeLatencySeed;
          continue;
        }
        if (
          options.shutdownSignal?.aborted !== true
          && imageGenerationController?.hasCompleted()
        ) {
          continue;
        }
        if (
          options.shutdownSignal?.aborted !== true
          && imageGenerationController?.hasWork()
        ) {
          markIdleCheckpointTimerAfterDirtyWork();
          continue;
        }
        const dirtyWindowCheckpointTrigger = resolveHostedRuntimeIdleCheckpointTrigger({
          dirtyWaitResult,
        });
        let idleCheckpointWake: {
          inboxMediaRetentionWakeAt: string | null;
          nextWakeAt: string | null;
          nextWakeReason: string | null;
        };
        const mailboxEffectsWaitResult =
          dirtyWindowCheckpointTrigger === "shutdown_signal"
            ? { kind: "finished" as const }
            : await waitForMailboxPostCheckpointEffects();
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
          assistantProviderHandoffRequested
          || invocationStatus === "budget_exhausted"
          || (pendingWake.nextWakeAt !== null
            && Date.parse(pendingWake.nextWakeAt) - Date.now()
              < HOSTED_IDLE_COMPACT_TIMEOUT_MS);
        const idleMaintenanceModel =
          readConfirmedAssistantTarget()?.model
          ?? runtimeEnv.HOSTED_ASSISTANT_MODEL
          ?? null;
        let idleMaintenance: HostedIdleMaintenanceOutcome;
        try {
          idleMaintenance = dirtyWindowCheckpointTrigger === "shutdown_signal"
            ? buildHostedShutdownIdleMaintenanceOutcome()
            : await runHostedPendingInputProtectedIdleMaintenance({
              // The compact call rides the same warm-process credential as turns,
              // so attribute it the same way: members using their own provider key
              // must not have platform allowance debited for it.
              credentialSource: resolveAssistantUsageCredentialSource({
                apiKeyEnv: null,
                credentialSourceHint:
                  runtimeEnv.HOSTED_ASSISTANT_PROVIDER
                    === HOSTED_CUSTOM_INFERENCE_CODEX_MODEL_PROVIDER_ID
                    ? "member"
                    : null,
                effectiveEnv: runtimeEnv,
                provider: "codex-cli",
                userEnvKeys: Object.keys(guardedRuntime.userEnv),
              }),
              materializeWorkspaceArtifacts: restored.materializeWorkspaceArtifacts,
              memberId: input.request.userId,
              model: idleMaintenanceModel,
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
              persistGeneratedImageRetention: async (write) => {
                const workspace = overlayPendingWakeOnCommittedWorkspace(
                  runtimeStateDirty,
                  null,
                );
                const persisted = await runHostedWorkspaceCanonicalWriteAtBoundary({
                  previousRedactedStatus:
                    workspace?.redactedStatus ?? redactedStatus,
                  runnerInput: {
                    ...baseRunnerInput,
                    workspace,
                  },
                  write,
                });
                if (persisted.canonicalWritePersisted && persisted.workspace) {
                  rebaseCommittedWorkspace(persisted.workspace);
                } else {
                  redactedStatus = mergeHostedWorkspaceInvocationRedactedStatus(
                    redactedStatus,
                    persisted.redactedStatus ?? {},
                  );
                }
                return persisted.result;
              },
            });
        } catch (error) {
          throw attachHostedRuntimeFailurePhase(
            error,
            "workspace.checkpoint.idle_compact",
          );
        }
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
        await pauseDetachedAssistantAskBeforeWorkspaceBoundary();
        const boundarySystemMailboxWake =
          await resolveHostedSystemMailboxNextWakeCandidate({
            allowedRouteActions: ["run-assistant-ask"],
            vaultRoot: restored.vaultRoot,
          });
        pendingWake = selectEarliestHostedRuntimeWake([
          {
            at: pendingWake.nextWakeAt,
            reason: pendingWake.nextWakeReason,
          },
          {
            at: boundarySystemMailboxWake.at,
            reason: boundarySystemMailboxWake.reason,
          },
        ]);
        idleCheckpointWake = selectHostedIdleCheckpointWake({
          idleMaintenance,
          previousInboxMediaRetentionWakeAt:
            committedWorkspace?.inboxMediaRetentionWakeAt ?? null,
          projectedWakeAt: pendingWake.nextWakeAt,
          projectedWakeReason: pendingWake.nextWakeReason,
        });
        const runtimeWakePendingAtCheckpoint = checkpointWakeLatencySeed !== null;
        const idleCheckpointTrigger = resolveHostedRuntimeIdleCheckpointTrigger({
          dirtyWaitResult,
        });
        const idleCheckpointPhaseLogDetails =
          buildHostedRuntimeIdleCheckpointPhaseLogDetails({
            idleCheckpointStartByMs,
            idleCheckpointTrigger,
            pendingWake,
            runtimeWakePendingAtCheckpoint,
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
        let checkpoint: HostedWorkspaceCheckpointResponse;
        let checkpointWakeNotificationAfterCommit: RuntimeWakeNotification | null = null;
        const checkpointWakeInterruption =
          createHostedRuntimeCheckpointWakeInterruption({
            enabled:
              idleCheckpointPhaseLogDetails.idleCheckpointTrigger !== "shutdown_signal",
            runtimeWakeSignal: options.runtimeWakeSignal ?? null,
          });
        try {
          latestCheckpointSnapshotCleanForWarmReuse = false;
          try {
            checkpoint = await checkpointHostedRuntimeDirtyWorkspace({
              assertRuntimeNotAborted,
              checkpointRequestBuilder,
              checkpointSignal: checkpointWakeInterruption.signal,
              expectedUserId: input.request.userId,
              idleCheckpointTrigger: idleCheckpointPhaseLogDetails.idleCheckpointTrigger,
              nextWakeAt: idleCheckpointWake.nextWakeAt,
              nextWakeReason: idleCheckpointWake.nextWakeReason,
              inboxMediaRetentionWakeAt: idleCheckpointWake.inboxMediaRetentionWakeAt,
              issueExportPort: runtime.platform.issueExportPort ?? null,
              redactedStatus,
              runtimeWakePendingAtCheckpoint,
              runtimeAbortSignal: runtimeAbortController.signal,
              vaultRoot: restored.vaultRoot,
              workspacePort: foregroundWorkspacePort,
            });
          } finally {
            await checkpointWakeInterruption.dispose();
            checkpointWakeNotificationAfterCommit =
              checkpointWakeInterruption.takeNotification();
          }
        } catch (error) {
          resumeDetachedAssistantAskAfterWorkspaceBoundary();
          if (error instanceof HostedRuntimeCheckpointInterruptedByWakeError) {
            phaseLogger.close("workspace.checkpoint.idle_shutdown");
            const shutdownWasSignaled = () => options.shutdownSignal?.aborted === true;
            if (
              shutdownWasSignaled()
              && error.checkpointConflictReason === "foreground_pending"
            ) {
              pendingWake = {
                nextWakeAt: new Date().toISOString(),
                nextWakeReason: "mailbox",
              };
              continue;
            }
            const latencySeed = createHostedRuntimeWakeLatencySeed(
              error.notification ?? checkpointWakeNotificationAfterCommit,
            );
            if (shutdownWasSignaled()) {
              pendingCheckpointWakeLatencySeed ??= latencySeed;
              continue;
            }
            const checkpointInterruptSignal = options.shutdownSignal
              ? AbortSignal.any([runtimeAbortController.signal, options.shutdownSignal])
              : runtimeAbortController.signal;
            let checkpointInterruptHandled: boolean;
            try {
              checkpointInterruptHandled = await runPreCheckpointConversationWake(
                latencySeed,
                {
                  rearmIdleCheckpointAfterEmptyProbe: true,
                  shouldContinue: () => !shutdownWasSignaled(),
                  signal: checkpointInterruptSignal,
                },
              );
            } catch (wakeError) {
              if (shutdownWasSignaled() && !runtimeAbortController.signal.aborted) {
                pendingCheckpointWakeLatencySeed ??= latencySeed;
                continue;
              }
              throw wakeError;
            }
            if (!checkpointInterruptHandled) {
              pendingCheckpointWakeLatencySeed ??= latencySeed;
            }
            continue;
          }
          if (isHostedRuntimeCheckpointSupersededByWorkspaceProgress(error)) {
            phaseLogger.close("workspace.checkpoint.idle_shutdown");
            await runForegroundPass({
              latencySeed: null,
              requestIdKind: "checkpoint-interrupt",
            });
            continue;
          }
          throw error;
        }
        resumeDetachedAssistantAskAfterWorkspaceBoundary();
        if (checkpointWakeNotificationAfterCommit) {
          checkpointWakeLatencySeed ??= createHostedRuntimeWakeLatencySeed(
            checkpointWakeNotificationAfterCommit,
          );
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
        const conversationInputAhead = checkpoint.conversationInputAhead === true;
        const hotProjectedAssistantWakeKeyPresentedBeforeCheckpoint =
          hotProjectedAssistantWakeAttemptedKey;
        rebaseCommittedWorkspace(checkpoint.workspace);
        runtimeStateDirty = false;
        idleCheckpointStartByMs = null;
        hotProjectedAssistantWakeAttemptedKey = null;
        durableCheckpointFollowUpPending = false;
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
        const mayRunPostCheckpointWork = (): boolean =>
          idleCheckpointPhaseLogDetails.idleCheckpointTrigger !== "shutdown_signal"
          && options.shutdownSignal?.aborted !== true;
        const postCheckpointWorkSignal = options.shutdownSignal
          ? AbortSignal.any([runtimeAbortController.signal, options.shutdownSignal])
          : runtimeAbortController.signal;
        const runOptionalPostCheckpointWork = async <T>(
          work: () => Promise<T>,
        ): Promise<T | null> => {
          if (!mayRunPostCheckpointWork()) {
            return null;
          }
          try {
            const value = await work();
            return value;
          } catch (error) {
            if (
              postCheckpointWorkSignal.aborted
              && options.shutdownSignal?.aborted === true
              && !runtimeAbortController.signal.aborted
            ) {
              return null;
            }
            throw error;
          }
        };
        if (conversationInputAhead && mayRunPostCheckpointWork()) {
          const conversationInputHandled = await runOptionalPostCheckpointWork(
            async () =>
              await runPreCheckpointConversationWake(null, {
                shouldContinue: mayRunPostCheckpointWork,
                signal: postCheckpointWorkSignal,
              }),
          );
          if (runtimeStateDirty) {
            continue;
          }
          if (
            conversationInputHandled
            && await drainCleanDurableCheckpointEffects()
          ) {
            continue;
          }
        }
        if (mayRunPostCheckpointWork()) {
          const consumedRuntimeWake = consumePendingHostedRuntimeWake(
            options.runtimeWakeSignal ?? null,
            options.shutdownSignal ?? null,
          );
          if (consumedRuntimeWake) {
            checkpointWakeLatencySeed ??= consumedRuntimeWake;
          }
        }
        let deferredBrowserVaultWakePrefetch: HostedMailboxPrefixPrefetch | null = null;
        let deferredDeviceSyncWake: HostedVaultShareOfferWake | null = null;
        let mailboxWakeNeedsReplacement = false;
        const scheduleReplacementForRetainedMailboxWake = (): void => {
          if (
            !mailboxWakeNeedsReplacement
            && !deferredBrowserVaultWakePrefetch
            && !deferredDeviceSyncWake
          ) {
            return;
          }
          pendingWake = selectEarliestHostedRuntimeWake([
            {
              at: pendingWake.nextWakeAt,
              reason: pendingWake.nextWakeReason,
            },
            {
              at: new Date().toISOString(),
              reason: "mailbox",
            },
          ]);
          invocationStatus = "scheduled";
        };
        if (mayRunPostCheckpointWork() && checkpointWakeLatencySeed) {
          const checkpointWakeClassification = await classifyHostedPostCheckpointWake({
            latencySeed: checkpointWakeLatencySeed,
            requestId: `${requestId}:checkpoint-wake-classify:${runtimePassOrdinal + 1}`,
          });
          if (!mayRunPostCheckpointWork()) {
            mailboxWakeNeedsReplacement = true;
          } else if (
            browserVaultReplicaRefreshRequested
            && checkpointWakeClassification.containsOnlyBrowserVaultRefreshWakes
          ) {
            deferredBrowserVaultWakePrefetch =
              checkpointWakeClassification.wake.initialMailboxPrefetch;
          } else if (checkpointWakeClassification.containsOnlyDeviceSyncDirtyWakes) {
            // The state just checkpointed is safe to project before another
            // level-triggered dirty hint; explicit device commands and human work
            // still run first.
            deferredDeviceSyncWake = checkpointWakeClassification.wake;
          } else {
            const checkpointWakeHandled = await runOptionalPostCheckpointWork(
              async () =>
                await runPostCheckpointMailboxWake({
                  initialMailboxPrefetch:
                    checkpointWakeClassification.wake.initialMailboxPrefetch,
                  latencySeed: checkpointWakeClassification.wake.latencySeed,
                  shouldContinue: mayRunPostCheckpointWork,
                  signal: postCheckpointWorkSignal,
                }),
            );
            if (checkpointWakeHandled === null && !mayRunPostCheckpointWork()) {
              mailboxWakeNeedsReplacement = true;
            }
            if (runtimeStateDirty) {
              continue;
            }
            if (checkpointWakeHandled && await drainCleanDurableCheckpointEffects()) {
              continue;
            }
          }
        }
        const durableCheckpointEffects = await runDurableCheckpointEffectsBestEffort();
        if (durableCheckpointEffects.requiresFollowUpCheckpoint) {
          pendingCheckpointWakeLatencySeed ??=
            deferredDeviceSyncWake?.latencySeed
            ?? (mailboxWakeNeedsReplacement ? checkpointWakeLatencySeed : null);
          stageDurableCheckpointFollowUp(
            checkpoint.workspace,
            durableCheckpointEffects.wake,
          );
          continue;
        }
        if (
          mayRunPostCheckpointWork()
          && invocationStatus !== "budget_exhausted"
          && hostedRuntimeWakeReasonIsAssistant(committedWorkspace?.nextWakeReason ?? null)
          && hostedRuntimeWakeIsDue(committedWorkspace?.nextWakeAt ?? null)
          && buildHostedRuntimeWakeKey({
            nextWakeAt: committedWorkspace?.nextWakeAt ?? null,
            nextWakeReason: committedWorkspace?.nextWakeReason ?? null,
          }) !== hotProjectedAssistantWakeKeyPresentedBeforeCheckpoint
        ) {
          const dueAssistantWakeHandled = await runOptionalPostCheckpointWork(async () => {
            await runForegroundPass({
              latencySeed: null,
              preserveDueAssistantWakeOnNoProgress: true,
              requestIdKind: "checkpoint-wake",
              signal: postCheckpointWorkSignal,
            });
            return true;
          });
          if (
            dueAssistantWakeHandled
            && (runtimeStateDirty || await drainCleanDurableCheckpointEffects())
          ) {
            pendingCheckpointWakeLatencySeed ??=
              deferredDeviceSyncWake?.latencySeed
              ?? (mailboxWakeNeedsReplacement ? checkpointWakeLatencySeed : null);
            continue;
          }
        }
        if (
          mayRunPostCheckpointWork()
          && !mailboxBudgetExhausted()
        ) {
          const vaultShareOfferWake = await runOptionalPostCheckpointWork(
            async () =>
              await offerHostedVaultShareProjectionDuringIdle({
                deferDeviceSyncWakes: true,
                deferredDeviceSyncWake,
              }),
          );
          let vaultShareWakeHandled = false;
          if (vaultShareOfferWake) {
            deferredDeviceSyncWake = vaultShareOfferWake;
            const vaultShareWakeResult = await runOptionalPostCheckpointWork(async () => {
              await runForegroundPass({
                initialMailboxPrefetch: vaultShareOfferWake.initialMailboxPrefetch,
                latencySeed: vaultShareOfferWake.latencySeed,
                requestIdKind: "idle-wake",
                signal: postCheckpointWorkSignal,
              });
              return true;
            });
            vaultShareWakeHandled = vaultShareWakeResult === true;
            if (
              vaultShareWakeHandled
              && (runtimeStateDirty || await drainCleanDurableCheckpointEffects())
            ) {
              continue;
            }
            if (runtimeStateDirty) {
              continue;
            }
          }
          if (!vaultShareWakeHandled && !mayRunPostCheckpointWork()) {
            scheduleReplacementForRetainedMailboxWake();
          }
        } else if (!mayRunPostCheckpointWork()) {
          scheduleReplacementForRetainedMailboxWake();
        }
        let browserVaultRefresh = await runOptionalPostCheckpointWork(
          async () =>
            await runBrowserVaultRefreshMaintenance({
              signal: postCheckpointWorkSignal,
              workspace: committedWorkspace,
            }),
        );
        if (
          browserVaultRefresh?.status === "deferred_runtime_wake"
          && browserVaultReplicaRefreshRequested
          && mayRunPostCheckpointWork()
        ) {
          const runtimeWakePrefetch = await createHostedForegroundMailboxPrefetch({
            lanes: HOSTED_FOREGROUND_MAILBOX_PREFETCH_LANES,
            limitPerLane: mailboxBudget.fetchLimitPerLane,
            requestId:
              `${requestId}:browser-vault-wake-classify:${runtimePassOrdinal + 1}`,
            runnerInput: baseRunnerInput,
          });
          const runtimeWakeInspection =
            await inspectHostedPreCheckpointSystemMailboxPrefetch(runtimeWakePrefetch);
          if (runtimeWakeInspection.containsOnlyBrowserVaultRefreshWakes) {
            deferredBrowserVaultWakePrefetch = runtimeWakePrefetch;
            browserVaultRefresh = await runOptionalPostCheckpointWork(
              async () =>
                await runBrowserVaultRefreshMaintenance({
                  signal: postCheckpointWorkSignal,
                  workspace: committedWorkspace,
                }),
            );
          }
        }
        if (
          deferredBrowserVaultWakePrefetch
          && browserVaultRefresh?.status !== "deferred_runtime_wake"
        ) {
          const deferredBrowserWakeHandled = await runOptionalPostCheckpointWork(
            async () =>
              await runPostCheckpointMailboxWake({
                initialMailboxPrefetch: deferredBrowserVaultWakePrefetch,
                latencySeed: checkpointWakeLatencySeed,
                shouldContinue: mayRunPostCheckpointWork,
                signal: postCheckpointWorkSignal,
              }),
          );
          if (runtimeStateDirty) {
            continue;
          }
          if (
            deferredBrowserWakeHandled
            && await drainCleanDurableCheckpointEffects()
          ) {
            continue;
          }
        }
        const refreshRequestedImmediateWake =
          browserVaultRefresh?.status === "deferred_runtime_wake";
        await closeDetachedAssistantAskBeforeWorkspaceRelease();
        if (runtimeStateDirty) {
          continue;
        }
        const committedDefaultWakeKey = buildHostedRuntimeWakeKey({
          nextWakeAt: committedWorkspace?.nextWakeAt ?? null,
          nextWakeReason: committedWorkspace?.nextWakeReason ?? null,
        });
        const immediateDefaultWakeWasNotPresented =
          committedDefaultWakeKey !== null
          && unservicedRecheckWakeKeys.has(committedDefaultWakeKey);
        const immediateRetentionContinuationProduced =
          idleMaintenance.nextWakeReason === "inbox_media_retention"
          && idleMaintenance.nextWakeAt !== null;
        const immediateRecheckCandidate =
          assistantProviderHandoffRequested
          || immediateDefaultWakeWasNotPresented
          || immediateRetentionContinuationProduced;
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
        const immediateRecheckRequested =
          assistantProviderHandoffRequested
          || (
            immediateRecheckCandidate
            && !isHostedRuntimeFutureMailboxContinuation({
              nextWakeAt: checkpointReturnWake.nextWakeAt,
              nextWakeReason: checkpointReturnWake.nextWakeReason,
              redactedStatus,
            })
          );
        const checkpointReturnWakePresent = Object.hasOwn(committedWorkspace ?? {}, "nextWakeAt")
          || pendingWake.nextWakeAt !== null
          || committedWorkspace?.inboxMediaRetentionWakeAt !== null;
        const invocationResult = {
          ...(immediateRecheckRequested
            ? { immediateRecheckRequested: true as const }
            : {}),
          ...(refreshRequestedImmediateWake
            ? { nextWakeAt: new Date().toISOString() }
            : !checkpointReturnWakePresent
            ? {}
            : {
                nextWakeAt: checkpointReturnWake.nextWakeAt ?? null,
                ...(checkpointReturnWake.nextWakeReason
                  ? { nextWakeReason: checkpointReturnWake.nextWakeReason }
                  : {}),
              }),
          redactedStatus,
          status: refreshRequestedImmediateWake
            ? "scheduled" as const
            : resolveHostedWorkspaceInvocationStatus({
                mailboxBudgetExhausted: mailboxBudgetExhausted(),
                nextWakeAt: checkpointReturnWake.nextWakeAt ?? null,
              }),
        };
        await drainDeferredUsageBestEffort();
        emitPhaseLog({
          details: {
            immediateRecheckRequested,
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
    const noProgressBrowserVaultRefreshSignal = options.shutdownSignal
      ? AbortSignal.any([runtimeAbortController.signal, options.shutdownSignal])
      : runtimeAbortController.signal;
    const shouldRunNoProgressBrowserVaultRefresh =
      browserVaultReplicaRefreshRequested
      && options.shutdownSignal?.aborted !== true;
    let noProgressBrowserVaultRefresh:
      Awaited<ReturnType<typeof runBrowserVaultRefreshMaintenance>> | null = null;
    if (shouldRunNoProgressBrowserVaultRefresh) {
      try {
        noProgressBrowserVaultRefresh = await runBrowserVaultRefreshMaintenance({
          signal: noProgressBrowserVaultRefreshSignal,
          workspace: committedWorkspace,
        });
        if (
          noProgressBrowserVaultRefresh.status === "deferred_runtime_wake"
          && options.shutdownSignal?.aborted !== true
        ) {
          const runtimeWakePrefetch = await createHostedForegroundMailboxPrefetch({
            lanes: HOSTED_FOREGROUND_MAILBOX_PREFETCH_LANES,
            limitPerLane: mailboxBudget.fetchLimitPerLane,
            requestId: `${requestId}:browser-vault-no-progress-wake-classify`,
            runnerInput: baseRunnerInput,
          });
          const runtimeWakeInspection =
            await inspectHostedPreCheckpointSystemMailboxPrefetch(runtimeWakePrefetch);
          if (runtimeWakeInspection.containsOnlyBrowserVaultRefreshWakes) {
            noProgressBrowserVaultRefresh = await runBrowserVaultRefreshMaintenance({
              signal: noProgressBrowserVaultRefreshSignal,
              workspace: committedWorkspace,
            });
          }
        }
      } catch (error) {
        if (
          noProgressBrowserVaultRefreshSignal.aborted
          && options.shutdownSignal?.aborted === true
          && !runtimeAbortController.signal.aborted
        ) {
          noProgressBrowserVaultRefresh = null;
        } else {
          throw error;
        }
      }
    }
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
      ...(!refreshRequestedImmediateWake && noProgressReturnWake.nextWakeReason
        ? { nextWakeReason: noProgressReturnWake.nextWakeReason }
        : {}),
      redactedStatus,
      status: refreshRequestedImmediateWake
        ? "scheduled" as const
        : resolveHostedWorkspaceInvocationStatus({
            mailboxBudgetExhausted: mailboxBudgetExhausted(),
            nextWakeAt: noProgressReturnWake.nextWakeAt,
          }),
    };
    await drainDeferredUsageBestEffort();
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
    const failedRuntimePhases = phaseLogger.failOpenPhases({
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
    if (hostAbortObserved) {
      await drainLocalWorkspaceMutationsBestEffort();
      throw attachHostedRuntimeFailurePhase(
        hostAbortReason,
        failedRuntimePhases[0] ?? "runtime",
      );
    }
    await drainDeferredUsageBestEffort();
    throw attachHostedRuntimeFailurePhase(
      error,
      failedRuntimePhases[0] ?? "runtime",
    );
  } finally {
    try {
      await settleCodexProcessPreparation();
    } finally {
      try {
        await imageGenerationController?.close();
        await closeDetachedAssistantAskBeforeWorkspaceRelease();
      } finally {
        hostAbortSignal?.removeEventListener("abort", abortFromHost);
      }
    }
  }
}

type HostedRuntimePhaseLogStatus = "done" | "fail" | "start";

type HostedRuntimePhaseName = HostedRuntimeFailurePhaseName;

interface HostedRuntimePhaseLogState {
  ordinal: number;
  runtimeStartedAtMs: number;
  startedAtMsByStage: Map<HostedRuntimePhaseName, number>;
}

interface HostedRuntimePhaseLogger {
  close(stage: HostedRuntimePhaseName): void;
  emit(input: HostedRuntimePhaseLogInput): void;
  failOpenPhases(
    input: Omit<HostedRuntimePhaseLogInput, "stage" | "status">,
  ): HostedRuntimePhaseName[];
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
    close(stage) {
      state.startedAtMsByStage.delete(stage);
    },
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
      return openStages;
    },
  };
}

function attachHostedRuntimeFailurePhase(
  error: unknown,
  phase: HostedRuntimePhaseName,
): unknown {
  if (
    !(error instanceof Error)
    || deriveHostedExecutionErrorCode(error) !== "runtime_error"
  ) {
    return error;
  }

  // The shared canonical classifier is the single authority: if it cannot
  // produce an actionable classification, preserve the causal phase without
  // changing `.code`, `.errorCode`, retry behavior, or durable failure state.
  return attachHostedRuntimeFailurePhaseCode(error, phase);
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

function hostedBrowserVaultReplicaRefreshRequiresRetry(
  refresh: HostedBrowserVaultReplicaRefreshResult,
): boolean {
  return refresh.status === "deferred_aborted"
    || refresh.status === "deferred_runtime_wake"
    || refresh.status === "deferred_source_changed"
    || refresh.status === "deferred_timeout"
    || refresh.status === "publish_conflict"
    || refresh.status === "refresh_failed";
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
  persistGeneratedImageRetention?: Parameters<
    typeof runHostedIdleCheckpointMaintenance
  >[0]["persistGeneratedImageRetention"];
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
    persistGeneratedImageRetention: input.persistGeneratedImageRetention ?? null,
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
  canonicalWriteRunnerInput: HostedWorkspaceRunnerInput;
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

  let workspace = input.workspace;

  const idleMaintenance = input.shutdownSignal?.aborted === true
    ? buildHostedShutdownIdleMaintenanceOutcome()
    : await runHostedPendingInputProtectedIdleMaintenance({
        credentialSource: "platform",
        materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts,
        memberId: input.input.request.userId,
        model: null,
        pendingWork: false,
        persistGeneratedImageRetention: async (write) => {
          const persisted = await runHostedWorkspaceCanonicalWriteAtBoundary({
            previousRedactedStatus: workspace.redactedStatus ?? null,
            runnerInput: {
              ...input.canonicalWriteRunnerInput,
              workspace,
            },
            write,
          });
          if (persisted.canonicalWritePersisted && persisted.workspace) {
            workspace = persisted.workspace;
          }
          return persisted.result;
        },
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
        workspace.inboxMediaRetentionWakeAt ?? null,
    }),
    issueExportPort: input.issueExportPort ?? null,
    nextWakeAt: workspace.nextWakeAt ?? null,
    nextWakeReason: workspace.nextWakeReason ?? null,
    redactedStatus: workspace.redactedStatus ?? null,
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
  const immediateRecheckCandidate =
    idleMaintenance.nextWakeReason === "inbox_media_retention"
    && idleMaintenance.nextWakeAt !== null;
  const immediateRecheckRequested =
    immediateRecheckCandidate
    && !isHostedRuntimeFutureMailboxContinuation({
      nextWakeAt: nextWake.nextWakeAt,
      nextWakeReason: nextWake.nextWakeReason,
      redactedStatus: checkpoint.workspace.redactedStatus,
    });

  return {
    ...(immediateRecheckRequested
      ? { immediateRecheckRequested: true as const }
      : {}),
    nextWakeAt: nextWake.nextWakeAt,
    ...(nextWake.nextWakeReason ? { nextWakeReason: nextWake.nextWakeReason } : {}),
    redactedStatus: checkpoint.workspace.redactedStatus ?? null,
    status: resolveHostedWorkspaceInvocationStatus({
      mailboxBudgetExhausted: false,
      nextWakeAt: nextWake.nextWakeAt,
    }),
  };
}

const HOSTED_RUNTIME_MAX_TIMER_DELAY_MS = 2_147_483_647;
const activeHostedRuntimeDeferredUsageCaptures =
  new Set<HostedWorkspaceRunnerDeferredUsageCapture>();

type HostedRuntimeDirtyWaitResult =
  | { kind: "external_wake"; notification: RuntimeWakeNotification }
  | { kind: "idle_checkpoint"; trigger: "idle_window" | "shutdown_signal" }
  | { kind: "projected_assistant_wake" };

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
    ...(result.runtimeRedactedStatus ?? {}),
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

function overlayHostedRuntimePendingRedactedStatus(input: {
  committedStatus: HostedRuntimeRedactedJson | null;
  pendingStatus: HostedWorkspaceInvocationRedactedStatus;
}): HostedRuntimeRedactedJson {
  return {
    ...(input.committedStatus ?? {}),
    ...input.pendingStatus,
  };
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
  assistantProjectedWakeKey: string | null;
  checkpointPendingBeforePass: boolean;
  nowMs: number;
  passWake: HostedRuntimePendingWake;
  presentedInvocationLocalProjectedAssistantWakeKey: string | null;
  previousPendingWake: HostedRuntimePendingWake;
  preserveDueAssistantWakeOnNoProgress: boolean;
  replaceWake: boolean;
}): HostedRuntimePendingWakeResolution {
  const preservePendingWakeThroughPreCheckpointPass =
    input.checkpointPendingBeforePass
    && input.presentedInvocationLocalProjectedAssistantWakeKey === null
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

  const previousWakeAt =
    input.checkpointPendingBeforePass
      && input.presentedInvocationLocalProjectedAssistantWakeKey === null
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
    && input.presentedInvocationLocalProjectedAssistantWakeKey !== null
    && input.assistantProjectedWakeKey === null
    && input.previousPendingWake.nextWakeAt !== null
    && hostedRuntimeWakeReasonIsAssistant(input.previousPendingWake.nextWakeReason)
    && hostedRuntimeWakeIsDue(input.previousPendingWake.nextWakeAt, input.nowMs)
  ) {
    return {
      pendingWake: copyHostedRuntimePendingWake(input.previousPendingWake),
      preservedDueAssistantWakeOnNoProgress: true,
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
  idleCheckpointStartByMs: number;
  idleCheckpointTrigger: HostedRuntimeIdleCheckpointTrigger;
  pendingWake: HostedRuntimePendingWake;
  runtimeWakePendingAtCheckpoint: boolean;
  shutdownSignal: AbortSignal | null;
}): HostedExecutionStructuredLogDetails & {
  idleCheckpointTrigger: HostedRuntimeIdleCheckpointTrigger;
} {
  return {
    idleCheckpointStartByMs: input.idleCheckpointStartByMs,
    idleCheckpointTrigger: input.idleCheckpointTrigger,
    nextWakeAtPresent: input.pendingWake.nextWakeAt !== null,
    nextWakeReasonPresent: input.pendingWake.nextWakeReason !== null,
    runtimeWakePendingAtCheckpoint: input.runtimeWakePendingAtCheckpoint,
    shutdownSignalAbortedAtCheckpoint: input.shutdownSignal?.aborted === true,
  };
}

function resolveHostedRuntimeIdleCheckpointTrigger(input: {
  dirtyWaitResult: HostedRuntimeDirtyWaitResult;
}): HostedRuntimeIdleCheckpointTrigger {
  if (
    input.dirtyWaitResult.kind === "idle_checkpoint"
    && input.dirtyWaitResult.trigger === "shutdown_signal"
  ) {
    return "shutdown_signal";
  }

  if (input.dirtyWaitResult.kind === "external_wake") {
    return "runtime_wake";
  }

  return "idle_window";
}

interface HostedRuntimeCheckpointWakeInterruption {
  dispose(): Promise<void>;
  readonly signal: AbortSignal | null;
  takeNotification(): RuntimeWakeNotification | null;
}

function createHostedRuntimeCheckpointWakeInterruption(input: {
  enabled: boolean;
  runtimeWakeSignal: RuntimeWakeSignal | null;
}): HostedRuntimeCheckpointWakeInterruption {
  if (!input.enabled || !input.runtimeWakeSignal) {
    return {
      dispose: async () => undefined,
      signal: null,
      takeNotification: () => null,
    };
  }

  const checkpointAbortController = new AbortController();
  const waitAbortController = new AbortController();
  let notification: RuntimeWakeNotification | null = null;
  const waitCompletion = input.runtimeWakeSignal.wait(waitAbortController.signal).then(
    (nextNotification) => {
      notification = nextNotification;
      checkpointAbortController.abort(
        new HostedRuntimeCheckpointInterruptedByWakeError({
          notification: nextNotification,
        }),
      );
    },
    (error: unknown) => {
      if (!waitAbortController.signal.aborted) {
        checkpointAbortController.abort(error);
      }
    },
  );

  return {
    async dispose() {
      if (!waitAbortController.signal.aborted) {
        waitAbortController.abort(
          new DOMException("Hosted runtime checkpoint wake wait finished.", "AbortError"),
        );
      }
      await waitCompletion;
    },
    signal: checkpointAbortController.signal,
    takeNotification() {
      const current = notification;
      notification = null;
      return current;
    },
  };
}

async function waitForHostedRuntimeDirtyWindow(input: {
  idleCheckpointStartByMs: number;
  projectedAssistantWakeAtMs: number | null;
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
  if (
    input.projectedAssistantWakeAtMs !== null
    && input.projectedAssistantWakeAtMs <= nowMs
  ) {
    return { kind: "projected_assistant_wake" };
  }

  const waitUntilMs = input.projectedAssistantWakeAtMs === null
    ? input.idleCheckpointStartByMs
    : Math.min(input.idleCheckpointStartByMs, input.projectedAssistantWakeAtMs);
  const timeoutDelayMs = Math.min(
    Math.max(0, waitUntilMs - nowMs),
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
      const projectedAssistantWakeIsFirst =
        input.projectedAssistantWakeAtMs !== null
        && input.projectedAssistantWakeAtMs < input.idleCheckpointStartByMs;
      settle(() => resolve(
        projectedAssistantWakeIsFirst
          ? { kind: "projected_assistant_wake" }
          : { kind: "idle_checkpoint", trigger: "idle_window" },
      ));
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
  checkpointSignal?: AbortSignal | null;
  expectedUserId: string;
  idleCheckpointTrigger?: HostedRuntimeIdleCheckpointTrigger;
  inboxMediaRetentionWakeAt: string | null;
  issueExportPort?: HostedRuntimePlatform["issueExportPort"] | null;
  nextWakeAt: string | null;
  nextWakeReason: string | null;
  runtimeWakePendingAtCheckpoint?: boolean;
  runtimeAbortSignal: AbortSignal;
  onCheckpointValidated?: (checkpoint: HostedWorkspaceCheckpointResponse) => Promise<void> | void;
  redactedStatus: HostedWorkspaceInvocationResult["redactedStatus"] | null;
  retainCanonicalWriteReceiptLogStatus?: boolean;
  vaultRoot: string;
  workspacePort: HostedRuntimePlatform["workspacePort"];
}): Promise<HostedWorkspaceCheckpointResponse> {
  if (!input.workspacePort) {
    throw new TypeError("Hosted runtime dirty workspace checkpoint requires workspace port support.");
  }

  input.assertRuntimeNotAborted();
  const handledConversationMailboxSelection =
    await compactHostedConversationMailboxHandledItemSelection({
      consumedThroughSeq: readHostedConversationConsumedSeqFromStatus(
        input.redactedStatus,
      ),
      signal: input.checkpointSignal ?? input.runtimeAbortSignal,
      vaultRoot: input.vaultRoot,
    });
  input.assertRuntimeNotAborted();
  const redactedStatus = await withHostedSystemMailboxHandledThroughStatus({
    redactedStatus: input.retainCanonicalWriteReceiptLogStatus
      ? input.redactedStatus
      : omitHostedCanonicalWriteReceiptLogStatusFields(input.redactedStatus),
    vaultRoot: input.vaultRoot,
  });
  const checkpointInput = {
    handledConversationFrontierSelected:
      handledConversationMailboxSelection.frontierSelected,
    handledConversationMailboxItemIds:
      handledConversationMailboxSelection.itemIds,
    ...(input.idleCheckpointTrigger
      ? { idleCheckpointTrigger: input.idleCheckpointTrigger }
      : {}),
    inboxMediaRetentionWakeAt: input.inboxMediaRetentionWakeAt,
    nextWakeAt: input.nextWakeAt,
    nextWakeReason: input.nextWakeReason,
    reason: "idle_shutdown" as const,
    redactedStatus,
    ...(input.runtimeWakePendingAtCheckpoint === undefined
      ? {}
      : { runtimeWakePendingAtCheckpoint: input.runtimeWakePendingAtCheckpoint }),
  };
  input.assertRuntimeNotAborted();
  const checkpoint = input.checkpointRequestBuilder.checkpoint
    ? await raceHostedRuntimeCancellation(
      Promise.resolve(input.checkpointRequestBuilder.checkpoint(
        checkpointInput,
        input.workspacePort,
        { signal: input.checkpointSignal ?? null },
      )),
      input.runtimeAbortSignal,
    )
    : await raceHostedRuntimeCancellation(
      Promise.resolve(input.checkpointRequestBuilder.createRequest(
        checkpointInput,
        { signal: input.checkpointSignal ?? null },
      ))
        .then((checkpointRequest) => input.workspacePort!.checkpoint(checkpointRequest)),
      input.runtimeAbortSignal,
    );
  input.assertRuntimeNotAborted();
  assertHostedWorkspaceCheckpointAccepted(checkpoint, input.expectedUserId);
  await input.onCheckpointValidated?.(checkpoint);
  await flushAndExportHostedRuntimeIssuesAfterCheckpointBestEffort({
    issueExportPort: input.issueExportPort ?? null,
    runtimeAbortSignal: input.runtimeAbortSignal,
    vaultRoot: input.vaultRoot,
  });
  return checkpoint;
}

function readHostedConversationConsumedSeqFromStatus(
  status: HostedWorkspaceInvocationResult["redactedStatus"] | null,
): string | null {
  const value = status?.["hostedMailboxConversationConsumedSeq"];
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)
    ? value
    : null;
}

async function withHostedSystemMailboxHandledThroughStatus(input: {
  redactedStatus: HostedWorkspaceInvocationResult["redactedStatus"] | null;
  vaultRoot: string;
}): Promise<HostedRuntimeRedactedJson> {
  const mailboxState = await readHostedMailboxImportState({
    vaultRoot: input.vaultRoot,
  });
  return {
    ...(input.redactedStatus ?? {}),
    hostedMailboxSystemHandledThroughSeq:
      await readHostedSystemMailboxHandledThroughSeq({
        importedSeq: mailboxState.watermarks.system,
        vaultRoot: input.vaultRoot,
      }),
  };
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

function assertHostedWorkspaceCheckpointAccepted(
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
        checkpointConflictReason: "foreground_pending",
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
      get: (sha256, context) =>
        guard(() => platform.artifactStore.get(sha256, context)),
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
            ...(platform.deviceSyncPort.reconcileAccount
              ? {
                  reconcileAccount: (reconcileInput) =>
                    guard(() => platform.deviceSyncPort!.reconcileAccount!(reconcileInput)),
                }
              : {}),
            fetchDirtyStates: (dirtyInput) =>
              guard(() => platform.deviceSyncPort!.fetchDirtyStates(dirtyInput)),
            fetchSnapshot: (snapshotInput) =>
              guard(() => platform.deviceSyncPort!.fetchSnapshot(snapshotInput)),
          },
        }
      : {}),
    ...(platform.clinicalRecordsPort
      ? {
          clinicalRecordsPort: {
            ...(platform.clinicalRecordsPort.createConnectLink
              ? {
                  createConnectLink: (options) =>
                    guard(() => platform.clinicalRecordsPort!.createConnectLink!(options)),
                }
              : {}),
            fetchPage: (fetchInput, options) =>
              guard(() => platform.clinicalRecordsPort!.fetchPage(fetchInput, options)),
            readRun: (readInput, options) =>
              guard(() => platform.clinicalRecordsPort!.readRun(readInput, options)),
            recordOutcome: (outcomeInput, options) =>
              guard(() => platform.clinicalRecordsPort!.recordOutcome(outcomeInput, options)),
          },
        }
      : {}),
    effectsPort: {
      ...platform.effectsPort,
      ...(platform.effectsPort.deleteEnvironmentVoice
        ? {
            deleteEnvironmentVoice: (audioKey) =>
              guard(() =>
                platform.effectsPort.deleteEnvironmentVoice!(audioKey)
              ),
          }
        : {}),
      ...(platform.effectsPort.readEnvironmentVoice
        ? {
            readEnvironmentVoice: (audioKey) =>
              guard(() => platform.effectsPort.readEnvironmentVoice!(audioKey)),
          }
        : {}),
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
      ...(platform.effectsPort.deleteMealPhoto
        ? {
            deleteMealPhoto: (mealPhotoKey) =>
              guard(() => platform.effectsPort.deleteMealPhoto!(mealPhotoKey)),
          }
        : {}),
      ...(platform.effectsPort.readMealPhoto
        ? {
            readMealPhoto: (mealPhotoKey) =>
              guard(() => platform.effectsPort.readMealPhoto!(mealPhotoKey)),
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
            write: (request, context) =>
              guard(() => platform.logPort!.write(request, context)),
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
            fetch: (request, context) =>
              platform.mailboxPort!.fetch(request, context),
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

async function resolveDeferredMailboxImportSystemMailboxWake(
  importResult: HostedMailboxImportLoopResult,
  vaultRoot: string,
): Promise<{
  at: string | null;
  reason: string | null;
}> {
  if ((importResult.importedSystemMailboxItemIds?.length ?? 0) === 0) {
    return {
      at: null,
      reason: null,
    };
  }

  return await resolveHostedSystemMailboxNextWakeCandidate({ vaultRoot });
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

function buildHostedShutdownIdleMaintenanceOutcome(): HostedIdleMaintenanceOutcome {
  return {
    kind: "skipped",
    reason: "shutdown",
    threadContextTokensBefore: null,
  };
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

async function resolveHostedAssistantCronWakeAfterInitialImport(input: {
  operatorHomeRoot: string;
  runtimeEnv: Readonly<Record<string, string>>;
  vaultRoot: string;
}): Promise<{ at: string | null; reason: string | null }> {
  const status = await getAssistantCronStatus(input.vaultRoot, {
    turnEnvironment: createHostedAssistantTurnEnvironment(input),
  });
  const at = status.dueJobs > 0
    ? new Date().toISOString()
    : status.nextRunAt;
  return {
    at,
    reason: at ? HOSTED_ASSISTANT_WAKE_REASON : null,
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

function mergeGeneratedImageRetentionWakeIntoWorkspace(
  workspace: HostedWorkspaceState | null,
  retentionWakeAt: string,
): HostedWorkspaceState | null {
  if (!workspace) {
    return null;
  }
  const candidateMs = Date.parse(retentionWakeAt);
  if (!Number.isFinite(candidateMs)) {
    throw new TypeError("Generated-image retention wake must be a valid timestamp.");
  }
  const currentWakeAt = workspace.inboxMediaRetentionWakeAt ?? null;
  if (
    currentWakeAt !== null
    && Date.parse(currentWakeAt) <= candidateMs
  ) {
    return workspace;
  }
  return {
    ...workspace,
    inboxMediaRetentionWakeAt: retentionWakeAt,
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
    && (
      input.idleMaintenance.reason === "pending_work"
      || input.idleMaintenance.reason === "shutdown"
    );

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
