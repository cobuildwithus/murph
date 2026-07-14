import {
  assistantInputCandidateFromStoredEvent,
  assistantRouteActorInputMetadataFromStoredEvent,
  compareAssistantInputCursors,
  isSameAssistantConversationRef,
  readAssistantInputEvent,
  readHostedMailboxAssistantInputItemDetails,
  selectContiguousAssistantRouteActorInputBatch,
  selectContiguousAssistantRouteActorInputMetadataBatch,
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
import { assistantPreferenceCausalSeqSchema } from "@murphai/contracts";

import {
  compactHostedPendingAssistantInputIds,
  isHostedPendingAssistantInputStillReplyable,
  readExistingHostedPendingAssistantInputIds,
} from "./pending-input-index.ts";

const DEFAULT_HOSTED_ASSISTANT_INPUT_QUERY_LIMIT = 100;

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

export async function resolveHostedPreferenceCausalSeqForSelectedInput(input: {
  assistantInputIds: readonly string[];
  vaultRoot: string;
}): Promise<string | null> {
  const causalInputId = input.assistantInputIds[0];
  if (!causalInputId) {
    return null;
  }
  const event = await readAssistantInputEvent({
    inputId: causalInputId,
    vault: input.vaultRoot,
  });
  if (event?.sourceRef.kind !== "hosted-mailbox") {
    return null;
  }
  return assistantPreferenceCausalSeqSchema.parse(event.sourceRef.causalSeq ?? "0");
}

export function createHostedAssistantInputSource(input: {
  initialPendingInputIds?: readonly string[] | null;
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
  const availableCandidates: AssistantInputCandidate[] = [];
  const availableCandidateIds = new Set<string>();
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
      const notifiedInputIds = uniqueStrings(refreshInput?.inputIds ?? [])
        .filter((inputId) => !observedInputIds.has(inputId));
      if (notifiedInputIds.length === 0) {
        return {
          progressed: false,
          reason: "no_new_input",
        };
      }
      const pendingEvents = await readHostedReplyablePendingAssistantInputEvents({
        inputIds: notifiedInputIds,
        missingInput: "skip",
        vaultRoot: input.vaultRoot,
      });
      const hostedMailboxItems = await readHostedMailboxAssistantInputItemDetails({
        inputIds: pendingEvents.map((event) => event.inputId),
        vault: input.vaultRoot,
      });
      let added = 0;
      for (const inputId of notifiedInputIds) {
        observedInputIds.add(inputId);
      }
      for (const event of pendingEvents) {
        if (selectedInputIdSet.has(event.inputId) || availableCandidateIds.has(event.inputId)) {
          continue;
        }
        availableCandidateIds.add(event.inputId);
        const hostedMailboxItem = hostedMailboxItems.get(event.inputId);
        availableCandidates.push(assistantInputCandidateFromStoredEvent(event, {
          ...(hostedMailboxItem?.groupParticipantAdded === true
            ? { groupParticipantAdded: hostedMailboxItem.groupParticipantAdded }
            : {}),
          hostedMailboxItemId: hostedMailboxItem?.mailboxItemId ?? null,
        }));
        added += 1;
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
    async listNewConversationActorInputs(query) {
      assertHostedAssistantInputQueryNotAborted(query.signal);
      const batch = selectContiguousAssistantRouteActorInputBatch({
        candidates: availableCandidates,
        query,
      });
      const added = appendSelectedHostedAssistantInputIds({
        inputIds: batch.inputs.map((candidate) => candidate.event.inputId),
        selectedInputIdSet,
        selectedInputIds,
      });
      for (const candidate of batch.inputs) {
        observedInputIds.add(candidate.event.inputId);
      }
      if (added > 0) {
        selectedCandidatesPromise = null;
      }
      return batch;
    },
    async listNewConversationInputs(query) {
      assertHostedAssistantInputQueryNotAborted(query.signal);
      return filterHostedAssistantNewConversationInputs({
        candidates: availableCandidates,
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
    return {
      inputIds: pendingEvents
        .sort((left, right) =>
          compareAssistantInputCursors(left.cursor, right.cursor)
        )
        .slice(0, Math.min(normalizeHostedAssistantInputQueryLimit(input.limit), 1))
        .map((event) => event.inputId),
      mode: "background",
      pendingInputIds,
    };
  }

  const freshInputIds = uniqueStrings(input.freshAssistantInputIds ?? []);
  const pendingInputIds = await readExistingHostedPendingAssistantInputIds({
    vaultRoot: input.vaultRoot,
  });
  if (freshInputIds.length === 0) {
    return {
      freshInputIds,
      inputIds: [],
      mode: "foreground",
      pendingInputIds,
    };
  }

  const freshEvents = await readHostedAssistantInputEventsById({
    inputIds: freshInputIds,
    vaultRoot: input.vaultRoot,
  });

  return {
    freshInputIds,
    inputIds: selectInitialHostedAssistantInputEvents({
      events: freshEvents,
      limit: DEFAULT_HOSTED_ASSISTANT_INPUT_QUERY_LIMIT,
    }).map((event) => event.inputId),
    mode: "foreground",
    pendingInputIds,
  };
}

function selectInitialHostedAssistantInputEvents(input: {
  events: readonly AssistantInputEventRecord[];
  limit: number;
}): AssistantInputEventRecord[] {
  const sorted = [...input.events].sort((left, right) =>
    compareAssistantInputCursors(left.cursor, right.cursor)
  );
  const first = sorted[0];
  const channel = first?.replyTarget?.channel?.trim() ?? "";
  const threadId = first?.replyTarget?.threadId?.trim() ?? "";
  if (
    !first?.conversation ||
    typeof first.conversation.threadIsDirect !== "boolean" ||
    !channel ||
    !threadId
  ) {
    return first ? [first] : [];
  }
  const selected = selectContiguousAssistantRouteActorInputMetadataBatch({
    inputs: sorted.map(assistantRouteActorInputMetadataFromStoredEvent),
    query: {
      conversation: first.conversation,
      deliveryRoute: { channel, threadId },
      limit: input.limit,
    },
  });
  const selectedInputIds = new Set(selected.inputs.map((entry) => entry.inputId));
  return sorted.filter((event) => selectedInputIds.has(event.inputId));
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
        hostedMailboxItemId: hostedMailboxItem?.mailboxItemId ?? null,
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
  missingInput?: "skip" | "throw";
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
