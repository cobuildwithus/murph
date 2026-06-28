import {
  existsSync,
} from "node:fs";
import {
  resolveAssistantStatePaths,
} from "@murphai/runtime-state/node/assistant-state-fs";
import {
  buildHostedExecutionSafeErrorDiagnostics,
} from "@murphai/hosted-execution";
import {
  withHostedCanonicalWritePort,
  type HostedCanonicalWritePort,
} from "@murphai/core";
import type {
  HostedRuntimeRedactedJson,
  HostedRuntimeLatencyPhaseBreakdown,
  HostedRuntimeLatencyTraceStagedMilestones,
  HostedWorkspaceCheckpointReason,
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceCheckpointResponse,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  conversationRefFromAssistantInputConversation,
  isAssistantContextSnapshotRefreshPending,
  listAssistantContextSnapshotDirtyDomainsForCanonicalWrite,
  markAssistantContextSnapshotDirty,
  notifyAssistantActiveTurnInputAvailable,
  resolveAssistantContextSnapshotPath,
  readAssistantInputEvent,
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

import {
  buildHostedMailboxImportRedactedStatus,
  HostedMailboxImportCheckpointConflictError,
  HostedMailboxImportCheckpointUserMismatchError,
  importHostedMailboxPrefixAndCheckpoint,
  type HostedMailboxImportCheckpointRequestInput,
  type HostedMailboxImportCheckpointResult,
} from "./mailbox-checkpoint.ts";
import type {
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
  HOSTED_ASSISTANT_WAKE_REASON,
  createHostedRuntimeWakeCandidate,
  selectHostedRuntimeWakeCandidate,
} from "./wake-candidates.ts";
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

type HostedWorkspaceSnapshotCheckpointMailboxInput =
  Omit<HostedMailboxImportCheckpointRequestInput, "reason" | "redactedStatus"> & {
    reason: Exclude<HostedWorkspaceCheckpointReason, "idle_shutdown">;
  };

export type HostedWorkspaceSnapshotCheckpointRequestBuilderInput =
  (
    | HostedWorkspaceSnapshotCheckpointMailboxInput
    | {
      reason: "idle_shutdown";
    }
  ) & {
    expectedWorkspaceVersion?: string;
    inboxMediaRetentionWakeAt?: string | null;
    nextWakeAt?: string | null;
    nextWakeReason?: string | null;
    redactedStatus?: HostedRuntimeRedactedJson | null;
  };

export interface HostedWorkspaceRunnerCheckpointRequestInput
  extends Omit<HostedMailboxImportCheckpointRequestInput, "reason"> {
  nextWakeAt?: string | null;
  nextWakeReason?: string | null;
  reason: HostedWorkspaceCheckpointReason;
}

export type HostedWorkspaceSnapshotCheckpointBuilder = (
  input: HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
) => Promise<HostedWorkspaceSnapshotCheckpointResult> | HostedWorkspaceSnapshotCheckpointResult;

export interface HostedWorkspaceCheckpointRequestBuilder {
  checkpoint?(
    input: HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
    workspacePort: HostedRuntimeWorkspacePort,
  ): Promise<HostedWorkspaceCheckpointResponse> | HostedWorkspaceCheckpointResponse;
  createRequest(
    input: HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
  ): Promise<HostedWorkspaceCheckpointRequest> | HostedWorkspaceCheckpointRequest;
  recordCheckpoint?(response: HostedWorkspaceCheckpointResponse): void;
}

interface HostedWorkspaceCheckpointRequestSession
  extends HostedWorkspaceCheckpointRequestBuilder {
  conversationConsumedSeq(): string | null;
  discardMailboxPostCheckpointEffects(): void;
  hasRuntimeStateDirty(): boolean;
  hasConversationAssistantInputForConsumeAck(): boolean;
  latestMailboxImportCoveredByWorkspace(): boolean;
  latestMailboxImport(): HostedMailboxImportCheckpointResult | null;
  latestWorkspace(): HostedWorkspaceState | null;
  markRuntimeStateDirty(): void;
  mailboxRetryAt(): string | null;
  recordCheckpointResult(result: HostedMailboxImportCheckpointResult): void;
  recordWorkspaceCheckpoint(response: HostedWorkspaceCheckpointResponse): void;
  takeMailboxPostCheckpointEffects(): readonly HostedMailboxPostCheckpointEffect[];
}

export interface HostedWorkspaceRunnerPlatform
  extends HostedRuntimePlatform {
  mailboxPort: HostedRuntimeMailboxPort;
  workspacePort: HostedRuntimeWorkspacePort;
}

export interface HostedWorkspaceRunnerAssistantPhaseInput {
  deviceSyncWorkspaceWakeHandled?: HostedWorkspaceRunnerHandledDeviceSyncWake | null;
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  materializeWorkspaceArtifacts?: HostedWorkspaceArtifactMaterializer | null;
  now?: () => string;
  platform: HostedRuntimePlatform;
  prepareAutoReplyDelivery?: (() => Promise<HostedWorkspaceRunnerAssistantPhaseDeliveryBarrier | null>) | null;
  shouldYieldBackgroundMaintenance?: (() => boolean) | null;
  workspace: HostedWorkspaceState | null;
}

export interface HostedWorkspaceRunnerHandledDeviceSyncWake {
  nextWakeAt: string;
  nextWakeReason: string | null;
}

export interface HostedWorkspaceRunnerAssistantPhaseDeliveryBarrier {
  nextWakeAt?: string | null;
  nextWakeReason?: string | null;
  redactedStatus?: HostedRuntimeRedactedJson | null;
}

interface HostedWorkspaceRunnerAssistantPhaseResultBase {
  afterCheckpoint?: (() => Promise<HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null | void>) | null;
  browserVaultReplicaRefreshRequested?: true;
  deviceSyncMaintenanceRan?: true;
  flushDeferredUsageAfterCheckpoint?: (() => Promise<void>) | null;
  // Failed foreground reply count for this pass. Present only when the pass
  // ran the foreground assistant reply phase; gates the durable conversation
  // consumed-watermark ack (only a clean pass with zero failed replies and no
  // pending foreground assistant input may advance it).
  foregroundReplyFailed?: number | null;
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

export type HostedWorkspaceDurableCheckpointEffect =
  () => Promise<HostedWorkspaceDurableCheckpointEffectResult | null | void>
    | HostedWorkspaceDurableCheckpointEffectResult
    | null
    | void;

export type HostedWorkspaceDurableCheckpointEffects =
  | HostedWorkspaceDurableCheckpointEffect
  | readonly HostedWorkspaceDurableCheckpointEffect[];

const HOSTED_CONVERSATION_MAILBOX_CONSUME_ACK_RETRY_DELAY_MS = 15 * 1000;
const HOSTED_PRE_AUTO_REPLY_SYSTEM_IMPORT_MAX_PAGES = 4;

export interface HostedWorkspaceRunnerMailboxImportContext {
  latencyMilestones?: HostedRuntimeLatencyTraceStagedMilestones | null;
  signal?: AbortSignal | null;
}

export interface HostedWorkspaceRunnerRuntimePassDiagnostics {
  foreground: boolean;
  ordinal: number;
  startedAtEpochMs: number;
}

export type HostedWorkspaceRunnerMailboxImportItem = (
  item: HostedMailboxResolvedImportItem,
  context?: HostedWorkspaceRunnerMailboxImportContext,
) => Promise<HostedMailboxItemImportOutcome>;

export interface HostedWorkspaceRunnerInput {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestBuilder;
  expectedUserId: string;
  foregroundImportItem?: HostedWorkspaceRunnerMailboxImportItem | null;
  foregroundLimitPerLane?: number | null;
  importItem: HostedWorkspaceRunnerMailboxImportItem;
  initialMailboxImport?: HostedMailboxImportCheckpointResult | null;
  initialMailboxImportContext?: HostedWorkspaceRunnerMailboxImportContext | null;
  limitPerLane: number;
  materializeWorkspaceArtifacts?: HostedWorkspaceArtifactMaterializer | null;
  platform: HostedWorkspaceRunnerPlatform;
  requestId: string;
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
  latestMailboxImport: HostedMailboxImportCheckpointResult;
  latestWorkspace: HostedWorkspaceState | null;
  mailboxPostCheckpointEffectsFinished: Promise<void> | null;
  mailboxRetryAt: string | null;
  projectedWakeRequiresCheckpoint: boolean;
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
        leaseGeneration: metadata.leaseGeneration,
        nextWakeAt: Object.hasOwn(input, "nextWakeAt")
          ? input.nextWakeAt ?? null
          : metadata.nextWakeAt ?? null,
        nextWakeReason: Object.hasOwn(input, "nextWakeReason")
          ? input.nextWakeReason ?? null
          : metadata.nextWakeReason ?? null,
        reason: input.reason,
        redactedStatus: cloneHostedRuntimeRedactedJson(input.redactedStatus ?? null),
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
    async checkpoint(requestInput, workspacePort) {
      const expectedWorkspaceVersion =
        requestInput.expectedWorkspaceVersion ?? input.metadata.expectedWorkspaceVersion;
      const snapshot = await input.createSnapshot({
        ...requestInput,
        expectedWorkspaceVersion,
      });
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
    async createRequest(requestInput) {
      const expectedWorkspaceVersion =
        requestInput.expectedWorkspaceVersion ?? input.metadata.expectedWorkspaceVersion;
      const snapshot = await input.createSnapshot({
        ...requestInput,
        expectedWorkspaceVersion,
      });
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
    snapshotRef: input.snapshot.snapshotRef,
  };
}

export async function runHostedWorkspaceUntilIdleOrBudget(
  input: HostedWorkspaceRunnerInput,
): Promise<HostedWorkspaceRunnerResult> {
  assertHostedWorkspaceRunnerUser(input);

  const afterDurableCheckpoint: HostedWorkspaceDurableCheckpointEffect[] = [];
  const checkpointRequestSession = createHostedWorkspaceCheckpointRequestSession(
    input.checkpointRequestBuilder,
  );
  let initialMailboxImport = input.initialMailboxImport
    ?? await importHostedMailboxForWorkspaceRunner({
      checkpointRequestBuilder: checkpointRequestSession,
      checkpointReason: "import",
      deferCheckpoint: true,
      importItemContext: input.initialMailboxImportContext ?? null,
      input,
      lanes: input.runAssistantPhase ? ["conversation"] : undefined,
      requestId: input.requestId,
      signal: input.signal ?? null,
    });
  checkpointRequestSession.recordCheckpointResult(initialMailboxImport);
  markHostedMailboxImportDirtyIfNeeded(checkpointRequestSession, initialMailboxImport);

  if (
    input.runAssistantPhase
    && !hasHostedMailboxImportForegroundConversationWork(initialMailboxImport)
  ) {
    initialMailboxImport = await importHostedMailboxForWorkspaceRunner({
      checkpointRequestBuilder: checkpointRequestSession,
      checkpointReason: "import",
      deferCheckpoint: true,
      importItemContext: input.initialMailboxImportContext ?? null,
      input,
      lanes: ["system"],
      requestId: input.requestId,
      signal: input.signal ?? null,
    });
    checkpointRequestSession.recordCheckpointResult(initialMailboxImport);
    markHostedMailboxImportDirtyIfNeeded(checkpointRequestSession, initialMailboxImport);
  }

  if (!input.runAssistantPhase) {
    await runHostedMailboxPostCheckpointEffectsAndLogBestEffort({
      checkpointRequestBuilder: checkpointRequestSession,
      input,
    });
    return {
      afterDurableCheckpoint,
      assistantPhaseResult: null,
      initialMailboxImport,
      latestMailboxImport: checkpointRequestSession.latestMailboxImport()
        ?? initialMailboxImport,
      latestWorkspace: checkpointRequestSession.latestWorkspace()
        ?? initialMailboxImport.checkpoint?.workspace
        ?? input.workspace,
      mailboxPostCheckpointEffectsFinished: null,
      mailboxRetryAt: checkpointRequestSession.mailboxRetryAt(),
      projectedWakeRequiresCheckpoint: false,
      runtimeStateDirty: checkpointRequestSession.hasRuntimeStateDirty(),
    };
  }

  const runAssistantPhase = input.runAssistantPhase;
  let foregroundConversationWorkObserved = false;
  const foregroundMailboxImportLoop =
    startHostedForegroundConversationMailboxImportLoop({
      checkpointRequestBuilder: checkpointRequestSession,
      input,
      onForegroundConversationWorkObserved: () => {
        foregroundConversationWorkObserved = true;
      },
    });
  const assistantPhaseInput = {
    initialMailboxImport,
    materializeWorkspaceArtifacts: input.materializeWorkspaceArtifacts ?? null,
    now: input.now,
    platform: input.platform,
    prepareAutoReplyDelivery: async () =>
      await prepareHostedAutoReplyDeliveryForWorkspaceRunner({
        checkpointRequestBuilder: checkpointRequestSession,
        foregroundMailboxImportLoop,
        input,
      }),
    shouldYieldBackgroundMaintenance: () => foregroundConversationWorkObserved,
    workspace: input.workspace,
  };
  let assistantContextSnapshotDirty = false;
  let mailboxPostCheckpointEffectsFinished: Promise<void> | null = null;
  let projectedWakeRequiresCheckpoint = false;
  let assistantPhaseCheckpointed = false;
  let assistantPhaseAfterCheckpointReached = false;
  let flushDeferredUsageAfterCheckpoint: (() => Promise<void>) | null = null;
  let deferredUsageFlushed = false;
  const flushAssistantPhaseDeferredUsage = async (): Promise<void> => {
    if (!assistantPhaseCheckpointed || !flushDeferredUsageAfterCheckpoint || deferredUsageFlushed) {
      return;
    }

    deferredUsageFlushed = true;
    await flushDeferredUsageAfterCheckpoint();
  };
  const hostedCanonicalWritePort = createHostedWorkspaceCanonicalWritePort({
    checkpointRequestBuilder: checkpointRequestSession,
    initialMailboxImport,
    input,
    onAssistantContextSnapshotDirty: () => {
      assistantContextSnapshotDirty = true;
    },
  });
  let assistantPhaseResult: HostedWorkspaceRunnerAssistantPhaseResult;
  try {
    assistantPhaseResult = await withHostedCanonicalWritePort(
      hostedCanonicalWritePort,
      () => runAssistantPhase(assistantPhaseInput),
    );
    flushDeferredUsageAfterCheckpoint =
      assistantPhaseResult.flushDeferredUsageAfterCheckpoint ?? null;
    if (flushDeferredUsageAfterCheckpoint && assistantPhaseResult.progressed !== true) {
      throw new TypeError("Hosted workspace assistant phase deferred usage flush requires a progressed phase.");
    }
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
    assistantPhaseCheckpointed = true;
    if (assistantPhaseResult.afterCheckpoint && assistantPhaseResult.progressed !== true) {
      throw new TypeError("Hosted workspace assistant phase afterCheckpoint requires a progressed phase.");
    }
    await foregroundMailboxImportLoop.stop();
    if (foregroundConversationWorkObserved) {
      // stop() drains any foreground import already in flight. Preserve the
      // selected durable wake, but nudge the outer dirty loop to run the new
      // foreground pass before idle checkpointing when there is assistant work
      // queued from that import.
      await notifyPendingForegroundAssistantInputWake({
        now: input.now,
        runtimeWakeSignal: input.runtimeWakeSignal ?? null,
        vaultRoot: input.vaultRoot,
      });
    }
    let postCheckpoint: HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null | void;
    try {
      postCheckpoint = await withHostedCanonicalWritePort(
        hostedCanonicalWritePort,
        async () => {
          assistantPhaseAfterCheckpointReached = true;
          return await assistantPhaseResult.afterCheckpoint?.();
        },
      );
    } catch (error) {
      if (!assistantPhaseAfterCheckpointReached) {
        await flushAssistantPhaseDeferredUsage();
      }
      await writeHostedWorkspaceAssistantPostCheckpointFailureRuntimeLog({
        error,
        errorCode: "assistant_after_checkpoint_failed",
        input,
      });
      postCheckpoint = null;
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
        projectedWakeRequiresCheckpoint = mergeDeferredPostCheckpointWake({
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
    await reconcilePendingAssistantInputWake({
      foregroundConversationWorkObserved,
      now: input.now,
      projectedWakeRequiresCheckpoint,
      result: assistantPhaseResult,
      vaultRoot: input.vaultRoot,
    });
    await stageHostedConversationMailboxConsumedAckBestEffort({
      afterDurableCheckpoint,
      assistantPhaseResult,
      checkpointRequestSession,
      initialMailboxImport,
      input,
    });
    mailboxPostCheckpointEffectsFinished = scheduleHostedMailboxPostCheckpointEffectsAndLogBestEffort({
      checkpointRequestBuilder: checkpointRequestSession,
      input,
      phase: "import",
    });
  } catch (error) {
    await foregroundMailboxImportLoop.stop();
    if (!assistantPhaseAfterCheckpointReached) {
      await flushAssistantPhaseDeferredUsage();
    }
    scheduleHostedMailboxPostCheckpointEffectsAndLogBestEffort({
      checkpointRequestBuilder: checkpointRequestSession,
      input,
      phase: "import",
    });
    throw error;
  } finally {
    await foregroundMailboxImportLoop.stop();
  }

  return {
    afterDurableCheckpoint,
    assistantPhaseResult,
    initialMailboxImport,
    latestMailboxImport: checkpointRequestSession.latestMailboxImport()
      ?? initialMailboxImport,
    latestWorkspace: checkpointRequestSession.latestWorkspace()
      ?? initialMailboxImport.checkpoint?.workspace
      ?? input.workspace,
    mailboxPostCheckpointEffectsFinished,
    mailboxRetryAt: checkpointRequestSession.mailboxRetryAt(),
    projectedWakeRequiresCheckpoint,
    runtimeStateDirty: checkpointRequestSession.hasRuntimeStateDirty(),
  };
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
  input: HostedWorkspaceRunnerInput;
  onForegroundConversationWorkObserved?: (() => void) | null;
}): {
  stop(): Promise<void>;
} {
  const runtimeWakeSignal = input.input.runtimeWakeSignal ?? null;
  if (!runtimeWakeSignal) {
    return {
      stop: async () => undefined,
    };
  }

  const waitController = new AbortController();
  const outerSignal = input.input.signal ?? null;
  const abort = () => {
    waitController.abort(readHostedForegroundRuntimeWakeAbortReason(outerSignal));
  };
  outerSignal?.addEventListener("abort", abort, { once: true });
  let wakeOrdinal = 0;

  const loop = (async () => {
    while (!waitController.signal.aborted) {
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
      const requestId = `${input.input.requestId}:runtime-wake:${wakeOrdinal}`;
      const waitResolvedAtEpochMs = Date.now();
      const latencyMilestones = createHostedForegroundMailboxImportLatencyMilestones({
        foregroundWakeOrdinal: wakeOrdinal,
        foregroundWaitResolvedAtEpochMs: waitResolvedAtEpochMs,
        orchestration: notification.orchestration ?? null,
        runtimePassDiagnostics: input.input.runtimePassDiagnostics ?? null,
        runtimeWakeNotifiedAtEpochMs: notification.notifiedAtEpochMs,
      });
      try {
        const result = await importHostedMailboxForWorkspaceRunner({
          checkpointRequestBuilder: input.checkpointRequestBuilder,
          checkpointReason: "active_turn_input",
          deferCheckpoint: true,
          importItem: input.input.foregroundImportItem ?? input.input.importItem,
          importItemContext: {
            latencyMilestones,
          },
          input: input.input,
          lanes: ["system", "conversation"],
          limitPerLane: input.input.foregroundLimitPerLane ?? input.input.limitPerLane,
          requestId,
          signal: outerSignal,
        });
        if (shouldRecordHostedForegroundMailboxImportResult(result)) {
          input.checkpointRequestBuilder.recordCheckpointResult(result);
        }
        markHostedMailboxImportDirtyIfNeeded(input.checkpointRequestBuilder, result);
        await runHostedMailboxPostCheckpointEffectsForPromptPreparationBestEffort({
          checkpointRequestBuilder: input.checkpointRequestBuilder,
          input: input.input,
          phase: "active_turn_input",
          signal: outerSignal,
        });
        if (hasHostedMailboxImportForegroundConversationWork(result)) {
          input.onForegroundConversationWorkObserved?.();
        }
        await notifyHostedActiveTurnInputForMailboxImport({
          input: input.input,
          result,
          signal: outerSignal,
        });
      } catch (error) {
        if (outerSignal?.aborted) {
          break;
        }
        await writeHostedForegroundMailboxImportFailureRuntimeLog({
          error,
          input: input.input,
        });
      }
    }
  })();

  return {
    async stop() {
      outerSignal?.removeEventListener("abort", abort);
      if (!waitController.signal.aborted) {
        waitController.abort(new DOMException("Foreground mailbox import loop stopped.", "AbortError"));
      }
      await loop.catch(() => undefined);
    },
  };
}

async function prepareHostedAutoReplyDeliveryForWorkspaceRunner(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestSession;
  foregroundMailboxImportLoop: { stop(): Promise<void> };
  input: HostedWorkspaceRunnerInput;
}): Promise<HostedWorkspaceRunnerAssistantPhaseDeliveryBarrier | null> {
  await input.foregroundMailboxImportLoop.stop();

  let previousSystemSeq: string | null = null;
  let importPage = 0;
  while (true) {
    importPage += 1;
    const result = await importHostedMailboxForWorkspaceRunner({
      checkpointRequestBuilder: input.checkpointRequestBuilder,
      checkpointReason: "active_turn_input",
      deferCheckpoint: true,
      importItem: input.input.importItem,
      input: input.input,
      lanes: ["system"],
      limitPerLane: input.input.limitPerLane,
      requestId: `${input.input.requestId}:pre-auto-reply-system:${importPage}`,
      signal: input.input.signal ?? null,
    });
    input.checkpointRequestBuilder.recordCheckpointResult(result);
    markHostedMailboxImportDirtyIfNeeded(input.checkpointRequestBuilder, result);
    await runHostedMailboxPostCheckpointEffectsForPromptPreparationBestEffort({
      checkpointRequestBuilder: input.checkpointRequestBuilder,
      input: input.input,
      phase: "active_turn_input",
      signal: input.input.signal ?? null,
    });

    const nextRetryAt = result.importResult.nextRetryAt ?? null;
    if (!nextRetryAt) {
      return null;
    }

    const systemSeq = result.state.watermarks.system;
    if (
      !hostedWorkspaceRunnerWakeIsImmediate(nextRetryAt, input.input.now)
      || importPage >= HOSTED_PRE_AUTO_REPLY_SYSTEM_IMPORT_MAX_PAGES
      || systemSeq === previousSystemSeq
    ) {
      return {
        nextWakeAt: nextRetryAt,
        nextWakeReason: "mailbox",
        redactedStatus: {
          hostedMemberChannelPreDispatchImportBlocked: 1,
          hostedMemberChannelPreDispatchImportPages: importPage,
        },
      };
    }
    previousSystemSeq = systemSeq;
  }
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

async function notifyHostedActiveTurnInputForMailboxImport(input: {
  input: HostedWorkspaceRunnerInput;
  result: HostedMailboxImportCheckpointResult;
  signal: AbortSignal | null;
}): Promise<void> {
  const inputIds = [...new Set(input.result.importResult.assistantInputIds ?? [])];
  const conversationsByKey = new Map<
    string,
    ReturnType<typeof conversationRefFromAssistantInputConversation>
  >();
  for (const inputId of inputIds) {
    const event = await readAssistantInputEvent({
      inputId,
      vault: input.input.vaultRoot,
    });
    if (!event?.conversation) {
      continue;
    }

    const conversation = conversationRefFromAssistantInputConversation(event.conversation);
    conversationsByKey.set(
      formatHostedActiveTurnConversationNotificationKey(conversation),
      conversation,
    );
  }

  for (const conversation of conversationsByKey.values()) {
    await notifyAssistantActiveTurnInputAvailable({
      conversation,
      ...(input.signal ? { signal: input.signal } : {}),
      vault: input.input.vaultRoot,
    }).catch((error: unknown) => {
      warnAssistantBestEffortFailure({
        error,
        operation: "hosted active-turn input notification",
      });
    });
  }
}

function formatHostedActiveTurnConversationNotificationKey(
  conversation: ReturnType<typeof conversationRefFromAssistantInputConversation>,
): string {
  return [
    conversation.alias ?? "",
    conversation.channel ?? "",
    conversation.directness ?? "",
    conversation.identityId ?? "",
    conversation.participantId ?? "",
    conversation.sessionId ?? "",
    conversation.threadId ?? "",
  ].join("\u0000");
}

export async function importHostedMailboxForWorkspaceRunner(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestBuilder;
  checkpointReason: HostedWorkspaceCheckpointReason;
  deferConversationUntil?: HostedMailboxConversationDeferral | null;
  deferCheckpoint?: boolean;
  importItem?: HostedWorkspaceRunnerMailboxImportItem | null;
  importItemContext?: HostedWorkspaceRunnerMailboxImportContext | null;
  input: HostedWorkspaceRunnerInput;
  lanes?: readonly ("conversation" | "system")[];
  limitPerLane?: number | null;
  prefetch?: HostedMailboxPrefixPrefetch | null;
  requestId: string;
  signal?: AbortSignal | null;
}): Promise<HostedMailboxImportCheckpointResult> {
  const importItem = input.importItem ?? input.input.importItem;
  const signal = input.signal ?? input.importItemContext?.signal ?? input.input.signal ?? null;
  const importItemContext = stampHostedMailboxImportStartedLatencyMilestone(
    {
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
  await writeHostedMailboxImportRuntimeLog({
    checkpointReason: input.checkpointReason,
    lanes: input.lanes,
    result,
    runnerInput: input.input,
  });
  if (isDeferredHostedMailboxImportDirty(result)) {
    await markHostedWorkspaceLiveRuntimeStateDirtyForSnapshotRefBestEffort({
      snapshotRef: input.input.workspace?.snapshotRef ?? null,
      vaultRoot: input.input.vaultRoot,
    });
  }

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

async function stageHostedConversationMailboxConsumedAckBestEffort(context: {
  afterDurableCheckpoint: HostedWorkspaceDurableCheckpointEffect[];
  assistantPhaseResult: HostedWorkspaceRunnerAssistantPhaseResult;
  checkpointRequestSession: HostedWorkspaceCheckpointRequestSession;
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  input: HostedWorkspaceRunnerInput;
}): Promise<void> {
  // Durable replay guard: only a foreground assistant pass that finished with
  // zero failed replies and no pending foreground assistant input may advance
  // the conversation consumed watermark. Anything unhandled must stay
  // replayable as a live reply candidate. The ack is best-effort: a missed ack
  // only widens the replay window, it must never fail the pass.
  // Ordering invariant: this must run after checkpointHostedWorkspaceAssistantPhase —
  // foregroundReplyFailed does not count post-checkpoint delivery-effect failures,
  // so lost-reply safety relies on any failed intent already being in that snapshot.
  // Every skip is logged: prod showed consumed_seq never advancing for any
  // member (2026-06-11 rollback incident) with zero observable evidence of
  // which gate was responsible. A silent skip here is an unbounded replay
  // window after an unclean container death.
  try {
    const pendingInputIds = canSkipPendingAssistantInputProbe(context.input.vaultRoot)
      ? []
      : await resolveHostedPendingAssistantInputIdsForConsumeAck({
        vaultRoot: context.input.vaultRoot,
      });
    if (pendingInputIds.length > 0) {
      await writeHostedConversationMailboxConsumeSkipRuntimeLog({
        input: context.input,
        skipReason: "pending_assistant_input",
      });
      return;
    }
    const ack = await resolveHostedConversationMailboxConsumedSeqForAck({
      containsAssistantInput: context.checkpointRequestSession
        .hasConversationAssistantInputForConsumeAck(),
      conversationConsumedSeq: context.checkpointRequestSession.conversationConsumedSeq(),
      initialMailboxImport: context.initialMailboxImport,
      latestMailboxImport: context.checkpointRequestSession.latestMailboxImport()
        ?? context.initialMailboxImport,
    });
    if (!ack) {
      await writeHostedConversationMailboxConsumeSkipRuntimeLog({
        input: context.input,
        skipReason: "no_covered_conversation_input",
      });
      return;
    }
    if (
      ack.containsAssistantInput
      && context.assistantPhaseResult.foregroundReplyFailed !== 0
    ) {
      await writeHostedConversationMailboxConsumeSkipRuntimeLog({
        input: context.input,
        skipReason: context.assistantPhaseResult.foregroundReplyFailed == null
          ? "reply_outcome_missing"
          : "reply_failed",
      });
      return;
    }
    const mailboxPort = context.input.platform.mailboxPort;
    if (!mailboxPort?.consume) {
      await writeHostedConversationMailboxConsumeSkipRuntimeLog({
        input: context.input,
        skipReason: "consume_port_missing",
      });
      return;
    }
    const consume = mailboxPort.consume.bind(mailboxPort);
    context.afterDurableCheckpoint.push(async () => {
      try {
        await consume({
          lanes: [
            {
              consumedSeq: ack.consumedSeq,
              lane: "conversation",
            },
          ],
          requestId: `${context.input.requestId}:mailbox-consume`,
        });
        await writeHostedRuntimeLogBestEffort({
          entry: {
            ...buildHostedRuntimeLogContextFields(context.input.runtimeLogContext),
            component: "mailbox",
            eventCode: "mailbox.consume_ack_advanced",
            level: "info",
            mailboxLane: "conversation",
            mailboxSeqEnd: ack.consumedSeq,
            phase: "checkpoint",
          },
          now: context.input.now,
          platform: context.input.platform,
        });
      } catch (error) {
        await writeHostedConversationMailboxConsumeFailureRuntimeLog({
          error,
          input: context.input,
        });
        return {
          nextWakeAt: resolveHostedConversationMailboxConsumeAckRetryAt(
            context.input.now?.(),
          ),
          nextWakeReason: "mailbox",
        };
      }
    });
  } catch (error) {
    await writeHostedConversationMailboxConsumeFailureRuntimeLog({
      error,
      input: context.input,
    });
  }
}

async function resolveHostedPendingAssistantInputIdsForConsumeAck(input: {
  vaultRoot: string;
}): Promise<string[]> {
  return await compactHostedPendingAssistantInputIds({
    vaultRoot: input.vaultRoot,
  });
}

type HostedConversationMailboxConsumeSkipReason =
  | "consume_port_missing"
  | "no_covered_conversation_input"
  | "pending_assistant_input"
  | "reply_failed"
  | "reply_outcome_missing";

function resolveHostedConversationMailboxConsumedSeqForAck(context: {
  containsAssistantInput: boolean;
  conversationConsumedSeq?: string | null;
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  latestMailboxImport: HostedMailboxImportCheckpointResult;
}): {
  consumedSeq: string;
  containsAssistantInput: boolean;
} | null {
  const baseSeq = resolveHostedConversationMailboxAckBaseConsumedSeq(context);
  if (baseSeq === null) {
    return null;
  }
  const latestLocalSeq = parseHostedConversationMailboxAckSeqOrNull(
    context.latestMailboxImport.state.watermarks.conversation,
  );
  const restoredLocalSeq = parseHostedConversationMailboxAckSeqOrNull(
    context.initialMailboxImport.previousState.watermarks.conversation,
  );
  if (latestLocalSeq === null || restoredLocalSeq === null || latestLocalSeq <= baseSeq) {
    return null;
  }

  return {
    consumedSeq: latestLocalSeq.toString(),
    containsAssistantInput: context.containsAssistantInput,
  };
}

function resolveHostedConversationMailboxAckBaseConsumedSeq(context: {
  conversationConsumedSeq?: string | null;
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  latestMailboxImport: HostedMailboxImportCheckpointResult;
}): bigint | null {
  let result = parseHostedConversationMailboxOptionalAckSeqOrNull(
    context.conversationConsumedSeq ?? null,
  );

  for (const value of [
    context.initialMailboxImport.importResult.consumedSeqByLane?.conversation ?? null,
    context.latestMailboxImport.importResult.consumedSeqByLane?.conversation ?? null,
  ]) {
    const seq = parseHostedConversationMailboxOptionalAckSeqOrNull(value);
    if (seq !== null && (result === null || seq > result)) {
      result = seq;
    }
  }

  return result;
}

function parseHostedConversationMailboxOptionalAckSeqOrNull(
  value: string | null,
): bigint | null {
  return value === null ? null : parseHostedConversationMailboxAckSeqOrNull(value);
}

function parseHostedConversationMailboxAckSeqOrNull(value: string): bigint | null {
  return /^(?:0|[1-9][0-9]*)$/u.test(value) ? BigInt(value) : null;
}

function resolveHostedConversationMailboxConsumeAckRetryAt(nowIso?: string): string {
  const nowMs = nowIso ? Date.parse(nowIso) : Number.NaN;
  const baseMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(
    baseMs + HOSTED_CONVERSATION_MAILBOX_CONSUME_ACK_RETRY_DELAY_MS,
  ).toISOString();
}

async function writeHostedConversationMailboxConsumeSkipRuntimeLog(context: {
  input: HostedWorkspaceRunnerInput;
  skipReason: HostedConversationMailboxConsumeSkipReason;
}): Promise<void> {
  // Routine passes legitimately skip (background passes carry no foreground
  // reply outcome; fresh members have an empty watermark), so skips log at
  // info — the prod question is the reason distribution on reply passes, not
  // any single skip. A missing consume port is the one true wiring failure
  // (the replay guard can never engage) and stays warn.
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields(context.input.runtimeLogContext),
      component: "mailbox",
      eventCode: "mailbox.consume_ack_skipped",
      level: context.skipReason === "consume_port_missing" ? "warn" : "info",
      mailboxLane: "conversation",
      phase: "checkpoint",
      redactedJson: {
        skipReason: context.skipReason,
      },
    },
    now: context.input.now,
    platform: context.input.platform,
  });
}

async function writeHostedConversationMailboxConsumeFailureRuntimeLog(context: {
  error: unknown;
  input: HostedWorkspaceRunnerInput;
}): Promise<void> {
  const failure = buildHostedMailboxPostCheckpointEffectFailureLog(context.error);
  console.warn("Hosted conversation mailbox consume ack failed; replay window stays open.", {
    errorCode: failure.errorCode,
    errorName: failure.name ?? (context.error instanceof Error ? context.error.name : typeof context.error),
  });
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields(context.input.runtimeLogContext),
      component: "mailbox",
      errorCode: "mailbox_consume_failed",
      eventCode: "runner.error",
      level: "warn",
      phase: "checkpoint",
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

function readHostedForegroundRuntimeWakeAbortReason(signal: AbortSignal | null): unknown {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("Foreground mailbox import loop was aborted.", "AbortError");
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

function createHostedWorkspaceCanonicalWritePort(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestSession;
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  input: HostedWorkspaceRunnerInput;
  onAssistantContextSnapshotDirty?: (() => void) | null;
}): HostedCanonicalWritePort {
  return {
    async persistCanonicalWrite(writeInput) {
      input.checkpointRequestBuilder.markRuntimeStateDirty();
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
          input.onAssistantContextSnapshotDirty?.();
        } catch (error) {
          warnAssistantBestEffortFailure({
            error,
            operation: "mark assistant context snapshot dirty",
          });
        }
      }
      await writeHostedForegroundCheckpointDeferredLog({
        checkpointPhase: "canonical_write",
        now: input.input.now,
        platform: input.input.platform,
        reason: "canonical_runtime_commit",
        runtimeLogContext: input.input.runtimeLogContext,
      });
    },
  };
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
  projectedWakeRequiresCheckpoint: boolean;
  result: HostedWorkspaceRunnerAssistantPhaseResult;
  vaultRoot: string;
}): Promise<void> {
  if (input.result.nextWakeAt) {
    const nextWakeReason = input.result.nextWakeReason ?? "assistant";
    if (
      input.projectedWakeRequiresCheckpoint
      ||
      nextWakeReason !== "assistant"
      || !hostedWorkspaceRunnerWakeIsImmediate(input.result.nextWakeAt, input.now)
    ) {
      return;
    }
  }
  const wakeAt = await resolvePendingForegroundAssistantInputWakeAt({
    now: input.now,
    vaultRoot: input.vaultRoot,
  });
  if (!wakeAt) {
    return;
  }

  input.result.nextWakeAt = wakeAt;
  input.result.nextWakeReason = "assistant";
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
    now: input.now,
    vaultRoot: input.vaultRoot,
  });
  if (!wakeAt) {
    return;
  }

  input.runtimeWakeSignal.notify();
}

async function resolvePendingForegroundAssistantInputWakeAt(input: {
  now?: (() => string) | null;
  vaultRoot: string;
}): Promise<string | null> {
  if (canSkipPendingAssistantInputProbe(input.vaultRoot)) {
    return null;
  }
  return await resolveHostedPendingAssistantInputWakeAt({
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
}): void {
  const selectedWake = selectHostedRuntimeWakeCandidate([
    createHostedRuntimeWakeCandidate(
      input.result.nextWakeAt ?? null,
      input.result.nextWakeReason ?? null,
    ),
    createHostedRuntimeWakeCandidate(input.wakeAt, input.reason),
  ]);
  if (
    selectedWake.at === input.result.nextWakeAt
    && selectedWake.reason === input.result.nextWakeReason
  ) {
    return;
  }

  input.result.nextWakeAt = selectedWake.at;
  input.result.nextWakeReason = selectedWake.reason;
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
): HostedWorkspaceCheckpointRequestSession {
  let expectedWorkspaceVersion: string | null = null;
  let latestMailboxImportSequence = 0;
  let latestWorkspaceMailboxImportSequence = 0;
  const mailboxPostCheckpointEffects: HostedMailboxPostCheckpointEffect[] = [];
  let conversationAssistantInputForConsumeAck = false;
  let conversationConsumedSeq: bigint | null = null;
  let latestMailboxImport: HostedMailboxImportCheckpointResult | null = null;
  let latestWorkspace: HostedWorkspaceState | null = null;
  let mailboxRetryAt: string | null = null;
  let runtimeStateDirty = false;

  return {
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
    hasConversationAssistantInputForConsumeAck() {
      return conversationAssistantInputForConsumeAck;
    },
    latestMailboxImport() {
      return latestMailboxImport;
    },
    latestMailboxImportCoveredByWorkspace() {
      return latestMailboxImportSequence === latestWorkspaceMailboxImportSequence;
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
    recordCheckpointResult(result) {
      latestMailboxImportSequence += 1;
      latestMailboxImport = result;
      mailboxRetryAt = selectHostedRuntimeWakeCandidate([
        createHostedRuntimeWakeCandidate(mailboxRetryAt, "mailbox"),
        createHostedRuntimeWakeCandidate(
          result.importResult.nextRetryAt ?? null,
          "mailbox",
        ),
      ]).at;
      conversationAssistantInputForConsumeAck ||= (
        result.importResult.assistantInputIds?.length ?? 0
      ) > 0;
      const importConsumedSeq = parseHostedConversationMailboxOptionalAckSeqOrNull(
        result.importResult.consumedSeqByLane?.conversation ?? null,
      );
      if (
        importConsumedSeq !== null
        && (conversationConsumedSeq === null || importConsumedSeq > conversationConsumedSeq)
      ) {
        conversationConsumedSeq = importConsumedSeq;
      }
      mailboxPostCheckpointEffects.push(...result.afterCheckpointEffects);
      if (result.checkpoint?.checkpointed === true) {
        checkpointRequestBuilder.recordCheckpoint?.(result.checkpoint);
        expectedWorkspaceVersion = result.checkpoint.workspace.version;
        latestWorkspace = result.checkpoint.workspace;
        latestWorkspaceMailboxImportSequence = latestMailboxImportSequence;
        runtimeStateDirty = false;
      }
    },
    recordWorkspaceCheckpoint(response) {
      if (response.checkpointed) {
        checkpointRequestBuilder.recordCheckpoint?.(response);
        expectedWorkspaceVersion = response.workspace.version;
        latestWorkspace = response.workspace;
        latestWorkspaceMailboxImportSequence = latestMailboxImportSequence;
        runtimeStateDirty = false;
      }
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

function mergeDeferredPostCheckpointWake(input: {
  assistantPhaseResult: HostedWorkspaceRunnerAssistantPhaseResult;
  postCheckpoint: HostedWorkspaceRunnerAssistantPhasePostCheckpoint;
}): boolean {
  if (input.assistantPhaseResult.progressed !== true) {
    return false;
  }

  if (!Object.hasOwn(input.postCheckpoint, "nextWakeAt")) {
    return false;
  }

  const previousWake = createHostedRuntimeWakeCandidate(
    input.assistantPhaseResult.nextWakeAt ?? null,
    input.assistantPhaseResult.nextWakeReason ?? null,
  );
  if (input.postCheckpoint.nextWakeAt === null || input.postCheckpoint.nextWakeAt === undefined) {
    input.assistantPhaseResult.nextWakeAt = null;
    input.assistantPhaseResult.nextWakeReason = null;
    return false;
  }

  const postCheckpointWake = createHostedRuntimeWakeCandidate(
    input.postCheckpoint.nextWakeAt ?? null,
    input.postCheckpoint.nextWakeReason ?? null,
  );
  const selectedWake = selectHostedRuntimeWakeCandidate([
    previousWake,
    postCheckpointWake,
  ]);
  input.assistantPhaseResult.nextWakeAt = selectedWake.at;
  input.assistantPhaseResult.nextWakeReason = selectedWake.reason;
  if (
    selectedWake.at !== postCheckpointWake.at
    || selectedWake.reason !== postCheckpointWake.reason
  ) {
    return false;
  }

  return selectedWake.at !== previousWake.at
    || selectedWake.reason !== previousWake.reason
    || postCheckpointWake.reason !== HOSTED_ASSISTANT_WAKE_REASON;
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
