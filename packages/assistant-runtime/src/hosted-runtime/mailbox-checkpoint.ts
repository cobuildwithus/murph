import type {
  HostedMailboxLane,
  HostedRuntimeRedactedJson,
  HostedWorkspaceCheckpointReason,
  HostedWorkspaceCheckpointRequest,
  HostedWorkspaceCheckpointResponse,
} from "@murphai/hosted-execution/runtime-control";

import {
  fetchAndProcessHostedMailboxPrefix,
  type HostedMailboxConversationDeferral,
  type HostedMailboxImportLoopResult,
  type HostedMailboxPostCheckpointEffect,
  type HostedMailboxPrefixPrefetch,
  type HostedMailboxResolvedImportItem,
  type HostedMailboxItemImportOutcome,
} from "./mailbox-import.ts";
import {
  readHostedMailboxImportState,
  writeHostedMailboxImportState,
  type HostedMailboxImportState,
} from "./mailbox-state.ts";
import {
  readHostedSystemMailboxCheckpointRollbackState,
  restoreHostedSystemMailboxCheckpointRollbackState,
} from "./system-mailbox.ts";
import {
  readHostedSystemMailboxHandledThroughSeq,
} from "./system-mailbox-state.ts";
import type {
  HostedRuntimeMailboxPort,
  HostedRuntimeWorkspacePort,
} from "./platform.ts";

export interface HostedMailboxImportCheckpointInput {
  deferConversationUntil?: HostedMailboxConversationDeferral | null;
  deferCheckpoint?: boolean;
  expectedUserId: string;
  fetchSignal?: AbortSignal | null;
  importItem(item: HostedMailboxResolvedImportItem): Promise<HostedMailboxItemImportOutcome>;
  lanes?: readonly HostedMailboxLane[];
  limitPerLane: number;
  mailboxPort: HostedRuntimeMailboxPort;
  checkpointReason?: HostedWorkspaceCheckpointReason;
  prefetch?: HostedMailboxPrefixPrefetch | null;
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
  afterCheckpointEffects: readonly HostedMailboxPostCheckpointEffect[];
  checkpoint: HostedWorkspaceCheckpointResponse | null;
  checkpointDeferred: boolean;
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
  const previousSystemMailboxState = input.deferCheckpoint === true
    ? null
    : await readHostedSystemMailboxCheckpointRollbackState({
        vaultRoot: input.vaultRoot,
      });
  const afterCheckpointEffects: HostedMailboxPostCheckpointEffect[] = [];
  const importResult = await fetchAndProcessHostedMailboxPrefix({
    deferConversationUntil: input.deferConversationUntil ?? null,
    expectedUserId: input.expectedUserId,
    fetchSignal: input.fetchSignal ?? null,
    importItem: async (item) => {
      const outcome = await input.importItem(item);
      if (
        (outcome.status === "imported" || outcome.status === "skipped")
        && outcome.afterCheckpoint
      ) {
        afterCheckpointEffects.push(outcome.afterCheckpoint);
      }
      return outcome;
    },
    lanes: input.lanes,
    limitPerLane: input.limitPerLane,
    mailboxPort: input.mailboxPort,
    now: input.now,
    prefetch: input.prefetch ?? null,
    requestId: input.requestId,
    state: previousState,
  });
  const stateChanged = !hostedMailboxImportStatesEqual(
    previousState,
    importResult.state,
  );
  const shouldCheckpoint = stateChanged;

  if (!shouldCheckpoint) {
    return {
      afterCheckpointEffects: [],
      checkpoint: null,
      checkpointDeferred: false,
      importResult,
      previousState,
      state: importResult.state,
      stateChanged: false,
    };
  }

  if (stateChanged) {
    await writeHostedMailboxImportState({
      state: importResult.state,
      vaultRoot: input.vaultRoot,
    });
  }

  if (input.deferCheckpoint === true) {
    return {
      afterCheckpointEffects,
      checkpoint: null,
      checkpointDeferred: true,
      importResult,
      previousState,
      state: importResult.state,
      stateChanged,
    };
  }

  let checkpoint: HostedWorkspaceCheckpointResponse;
  try {
    const redactedStatus = {
      ...buildHostedMailboxImportRedactedStatus(importResult),
      hostedMailboxSystemHandledThroughSeq:
        await readHostedSystemMailboxHandledThroughSeq({
          importedSeq: importResult.state.watermarks.system,
          vaultRoot: input.vaultRoot,
        }),
    };
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
    if (stateChanged) {
      await writeHostedMailboxImportState({
        state: previousState,
        vaultRoot: input.vaultRoot,
      });
      if (previousSystemMailboxState) {
        await restoreHostedSystemMailboxCheckpointRollbackState({
          discardItemIds: importResult.importedSystemMailboxItemIds ?? [],
          state: previousSystemMailboxState,
          vaultRoot: input.vaultRoot,
        });
      }
    }
    throw error;
  }

  return {
    afterCheckpointEffects,
    checkpoint,
    checkpointDeferred: false,
    importResult,
    previousState,
    state: importResult.state,
    stateChanged,
  };
}

export function buildHostedMailboxImportRedactedStatus(
  importResult: HostedMailboxImportLoopResult,
): HostedRuntimeRedactedJson {
  return {
    hostedMailboxBlockedCount: importResult.blocked.length,
    ...(importResult.consumedSeqByLane.conversation === null
      ? {}
      : {
          hostedMailboxConversationConsumedSeq:
            importResult.consumedSeqByLane.conversation,
        }),
    hostedMailboxConversationImportedSeq: importResult.state.watermarks.conversation,
    hostedMailboxFetchedCount: importResult.fetchedCount,
    hostedMailboxImportedCount: importResult.importedCount,
    hostedMailboxRetryableBlockedCount: importResult.blocked.filter((item) => item.retryable)
      .length,
    ...(importResult.nextRetryAt
      ? { hostedMailboxNextRetryAtPresent: true }
      : {}),
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
