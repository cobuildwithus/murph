import type {
  HostedRuntimeRedactedJson,
  HostedWorkspaceCheckpointReason,
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceCheckpointResponse,
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import type {
  AssistantTurnInputRefreshResult,
} from "@murphai/assistant-engine";
import type {
  HostedPendingAssistantUsageExportResult,
} from "./usage.ts";

import {
  buildHostedMailboxImportRedactedStatus,
  HostedMailboxImportCheckpointConflictError,
  HostedMailboxImportCheckpointUserMismatchError,
  importHostedMailboxPrefixAndCheckpoint,
  type HostedMailboxImportCheckpointRequestInput,
  type HostedMailboxImportCheckpointResult,
} from "./mailbox-checkpoint.ts";
import type {
  HostedMailboxItemImportOutcome,
  HostedMailboxResolvedImportItem,
} from "./mailbox-import.ts";
import type {
  HostedRuntimeActiveTurnInputCheckpointInput,
  HostedRuntimeMailboxPort,
  HostedRuntimePlatform,
  HostedRuntimeWorkspacePort,
} from "./platform.ts";
import {
  buildHostedRuntimeLogContextFields,
  compactHostedRuntimeLogCodes,
  type HostedRuntimeLogContext,
  writeHostedRuntimeLogBestEffort,
} from "./runtime-logs.ts";
import {
  exportHostedPendingAssistantUsage,
} from "./usage.ts";

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
  leaseGeneration: string;
  nextWakeAt?: string | null;
  nextWakeReason?: string | null;
}

export interface HostedWorkspaceSnapshotCheckpointResult {
  browserVaultReplicaRef?: HostedWorkspaceCheckpointRequest["browserVaultReplicaRef"];
  snapshotRef: HostedWorkspaceCheckpointRequest["snapshotRef"];
}

export type HostedWorkspaceSnapshotCheckpointRequestBuilderInput =
  HostedWorkspaceRunnerCheckpointRequestInput;

export type HostedWorkspaceSnapshotCheckpointBuilder = (
  input: HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
) => Promise<HostedWorkspaceSnapshotCheckpointResult> | HostedWorkspaceSnapshotCheckpointResult;

export interface HostedWorkspaceCheckpointRequestBuilder {
  createRequest(
    input: HostedWorkspaceRunnerCheckpointRequestInput,
  ): Promise<HostedWorkspaceCheckpointRequest> | HostedWorkspaceCheckpointRequest;
}

interface HostedWorkspaceCheckpointRequestSession
  extends HostedWorkspaceCheckpointRequestBuilder {
  latestMailboxImport(): HostedMailboxImportCheckpointResult | null;
  latestWorkspace(): HostedWorkspaceState | null;
  recordCheckpointResult(result: HostedMailboxImportCheckpointResult): void;
  recordWorkspaceCheckpoint(response: HostedWorkspaceCheckpointResponse): void;
  takeMailboxPostCheckpointEffects(): readonly HostedMailboxPostCheckpointEffect[];
}

export interface HostedWorkspaceRunnerCheckpointRequestInput
  extends HostedMailboxImportCheckpointRequestInput {
  nextWakeAt?: string | null;
  nextWakeReason?: string | null;
  reason: HostedWorkspaceCheckpointReason;
}

export interface HostedWorkspaceRunnerPlatform
  extends HostedRuntimePlatform {
  mailboxPort: HostedRuntimeMailboxPort;
  workspacePort: HostedRuntimeWorkspacePort;
}

export interface HostedWorkspaceRunnerAssistantPhaseInput {
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  platform: HostedRuntimePlatform;
  workspace: HostedWorkspaceState | null;
}

export interface HostedWorkspaceRunnerAssistantPhaseResult {
  afterCheckpoint?: (() => Promise<HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null | void>) | null;
  checkpointReason?: HostedWorkspaceCheckpointReason;
  nextWakeAt?: string | null;
  progressed?: boolean;
  redactedStatus?: HostedRuntimeRedactedJson | null;
}

export interface HostedWorkspaceRunnerAssistantPhasePostCheckpoint {
  checkpointReason: HostedWorkspaceCheckpointReason;
  nextWakeAt?: string | null;
  nextWakeReason?: string | null;
  redactedStatus?: HostedRuntimeRedactedJson | null;
}

export interface HostedWorkspaceRunnerEnrichmentWarmupResult {
  elapsedMs: number;
  errorCode: string | null;
  ok: boolean;
  rebuiltCaptures: number | null;
  timedOut: boolean;
}

export interface HostedWorkspaceRunnerInput {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestBuilder;
  expectedUserId: string;
  importItem(item: HostedMailboxResolvedImportItem): Promise<HostedMailboxItemImportOutcome>;
  limitPerLane: number;
  platform: HostedWorkspaceRunnerPlatform;
  requestId: string;
  runtimeLogContext?: HostedRuntimeLogContext | null;
  prepareAssistantEnrichment?: (
    input: HostedWorkspaceRunnerAssistantPhaseInput,
  ) => Promise<HostedWorkspaceRunnerEnrichmentWarmupResult | null | void>;
  runAssistantPhase?: (
    input: HostedWorkspaceRunnerAssistantPhaseInput,
  ) => Promise<HostedWorkspaceRunnerAssistantPhaseResult>;
  vaultRoot: string;
  workspace: HostedWorkspaceState | null;
  now?: () => string;
}

type HostedMailboxPostCheckpointEffect = () => Promise<void>;

interface HostedMailboxPostCheckpointEffectsResult {
  attempted: boolean;
  errorCodes: readonly string[];
  failed: number;
  succeeded: number;
}

export interface HostedWorkspaceRunnerResult {
  assistantPhaseResult: HostedWorkspaceRunnerAssistantPhaseResult | null;
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  latestWorkspace: HostedWorkspaceState | null;
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
        ...(metadata.browserVaultReplicaRef
          ? { browserVaultReplicaRef: metadata.browserVaultReplicaRef }
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
        redactedStatus: cloneHostedRuntimeRedactedJson(input.redactedStatus),
        snapshotRef: metadata.snapshotRef,
      };
    },
  };
}

export function createHostedWorkspaceSnapshotCheckpointRequestBuilder(input: {
  createSnapshot: HostedWorkspaceSnapshotCheckpointBuilder;
  metadata: HostedWorkspaceSnapshotCheckpointMetadata;
}): HostedWorkspaceCheckpointRequestBuilder {
  return {
    async createRequest(requestInput) {
      const snapshot = await input.createSnapshot(requestInput);
      return {
        attemptId: input.metadata.attemptId,
        ...(snapshot.browserVaultReplicaRef
          ? { browserVaultReplicaRef: snapshot.browserVaultReplicaRef }
          : {}),
        expectedWorkspaceVersion: input.metadata.expectedWorkspaceVersion,
        leaseGeneration: input.metadata.leaseGeneration,
        nextWakeAt: Object.hasOwn(requestInput, "nextWakeAt")
          ? requestInput.nextWakeAt ?? null
          : input.metadata.nextWakeAt ?? null,
        nextWakeReason: Object.hasOwn(requestInput, "nextWakeReason")
          ? requestInput.nextWakeReason ?? null
          : input.metadata.nextWakeReason ?? null,
        reason: requestInput.reason,
        redactedStatus: cloneHostedRuntimeRedactedJson(requestInput.redactedStatus),
        snapshotRef: snapshot.snapshotRef,
      };
    },
  };
}

export async function runHostedWorkspaceUntilIdleOrBudget(
  input: HostedWorkspaceRunnerInput,
): Promise<HostedWorkspaceRunnerResult> {
  assertHostedWorkspaceRunnerUser(input);

  const checkpointRequestSession = createHostedWorkspaceCheckpointRequestSession(
    input.checkpointRequestBuilder,
  );
  const initialMailboxImport = await importHostedMailboxForWorkspaceRunner({
    checkpointRequestBuilder: checkpointRequestSession,
    checkpointReason: "import",
    input,
    requestId: input.requestId,
  });
  checkpointRequestSession.recordCheckpointResult(initialMailboxImport);

  if (!input.runAssistantPhase) {
    await drainHostedWorkspaceUsageExportBestEffort({
      checkpointRequestBuilder: checkpointRequestSession,
      expectedUserId: input.expectedUserId,
      initialMailboxImport,
      input,
    });
    await runHostedMailboxPostCheckpointEffectsAndCheckpointBestEffort({
      checkpointRequestBuilder: checkpointRequestSession,
      expectedUserId: input.expectedUserId,
      initialMailboxImport,
      input,
    });
    return {
      assistantPhaseResult: null,
      initialMailboxImport,
      latestWorkspace: checkpointRequestSession.latestWorkspace()
        ?? initialMailboxImport.checkpoint?.workspace
        ?? input.workspace,
    };
  }

  await runHostedMailboxPostCheckpointEffectsAndCheckpointBestEffort({
    checkpointRequestBuilder: checkpointRequestSession,
    expectedUserId: input.expectedUserId,
    initialMailboxImport,
    input,
  });

  const platform = withActiveTurnInputWorkspacePorts({
    initialMailboxImport,
    checkpointRequestBuilder: checkpointRequestSession,
    input,
    platform: input.platform,
  });
  const assistantPhaseInput = {
    initialMailboxImport,
    platform,
    workspace: input.workspace,
  };
  await runHostedAssistantEnrichmentWarmupBestEffort({
    assistantPhaseInput,
    input,
  });
  let assistantPhaseResult: HostedWorkspaceRunnerAssistantPhaseResult;
  try {
    assistantPhaseResult = await input.runAssistantPhase(assistantPhaseInput);
    await checkpointHostedWorkspaceAssistantPhase({
      assistantPhaseResult,
      checkpointRequestBuilder: checkpointRequestSession,
      expectedUserId: input.expectedUserId,
      initialMailboxImport,
      workspacePort: input.platform.workspacePort,
    });
    if (assistantPhaseResult.afterCheckpoint && assistantPhaseResult.progressed !== true) {
      throw new TypeError("Hosted workspace assistant phase afterCheckpoint requires a committed checkpoint.");
    }
    const postCheckpoint = await assistantPhaseResult.afterCheckpoint?.();
    if (postCheckpoint) {
      await checkpointHostedWorkspacePostAssistantPhase({
        checkpointRequestBuilder: checkpointRequestSession,
        expectedUserId: input.expectedUserId,
        initialMailboxImport,
        postCheckpoint,
        workspacePort: input.platform.workspacePort,
      });
    }
    await drainHostedWorkspaceUsageExportBestEffort({
      checkpointRequestBuilder: checkpointRequestSession,
      expectedUserId: input.expectedUserId,
      initialMailboxImport,
      input,
    });
    await runHostedMailboxPostCheckpointEffectsAndCheckpointBestEffort({
      checkpointRequestBuilder: checkpointRequestSession,
      expectedUserId: input.expectedUserId,
      initialMailboxImport,
      input,
    });
  } catch (error) {
    await runHostedMailboxPostCheckpointEffectsBestEffort(
      checkpointRequestSession.takeMailboxPostCheckpointEffects(),
    );
    throw error;
  }

  return {
    assistantPhaseResult,
    initialMailboxImport,
    latestWorkspace: checkpointRequestSession.latestWorkspace()
      ?? initialMailboxImport.checkpoint?.workspace
      ?? input.workspace,
  };
}

async function drainHostedWorkspaceUsageExportBestEffort(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestSession;
  expectedUserId: string;
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  input: HostedWorkspaceRunnerInput;
}): Promise<void> {
  if (!input.checkpointRequestBuilder.latestWorkspace()) {
    return;
  }

  let result: HostedPendingAssistantUsageExportResult;
  try {
    result = await exportHostedPendingAssistantUsage({
      now: input.input.now,
      usageExportPort: input.input.platform.usageExportPort,
      vaultRoot: input.input.vaultRoot,
    });
  } catch (error) {
    console.warn("Hosted AI usage export failed after checkpoint; leaving pending records for retry.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    await writeHostedWorkspaceUsageExportRuntimeLog({
      checkpointed: false,
      errorCode: "usage_export_failed",
      level: "warn",
      result: {
        exported: 0,
        failed: 1,
        invalid: 0,
        invalidIssueRecorded: false,
        pending: 0,
      },
      runnerInput: input.input,
    });
    return;
  }

  if (
    result.exported === 0
    && result.failed === 0
    && result.invalid === 0
    && !result.invalidIssueRecorded
    && result.pending === 0
  ) {
    return;
  }

  let checkpointed = false;
  let errorCode: string | null = null;
  if (result.exported > 0 || result.invalidIssueRecorded) {
    try {
      await checkpointHostedWorkspaceUsageExportCleanup({
        checkpointRequestBuilder: input.checkpointRequestBuilder,
        expectedUserId: input.expectedUserId,
        initialMailboxImport: input.initialMailboxImport,
        result,
        workspacePort: input.input.platform.workspacePort,
      });
      checkpointed = true;
    } catch (error) {
      errorCode = "usage_cleanup_checkpoint_failed";
      console.warn("Hosted AI usage cleanup checkpoint failed; assistant work remains committed.", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  await writeHostedWorkspaceUsageExportRuntimeLog({
    checkpointed,
    errorCode,
    level: result.failed > 0 || result.invalid > 0 || result.pending > 0 || errorCode
      ? "warn"
      : "info",
    result,
    runnerInput: input.input,
  });
}

async function runHostedAssistantEnrichmentWarmupBestEffort(input: {
  assistantPhaseInput: HostedWorkspaceRunnerAssistantPhaseInput;
  input: HostedWorkspaceRunnerInput;
}): Promise<void> {
  if (!input.input.prepareAssistantEnrichment) {
    return;
  }

  let result: HostedWorkspaceRunnerEnrichmentWarmupResult | null | void;
  try {
    result = await input.input.prepareAssistantEnrichment(input.assistantPhaseInput);
  } catch (error) {
    console.warn("Hosted assistant enrichment warmup failed before assistant phase; continuing.", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
    await writeHostedAssistantEnrichmentWarmupRuntimeLog({
      result: {
        elapsedMs: 0,
        errorCode: readHostedWorkspaceRunnerSafeErrorCode(error),
        ok: false,
        rebuiltCaptures: null,
        timedOut: false,
      },
      runnerInput: input.input,
    });
    return;
  }

  if (!result) {
    return;
  }

  await writeHostedAssistantEnrichmentWarmupRuntimeLog({
    result,
    runnerInput: input.input,
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

function withActiveTurnInputWorkspacePorts(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestSession;
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  input: HostedWorkspaceRunnerInput;
  platform: HostedWorkspaceRunnerPlatform;
}): HostedRuntimePlatform {
  return {
    ...input.platform,
    checkpointActiveTurnInput: async (checkpointInput) => {
      await checkpointHostedWorkspaceActiveTurnInputAcceptance({
        checkpointInput,
        checkpointRequestBuilder: input.checkpointRequestBuilder,
        expectedUserId: input.input.expectedUserId,
        initialMailboxImport: input.initialMailboxImport,
        workspacePort: input.input.platform.workspacePort,
      });
    },
    refreshMailboxForActiveTurnInput: async ({ requestId }) => {
      const result = await importHostedMailboxForWorkspaceRunner({
        checkpointRequestBuilder: input.checkpointRequestBuilder,
        checkpointReason: "active_turn_input",
        input: input.input,
        lanes: ["conversation"],
        requestId,
      });
      if (shouldRecordHostedActiveTurnMailboxRefreshResult(result)) {
        input.checkpointRequestBuilder.recordCheckpointResult(result);
      }

      return summarizeMailboxRefreshResult(result);
    },
  };
}

async function importHostedMailboxForWorkspaceRunner(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestBuilder;
  checkpointReason: HostedWorkspaceCheckpointReason;
  input: HostedWorkspaceRunnerInput;
  lanes?: readonly ("conversation" | "system")[];
  requestId: string;
}): Promise<HostedMailboxImportCheckpointResult> {
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
    expectedUserId: input.input.expectedUserId,
    importItem: input.input.importItem,
    lanes: input.lanes,
    limitPerLane: input.input.limitPerLane,
    mailboxPort: input.input.platform.mailboxPort,
    now: input.input.now,
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
  if (
    input.checkpointReason === "active_turn_input"
    && !shouldRecordHostedActiveTurnMailboxRefreshResult(input.result)
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
        blockCodes: compactHostedRuntimeLogCodes(blocked.map((item) => item.reasonCode)),
        blockedCount: blocked.length,
        checkpointed: input.result.checkpoint?.checkpointed ?? false,
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

async function writeHostedWorkspaceUsageExportRuntimeLog(input: {
  checkpointed: boolean;
  errorCode: string | null;
  level: "info" | "warn";
  result: HostedPendingAssistantUsageExportResult;
  runnerInput: HostedWorkspaceRunnerInput;
}): Promise<void> {
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields(input.runnerInput.runtimeLogContext),
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      component: "runtime",
      eventCode: "runtime.usage_export_finished",
      level: input.level,
      phase: "checkpoint",
      redactedJson: {
        cleanupCheckpointed: input.checkpointed,
        exported: input.result.exported,
        failed: input.result.failed,
        invalid: input.result.invalid,
        pending: input.result.pending,
      },
    },
    now: input.runnerInput.now,
    platform: input.runnerInput.platform,
  });
}

async function writeHostedAssistantEnrichmentWarmupRuntimeLog(input: {
  result: HostedWorkspaceRunnerEnrichmentWarmupResult;
  runnerInput: HostedWorkspaceRunnerInput;
}): Promise<void> {
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields(input.runnerInput.runtimeLogContext),
      ...(input.result.errorCode ? { errorCode: input.result.errorCode } : {}),
      component: "runtime",
      eventCode: "runtime.inbox_enrichment_warmup_finished",
      level: input.result.ok ? "info" : "warn",
      phase: "invoke",
      redactedJson: {
        elapsedMs: input.result.elapsedMs,
        ok: input.result.ok,
        rebuiltCaptures: input.result.rebuiltCaptures,
        timedOut: input.result.timedOut,
      },
    },
    now: input.runnerInput.now,
    platform: input.runnerInput.platform,
  });
}

function readHostedWorkspaceRunnerSafeErrorCode(error: unknown): string {
  if (
    typeof error === "object"
    && error !== null
    && "code" in error
    && typeof error.code === "string"
  ) {
    return toHostedWorkspaceRunnerSafeErrorCode(error.code);
  }

  if (error instanceof Error && error.name) {
    return toHostedWorkspaceRunnerSafeErrorCode(error.name);
  }

  return "unknown";
}

function toHostedWorkspaceRunnerSafeErrorCode(value: string): string {
  const normalized = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u.test(normalized)
    ? normalized
    : "unknown";
}

function shouldRecordHostedActiveTurnMailboxRefreshResult(
  result: HostedMailboxImportCheckpointResult,
): boolean {
  return (
    result.stateChanged
    || result.importResult.importedCount > 0
    || result.importResult.blocked.length > 0
  );
}

async function checkpointHostedWorkspacePostAssistantPhase(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestSession;
  expectedUserId: string;
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  postCheckpoint: HostedWorkspaceRunnerAssistantPhasePostCheckpoint;
  workspacePort: HostedRuntimeWorkspacePort;
}): Promise<void> {
  const mailboxImport =
    input.checkpointRequestBuilder.latestMailboxImport() ?? input.initialMailboxImport;
  const redactedStatus = buildHostedWorkspaceCheckpointRedactedStatus(
    mailboxImport,
    input.postCheckpoint.redactedStatus ?? {},
  );
  const checkpointRequest = await input.checkpointRequestBuilder.createRequest({
    importResult: mailboxImport.importResult,
    nextWakeAt: input.postCheckpoint.nextWakeAt ?? null,
    nextWakeReason: input.postCheckpoint.nextWakeReason ?? null,
    previousState: mailboxImport.state,
    reason: input.postCheckpoint.checkpointReason,
    redactedStatus,
    state: mailboxImport.state,
  });
  const checkpoint = await input.workspacePort.checkpoint({
    ...checkpointRequest,
    nextWakeAt: input.postCheckpoint.nextWakeAt ?? null,
    nextWakeReason: input.postCheckpoint.nextWakeReason ?? null,
    reason: input.postCheckpoint.checkpointReason,
    redactedStatus,
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

  input.checkpointRequestBuilder.recordWorkspaceCheckpoint(checkpoint);
}

async function checkpointHostedWorkspaceUsageExportCleanup(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestSession;
  expectedUserId: string;
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  result: HostedPendingAssistantUsageExportResult;
  workspacePort: HostedRuntimeWorkspacePort;
}): Promise<void> {
  const latestWorkspace = input.checkpointRequestBuilder.latestWorkspace();
  if (!latestWorkspace) {
    return;
  }

  const mailboxImport =
    input.checkpointRequestBuilder.latestMailboxImport() ?? input.initialMailboxImport;
  const redactedStatus = buildHostedWorkspaceCheckpointRedactedStatus(
    mailboxImport,
    {
      hostedUsageCleanupCheckpoint: input.result.exported > 0,
      hostedUsageExportCheckpoint: true,
      hostedUsageExportedCount: input.result.exported,
      hostedUsageFailedCount: input.result.failed,
      hostedUsageInvalidCount: input.result.invalid,
      hostedUsageInvalidIssueRecorded: input.result.invalidIssueRecorded,
      hostedUsagePendingCount: input.result.pending,
    },
  );
  const checkpointRequest = await input.checkpointRequestBuilder.createRequest({
    importResult: mailboxImport.importResult,
    ...hostedWorkspaceScheduledWake(latestWorkspace),
    previousState: mailboxImport.state,
    reason: "maintenance",
    redactedStatus,
    state: mailboxImport.state,
  });
  const checkpoint = await input.workspacePort.checkpoint({
    ...checkpointRequest,
    ...hostedWorkspaceScheduledWake(latestWorkspace),
    reason: "maintenance",
    redactedStatus,
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

  input.checkpointRequestBuilder.recordWorkspaceCheckpoint(checkpoint);
}

async function checkpointHostedWorkspaceMailboxPostCheckpointEffects(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestSession;
  expectedUserId: string;
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  workspacePort: HostedRuntimeWorkspacePort;
}): Promise<void> {
  const latestWorkspace = input.checkpointRequestBuilder.latestWorkspace();
  if (!latestWorkspace) {
    return;
  }

  const mailboxImport =
    input.checkpointRequestBuilder.latestMailboxImport() ?? input.initialMailboxImport;
  const redactedStatus = buildHostedWorkspaceCheckpointRedactedStatus(
    mailboxImport,
    {
      hostedMailboxProjectionCheckpoint: true,
    },
  );
  const checkpointRequest = await input.checkpointRequestBuilder.createRequest({
    importResult: mailboxImport.importResult,
    ...hostedWorkspaceScheduledWake(latestWorkspace),
    previousState: mailboxImport.state,
    reason: "maintenance",
    redactedStatus,
    state: mailboxImport.state,
  });
  const checkpoint = await input.workspacePort.checkpoint({
    ...checkpointRequest,
    ...hostedWorkspaceScheduledWake(latestWorkspace),
    reason: "maintenance",
    redactedStatus,
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

  input.checkpointRequestBuilder.recordWorkspaceCheckpoint(checkpoint);
}

function createHostedWorkspaceCheckpointRequestSession(
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestBuilder,
): HostedWorkspaceCheckpointRequestSession {
  let expectedWorkspaceVersion: string | null = null;
  const mailboxPostCheckpointEffects: Array<() => Promise<void>> = [];
  let latestMailboxImport: HostedMailboxImportCheckpointResult | null = null;
  let latestWorkspace: HostedWorkspaceState | null = null;

  return {
    createRequest(input) {
      const request = checkpointRequestBuilder.createRequest(input);
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
    latestMailboxImport() {
      return latestMailboxImport;
    },
    latestWorkspace() {
      return latestWorkspace;
    },
    recordCheckpointResult(result) {
      latestMailboxImport = result;
      mailboxPostCheckpointEffects.push(...result.afterCheckpointEffects);
      if (result.checkpoint?.checkpointed === true) {
        expectedWorkspaceVersion = result.checkpoint.workspace.version;
        latestWorkspace = result.checkpoint.workspace;
      }
    },
    recordWorkspaceCheckpoint(response) {
      if (response.checkpointed) {
        expectedWorkspaceVersion = response.workspace.version;
        latestWorkspace = response.workspace;
      }
    },
    takeMailboxPostCheckpointEffects() {
      return mailboxPostCheckpointEffects.splice(0);
    },
  };
}

async function runHostedMailboxPostCheckpointEffectsBestEffort(
  effects: readonly HostedMailboxPostCheckpointEffect[],
): Promise<HostedMailboxPostCheckpointEffectsResult> {
  const errorCodes: string[] = [];
  let failed = 0;
  let succeeded = 0;
  for (const effect of effects) {
    try {
      await effect();
      succeeded += 1;
    } catch {
      // Mailbox post-checkpoint effects are enrichment only. They must not roll
      // back durable mailbox or assistant checkpoints.
      failed += 1;
      errorCodes.push("post_checkpoint_effect_failed");
    }
  }
  return {
    attempted: effects.length > 0,
    errorCodes,
    failed,
    succeeded,
  };
}

async function runHostedMailboxPostCheckpointEffectsAndCheckpointBestEffort(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestSession;
  expectedUserId: string;
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  input: HostedWorkspaceRunnerInput;
}): Promise<void> {
  const effects = input.checkpointRequestBuilder.takeMailboxPostCheckpointEffects();
  if (effects.length === 0) {
    return;
  }

  const result = await runHostedMailboxPostCheckpointEffectsBestEffort(effects);
  if (!result.attempted) {
    return;
  }
  await writeHostedRuntimeLogBestEffort({
    entry: {
      ...buildHostedRuntimeLogContextFields(input.input.runtimeLogContext),
      component: "mailbox",
      eventCode: "mailbox.post_checkpoint_effects_finished",
      level: result.failed > 0 ? "warn" : "info",
      phase: "import",
      redactedJson: {
        attemptedCount: effects.length,
        errorCodes: compactHostedRuntimeLogCodes(result.errorCodes),
        failedCount: result.failed,
        succeededCount: result.succeeded,
      },
    },
    now: input.input.now,
    platform: input.input.platform,
  });

  try {
    await checkpointHostedWorkspaceMailboxPostCheckpointEffects({
      checkpointRequestBuilder: input.checkpointRequestBuilder,
      expectedUserId: input.expectedUserId,
      initialMailboxImport: input.initialMailboxImport,
      workspacePort: input.input.platform.workspacePort,
    });
  } catch {
    // Projection checkpoints are best-effort. Assistant input and mailbox
    // watermarks are already durable by the time these effects run.
  }
}

async function checkpointHostedWorkspaceAssistantPhase(input: {
  assistantPhaseResult: HostedWorkspaceRunnerAssistantPhaseResult;
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestSession;
  expectedUserId: string;
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  workspacePort: HostedRuntimeWorkspacePort;
}): Promise<void> {
  if (!shouldCheckpointHostedWorkspaceAssistantPhase(input.assistantPhaseResult)) {
    return;
  }

  const mailboxImport =
    input.checkpointRequestBuilder.latestMailboxImport() ?? input.initialMailboxImport;
  const redactedStatus = buildHostedWorkspaceCheckpointRedactedStatus(
    mailboxImport,
    input.assistantPhaseResult.redactedStatus ?? null,
  );
  const checkpointRequest = await input.checkpointRequestBuilder.createRequest({
    importResult: mailboxImport.importResult,
    nextWakeAt: input.assistantPhaseResult.nextWakeAt ?? null,
    nextWakeReason: input.assistantPhaseResult.nextWakeAt ? "assistant" : null,
    previousState: mailboxImport.state,
    reason: input.assistantPhaseResult.checkpointReason ?? "maintenance",
    redactedStatus,
    state: mailboxImport.state,
  });
  const checkpoint = await input.workspacePort.checkpoint({
    ...checkpointRequest,
    nextWakeAt: input.assistantPhaseResult.nextWakeAt ?? null,
    nextWakeReason: input.assistantPhaseResult.nextWakeAt ? "assistant" : null,
    reason: input.assistantPhaseResult.checkpointReason ?? "maintenance",
    redactedStatus,
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

  input.checkpointRequestBuilder.recordWorkspaceCheckpoint(checkpoint);
}

async function checkpointHostedWorkspaceActiveTurnInputAcceptance(input: {
  checkpointInput: HostedRuntimeActiveTurnInputCheckpointInput;
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestSession;
  expectedUserId: string;
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  workspacePort: HostedRuntimeWorkspacePort;
}): Promise<void> {
  const mailboxImport =
    input.checkpointRequestBuilder.latestMailboxImport() ?? input.initialMailboxImport;
  const latestWorkspace =
    input.checkpointRequestBuilder.latestWorkspace()
    ?? input.initialMailboxImport.checkpoint?.workspace
    ?? null;
  const preservedWake = latestWorkspace ? hostedWorkspaceScheduledWake(latestWorkspace) : {};
  const redactedStatus = buildHostedWorkspaceCheckpointRedactedStatus(
    mailboxImport,
    {
      acceptedInputCount: input.checkpointInput.acceptedInputIds.length,
      providerRequestOrdinal: input.checkpointInput.providerRequestOrdinal,
    },
  );
  const checkpointRequest = await input.checkpointRequestBuilder.createRequest({
    importResult: mailboxImport.importResult,
    ...preservedWake,
    previousState: mailboxImport.state,
    reason: "active_turn_acceptance",
    redactedStatus,
    state: mailboxImport.state,
  });
  const checkpoint = await input.workspacePort.checkpoint({
    ...checkpointRequest,
    reason: "active_turn_acceptance",
    redactedStatus,
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

  input.checkpointRequestBuilder.recordWorkspaceCheckpoint(checkpoint);
}

function buildHostedWorkspaceCheckpointRedactedStatus(
  initialMailboxImport: HostedMailboxImportCheckpointResult,
  redactedStatus: HostedRuntimeRedactedJson | null,
): HostedRuntimeRedactedJson {
  return {
    ...buildHostedMailboxImportRedactedStatus(initialMailboxImport.importResult),
    ...(redactedStatus ?? {}),
  };
}

function hostedWorkspaceScheduledWake(
  workspace: Pick<HostedWorkspaceState, "nextWakeAt" | "nextWakeReason">,
): {
  nextWakeAt: string | null;
  nextWakeReason: string | null;
} {
  return {
    nextWakeAt: workspace.nextWakeAt ?? null,
    nextWakeReason: workspace.nextWakeReason ?? null,
  };
}

function shouldCheckpointHostedWorkspaceAssistantPhase(
  result: HostedWorkspaceRunnerAssistantPhaseResult,
): boolean {
  return result.progressed === true;
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

function summarizeMailboxRefreshResult(
  result: HostedMailboxImportCheckpointResult,
): AssistantTurnInputRefreshResult {
  if (result.importResult.importedCount > 0) {
    return {
      progressed: true,
      reason: "ingested_input",
    };
  }

  if (result.importResult.blocked.some((item) => item.retryable)) {
    return {
      progressed: false,
      reason: "source_unavailable",
    };
  }

  if (result.stateChanged) {
    return {
      progressed: true,
      reason: "ingested_input",
    };
  }

  return {
    progressed: false,
    reason: "no_new_input",
  };
}

function cloneHostedRuntimeRedactedJson(
  value: HostedRuntimeRedactedJson,
): HostedRuntimeRedactedJson {
  return { ...value };
}
