import {
  existsSync,
} from "node:fs";
import {
  resolveAssistantStatePaths,
} from "@murphai/runtime-state/node/assistant-state-fs";
import {
  buildHostedExecutionSafeErrorDiagnostics,
  type HostedExecutionConversationMessageChannel,
} from "@murphai/hosted-execution";
import type {
  AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";
import {
  withHostedCanonicalWritePort,
  type HostedCanonicalWritePort,
  type HostedCanonicalWriteReceipt,
} from "@murphai/core";
import { VAULT_LAYOUT } from "@murphai/contracts";
import type {
  HostedRuntimeRedactedJson,
  HostedRuntimeLatencyPhaseBreakdown,
  HostedRuntimeLatencyTraceStagedMilestones,
  HostedRuntimeUsageNoticeDeliveryTarget,
  HostedWorkspaceCheckpointReason,
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceCheckpointResponse,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  compareAssistantInputCursors,
  isAssistantContextSnapshotRefreshPending,
  listAssistantContextSnapshotDirtyDomainsForCanonicalWrite,
  markAssistantContextSnapshotDirty,
  notifyAssistantActiveTurnInputAvailableForInputIds,
  readAssistantInputEvent,
  resolveAssistantContextSnapshotPath,
  type AssistantGeneratedImageCapturePersistence,
  type AssistantInputEventRecord,
  type AssistantProviderStartCriticalPathContext,
  warnAssistantBestEffortFailure,
} from "@murphai/assistant-engine";
import type {
  HostedDeviceSyncDirtyProcessedPostCheckpointRecord,
  HostedWorkspaceArtifactMaterializer,
} from "./models.ts";
import type {
  RuntimeWakeNotification,
  RuntimeWakeSignal,
} from "./runtime-wake.ts";
import type {
  HostedVaultShareProjectionOfferResult,
} from "./vault-share-projection.ts";

import {
  buildHostedMailboxImportRedactedStatus,
  HostedMailboxImportCheckpointConflictError,
  HostedMailboxImportCheckpointUserMismatchError,
  importHostedMailboxPrefixAndCheckpoint,
  type HostedMailboxImportCheckpointRequestInput,
  type HostedMailboxImportCheckpointResult,
} from "./mailbox-checkpoint.ts";
import type {
  HostedMailboxAssistantInputRecord,
  HostedMailboxConversationDeferral,
  HostedMailboxItemImportOutcome,
  HostedMailboxPrefixPrefetch,
  HostedMailboxPostCheckpointEffect,
  HostedMailboxPostCheckpointEffectResult,
  HostedMailboxResolvedImportItem,
} from "./mailbox-import.ts";
import type {
  HostedRuntimeMailboxPort,
  HostedRuntimePlatform,
  HostedRuntimeWorkspacePort,
} from "./platform.ts";
import type {
  HostedAssistantLinqDeliveryContext,
} from "./linq-delivery-context.ts";
import type {
  HostedAssistantEmailDeliveryContext,
} from "./email-delivery-context.ts";
import {
  buildHostedRuntimeLogContextFields,
  compactHostedRuntimeLogCodes,
  type HostedRuntimeLogContext,
  toHostedRuntimeLogCode,
  writeHostedRuntimeLogBestEffort,
} from "./runtime-logs.ts";
import {
  resolveHostedPendingAssistantInputWakeAt,
} from "./pending-assistant-input.ts";
import {
  compactHostedPendingAssistantInputIds,
  resolveHostedPendingAssistantInputStatePath,
} from "./pending-input-index.ts";
import {
  resolveHostedSystemMailboxNextWakeCandidate,
} from "./system-mailbox.ts";
import {
  HOSTED_ASSISTANT_WAKE_REASON,
  createHostedRuntimeWakeCandidate,
  selectHostedRuntimeWakeCandidate,
} from "./wake-candidates.ts";
import {
  readHostedAssistantInputCurrentDeliveryRoute,
} from "./current-delivery-route.ts";
import {
  selectHostedAssistantInputIds,
} from "./turn-input.ts";
import {
  appendHostedCanonicalWriteReceiptToArtifactLog,
  hostedCanonicalWriteReceiptLogStatusFields,
  readHostedCanonicalWriteReceiptLogStatusFingerprint,
} from "./canonical-write-receipt-log.ts";
import {
  markHostedWorkspaceLiveRuntimeStateDirtyForSnapshotRefBestEffort,
} from "./workspace-restore.ts";

export interface HostedWorkspaceCheckpointMetadata {
  attemptId: string;
  browserVaultReplicaRef?: HostedWorkspaceCheckpointRequest["browserVaultReplicaRef"];
  expectedWorkspaceVersion: string;
  leaseGeneration: string;
  nextWakeAt?: string | null;
  nextWakeReason?: string | null;
  snapshotRef: HostedWorkspaceCheckpointRequest["snapshotRef"];
}

export interface HostedWorkspaceSnapshotCheckpointMetadata {
  attemptId: string;
  expectedWorkspaceVersion: string;
  inboxMediaRetentionWakeAt?: string | null;
  leaseGeneration: string;
  nextWakeAt?: string | null;
  nextWakeReason?: string | null;
}

export interface HostedWorkspaceSnapshotCheckpointResult {
  browserVaultReplicaRef?: HostedWorkspaceCheckpointRequest["browserVaultReplicaRef"];
  checkpoint?: HostedWorkspaceCheckpointResponse;
  localWorkspaceCleanForWarmReuse?: boolean;
  snapshotRef: HostedWorkspaceCheckpointRequest["snapshotRef"];
}

type HostedWorkspaceSnapshotCheckpointMailboxReason = Exclude<
  HostedWorkspaceCheckpointReason,
  "assistant_runtime_commit" | "canonical_runtime_commit" | "idle_shutdown"
>;

type HostedWorkspaceSnapshotCheckpointMailboxInput =
  Omit<HostedMailboxImportCheckpointRequestInput, "reason" | "redactedStatus"> & {
    reason: HostedWorkspaceSnapshotCheckpointMailboxReason;
  };

export type HostedWorkspaceSnapshotCheckpointRequestBuilderInput =
  (
    | HostedWorkspaceSnapshotCheckpointMailboxInput
    | {
      reason: "idle_shutdown";
    }
  ) & {
    expectedWorkspaceVersion?: string;
    handledConversationFrontierSelected?: boolean;
    handledConversationMailboxItemIds?: string[];
    idleCheckpointTrigger?: HostedWorkspaceCheckpointRequest["idleCheckpointTrigger"];
    inboxMediaRetentionWakeAt?: string | null;
    nextWakeAt?: string | null;
    nextWakeReason?: string | null;
    redactedStatus?: HostedRuntimeRedactedJson | null;
    runtimeWakePendingAtCheckpoint?: boolean;
  };

export interface HostedWorkspaceSnapshotCheckpointContext {
  signal?: AbortSignal | null;
}

export interface HostedWorkspaceRunnerCheckpointRequestInput
  extends Omit<HostedMailboxImportCheckpointRequestInput, "reason"> {
  nextWakeAt?: string | null;
  nextWakeReason?: string | null;
  reason: HostedWorkspaceCheckpointReason;
}

export type HostedWorkspaceSnapshotCheckpointBuilder = (
  input: HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
  context?: HostedWorkspaceSnapshotCheckpointContext,
) => Promise<HostedWorkspaceSnapshotCheckpointResult> | HostedWorkspaceSnapshotCheckpointResult;

export interface HostedWorkspaceCheckpointRequestBuilder {
  checkpoint?(
    input: HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
    workspacePort: HostedRuntimeWorkspacePort,
    context?: HostedWorkspaceSnapshotCheckpointContext,
  ): Promise<HostedWorkspaceCheckpointResponse> | HostedWorkspaceCheckpointResponse;
  createRequest(
    input: HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
    context?: HostedWorkspaceSnapshotCheckpointContext,
  ): Promise<HostedWorkspaceCheckpointRequest> | HostedWorkspaceCheckpointRequest;
  recordCheckpoint?(response: HostedWorkspaceCheckpointResponse): void;
}

interface HostedWorkspaceCheckpointRequestSession
  extends HostedWorkspaceCheckpointRequestBuilder {
  assistantInputBatchFull(): boolean;
  assistantInputBatchRemaining(): number;
  conversationConsumedSeq(): string | null;
  discardMailboxPostCheckpointEffects(): void;
  hasRuntimeStateDirty(): boolean;
  latestAssistantInputBatch(): HostedWorkspaceRunnerAssistantInputBatch | null;
  latestMailboxImport(): HostedMailboxImportCheckpointResult | null;
  latestWorkspace(): HostedWorkspaceState | null;
  markRuntimeStateDirty(): void;
  mailboxRetryAt(): string | null;
  recordCheckpointResult(
    result: HostedMailboxImportCheckpointResult,
    options?: {
      captureAssistantInputBatch?: boolean;
    },
  ): void;
  recordStatusCheckpoint(response: HostedWorkspaceCheckpointResponse): void;
  seedAssistantInputSelection(
    selectedInputCount: number,
    remainingBatch: HostedWorkspaceRunnerAssistantInputBatch | null,
  ): void;
  takeMailboxPostCheckpointEffects(): readonly HostedMailboxPostCheckpointEffect[];
}

export interface HostedWorkspaceRunnerPlatform
  extends HostedRuntimePlatform {
  mailboxPort: HostedRuntimeMailboxPort;
  workspacePort: HostedRuntimeWorkspacePort;
}

export interface HostedWorkspaceRunnerAssistantPhaseInput {
  assistantAutomationScheduleChanged?: (() => boolean) | null;
  backgroundMaintenanceSignal?: AbortSignal | null;
  clearAssistantAutomationScheduleChanged?: (() => void) | null;
  deviceSyncWorkspaceWakeHandled?: HostedWorkspaceRunnerHandledDeviceSyncWake | null;
  initialAssistantInputBatch?: HostedWorkspaceRunnerAssistantInputBatch | null;
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  latestAssistantInputBatch?: (() => HostedWorkspaceRunnerAssistantInputBatch | null) | null;
  materializeWorkspaceArtifacts?: HostedWorkspaceArtifactMaterializer | null;
  now?: () => string;
  platform: HostedRuntimePlatform;
  persistGeneratedImageCapture?: AssistantGeneratedImageCapturePersistence | null;
  prepareAutoReplyDelivery?: (() => Promise<void>) | null;
  providerStartCriticalPath?: AssistantProviderStartCriticalPathContext | null;
  recordDeferredUsage?: ((
    record: AssistantUsageRecord,
    providerRequestAcceptedInputIds?: readonly string[],
  ) => void) | null;
  shouldYieldBackgroundMaintenance?: (() => boolean) | null;
  workspace: HostedWorkspaceState | null;
}

export interface HostedWorkspaceRunnerAssistantInputBatch {
  assistantInputIds: readonly string[];
  assistantInputRecords?: readonly HostedMailboxAssistantInputRecord[];
  emailDeliveryContexts: readonly HostedAssistantEmailDeliveryContext[];
  linqDeliveryContexts: readonly HostedAssistantLinqDeliveryContext[];
}

interface HostedDeferredAssistantUsageRecord {
  providerRequestAcceptedInputIds?: readonly string[];
  record: AssistantUsageRecord;
}

export interface HostedWorkspaceRunnerHandledDeviceSyncWake {
  nextWakeAt: string;
  nextWakeReason: string | null;
}

interface HostedWorkspaceRunnerAssistantPhaseResultBase {
  afterCheckpoint?: (() => Promise<HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null | void>) | null;
  afterCheckpointKeepsForegroundImportLoop?: true;
  browserVaultReplicaRefreshRequested?: true;
  deviceSyncMaintenanceRan?: true;
  // Failed foreground reply count for this pass. Present only when the pass
  // ran the foreground assistant reply phase; selected-prefix repair uses it
  // to distinguish clean completion from retryable reply work.
  foregroundReplyFailed?: number | null;
  // Ephemeral provenance for an assistant wake created by work selected in
  // this invocation. This is never persisted; the runner and outer hot-wake
  // gate use it instead of inferring ownership from a merged wake timestamp.
  invocationLocalAssistantWakeAt?: string | null;
  nextWakeAt?: string | null;
  nextWakeReason?: string | null;
  redactedStatus?: HostedRuntimeRedactedJson | null;
  stagedDirtyAcks?: readonly HostedDeviceSyncDirtyProcessedPostCheckpointRecord[] | null;
}

export type HostedWorkspaceRunnerAssistantPhaseResult =
  | (HostedWorkspaceRunnerAssistantPhaseResultBase & {
      checkpointReason: HostedWorkspaceCheckpointReason;
      progressed: true;
    })
  | (HostedWorkspaceRunnerAssistantPhaseResultBase & {
      checkpointReason?: never;
      progressed?: false;
    });

export interface HostedWorkspaceRunnerAssistantPhasePostCheckpoint {
  afterDurableCheckpoint?: HostedWorkspaceDurableCheckpointEffects | null;
  checkpointReason: HostedWorkspaceCheckpointReason;
  nextWakeAt?: string | null;
  nextWakeReason?: string | null;
  redactedStatus?: HostedRuntimeRedactedJson | null;
}

export interface HostedWorkspaceDurableCheckpointEffectResult {
  nextWakeAt?: string | null;
  nextWakeReason?: string | null;
  requiresFollowUpCheckpoint?: boolean;
}

export interface HostedWorkspaceDurableCheckpointEffectContext {
  vaultShareProjectionResult?: HostedVaultShareProjectionOfferResult;
}

export interface HostedWorkspaceDurableCheckpointEffect {
  (
    context?: HostedWorkspaceDurableCheckpointEffectContext,
  ): Promise<HostedWorkspaceDurableCheckpointEffectResult | null | void>
    | HostedWorkspaceDurableCheckpointEffectResult
    | null
    | void;
  /** Consume the invocation-owned projection result; use the fallback wake only when none exists. */
  readonly requiresVaultShareProjectionResult?: boolean;
  readonly vaultShareProjectionFailureWake?:
    HostedWorkspaceDurableCheckpointEffectResult;
}

export type HostedWorkspaceDurableCheckpointEffects =
  | HostedWorkspaceDurableCheckpointEffect
  | readonly HostedWorkspaceDurableCheckpointEffect[];

const HOSTED_PRE_ASSISTANT_SYSTEM_IMPORT_MAX_PAGES = 4;

export interface HostedWorkspaceRunnerMailboxImportContext {
  assistantAskRequestTargetKind?: "joined_group";
  latencyMilestones?: HostedRuntimeLatencyTraceStagedMilestones | null;
  onConversationActivityObserved?: (() => void) | null;
  onConversationInputStaged?: ((
    channel: HostedExecutionConversationMessageChannel,
  ) => void) | null;
  runtimeAttemptId?: string | null;
  signal?: AbortSignal | null;
}

export interface HostedWorkspaceRunnerRuntimePassDiagnostics {
  foreground: boolean;
  ordinal: number;
  startedAtEpochMs: number;
}

export interface HostedWorkspaceRunnerDeferredUsageCapture {
  completion: Promise<void>;
  drainForProcessFatal(): Promise<void>;
}

export interface HostedWorkspaceRunnerRuntimeStatusCheckpointInput {
  nextWakeAt?: string | null;
  nextWakeReason?: string | null;
  reason: Exclude<HostedWorkspaceCheckpointReason, "idle_shutdown">;
  redactedStatus: HostedRuntimeRedactedJson | null;
  workspace: HostedWorkspaceState | null;
}

export type HostedWorkspaceRunnerMailboxImportItem = (
  item: HostedMailboxResolvedImportItem,
  context?: HostedWorkspaceRunnerMailboxImportContext,
) => Promise<HostedMailboxItemImportOutcome>;

export interface HostedWorkspaceRunnerInput {
  checkpointRuntimeRedactedStatus?: ((
    input: HostedWorkspaceRunnerRuntimeStatusCheckpointInput,
  ) => Promise<HostedWorkspaceCheckpointResponse> | HostedWorkspaceCheckpointResponse) | null;
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestBuilder;
  deferInitialMailboxPostCheckpointEffects?: boolean;
  expectedUserId: string;
  foregroundImportItem?: HostedWorkspaceRunnerMailboxImportItem | null;
  importItem: HostedWorkspaceRunnerMailboxImportItem;
  initialAssistantInputBatch?: HostedWorkspaceRunnerAssistantInputBatch | null;
  initialMailboxConversationDeferral?: HostedMailboxConversationDeferral | null;
  initialMailboxImport?: HostedMailboxImportCheckpointResult | null;
  initialMailboxImportContext?: HostedWorkspaceRunnerMailboxImportContext | null;
  initialMailboxImportLanes?: readonly ("conversation" | "system")[];
  initialMailboxFetchSignal?: AbortSignal | null;
  initialMailboxPrefetch?: HostedMailboxPrefixPrefetch | null;
  limitPerLane: number;
  materializeWorkspaceArtifacts?: HostedWorkspaceArtifactMaterializer | null;
  trackDeferredUsageCapture?: ((capture: HostedWorkspaceRunnerDeferredUsageCapture) => void) | null;
  trackLocalWorkspaceMutationCompletion?: ((completion: Promise<void> | null) => void) | null;
  withCanonicalWritePersistence?: (<T>(run: () => Promise<T>) => Promise<T>) | null;
  platform: HostedWorkspaceRunnerPlatform;
  requestId: string;
  providerStartCriticalPath?: AssistantProviderStartCriticalPathContext | null;
  runtimePassDiagnostics?: HostedWorkspaceRunnerRuntimePassDiagnostics | null;
  runtimeWakeSignal?: RuntimeWakeSignal | null;
  signal?: AbortSignal | null;
  runtimeLogContext?: HostedRuntimeLogContext | null;
  runAssistantPhase?: (
    input: HostedWorkspaceRunnerAssistantPhaseInput,
  ) => Promise<HostedWorkspaceRunnerAssistantPhaseResult>;
  vaultRoot: string;
  workspace: HostedWorkspaceState | null;
  now?: () => string;
}

interface HostedMailboxPostCheckpointEffectsResult {
  attempted: boolean;
  effectAttachmentEvidenceUpdated: readonly (boolean | null)[];
  effectKinds: readonly HostedMailboxPostCheckpointEffectResult["kind"][];
  effectProjectionUpdated: readonly (boolean | null)[];
  effectReasonCodes: readonly (string | null)[];
  effectStatuses: readonly HostedMailboxPostCheckpointEffectResult["status"][];
  errorCodes: readonly string[];
  failureCodeDetails: readonly string[];
  failureNames: readonly string[];
  failureSummaries: readonly string[];
  failed: number;
  partial: number;
  succeeded: number;
}

const HOSTED_MAILBOX_POST_CHECKPOINT_EFFECT_TIMEOUT_MS = 15_000;

export interface HostedWorkspaceRunnerResult {
  afterDurableCheckpoint: readonly HostedWorkspaceDurableCheckpointEffect[];
  assistantPhaseResult: HostedWorkspaceRunnerAssistantPhaseResult | null;
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  latestAssistantInputBatch: HostedWorkspaceRunnerAssistantInputBatch | null;
  latestMailboxImport: HostedMailboxImportCheckpointResult;
  latestWorkspace: HostedWorkspaceState | null;
  mailboxPostCheckpointEffectsFinished: Promise<void> | null;
  mailboxRetryAt: string | null;
  runtimeRedactedStatus: HostedRuntimeRedactedJson | null;
  runtimeStateDirty: boolean;
}

export class HostedWorkspaceRunnerUserMismatchError extends Error {
  readonly actualUserId: string;
  readonly expectedUserId: string;

  constructor(input: {
    actualUserId: string;
    expectedUserId: string;
  }) {
    super("Hosted workspace runner received an unexpected workspace user.");
    this.name = "HostedWorkspaceRunnerUserMismatchError";
    this.actualUserId = input.actualUserId;
    this.expectedUserId = input.expectedUserId;
  }
}

export function createHostedWorkspaceCheckpointRequestBuilder(
  metadata: HostedWorkspaceCheckpointMetadata,
): HostedWorkspaceCheckpointRequestBuilder {
  return {
    createRequest(input) {
      return {
        attemptId: metadata.attemptId,
        ...(Object.hasOwn(metadata, "browserVaultReplicaRef")
          ? { browserVaultReplicaRef: metadata.browserVaultReplicaRef ?? null }
          : {}),
        expectedWorkspaceVersion: metadata.expectedWorkspaceVersion,
        ...(input.handledConversationMailboxItemIds === undefined
          ? {}
          : {
              handledConversationMailboxItemIds:
                [...input.handledConversationMailboxItemIds],
            }),
        ...(input.idleCheckpointTrigger
          ? { idleCheckpointTrigger: input.idleCheckpointTrigger }
          : {}),
        leaseGeneration: metadata.leaseGeneration,
        nextWakeAt: Object.hasOwn(input, "nextWakeAt")
          ? input.nextWakeAt ?? null
          : metadata.nextWakeAt ?? null,
        nextWakeReason: Object.hasOwn(input, "nextWakeReason")
          ? input.nextWakeReason ?? null
          : metadata.nextWakeReason ?? null,
        reason: input.reason,
        redactedStatus: cloneHostedRuntimeRedactedJson(input.redactedStatus ?? null),
        ...(input.runtimeWakePendingAtCheckpoint === undefined
          ? {}
          : { runtimeWakePendingAtCheckpoint: input.runtimeWakePendingAtCheckpoint }),
        snapshotRef: metadata.snapshotRef,
      };
    },
    recordCheckpoint(response) {
      if (response.checkpointed) {
        metadata.expectedWorkspaceVersion = response.workspace.version;
      }
    },
  };
}

export function createHostedWorkspaceSnapshotCheckpointRequestBuilder(input: {
  createSnapshot: HostedWorkspaceSnapshotCheckpointBuilder;
  metadata: HostedWorkspaceSnapshotCheckpointMetadata;
}): HostedWorkspaceCheckpointRequestBuilder {
  // The builder owns every field of checkpoint metadata that
  // buildHostedWorkspaceSnapshotCheckpointRequest falls back to. Mirroring the
  // committed workspace here after a successful checkpoint prevents a later
  // pass that omits one of these fields (e.g. a mailbox checkpoint after an
  // idle retention checkpoint) from resurrecting a stale process-start value.
  const recordCheckpoint = (response: HostedWorkspaceCheckpointResponse): void => {
    if (!response.checkpointed) {
      return;
    }
    input.metadata.expectedWorkspaceVersion = response.workspace.version;
    input.metadata.inboxMediaRetentionWakeAt =
      response.workspace.inboxMediaRetentionWakeAt ?? null;
    input.metadata.nextWakeAt = response.workspace.nextWakeAt ?? null;
    input.metadata.nextWakeReason = response.workspace.nextWakeReason ?? null;
  };

  return {
    async checkpoint(requestInput, workspacePort, context) {
      const expectedWorkspaceVersion =
        requestInput.expectedWorkspaceVersion ?? input.metadata.expectedWorkspaceVersion;
      const snapshot = await input.createSnapshot({
        ...requestInput,
        expectedWorkspaceVersion,
      }, context);
      if (snapshot.checkpoint) {
        recordCheckpoint(snapshot.checkpoint);
        return snapshot.checkpoint;
      }
      const response = await workspacePort.checkpoint(
        buildHostedWorkspaceSnapshotCheckpointRequest({
          metadata: input.metadata,
          requestInput,
          snapshot,
        }),
      );
      recordCheckpoint(response);
      return response;
    },
    async createRequest(requestInput, context) {
      const expectedWorkspaceVersion =
        requestInput.expectedWorkspaceVersion ?? input.metadata.expectedWorkspaceVersion;
      const snapshot = await input.createSnapshot({
        ...requestInput,
        expectedWorkspaceVersion,
      }, context);
      return buildHostedWorkspaceSnapshotCheckpointRequest({
        metadata: input.metadata,
        requestInput: {
          ...requestInput,
          expectedWorkspaceVersion,
        },
        snapshot,
      });
    },
    recordCheckpoint,
  };
}

function buildHostedWorkspaceSnapshotCheckpointRequest(input: {
  metadata: HostedWorkspaceSnapshotCheckpointMetadata;
  requestInput: HostedWorkspaceSnapshotCheckpointRequestBuilderInput;
  snapshot: HostedWorkspaceSnapshotCheckpointResult;
}): HostedWorkspaceCheckpointRequest {
  return {
    attemptId: input.metadata.attemptId,
    ...(Object.hasOwn(input.snapshot, "browserVaultReplicaRef")
      ? { browserVaultReplicaRef: input.snapshot.browserVaultReplicaRef ?? null }
      : {}),
    expectedWorkspaceVersion:
      input.requestInput.expectedWorkspaceVersion ?? input.metadata.expectedWorkspaceVersion,
    ...(input.requestInput.handledConversationMailboxItemIds === undefined
      ? {}
      : {
          handledConversationMailboxItemIds:
            [...input.requestInput.handledConversationMailboxItemIds],
        }),
    ...(input.requestInput.idleCheckpointTrigger
      ? { idleCheckpointTrigger: input.requestInput.idleCheckpointTrigger }
      : {}),
    inboxMediaRetentionWakeAt: Object.hasOwn(input.requestInput, "inboxMediaRetentionWakeAt")
      ? input.requestInput.inboxMediaRetentionWakeAt ?? null
      : input.metadata.inboxMediaRetentionWakeAt ?? null,
    leaseGeneration: input.metadata.leaseGeneration,
    nextWakeAt: Object.hasOwn(input.requestInput, "nextWakeAt")
      ? input.requestInput.nextWakeAt ?? null
      : input.metadata.nextWakeAt ?? null,
    nextWakeReason: Object.hasOwn(input.requestInput, "nextWakeReason")
      ? input.requestInput.nextWakeReason ?? null
      : input.metadata.nextWakeReason ?? null,
    reason: input.requestInput.reason,
    redactedStatus: cloneHostedRuntimeRedactedJson(input.requestInput.redactedStatus ?? null),
    ...(input.requestInput.runtimeWakePendingAtCheckpoint === undefined
      ? {}
      : {
          runtimeWakePendingAtCheckpoint:
            input.requestInput.runtimeWakePendingAtCheckpoint,
        }),
    snapshotRef: input.snapshot.snapshotRef,
  };
}

export async function runHostedWorkspaceUntilIdleOrBudget(
  input: HostedWorkspaceRunnerInput,
): Promise<HostedWorkspaceRunnerResult> {
  assertHostedWorkspaceRunnerUser(input);

  const afterDurableCheckpoint: HostedWorkspaceDurableCheckpointEffect[] = [];
  const initialAssistantInputBatch = input.initialAssistantInputBatch ?? null;
  const checkpointRequestSession = createHostedWorkspaceCheckpointRequestSession(
    input.checkpointRequestBuilder,
    {
      assistantInputBatchLimit: input.limitPerLane,
      initialAssistantInputCount:
        initialAssistantInputBatch?.assistantInputIds.length ?? 0,
    },
  );
  let assistantContextSnapshotDirty = false;
  let assistantAutomationScheduleChanged = false;
  let runtimeRedactedStatus: HostedRuntimeRedactedJson | null = null;
  const mergeRuntimeRedactedStatus = (status: HostedRuntimeRedactedJson): void => {
    runtimeRedactedStatus = {
      ...(runtimeRedactedStatus ?? {}),
      ...status,
    };
  };
  const readDurableRedactedStatus = (): HostedRuntimeRedactedJson | null =>
    mergeHostedRuntimeRedactedStatusValues(
      input.workspace?.redactedStatus ?? null,
      checkpointRequestSession.latestWorkspace()?.redactedStatus ?? null,
    );
  const readCurrentRedactedStatus = (): HostedRuntimeRedactedJson | null =>
    mergeHostedRuntimeRedactedStatusValues(
      readDurableRedactedStatus(),
      runtimeRedactedStatus,
    );
  const createAssistantCanonicalWritePort = (
    generatedImageRetentionWakeAt?: string | null,
  ): HostedCanonicalWritePort => createHostedWorkspaceCanonicalWritePort({
    onAssistantAutomationScheduleChanged: () => {
      assistantAutomationScheduleChanged = true;
    },
    checkpointRequestBuilder: checkpointRequestSession,
    generatedImageRetentionWakeAt: generatedImageRetentionWakeAt ?? null,
    input,
    onAssistantContextSnapshotDirty: () => {
      assistantContextSnapshotDirty = true;
    },
    readPreviousRedactedStatus: readCurrentRedactedStatus,
    recordRedactedStatus: mergeRuntimeRedactedStatus,
  });
  const hostedCanonicalWritePort = createAssistantCanonicalWritePort();
  const hostedCanonicalMailboxWritePort = createHostedWorkspaceCanonicalWritePort({
    checkpointRequestBuilder: checkpointRequestSession,
    deferRuntimeStatusCheckpoint: true,
    input,
    onAssistantContextSnapshotDirty: () => {
      assistantContextSnapshotDirty = true;
    },
    readPreviousRedactedStatus: readCurrentRedactedStatus,
    recordRedactedStatus: mergeRuntimeRedactedStatus,
  });
  const checkpointCanonicalMailboxImportProgress = async (
    result: HostedMailboxImportCheckpointResult,
  ): Promise<void> => {
    if (!isDeferredHostedMailboxImportDirty(result)) {
      return;
    }
    const persist = async (): Promise<void> => {
      const pendingReceiptLog = readHostedCanonicalWriteReceiptLogStatusFingerprint(
        readCurrentRedactedStatus(),
      );
      if (!pendingReceiptLog) {
        return;
      }
      if (!input.checkpointRuntimeRedactedStatus) {
        throw new TypeError(
          "Hosted canonical mailbox progress checkpoint requires runtime status checkpoint support.",
        );
      }
      const mailboxStatus = buildHostedMailboxImportRedactedStatus(result.importResult);
      const redactedStatus = mergeHostedRuntimeRedactedStatusValues(
        readCurrentRedactedStatus(),
        mailboxStatus,
      ) ?? mailboxStatus;
      const workspace = checkpointRequestSession.latestWorkspace() ?? input.workspace;
      const now = resolveHostedWorkspaceRunnerNowIso(input.now);
      const systemMailboxWake =
        (result.importResult.importedSystemMailboxItemIds?.length ?? 0) > 0
          ? await resolveHostedSystemMailboxNextWakeCandidate({
              now: () => now,
              vaultRoot: input.vaultRoot,
            })
          : null;
      const stagedAssistantWork =
        (result.importResult.assistantInputIds?.length ?? 0) > 0
        || (result.importResult.conversationImportedCount ?? 0) > 0;
      const nextWake = selectHostedRuntimeWakeCandidate([
        createHostedRuntimeWakeCandidate(
          workspace?.nextWakeAt,
          workspace?.nextWakeReason ?? null,
        ),
        createHostedRuntimeWakeCandidate(
          result.importResult.nextRetryAt,
          "mailbox",
        ),
        systemMailboxWake,
        stagedAssistantWork
          ? createHostedRuntimeWakeCandidate(now, HOSTED_ASSISTANT_WAKE_REASON)
          : null,
      ]);
      const checkpoint = await input.checkpointRuntimeRedactedStatus({
        nextWakeAt: nextWake.at,
        nextWakeReason: nextWake.reason,
        reason: "canonical_runtime_commit",
        redactedStatus,
        workspace,
      });
      if (checkpoint.workspace.userId !== input.expectedUserId) {
        throw new HostedMailboxImportCheckpointUserMismatchError({
          actualUserId: checkpoint.workspace.userId,
          expectedUserId: input.expectedUserId,
        });
      }
      if (!checkpoint.checkpointed) {
        throw new HostedMailboxImportCheckpointConflictError(checkpoint);
      }
      checkpointRequestSession.recordStatusCheckpoint(checkpoint);
      mergeRuntimeRedactedStatus(mailboxStatus);
    };
    if (input.withCanonicalWritePersistence) {
      await input.withCanonicalWritePersistence(persist);
      return;
    }
    await persist();
  };
  let initialMailboxImport = input.initialMailboxImport
    ?? await withHostedCanonicalWritePort(
      hostedCanonicalMailboxWritePort,
      async () => await importHostedMailboxForWorkspaceRunner({
        checkpointRequestBuilder: checkpointRequestSession,
        checkpointReason: "import",
        deferConversationUntil: input.initialMailboxConversationDeferral ?? null,
        deferCheckpoint: true,
        importItemContext: input.initialMailboxImportContext ?? null,
        input,
        lanes: input.initialMailboxImportLanes
          ?? (input.runAssistantPhase ? ["conversation"] : undefined),
        mailboxFetchSignal: input.initialMailboxFetchSignal ?? null,
        prefetch: input.initialMailboxPrefetch ?? null,
        requestId: input.requestId,
        signal: input.signal ?? null,
        checkpointCanonicalMailboxImportProgress,
      }),
    );
  checkpointRequestSession.recordCheckpointResult(initialMailboxImport, {
    captureAssistantInputBatch: false,
  });
  markHostedMailboxImportDirtyIfNeeded(checkpointRequestSession, initialMailboxImport);

  const initialAssistantInputBatchHasWork =
    hostedWorkspaceRunnerAssistantInputBatchHasWork(initialAssistantInputBatch);
  const initialMailboxImportHasForegroundConversationWork =
    hasHostedMailboxImportForegroundConversationWork(initialMailboxImport);
  if (
    input.runAssistantPhase
    && (initialAssistantInputBatchHasWork || initialMailboxImportHasForegroundConversationWork)
    && shouldImportHostedPreAssistantSystemMailbox({
      initialMailboxImport,
      now: input.now,
    })
  ) {
    try {
      await withHostedCanonicalWritePort(
        hostedCanonicalMailboxWritePort,
        async () => await importHostedPreAssistantSystemMailboxForWorkspaceRunner({
          checkpointRequestBuilder: checkpointRequestSession,
          importItemContext: input.initialMailboxImportContext ?? null,
          input,
          requestId: input.requestId,
          signal: input.signal ?? null,
          checkpointCanonicalMailboxImportProgress,
        }),
      );
    } catch (error) {
      if (isHostedWorkspaceRunnerAbortError(error, input.signal ?? null)) {
        throw error;
      }
      await writeHostedPreAssistantSystemMailboxImportFailureRuntimeLog({
        error,
        input,
      });
      // Foreground conversation work still owns this pass. The system lane will
      // retry from its unchanged watermark on the next mailbox/system wake.
    }
  } else if (
    input.runAssistantPhase
    && !initialAssistantInputBatchHasWork
    && !initialMailboxImportHasForegroundConversationWork
  ) {
    const preAssistantSystemImport = await withHostedCanonicalWritePort(
      hostedCanonicalMailboxWritePort,
      async () => await importHostedPreAssistantSystemMailboxForWorkspaceRunner({
        checkpointRequestBuilder: checkpointRequestSession,
        importItemContext: input.initialMailboxImportContext ?? null,
        input,
        requestId: input.requestId,
        signal: input.signal ?? null,
        checkpointCanonicalMailboxImportProgress,
      }),
    );
    initialMailboxImport = preAssistantSystemImport ?? initialMailboxImport;
  }

  if (!input.runAssistantPhase) {
    if (input.deferInitialMailboxPostCheckpointEffects !== true) {
      await runHostedMailboxPostCheckpointEffectsAndLogBestEffort({
        checkpointRequestBuilder: checkpointRequestSession,
        input,
      });
    }
    return {
      afterDurableCheckpoint,
      assistantPhaseResult: null,
      initialMailboxImport,
      latestMailboxImport: checkpointRequestSession.latestMailboxImport()
        ?? initialMailboxImport,
      latestAssistantInputBatch:
        checkpointRequestSession.latestAssistantInputBatch(),
      latestWorkspace: checkpointRequestSession.latestWorkspace()
        ?? initialMailboxImport.checkpoint?.workspace
        ?? input.workspace,
      mailboxPostCheckpointEffectsFinished: null,
      mailboxRetryAt: checkpointRequestSession.mailboxRetryAt(),
      runtimeRedactedStatus,
      runtimeStateDirty: checkpointRequestSession.hasRuntimeStateDirty(),
    };
  }

  const acceptedInitialAssistantInputBatch = initialAssistantInputBatch
    ?? accumulateHostedWorkspaceRunnerAssistantInputBatch({
      assistantInputBatchLimit: input.limitPerLane,
      current: null,
      result: initialMailboxImport,
    });
  const selectedInitialAssistantInputIds = acceptedInitialAssistantInputBatch
      ? (await selectHostedAssistantInputIds({
          freshAssistantInputIds: acceptedInitialAssistantInputBatch.assistantInputIds,
          mode: "foreground",
          vaultRoot: input.vaultRoot,
        })).inputIds
    : [];
  const selectedInitialAssistantInputBatch = acceptedInitialAssistantInputBatch
    ? includeHostedWorkspaceRunnerAssistantInputBatch(
        acceptedInitialAssistantInputBatch,
        new Set(selectedInitialAssistantInputIds),
      )
    : null;
  checkpointRequestSession.seedAssistantInputSelection(
    selectedInitialAssistantInputIds.length,
    acceptedInitialAssistantInputBatch
      ? filterHostedWorkspaceRunnerAssistantInputBatch(
          acceptedInitialAssistantInputBatch,
          new Set(selectedInitialAssistantInputIds),
        )
      : null,
  );

  const runAssistantPhase = input.runAssistantPhase;
  const deferredUsageRecords: HostedDeferredAssistantUsageRecord[] = [];
  const pendingDeferredUsageWrites = new Set<Promise<void>>();
  let deferredUsageWriteTail = Promise.resolve();
  let deferredUsageCaptureClosed = false;
  let deferredUsageCaptureStarted = false;
  let deferredUsageCompletionSettled = false;
  let resolveDeferredUsageCompletion: () => void = () => undefined;
  const deferredUsageCompletion = new Promise<void>((resolve) => {
    resolveDeferredUsageCompletion = resolve;
  });
  const resolveDeferredUsageCompletionOnce = (): void => {
    if (deferredUsageCompletionSettled) {
      return;
    }

    deferredUsageCompletionSettled = true;
    resolveDeferredUsageCompletion();
  };
  const maybeResolveDeferredUsageCompletion = (): void => {
    if (deferredUsageCaptureClosed && pendingDeferredUsageWrites.size === 0) {
      resolveDeferredUsageCompletionOnce();
    }
  };
  const startDeferredUsageRecords = (
    records: readonly HostedDeferredAssistantUsageRecord[],
  ): void => {
    if (records.length === 0) {
      maybeResolveDeferredUsageCompletion();
      return;
    }

    const completion = deferredUsageWriteTail.then(async () => {
      await flushHostedAssistantUsageRecordsBestEffort({
        input,
        records,
      });
    });
    deferredUsageWriteTail = completion.catch(() => undefined);
    pendingDeferredUsageWrites.add(completion);
    void completion.finally(() => {
      pendingDeferredUsageWrites.delete(completion);
      maybeResolveDeferredUsageCompletion();
    });
  };
  const startDeferredUsageCaptureOnce = (): Promise<void> => {
    if (deferredUsageCaptureStarted) {
      return deferredUsageCompletion;
    }

    deferredUsageCaptureStarted = true;
    startDeferredUsageRecords(deferredUsageRecords.splice(0));
    maybeResolveDeferredUsageCompletion();
    return deferredUsageCompletion;
  };
  const closeDeferredUsageCapture = (): void => {
    deferredUsageCaptureClosed = true;
    maybeResolveDeferredUsageCompletion();
  };
  const startDeferredUsageCaptureOnAbort = (): void => {
    void startDeferredUsageCaptureOnce();
  };
  const drainDeferredUsageCaptureForProcessFatal = (): Promise<void> => {
    const completion = startDeferredUsageCaptureOnce();
    closeDeferredUsageCapture();
    return completion;
  };
  input.trackDeferredUsageCapture?.({
    completion: deferredUsageCompletion,
    drainForProcessFatal: drainDeferredUsageCaptureForProcessFatal,
  });
  if (input.signal?.aborted) {
    startDeferredUsageCaptureOnAbort();
  } else {
    input.signal?.addEventListener("abort", startDeferredUsageCaptureOnAbort, {
      once: true,
    });
  }
  const runnerStartedAtEpochMs = Date.now();
  let foregroundConversationImportsInFlight = 0;
  let foregroundConversationWorkObserved = false;
  let foregroundRuntimeWakeObservedAfterStop = false;
  const backgroundMaintenanceAbortController = new AbortController();
  const abortBackgroundMaintenance = (reason: unknown): void => {
    if (!backgroundMaintenanceAbortController.signal.aborted) {
      backgroundMaintenanceAbortController.abort(reason);
    }
  };
  const abortBackgroundMaintenanceOnRunnerAbort = (): void => {
    abortBackgroundMaintenance(input.signal?.reason);
  };
  if (input.signal?.aborted) {
    abortBackgroundMaintenanceOnRunnerAbort();
  } else {
    input.signal?.addEventListener("abort", abortBackgroundMaintenanceOnRunnerAbort, {
      once: true,
    });
  }
  let foregroundMailboxImportLoop:
    ReturnType<typeof startHostedForegroundConversationMailboxImportLoop> | null = null;
  const startForegroundMailboxImportLoop = async (): Promise<void> => {
    if (foregroundMailboxImportLoop) {
      return;
    }
    foregroundRuntimeWakeObservedAfterStop = false;
    foregroundMailboxImportLoop = await withHostedCanonicalWritePort(
      hostedCanonicalMailboxWritePort,
      async () => startHostedForegroundConversationMailboxImportLoop({
        checkpointRequestBuilder: checkpointRequestSession,
        input,
        onForegroundConversationImportFinished: () => {
          foregroundConversationImportsInFlight -= 1;
        },
        onForegroundConversationImportStarted: () => {
          foregroundConversationImportsInFlight += 1;
        },
        onForegroundConversationWorkObserved: () => {
          foregroundConversationWorkObserved = true;
        },
        checkpointCanonicalMailboxImportProgress,
      }),
    );
    input.trackLocalWorkspaceMutationCompletion?.(foregroundMailboxImportLoop.completion);
  };
  await startForegroundMailboxImportLoop();
  const stopForegroundMailboxImportLoop = async (): Promise<void> => {
    const activeLoop = foregroundMailboxImportLoop;
    if (!activeLoop) {
      return;
    }
    await activeLoop.stop();
    if (foregroundMailboxImportLoop === activeLoop) {
      foregroundMailboxImportLoop = null;
    }
  };
  const shouldYieldBackgroundMaintenance = (): boolean => {
    if (
      foregroundConversationImportsInFlight > 0
      || foregroundConversationWorkObserved
      || foregroundRuntimeWakeObservedAfterStop
    ) {
      return true;
    }

    if (foregroundMailboxImportLoop) {
      return false;
    }

    const pendingRuntimeWake = input.runtimeWakeSignal?.consumePending() ?? null;
    if (!pendingRuntimeWake) {
      return false;
    }

    const latestRuntimeWakeAtEpochMs =
      pendingRuntimeWake.latestNotifiedAtEpochMs
      ?? pendingRuntimeWake.notifiedAtEpochMs;
    if (latestRuntimeWakeAtEpochMs < runnerStartedAtEpochMs) {
      return false;
    }

    input.runtimeWakeSignal?.notify({
      ...(pendingRuntimeWake.orchestration
        ? { orchestration: pendingRuntimeWake.orchestration }
        : {}),
      notifiedAtEpochMs: pendingRuntimeWake.notifiedAtEpochMs,
    });
    if (
      pendingRuntimeWake.latestNotifiedAtEpochMs !== undefined
      && pendingRuntimeWake.latestNotifiedAtEpochMs !== pendingRuntimeWake.notifiedAtEpochMs
    ) {
      input.runtimeWakeSignal?.notify(pendingRuntimeWake.latestNotifiedAtEpochMs);
    }
    foregroundRuntimeWakeObservedAfterStop = true;
    return true;
  };
  const stopForegroundMailboxImportLoopAndNotify = async (): Promise<void> => {
    await stopForegroundMailboxImportLoop();
    if (!foregroundConversationWorkObserved) {
      return;
    }
    // Preserve the selected durable wake, and nudge the outer dirty loop to run
    // the new foreground pass before idle checkpointing when assistant work was
    // staged by a foreground import.
    await notifyPendingForegroundAssistantInputWake({
      now: input.now,
      runtimeWakeSignal: input.runtimeWakeSignal ?? null,
      vaultRoot: input.vaultRoot,
    });
  };
  const persistGeneratedImageCapture: AssistantGeneratedImageCapturePersistence =
    async (write, metadata) =>
      await withHostedCanonicalWritePort(
        createAssistantCanonicalWritePort(metadata.retentionWakeAt),
        write,
      );
  const assistantPhaseInput = {
    assistantAutomationScheduleChanged: () => assistantAutomationScheduleChanged,
    backgroundMaintenanceSignal: backgroundMaintenanceAbortController.signal,
    clearAssistantAutomationScheduleChanged: () => {
      assistantAutomationScheduleChanged = false;
    },
    initialAssistantInputBatch: selectedInitialAssistantInputBatch,
    initialMailboxImport,
    latestAssistantInputBatch: () =>
      checkpointRequestSession.latestAssistantInputBatch(),
    materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts ?? null,
    now: input.now,
    platform: input.platform,
    persistGeneratedImageCapture,
    prepareAutoReplyDelivery: async () => {
      await stopForegroundMailboxImportLoop();
      if (!foregroundConversationWorkObserved && !input.signal?.aborted) {
        // Stopping the watcher establishes the local pre-dispatch boundary, but
        // it is not the end of foreground admission. Resume the existing
        // conversation watcher so later input can still preempt delivery.
        await startForegroundMailboxImportLoop();
        await foregroundMailboxImportLoop?.drainPendingWake();
      }
    },
    ...(input.providerStartCriticalPath
      ? { providerStartCriticalPath: input.providerStartCriticalPath }
      : {}),
    recordDeferredUsage(
      record: AssistantUsageRecord,
      providerRequestAcceptedInputIds?: readonly string[],
    ): void {
      const deferredRecord = {
        ...(providerRequestAcceptedInputIds === undefined
          ? {}
          : { providerRequestAcceptedInputIds: [...providerRequestAcceptedInputIds] }),
        record,
      };
      if (deferredUsageCaptureStarted) {
        startDeferredUsageRecords([deferredRecord]);
        return;
      }

      deferredUsageRecords.push(deferredRecord);
    },
    shouldYieldBackgroundMaintenance,
    workspace: input.workspace,
  };
  let mailboxPostCheckpointEffectsFinished: Promise<void> | null = null;
  let assistantPhaseResult: HostedWorkspaceRunnerAssistantPhaseResult;
  let latestAssistantInputBatch: HostedWorkspaceRunnerAssistantInputBatch | null = null;
  let runnerError: unknown = null;
  try {
    assistantPhaseResult = await withHostedCanonicalWritePort(
      hostedCanonicalWritePort,
      () => runAssistantPhase(assistantPhaseInput),
    );
    if (
      assistantContextSnapshotDirty
      || await isAssistantContextSnapshotRefreshPendingBestEffort(input.vaultRoot)
    ) {
      mergeAssistantContextSnapshotRefreshWake({
        now: input.now,
        result: assistantPhaseResult,
      });
    }
    await checkpointHostedWorkspaceAssistantPhase({
      assistantPhaseResult,
      checkpointRequestBuilder: checkpointRequestSession,
      expectedUserId: input.expectedUserId,
      initialMailboxImport,
      now: input.now,
      platform: input.platform,
      runtimeLogContext: input.runtimeLogContext,
    });
    if (assistantPhaseResult.afterCheckpoint && assistantPhaseResult.progressed !== true) {
      throw new TypeError("Hosted workspace assistant phase afterCheckpoint requires a progressed phase.");
    }
    const keepForegroundImportLoopDuringAfterCheckpoint =
      assistantPhaseResult.afterCheckpointKeepsForegroundImportLoop === true
      && !foregroundConversationWorkObserved;
    if (!keepForegroundImportLoopDuringAfterCheckpoint) {
      await stopForegroundMailboxImportLoopAndNotify();
    }
    let postCheckpoint: HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null | void;
    try {
      postCheckpoint = await withHostedCanonicalWritePort(
        hostedCanonicalWritePort,
        async () => await assistantPhaseResult.afterCheckpoint?.(),
      );
    } catch (error) {
      await writeHostedWorkspaceAssistantPostCheckpointFailureRuntimeLog({
        error,
        errorCode: "assistant_after_checkpoint_failed",
        input,
      });
      postCheckpoint = null;
    }
    if (keepForegroundImportLoopDuringAfterCheckpoint) {
      await stopForegroundMailboxImportLoopAndNotify();
    }
    if (postCheckpoint) {
      try {
        await checkpointHostedWorkspacePostAssistantPhase({
          checkpointRequestBuilder: checkpointRequestSession,
          initialMailboxImport,
          now: input.now,
          postCheckpoint,
          platform: input.platform,
          runtimeLogContext: input.runtimeLogContext,
        });
        mergeDeferredPostCheckpointRedactedStatus({
          assistantPhaseResult,
          postCheckpoint,
        });
        mergeDeferredPostCheckpointWake({
          assistantPhaseResult,
          postCheckpoint,
        });
        if (await isAssistantContextSnapshotRefreshPendingBestEffort(input.vaultRoot)) {
          mergeAssistantContextSnapshotRefreshWake({
            now: input.now,
            result: assistantPhaseResult,
          });
        }
        appendHostedWorkspaceDurableCheckpointEffect({
          effects: afterDurableCheckpoint,
          postCheckpoint,
        });
      } catch (error) {
        if (
          error instanceof HostedMailboxImportCheckpointConflictError
          || error instanceof HostedMailboxImportCheckpointUserMismatchError
        ) {
          throw error;
        }
        await writeHostedWorkspaceAssistantPostCheckpointFailureRuntimeLog({
          error,
          errorCode: "assistant_after_checkpoint_checkpoint_failed",
          input,
        });
      }
    }
    latestAssistantInputBatch =
      await rebuildHostedWorkspaceRunnerAssistantInputBatchAfterSelectedPrefixRepair({
        acceptedInitialAssistantInputBatch,
        assistantPhaseResult,
        latestAssistantInputBatch:
          checkpointRequestSession.latestAssistantInputBatch(),
        now: input.now,
        selectedInitialAssistantInputIds,
        signal: input.signal ?? null,
        vaultRoot: input.vaultRoot,
      });
    await reconcilePendingAssistantInputWake({
      foregroundConversationWorkObserved:
        initialAssistantInputBatchHasWork
        || initialMailboxImportHasForegroundConversationWork
        || foregroundConversationWorkObserved,
      now: input.now,
      result: assistantPhaseResult,
      vaultRoot: input.vaultRoot,
    });
    if (hostedConversationReplayFloorNeedsCheckpoint({
      conversationConsumedSeq: checkpointRequestSession.conversationConsumedSeq(),
      latestMailboxImport:
        checkpointRequestSession.latestMailboxImport() ?? initialMailboxImport,
    })) {
      // A replay-only restore may have no other dirty state. Force the existing
      // idle checkpoint so Web can stamp exact terminal mailbox rows and derive
      // the contiguous replay floor in the snapshot transaction.
      checkpointRequestSession.markRuntimeStateDirty();
    }
    mailboxPostCheckpointEffectsFinished = scheduleHostedMailboxPostCheckpointEffectsAndLogBestEffort({
      checkpointRequestBuilder: checkpointRequestSession,
      input,
      phase: "import",
    });
  } catch (error) {
    runnerError = error;
    await stopForegroundMailboxImportLoop();
    scheduleHostedMailboxPostCheckpointEffectsAndLogBestEffort({
      checkpointRequestBuilder: checkpointRequestSession,
      input,
      phase: "import",
    });
    throw error;
  } finally {
    try {
      await stopForegroundMailboxImportLoop();
    } catch (error) {
      runnerError ??= error;
      throw error;
    } finally {
      input.signal?.removeEventListener("abort", abortBackgroundMaintenanceOnRunnerAbort);
      input.signal?.removeEventListener("abort", startDeferredUsageCaptureOnAbort);
      const deferredUsageCompletionForRunner = startDeferredUsageCaptureOnce();
      closeDeferredUsageCapture();
      if (
        runnerError !== null
        && !isHostedWorkspaceRunnerAbortError(runnerError, input.signal ?? null)
      ) {
        await deferredUsageCompletionForRunner;
      }
    }
  }

  return {
    afterDurableCheckpoint,
    assistantPhaseResult,
    initialMailboxImport,
    latestMailboxImport: checkpointRequestSession.latestMailboxImport()
      ?? initialMailboxImport,
    latestAssistantInputBatch,
    latestWorkspace: checkpointRequestSession.latestWorkspace()
      ?? initialMailboxImport.checkpoint?.workspace
      ?? input.workspace,
    mailboxPostCheckpointEffectsFinished,
    mailboxRetryAt: checkpointRequestSession.mailboxRetryAt(),
    runtimeRedactedStatus,
    runtimeStateDirty: checkpointRequestSession.hasRuntimeStateDirty(),
  };
}

export async function runHostedWorkspaceCanonicalWriteAtBoundary<TResult>(input: {
  previousRedactedStatus: HostedRuntimeRedactedJson | null;
  runnerInput: HostedWorkspaceRunnerInput;
  write(): Promise<TResult>;
}): Promise<{
  canonicalWritePersisted: boolean;
  redactedStatus: HostedRuntimeRedactedJson | null;
  result: TResult;
  workspace: HostedWorkspaceState | null;
}> {
  const checkpointRequestSession = createHostedWorkspaceCheckpointRequestSession(
    input.runnerInput.checkpointRequestBuilder,
    {
      assistantInputBatchLimit: input.runnerInput.limitPerLane,
    },
  );
  let writeStatus: HostedRuntimeRedactedJson | null = null;
  const readCurrentStatus = (): HostedRuntimeRedactedJson | null =>
    mergeHostedRuntimeRedactedStatusValues(
      mergeHostedRuntimeRedactedStatusValues(
        input.previousRedactedStatus,
        checkpointRequestSession.latestWorkspace()?.redactedStatus ?? null,
      ),
      writeStatus,
    );
  const canonicalWritePort = createHostedWorkspaceCanonicalWritePort({
    checkpointRequestBuilder: checkpointRequestSession,
    input: input.runnerInput,
    readPreviousRedactedStatus: readCurrentStatus,
    recordRedactedStatus(status) {
      writeStatus = mergeHostedRuntimeRedactedStatusValues(writeStatus, status);
    },
  });
  let canonicalWritePersisted = false;
  const port: HostedCanonicalWritePort = {
    async persistCanonicalWrite(writeInput) {
      await canonicalWritePort.persistCanonicalWrite(writeInput);
      canonicalWritePersisted = true;
    },
  };

  const result = await withHostedCanonicalWritePort(port, input.write);
  return {
    canonicalWritePersisted,
    redactedStatus: canonicalWritePersisted ? readCurrentStatus() : writeStatus,
    result,
    workspace:
      checkpointRequestSession.latestWorkspace() ?? input.runnerInput.workspace,
  };
}

export async function finishHostedMailboxImportPostCheckpointEffects(input: {
  importResult: HostedMailboxImportCheckpointResult;
  runnerInput: HostedWorkspaceRunnerInput;
  signal?: AbortSignal | null;
}): Promise<void> {
  await runHostedMailboxPostCheckpointEffectsAndWriteLogBestEffort({
    effects: input.importResult.afterCheckpointEffects,
    input: input.runnerInput,
    phase: "active_turn_input",
    signal: input.signal ?? input.runnerInput.signal ?? null,
    timeoutMs: HOSTED_MAILBOX_POST_CHECKPOINT_EFFECT_TIMEOUT_MS,
  });
}

function assertHostedWorkspaceRunnerUser(input: HostedWorkspaceRunnerInput): void {
  if (input.workspace === null) {
    return;
  }

  if (input.workspace.userId !== input.expectedUserId) {
    throw new HostedWorkspaceRunnerUserMismatchError({
      actualUserId: input.workspace.userId,
      expectedUserId: input.expectedUserId,
    });
  }
}

function startHostedForegroundConversationMailboxImportLoop(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestSession;
  checkpointCanonicalMailboxImportProgress: HostedCanonicalMailboxImportProgressCheckpoint;
  input: HostedWorkspaceRunnerInput;
  onForegroundConversationImportFinished?: (() => void) | null;
  onForegroundConversationImportStarted?: (() => void) | null;
  onForegroundConversationWorkObserved?: (() => void) | null;
}): {
  completion: Promise<void>;
  drainPendingWake(): Promise<void>;
  stop(): Promise<void>;
} {
  const runtimeWakeSignal = input.input.runtimeWakeSignal ?? null;
  if (!runtimeWakeSignal) {
    return {
      completion: Promise.resolve(),
      drainPendingWake: async () => undefined,
      stop: async () => undefined,
    };
  }

  const waitController = new AbortController();
  const outerSignal = input.input.signal ?? null;
  const abort = () => {
    waitController.abort(readHostedForegroundRuntimeWakeAbortReason(outerSignal));
  };
  if (outerSignal?.aborted) {
    abort();
  } else {
    outerSignal?.addEventListener("abort", abort, { once: true });
  }
  let wakeOrdinal = 0;
  let stopRequested = false;
  let activeWakeCompletion: Promise<void> | null = null;
  let activeConversationImportItemStaged = false;
  const inFlightImportController = new AbortController();
  const abortInFlightImportAfterCurrentItemStaged = (): void => {
    if (
      !stopRequested
      || inFlightImportController.signal.aborted
      || !activeConversationImportItemStaged
    ) {
      return;
    }
    inFlightImportController.abort(
      new DOMException(
        "Foreground mailbox import stopped after conversation work was staged.",
        "AbortError",
      ),
    );
  };
  const observeForegroundConversationWork = (): void => {
    input.onForegroundConversationWorkObserved?.();
  };
  const observeForegroundConversationInputStaged = (): void => {
    activeConversationImportItemStaged = true;
    observeForegroundConversationWork();
    abortInFlightImportAfterCurrentItemStaged();
  };

  const loop = (async () => {
    while (!waitController.signal.aborted) {
      if (input.checkpointRequestBuilder.assistantInputBatchFull()) {
        break;
      }
      let notification: RuntimeWakeNotification;
      try {
        notification = await runtimeWakeSignal.wait(waitController.signal);
      } catch (error) {
        if (waitController.signal.aborted) {
          break;
        }
        await writeHostedForegroundMailboxImportFailureRuntimeLog({
          error,
          input: input.input,
        });
        continue;
      }
      wakeOrdinal += 1;
      let resolveActiveWake = (): void => undefined;
      const currentWakeCompletion = new Promise<void>((resolve) => {
        resolveActiveWake = resolve;
      });
      activeWakeCompletion = currentWakeCompletion;
      const requestId = `${input.input.requestId}:runtime-wake:${wakeOrdinal}`;
      const waitResolvedAtEpochMs = Date.now();
      const latencyMilestones = createHostedForegroundMailboxImportLatencyMilestones({
        foregroundWakeOrdinal: wakeOrdinal,
        foregroundWaitResolvedAtEpochMs: waitResolvedAtEpochMs,
        orchestration: notification.orchestration ?? null,
        runtimePassDiagnostics: input.input.runtimePassDiagnostics ?? null,
        runtimeWakeNotifiedAtEpochMs: notification.notifiedAtEpochMs,
      });
      const baseForegroundConversationImportItem =
        input.input.foregroundImportItem ?? input.input.importItem;
      const foregroundConversationImportItem: typeof baseForegroundConversationImportItem =
        async (...importArgs) => {
          // Preempt lock-owning background maintenance before conversation
          // staging waits for that same lock.
          activeConversationImportItemStaged = false;
          input.onForegroundConversationImportStarted?.();
          try {
            return await baseForegroundConversationImportItem(...importArgs);
          } finally {
            activeConversationImportItemStaged = false;
            input.onForegroundConversationImportFinished?.();
          }
        };
      try {
        const handleForegroundImportResult = async (
          result: HostedMailboxImportCheckpointResult,
        ): Promise<boolean> => {
          if (shouldRecordHostedForegroundMailboxImportResult(result)) {
            input.checkpointRequestBuilder.recordCheckpointResult(result);
          }
          markHostedMailboxImportDirtyIfNeeded(input.checkpointRequestBuilder, result);
          const hasForegroundConversationWork =
            hasHostedMailboxImportForegroundConversationWork(result);
          if (hasForegroundConversationWork) {
            await runHostedMailboxPostCheckpointEffectsForPromptPreparationBestEffort({
              checkpointRequestBuilder: input.checkpointRequestBuilder,
              input: input.input,
              phase: "active_turn_input",
              signal: outerSignal,
            });
            observeForegroundConversationWork();
          }
          await notifyHostedActiveTurnInputForMailboxImport({
            input: input.input,
            result,
            signal: outerSignal,
          });
          return input.checkpointRequestBuilder.assistantInputBatchFull();
        };
        const conversationImportSignal =
          composeHostedForegroundMailboxImportSignal(
            outerSignal,
            inFlightImportController.signal,
          );
        const conversationResult = await (async () => {
          try {
            return await importHostedMailboxForWorkspaceRunner({
              checkpointRequestBuilder: input.checkpointRequestBuilder,
              checkpointReason: "active_turn_input",
              deferCheckpoint: true,
              importItem: foregroundConversationImportItem,
              importItemContext: {
                latencyMilestones,
                onConversationInputStaged: observeForegroundConversationInputStaged,
                runtimeAttemptId: input.input.runtimeLogContext?.attemptId ?? null,
              },
              input: input.input,
              lanes: ["conversation"],
              limitPerLane: input.checkpointRequestBuilder.assistantInputBatchRemaining(),
              requestId: `${requestId}:conversation`,
              signal: conversationImportSignal.signal,
              checkpointCanonicalMailboxImportProgress:
                input.checkpointCanonicalMailboxImportProgress,
            });
          } finally {
            conversationImportSignal.dispose();
          }
        })();
        const conversationBatchFull = await handleForegroundImportResult(conversationResult);
        if (conversationBatchFull) {
          break;
        }
        if (hasHostedMailboxImportForegroundConversationWork(conversationResult)) {
          continue;
        }

        const systemImportSignal =
          composeHostedForegroundMailboxImportSignal(
            outerSignal,
            inFlightImportController.signal,
          );
        const systemResult = await (async () => {
          try {
            return await importHostedMailboxForWorkspaceRunner({
              checkpointRequestBuilder: input.checkpointRequestBuilder,
              checkpointReason: "active_turn_input",
              deferCheckpoint: true,
              importItem: input.input.importItem,
              importItemContext: {
                latencyMilestones,
                runtimeAttemptId: input.input.runtimeLogContext?.attemptId ?? null,
              },
              input: input.input,
              lanes: ["system"],
              limitPerLane: input.input.limitPerLane,
              requestId: `${requestId}:system`,
              signal: systemImportSignal.signal,
              checkpointCanonicalMailboxImportProgress:
                input.checkpointCanonicalMailboxImportProgress,
            });
          } finally {
            systemImportSignal.dispose();
          }
        })();
        const systemBatchFull = await handleForegroundImportResult(systemResult);
        if (systemBatchFull) {
          break;
        }
      } catch (error) {
        if (outerSignal?.aborted || inFlightImportController.signal.aborted) {
          break;
        }
        await writeHostedForegroundMailboxImportFailureRuntimeLog({
          error,
          input: input.input,
        });
      } finally {
        resolveActiveWake();
        if (activeWakeCompletion === currentWakeCompletion) {
          activeWakeCompletion = null;
        }
      }
      if (stopRequested) {
        break;
      }
    }
  })();
  const completion = loop.catch(() => undefined);
  const drainPendingWake = async (): Promise<void> => {
    // A coalesced notification is delivered on a microtask. Let a wake that
    // already exists enter the import loop before deciding whether there is
    // anything to drain.
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await activeWakeCompletion;
  };

  return {
    completion,
    drainPendingWake,
    async stop() {
      stopRequested = true;
      outerSignal?.removeEventListener("abort", abort);
      abortInFlightImportAfterCurrentItemStaged();
      await drainPendingWake();
      if (!waitController.signal.aborted) {
        waitController.abort(new DOMException("Foreground mailbox import loop stopped.", "AbortError"));
      }
      await completion;
    },
  };
}

function composeHostedForegroundMailboxImportSignal(
  outerSignal: AbortSignal | null,
  inFlightImportSignal: AbortSignal,
): {
  dispose(): void;
  signal: AbortSignal;
} {
  if (!outerSignal) {
    return {
      dispose: () => undefined,
      signal: inFlightImportSignal,
    };
  }

  const abortSignalConstructor: typeof AbortSignal & {
    any?: (signals: AbortSignal[]) => AbortSignal;
  } = AbortSignal;
  if (typeof abortSignalConstructor.any === "function") {
    return {
      dispose: () => undefined,
      signal: abortSignalConstructor.any([outerSignal, inFlightImportSignal]),
    };
  }

  const controller = new AbortController();
  const abort = (signal: AbortSignal): void => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason);
    }
  };
  if (outerSignal.aborted) {
    abort(outerSignal);
  } else if (inFlightImportSignal.aborted) {
    abort(inFlightImportSignal);
  }
  const abortFromOuterSignal = () => abort(outerSignal);
  const abortFromInFlightSignal = () => abort(inFlightImportSignal);
  if (!controller.signal.aborted) {
    outerSignal.addEventListener("abort", abortFromOuterSignal, { once: true });
    inFlightImportSignal.addEventListener("abort", abortFromInFlightSignal, { once: true });
  }

  return {
    dispose() {
      outerSignal.removeEventListener("abort", abortFromOuterSignal);
      inFlightImportSignal.removeEventListener("abort", abortFromInFlightSignal);
    },
    signal: controller.signal,
  };
}

function hostedWorkspaceRunnerWakeIsImmediate(
  wakeAt: string,
  now: (() => string) | null | undefined,
): boolean {
  const wakeMs = Date.parse(wakeAt);
  if (!Number.isFinite(wakeMs)) {
    return true;
  }
  const nowMs = Date.parse(resolveHostedWorkspaceRunnerNowIso(now));
  return !Number.isFinite(nowMs) || wakeMs <= nowMs;
}

function createHostedForegroundMailboxImportLatencyMilestones(input: {
  foregroundWakeOrdinal: number;
  foregroundWaitResolvedAtEpochMs: number;
  orchestration?: HostedRuntimeLatencyPhaseBreakdown["orchestration"] | null;
  runtimePassDiagnostics?: HostedWorkspaceRunnerRuntimePassDiagnostics | null;
  runtimeWakeNotifiedAtEpochMs: number | null;
}): HostedRuntimeLatencyTraceStagedMilestones {
  const phaseBreakdown: HostedRuntimeLatencyPhaseBreakdown = {
    schemaVersion: 1,
    ...(input.orchestration ? { orchestration: input.orchestration } : {}),
    wake: {
      ...(input.runtimeWakeNotifiedAtEpochMs === null
        ? {}
        : { runtimeWakeNotifiedAtEpochMs: input.runtimeWakeNotifiedAtEpochMs }),
      foregroundWaitResolvedAtEpochMs: input.foregroundWaitResolvedAtEpochMs,
      foregroundWakeOrdinal: input.foregroundWakeOrdinal,
      ...(input.runtimePassDiagnostics
        ? {
            activeRuntimePassForeground: input.runtimePassDiagnostics.foreground,
            activeRuntimePassOrdinal: input.runtimePassDiagnostics.ordinal,
            activeRuntimePassStartedAtEpochMs: input.runtimePassDiagnostics.startedAtEpochMs,
          }
        : {}),
    },
  };

  return { phaseBreakdown };
}

function stampHostedMailboxImportStartedLatencyMilestone(
  context: HostedWorkspaceRunnerMailboxImportContext | null | undefined,
): HostedWorkspaceRunnerMailboxImportContext | null | undefined {
  const latencyMilestones = context?.latencyMilestones ?? null;
  const phaseBreakdown = latencyMilestones?.phaseBreakdown;
  const wake = phaseBreakdown?.wake;
  if (
    !wake
    || typeof wake.foregroundWaitResolvedAtEpochMs !== "number"
    || typeof wake.foregroundImportStartedAtEpochMs === "number"
  ) {
    return context;
  }

  return {
    ...(context ?? {}),
    latencyMilestones: {
      ...latencyMilestones,
      phaseBreakdown: {
        ...phaseBreakdown,
        wake: {
          ...wake,
          foregroundImportStartedAtEpochMs: Date.now(),
        },
      },
    },
  };
}

function hasHostedMailboxImportForegroundConversationWork(
  result: HostedMailboxImportCheckpointResult,
): boolean {
  return (
    (result.importResult.assistantInputIds?.length ?? 0) > 0
    || (result.importResult.conversationImportedCount ?? 0) > 0
    || result.importResult.blocked.some((item) =>
      item.retryable && item.lane === "conversation"
    )
  );
}

function shouldImportHostedPreAssistantSystemMailbox(input: {
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  now?: (() => string) | null;
}): boolean {
  if (!hostedMailboxImportFetchedSystemLane(input.initialMailboxImport)) {
    return true;
  }

  const nextRetryAt = input.initialMailboxImport.importResult.nextRetryAt ?? null;
  return nextRetryAt !== null
    && hostedWorkspaceRunnerWakeIsImmediate(nextRetryAt, input.now);
}

async function importHostedPreAssistantSystemMailboxForWorkspaceRunner(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestSession;
  checkpointCanonicalMailboxImportProgress: HostedCanonicalMailboxImportProgressCheckpoint;
  importItemContext: HostedWorkspaceRunnerMailboxImportContext | null;
  input: HostedWorkspaceRunnerInput;
  requestId: string;
  signal: AbortSignal | null;
}): Promise<HostedMailboxImportCheckpointResult | null> {
  let latestImport: HostedMailboxImportCheckpointResult | null = null;
  let previousSystemSeq: string | null = null;
  for (let importPage = 1; importPage <= HOSTED_PRE_ASSISTANT_SYSTEM_IMPORT_MAX_PAGES; importPage += 1) {
    const result = await importHostedMailboxForWorkspaceRunner({
      checkpointRequestBuilder: input.checkpointRequestBuilder,
      checkpointReason: "import",
      deferCheckpoint: true,
      importItemContext: input.importItemContext,
      input: input.input,
      lanes: ["system"],
      prefetch: importPage === 1 ? input.input.initialMailboxPrefetch ?? null : null,
      requestId: `${input.requestId}:pre-assistant-system:${importPage}`,
      signal: input.signal,
      suppressNoopRuntimeLog: true,
      checkpointCanonicalMailboxImportProgress:
        input.checkpointCanonicalMailboxImportProgress,
    });
    if (!hostedMailboxImportCheckpointResultIsNoop(result)) {
      latestImport = result;
      input.checkpointRequestBuilder.recordCheckpointResult(result, {
        captureAssistantInputBatch: false,
      });
      markHostedMailboxImportDirtyIfNeeded(input.checkpointRequestBuilder, result);
    }

    const nextRetryAt = result.importResult.nextRetryAt ?? null;
    if (
      !nextRetryAt
      || !hostedWorkspaceRunnerWakeIsImmediate(nextRetryAt, input.input.now)
    ) {
      return latestImport;
    }

    const systemSeq = result.state.watermarks.system;
    if (systemSeq === previousSystemSeq) {
      return latestImport;
    }
    previousSystemSeq = systemSeq;
  }

  return latestImport;
}

function hostedMailboxImportCheckpointResultIsNoop(
  result: HostedMailboxImportCheckpointResult,
): boolean {
  return result.stateChanged === false
    && result.importResult.importedCount === 0
    && result.importResult.fetchedCount === 0
    && result.importResult.blocked.length === 0
    && result.importResult.nextRetryAt === null;
}

function hostedMailboxImportFetchedSystemLane(
  result: HostedMailboxImportCheckpointResult,
): boolean {
  return result.importResult.fetchedLanes?.includes("system") === true;
}

function accumulateHostedWorkspaceRunnerAssistantInputBatch(input: {
  assistantInputBatchLimit: number;
  current: HostedWorkspaceRunnerAssistantInputBatch | null;
  result: HostedMailboxImportCheckpointResult;
}): HostedWorkspaceRunnerAssistantInputBatch | null {
  const assistantInputRecords = readHostedMailboxAssistantInputRecords(
    input.result.importResult,
  );
  if (assistantInputRecords.length === 0) {
    return input.current;
  }

  const limit = normalizeHostedWorkspaceRunnerAssistantInputBatchLimit(
    input.assistantInputBatchLimit,
  );
  if (input.current === null) {
    return buildHostedWorkspaceRunnerAssistantInputBatch(
      assistantInputRecords.slice(0, limit),
    );
  }

  const mergedAssistantInputIds = [
    ...input.current.assistantInputIds,
  ];
  const seenAssistantInputIds = new Set(mergedAssistantInputIds);
  let changed = false;
  const acceptedRecords: HostedMailboxAssistantInputRecord[] = [];
  for (const record of assistantInputRecords) {
    if (mergedAssistantInputIds.length >= limit) {
      break;
    }
    const assistantInputId = record.assistantInputId;
    if (seenAssistantInputIds.has(assistantInputId)) {
      continue;
    }
    seenAssistantInputIds.add(assistantInputId);
    mergedAssistantInputIds.push(assistantInputId);
    changed = true;
    acceptedRecords.push(record);
  }

  if (!changed) {
    return input.current;
  }

  return buildHostedWorkspaceRunnerAssistantInputBatch([
    ...readHostedWorkspaceRunnerAssistantInputBatchRecords(input.current),
    ...acceptedRecords,
  ]);
}

function includeHostedWorkspaceRunnerAssistantInputBatch(
  batch: HostedWorkspaceRunnerAssistantInputBatch,
  includedInputIds: ReadonlySet<string>,
): HostedWorkspaceRunnerAssistantInputBatch | null {
  return buildHostedWorkspaceRunnerAssistantInputBatch(
    readHostedWorkspaceRunnerAssistantInputBatchRecords(batch).filter((record) =>
      includedInputIds.has(record.assistantInputId)
    ),
  );
}

function filterHostedWorkspaceRunnerAssistantInputBatch(
  batch: HostedWorkspaceRunnerAssistantInputBatch,
  excludedInputIds: ReadonlySet<string>,
): HostedWorkspaceRunnerAssistantInputBatch | null {
  const seenInputIds = new Set<string>();
  return buildHostedWorkspaceRunnerAssistantInputBatch(
    readHostedWorkspaceRunnerAssistantInputBatchRecords(batch).filter((record) => {
      if (seenInputIds.has(record.assistantInputId)) {
        return false;
      }
      seenInputIds.add(record.assistantInputId);
      return !excludedInputIds.has(record.assistantInputId);
    }),
  );
}

async function rebuildHostedWorkspaceRunnerAssistantInputBatchAfterSelectedPrefixRepair(input: {
  acceptedInitialAssistantInputBatch: HostedWorkspaceRunnerAssistantInputBatch | null;
  assistantPhaseResult: HostedWorkspaceRunnerAssistantPhaseResult;
  latestAssistantInputBatch: HostedWorkspaceRunnerAssistantInputBatch | null;
  now?: (() => string) | null;
  selectedInitialAssistantInputIds: readonly string[];
  signal: AbortSignal | null;
  vaultRoot: string;
}): Promise<HostedWorkspaceRunnerAssistantInputBatch | null> {
  const foregroundReplyDeferredForImmediateAssistantWork =
    input.assistantPhaseResult.foregroundReplyFailed === undefined
    && input.assistantPhaseResult.nextWakeReason === "assistant"
    && typeof input.assistantPhaseResult.nextWakeAt === "string"
    && hostedWorkspaceRunnerWakeIsImmediate(
      input.assistantPhaseResult.nextWakeAt,
      input.now,
    );
  const foregroundReplyCompletedCleanly =
    input.assistantPhaseResult.foregroundReplyFailed === 0;
  if (
    input.acceptedInitialAssistantInputBatch === null
    || input.assistantPhaseResult.progressed !== true
    || (
      !foregroundReplyDeferredForImmediateAssistantWork
      && !foregroundReplyCompletedCleanly
    )
    || input.selectedInitialAssistantInputIds.length === 0
    || (
      foregroundReplyCompletedCleanly
      && input.selectedInitialAssistantInputIds.length < 2
    )
    || new Set(input.selectedInitialAssistantInputIds).size
      !== input.selectedInitialAssistantInputIds.length
  ) {
    return input.latestAssistantInputBatch;
  }

  const pendingInputIds = new Set(await compactHostedPendingAssistantInputIds({
    ...(input.signal ? { signal: input.signal } : {}),
    vaultRoot: input.vaultRoot,
  }));
  const pendingSelectedInputIds = input.selectedInitialAssistantInputIds.filter(
    (inputId) => pendingInputIds.has(inputId),
  );
  // Bounded assistant-owned system work can make durable progress and yield an
  // immediate wake before the foreground reply phase starts. In that case every
  // selected input is still pending and must be restored to the invocation-local
  // rerun batch. Once a reply phase has run, retain the narrower handled-prefix
  // repair behavior below.
  if (
    pendingSelectedInputIds.length === 0
    || (
      pendingSelectedInputIds.length === input.selectedInitialAssistantInputIds.length
      && !foregroundReplyDeferredForImmediateAssistantWork
    )
  ) {
    return input.latestAssistantInputBatch;
  }

  const suffixStart =
    input.selectedInitialAssistantInputIds.length - pendingSelectedInputIds.length;
  if (pendingSelectedInputIds.some(
    (inputId, index) =>
      input.selectedInitialAssistantInputIds[suffixStart + index] !== inputId,
  )) {
    return input.latestAssistantInputBatch;
  }

  const acceptedRecordsByInputId = new Map<string, HostedMailboxAssistantInputRecord>();
  for (const record of readHostedWorkspaceRunnerAssistantInputBatchRecords(
    input.acceptedInitialAssistantInputBatch,
  )) {
    if (acceptedRecordsByInputId.has(record.assistantInputId)) {
      return input.latestAssistantInputBatch;
    }
    acceptedRecordsByInputId.set(record.assistantInputId, record);
  }
  const repairedSuffixRecords: HostedMailboxAssistantInputRecord[] = [];
  for (const inputId of pendingSelectedInputIds) {
    const record = acceptedRecordsByInputId.get(inputId);
    if (!record) {
      return input.latestAssistantInputBatch;
    }
    repairedSuffixRecords.push(record);
  }
  const tailRecords = input.latestAssistantInputBatch
    ? readHostedWorkspaceRunnerAssistantInputBatchRecords(input.latestAssistantInputBatch)
    : [];
  const repairedSuffixInputIds = new Set(pendingSelectedInputIds);
  if (tailRecords.some((record) => repairedSuffixInputIds.has(record.assistantInputId))) {
    return input.latestAssistantInputBatch;
  }

  return buildHostedWorkspaceRunnerAssistantInputBatch([
    ...repairedSuffixRecords,
    ...tailRecords,
  ]);
}

function readHostedWorkspaceRunnerAssistantInputBatchRecords(
  batch: HostedWorkspaceRunnerAssistantInputBatch,
): HostedMailboxAssistantInputRecord[] {
  if (batch.assistantInputRecords) {
    return [...batch.assistantInputRecords];
  }
  return batch.assistantInputIds.map((assistantInputId, index) => ({
    assistantInputId,
    ...(batch.emailDeliveryContexts[index]
      ? { emailDeliveryContext: batch.emailDeliveryContexts[index] }
      : {}),
    ...(batch.linqDeliveryContexts[index]
      ? { linqDeliveryContext: batch.linqDeliveryContexts[index] }
      : {}),
  }));
}

function buildHostedWorkspaceRunnerAssistantInputBatch(
  records: readonly HostedMailboxAssistantInputRecord[],
): HostedWorkspaceRunnerAssistantInputBatch | null {
  if (records.length === 0) {
    return null;
  }
  const assistantInputIds = records.map((record) => record.assistantInputId);
  return {
    assistantInputIds,
    assistantInputRecords: records,
    emailDeliveryContexts: records.flatMap((record) =>
      record.emailDeliveryContext ? [record.emailDeliveryContext] : []
    ),
    linqDeliveryContexts: records.flatMap((record) =>
      record.linqDeliveryContext ? [record.linqDeliveryContext] : []
    ),
  };
}

function readHostedMailboxAssistantInputRecords(
  result: HostedMailboxImportCheckpointResult["importResult"],
): HostedMailboxAssistantInputRecord[] {
  if (result.assistantInputRecords && result.assistantInputRecords.length > 0) {
    return result.assistantInputRecords;
  }

  const assistantInputIds = result.assistantInputIds ?? [];
  if (assistantInputIds.length === 0) {
    return [];
  }

  const emailDeliveryContexts = result.emailDeliveryContexts ?? [];
  const linqDeliveryContexts = readHostedMailboxImportLinqDeliveryContexts(result);
  return assistantInputIds.map((assistantInputId, index) => {
    const emailDeliveryContext = emailDeliveryContexts[index];
    const linqDeliveryContext = linqDeliveryContexts[index];
    return {
      assistantInputId,
      ...(emailDeliveryContext ? { emailDeliveryContext } : {}),
      ...(linqDeliveryContext ? { linqDeliveryContext } : {}),
    };
  });
}

function hostedWorkspaceRunnerAssistantInputBatchHasWork(
  batch: HostedWorkspaceRunnerAssistantInputBatch | null,
): boolean {
  return (batch?.assistantInputIds.length ?? 0) > 0;
}

function normalizeHostedWorkspaceRunnerAssistantInputBatchLimit(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }
  return Math.floor(value);
}

function normalizeHostedWorkspaceRunnerAssistantInputBatchCount(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function readHostedMailboxImportLinqDeliveryContexts(
  result: HostedMailboxImportCheckpointResult["importResult"],
): NonNullable<HostedMailboxImportCheckpointResult["importResult"]["linqDeliveryContexts"]> {
  if (result.linqDeliveryContexts && result.linqDeliveryContexts.length > 0) {
    return result.linqDeliveryContexts;
  }
  return result.latestLinqDeliveryContext
    ? [result.latestLinqDeliveryContext]
    : [];
}

async function notifyHostedActiveTurnInputForMailboxImport(input: {
  input: HostedWorkspaceRunnerInput;
  result: HostedMailboxImportCheckpointResult;
  signal: AbortSignal | null;
}): Promise<void> {
  await notifyAssistantActiveTurnInputAvailableForInputIds({
    inputIds: input.result.importResult.assistantInputIds ?? [],
    ...(input.signal ? { signal: input.signal } : {}),
    vault: input.input.vaultRoot,
  });
}

type HostedCanonicalMailboxImportProgressCheckpoint = (
  result: HostedMailboxImportCheckpointResult,
) => Promise<void>;

type HostedMailboxForWorkspaceRunnerImportInput = {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestBuilder;
  checkpointCanonicalMailboxImportProgress?: HostedCanonicalMailboxImportProgressCheckpoint;
  checkpointReason: HostedWorkspaceSnapshotCheckpointMailboxReason;
  deferConversationUntil?: HostedMailboxConversationDeferral | null;
  deferCheckpoint?: boolean;
  importItem?: HostedWorkspaceRunnerMailboxImportItem | null;
  importItemContext?: HostedWorkspaceRunnerMailboxImportContext | null;
  input: HostedWorkspaceRunnerInput;
  lanes?: readonly ("conversation" | "system")[];
  limitPerLane?: number | null;
  mailboxFetchSignal?: AbortSignal | null;
  prefetch?: HostedMailboxPrefixPrefetch | null;
  requestId: string;
  signal?: AbortSignal | null;
  suppressNoopRuntimeLog?: boolean;
};

async function importHostedMailboxForWorkspaceRunner(
  input: HostedMailboxForWorkspaceRunnerImportInput,
): Promise<HostedMailboxImportCheckpointResult> {
  const signal = input.signal ?? input.importItemContext?.signal ?? input.input.signal ?? null;
  if (signal?.aborted) {
    throw readHostedForegroundRuntimeWakeAbortReason(signal);
  }
  const operation = importHostedMailboxForWorkspaceRunnerUntracked(input);
  input.input.trackLocalWorkspaceMutationCompletion?.(
    operation.then(
      () => undefined,
      () => undefined,
    ),
  );
  return await operation;
}

async function importHostedMailboxForWorkspaceRunnerUntracked(
  input: HostedMailboxForWorkspaceRunnerImportInput,
): Promise<HostedMailboxImportCheckpointResult> {
  const importItem = input.importItem ?? input.input.importItem;
  const signal = input.signal ?? input.importItemContext?.signal ?? input.input.signal ?? null;
  const initialAssistantAskRequestTargetKind =
    input.input.initialMailboxImportContext?.assistantAskRequestTargetKind;
  const importItemContext = stampHostedMailboxImportStartedLatencyMilestone(
    {
      ...(initialAssistantAskRequestTargetKind
        ? { assistantAskRequestTargetKind: initialAssistantAskRequestTargetKind }
        : {}),
      ...(input.importItemContext ?? {}),
      signal,
    },
  );
  const result = await importHostedMailboxPrefixAndCheckpoint({
    checkpointReason: input.checkpointReason,
    createCheckpointRequest: (requestInput) =>
      input.checkpointRequestBuilder.createRequest({
        ...requestInput,
        ...(requestInput.importResult.nextRetryAt
          ? {
              nextWakeAt: requestInput.importResult.nextRetryAt,
              nextWakeReason: "mailbox",
            }
          : {}),
        reason: input.checkpointReason,
      }),
    deferConversationUntil: input.deferConversationUntil ?? null,
    deferCheckpoint: input.deferCheckpoint === true,
    expectedUserId: input.input.expectedUserId,
    fetchSignal: input.mailboxFetchSignal ?? null,
    importItem: (item) => importItem(item, importItemContext ?? undefined),
    lanes: input.lanes,
    limitPerLane: input.limitPerLane ?? input.input.limitPerLane,
    mailboxPort: input.input.platform.mailboxPort,
    now: input.input.now,
    prefetch: input.prefetch ?? null,
    requestId: input.requestId,
    vaultRoot: input.input.vaultRoot,
    workspacePort: input.input.platform.workspacePort,
  });
  if (
    input.suppressNoopRuntimeLog !== true
    || !hostedMailboxImportCheckpointResultIsNoop(result)
  ) {
    await writeHostedMailboxImportRuntimeLog({
      checkpointReason: input.checkpointReason,
      lanes: input.lanes,
      result,
      runnerInput: input.input,
    });
  }
  if (isDeferredHostedMailboxImportDirty(result)) {
    await markHostedWorkspaceLiveRuntimeStateDirtyForSnapshotRefBestEffort({
      snapshotRef: input.input.workspace?.snapshotRef ?? null,
      vaultRoot: input.input.vaultRoot,
    });
  }
  await input.checkpointCanonicalMailboxImportProgress?.(result);

  return result;
}

async function writeHostedMailboxImportRuntimeLog(input: {
  checkpointReason: HostedWorkspaceCheckpointReason;
  lanes?: readonly ("conversation" | "system")[];
  result: HostedMailboxImportCheckpointResult;
  runnerInput: HostedWorkspaceRunnerInput;
}): Promise<void> {
  const lanes = input.lanes ?? ["system", "conversation"];
  const singleLane = lanes.length === 1 ? lanes[0] : null;
  const blocked = input.result.importResult.blocked;
  const retryableBlockedCount = blocked.filter((item) => item.retryable).length;
  const assistantInputCount = input.result.importResult.assistantInputIds?.length ?? 0;
  const conversationImportedCount = input.result.importResult.conversationImportedCount ?? 0;
  if (
    input.checkpointReason === "active_turn_input"
    && !shouldRecordHostedForegroundMailboxImportResult(input.result)
  ) {
    return;
  }
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields(input.runnerInput.runtimeLogContext),
      ...(singleLane
        ? {
            mailboxLane: singleLane,
            mailboxSeqEnd: input.result.state.watermarks[singleLane],
            mailboxSeqStart: input.result.previousState.watermarks[singleLane],
          }
        : {}),
      component: "mailbox",
      eventCode: "mailbox.imported",
      level: blocked.length > 0 ? "warn" : "info",
      phase: input.checkpointReason === "active_turn_input" ? "active_turn_input" : "import",
      redactedJson: {
        assistantInputCount,
        assistantInputPresent: assistantInputCount > 0,
        blockCodes: compactHostedRuntimeLogCodes(blocked.map((item) => item.reasonCode)),
        blockedCount: blocked.length,
        checkpointDeferred: input.result.checkpointDeferred,
        checkpointed: input.result.checkpoint?.checkpointed ?? false,
        conversationImportedCount,
        conversationSeqEnd: input.result.state.watermarks.conversation,
        conversationSeqStart: input.result.previousState.watermarks.conversation,
        fetchedCount: input.result.importResult.fetchedCount,
        importedCount: input.result.importResult.importedCount,
        laneCount: lanes.length,
        ...(input.result.importResult.conversationImportTiming ?? {}),
        retryableBlockedCount,
        stateChanged: input.result.stateChanged,
        systemSeqEnd: input.result.state.watermarks.system,
        systemSeqStart: input.result.previousState.watermarks.system,
      },
    },
    now: input.runnerInput.now,
    platform: input.runnerInput.platform,
  });
}

async function writeHostedWorkspaceAssistantPostCheckpointFailureRuntimeLog(context: {
  error: unknown;
  errorCode: "assistant_after_checkpoint_checkpoint_failed" | "assistant_after_checkpoint_failed";
  input: HostedWorkspaceRunnerInput;
}): Promise<void> {
  const failure = buildHostedMailboxPostCheckpointEffectFailureLog(context.error);
  console.warn("Hosted assistant post-checkpoint cleanup failed after foreground delivery phase.", {
    errorCode: context.errorCode,
    errorName: failure.name ?? (context.error instanceof Error ? context.error.name : typeof context.error),
  });
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields(context.input.runtimeLogContext),
      component: "runner",
      errorCode: context.errorCode,
      eventCode: "runner.error",
      level: "warn",
      phase: "checkpoint",
      redactedJson: {
        checkpointed: false,
        failureCodeDetails: failure.codeDetail ? [failure.codeDetail] : [],
        failureNames: failure.name ? [failure.name] : [],
        failureSummaries: failure.summary ? [failure.summary] : [],
        nestedErrorCode: failure.errorCode,
      },
    },
    now: context.input.now,
    platform: context.input.platform,
  });
}

export async function resolveHostedUsageNoticeDeliveryTargetFromAcceptedInputs(input: {
  inputIds: readonly string[];
  memberId: string;
  vaultRoot: string;
}): Promise<HostedRuntimeUsageNoticeDeliveryTarget | null | undefined> {
  if (input.inputIds.length === 0) {
    return undefined;
  }

  let resolved:
    | {
      cursor: AssistantInputEventRecord["cursor"];
      target: HostedRuntimeUsageNoticeDeliveryTarget;
    }
    | undefined;
  for (const inputId of input.inputIds) {
    let event: AssistantInputEventRecord | null;
    try {
      event = await readAssistantInputEvent({
        inputId,
        vault: input.vaultRoot,
      });
    } catch {
      return null;
    }
    if (!event) {
      return null;
    }

    const target = readHostedUsageNoticeDeliveryTargetFromAssistantInput({
      event,
      memberId: input.memberId,
    });
    if (!target) {
      return null;
    }
    if (
      resolved
      && !sameHostedUsageNoticeDeliveryRoute(resolved.target, target)
    ) {
      return null;
    }

    if (
      !resolved
      || compareAssistantInputCursors(event.cursor, resolved.cursor) > 0
    ) {
      resolved = {
        cursor: event.cursor,
        target,
      };
    }
  }

  return resolved?.target ?? null;
}

function readHostedUsageNoticeDeliveryTargetFromAssistantInput(input: {
  event: AssistantInputEventRecord;
  memberId: string;
}): HostedRuntimeUsageNoticeDeliveryTarget | null {
  const sourceMetadata = input.event.sourceMetadata;
  const replyTarget = input.event.replyTarget;
  const route = readHostedAssistantInputCurrentDeliveryRoute({
    conversation: input.event.conversation,
    replyTarget,
  });
  const replyToMessageId = normalizeHostedUsageNoticeRouteString(replyTarget?.messageId);

  if (route?.channel === "telegram") {
    if (!replyToMessageId) {
      return null;
    }
    return {
      channel: "telegram",
      replyToMessageId,
      target: route.deliveryTarget,
    };
  }

  if (
    route?.channel !== "linq"
    || sourceMetadata?.kind !== "linq"
  ) {
    return null;
  }
  const threadId = route.deliveryTarget;

  if (route.threadIsDirect === true) {
    return {
      channel: "linq",
      replyToMessageId,
      routeAuthority: null,
      target: threadId,
    };
  }

  if (
    sourceMetadata.externalThreadRouteAuthorityPresent !== true
    || route.threadIsDirect !== false
    || !replyToMessageId
  ) {
    return null;
  }

  return {
    channel: "linq",
    replyToMessageId,
    routeAuthority: {
      channel: "linq",
      containerMemberId: input.memberId,
      threadId,
    },
    target: threadId,
  };
}

function sameHostedUsageNoticeDeliveryRoute(
  left: HostedRuntimeUsageNoticeDeliveryTarget,
  right: HostedRuntimeUsageNoticeDeliveryTarget,
): boolean {
  if (left.channel !== right.channel || left.target !== right.target) {
    return false;
  }
  if (left.channel === "telegram" || right.channel === "telegram") {
    return left.channel === right.channel;
  }
  if (!left.routeAuthority || !right.routeAuthority) {
    return left.routeAuthority === right.routeAuthority;
  }
  return left.routeAuthority.accountLookupKey === right.routeAuthority.accountLookupKey
    && left.routeAuthority.channel === right.routeAuthority.channel
    && left.routeAuthority.containerMemberId === right.routeAuthority.containerMemberId
    && left.routeAuthority.threadId === right.routeAuthority.threadId;
}

function normalizeHostedUsageNoticeRouteString(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

async function flushHostedAssistantUsageRecordsBestEffort(input: {
  input: HostedWorkspaceRunnerInput;
  records: readonly HostedDeferredAssistantUsageRecord[];
}): Promise<void> {
  const usageRecordPort = input.input.platform.usageRecordPort ?? null;
  if (!usageRecordPort || input.records.length === 0) {
    return;
  }

  for (const { providerRequestAcceptedInputIds, record } of input.records) {
    try {
      const noticeDeliveryTarget =
        await resolveHostedUsageNoticeDeliveryTargetFromAcceptedInputs({
          inputIds: providerRequestAcceptedInputIds ?? [],
          memberId: input.input.expectedUserId,
          vaultRoot: input.input.vaultRoot,
        });
      await usageRecordPort.recordUsage(record, noticeDeliveryTarget);
    } catch (error) {
      const diagnostics = buildHostedExecutionSafeErrorDiagnostics(error);
      const safeErrorMessage =
        typeof diagnostics?.errorMessage === "string"
          ? diagnostics.errorMessage
          : "Hosted assistant usage recording failed.";
      const nestedErrorCode =
        typeof diagnostics?.errorCode === "string"
          ? diagnostics.errorCode
          : "runtime_error";
      console.warn("Assistant usage recording failed; continuing without retry.", {
        errorCode: "assistant_usage_record_failed",
        nestedErrorCode,
        safeErrorMessage,
      });
      await writeHostedRuntimeLogBestEffort({
        entry: {
          ...buildHostedRuntimeLogContextFields(input.input.runtimeLogContext),
          component: "runtime",
          errorCode: "assistant_usage_record_failed",
          eventCode: "runner.error",
          level: "warn",
          phase: "error",
          redactedJson: {
            assistantUsageRecordFailed: true,
            nestedErrorCode,
            safeErrorMessage,
          },
        },
        now: input.input.now,
        platform: input.input.platform,
      }).catch(() => undefined);
    }
  }
}

async function writeHostedForegroundMailboxImportFailureRuntimeLog(context: {
  error: unknown;
  input: HostedWorkspaceRunnerInput;
}): Promise<void> {
  const failure = buildHostedMailboxPostCheckpointEffectFailureLog(context.error);
  console.warn("Hosted foreground mailbox import failed.", {
    errorCode: failure.errorCode,
    errorName: failure.name ?? (context.error instanceof Error ? context.error.name : typeof context.error),
  });
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields(context.input.runtimeLogContext),
      component: "mailbox",
      errorCode: "foreground_mailbox_import_failed",
      eventCode: "runner.error",
      level: "warn",
      phase: "active_turn_input",
      redactedJson: {
        failureCodeDetails: failure.codeDetail ? [failure.codeDetail] : [],
        failureNames: failure.name ? [failure.name] : [],
        failureSummaries: failure.summary ? [failure.summary] : [],
        nestedErrorCode: failure.errorCode,
      },
    },
    now: context.input.now,
    platform: context.input.platform,
  });
}

async function writeHostedPreAssistantSystemMailboxImportFailureRuntimeLog(context: {
  error: unknown;
  input: HostedWorkspaceRunnerInput;
}): Promise<void> {
  const failure = buildHostedMailboxPostCheckpointEffectFailureLog(context.error);
  console.warn("Hosted pre-assistant system mailbox import failed.", {
    errorCode: failure.errorCode,
    errorName: failure.name ?? (context.error instanceof Error ? context.error.name : typeof context.error),
  });
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields(context.input.runtimeLogContext),
      component: "mailbox",
      errorCode: "pre_assistant_system_mailbox_import_failed",
      eventCode: "runner.error",
      level: "warn",
      phase: "import",
      redactedJson: {
        failureCodeDetails: failure.codeDetail ? [failure.codeDetail] : [],
        failureNames: failure.name ? [failure.name] : [],
        failureSummaries: failure.summary ? [failure.summary] : [],
        nestedErrorCode: failure.errorCode,
      },
    },
    now: context.input.now,
    platform: context.input.platform,
  });
}

function readHostedForegroundRuntimeWakeAbortReason(signal: AbortSignal | null): unknown {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("Foreground mailbox import loop was aborted.", "AbortError");
}

function isHostedWorkspaceRunnerAbortError(
  error: unknown,
  signal: AbortSignal | null,
): boolean {
  if (!signal?.aborted) {
    return false;
  }

  if (signal.reason instanceof Error) {
    return error === signal.reason;
  }

  return error === signal.reason
    || (
      error instanceof DOMException
      && error.name === "AbortError"
    )
    || (
      error instanceof Error
      && error.name === "AbortError"
    );
}

function shouldRecordHostedForegroundMailboxImportResult(
  result: HostedMailboxImportCheckpointResult,
): boolean {
  return (
    result.stateChanged
    || result.importResult.importedCount > 0
    || result.importResult.blocked.length > 0
  );
}

function markHostedMailboxImportDirtyIfNeeded(
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestSession,
  result: HostedMailboxImportCheckpointResult,
): void {
  if (isDeferredHostedMailboxImportDirty(result)) {
    checkpointRequestBuilder.markRuntimeStateDirty();
  }
}

function isDeferredHostedMailboxImportDirty(
  result: HostedMailboxImportCheckpointResult,
): boolean {
  return result.checkpointDeferred && result.stateChanged;
}

function mergeGeneratedImageRetentionWakeIntoWorkspace(input: {
  retentionWakeAt: string | null;
  workspace: HostedWorkspaceState | null;
}): HostedWorkspaceState | null {
  if (input.retentionWakeAt === null) {
    return input.workspace;
  }
  if (input.workspace === null) {
    throw new TypeError(
      "Generated-image persistence requires a hosted workspace checkpoint.",
    );
  }
  const candidateMs = Date.parse(input.retentionWakeAt);
  if (!Number.isFinite(candidateMs)) {
    throw new TypeError("Generated-image retention wake must be a valid timestamp.");
  }
  const currentWakeAt = input.workspace.inboxMediaRetentionWakeAt ?? null;
  if (
    currentWakeAt !== null
    && Date.parse(currentWakeAt) <= candidateMs
  ) {
    return input.workspace;
  }
  return {
    ...input.workspace,
    inboxMediaRetentionWakeAt: input.retentionWakeAt,
  };
}

function createHostedWorkspaceCanonicalWritePort(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestSession;
  deferRuntimeStatusCheckpoint?: boolean;
  generatedImageRetentionWakeAt?: string | null;
  input: HostedWorkspaceRunnerInput;
  onAssistantAutomationScheduleChanged?: (() => void) | null;
  onAssistantContextSnapshotDirty?: (() => void) | null;
  readPreviousRedactedStatus: () => HostedRuntimeRedactedJson | null;
  recordRedactedStatus: (status: HostedRuntimeRedactedJson) => void;
}): HostedCanonicalWritePort {
  return {
    async persistCanonicalWrite(writeInput) {
      const persist = async () => {
        const assistantAutomationScheduleChanged =
          hostedCanonicalWriteChangesAssistantAutomationSchedule(
            writeInput.receipt,
          );
        const snapshotDirtyDomains =
          listAssistantContextSnapshotDirtyDomainsForCanonicalWrite(
            writeInput.receipt,
          );
        if (snapshotDirtyDomains.length > 0) {
          try {
            await markAssistantContextSnapshotDirty({
              domains: snapshotDirtyDomains,
              vaultRoot: input.input.vaultRoot,
            });
          } catch (error) {
            warnAssistantBestEffortFailure({
              error,
              operation: "mark assistant context snapshot dirty",
            });
            throw error;
          }
          input.checkpointRequestBuilder.markRuntimeStateDirty();
          input.onAssistantContextSnapshotDirty?.();
        }
        const receiptLogUpdate = await appendHostedCanonicalWriteReceiptToArtifactLog({
          artifactStore: input.input.platform.artifactStore,
          payloads: writeInput.payloads,
          previousStatus: input.readPreviousRedactedStatus(),
          receipt: writeInput.receipt,
        });
        const receiptLogStatus = hostedCanonicalWriteReceiptLogStatusFields(receiptLogUpdate);
        if (input.deferRuntimeStatusCheckpoint === true) {
          input.recordRedactedStatus(receiptLogStatus);
          input.checkpointRequestBuilder.markRuntimeStateDirty();
        } else {
          const checkpointRedactedStatus =
            mergeHostedRuntimeRedactedStatusValues(
              input.readPreviousRedactedStatus(),
              receiptLogStatus,
            ) ?? receiptLogStatus;
          if (!input.input.checkpointRuntimeRedactedStatus) {
            throw new TypeError("Hosted canonical write receipt checkpoint requires runtime status checkpoint support.");
          }
          const checkpoint = await input.input.checkpointRuntimeRedactedStatus({
            // Keep schedule persistence and wake ownership in one durable checkpoint.
            ...(assistantAutomationScheduleChanged
              ? {
                  nextWakeAt: resolveHostedWorkspaceRunnerNowIso(input.input.now),
                  nextWakeReason: HOSTED_ASSISTANT_WAKE_REASON,
                }
              : {}),
            reason: "canonical_runtime_commit",
            redactedStatus: checkpointRedactedStatus,
            workspace: mergeGeneratedImageRetentionWakeIntoWorkspace({
              retentionWakeAt: input.generatedImageRetentionWakeAt ?? null,
              workspace:
                input.checkpointRequestBuilder.latestWorkspace()
                ?? input.input.workspace,
            }),
          });
          input.checkpointRequestBuilder.recordStatusCheckpoint(checkpoint);
          input.recordRedactedStatus(receiptLogStatus);
          input.checkpointRequestBuilder.markRuntimeStateDirty();
        }
        await writeHostedForegroundCheckpointDeferredLog({
          checkpointPhase: "canonical_write",
          now: input.input.now,
          platform: input.input.platform,
          reason: "canonical_runtime_commit",
          runtimeLogContext: input.input.runtimeLogContext,
        });
        if (assistantAutomationScheduleChanged) {
          input.onAssistantAutomationScheduleChanged?.();
        }
      };
      const withPersistence = input.input.withCanonicalWritePersistence;
      if (withPersistence) {
        await withPersistence(persist);
        return;
      }

      await persist();
    },
  };
}

function hostedCanonicalWriteChangesAssistantAutomationSchedule(
  receipt: Pick<HostedCanonicalWriteReceipt, "actions">,
): boolean {
  const automationDirectory = VAULT_LAYOUT.automationsDirectory;
  return receipt.actions.some((action) =>
    action.targetRelativePath === automationDirectory
    || action.targetRelativePath.startsWith(`${automationDirectory}/`)
  );
}

function mergeAssistantContextSnapshotRefreshWake(input: {
  now?: (() => string) | null;
  result: HostedWorkspaceRunnerAssistantPhaseResult;
}): void {
  if (input.result.progressed !== true) {
    return;
  }

  const wakeAt = resolveHostedWorkspaceRunnerNowIso(input.now);
  mergeHostedAssistantWake({
    reason: "assistant",
    result: input.result,
    wakeAt,
  });
}

async function reconcilePendingAssistantInputWake(input: {
  foregroundConversationWorkObserved: boolean;
  now?: (() => string) | null;
  result: HostedWorkspaceRunnerAssistantPhaseResult;
  vaultRoot: string;
}): Promise<void> {
  if (input.result.nextWakeAt) {
    const nextWakeReason = input.result.nextWakeReason ?? "assistant";
    const wakeIsImmediate = hostedWorkspaceRunnerWakeIsImmediate(input.result.nextWakeAt, input.now);
    const wakeBelongsToInvocation =
      nextWakeReason === "assistant"
      && input.result.invocationLocalAssistantWakeAt === input.result.nextWakeAt;
    if (
      nextWakeReason !== "assistant"
      || wakeIsImmediate
      || !input.foregroundConversationWorkObserved
      || wakeBelongsToInvocation
    ) {
      return;
    }
  }
  const wakeAt = await resolvePendingForegroundAssistantInputWakeAt({
    inspectOnly: input.foregroundConversationWorkObserved,
    now: input.now,
    vaultRoot: input.vaultRoot,
  });
  if (!wakeAt) {
    return;
  }

  if (mergeHostedAssistantWake({
    reason: "assistant",
    result: input.result,
    wakeAt,
  })) {
    input.result.invocationLocalAssistantWakeAt = wakeAt;
  }
}

function hostedConversationReplayFloorNeedsCheckpoint(input: {
  conversationConsumedSeq: string | null;
  latestMailboxImport: HostedMailboxImportCheckpointResult;
}): boolean {
  const consumedSeq = parseHostedConversationMailboxSeq(input.conversationConsumedSeq);
  const importedSeq = parseHostedConversationMailboxSeq(
    input.latestMailboxImport.state.watermarks.conversation,
  );
  if (consumedSeq === null || importedSeq === null || importedSeq <= consumedSeq) {
    return false;
  }
  return true;
}

function parseHostedConversationMailboxSeq(value: string | null): bigint | null {
  return value !== null && /^(?:0|[1-9][0-9]*)$/u.test(value)
    ? BigInt(value)
    : null;
}

async function notifyPendingForegroundAssistantInputWake(input: {
  now?: (() => string) | null;
  runtimeWakeSignal: RuntimeWakeSignal | null;
  vaultRoot: string;
}): Promise<void> {
  if (!input.runtimeWakeSignal) {
    return;
  }
  const wakeAt = await resolvePendingForegroundAssistantInputWakeAt({
    inspectOnly: true,
    now: input.now,
    vaultRoot: input.vaultRoot,
  });
  if (!wakeAt) {
    return;
  }

  input.runtimeWakeSignal.notify();
}

async function resolvePendingForegroundAssistantInputWakeAt(input: {
  inspectOnly: boolean;
  now?: (() => string) | null;
  vaultRoot: string;
}): Promise<string | null> {
  if (canSkipPendingAssistantInputProbe(input.vaultRoot)) {
    return null;
  }
  return await resolveHostedPendingAssistantInputWakeAt({
    inspectOnly: input.inspectOnly,
    now: input.now,
    vaultRoot: input.vaultRoot,
  });
}

function canSkipPendingAssistantInputProbe(vaultRoot: string): boolean {
  return !existsSync(resolveHostedPendingAssistantInputStatePath(vaultRoot))
    && !existsSync(resolveAssistantStatePaths(vaultRoot).automationStatePath);
}

function mergeHostedAssistantWake(input: {
  reason: string;
  result: HostedWorkspaceRunnerAssistantPhaseResult;
  wakeAt: string;
}): boolean {
  const selectedWake = selectHostedRuntimeWakeCandidate([
    createHostedRuntimeWakeCandidate(
      input.result.nextWakeAt ?? null,
      input.result.nextWakeReason ?? null,
    ),
    createHostedRuntimeWakeCandidate(input.wakeAt, input.reason),
  ]);
  if (
    selectedWake.at !== input.result.nextWakeAt
    || selectedWake.reason !== input.result.nextWakeReason
  ) {
    input.result.nextWakeAt = selectedWake.at;
    input.result.nextWakeReason = selectedWake.reason;
  }

  return selectedWake.at === input.wakeAt && selectedWake.reason === input.reason;
}

async function isAssistantContextSnapshotRefreshPendingBestEffort(
  vaultRoot: string,
): Promise<boolean> {
  if (!existsSync(resolveAssistantContextSnapshotPath(vaultRoot))) {
    return false;
  }
  try {
    return await isAssistantContextSnapshotRefreshPending({ vaultRoot });
  } catch {
    return false;
  }
}

function resolveHostedWorkspaceRunnerNowIso(
  now: (() => string) | null | undefined,
): string {
  const fallback = new Date().toISOString();
  if (!now) {
    return fallback;
  }

  const value = now();
  return Number.isFinite(Date.parse(value)) ? value : fallback;
}

async function checkpointHostedWorkspacePostAssistantPhase(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestSession;
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  now?: () => string;
  postCheckpoint: HostedWorkspaceRunnerAssistantPhasePostCheckpoint;
  platform: Pick<HostedWorkspaceRunnerPlatform, "logPort">;
  runtimeLogContext?: HostedRuntimeLogContext | null;
}): Promise<void> {
  void input.initialMailboxImport;
  input.checkpointRequestBuilder.markRuntimeStateDirty();
  await writeHostedForegroundCheckpointDeferredLog({
    checkpointPhase: "post_assistant",
    now: input.now,
    platform: input.platform,
    reason: input.postCheckpoint.checkpointReason,
    runtimeLogContext: input.runtimeLogContext,
  });
}

function createHostedWorkspaceCheckpointRequestSession(
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestBuilder,
  options: {
    assistantInputBatchLimit: number;
    initialAssistantInputCount?: number;
  },
): HostedWorkspaceCheckpointRequestSession {
  const assistantInputBatchLimit = normalizeHostedWorkspaceRunnerAssistantInputBatchLimit(
    options.assistantInputBatchLimit,
  );
  let initialAssistantInputCount = Math.min(
    assistantInputBatchLimit,
    normalizeHostedWorkspaceRunnerAssistantInputBatchCount(
      options.initialAssistantInputCount ?? 0,
    ),
  );
  let expectedWorkspaceVersion: string | null = null;
  const mailboxPostCheckpointEffects: HostedMailboxPostCheckpointEffect[] = [];
  let conversationConsumedSeq: bigint | null = null;
  let latestAssistantInputBatch: HostedWorkspaceRunnerAssistantInputBatch | null = null;
  let latestMailboxImport: HostedMailboxImportCheckpointResult | null = null;
  let latestWorkspace: HostedWorkspaceState | null = null;
  let mailboxRetryAt: string | null = null;
  let runtimeStateDirty = false;
  const assistantInputBatchOccupancy = (): number =>
    initialAssistantInputCount + (latestAssistantInputBatch?.assistantInputIds.length ?? 0);
  const assistantInputFreshBatchLimit = (): number =>
    Math.max(0, assistantInputBatchLimit - initialAssistantInputCount);

  return {
    assistantInputBatchFull() {
      return assistantInputBatchOccupancy() >= assistantInputBatchLimit;
    },
    assistantInputBatchRemaining() {
      return Math.max(
        1,
        assistantInputBatchLimit - assistantInputBatchOccupancy(),
      );
    },
    conversationConsumedSeq() {
      return conversationConsumedSeq?.toString() ?? null;
    },
    createRequest(input) {
      const requestInput = expectedWorkspaceVersion === null
        ? input
        : {
            ...input,
            expectedWorkspaceVersion,
          };
      const request = checkpointRequestBuilder.createRequest(requestInput);
      if (request instanceof Promise) {
        return request.then((resolvedRequest) =>
          applyExpectedWorkspaceVersionOverride({
            expectedWorkspaceVersion,
            request: resolvedRequest,
          }),
        );
      }

      return applyExpectedWorkspaceVersionOverride({
        expectedWorkspaceVersion,
        request,
      });
    },
    discardMailboxPostCheckpointEffects() {
      mailboxPostCheckpointEffects.splice(0);
    },
    hasRuntimeStateDirty() {
      return runtimeStateDirty;
    },
    latestMailboxImport() {
      return latestMailboxImport;
    },
    latestAssistantInputBatch() {
      return latestAssistantInputBatch;
    },
    latestWorkspace() {
      return latestWorkspace;
    },
    markRuntimeStateDirty() {
      runtimeStateDirty = true;
    },
    mailboxRetryAt() {
      return mailboxRetryAt;
    },
    recordCheckpointResult(result, recordOptions) {
      latestMailboxImport = result;
      const importedConsumedSeq = parseHostedConversationMailboxSeq(
        result.importResult.consumedSeqByLane?.conversation ?? null,
      );
      if (
        importedConsumedSeq !== null
        && (
          conversationConsumedSeq === null
          || importedConsumedSeq > conversationConsumedSeq
        )
      ) {
        conversationConsumedSeq = importedConsumedSeq;
      }
      const freshBatchLimit = assistantInputFreshBatchLimit();
      if (
        recordOptions?.captureAssistantInputBatch !== false
        && freshBatchLimit > 0
      ) {
        latestAssistantInputBatch = accumulateHostedWorkspaceRunnerAssistantInputBatch({
          assistantInputBatchLimit: freshBatchLimit,
          current: latestAssistantInputBatch,
          result,
        });
      }
      mailboxRetryAt = selectHostedRuntimeWakeCandidate([
        createHostedRuntimeWakeCandidate(mailboxRetryAt, "mailbox"),
        createHostedRuntimeWakeCandidate(
          result.importResult.nextRetryAt ?? null,
          "mailbox",
        ),
      ]).at;
      mailboxPostCheckpointEffects.push(...result.afterCheckpointEffects);
      if (result.checkpoint?.checkpointed === true) {
        checkpointRequestBuilder.recordCheckpoint?.(result.checkpoint);
        expectedWorkspaceVersion = result.checkpoint.workspace.version;
        latestWorkspace = result.checkpoint.workspace;
        runtimeStateDirty = false;
      }
    },
    recordStatusCheckpoint(response) {
      if (response.checkpointed) {
        checkpointRequestBuilder.recordCheckpoint?.(response);
        expectedWorkspaceVersion = response.workspace.version;
        latestWorkspace = response.workspace;
      }
    },
    seedAssistantInputSelection(selectedInputCount, remainingBatch) {
      initialAssistantInputCount = Math.min(
        assistantInputBatchLimit,
        normalizeHostedWorkspaceRunnerAssistantInputBatchCount(
          selectedInputCount,
        ),
      );
      latestAssistantInputBatch = remainingBatch;
    },
    takeMailboxPostCheckpointEffects() {
      return mailboxPostCheckpointEffects.splice(0);
    },
  };
}

async function runHostedMailboxPostCheckpointEffectsBestEffort(
  effects: readonly HostedMailboxPostCheckpointEffect[],
  input: {
    signal?: AbortSignal | null;
    timeoutMs?: number | null;
  } = {},
): Promise<HostedMailboxPostCheckpointEffectsResult> {
  const effectAttachmentEvidenceUpdated: Array<boolean | null> = [];
  const effectKinds: Array<HostedMailboxPostCheckpointEffectResult["kind"]> = [];
  const effectProjectionUpdated: Array<boolean | null> = [];
  const effectReasonCodes: Array<string | null> = [];
  const effectStatuses: Array<HostedMailboxPostCheckpointEffectResult["status"]> = [];
  const errorCodes: string[] = [];
  const failureCodeDetails: string[] = [];
  const failureNames: string[] = [];
  const failureSummaries: string[] = [];
  let failed = 0;
  let partial = 0;
  let succeeded = 0;
  for (const effect of effects) {
    try {
      const result = await runHostedMailboxPostCheckpointEffectBestEffort(effect, input);
      effectAttachmentEvidenceUpdated.push(result.attachmentEvidenceUpdated);
      effectKinds.push(result.kind);
      effectProjectionUpdated.push(result.projectionUpdated);
      effectReasonCodes.push(normalizeHostedMailboxPostCheckpointEffectReasonCode(result.reasonCode));
      effectStatuses.push(result.status);
      if (result.status === "failed") {
        failed += 1;
        errorCodes.push("post_checkpoint_effect_reported_failed");
      } else if (result.status === "partial") {
        partial += 1;
        errorCodes.push("post_checkpoint_effect_reported_partial");
      } else {
        succeeded += 1;
      }
    } catch (error) {
      // Mailbox post-checkpoint effects are enrichment only. They must not roll
      // back durable mailbox or assistant checkpoints.
      failed += 1;
      errorCodes.push("post_checkpoint_effect_failed");
      const failure = buildHostedMailboxPostCheckpointEffectFailureLog(error);
      errorCodes.push(failure.errorCode);
      if (failure.codeDetail) {
        failureCodeDetails.push(failure.codeDetail);
      }
      if (failure.name) {
        failureNames.push(failure.name);
      }
      if (failure.summary) {
        failureSummaries.push(failure.summary);
      }
    }
  }
  return {
    attempted: effects.length > 0,
    effectAttachmentEvidenceUpdated,
    effectKinds,
    effectProjectionUpdated,
    effectReasonCodes,
    effectStatuses,
    errorCodes,
    failureCodeDetails: compactHostedMailboxPostCheckpointFailureValues(failureCodeDetails),
    failureNames: compactHostedMailboxPostCheckpointFailureValues(failureNames),
    failureSummaries: compactHostedMailboxPostCheckpointFailureValues(failureSummaries),
    failed,
    partial,
    succeeded,
  };
}

async function runHostedMailboxPostCheckpointEffectBestEffort(
  effect: HostedMailboxPostCheckpointEffect,
  input: {
    signal?: AbortSignal | null;
    timeoutMs?: number | null;
  },
): Promise<HostedMailboxPostCheckpointEffectResult> {
  const signal = input.signal ?? null;
  const timeoutMs = input.timeoutMs ?? null;
  if (!signal && !timeoutMs) {
    return await effect();
  }
  if (signal?.aborted) {
    throw readHostedForegroundRuntimeWakeAbortReason(signal);
  }

  return await new Promise<HostedMailboxPostCheckpointEffectResult>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      signal?.removeEventListener("abort", abort);
    };
    const settle = (finish: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      finish();
    };
    const abort = () => {
      settle(() => reject(readHostedForegroundRuntimeWakeAbortReason(signal)));
    };
    if (timeoutMs && timeoutMs > 0) {
      timeout = setTimeout(() => {
        settle(() =>
          reject(Object.assign(
            new Error("Hosted mailbox post-checkpoint effect timed out."),
            { code: "HOSTED_MAILBOX_POST_CHECKPOINT_EFFECT_TIMEOUT" },
          ))
        );
      }, timeoutMs);
    }
    signal?.addEventListener("abort", abort, { once: true });
    effect().then(
      (result) => settle(() => resolve(result)),
      (error) => settle(() => reject(error)),
    );
  });
}

function buildHostedMailboxPostCheckpointEffectFailureLog(error: unknown): {
  codeDetail: string | null;
  errorCode: string;
  name: string | null;
  summary: string | null;
} {
  const diagnostics = buildHostedExecutionSafeErrorDiagnostics(error);
  return {
    codeDetail: normalizeHostedMailboxPostCheckpointFailureValue(diagnostics?.errorCodeDetail),
    errorCode: typeof diagnostics?.errorCode === "string" ? diagnostics.errorCode : "runtime_error",
    name: normalizeHostedMailboxPostCheckpointFailureValue(diagnostics?.errorName),
    summary: normalizeHostedMailboxPostCheckpointFailureValue(
      typeof diagnostics?.errorDetail === "string"
        ? diagnostics.errorDetail
        : diagnostics?.errorMessage,
    ),
  };
}

function compactHostedMailboxPostCheckpointFailureValues(values: readonly string[]): string[] {
  return Array.from(new Set(values)).slice(0, 16);
}

function normalizeHostedMailboxPostCheckpointEffectReasonCode(
  reasonCode: string | null,
): string | null {
  return reasonCode === null ? null : toHostedRuntimeLogCode(reasonCode);
}

function normalizeHostedMailboxPostCheckpointFailureValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length === 0) {
    return null;
  }

  const bounded = normalized.length > 128
    ? `${normalized.slice(0, 125).trimEnd()}...`
    : normalized;
  return isHostedMailboxPostCheckpointRedactedStringSafe(bounded) ? bounded : null;
}

function isHostedMailboxPostCheckpointRedactedStringSafe(value: string): boolean {
  if (/\/Users\/|file:\/\/|[A-Za-z]:\\|<HOME_DIR>|(^|[\s(])\/[^\s)]+/u.test(value)) {
    return false;
  }
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu.test(value)) {
    return false;
  }
  if (/\+\d[\d().\s-]{7,}\d/u.test(value)) {
    return false;
  }
  return !(
    /(["']?(?:authorization|secret|token|password|cookie|set-cookie|api[-_]?key)["']?\s*[:=]\s*["']?)([^"',\s}]+)/iu
      .test(value)
    || /\b(Basic|Bearer)\s+[A-Z0-9._~+/=-]+\b/iu.test(value)
    || /\b(?:sk|pk|rk)_(?:live|test)_[A-Z0-9]+\b/iu.test(value)
    || /\bwhsec_[A-Z0-9]+\b/iu.test(value)
  );
}

async function runHostedMailboxPostCheckpointEffectsAndLogBestEffort(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestSession;
  input: HostedWorkspaceRunnerInput;
}): Promise<void> {
  const effects = input.checkpointRequestBuilder.takeMailboxPostCheckpointEffects();
  await runHostedMailboxPostCheckpointEffectsAndWriteLogBestEffort({
    effects,
    input: input.input,
    phase: "import",
    timeoutMs: HOSTED_MAILBOX_POST_CHECKPOINT_EFFECT_TIMEOUT_MS,
  });
}

function scheduleHostedMailboxPostCheckpointEffectsAndLogBestEffort(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestSession;
  input: HostedWorkspaceRunnerInput;
  phase: "active_turn_input" | "import";
}): Promise<void> | null {
  const effects = input.checkpointRequestBuilder.takeMailboxPostCheckpointEffects();
  if (effects.length === 0) {
    return null;
  }
  const effectsFinished = runHostedMailboxPostCheckpointEffectsAndWriteLogBestEffort({
    effects,
    input: input.input,
    phase: input.phase,
    timeoutMs: HOSTED_MAILBOX_POST_CHECKPOINT_EFFECT_TIMEOUT_MS,
  }).catch((error: unknown) => {
    warnAssistantBestEffortFailure({
      error,
      operation: "hosted mailbox post-checkpoint effects",
    });
  });
  void effectsFinished;
  return effectsFinished;
}

async function runHostedMailboxPostCheckpointEffectsForPromptPreparationBestEffort(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestSession;
  input: HostedWorkspaceRunnerInput;
  phase: "active_turn_input" | "import";
  signal?: AbortSignal | null;
}): Promise<void> {
  const effects = input.checkpointRequestBuilder.takeMailboxPostCheckpointEffects();
  await runHostedMailboxPostCheckpointEffectsAndWriteLogBestEffort({
    effects,
    input: input.input,
    phase: input.phase,
    signal: input.signal ?? input.input.signal ?? null,
    timeoutMs: HOSTED_MAILBOX_POST_CHECKPOINT_EFFECT_TIMEOUT_MS,
  });
}

async function runHostedMailboxPostCheckpointEffectsAndWriteLogBestEffort(input: {
  effects: readonly HostedMailboxPostCheckpointEffect[];
  input: HostedWorkspaceRunnerInput;
  phase: "active_turn_input" | "import";
  signal?: AbortSignal | null;
  timeoutMs?: number | null;
}): Promise<void> {
  const effects = input.effects;
  if (effects.length === 0) {
    return;
  }

  const result = await runHostedMailboxPostCheckpointEffectsBestEffort(effects, {
    signal: input.signal,
    timeoutMs: input.timeoutMs,
  });
  if (!result.attempted) {
    return;
  }
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields(input.input.runtimeLogContext),
      component: "mailbox",
      eventCode: "mailbox.post_checkpoint_effects_finished",
      level: result.failed > 0 || result.partial > 0 ? "warn" : "info",
      phase: input.phase,
      redactedJson: {
        attemptedCount: effects.length,
        effectAttachmentEvidenceUpdated: result.effectAttachmentEvidenceUpdated.slice(0, 16),
        effectKinds: result.effectKinds.slice(0, 16),
        effectProjectionUpdated: result.effectProjectionUpdated.slice(0, 16),
        effectReasonCodes: result.effectReasonCodes.slice(0, 16),
        effectStatuses: result.effectStatuses.slice(0, 16),
        errorCodes: compactHostedRuntimeLogCodes(result.errorCodes),
        ...(result.failureCodeDetails.length > 0
          ? { failureCodeDetails: [...result.failureCodeDetails] }
          : {}),
        ...(result.failureNames.length > 0 ? { failureNames: [...result.failureNames] } : {}),
        ...(result.failureSummaries.length > 0
          ? { failureSummaries: [...result.failureSummaries] }
          : {}),
        failedCount: result.failed,
        partialCount: result.partial,
        succeededCount: result.succeeded,
      },
    },
    now: input.input.now,
    platform: input.input.platform,
  });
}

async function checkpointHostedWorkspaceAssistantPhase(input: {
  assistantPhaseResult: HostedWorkspaceRunnerAssistantPhaseResult;
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestSession;
  expectedUserId: string;
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  now?: () => string;
  platform: Pick<HostedWorkspaceRunnerPlatform, "logPort">;
  runtimeLogContext?: HostedRuntimeLogContext | null;
}): Promise<void> {
  if (input.assistantPhaseResult.progressed !== true) {
    return;
  }

  const checkpointReason = requireHostedWorkspaceAssistantPhaseCheckpointReason(
    input.assistantPhaseResult,
  );
  void input.expectedUserId;
  void input.initialMailboxImport;
  input.checkpointRequestBuilder.markRuntimeStateDirty();
  await writeHostedForegroundCheckpointDeferredLog({
    checkpointPhase: "assistant",
    now: input.now,
    platform: input.platform,
    reason: checkpointReason,
    runtimeLogContext: input.runtimeLogContext,
  });
}

function requireHostedWorkspaceAssistantPhaseCheckpointReason(
  result: HostedWorkspaceRunnerAssistantPhaseResult,
): HostedWorkspaceCheckpointReason {
  if (!result.checkpointReason) {
    throw new TypeError("Hosted workspace assistant phase checkpoint requires an explicit reason.");
  }
  return result.checkpointReason;
}

function mergeDeferredPostCheckpointRedactedStatus(input: {
  assistantPhaseResult: HostedWorkspaceRunnerAssistantPhaseResult;
  postCheckpoint: HostedWorkspaceRunnerAssistantPhasePostCheckpoint;
}): void {
  if (input.assistantPhaseResult.progressed !== true || !input.postCheckpoint.redactedStatus) {
    return;
  }

  input.assistantPhaseResult.redactedStatus = {
    ...(input.assistantPhaseResult.redactedStatus ?? {}),
    ...input.postCheckpoint.redactedStatus,
  };
}

function mergeDeferredPostCheckpointWake(input: {
  assistantPhaseResult: HostedWorkspaceRunnerAssistantPhaseResult;
  postCheckpoint: HostedWorkspaceRunnerAssistantPhasePostCheckpoint;
}): void {
  if (input.assistantPhaseResult.progressed !== true) {
    return;
  }

  if (!Object.hasOwn(input.postCheckpoint, "nextWakeAt")) {
    return;
  }

  const invocationLocalAssistantWakeAt =
    input.assistantPhaseResult.invocationLocalAssistantWakeAt ?? null;
  const previousWakeIsInvocationLocal =
    invocationLocalAssistantWakeAt !== null
    && input.assistantPhaseResult.nextWakeAt === invocationLocalAssistantWakeAt
    && (input.assistantPhaseResult.nextWakeReason ?? "assistant") === "assistant";
  if (input.postCheckpoint.nextWakeAt === null || input.postCheckpoint.nextWakeAt === undefined) {
    if (previousWakeIsInvocationLocal) {
      return;
    }
    input.assistantPhaseResult.nextWakeAt = null;
    input.assistantPhaseResult.nextWakeReason = null;
    return;
  }

  const postCheckpointWake = createHostedRuntimeWakeCandidate(
    input.postCheckpoint.nextWakeAt ?? null,
    input.postCheckpoint.nextWakeReason ?? null,
  );
  const previousWake = createHostedRuntimeWakeCandidate(
    input.assistantPhaseResult.nextWakeAt ?? null,
    input.assistantPhaseResult.nextWakeReason ?? null,
  );
  if (previousWakeIsInvocationLocal) {
    const selectedWake = selectHostedRuntimeWakeCandidate([
      previousWake,
      postCheckpointWake,
    ]);
    if (
      selectedWake.at === previousWake.at
      && selectedWake.reason === previousWake.reason
    ) {
      input.assistantPhaseResult.nextWakeAt = previousWake.at;
      input.assistantPhaseResult.nextWakeReason = previousWake.reason;
      return;
    }
  }
  if (
    previousWake.at !== null
    && previousWake.reason === "assistant"
    && postCheckpointWake.at !== null
    && postCheckpointWake.reason !== "assistant"
  ) {
    // Assistant/user work can beat maintenance, but assistant post-checkpoint
    // wakes replace earlier assistant wakes after their side effects run.
    const selectedWake = selectHostedRuntimeWakeCandidate([
      previousWake,
      postCheckpointWake,
    ]);
    if (
      selectedWake.at === previousWake.at
      && selectedWake.reason === previousWake.reason
    ) {
      input.assistantPhaseResult.nextWakeAt = previousWake.at;
      input.assistantPhaseResult.nextWakeReason = previousWake.reason;
      return;
    }
  }

  input.assistantPhaseResult.nextWakeAt = postCheckpointWake.at;
  input.assistantPhaseResult.nextWakeReason = postCheckpointWake.reason;
}

function appendHostedWorkspaceDurableCheckpointEffect(input: {
  effects: HostedWorkspaceDurableCheckpointEffect[];
  postCheckpoint: HostedWorkspaceRunnerAssistantPhasePostCheckpoint;
}): void {
  const effect = input.postCheckpoint.afterDurableCheckpoint ?? null;
  if (!effect) {
    return;
  }
  input.effects.push(...listHostedWorkspaceDurableCheckpointEffects(effect));
}

function listHostedWorkspaceDurableCheckpointEffects(
  effect: HostedWorkspaceDurableCheckpointEffects,
): HostedWorkspaceDurableCheckpointEffect[] {
  return typeof effect === "function" ? [effect] : [...effect];
}

async function writeHostedForegroundCheckpointDeferredLog(input: {
  checkpointPhase: "active_turn_input" | "assistant" | "canonical_write" | "post_assistant";
  now?: () => string;
  platform: Pick<HostedWorkspaceRunnerPlatform, "logPort">;
  reason: HostedWorkspaceCheckpointReason;
  runtimeLogContext?: HostedRuntimeLogContext | null;
}): Promise<void> {
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields(input.runtimeLogContext),
      component: "workspace",
      eventCode: "checkpoint.runtime_residue_deferred",
      level: "info",
      phase: "checkpoint",
      redactedJson: {
        checkpointPhase: input.checkpointPhase,
        checkpointReason: input.reason,
      },
    },
    now: input.now,
    platform: input.platform,
  });
}

function applyExpectedWorkspaceVersionOverride(input: {
  expectedWorkspaceVersion: string | null;
  request: HostedWorkspaceCheckpointRequest;
}): HostedWorkspaceCheckpointRequest {
  if (input.expectedWorkspaceVersion === null) {
    return input.request;
  }

  return {
    ...input.request,
    expectedWorkspaceVersion: input.expectedWorkspaceVersion,
  };
}

function cloneHostedRuntimeRedactedJson(
  value: HostedRuntimeRedactedJson | null,
): HostedRuntimeRedactedJson | null {
  return value ? { ...value } : null;
}

function mergeHostedRuntimeRedactedStatusValues(
  ...values: Array<HostedRuntimeRedactedJson | null | undefined>
): HostedRuntimeRedactedJson | null {
  let merged: HostedRuntimeRedactedJson | null = null;
  for (const value of values) {
    if (!value) {
      continue;
    }
    merged = {
      ...(merged ?? {}),
      ...value,
    };
  }
  return merged;
}
