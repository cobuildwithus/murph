import {
  DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT,
  assistantInputCandidateFromStoredEvent,
  compareAssistantInputCursors,
  isSameAssistantConversationRef,
  isAssistantHostedImageCompletionEvent,
  readAssistantInputEvent,
  readHostedMailboxAssistantInputItemDetails,
  type AssistantInputCandidate,
  type AssistantInputCandidateBatch,
  type AssistantInputCandidateByIdQuery,
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
  isSameAuthenticatedAssistantGroupRoute,
  shouldGroupAdjacentAssistantInputCandidates,
} from "@murphai/assistant-engine/assistant-automation";
import { assistantPreferenceCausalSeqSchema } from "@murphai/contracts";

import {
  compactHostedPendingAssistantInputIds,
  isHostedPendingAssistantInputStillReplyable,
  runHostedPendingAssistantInputContentRetention,
} from "./pending-input-index.ts";

const DEFAULT_HOSTED_ASSISTANT_INPUT_QUERY_LIMIT = 100;

type HostedPendingInputRefreshMode = "compact" | "none";

type HostedAssistantInputSelection =
  | {
      freshInputIds: string[];
      inputIds: string[];
      mode: "foreground";
      pendingInputIds: string[];
      preserveInputOrder?: true;
    }
  | {
      inputIds: string[];
      mode: "background";
      pendingInputIds: string[];
      preserveInputOrder?: true;
    };

export interface HostedAssistantInputSource extends AssistantInputSource {
  listInputCandidatesByIds(
    input: AssistantInputCandidateByIdQuery,
  ): Promise<AssistantInputCandidateBatch>;
  readObservedInputIds(): string[];
  readSelectedInputIds(): string[];
}

export type HostedConversationActivityObservation =
  | "not_observed"
  | "observed"
  | "uncertain";

export async function resolveHostedCurrentInputIdForAcceptedInputs(input: {
  assistantInputIds: readonly string[];
  vaultRoot: string;
}): Promise<{
  conversationActivity: HostedConversationActivityObservation;
  currentInputId: string | null;
}> {
  const inputIds = uniqueStrings(input.assistantInputIds);
  if (inputIds.length === 0) {
    return {
      conversationActivity: "not_observed",
      currentInputId: null,
    };
  }
  if (inputIds.length !== input.assistantInputIds.length) {
    return {
      conversationActivity: "uncertain",
      currentInputId: null,
    };
  }
  let events: AssistantInputEventRecord[];
  try {
    events = await readHostedAssistantInputEventsById({
      inputIds,
      vaultRoot: input.vaultRoot,
    });
  } catch {
    return {
      conversationActivity: "uncertain",
      currentInputId: null,
    };
  }
  if (events.length !== inputIds.length) {
    return {
      conversationActivity: "uncertain",
      currentInputId: null,
    };
  }
  const conversationActivity = events.some(isHostedConversationActivityInputEvent)
    ? "observed"
    : "not_observed";
  let batch: AssistantInputEventRecord[];
  try {
    batch = await selectHostedImageCompletionInputEventBatch({
      events,
      hostedImageCompletionInputIds: events
        .filter(isAssistantHostedImageCompletionEvent)
        .map((event) => event.inputId),
      vaultRoot: input.vaultRoot,
    }) ?? selectHostedAssistantInputEventBatch({
      events,
      limit: DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT,
    });
  } catch {
    return {
      conversationActivity,
      currentInputId: null,
    };
  }
  return {
    conversationActivity,
    currentInputId: batch.length === events.length
      ? batch.at(-1)?.inputId ?? null
      : null,
  };
}

function isHostedConversationActivityInputEvent(
  event: AssistantInputEventRecord,
): boolean {
  return event.sourceRef.kind === "inbox-capture"
    || (
      event.sourceRef.kind === "hosted-mailbox"
      && event.sourceRef.lane === "conversation"
    );
}

export function createHostedAssistantInputSource(input: {
  initialPendingInputIds?: readonly string[] | null;
  pendingInputRefreshMode: HostedPendingInputRefreshMode;
  preserveSelectedInputOrder?: boolean;
  selectedInputIds?: readonly string[] | null;
  vaultRoot: string;
}): HostedAssistantInputSource {
  const selectedInputIds = uniqueStrings(input.selectedInputIds ?? []);
  const selectedInputIdSet = new Set(selectedInputIds);
  let preserveSelectedInputOrder = input.preserveSelectedInputOrder === true;
  const observedInputIds = new Set([
    ...(input.initialPendingInputIds ?? []),
    ...selectedInputIds,
  ]);
  const emittedListInputCandidateCursorKeys = new Set<string>();
  let selectedCandidatesPromise: Promise<AssistantInputCandidate[]> | null = null;
  const readSelectedCandidates = () => {
    selectedCandidatesPromise ??= readHostedAssistantInputCandidatesById({
      inputIds: selectedInputIds,
      preserveInputOrder: preserveSelectedInputOrder,
      vaultRoot: input.vaultRoot,
    });
    return selectedCandidatesPromise;
  };

  return {
    get preserveInputCandidateOrder() {
      return preserveSelectedInputOrder;
    },
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
      await runHostedPendingAssistantInputContentRetention({
        signal: refreshInput?.signal,
        vaultRoot: input.vaultRoot,
      });
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
      const appendablePendingBatch = selectedInputIds.length === 0
        ? await selectHostedAssistantInputEventBatchWithImageCompletion({
            events: appendablePendingEvents,
            limit: DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT,
            vaultRoot: input.vaultRoot,
          })
        : null;
      const appendablePendingInputIds = appendablePendingBatch?.events.map(
        (event) => event.inputId,
      ) ?? [];
      const added = appendSelectedHostedAssistantInputIds({
        inputIds: appendablePendingInputIds,
        selectedInputIdSet,
        selectedInputIds,
      });
      if (added > 0) {
        preserveSelectedInputOrder =
          appendablePendingBatch?.preserveInputOrder === true;
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
        preserveInputOrder: preserveSelectedInputOrder,
        query,
      });
    },
    async listInputCandidatesByIds(query) {
      assertHostedAssistantInputQueryNotAborted(query.signal);
      const inputIds = uniqueStrings(query.inputIds);
      for (const inputId of inputIds) {
        observedInputIds.add(inputId);
      }
      const events = await readHostedAssistantInputEventsById({
        inputIds,
        missingInput: "skip",
        vaultRoot: input.vaultRoot,
      });
      const replyableEvents = events.length === inputIds.length
        ? await filterHostedReplyablePendingAssistantInputEvents({
            events,
            vaultRoot: input.vaultRoot,
          })
        : [];
      const exactSuccessors = await selectHostedAssistantExactSuccessorEvents({
        afterCursor: query.afterCursor ?? null,
        events,
        replyableInputIds: new Set(
          replyableEvents.map((event) => event.inputId),
        ),
        vaultRoot: input.vaultRoot,
      });
      const candidates = await createHostedAssistantInputCandidates({
        events: exactSuccessors,
        vaultRoot: input.vaultRoot,
      });
      assertHostedAssistantInputQueryNotAborted(query.signal);
      return filterHostedAssistantInputCandidates({
        candidates,
        ignoreAfterCursor: true,
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
        hostedImageCompletionInputIds?: readonly string[] | null;
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
    await runHostedPendingAssistantInputContentRetention({
      vaultRoot: input.vaultRoot,
    });
    const pendingInputIds = await compactHostedPendingAssistantInputIds({
      vaultRoot: input.vaultRoot,
    });
    const pendingEvents = await readHostedReplyablePendingAssistantInputEvents({
      inputIds: pendingInputIds,
      vaultRoot: input.vaultRoot,
    });
    const limit = normalizeHostedAssistantInputBatchLimit(input.limit);
    const selected = await selectHostedAssistantInputEventBatchWithImageCompletion({
      events: pendingEvents,
      limit,
      vaultRoot: input.vaultRoot,
    });
    return {
      inputIds: selected.events.map((event) => event.inputId),
      mode: "background",
      pendingInputIds,
      ...(selected.preserveInputOrder
        ? { preserveInputOrder: true as const }
        : {}),
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
  const selected = await selectHostedAssistantInputEventBatchWithImageCompletion({
    events: freshEvents,
    hostedImageCompletionInputIds: input.hostedImageCompletionInputIds ?? [],
    limit: DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT,
    vaultRoot: input.vaultRoot,
  });

  return {
    freshInputIds,
    inputIds: selected.events.map((event) => event.inputId),
    mode: "foreground",
    pendingInputIds: [],
    ...(selected.preserveInputOrder
      ? { preserveInputOrder: true as const }
      : {}),
  };
}

async function selectHostedAssistantInputEventBatchWithImageCompletion(input: {
  events: readonly AssistantInputEventRecord[];
  hostedImageCompletionInputIds?: readonly string[];
  limit: number;
  vaultRoot: string;
}): Promise<{
  events: AssistantInputEventRecord[];
  preserveInputOrder: boolean;
}> {
  const completionInputIds = uniqueStrings(
    input.hostedImageCompletionInputIds
      ?? input.events
        .filter(isAssistantHostedImageCompletionEvent)
        .map((event) => event.inputId),
  );
  const completionInputIdSet = new Set(completionInputIds);
  const cursorOrderedEvents = [...input.events].sort((left, right) =>
    compareAssistantInputCursors(left.cursor, right.cursor)
  );
  const completionFirstEvents = completionInputIds.length === 0
    ? cursorOrderedEvents
    : [
        ...cursorOrderedEvents.filter((event) =>
          completionInputIdSet.has(event.inputId)
        ),
        ...cursorOrderedEvents.filter((event) =>
          !completionInputIdSet.has(event.inputId)
        ),
      ];
  const hostedImageCompletionEvents =
    await selectHostedImageCompletionInputEventBatch({
      events: completionFirstEvents,
      hostedImageCompletionInputIds: completionInputIds,
      vaultRoot: input.vaultRoot,
    });
  if (hostedImageCompletionEvents) {
    return {
      events: hostedImageCompletionEvents.slice(0, input.limit),
      preserveInputOrder: true,
    };
  }
  return {
    events: selectHostedAssistantInputEventBatch({
      events: input.events,
      limit: input.limit,
    }),
    preserveInputOrder: false,
  };
}

async function selectHostedImageCompletionInputEventBatch(input: {
  events: readonly AssistantInputEventRecord[];
  hostedImageCompletionInputIds: readonly string[];
  vaultRoot: string;
}): Promise<AssistantInputEventRecord[] | null> {
  const completionInputIds = new Set(
    uniqueStrings(input.hostedImageCompletionInputIds),
  );
  if (completionInputIds.size === 0) {
    return null;
  }
  const [anchorEvent] = input.events;
  if (
    !anchorEvent
    || !completionInputIds.has(anchorEvent.inputId)
    || [...completionInputIds].some((inputId) =>
      !input.events.some((event) =>
        event.inputId === inputId
        && isAssistantHostedImageCompletionEvent(event)
      )
    )
  ) {
    return null;
  }

  const candidates = await createHostedAssistantInputCandidates({
    events: input.events,
    preserveInputOrder: true,
    vaultRoot: input.vaultRoot,
  });
  const anchorCandidate = candidates[0];
  if (!anchorCandidate) {
    return null;
  }
  const candidatesByInputId = new Map(
    candidates.map((candidate) => [candidate.event.inputId, candidate] as const),
  );
  return input.events.filter((event, index) => {
    if (index === 0) {
      return true;
    }
    const candidate = candidatesByInputId.get(event.inputId);
    return candidate
      ? isSameAuthenticatedAssistantGroupRoute(anchorCandidate, candidate)
      : false;
  }).slice(0, DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT);
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

async function selectHostedAssistantExactSuccessorEvents(input: {
  afterCursor: AssistantInputCursor | null;
  events: readonly AssistantInputEventRecord[];
  replyableInputIds: ReadonlySet<string>;
  vaultRoot: string;
}): Promise<AssistantInputEventRecord[]> {
  const afterCursor = input.afterCursor;
  if (!afterCursor || input.events.length === 0) {
    return [];
  }
  const [anchor] = await readHostedAssistantInputEventsById({
    inputIds: [afterCursor.inputId],
    missingInput: "skip",
    vaultRoot: input.vaultRoot,
  });
  if (!anchor) {
    return [];
  }

  // Exact notification avoids a global scan, but it does not weaken the
  // compound-batch boundary. Ignore duplicate notifications at or behind the
  // supplied frontier, then stop at the first missing causal successor,
  // incomplete projection, or non-replyable event and leave later IDs pending.
  const successorEvents = [...input.events]
    .sort((left, right) =>
      compareAssistantInputCursors(left.cursor, right.cursor)
    )
    .filter((event) =>
      compareAssistantInputCursors(event.cursor, afterCursor) > 0
    );
  const selected: AssistantInputEventRecord[] = [];
  let previous = anchor;
  for (const event of successorEvents) {
    if (
      event.projection.status === "pending"
      || !input.replyableInputIds.has(event.inputId)
      || !isHostedAssistantInputEventBatchSuccessor(previous, event)
    ) {
      break;
    }
    selected.push(event);
    previous = event;
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
  preserveInputOrder?: boolean;
  vaultRoot: string;
}): Promise<AssistantInputCandidate[]> {
  const events = await readHostedAssistantInputEventsById(input);
  return createHostedAssistantInputCandidates({
    events,
    preserveInputOrder: input.preserveInputOrder === true,
    vaultRoot: input.vaultRoot,
  });
}

async function createHostedAssistantInputCandidates(input: {
  events: readonly AssistantInputEventRecord[];
  preserveInputOrder?: boolean;
  vaultRoot: string;
}): Promise<AssistantInputCandidate[]> {
  const hostedMailboxItems = await readHostedMailboxAssistantInputItemDetails({
    inputIds: input.events.map((event) => event.inputId),
    vault: input.vaultRoot,
  });
  const orderedEvents = [...input.events];
  if (input.preserveInputOrder !== true) {
    orderedEvents.sort((left, right) =>
      compareAssistantInputCursors(left.cursor, right.cursor)
    );
  }
  return orderedEvents
    .map((event) => {
      const hostedMailboxItem = hostedMailboxItems.get(event.inputId);
      return assistantInputCandidateFromStoredEvent(event, {
        ...(hostedMailboxItem?.groupParticipantAdded === true
          ? { groupParticipantAdded: hostedMailboxItem.groupParticipantAdded }
          : {}),
        ...(hostedMailboxItem?.groupReactionContext
          ? { groupReactionContext: hostedMailboxItem.groupReactionContext }
          : {}),
        ...(hostedMailboxItem?.groupRunningBit
          ? { groupRunningBit: hostedMailboxItem.groupRunningBit }
          : {}),
        hostedMailboxItemId: hostedMailboxItem?.mailboxItemId ?? null,
        ...(hostedMailboxItem?.usageRunningLow === true
          ? { usageRunningLow: true as const }
          : {}),
      });
    });
}

async function readHostedAssistantInputEventsById(input: {
  inputIds: readonly string[];
  missingInput?: "skip" | "throw";
  vaultRoot: string;
}): Promise<AssistantInputEventRecord[]> {
  const events: AssistantInputEventRecord[] = [];
  for (const inputId of uniqueStrings(input.inputIds)) {
    const event = await readAssistantInputEvent({
      inputId,
      vault: input.vaultRoot,
    });
    if (!event) {
      if (input.missingInput === "skip") {
        continue;
      }
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
  const events = await readHostedAssistantInputEventsById({
    inputIds: input.inputIds,
    vaultRoot: input.vaultRoot,
  });
  return filterHostedReplyablePendingAssistantInputEvents({
    events,
    vaultRoot: input.vaultRoot,
  });
}

async function filterHostedReplyablePendingAssistantInputEvents(input: {
  events: readonly AssistantInputEventRecord[];
  vaultRoot: string;
}): Promise<AssistantInputEventRecord[]> {
  const events = input.events;
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
  emittedCursorKeys?: Set<string>;
  ignoreAfterCursor?: boolean;
  preserveInputOrder?: boolean;
  query: AssistantInputCandidateQuery;
}): AssistantInputCandidateBatch {
  const knownInputIds = new Set(input.query.knownInputIds ?? []);
  const afterCursor = input.ignoreAfterCursor === true
    ? null
    : readEffectiveHostedAssistantInputSourceAfterCursor({
        afterCursor: input.query.afterCursor ?? null,
        emittedCursorKeys: input.emittedCursorKeys ?? new Set(),
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
    preserveInputOrder: input.preserveInputOrder === true,
  });
  for (const candidate of batch.inputs) {
    input.emittedCursorKeys?.add(hostedAssistantInputCursorKey(candidate.event.cursor));
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
  preserveInputOrder?: boolean;
}): AssistantInputCandidateBatch {
  const limit = normalizeHostedAssistantInputQueryLimit(input.limit);
  const selected = input.candidates.filter((candidate) =>
      input.afterCursor
        ? compareAssistantInputCursors(candidate.event.cursor, input.afterCursor) > 0
        : true
    );
  if (input.preserveInputOrder !== true) {
    selected.sort((left, right) =>
      compareAssistantInputCursors(left.event.cursor, right.event.cursor)
    );
  }
  const limited = selected.slice(0, limit);

  return {
    inputs: limited,
    nextCursor: limited.length > 0
      ? limited[limited.length - 1]!.event.cursor
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
