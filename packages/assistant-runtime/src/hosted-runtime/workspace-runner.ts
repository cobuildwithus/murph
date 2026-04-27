import type {
  HostedRuntimeRedactedJson,
  HostedWorkspaceCheckpointReason,
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceCheckpointResponse,
  HostedWorkspaceState,
} from "@murphai/hosted-execution";
import type {
  AssistantTurnInputRefreshResult,
} from "@murphai/assistant-engine";

import {
  importHostedMailboxPrefixAndCheckpoint,
  type HostedMailboxImportCheckpointRequestInput,
  type HostedMailboxImportCheckpointResult,
} from "./mailbox-checkpoint.ts";
import type {
  HostedMailboxItemImportOutcome,
  HostedMailboxResolvedImportItem,
} from "./mailbox-import.ts";
import type {
  HostedRuntimeMailboxPort,
  HostedRuntimePlatform,
  HostedRuntimeWorkspacePort,
} from "./platform.ts";

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
  recordCheckpointResult(result: HostedMailboxImportCheckpointResult): void;
}

export interface HostedWorkspaceRunnerCheckpointRequestInput
  extends HostedMailboxImportCheckpointRequestInput {
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
  nextWakeAt?: string | null;
  progressed?: boolean;
}

export interface HostedWorkspaceRunnerInput {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestBuilder;
  expectedUserId: string;
  importItem(item: HostedMailboxResolvedImportItem): Promise<HostedMailboxItemImportOutcome>;
  limitPerLane: number;
  platform: HostedWorkspaceRunnerPlatform;
  requestId: string;
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
        nextWakeAt: metadata.nextWakeAt ?? null,
        nextWakeReason: metadata.nextWakeReason ?? null,
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
        nextWakeAt: input.metadata.nextWakeAt ?? null,
        nextWakeReason: input.metadata.nextWakeReason ?? null,
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
    };
  }

  const platform = withBeforeDeliveryMailboxRefresh({
    checkpointRequestBuilder: checkpointRequestSession,
    input,
    platform: input.platform,
  });
  const assistantPhaseResult = await input.runAssistantPhase({
    initialMailboxImport,
    platform,
    workspace: input.workspace,
  });

  return {
    assistantPhaseResult,
    initialMailboxImport,
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

function withBeforeDeliveryMailboxRefresh(input: {
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestSession;
  input: HostedWorkspaceRunnerInput;
  platform: HostedWorkspaceRunnerPlatform;
}): HostedRuntimePlatform {
  return {
    ...input.platform,
    refreshMailboxBeforeDelivery: async ({ requestId }) => {
      const result = await importHostedMailboxForWorkspaceRunner({
        checkpointRequestBuilder: input.checkpointRequestBuilder,
        checkpointReason: "before_delivery_refresh",
        input: input.input,
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
  requestId: string;
}): Promise<HostedMailboxImportCheckpointResult> {
  return importHostedMailboxPrefixAndCheckpoint({
    checkpointReason: input.checkpointReason,
    createCheckpointRequest: (requestInput) =>
      input.checkpointRequestBuilder.createRequest({
        ...requestInput,
        reason: input.checkpointReason,
      }),
    expectedUserId: input.input.expectedUserId,
    importItem: input.input.importItem,
    limitPerLane: input.input.limitPerLane,
    mailboxPort: input.input.platform.mailboxPort,
    now: input.input.now,
    requestId: input.requestId,
    vaultRoot: input.input.vaultRoot,
    workspacePort: input.input.platform.workspacePort,
  });
}

function createHostedWorkspaceCheckpointRequestSession(
  checkpointRequestBuilder: HostedWorkspaceCheckpointRequestBuilder,
): HostedWorkspaceCheckpointRequestSession {
  let expectedWorkspaceVersion: string | null = null;

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
    recordCheckpointResult(result) {
      if (result.checkpoint?.checkpointed === true) {
        expectedWorkspaceVersion = result.checkpoint.workspace.version;
      }
    },
  };
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
