import {
  assistantInputCandidateFromStoredEvent,
  assistantInputCandidateMatchesDeliveryRoute,
  compareAssistantInputCursors,
  isAssistantInputEventDeferredContextCausalForActionable,
  isSameAssistantConversationRef,
  readAssistantInputEvent,
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
import { assistantPreferenceCausalSeqSchema } from "@murphai/contracts";
import {
  HOSTED_DEFERRED_GROUP_CONTEXT_MAX_PER_GROUP,
  HOSTED_DEFERRED_GROUP_CONTEXT_MAX_TOTAL,
} from "@murphai/hosted-execution/runtime-control";

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
    const orderedEvents = pendingEvents.sort((left, right) =>
      compareAssistantInputCursors(left.cursor, right.cursor)
    );
    const limit = normalizeHostedAssistantInputQueryLimit(input.limit);
    const actionableEvents = orderedEvents
      .filter((event) => !isHostedDeferredContextInputEvent(event))
      .slice(0, Math.min(limit, 1));
    const actionableInputIds = new Set(
      actionableEvents.map((event) => event.inputId),
    );
    return {
      inputIds: orderedEvents
        .filter((event) =>
          actionableInputIds.has(event.inputId)
          || (
            isHostedDeferredContextInputEvent(event)
            && actionableEvents.some((actionable) =>
              isAssistantInputEventDeferredContextCausalForActionable({
                actionable,
                context: event,
              })
            )
          )
        )
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
  const actionableEvent = freshEvents
    .sort((left, right) =>
      compareAssistantInputCursors(left.cursor, right.cursor)
    )
    .find((event) => !isHostedDeferredContextInputEvent(event)) ?? null;
  const matchingContextEvents = actionableEvent === null
    ? []
    : [
        ...freshEvents,
        ...(await readHostedReplyablePendingAssistantInputEvents({
          inputIds: pendingInputIds.filter(
            (inputId) => !freshInputIds.includes(inputId),
          ),
          missingInput: "skip",
          vaultRoot: input.vaultRoot,
        })),
      ].filter((event) =>
        isHostedDeferredContextInputEvent(event)
        && isAssistantInputEventDeferredContextCausalForActionable({
          actionable: actionableEvent,
          context: event,
        })
      );

  return {
    freshInputIds,
    inputIds: actionableEvent === null
      ? []
      : [...matchingContextEvents, actionableEvent]
          .sort((left, right) =>
            compareAssistantInputCursors(left.cursor, right.cursor)
          )
          .map((event) => event.inputId),
    mode: "foreground",
    pendingInputIds,
  };
}

function isHostedDeferredContextInputEvent(
  event: AssistantInputEventRecord,
): boolean {
  return event.sourceMetadata?.kind === "linq"
    && event.sourceMetadata.contextOnly === true;
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
  return replyableEvents;
}

function filterHostedAssistantInputCandidates(input: {
  candidates: readonly AssistantInputCandidate[];
  emittedCursorKeys: Set<string>;
  query: AssistantInputCandidateQuery;
}): AssistantInputCandidateBatch {
  const knownInputIds = new Set(input.query.knownInputIds ?? []);
  const knownProjectionCaptureIds = new Set(
    input.query.knownProjectionCaptureIds ?? [],
  );
  const afterCursor = readEffectiveHostedAssistantInputSourceAfterCursor({
    afterCursor: input.query.afterCursor ?? null,
    emittedCursorKeys: input.emittedCursorKeys,
  });
  const batch = buildHostedAssistantInputCandidateBatch({
    actionableLimit: input.query.actionableLimit,
    afterCursor,
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
      if (
        input.query.sourceId
        && candidate.event.source !== input.query.sourceId
      ) {
        return false;
      }
      if (
        input.query.deliveryRoute
        && !assistantInputCandidateMatchesDeliveryRoute({
          candidate,
          deliveryRoute: input.query.deliveryRoute,
        })
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
  actionableLimit?: number;
  afterCursor: AssistantInputCursor | null;
  candidates: readonly AssistantInputCandidate[];
  limit?: number;
}): AssistantInputCandidateBatch {
  const limit = normalizeHostedAssistantInputQueryLimit(input.limit);
  const candidates = input.candidates
    .filter((candidate) =>
      input.afterCursor
        ? compareAssistantInputCursors(candidate.event.cursor, input.afterCursor) > 0
        : true
    )
    .sort((left, right) =>
      compareAssistantInputCursors(left.event.cursor, right.event.cursor)
    );
  const selected = input.actionableLimit === undefined
    ? candidates.slice(0, limit)
    : selectHostedAssistantInputCandidates({
        actionableLimit: input.actionableLimit,
        candidates,
        limit,
      });

  return {
    inputs: selected,
    nextCursor: selected.length > 0
      ? selected[selected.length - 1]!.event.cursor
      : input.afterCursor,
  };
}

function selectHostedAssistantInputCandidates(input: {
  actionableLimit: number;
  candidates: readonly AssistantInputCandidate[];
  limit: number;
}): AssistantInputCandidate[] {
  const allActionable = input.candidates
    .filter((candidate) => !isHostedDeferredContextCandidate(candidate))
  const actionable = allActionable.slice(0, Math.min(
    input.limit,
    normalizeHostedAssistantInputQueryLimit(
      input.actionableLimit,
    ),
  ));
  const nextActionable = allActionable[actionable.length] ?? null;
  const contextBudget = Math.max(0, input.limit - actionable.length);
  const context = actionable.length === 0 || contextBudget === 0
    ? []
    : retainHostedDeferredContextCandidatesWithinLimits(
        input.candidates
          .filter(isHostedDeferredContextCandidate)
          .filter((candidate) =>
            nextActionable === null
            || compareAssistantInputCursors(
              candidate.event.cursor,
              nextActionable.event.cursor,
            ) < 0
          )
          .filter((candidate) => actionable.some((actionableCandidate) =>
            isAssistantInputEventDeferredContextCausalForActionable({
              actionable: actionableCandidate.event,
              context: candidate.event,
            })
          ))
          .sort(compareHostedDeferredContextCandidateSemanticOrder),
        contextBudget,
      );
  return [...context, ...actionable].sort((left, right) =>
    compareAssistantInputCursors(left.event.cursor, right.event.cursor)
  );
}

function retainHostedDeferredContextCandidatesWithinLimits(
  candidates: readonly AssistantInputCandidate[],
  contextBudget: number,
): AssistantInputCandidate[] {
  const retainedInputIds = new Set<string>();
  const candidatesByGroup = new Map<string, AssistantInputCandidate[]>();
  for (const candidate of candidates) {
    const groupKey = hostedDeferredContextCandidateGroupKey(candidate);
    const groupCandidates = candidatesByGroup.get(groupKey) ?? [];
    groupCandidates.push(candidate);
    candidatesByGroup.set(groupKey, groupCandidates);
  }
  for (const groupCandidates of candidatesByGroup.values()) {
    for (const candidate of groupCandidates.slice(
      -HOSTED_DEFERRED_GROUP_CONTEXT_MAX_PER_GROUP,
    )) {
      retainedInputIds.add(candidate.event.inputId);
    }
  }
  return candidates
    .filter((candidate) => retainedInputIds.has(candidate.event.inputId))
    .slice(-Math.min(contextBudget, HOSTED_DEFERRED_GROUP_CONTEXT_MAX_TOTAL));
}

function hostedDeferredContextCandidateGroupKey(
  candidate: AssistantInputCandidate,
): string {
  return JSON.stringify([
    candidate.event.conversation?.source ?? null,
    candidate.event.conversation?.accountId ?? null,
    candidate.event.conversation?.threadId ?? null,
    candidate.event.conversation?.threadIsDirect ?? null,
  ]);
}

function compareHostedDeferredContextCandidateSemanticOrder(
  left: AssistantInputCandidate,
  right: AssistantInputCandidate,
): number {
  const leftOccurredAt = Date.parse(left.event.occurredAt);
  const rightOccurredAt = Date.parse(right.event.occurredAt);
  if (
    Number.isFinite(leftOccurredAt)
    && Number.isFinite(rightOccurredAt)
    && leftOccurredAt !== rightOccurredAt
  ) {
    return leftOccurredAt - rightOccurredAt;
  }
  return compareAssistantInputCursors(left.event.cursor, right.event.cursor);
}

function isHostedDeferredContextCandidate(
  candidate: AssistantInputCandidate,
): boolean {
  return candidate.event.sourceMetadata?.kind === "linq"
    && candidate.event.sourceMetadata.contextOnly === true;
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
