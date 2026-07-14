import {
  assistantInputCandidateFromStoredEvent,
  compareAssistantInputCursors,
  isSameAssistantConversationRef,
  readAssistantInputEvent,
  readAssistantOutboxIntent,
  readHostedMailboxAssistantInputItems,
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
  hasCompleteAssistantAutoReplyTerminalEvidence,
  readAssistantAutoReplyTerminalEvidenceByEvidenceId,
} from "@murphai/assistant-engine/assistant-automation";
import { assistantPreferenceCausalSeqSchema } from "@murphai/contracts";

import {
  compactHostedPendingAssistantInputIds,
  hasHostedPendingAssistantInputRouteProof,
  isHostedPendingAssistantInputStillReplyable,
  readExistingHostedPendingAssistantInputIds,
  removeHostedPendingAssistantInputIds,
} from "./pending-input-index.ts";
import {
  buildHostedAssistantLinqDeliveryContextFromStoredInputEvent,
  type HostedAssistantLinqDeliveryContext,
} from "./linq-delivery-context.ts";

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

export interface HostedConversationReplayInputSelection {
  consumedThroughSeq: string | null;
  deliveryIntentIds: string[];
  inputIds: string[];
  linqDeliveryContexts: HostedAssistantLinqDeliveryContext[];
}

export async function retireHostedConversationReplayPendingInput(input: {
  acceptedConversationSeq: string;
  vaultRoot: string;
}): Promise<boolean> {
  const acceptedConversationSeq = normalizeHostedConversationReplaySeq(
    input.acceptedConversationSeq,
  );
  if (acceptedConversationSeq === null) {
    return false;
  }

  // Finish the existing one-time backfill before removing the exact row so a
  // later compaction cannot rediscover it as nonterminal pending work.
  const pendingInputIds = await compactHostedPendingAssistantInputIds({
    vaultRoot: input.vaultRoot,
  });
  const pendingEvents = await readHostedAssistantInputEventsById({
    inputIds: pendingInputIds,
    missingInput: "skip",
    vaultRoot: input.vaultRoot,
  });
  const matchingInputIds = pendingEvents
    .filter((event) =>
      isHostedConversationMailboxInputEvent(event)
      && event.sourceRef.kind === "hosted-mailbox"
      && event.sourceRef.laneSeq === acceptedConversationSeq
    )
    .map((event) => event.inputId);
  if (matchingInputIds.length === 0) {
    return false;
  }

  await removeHostedPendingAssistantInputIds({
    inputIds: matchingInputIds,
    vaultRoot: input.vaultRoot,
  });
  return true;
}

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
  allowPendingInputRefresh?: boolean;
  initialPendingInputIds?: readonly string[] | null;
  pendingInputRefreshMode?: HostedPendingInputRefreshMode;
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
      if (input.allowPendingInputRefresh === false) {
        return {
          progressed: false,
          reason: "no_new_input",
        };
      }
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
      const added = appendSelectedHostedAssistantInputIds({
        inputIds: appendablePendingInputIds.slice(
          0,
          Math.max(0, 1 - selectedInputIds.length),
        ),
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
    const limit = normalizeHostedAssistantInputQueryLimit(input.limit);
    return {
      inputIds: pendingEvents
        .sort((left, right) =>
          compareAssistantInputCursors(left.cursor, right.cursor)
        )
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
    inputIds: freshEvents
      .sort((left, right) =>
        compareAssistantInputCursors(left.cursor, right.cursor)
      )
      .slice(0, 1)
      .map((event) => event.inputId),
    mode: "foreground",
    pendingInputIds,
  };
}

/**
 * Conversation replay owns one accepted mailbox row. It merges the bounded
 * mailbox identity handoff with compacted durable pending ids, then selects
 * only that exact row before exposing it to the assistant.
 */
export async function selectHostedConversationReplayInputs(input: {
  acceptedConversationSeq: string;
  freshAssistantInputIds?: readonly string[] | null;
  userId: string;
  vaultRoot: string;
}): Promise<HostedConversationReplayInputSelection> {
  const pendingInputIds = await compactHostedPendingAssistantInputIds({
    vaultRoot: input.vaultRoot,
  });
  const pendingInputIdSet = new Set(pendingInputIds);
  const freshEvents = await readHostedAssistantInputEventsById({
    inputIds: uniqueStrings(input.freshAssistantInputIds ?? []),
    missingInput: "skip",
    vaultRoot: input.vaultRoot,
  });
  const events = await readHostedAssistantInputEventsById({
    // Fresh imports are expected to be indexed durably before this point. The
    // compacted set is authoritative because it also excludes inputs with
    // complete terminal evidence, preventing a replayed import from replying
    // twice.
    inputIds: uniqueStrings([
      ...(input.freshAssistantInputIds ?? []).filter((inputId) =>
        pendingInputIdSet.has(inputId)
      ),
      ...pendingInputIds,
    ]),
    missingInput: "skip",
    vaultRoot: input.vaultRoot,
  });
  const orderedEvents = events
    .filter(isHostedConversationMailboxInputEvent)
    .sort((left, right) => compareAssistantInputCursors(left.cursor, right.cursor));
  const acceptedConversationSeq = normalizeHostedConversationReplaySeq(
    input.acceptedConversationSeq,
  );
  const startIndex = acceptedConversationSeq === null
    ? -1
    : orderedEvents.findIndex((event) =>
        event.sourceRef.kind === "hosted-mailbox"
        && event.sourceRef.laneSeq === acceptedConversationSeq
      );
  // The accepted allowance proof belongs to one durable mailbox row. A
  // conversation or reply anchor does not prove that adjacent rows share its
  // billing period, so later rows must reconcile under their own authority.
  const selectedEvent = startIndex >= 0 ? orderedEvents[startIndex] ?? null : null;
  const freshAcceptedEvent = acceptedConversationSeq === null
    ? null
    : freshEvents.find((event) =>
        isHostedConversationMailboxInputEvent(event)
        && event.sourceRef.kind === "hosted-mailbox"
        && event.sourceRef.laneSeq === acceptedConversationSeq
      ) ?? null;
  const exactStoredEvent = selectedEvent
    ?? freshAcceptedEvent;
  const terminalDisposition = exactStoredEvent
    ? await readHostedConversationReplayTerminalDisposition({
      event: exactStoredEvent,
      vaultRoot: input.vaultRoot,
    })
    : null;
  const selectedEvents = selectedEvent && terminalDisposition === null
    ? [selectedEvent]
    : [];
  const lastSelectedEvent = selectedEvents.at(-1) ?? null;
  const consumedThroughSeq = lastSelectedEvent?.sourceRef.kind === "hosted-mailbox"
    ? lastSelectedEvent.sourceRef.laneSeq
    : terminalDisposition?.kind === "terminal"
      ? acceptedConversationSeq
      : null;
  const deliveryIntentIds = terminalDisposition?.kind === "delivery_intent"
    ? [terminalDisposition.intentId]
    : [];
  const deliveryContextEvents = deliveryIntentIds.length > 0 && exactStoredEvent
    ? [exactStoredEvent]
    : selectedEvents;

  return {
    consumedThroughSeq,
    deliveryIntentIds,
    inputIds: selectedEvents.map((event) => event.inputId),
    linqDeliveryContexts: deliveryContextEvents.flatMap((event) => {
      const context = buildHostedAssistantLinqDeliveryContextFromStoredInputEvent({
        event,
        userId: input.userId,
      });
      return context ? [context] : [];
    }),
  };
}

async function readHostedConversationReplayTerminalDisposition(input: {
  event: AssistantInputEventRecord;
  vaultRoot: string;
}): Promise<
  | { intentId: string; kind: "delivery_intent" }
  | { kind: "terminal" }
  | null
> {
  const complete = await hasCompleteAssistantAutoReplyTerminalEvidence({
    captureId: input.event.projection.captureId,
    inputId: input.event.inputId,
    vault: input.vaultRoot,
  });
  if (!complete) {
    return null;
  }
  const evidence = await readAssistantAutoReplyTerminalEvidenceByEvidenceId(
    input.vaultRoot,
    input.event.inputId,
  );
  if (
    evidence?.terminal.kind !== "reply_intent_committed"
    || !evidence.terminal.deliveryIntentId
  ) {
    return { kind: "terminal" };
  }
  const intent = await readAssistantOutboxIntent(
    input.vaultRoot,
    evidence.terminal.deliveryIntentId,
  );
  return intent?.status === "awaiting_approval"
      || intent?.status === "pending"
      || intent?.status === "retryable"
      || intent?.status === "sending"
    ? {
        intentId: evidence.terminal.deliveryIntentId,
        kind: "delivery_intent",
      }
    : { kind: "terminal" };
}

function normalizeHostedConversationReplaySeq(value: string | null): string | null {
  return value !== null && /^[1-9][0-9]*$/u.test(value) ? value : null;
}

function isHostedConversationMailboxInputEvent(
  event: AssistantInputEventRecord,
): boolean {
  return event.sourceRef.kind === "hosted-mailbox"
    && event.sourceRef.source === "hosted-mailbox"
    && event.sourceRef.lane === "conversation"
    && event.replyTarget !== null;
}

async function readHostedAssistantInputCandidatesById(input: {
  inputIds: readonly string[];
  vaultRoot: string;
}): Promise<AssistantInputCandidate[]> {
  const events = await readHostedAssistantInputEventsById(input);
  const hostedMailboxItems = await readHostedMailboxAssistantInputItems({
    inputIds: events.map((event) => event.inputId),
    vault: input.vaultRoot,
  });
  return events
    .sort((left, right) =>
      compareAssistantInputCursors(left.cursor, right.cursor)
    )
    .map((event) =>
      assistantInputCandidateFromStoredEvent(event, {
        hostedMailboxItemId: hostedMailboxItems.get(event.inputId) ?? null,
      })
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
