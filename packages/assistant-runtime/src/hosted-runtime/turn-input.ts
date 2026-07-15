import {
  DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT,
  assistantInputCandidateFromStoredEvent,
  compareAssistantInputCursors,
  isSameAssistantConversationRef,
  readAssistantInputEvent,
  readHostedMailboxAssistantInputItemDetails,
  type AssistantInputCandidate,
  type AssistantInputCandidateBatch,
  type AssistantInputCandidateQuery,
  type AssistantInputCursor,
  type AssistantInputEventRecord,
  type AssistantInputSource,
  type AssistantTurnConversationInputQuery,
} from "@murphai/assistant-engine";
import {
  readAssistantAutomationState,
} from "@murphai/assistant-engine/assistant-state";
import {
  shouldGroupAdjacentAssistantInputCandidates,
} from "@murphai/assistant-engine/assistant-automation";
import { assistantPreferenceCausalSeqSchema } from "@murphai/contracts";

import {
  compactHostedPendingAssistantInputIds,
  isHostedPendingAssistantInputStillReplyable,
} from "./pending-input-index.ts";

const DEFAULT_HOSTED_ASSISTANT_INPUT_QUERY_LIMIT = 100;

type HostedPendingInputRefreshMode = "compact" | "none";

export type HostedAssistantInputSelection =
  | {
      freshInputIds: string[];
      inputIds: string[];
      mode: "foreground";
      pendingInputIds: string[];
    }
  | {
      inputIds: string[];
      mode: "background";
      pendingInputIds: string[];
    };

export interface HostedAssistantInputSource extends AssistantInputSource {
  readObservedInputIds(): string[];
  readSelectedInputIds(): string[];
}

export async function resolveHostedPersonalizationInputIdForAcceptedInputs(input: {
  assistantInputIds: readonly string[];
  vaultRoot: string;
}): Promise<string | null> {
  const inputIds = uniqueStrings(input.assistantInputIds);
  if (
    inputIds.length === 0
    || inputIds.length !== input.assistantInputIds.length
  ) {
    return null;
  }
  let events: AssistantInputEventRecord[];
  try {
    events = await readHostedAssistantInputEventsById({
      inputIds,
      vaultRoot: input.vaultRoot,
    });
  } catch {
    return null;
  }
  let batch: AssistantInputEventRecord[];
  try {
    batch = selectHostedAssistantInputEventBatch({
      events,
      limit: DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT,
    });
  } catch {
    return null;
  }
  return batch.length === events.length
    ? batch.at(-1)?.inputId ?? null
    : null;
}

export function createHostedAssistantInputSource(input: {
  initialPendingInputIds?: readonly string[] | null;
  pendingInputRefreshMode: HostedPendingInputRefreshMode;
  selectedInputIds?: readonly string[] | null;
  vaultRoot: string;
}): HostedAssistantInputSource {
  const selectedInputIds = uniqueStrings(input.selectedInputIds ?? []);
  const selectedInputIdSet = new Set(selectedInputIds);
  const observedInputIds = new Set([
    ...(input.initialPendingInputIds ?? []),
    ...selectedInputIds,
  ]);
  const emittedListInputCandidateCursorKeys = new Set<string>();
  let selectedCandidatesPromise: Promise<AssistantInputCandidate[]> | null = null;
  const readSelectedCandidates = () => {
    selectedCandidatesPromise ??= readHostedAssistantInputCandidatesById({
      inputIds: selectedInputIds,
      vaultRoot: input.vaultRoot,
    });
    return selectedCandidatesPromise;
  };

  return {
    readObservedInputIds() {
      return [...observedInputIds];
    },
    readSelectedInputIds() {
      return [...selectedInputIds];
    },
    async refresh(refreshInput) {
      assertHostedAssistantInputQueryNotAborted(refreshInput?.signal);
      if (input.pendingInputRefreshMode === "none") {
        return {
          progressed: false,
          reason: "no_new_input",
        };
      }
      const pendingInputIds = await compactHostedPendingAssistantInputIds({
        vaultRoot: input.vaultRoot,
      });
      const newPendingInputIds: string[] = [];
      for (const inputId of pendingInputIds) {
        if (observedInputIds.has(inputId)) {
          continue;
        }
        observedInputIds.add(inputId);
        newPendingInputIds.push(inputId);
      }
      const appendablePendingEvents = await readHostedAssistantInputEventsById({
        inputIds: newPendingInputIds,
        vaultRoot: input.vaultRoot,
      });
      const appendablePendingInputIds = selectedInputIds.length === 0
        ? selectHostedAssistantInputEventBatch({
            events: appendablePendingEvents,
            limit: DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT,
          }).map((event) => event.inputId)
        : [];
      const added = appendSelectedHostedAssistantInputIds({
        inputIds: appendablePendingInputIds,
        selectedInputIdSet,
        selectedInputIds,
      });
      if (added > 0) {
        selectedCandidatesPromise = null;
      }
      assertHostedAssistantInputQueryNotAborted(refreshInput?.signal);
      return {
        progressed: added > 0,
        reason: added > 0 ? "ingested_input" : "no_new_input",
      };
    },
    async listInputCandidates(query) {
      assertHostedAssistantInputQueryNotAborted(query.signal);
      const candidates = await readSelectedCandidates();
      assertHostedAssistantInputQueryNotAborted(query.signal);
      return filterHostedAssistantInputCandidates({
        candidates,
        emittedCursorKeys: emittedListInputCandidateCursorKeys,
        query,
      });
    },
    async listNewConversationInputs(query) {
      assertHostedAssistantInputQueryNotAborted(query.signal);
      const candidates = await readSelectedCandidates();
      assertHostedAssistantInputQueryNotAborted(query.signal);
      return filterHostedAssistantNewConversationInputs({
        candidates,
        query,
      });
    },
  };
}

function appendSelectedHostedAssistantInputIds(input: {
  inputIds: readonly string[];
  selectedInputIdSet: Set<string>;
  selectedInputIds: string[];
}): number {
  let added = 0;
  for (const inputId of input.inputIds) {
    if (input.selectedInputIdSet.has(inputId)) {
      continue;
    }
    input.selectedInputIdSet.add(inputId);
    input.selectedInputIds.push(inputId);
    added += 1;
  }
  return added;
}

export async function selectHostedAssistantInputIds(
  input:
    | {
        freshAssistantInputIds?: readonly string[] | null;
        mode: "foreground";
        vaultRoot: string;
      }
    | {
        limit?: number;
        mode: "background";
        vaultRoot: string;
      },
): Promise<HostedAssistantInputSelection> {
  if (input.mode === "background") {
    const pendingInputIds = await compactHostedPendingAssistantInputIds({
      vaultRoot: input.vaultRoot,
    });
    const pendingEvents = await readHostedReplyablePendingAssistantInputEvents({
      inputIds: pendingInputIds,
      vaultRoot: input.vaultRoot,
    });
    const limit = normalizeHostedAssistantInputBatchLimit(input.limit);
    return {
      inputIds: selectHostedAssistantInputEventBatch({
        events: pendingEvents,
        limit,
      }).map((event) => event.inputId),
      mode: "background",
      pendingInputIds,
    };
  }

  const freshInputIds = uniqueStrings(input.freshAssistantInputIds ?? []);
  if (freshInputIds.length === 0) {
    return {
      freshInputIds,
      inputIds: [],
      mode: "foreground",
      pendingInputIds: [],
    };
  }

  const freshEvents = await readHostedAssistantInputEventsById({
    inputIds: freshInputIds,
    vaultRoot: input.vaultRoot,
  });

  return {
    freshInputIds,
    inputIds: selectHostedAssistantInputEventBatch({
      events: freshEvents,
      limit: DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT,
    }).map((event) => event.inputId),
    mode: "foreground",
    pendingInputIds: [],
  };
}

function selectHostedAssistantInputEventBatch(input: {
  events: readonly AssistantInputEventRecord[];
  limit: number;
}): AssistantInputEventRecord[] {
  const orderedEvents = [...input.events].sort((left, right) =>
    compareAssistantInputCursors(left.cursor, right.cursor)
  );
  const selected: AssistantInputEventRecord[] = [];
  let previousEvent: AssistantInputEventRecord | null = null;

  for (const event of orderedEvents) {
    if (selected.length >= input.limit) {
      break;
    }
    if (
      previousEvent
      && !isHostedAssistantInputEventBatchSuccessor(previousEvent, event)
    ) {
      break;
    }
    selected.push(event);
    previousEvent = event;
  }

  return selected;
}

function isHostedAssistantInputEventBatchSuccessor(
  previous: AssistantInputEventRecord,
  candidate: AssistantInputEventRecord,
): boolean {
  if (
    !shouldGroupAdjacentAssistantInputCandidates(
      assistantInputCandidateFromStoredEvent(previous),
      assistantInputCandidateFromStoredEvent(candidate),
    )
  ) {
    return false;
  }

  const previousCausalSeq = readPositiveHostedAssistantInputCausalSeq(previous);
  const candidateCausalSeq = readPositiveHostedAssistantInputCausalSeq(candidate);
  return previousCausalSeq !== null
    && candidateCausalSeq !== null
    && candidateCausalSeq === previousCausalSeq + 1n;
}

function readPositiveHostedAssistantInputCausalSeq(
  event: AssistantInputEventRecord,
): bigint | null {
  if (event.sourceRef.kind !== "hosted-mailbox") {
    return null;
  }
  const causalSeq = BigInt(
    assistantPreferenceCausalSeqSchema.parse(event.sourceRef.causalSeq ?? "0"),
  );
  return causalSeq > 0n ? causalSeq : null;
}

async function readHostedAssistantInputCandidatesById(input: {
  inputIds: readonly string[];
  vaultRoot: string;
}): Promise<AssistantInputCandidate[]> {
  const events = await readHostedAssistantInputEventsById(input);
  const hostedMailboxItems = await readHostedMailboxAssistantInputItemDetails({
    inputIds: events.map((event) => event.inputId),
    vault: input.vaultRoot,
  });
  return events
    .sort((left, right) =>
      compareAssistantInputCursors(left.cursor, right.cursor)
    )
    .map((event) => {
      const hostedMailboxItem = hostedMailboxItems.get(event.inputId);
      return assistantInputCandidateFromStoredEvent(event, {
        ...(hostedMailboxItem?.groupParticipantAdded === true
          ? { groupParticipantAdded: hostedMailboxItem.groupParticipantAdded }
          : {}),
        ...(hostedMailboxItem?.groupReactionContext
          ? { groupReactionContext: hostedMailboxItem.groupReactionContext }
          : {}),
        hostedMailboxItemId: hostedMailboxItem?.mailboxItemId ?? null,
      });
    });
}

async function readHostedAssistantInputEventsById(input: {
  inputIds: readonly string[];
  vaultRoot: string;
}): Promise<AssistantInputEventRecord[]> {
  const events: AssistantInputEventRecord[] = [];
  for (const inputId of uniqueStrings(input.inputIds)) {
    const event = await readAssistantInputEvent({
      inputId,
      vault: input.vaultRoot,
    });
    if (!event) {
      throw new Error(
        `Hosted assistant input source references a missing input event: ${inputId}`,
      );
    }
    events.push(event);
  }
  return events;
}

async function readHostedReplyablePendingAssistantInputEvents(input: {
  inputIds: readonly string[];
  vaultRoot: string;
}): Promise<AssistantInputEventRecord[]> {
  const events = await readHostedAssistantInputEventsById(input);
  if (events.length === 0) {
    return [];
  }

  const enabledAutoReplyChannels = new Set(
    (await readAssistantAutomationState(input.vaultRoot)).autoReply
      .map((entry) => entry.channel),
  );
  const replyableEvents = events.filter((event) =>
    isHostedPendingAssistantInputStillReplyable({
      enabledAutoReplyChannels,
      event,
    })
  );
  return replyableEvents;
}

function filterHostedAssistantInputCandidates(input: {
  candidates: readonly AssistantInputCandidate[];
  emittedCursorKeys: Set<string>;
  query: AssistantInputCandidateQuery;
}): AssistantInputCandidateBatch {
  const knownInputIds = new Set(input.query.knownInputIds ?? []);
  const afterCursor = readEffectiveHostedAssistantInputSourceAfterCursor({
    afterCursor: input.query.afterCursor ?? null,
    emittedCursorKeys: input.emittedCursorKeys,
  });
  const batch = buildHostedAssistantInputCandidateBatch({
    afterCursor,
    candidates: input.candidates.filter((candidate) => {
      if (knownInputIds.has(candidate.event.inputId)) {
        return false;
      }
      if (
        input.query.sourceId
        && candidate.event.source !== input.query.sourceId
      ) {
        return false;
      }
      return true;
    }),
    limit: input.query.limit,
  });
  for (const candidate of batch.inputs) {
    input.emittedCursorKeys.add(hostedAssistantInputCursorKey(candidate.event.cursor));
  }
  return batch;
}

function filterHostedAssistantNewConversationInputs(input: {
  candidates: readonly AssistantInputCandidate[];
  query: AssistantTurnConversationInputQuery;
}): AssistantInputCandidateBatch {
  const knownInputIds = new Set(input.query.knownInputIds ?? []);
  const knownProjectionCaptureIds = new Set(
    input.query.knownProjectionCaptureIds ?? [],
  );

  return buildHostedAssistantInputCandidateBatch({
    afterCursor: input.query.afterCursor ?? null,
    candidates: input.candidates.filter((candidate) => {
      if (knownInputIds.has(candidate.event.inputId)) {
        return false;
      }
      if (
        candidate.projection.captureId
        && knownProjectionCaptureIds.has(candidate.projection.captureId)
      ) {
        return false;
      }
      return isSameAssistantConversationRef(
        candidate.event.conversation,
        input.query.conversation,
      );
    }),
    limit: input.query.limit,
  });
}

function buildHostedAssistantInputCandidateBatch(input: {
  afterCursor: AssistantInputCursor | null;
  candidates: readonly AssistantInputCandidate[];
  limit?: number;
}): AssistantInputCandidateBatch {
  const limit = normalizeHostedAssistantInputQueryLimit(input.limit);
  const selected = input.candidates
    .filter((candidate) =>
      input.afterCursor
        ? compareAssistantInputCursors(candidate.event.cursor, input.afterCursor) > 0
        : true
    )
    .sort((left, right) =>
      compareAssistantInputCursors(left.event.cursor, right.event.cursor)
    )
    .slice(0, limit);

  return {
    inputs: selected,
    nextCursor: selected.length > 0
      ? selected[selected.length - 1]!.event.cursor
      : input.afterCursor,
  };
}

function readEffectiveHostedAssistantInputSourceAfterCursor(input: {
  afterCursor: AssistantInputCursor | null;
  emittedCursorKeys: ReadonlySet<string>;
}): AssistantInputCursor | null {
  if (!input.afterCursor) {
    return null;
  }
  // Hosted sources are already narrowed to explicit pending IDs. A persisted
  // discovery cursor must not hide them before this source has emitted them.
  return input.emittedCursorKeys.has(hostedAssistantInputCursorKey(input.afterCursor))
    ? input.afterCursor
    : null;
}

function hostedAssistantInputCursorKey(cursor: AssistantInputCursor): string {
  return [
    cursor.createdAt ?? "",
    cursor.inputId,
    cursor.occurredAt,
    cursor.sourceKind,
    cursor.sourcePosition ?? "",
  ].join("\0");
}

function normalizeHostedAssistantInputQueryLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_HOSTED_ASSISTANT_INPUT_QUERY_LIMIT;
  }
  return Math.max(1, Math.trunc(value));
}

function normalizeHostedAssistantInputBatchLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT;
  }
  return Math.min(
    DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT,
    Math.max(1, Math.trunc(value)),
  );
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function assertHostedAssistantInputQueryNotAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }

  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Hosted assistant input query was aborted.");
}
