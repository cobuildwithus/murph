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
  latestWorkspace(): HostedWorkspaceState | null;
  recordCheckpointResult(result: HostedMailboxImportCheckpointResult): void;
  recordWorkspaceCheckpoint(response: HostedWorkspaceCheckpointResponse): void;
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

export interface HostedWorkspaceRunnerInput {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestBuilder;
  expectedUserId: string;
  importItem(item: HostedMailboxResolvedImportItem): Promise<HostedMailboxItemImportOutcome>;
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
  const assistantPhaseResult = await input.runAssistantPhase({
    initialMailboxImport,
    platform,
    workspace: input.workspace,
  });
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
      const result = await importHostedMailboxForWorkspaceRunner({
        checkpointRequestBuilder: input.checkpointRequestBuilder,
        checkpointReason: "active_turn_input",
        input: input.input,
        lanes: ["conversation"],
        requestId,
      });
      input.checkpointRequestBuilder.recordCheckpointResult(result);

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

async function checkpointHostedWorkspacePostAssistantPhase(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestSession;
  expectedUserId: string;
  initialMailboxImport: HostedMailboxImportCheckpointResult;
  postCheckpoint: HostedWorkspaceRunnerAssistantPhasePostCheckpoint;
  workspacePort: HostedRuntimeWorkspacePort;
}): Promise<void> {
  const redactedStatus = buildHostedWorkspaceCheckpointRedactedStatus(
    input.initialMailboxImport,
    input.postCheckpoint.redactedStatus ?? {},
  );
  const checkpointRequest = await input.checkpointRequestBuilder.createRequest({
    importResult: input.initialMailboxImport.importResult,
    nextWakeAt: input.postCheckpoint.nextWakeAt ?? null,
    nextWakeReason: input.postCheckpoint.nextWakeReason ?? null,
    previousState: input.initialMailboxImport.state,
    reason: input.postCheckpoint.checkpointReason,
    redactedStatus,
    state: input.initialMailboxImport.state,
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
    latestWorkspace() {
      return latestWorkspace;
    },
    recordCheckpointResult(result) {
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
  };
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

  const redactedStatus = buildHostedWorkspaceCheckpointRedactedStatus(
    input.initialMailboxImport,
    input.assistantPhaseResult.redactedStatus ?? null,
  );
  const checkpointRequest = await input.checkpointRequestBuilder.createRequest({
    importResult: input.initialMailboxImport.importResult,
    nextWakeAt: input.assistantPhaseResult.nextWakeAt ?? null,
    nextWakeReason: input.assistantPhaseResult.nextWakeAt ? "assistant" : null,
    previousState: input.initialMailboxImport.state,
    reason: input.assistantPhaseResult.checkpointReason ?? "maintenance",
    redactedStatus,
    state: input.initialMailboxImport.state,
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
  const redactedStatus = buildHostedWorkspaceCheckpointRedactedStatus(
    input.initialMailboxImport,
    {
      acceptedInputCount: input.checkpointInput.acceptedInputIds.length,
      providerRequestOrdinal: input.checkpointInput.providerRequestOrdinal,
    },
  );
  const checkpointRequest = await input.checkpointRequestBuilder.createRequest({
    importResult: input.initialMailboxImport.importResult,
    nextWakeAt: null,
    nextWakeReason: null,
    previousState: input.initialMailboxImport.state,
    reason: "active_turn_acceptance",
    redactedStatus,
    state: input.initialMailboxImport.state,
  });
  const checkpoint = await input.workspacePort.checkpoint({
    ...checkpointRequest,
    nextWakeAt: null,
    nextWakeReason: null,
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
