import type {
  HostedMailboxLane,
  HostedRuntimeRedactedJson,
  HostedWorkspaceCheckpointReason,
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceCheckpointResponse,
} from "@murphai/hosted-execution";

import {
  fetchAndProcessHostedMailboxPrefix,
  type HostedMailboxImportLoopResult,
  type HostedMailboxResolvedImportItem,
  type HostedMailboxItemImportOutcome,
} from "./mailbox-import.ts";
import {
  readHostedMailboxImportState,
  writeHostedMailboxImportState,
  type HostedMailboxImportState,
} from "./mailbox-state.ts";
import type {
  HostedRuntimeMailboxPort,
  HostedRuntimeWorkspacePort,
} from "./platform.ts";

export interface HostedMailboxImportCheckpointInput {
  expectedUserId: string;
  importItem(item: HostedMailboxResolvedImportItem): Promise<HostedMailboxItemImportOutcome>;
  lanes?: readonly HostedMailboxLane[];
  limitPerLane: number;
  mailboxPort: HostedRuntimeMailboxPort;
  checkpointReason?: HostedWorkspaceCheckpointReason;
  requestId: string;
  vaultRoot: string;
  workspacePort: HostedRuntimeWorkspacePort;
  createCheckpointRequest(
    input: HostedMailboxImportCheckpointRequestInput,
  ): Promise<HostedWorkspaceCheckpointRequest> | HostedWorkspaceCheckpointRequest;
  now?: () => string;
}

export interface HostedMailboxImportCheckpointRequestInput {
  importResult: HostedMailboxImportLoopResult;
  previousState: HostedMailboxImportState;
  redactedStatus: HostedRuntimeRedactedJson;
  state: HostedMailboxImportState;
}

export interface HostedMailboxImportCheckpointResult {
  checkpoint: HostedWorkspaceCheckpointResponse | null;
  importResult: HostedMailboxImportLoopResult;
  previousState: HostedMailboxImportState;
  state: HostedMailboxImportState;
  stateChanged: boolean;
}

export class HostedMailboxImportCheckpointConflictError extends Error {
  readonly checkpoint: HostedWorkspaceCheckpointResponse;

  constructor(checkpoint: HostedWorkspaceCheckpointResponse) {
    super("Hosted mailbox import checkpoint was rejected.");
    this.name = "HostedMailboxImportCheckpointConflictError";
    this.checkpoint = checkpoint;
  }
}

export class HostedMailboxImportCheckpointUserMismatchError extends Error {
  readonly actualUserId: string;
  readonly expectedUserId: string;

  constructor(input: {
    actualUserId: string;
    expectedUserId: string;
  }) {
    super("Hosted mailbox import checkpoint returned an unexpected user.");
    this.name = "HostedMailboxImportCheckpointUserMismatchError";
    this.actualUserId = input.actualUserId;
    this.expectedUserId = input.expectedUserId;
  }
}

export async function importHostedMailboxPrefixAndCheckpoint(
  input: HostedMailboxImportCheckpointInput,
): Promise<HostedMailboxImportCheckpointResult> {
  const previousState = await readHostedMailboxImportState({
    vaultRoot: input.vaultRoot,
  });
  const importResult = await fetchAndProcessHostedMailboxPrefix({
    expectedUserId: input.expectedUserId,
    importItem: input.importItem,
    lanes: input.lanes,
    limitPerLane: input.limitPerLane,
    mailboxPort: input.mailboxPort,
    now: input.now,
    requestId: input.requestId,
    state: previousState,
  });
  const stateChanged = !hostedMailboxImportStatesEqual(
    previousState,
    importResult.state,
  );

  if (!stateChanged) {
    return {
      checkpoint: null,
      importResult,
      previousState,
      state: importResult.state,
      stateChanged: false,
    };
  }

  await writeHostedMailboxImportState({
    state: importResult.state,
    vaultRoot: input.vaultRoot,
  });

  let checkpoint: HostedWorkspaceCheckpointResponse;
  try {
    const redactedStatus = buildHostedMailboxImportRedactedStatus(importResult);
    const checkpointRequest = await input.createCheckpointRequest({
      importResult,
      previousState,
      redactedStatus: cloneHostedRuntimeRedactedJson(redactedStatus),
      state: importResult.state,
    });
    const checkpointReason = input.checkpointReason ?? "import";
    checkpoint = await input.workspacePort.checkpoint({
      ...checkpointRequest,
      reason: checkpointReason,
      redactedStatus: cloneHostedRuntimeRedactedJson(redactedStatus),
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
  } catch (error) {
    await writeHostedMailboxImportState({
      state: previousState,
      vaultRoot: input.vaultRoot,
    });
    throw error;
  }

  return {
    checkpoint,
    importResult,
    previousState,
    state: importResult.state,
    stateChanged: true,
  };
}

export function buildHostedMailboxImportRedactedStatus(
  importResult: HostedMailboxImportLoopResult,
): HostedRuntimeRedactedJson {
  return {
    hostedMailboxBlockedCount: importResult.blocked.length,
    hostedMailboxConversationImportedSeq: importResult.state.watermarks.conversation,
    hostedMailboxFetchedCount: importResult.fetchedCount,
    hostedMailboxImportedCount: importResult.importedCount,
    hostedMailboxRetryableBlockedCount: importResult.blocked.filter((item) => item.retryable)
      .length,
    hostedMailboxSystemImportedSeq: importResult.state.watermarks.system,
  };
}

function hostedMailboxImportStatesEqual(
  left: HostedMailboxImportState,
  right: HostedMailboxImportState,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneHostedRuntimeRedactedJson(
  value: HostedRuntimeRedactedJson,
): HostedRuntimeRedactedJson {
  return { ...value };
}
