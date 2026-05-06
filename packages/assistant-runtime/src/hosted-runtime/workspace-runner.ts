import {
  buildHostedExecutionSafeErrorDiagnostics,
} from "@murphai/hosted-execution";
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
  HostedMailboxPrefixPrefetch,
  HostedMailboxPostCheckpointEffect,
  HostedMailboxPostCheckpointEffectResult,
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
  toHostedRuntimeLogCode,
  writeHostedRuntimeLogBestEffort,
} from "./runtime-logs.ts";

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
  createRequest(
    input: HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
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

export interface HostedWorkspaceRunnerPlatform
  extends HostedRuntimePlatform {
  mailboxPort: HostedRuntimeMailboxPort;
  workspacePort: HostedRuntimeWorkspacePort;
}

export interface HostedWorkspaceRunnerAssistantPhaseInput {
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  now?: () => string;
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

export interface HostedWorkspaceRunnerInput {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestBuilder;
  expectedUserId: string;
  importItem(item: HostedMailboxResolvedImportItem): Promise<HostedMailboxItemImportOutcome>;
  initialMailboxImport?: HostedMailboxImportCheckpointResult | null;
  limitPerLane: number;
  platform: HostedWorkspaceRunnerPlatform;
  requestId: string;
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
        ...(Object.hasOwn(snapshot, "browserVaultReplicaRef")
          ? { browserVaultReplicaRef: snapshot.browserVaultReplicaRef ?? null }
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
        redactedStatus: cloneHostedRuntimeRedactedJson(requestInput.redactedStatus ?? null),
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
  const initialMailboxImport = input.initialMailboxImport
    ?? await importHostedMailboxForWorkspaceRunner({
      checkpointRequestBuilder: checkpointRequestSession,
      checkpointReason: "import",
      input,
      requestId: input.requestId,
    });
  checkpointRequestSession.recordCheckpointResult(initialMailboxImport);
  if (input.runAssistantPhase) {
    await runHostedMailboxPostCheckpointEffectsForPromptPreparationBestEffort({
      checkpointRequestBuilder: checkpointRequestSession,
      input,
      phase: "import",
    });
  }

  if (!input.runAssistantPhase) {
    await runHostedMailboxPostCheckpointEffectsAndLogBestEffort({
      checkpointRequestBuilder: checkpointRequestSession,
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

  const platform = withActiveTurnInputWorkspacePorts({
    initialMailboxImport,
    checkpointRequestBuilder: checkpointRequestSession,
    input,
    platform: input.platform,
  });
  const assistantPhaseInput = {
    initialMailboxImport,
    now: input.now,
    platform,
    workspace: input.workspace,
  };
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
    await checkpointHostedWorkspaceDeferredMailboxImportIfNeeded({
      checkpointRequestBuilder: checkpointRequestSession,
      expectedUserId: input.expectedUserId,
      initialMailboxImport,
      workspacePort: input.platform.workspacePort,
    });
    if (assistantPhaseResult.afterCheckpoint && assistantPhaseResult.progressed !== true) {
      throw new TypeError("Hosted workspace assistant phase afterCheckpoint requires a committed checkpoint.");
    }
    let postCheckpoint: HostedWorkspaceRunnerAssistantPhasePostCheckpoint | null | void;
    try {
      postCheckpoint = await assistantPhaseResult.afterCheckpoint?.();
    } catch (error) {
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
          expectedUserId: input.expectedUserId,
          initialMailboxImport,
          postCheckpoint,
          workspacePort: input.platform.workspacePort,
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
    await runHostedMailboxPostCheckpointEffectsAndLogBestEffort({
      checkpointRequestBuilder: checkpointRequestSession,
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
      if (input.initialMailboxImport.importResult.nextRetryAt) {
        return {
          progressed: false,
          reason: "source_unavailable",
        };
      }

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
      await runHostedMailboxPostCheckpointEffectsForPromptPreparationBestEffort({
        checkpointRequestBuilder: input.checkpointRequestBuilder,
        input: input.input,
        phase: "active_turn_input",
      });

      return summarizeMailboxRefreshResult(result);
    },
  };
}

export async function importHostedMailboxForWorkspaceRunner(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestBuilder;
  checkpointReason: HostedWorkspaceCheckpointReason;
  deferCheckpoint?: boolean;
  input: HostedWorkspaceRunnerInput;
  lanes?: readonly ("conversation" | "system")[];
  prefetch?: HostedMailboxPrefixPrefetch | null;
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
    deferCheckpoint: input.deferCheckpoint === true,
    expectedUserId: input.input.expectedUserId,
    importItem: input.input.importItem,
    lanes: input.lanes,
    limitPerLane: input.input.limitPerLane,
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
        checkpointDeferred: input.result.checkpointDeferred,
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

async function writeHostedWorkspaceAssistantPostCheckpointFailureRuntimeLog(context: {
  error: unknown;
  errorCode: "assistant_after_checkpoint_checkpoint_failed" | "assistant_after_checkpoint_failed";
  input: HostedWorkspaceRunnerInput;
}): Promise<void> {
  const failure = buildHostedMailboxPostCheckpointEffectFailureLog(context.error);
  console.warn("Hosted assistant post-checkpoint cleanup failed after durable checkpoint.", {
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
        checkpointed: true,
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

function createHostedWorkspaceCheckpointRequestSession(
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestBuilder,
): HostedWorkspaceCheckpointRequestSession {
  let expectedWorkspaceVersion: string | null = null;
  const mailboxPostCheckpointEffects: HostedMailboxPostCheckpointEffect[] = [];
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
      const result = await effect();
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
      level: result.failed > 0 || result.partial > 0 ? "warn" : "info",
      phase: "import",
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

async function runHostedMailboxPostCheckpointEffectsForPromptPreparationBestEffort(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestSession;
  input: HostedWorkspaceRunnerInput;
  phase: "active_turn_input" | "import";
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

async function checkpointHostedWorkspaceDeferredMailboxImportIfNeeded(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestSession;
  expectedUserId: string;
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  workspacePort: HostedRuntimeWorkspacePort;
}): Promise<void> {
  if (
    !input.initialMailboxImport.checkpointDeferred
    || input.checkpointRequestBuilder.latestWorkspace()
  ) {
    return;
  }

  const redactedStatus = buildHostedWorkspaceCheckpointRedactedStatus(
    input.initialMailboxImport,
    {
      hostedMailboxImportCheckpointDeferred: true,
    },
  );
  const checkpointRequest = await input.checkpointRequestBuilder.createRequest({
    importResult: input.initialMailboxImport.importResult,
    nextWakeAt: null,
    nextWakeReason: null,
    previousState: input.initialMailboxImport.previousState,
    reason: "import",
    redactedStatus,
    state: input.initialMailboxImport.state,
  });
  const checkpoint = await input.workspacePort.checkpoint({
    ...checkpointRequest,
    nextWakeAt: null,
    nextWakeReason: null,
    reason: "import",
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
  value: HostedRuntimeRedactedJson | null,
): HostedRuntimeRedactedJson | null {
  return value ? { ...value } : null;
}
