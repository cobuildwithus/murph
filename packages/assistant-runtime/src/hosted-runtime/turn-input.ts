import {
  assistantInputCandidateFromStoredEvent,
  compareAssistantInputCursors,
  isSameAssistantConversationRef,
  readAssistantInputEvent,
  readHostedMailboxAssistantInputItems,
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
  hasCompleteAssistantAutoReplyTerminalEvidence,
} from "@murphai/assistant-engine/assistant-automation";
import { assistantPreferenceCausalSeqSchema } from "@murphai/contracts";

import {
  compactHostedPendingAssistantInputIds,
  hasHostedPendingAssistantInputRouteProof,
  isHostedPendingAssistantInputStillReplyable,
  readExistingHostedPendingAssistantInputIds,
} from "./pending-input-index.ts";

const DEFAULT_HOSTED_ASSISTANT_INPUT_QUERY_LIMIT = 100;

type HostedPendingInputRefreshMode = "compact" | "existing";

export type HostedAssistantInputSelection =
  | {
      activeTurnInputIds: string[];
      freshInputIds: string[];
      inputIds: string[];
      mode: "foreground";
      pendingInputIds: string[];
    }
  | {
      activeTurnInputIds: string[];
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
  if (input.assistantInputIds.length !== 1 || !input.assistantInputIds[0]) {
    return null;
  }
  const event = await readAssistantInputEvent({
    inputId: input.assistantInputIds[0],
    vault: input.vaultRoot,
  });
  if (event?.sourceRef.kind !== "hosted-mailbox") {
    return null;
  }
  return assistantPreferenceCausalSeqSchema.parse(event.sourceRef.causalSeq ?? "0");
}

export function createHostedAssistantInputSource(input: {
  /** Cursor-ordered candidates available to active-turn admission. */
  initialActiveTurnInputIds?: readonly string[] | null;
  /** All pending candidates already observed before this runtime pass. */
  initialPendingInputIds?: readonly string[] | null;
  pendingInputRefreshMode?: HostedPendingInputRefreshMode;
  selectedInputIds?: readonly string[] | null;
  vaultRoot: string;
}): HostedAssistantInputSource {
  const selectedInputIds = uniqueStrings(input.selectedInputIds ?? []);
  const selectedInputIdSet = new Set(selectedInputIds);
  const frontierInputIds = uniqueStrings(
    input.initialActiveTurnInputIds ?? selectedInputIds,
  );
  const frontierInputIdSet = new Set(frontierInputIds);
  const observedInputIds = new Set([
    ...(input.initialPendingInputIds ?? frontierInputIds),
    ...selectedInputIds,
  ]);
  const emittedListInputCandidateCursorKeys = new Set<string>();

  return {
    readObservedInputIds() {
      return [...observedInputIds];
    },
    readSelectedInputIds() {
      return [...selectedInputIds];
    },
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
        if (observedInputIds.has(inputId)) {
          continue;
        }
        observedInputIds.add(inputId);
        newPendingInputIds.push(inputId);
      }
      const appendablePendingInputIds = input.pendingInputRefreshMode === "existing"
        ? (await readHostedReplyablePendingAssistantInputEvents({
            inputIds: newPendingInputIds,
            missingInput: "skip",
            vaultRoot: input.vaultRoot,
          })).map((event) => event.inputId)
        : newPendingInputIds;
      const selectedAdded = appendHostedAssistantInputIds({
        inputIds: appendablePendingInputIds.slice(
          0,
          Math.max(0, 1 - selectedInputIds.length),
        ),
        targetInputIdSet: selectedInputIdSet,
        targetInputIds: selectedInputIds,
      });
      appendHostedAssistantInputIds({
        inputIds: appendablePendingInputIds,
        targetInputIdSet: frontierInputIdSet,
        targetInputIds: frontierInputIds,
      });
      assertHostedAssistantInputQueryNotAborted(refreshInput?.signal);
      return {
        progressed: selectedAdded > 0,
        reason: selectedAdded > 0 ? "ingested_input" : "no_new_input",
      };
    },
    async listInputCandidates(query) {
      assertHostedAssistantInputQueryNotAborted(query.signal);
      const batch = await listHostedAssistantInputCandidatesById({
        emittedCursorKeys: emittedListInputCandidateCursorKeys,
        inputIds: query.purpose === "active-turn"
          ? frontierInputIds
          : selectedInputIds,
        missingInput: query.purpose === "active-turn" ? "skip" : "throw",
        query,
        vaultRoot: input.vaultRoot,
      });
      assertHostedAssistantInputQueryNotAborted(query.signal);
      return batch;
    },
    async listNewConversationInputs(query) {
      assertHostedAssistantInputQueryNotAborted(query.signal);
      const batch = await listHostedAssistantNewConversationInputsById({
        inputIds: selectedInputIds,
        query,
        vaultRoot: input.vaultRoot,
      });
      assertHostedAssistantInputQueryNotAborted(query.signal);
      return batch;
    },
  };
}

function appendHostedAssistantInputIds(input: {
  inputIds: readonly string[];
  targetInputIdSet: Set<string>;
  targetInputIds: string[];
}): number {
  let added = 0;
  for (const inputId of input.inputIds) {
    if (input.targetInputIdSet.has(inputId)) {
      continue;
    }
    input.targetInputIdSet.add(inputId);
    input.targetInputIds.push(inputId);
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
    const limit = normalizeHostedAssistantInputQueryLimit(input.limit);
    const orderedPendingEvents = pendingEvents.sort((left, right) =>
      compareAssistantInputCursors(left.cursor, right.cursor)
    );
    return {
      activeTurnInputIds: orderedPendingEvents.map((event) => event.inputId),
      inputIds: orderedPendingEvents
        .slice(0, Math.min(limit, 1))
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
      activeTurnInputIds: [],
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
    : await readHostedReplyablePendingAssistantInputEvents({
      inputIds: pendingInputIds.filter((inputId) => !selectedInputIds.has(inputId)),
      missingInput: "skip",
      vaultRoot: input.vaultRoot,
    });

  for (const event of pendingEvents) {
    if (!isHostedPendingEventRelevantToFreshConversation({
      event,
      latestFreshEventByConversation,
    })) {
      continue;
    }
    selectedInputIds.add(event.inputId);
    eventsByInputId.set(event.inputId, event);
  }

  const activeTurnInputIds = uniqueAssistantInputEvents([
    ...pendingEvents,
    ...freshEvents,
  ])
    .sort((left, right) =>
      compareAssistantInputCursors(left.cursor, right.cursor)
    )
    .map((event) => event.inputId);

  return {
    activeTurnInputIds,
    freshInputIds,
    inputIds: [...selectedInputIds]
      .map((inputId) => eventsByInputId.get(inputId))
      .filter((event): event is AssistantInputEventRecord => event !== undefined)
      .sort((left, right) =>
        compareAssistantInputCursors(left.cursor, right.cursor)
      )
      .slice(0, 1)
      .map((event) => event.inputId),
    mode: "foreground",
    pendingInputIds,
  };
}

function uniqueAssistantInputEvents(
  events: readonly AssistantInputEventRecord[],
): AssistantInputEventRecord[] {
  return [...new Map(events.map((event) => [event.inputId, event])).values()];
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
  );
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
  const terminalRouteProofInputIds = new Set(
    (await Promise.all(replyableEvents.map(async (event) =>
      hasHostedPendingAssistantInputRouteProof(event)
      && await hasCompleteAssistantAutoReplyTerminalEvidence({
        captureId: event.projection.captureId,
        inputId: event.inputId,
        vault: input.vaultRoot,
      })
        ? event.inputId
        : null
    ))).filter((inputId): inputId is string => inputId !== null),
  );
  return replyableEvents.filter((event) =>
    !terminalRouteProofInputIds.has(event.inputId)
  );
}

async function listHostedAssistantInputCandidatesById(input: {
  emittedCursorKeys: Set<string>;
  inputIds: readonly string[];
  missingInput: "skip" | "throw";
  query: AssistantInputCandidateQuery;
  vaultRoot: string;
}): Promise<AssistantInputCandidateBatch> {
  const knownInputIds = new Set(input.query.knownInputIds ?? []);
  const afterCursor = readEffectiveHostedAssistantInputSourceAfterCursor({
    afterCursor: input.query.afterCursor ?? null,
    emittedCursorKeys: input.emittedCursorKeys,
  });
  const events = await readHostedAssistantInputEventPageById({
    afterCursor,
    inputIds: input.inputIds,
    knownInputIds,
    limit: input.query.limit,
    matches: (event) =>
      !input.query.sourceId
      || (event.conversation?.source ?? event.sourceRef.source)
        === input.query.sourceId,
    missingInput: input.missingInput,
    signal: input.query.signal,
    vaultRoot: input.vaultRoot,
  });
  const batch = await buildHostedAssistantInputCandidateBatch({
    afterCursor,
    events,
    vaultRoot: input.vaultRoot,
  });
  for (const candidate of batch.inputs) {
    input.emittedCursorKeys.add(hostedAssistantInputCursorKey(candidate.event.cursor));
  }
  return batch;
}

async function listHostedAssistantNewConversationInputsById(input: {
  inputIds: readonly string[];
  query: AssistantTurnConversationInputQuery;
  vaultRoot: string;
}): Promise<AssistantInputCandidateBatch> {
  const knownInputIds = new Set(input.query.knownInputIds ?? []);
  const knownProjectionCaptureIds = new Set(
    input.query.knownProjectionCaptureIds ?? [],
  );
  const afterCursor = input.query.afterCursor ?? null;
  const events = await readHostedAssistantInputEventPageById({
    afterCursor,
    inputIds: input.inputIds,
    knownInputIds,
    limit: input.query.limit,
    matches: (event) =>
      (!event.projection.captureId
        || !knownProjectionCaptureIds.has(event.projection.captureId))
      && isSameAssistantConversationRef(
        event.conversation,
        input.query.conversation,
      ),
    missingInput: "throw",
    signal: input.query.signal,
    vaultRoot: input.vaultRoot,
  });
  return await buildHostedAssistantInputCandidateBatch({
    afterCursor,
    events,
    vaultRoot: input.vaultRoot,
  });
}

async function readHostedAssistantInputEventPageById(input: {
  afterCursor: AssistantInputCursor | null;
  inputIds: readonly string[];
  knownInputIds: ReadonlySet<string>;
  limit?: number;
  matches: (event: AssistantInputEventRecord) => boolean;
  missingInput: "skip" | "throw";
  signal?: AbortSignal;
  vaultRoot: string;
}): Promise<AssistantInputEventRecord[]> {
  const limit = normalizeHostedAssistantInputQueryLimit(input.limit);
  const events: AssistantInputEventRecord[] = [];
  // Selection owns cursor ordering, so a full page stops further event reads;
  // mailbox sidecars are hydrated only for the selected page below.
  for (const inputId of uniqueStrings(input.inputIds)) {
    assertHostedAssistantInputQueryNotAborted(input.signal);
    if (input.knownInputIds.has(inputId)) {
      continue;
    }
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
    if (
      input.afterCursor
      && compareAssistantInputCursors(event.cursor, input.afterCursor) <= 0
    ) {
      continue;
    }
    if (!input.matches(event)) {
      continue;
    }
    events.push(event);
    if (events.length >= limit) {
      break;
    }
  }
  return events;
}

async function buildHostedAssistantInputCandidateBatch(input: {
  afterCursor: AssistantInputCursor | null;
  events: readonly AssistantInputEventRecord[];
  vaultRoot: string;
}): Promise<AssistantInputCandidateBatch> {
  const hostedMailboxItems = await readHostedMailboxAssistantInputItems({
    inputIds: input.events.map((event) => event.inputId),
    vault: input.vaultRoot,
  });
  const selected = input.events.map((event) =>
    assistantInputCandidateFromStoredEvent(event, {
      hostedMailboxItemId: hostedMailboxItems.get(event.inputId) ?? null,
    })
  );

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
