import {
  HOSTED_MAILBOX_LANES,
  type HostedMailboxFetchResponse,
  type HostedMailboxLane,
  type HostedWorkspaceInvocationRequest,
  type HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import type { HostedMailboxImportState } from "./mailbox-state.ts";
import type { HostedRuntimeMailboxPort } from "./platform.ts";

export const HOSTED_FOREGROUND_MAILBOX_PREFETCH_LANES = ["conversation", "system"] as const;

export interface HostedMailboxPrefixPrefetch {
  importedSeqByLane: Record<HostedMailboxLane, string>;
  lanes: readonly HostedMailboxLane[];
  limitPerLane: number;
  response: Promise<HostedMailboxFetchResponse>;
  signal?: AbortSignal | null;
}

export function prefetchHostedMailboxPrefix(input: {
  lanes?: readonly HostedMailboxLane[];
  limitPerLane: number;
  mailboxPort: HostedRuntimeMailboxPort;
  requestId: string;
  signal?: AbortSignal | null;
  state: Pick<HostedMailboxImportState, "watermarks">;
}): HostedMailboxPrefixPrefetch {
  const lanes = input.lanes ?? HOSTED_MAILBOX_LANES;
  const importedSeqByLane = Object.fromEntries(
    HOSTED_MAILBOX_LANES.map((lane) => [lane, input.state.watermarks[lane]]),
  ) as Record<HostedMailboxLane, string>;
  const request = {
    cursorMode: "imported_seq" as const,
    lanes: lanes.map((lane) => ({
      importedSeq: importedSeqByLane[lane],
      lane,
    })),
    limitPerLane: input.limitPerLane,
    requestId: input.requestId,
  };
  const signal = input.signal ?? null;
  let response: Promise<HostedMailboxFetchResponse>;
  try {
    response = signal
      ? input.mailboxPort.fetch(request, { signal })
      : input.mailboxPort.fetch(request);
  } catch (error) {
    response = Promise.reject(error);
  }
  void response.catch(() => undefined);

  return {
    importedSeqByLane,
    lanes,
    limitPerLane: input.limitPerLane,
    response,
    ...(signal ? { signal } : {}),
  };
}

export function canUseHostedMailboxPrefixPrefetch(input: {
  lanes: readonly HostedMailboxLane[];
  limitPerLane: number;
  prefetch: HostedMailboxPrefixPrefetch;
  state: Pick<HostedMailboxImportState, "watermarks">;
}): boolean {
  const prefetch = input.prefetch;
  if (prefetch.limitPerLane !== input.limitPerLane) {
    return false;
  }

  const prefetchedLanes = new Set(prefetch.lanes);
  if (!input.lanes.every((lane) => prefetchedLanes.has(lane))) {
    return false;
  }

  return input.lanes.every((lane) =>
    prefetch.importedSeqByLane[lane] === input.state.watermarks[lane]
  );
}

export function resolveHostedWorkspaceRunMailboxFetchLimit(maxMailboxItems?: number | null): number {
  const importLimit = maxMailboxItems ?? 50;
  return importLimit >= Number.MAX_SAFE_INTEGER ? importLimit : importLimit + 1;
}

/** Start an ordinary fenced fetch; checkpoint hints never advance local state. */
export function prefetchHostedWorkspaceMailbox(input: {
  mailboxPort?: HostedRuntimeMailboxPort | null;
  request: HostedWorkspaceInvocationRequest;
  signal: AbortSignal | null;
  workspace: HostedWorkspaceState | null;
}): HostedMailboxPrefixPrefetch | null {
  if (!input.mailboxPort || !input.workspace?.snapshotRef
      || (input.request.processingMode ?? "default") !== "default"
      || input.request.assistantExecutionBlocked === true) {
    return null;
  }
  const watermarks = readCheckpointMailboxWatermarks(input.workspace.redactedStatus);
  if (!watermarks) return null;
  return prefetchHostedMailboxPrefix({
    lanes: HOSTED_FOREGROUND_MAILBOX_PREFETCH_LANES,
    limitPerLane: resolveHostedWorkspaceRunMailboxFetchLimit(input.request.budget?.maxMailboxItems),
    mailboxPort: input.mailboxPort,
    requestId: `hosted-workspace-invocation:${input.request.attemptId}`,
    signal: input.signal,
    state: { watermarks },
  });
}

function readCheckpointMailboxWatermarks(status: HostedWorkspaceState["redactedStatus"]):
  HostedMailboxImportState["watermarks"] | null {
  const conversation = status?.hostedMailboxConversationImportedSeq;
  const system = status?.hostedMailboxSystemImportedSeq;
  if (typeof conversation !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(conversation)
      || typeof system !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(system)) {
    return null;
  }
  return { conversation, system };
}
