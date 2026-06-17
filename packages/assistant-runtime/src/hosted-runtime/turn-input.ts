import {
  assistantInputCandidateFromStoredEvent,
  compareAssistantInputCursors,
  isSameAssistantConversationRef,
  readAssistantInputEvent,
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
  compactHostedPendingAssistantInputIds,
  isHostedPendingAssistantInputStillReplyable,
  readExistingHostedPendingAssistantInputIds,
} from "./pending-input-index.ts";

const DEFAULT_HOSTED_ASSISTANT_INPUT_QUERY_LIMIT = 100;

type HostedPendingInputRefreshMode = "compact" | "existing";

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

export function createHostedAssistantInputSource(input: {
  initialPendingInputIds?: readonly string[] | null;
  pendingInputRefreshMode?: HostedPendingInputRefreshMode;
  selectedInputIds?: readonly string[] | null;
  vaultRoot: string;
}): AssistantInputSource {
  const selectedInputIds = uniqueStrings(input.selectedInputIds ?? []);
  const selectedInputIdSet = new Set(selectedInputIds);
  const knownPendingInputIds = new Set(input.initialPendingInputIds ?? selectedInputIds);
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
    async refresh(refreshInput) {
      assertHostedAssistantInputQueryNotAborted(refreshInput?.signal);
      const pendingInputIds =
        input.pendingInputRefreshMode === "existing"
          ? await readExistingHostedPendingAssistantInputIds({
              vaultRoot: input.vaultRoot,
            })
          : await compactHostedPendingAssistantInputIds({
              vaultRoot: input.vaultRoot,
            });
      const newPendingInputIds: string[] = [];
      for (const inputId of pendingInputIds) {
        if (knownPendingInputIds.has(inputId)) {
          continue;
        }
        knownPendingInputIds.add(inputId);
        newPendingInputIds.push(inputId);
      }
      const added = appendSelectedHostedAssistantInputIds({
        inputIds: newPendingInputIds,
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
    const pendingEvents = await readHostedAssistantInputEventsById({
      inputIds: pendingInputIds,
      vaultRoot: input.vaultRoot,
    });
    const limit = normalizeHostedAssistantInputQueryLimit(input.limit);
    return {
      inputIds: pendingEvents
        .sort((left, right) =>
          compareAssistantInputCursors(left.cursor, right.cursor)
        )
        .slice(0, limit)
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

  const selectedInputIds = new Set(freshInputIds);
  const events = await readHostedAssistantInputEventsById({
    inputIds: freshInputIds,
    vaultRoot: input.vaultRoot,
  });
  const eventsByInputId = new Map(events.map((event) => [event.inputId, event]));
  const freshEvents = freshInputIds.map((inputId) =>
    readRequiredHostedFreshAssistantInputEvent({
      eventsByInputId,
      inputId,
    })
  );
  const latestFreshEventByConversation = selectLatestEventByConversation(freshEvents);
  const pendingEvents = latestFreshEventByConversation.length === 0
    ? []
    : await readHostedAssistantInputEventsById({
      inputIds: pendingInputIds.filter((inputId) => !selectedInputIds.has(inputId)),
      missingInput: "skip",
      vaultRoot: input.vaultRoot,
    });
  const enabledAutoReplyChannels = pendingEvents.length === 0
    ? null
    : new Set(
      (await readAssistantAutomationState(input.vaultRoot)).autoReply
        .map((entry) => entry.channel),
    );

  for (const event of pendingEvents) {
    if (
      enabledAutoReplyChannels
      && !isHostedPendingAssistantInputStillReplyable({
        enabledAutoReplyChannels,
        event,
      })
    ) {
      continue;
    }
    if (!isHostedPendingEventRelevantToFreshConversation({
      event,
      latestFreshEventByConversation,
    })) {
      continue;
    }
    selectedInputIds.add(event.inputId);
    eventsByInputId.set(event.inputId, event);
  }

  return {
    freshInputIds,
    inputIds: [...selectedInputIds]
      .map((inputId) => eventsByInputId.get(inputId))
      .filter((event): event is AssistantInputEventRecord => event !== undefined)
      .sort((left, right) =>
        compareAssistantInputCursors(left.cursor, right.cursor)
      )
      .map((event) => event.inputId),
    mode: "foreground",
    pendingInputIds,
  };
}

function readRequiredHostedFreshAssistantInputEvent(input: {
  eventsByInputId: ReadonlyMap<string, AssistantInputEventRecord>;
  inputId: string;
}): AssistantInputEventRecord {
  const event = input.eventsByInputId.get(input.inputId);
  if (!event) {
    throw new Error(
      `Hosted fresh assistant input selection references a missing input event: ${input.inputId}`,
    );
  }
  return event;
}

function isHostedPendingEventRelevantToFreshConversation(input: {
  event: AssistantInputEventRecord;
  latestFreshEventByConversation: readonly AssistantInputEventRecord[];
}): boolean {
  const { event } = input;
  if (!event.conversation) {
    return false;
  }
  return input.latestFreshEventByConversation.some((freshEvent) =>
    freshEvent.conversation
    && isSameAssistantConversationRef(
      event.conversation!,
      freshEvent.conversation,
    )
    && compareAssistantInputCursors(event.cursor, freshEvent.cursor) <= 0
  );
}

async function readHostedAssistantInputCandidatesById(input: {
  inputIds: readonly string[];
  vaultRoot: string;
}): Promise<AssistantInputCandidate[]> {
  const events = await readHostedAssistantInputEventsById(input);
  return events
    .sort((left, right) =>
      compareAssistantInputCursors(left.cursor, right.cursor)
    )
    .map(assistantInputCandidateFromStoredEvent);
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

function selectLatestEventByConversation(
  events: readonly AssistantInputEventRecord[],
): AssistantInputEventRecord[] {
  const latestEvents: AssistantInputEventRecord[] = [];

  for (const event of events) {
    if (!event.conversation) {
      continue;
    }
    const existingIndex = latestEvents.findIndex((candidate) =>
      isSameAssistantConversationRef(candidate.conversation, event.conversation)
    );
    if (existingIndex === -1) {
      latestEvents.push(event);
      continue;
    }
    const existing = latestEvents[existingIndex]!;
    if (compareAssistantInputCursors(event.cursor, existing.cursor) > 0) {
      latestEvents[existingIndex] = event;
    }
  }

  return latestEvents;
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
