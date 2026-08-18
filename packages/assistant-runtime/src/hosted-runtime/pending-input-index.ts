import path from "node:path";

import {
  hasCompleteAssistantAutoReplyTerminalEvidence,
  readAssistantAutoReplyTerminalEvidenceByEvidenceId,
  writeAssistantAutoReplySuppressionEvidence,
} from "@murphai/assistant-engine/assistant-automation";
import {
  markAssistantOutboxIntentMirrorTerminalById,
} from "@murphai/assistant-engine/assistant-outbox";
import {
  compareAssistantInputCursors,
  createStoreBackedAssistantInputSource,
  DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT,
  isAssistantHostedImageCompletionEvent,
  listAssistantInputEvents,
  readAssistantInputEvent,
  readHostedMailboxAssistantInputItemDetails,
  retireAssistantInputEventContent,
  type AssistantInputCursor,
  type AssistantInputEventRecord,
} from "@murphai/assistant-engine";
import {
  readAssistantAutomationState,
  withAssistantRuntimeWriteLock,
} from "@murphai/assistant-engine/assistant-state";
import {
  INBOX_MEDIA_RETENTION_WINDOW_MS,
  INBOX_TEXT_RETENTION_WINDOW_MS,
} from "@murphai/inboxd/retention";
import {
  parseVersionedJsonStateEnvelope,
  readLocalStateTextFile,
} from "@murphai/runtime-state/node";
import {
  HOSTED_WORKSPACE_CHECKPOINT_HANDLED_CONVERSATION_ITEM_MAX_IDS,
} from "@murphai/hosted-execution/runtime-control";
import {
  resolveAssistantStatePaths,
  writeAssistantStateVersionedJson,
} from "@murphai/runtime-state/node/assistant-state-fs";

export const HOSTED_PENDING_ASSISTANT_INPUT_STATE_SCHEMA =
  "murph.hosted-pending-assistant-inputs.v2";
export const HOSTED_PENDING_ASSISTANT_INPUT_STATE_SCHEMA_VERSION = 2;
export const HOSTED_PENDING_ASSISTANT_INPUT_STATE_RELATIVE_PATH =
  ".runtime/operations/assistant/hosted-pending-inputs.json";

export interface HostedPendingAssistantInputState {
  backfilled: boolean;
  hasImageCompletionCandidate: boolean;
  handledBatchCursorInputId: string | null;
  inputIds: string[];
}

export interface HostedPendingAssistantInputMediaRetentionProtections {
  protectedAttachmentIds: string[];
  protectedCaptureIds: string[];
  protectedStoredPaths: string[];
}

export interface HostedPendingAssistantInputContentRetentionResult {
  inputsRetired: number;
  inputsSuppressed: number;
  nextEligibleAt: string | null;
}

export const HOSTED_PENDING_INPUT_RETENTION_SUPPRESSION_REASON =
  "message content expired before a reply completed";

interface HostedPendingAssistantInputStateReadResult {
  legacy: boolean;
  missing: boolean;
  state: HostedPendingAssistantInputState;
}

interface HostedPendingAssistantInputCompactionResult {
  handledConversationBatchCursorInputId: string | null;
  handledConversationFrontierInputId: string | null;
  handledConversationInputIds: string[];
  runnableInputIds: string[];
  unresolvedInputIds: string[];
}

export interface HostedConversationMailboxHandledItemCandidate {
  inputId: string;
  mailboxItemId: string;
}

export interface HostedConversationMailboxHandledItemBatch {
  candidates: HostedConversationMailboxHandledItemCandidate[];
  frontierSelected: boolean;
  nextCursorInputId: string | null;
}

export interface HostedConversationMailboxHandledItemSelection {
  frontierSelected: boolean;
  itemIds: string[];
}

const HOSTED_PENDING_ASSISTANT_INPUT_STATE_LABEL =
  "hosted pending assistant input state";
const HOSTED_PENDING_ASSISTANT_INPUT_LEGACY_STATE_SCHEMA =
  "murph.hosted-pending-assistant-inputs.v1";
const HOSTED_PENDING_ASSISTANT_INPUT_LEGACY_STATE_SCHEMA_VERSION = 1;
const HOSTED_PENDING_ASSISTANT_INPUT_STATE_KEYS =
  new Set([
    "backfilled",
    "handledBatchCursorInputId",
    "hasImageCompletionCandidate",
    "inputIds",
  ]);
const HOSTED_PENDING_ASSISTANT_INPUT_INSPECTION_WAVE_SIZE = 8;
const HOSTED_PENDING_INPUT_RETENTION_DELIVERABLE_STATUSES = [
  "awaiting_approval",
  "pending",
  "retryable",
  "sending",
] as const;
type HostedPendingAssistantInputReplyabilityEvent = Pick<
  AssistantInputEventRecord,
  "conversation" | "replyTarget" | "sourceRef"
>;

export function resolveHostedPendingAssistantInputStatePath(
  vaultRoot: string,
): string {
  return resolveHostedPendingAssistantInputStatePathFromRoot(
    resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
  );
}

export async function readHostedPendingAssistantInputIds(input: {
  vaultRoot: string;
}): Promise<string[]> {
  return [...(await readHostedPendingAssistantInputState(input)).inputIds];
}

export async function readHostedPendingAssistantImageCompletionRecoveryInputIds(
  input: {
    vaultRoot: string;
  },
): Promise<string[]> {
  const state = await readHostedPendingAssistantInputState(input);
  // Return the complete pending cohort only when completion recovery can use
  // it. This keeps route and post-origin selection in its existing owner while
  // making the ordinary foreground case a single index-file read.
  return state.hasImageCompletionCandidate ? [...state.inputIds] : [];
}

export async function readExistingHostedPendingAssistantInputIds(input: {
  vaultRoot: string;
}): Promise<string[]> {
  const existing = await readHostedPendingAssistantInputStateAtPath({
    filePath: resolveHostedPendingAssistantInputStatePath(input.vaultRoot),
  });
  return existing.missing ? [] : [...existing.state.inputIds];
}

export async function collectHostedPendingAssistantInputMediaRetentionProtections(input: {
  now?: Date | string;
  vaultRoot: string;
}): Promise<HostedPendingAssistantInputMediaRetentionProtections> {
  const inputIds = await compactHostedUnresolvedAssistantInputIds({
    vaultRoot: input.vaultRoot,
  });
  const protectedAttachmentIds = new Set<string>();
  const protectedCaptureIds = new Set<string>();
  const protectedStoredPaths = new Set<string>();
  const protectionCutoffMs =
    resolveCollectionNowMs(input.now) - INBOX_MEDIA_RETENTION_WINDOW_MS;

  for (const inputId of inputIds) {
    const event = await readAssistantInputEvent({
      inputId,
      vault: input.vaultRoot,
    });
    if (!event) {
      continue;
    }

    // A pending assistant input must not pin its referenced raw media past
    // the 14-day inbox-media retention window. Without this cap, an input
    // that never produces terminal evidence — AI-denied user who never
    // upgrades, a churned account, a transient failure that never recovers
    // — would silently extend retention forever. Use the same window
    // constant as the retention sweep so the two cannot drift.
    if (isHostedPendingAssistantInputOlderThanRetention({
      cutoffMs: protectionCutoffMs,
      event,
    })) {
      continue;
    }

    if (event.projection.captureId) {
      protectedCaptureIds.add(event.projection.captureId);
    }
    if (event.attachmentEvidence.optionalInboxCaptureId) {
      protectedCaptureIds.add(event.attachmentEvidence.optionalInboxCaptureId);
    }

    for (const attachment of event.attachmentEvidence.attachments) {
      if (!isRetainableAssistantInputMediaKind(attachment.kind)) {
        continue;
      }
      if (attachment.sourceAttachmentId) {
        protectedAttachmentIds.add(attachment.sourceAttachmentId);
      }
      if (attachment.descriptorAttachmentId) {
        protectedAttachmentIds.add(attachment.descriptorAttachmentId);
      }
      if (attachment.raw?.path) {
        protectedStoredPaths.add(attachment.raw.path);
      }
    }
  }

  return {
    protectedAttachmentIds: [...protectedAttachmentIds].sort(),
    protectedCaptureIds: [...protectedCaptureIds].sort(),
    protectedStoredPaths: [...protectedStoredPaths].sort(),
  };
}

export async function runHostedPendingAssistantInputContentRetention(input: {
  now?: Date | string;
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<HostedPendingAssistantInputContentRetentionResult> {
  input.signal?.throwIfAborted();
  const now = normalizeHostedPendingInputRetentionNow(input.now);
  const cutoffMs = now.getTime() - INBOX_TEXT_RETENTION_WINDOW_MS;
  const listed = await listAssistantInputEvents({
    limit: Number.MAX_SAFE_INTEGER,
    signal: input.signal,
    vault: input.vaultRoot,
  });
  const candidates: Array<{
    event: AssistantInputEventRecord;
    terminal: boolean;
  }> = [];
  let nextEligibleAt: string | null = null;

  for (const event of listed.events) {
    input.signal?.throwIfAborted();
    if (event.contentRetiredAt) {
      continue;
    }
    const receivedAtMs = resolveHostedPendingInputReceivedAtMs(event);
    if (!Number.isFinite(receivedAtMs)) {
      // Invalid responsibility timestamps cannot extend private-content
      // retention. Treat them as due and preserve the structural event.
      candidates.push({
        event,
        terminal: await resolveHostedPendingInputRetentionTerminality({
          event,
          now,
          vaultRoot: input.vaultRoot,
        }),
      });
      continue;
    }
    if (receivedAtMs > cutoffMs) {
      nextEligibleAt = selectEarlierHostedPendingInputRetentionWake(
        nextEligibleAt,
        new Date(
          receivedAtMs + INBOX_TEXT_RETENTION_WINDOW_MS,
        ).toISOString(),
      );
      continue;
    }
    candidates.push({
      event,
      terminal: await resolveHostedPendingInputRetentionTerminality({
        event,
        now,
        vaultRoot: input.vaultRoot,
      }),
    });
  }

  let inputsRetired = 0;
  let inputsSuppressed = 0;
  for (const candidate of candidates) {
    input.signal?.throwIfAborted();
    if (!candidate.terminal) {
      await writeAssistantAutoReplySuppressionEvidence({
        captureIds: candidate.event.projection.captureId
          ? [candidate.event.projection.captureId]
          : [],
        inputIds: [candidate.event.inputId],
        reason: HOSTED_PENDING_INPUT_RETENTION_SUPPRESSION_REASON,
        recordedAt: now.toISOString(),
        vault: input.vaultRoot,
      });
      inputsSuppressed += 1;
    }
    const retired = await retireAssistantInputEventContent({
      inputId: candidate.event.inputId,
      now,
      signal: input.signal,
      vault: input.vaultRoot,
    });
    if (retired.retired) {
      inputsRetired += 1;
    }
  }

  return {
    inputsRetired,
    inputsSuppressed,
    nextEligibleAt,
  };
}

async function resolveHostedPendingInputRetentionTerminality(input: {
  event: AssistantInputEventRecord;
  now: Date;
  vaultRoot: string;
}): Promise<boolean> {
  const evidence =
    await readAssistantAutoReplyTerminalEvidenceByEvidenceId(
      input.vaultRoot,
      input.event.inputId,
    )
    ?? (
      input.event.projection.captureId
        ? await readAssistantAutoReplyTerminalEvidenceByEvidenceId(
            input.vaultRoot,
            input.event.projection.captureId,
          )
        : null
    );
  if (evidence?.terminal.kind !== "reply_intent_committed") {
    return await hasCompleteAssistantAutoReplyTerminalEvidence({
      captureId: input.event.projection.captureId,
      inputId: input.event.inputId,
      vault: input.vaultRoot,
    });
  }

  const intentId = evidence.terminal.deliveryIntentId;
  if (!intentId) {
    return false;
  }
  let intent: Awaited<
    ReturnType<typeof markAssistantOutboxIntentMirrorTerminalById>
  > = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    intent = await markAssistantOutboxIntentMirrorTerminalById({
      error: Object.assign(
        new Error(HOSTED_PENDING_INPUT_RETENTION_SUPPRESSION_REASON),
        { code: "ASSISTANT_AUTO_REPLY_CONTENT_EXPIRED" },
      ),
      failedAt: input.now,
      intentId,
      onlyCurrentStatuses: HOSTED_PENDING_INPUT_RETENTION_DELIVERABLE_STATUSES,
      status: "abandoned",
      vault: input.vaultRoot,
    });
    if (
      intent === null
      || !isHostedPendingInputRetentionDeliverableStatus(intent.status)
    ) {
      break;
    }
  }
  if (
    intent
    && isHostedPendingInputRetentionDeliverableStatus(intent.status)
  ) {
    // A prepared-dispatch claim can change the ownership token between the
    // by-id read and the locked compare. Retry from the new owner above; if
    // contention persists, fail the retention pass so it never retires the
    // input while leaving a later reply deliverable.
    throw new Error(
      "Assistant input retention could not terminalize its deliverable reply intent.",
    );
  }

  // Only a durable sent outcome proves the member was answered. Every
  // deliverable state, including a stale sending claim whose provider outcome
  // is ambiguous, is abandoned above so retention cannot later redispatch it.
  // Abandoned, failed, or missing intents become policy non-replies.
  return intent?.status === "sent";
}

function isHostedPendingInputRetentionDeliverableStatus(
  status: string,
): boolean {
  return HOSTED_PENDING_INPUT_RETENTION_DELIVERABLE_STATUSES.some(
    (candidate) => candidate === status,
  );
}

function resolveHostedPendingInputReceivedAtMs(
  event: AssistantInputEventRecord,
): number {
  return Date.parse(event.receivedAt ?? event.occurredAt);
}

function normalizeHostedPendingInputRetentionNow(
  value: Date | string | undefined,
): Date {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return new Date(value);
  }
  return new Date();
}

function selectEarlierHostedPendingInputRetentionWake(
  current: string | null,
  candidate: string,
): string {
  return current === null || Date.parse(candidate) < Date.parse(current)
    ? candidate
    : current;
}

function isHostedPendingAssistantInputOlderThanRetention(input: {
  cutoffMs: number;
  event: AssistantInputEventRecord;
}): boolean {
  // Prefer receivedAt — when the system became responsible for the input —
  // and fall back to occurredAt for older records that pre-date receivedAt.
  // Missing/invalid timestamps fail closed (protection drops) so a corrupt
  // record can never silently extend privacy retention.
  const timestamp = input.event.receivedAt ?? input.event.occurredAt;
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs)) {
    return true;
  }
  return timestampMs <= input.cutoffMs;
}

function resolveCollectionNowMs(value: Date | string | undefined): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

export async function hasHostedPendingAssistantInputWakeCandidate(input: {
  vaultRoot: string;
}): Promise<boolean> {
  return (await compactHostedPendingAssistantInputIds({
    vaultRoot: input.vaultRoot,
  })).length > 0;
}

export async function inspectHostedPendingAssistantInputWakeCandidate(input: {
  vaultRoot: string;
}): Promise<{ hasCandidate: boolean; indexComplete: boolean }> {
  const existing = await readHostedPendingAssistantInputStateAtPath({
    filePath: resolveHostedPendingAssistantInputStatePath(input.vaultRoot),
  });
  const inputIds = existing.state.inputIds;
  const enabledAutoReplyChannels = new Set(
    (await readAssistantAutomationState(input.vaultRoot)).autoReply
      .map((entry) => entry.channel),
  );
  const probeLimit = Math.min(
    inputIds.length,
    DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT,
  );
  let probed = 0;
  let end = inputIds.length;
  while (probed < probeLimit) {
    const waveSize = Math.min(
      HOSTED_PENDING_ASSISTANT_INPUT_INSPECTION_WAVE_SIZE,
      probeLimit - probed,
    );
    const start = end - waveSize;
    const existingEvents = await Promise.all(
      inputIds.slice(start, end).map((inputId) =>
        readAssistantInputEvent({
          inputId,
          vault: input.vaultRoot,
        })
      ),
    );
    const replyableEvents = existingEvents.filter(
      (event): event is AssistantInputEventRecord =>
        event !== null
        && isHostedPendingAssistantInputStillReplyable({
          enabledAutoReplyChannels,
          event,
        }),
    );
    const incompleteReplyableEvidence = await Promise.all(
      replyableEvents.map(async (event) =>
        !await hasCompleteAssistantAutoReplyTerminalEvidence({
          captureId: event.projection.captureId,
          inputId: event.inputId,
          vault: input.vaultRoot,
        })
      ),
    );
    if (incompleteReplyableEvidence.some(Boolean)) {
      return {
        hasCandidate: true,
        indexComplete:
          !existing.missing
          && !existing.legacy
          && existing.state.backfilled,
      };
    }
    probed += waveSize;
    end = start;
  }

  return {
    // Missing indexed events remain durable pending-state blockers, but they
    // cannot be selected as runnable assistant work or schedule an immediate
    // hot loop. A legacy index is also incomplete until compaction rebuilds it
    // from retained events. Probe newest-first in bounded waves so fresh
    // appended input is discovered quickly without an unbounded filesystem
    // burst. If the bound is exhausted, defer ordinary maintenance instead of
    // guessing that the whole index contains no runnable event.
    hasCandidate: false,
    indexComplete:
      !existing.missing
      && !existing.legacy
      && existing.state.backfilled
      && probed === inputIds.length,
  };
}

export async function enqueueHostedPendingAssistantInputId(input: {
  inputId: string;
  vaultRoot: string;
}): Promise<string[]> {
  const inputId = parseHostedPendingAssistantInputId(input.inputId);
  const indexedEvent = await readAssistantInputEvent({
    inputId,
    vault: input.vaultRoot,
  });
  const hasImageCompletionCandidate =
    indexedEvent === null
    || isAssistantHostedImageCompletionEvent(indexedEvent);
  return await withAssistantRuntimeWriteLock(input.vaultRoot, async (paths) => {
    const existing = await readHostedPendingAssistantInputStateForWrite({
      filePath: resolveHostedPendingAssistantInputStatePathFromRoot(
        paths.assistantStateRoot,
      ),
      missingState: createEmptyHostedPendingAssistantInputState({
        backfilled: false,
      }),
    });
    const state = existing.state;
    const nextState = appendHostedPendingAssistantInputId({
      hasImageCompletionCandidate,
      inputId,
      state,
    });
    if (sameHostedPendingAssistantInputState(nextState, state)) {
      return [...state.inputIds];
    }

    await writeHostedPendingAssistantInputStateAtPath({
      filePath: resolveHostedPendingAssistantInputStatePathFromRoot(
        paths.assistantStateRoot,
      ),
      legacy: existing.legacy,
      state: nextState,
    });
    return [...nextState.inputIds];
  });
}

export async function compactHostedPendingAssistantInputIds(input: {
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<string[]> {
  return [...(await compactHostedPendingAssistantInputState({
    ...input,
    collectHandledConversationInputIds: false,
    consumedConversationThroughSeq: null,
  })).runnableInputIds];
}

export async function compactHostedUnresolvedAssistantInputIds(input: {
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<string[]> {
  return [...(await compactHostedPendingAssistantInputState({
    ...input,
    collectHandledConversationInputIds: false,
    consumedConversationThroughSeq: null,
  })).unresolvedInputIds];
}

export async function compactHostedConversationMailboxHandledItemIds(input: {
  consumedThroughSeq: string | null;
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<string[]> {
  const selection = await compactHostedConversationMailboxHandledItemSelection(input);
  return selection.itemIds;
}

export async function compactHostedConversationMailboxHandledItemSelection(input: {
  consumedThroughSeq: string | null;
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<HostedConversationMailboxHandledItemSelection> {
  const compacted = await compactHostedPendingAssistantInputState({
    ...input,
    collectHandledConversationInputIds: true,
    consumedConversationThroughSeq:
      parseHostedMailboxConversationSeq(input.consumedThroughSeq),
  });
  const handledInputIds = compacted.handledConversationInputIds;
  const details = await readHostedMailboxAssistantInputItemDetails({
    inputIds: handledInputIds,
    signal: input.signal,
    vault: input.vaultRoot,
  });
  const candidates = handledInputIds.flatMap((inputId) => {
    const item = details.get(inputId);
    return item
      ? [{ inputId, mailboxItemId: item.mailboxItemId }]
      : [];
  });
  const batch = selectHostedConversationMailboxHandledItemBatch({
    candidates,
    cursorInputId: compacted.handledConversationBatchCursorInputId,
    frontierInputId: compacted.handledConversationFrontierInputId,
  });
  if (batch.nextCursorInputId !== null) {
    await advanceHostedConversationMailboxHandledBatchCursor({
      cursorInputId: batch.nextCursorInputId,
      signal: input.signal,
      vaultRoot: input.vaultRoot,
    });
  }
  return {
    frontierSelected: batch.frontierSelected,
    itemIds: batch.candidates.map((candidate) => candidate.mailboxItemId),
  };
}

export function selectHostedConversationMailboxHandledItemBatch(input: {
  candidates: readonly HostedConversationMailboxHandledItemCandidate[];
  cursorInputId: string | null;
  frontierInputId: string | null;
}): HostedConversationMailboxHandledItemBatch {
  if (input.candidates.length === 0) {
    return {
      candidates: [],
      frontierSelected: false,
      nextCursorInputId: null,
    };
  }

  const cursorIndex = input.cursorInputId === null
    ? -1
    : input.candidates.findIndex(
      (candidate) => candidate.inputId === input.cursorInputId,
    );
  const startIndex = cursorIndex < 0
    ? 0
    : (cursorIndex + 1) % input.candidates.length;
  const batchSize = Math.min(
    input.candidates.length,
    HOSTED_WORKSPACE_CHECKPOINT_HANDLED_CONVERSATION_ITEM_MAX_IDS,
  );
  const candidates = Array.from({ length: batchSize }, (_, offset) =>
    input.candidates[(startIndex + offset) % input.candidates.length]!
  );
  return {
    candidates,
    frontierSelected:
      input.frontierInputId !== null
      && candidates.some((candidate) => candidate.inputId === input.frontierInputId),
    nextCursorInputId: candidates.at(-1)?.inputId ?? null,
  };
}

async function advanceHostedConversationMailboxHandledBatchCursor(input: {
  cursorInputId: string;
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<void> {
  const cursorInputId = parseHostedPendingAssistantInputId(input.cursorInputId);
  await withAssistantRuntimeWriteLock(input.vaultRoot, async (paths) => {
    input.signal?.throwIfAborted();
    const filePath = resolveHostedPendingAssistantInputStatePathFromRoot(
      paths.assistantStateRoot,
    );
    const existing = await readHostedPendingAssistantInputStateAtPath({
      filePath,
    });
    if (existing.missing || existing.legacy) {
      throw new Error(
        "Hosted handled-item batch cursor requires a current pending-input index.",
      );
    }
    const nextCursorInputId = existing.state.inputIds.includes(cursorInputId)
      ? cursorInputId
      : null;
    if (existing.state.handledBatchCursorInputId === nextCursorInputId) {
      return;
    }
    await writeHostedPendingAssistantInputStateAtPath({
      filePath,
      state: {
        ...existing.state,
        handledBatchCursorInputId: nextCursorInputId,
      },
    });
    input.signal?.throwIfAborted();
  }, input.signal);
}

async function compactHostedPendingAssistantInputState(input: {
  collectHandledConversationInputIds: boolean;
  consumedConversationThroughSeq: bigint | null;
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<HostedPendingAssistantInputCompactionResult> {
  input.signal?.throwIfAborted();
  const filePath = resolveHostedPendingAssistantInputStatePath(input.vaultRoot);
  const existingBeforeLock = await readHostedPendingAssistantInputStateAtPath({
    filePath,
  });
  input.signal?.throwIfAborted();
  const backfilledState = existingBeforeLock.missing
    || (!existingBeforeLock.legacy && !existingBeforeLock.state.backfilled)
    ? await createBackfilledHostedPendingAssistantInputState({
      signal: input.signal,
      vaultRoot: input.vaultRoot,
    })
    : null;
  input.signal?.throwIfAborted();
  const result = await withAssistantRuntimeWriteLock(input.vaultRoot, async (paths) => {
    const filePath = resolveHostedPendingAssistantInputStatePathFromRoot(
      paths.assistantStateRoot,
    );
    const existingForWrite = await readHostedPendingAssistantInputStateForWrite({
      filePath,
      missingState: backfilledState,
    });
    const stateBeforeCompaction = existingForWrite.state;
    input.signal?.throwIfAborted();
    let state: HostedPendingAssistantInputState;
    if (existingForWrite.legacy) {
      // V1 did not record why an input ID was absent. Recover only omitted
      // events whose terminal evidence proves they cannot become a stale
      // reply; retain every ID v1 still carried. Ambiguous omitted
      // nonterminal events remain categorically nonreplyable.
      state = mergeHostedPendingAssistantInputBackfill({
        backfilledState:
          await createLegacyHostedPendingAssistantTerminalRecoveryState({
            signal: input.signal,
            vaultRoot: input.vaultRoot,
          }),
        state: stateBeforeCompaction,
      });
    } else if (stateBeforeCompaction.backfilled) {
      state = stateBeforeCompaction;
    } else {
      state = mergeHostedPendingAssistantInputBackfill({
        backfilledState: backfilledState
          ?? await createBackfilledHostedPendingAssistantInputState({
            signal: input.signal,
            vaultRoot: input.vaultRoot,
          }),
        state: stateBeforeCompaction,
      });
    }
    input.signal?.throwIfAborted();
    return await compactHostedPendingAssistantInputStateForWrite({
      backfilled: true,
      collectHandledConversationInputIds:
        input.collectHandledConversationInputIds,
      consumedConversationThroughSeq: input.consumedConversationThroughSeq,
      filePath,
      forceCurrentSchemaWrite: existingForWrite.legacy,
      paths,
      signal: input.signal,
      state,
      stateBeforeCompaction,
      vaultRoot: input.vaultRoot,
    });
  }, input.signal);
  input.signal?.throwIfAborted();
  return result;
}

async function compactHostedPendingAssistantInputStateForWrite(input: {
  backfilled: boolean;
  collectHandledConversationInputIds: boolean;
  consumedConversationThroughSeq: bigint | null;
  filePath: string;
  forceCurrentSchemaWrite: boolean;
  paths: Parameters<typeof readAssistantInputEvent>[0]["paths"];
  signal?: AbortSignal | null;
  state: HostedPendingAssistantInputState;
  stateBeforeCompaction: HostedPendingAssistantInputState;
  vaultRoot: string;
}): Promise<HostedPendingAssistantInputCompactionResult> {
  input.signal?.throwIfAborted();
  if (input.state.inputIds.length === 0) {
    const emptyState = createHostedPendingAssistantInputState([], {
      backfilled: input.backfilled,
    });
    if (
      input.forceCurrentSchemaWrite
      || !sameHostedPendingAssistantInputState(emptyState, input.stateBeforeCompaction)
    ) {
      await writeHostedPendingAssistantInputStateAtPath({
        filePath: input.filePath,
        state: emptyState,
      });
      input.signal?.throwIfAborted();
    }
    return {
      handledConversationBatchCursorInputId: null,
      handledConversationFrontierInputId: null,
      handledConversationInputIds: [],
      runnableInputIds: [],
      unresolvedInputIds: [],
    };
  }

  const enabledAutoReplyChannels = new Set(
    (await readAssistantAutomationState(input.vaultRoot)).autoReply
      .map((entry) => entry.channel),
  );
  input.signal?.throwIfAborted();
  const runnable: { cursor: AssistantInputCursor; inputId: string }[] = [];
  const unresolved: { cursor: AssistantInputCursor; inputId: string }[] = [];
  const missingInputIds: string[] = [];
  let hasImageCompletionCandidate = false;
  const handledConversationInputs: {
    cursor: AssistantInputCursor;
    inputId: string;
  }[] = [];
  const handledConversationFrontierSeq =
    (input.consumedConversationThroughSeq ?? 0n) + 1n;
  let handledConversationFrontierInputId: string | null = null;
  for (const inputId of input.state.inputIds) {
    input.signal?.throwIfAborted();
    const event = await readAssistantInputEvent({
      inputId,
      paths: input.paths,
    });
    input.signal?.throwIfAborted();
    if (!event) {
      missingInputIds.push(inputId);
      continue;
    }
    const complete = await hasCompleteAssistantAutoReplyTerminalEvidence({
      captureId: event.projection.captureId,
      inputId,
      vault: input.vaultRoot,
    });
    input.signal?.throwIfAborted();
    if (!complete) {
      unresolved.push({
        cursor: event.cursor,
        inputId,
      });
      if (isAssistantHostedImageCompletionEvent(event)) {
        hasImageCompletionCandidate = true;
      }
      if (
        isHostedPendingAssistantInputStillReplyable({
          enabledAutoReplyChannels,
          event,
        })
      ) {
        runnable.push({
          cursor: event.cursor,
          inputId,
        });
      }
    } else if (
      event.sourceRef.kind === "hosted-mailbox"
      && event.sourceRef.lane === "conversation"
    ) {
      const laneSeq = parseHostedMailboxConversationSeq(event.sourceRef.laneSeq);
      if (
        laneSeq === null
        || input.consumedConversationThroughSeq === null
        || laneSeq > input.consumedConversationThroughSeq
      ) {
        if (input.collectHandledConversationInputIds) {
          handledConversationInputs.push({
            cursor: event.cursor,
            inputId,
          });
          if (
            laneSeq === handledConversationFrontierSeq
          ) {
            handledConversationFrontierInputId = inputId;
          }
        }
        // Keep terminal conversation IDs in the snapshot being checkpointed.
        // A later checkpoint removes them only after the server-provided floor
        // proves their exact row acknowledgement committed.
        unresolved.push({
          cursor: event.cursor,
          inputId,
        });
      }
    }
  }
  if (
    missingInputIds.length > 0
    && input.state.hasImageCompletionCandidate
  ) {
    hasImageCompletionCandidate = true;
  }

  const runnableInputIds = runnable
    .sort((left, right) => compareAssistantInputCursors(left.cursor, right.cursor))
    .map((item) => item.inputId);
  const unresolvedInputIds = unresolved
    .sort((left, right) => compareAssistantInputCursors(left.cursor, right.cursor))
    .map((item) => item.inputId);
  const remainingState = createHostedPendingAssistantInputState(
    [
      ...missingInputIds,
      ...unresolvedInputIds,
    ],
    {
      backfilled: input.backfilled,
      hasImageCompletionCandidate,
      handledBatchCursorInputId:
        input.state.handledBatchCursorInputId !== null
        && unresolvedInputIds.includes(input.state.handledBatchCursorInputId)
          ? input.state.handledBatchCursorInputId
          : null,
    },
  );

  if (
    input.forceCurrentSchemaWrite
    || !sameHostedPendingAssistantInputState(remainingState, input.stateBeforeCompaction)
  ) {
    await writeHostedPendingAssistantInputStateAtPath({
      filePath: input.filePath,
      state: remainingState,
    });
    input.signal?.throwIfAborted();
  }
  return {
    handledConversationBatchCursorInputId:
      remainingState.handledBatchCursorInputId,
    handledConversationFrontierInputId,
    handledConversationInputIds: handledConversationInputs
      .sort((left, right) => compareAssistantInputCursors(left.cursor, right.cursor))
      .map((item) => item.inputId),
    runnableInputIds,
    unresolvedInputIds: [
      ...missingInputIds,
      ...unresolvedInputIds,
    ],
  };
}

function parseHostedMailboxConversationSeq(value: unknown): bigint | null {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)
    ? BigInt(value)
    : null;
}

export async function ensureHostedPendingAssistantInputIndex(input: {
  vaultRoot: string;
}): Promise<string[]> {
  return await withAssistantRuntimeWriteLock(input.vaultRoot, async (paths) => {
    const existing = await readHostedPendingAssistantInputStateForWrite({
      filePath: resolveHostedPendingAssistantInputStatePathFromRoot(
        paths.assistantStateRoot,
      ),
      missingState: createEmptyHostedPendingAssistantInputState({
        backfilled: false,
      }),
    });
    return [...existing.state.inputIds];
  });
}

export function parseHostedPendingAssistantInputState(
  value: unknown,
): HostedPendingAssistantInputState {
  const state = assertPlainObject(value, HOSTED_PENDING_ASSISTANT_INPUT_STATE_LABEL);
  assertObjectKeys(
    state,
    HOSTED_PENDING_ASSISTANT_INPUT_STATE_KEYS,
    `${HOSTED_PENDING_ASSISTANT_INPUT_STATE_LABEL} value`,
  );
  if (!("inputIds" in state)) {
    throw new TypeError(
      "hosted pending assistant input state must contain inputIds.",
    );
  }
  const inputIds = parseHostedPendingAssistantInputIds(state.inputIds);
  const backfilled = "backfilled" in state
    ? parseHostedPendingAssistantInputBoolean(
      state.backfilled,
      "hosted pending assistant input state backfilled",
    )
    : false;
  const hasImageCompletionCandidate =
    "hasImageCompletionCandidate" in state
      ? parseHostedPendingAssistantInputBoolean(
        state.hasImageCompletionCandidate,
        "hosted pending assistant input image completion candidate",
      )
      : true;
  // State written before this projection existed is conservatively positive.
  // That preserves completion-first rollout behavior; the existing background
  // compaction pass rewrites the exact value without a foreground migration.
  const handledBatchCursorInputId = "handledBatchCursorInputId" in state
    ? parseHostedPendingAssistantInputNullableId(
      state.handledBatchCursorInputId,
      "hosted pending assistant input handled batch cursor",
    )
    : null;
  if (
    handledBatchCursorInputId !== null
    && !inputIds.includes(handledBatchCursorInputId)
  ) {
    throw new TypeError(
      "hosted pending assistant input handled batch cursor must reference an indexed input.",
    );
  }

  return {
    backfilled,
    hasImageCompletionCandidate,
    handledBatchCursorInputId,
    inputIds,
  };
}

async function readHostedPendingAssistantInputState(input: {
  vaultRoot: string;
}): Promise<HostedPendingAssistantInputState> {
  const filePath = resolveHostedPendingAssistantInputStatePath(input.vaultRoot);
  const existing = await readHostedPendingAssistantInputStateAtPath({ filePath });
  return existing.state;
}

async function readHostedPendingAssistantInputStateForWrite(input: {
  filePath: string;
  missingState: HostedPendingAssistantInputState | null;
}): Promise<HostedPendingAssistantInputStateReadResult> {
  const existing = await readHostedPendingAssistantInputStateAtPath({
    filePath: input.filePath,
  });
  if (!existing.missing) {
    return existing;
  }

  const state = input.missingState ?? createEmptyHostedPendingAssistantInputState({
    backfilled: false,
  });
  await writeHostedPendingAssistantInputStateAtPath({
    filePath: input.filePath,
    state,
  });
  return {
    legacy: false,
    missing: false,
    state,
  };
}

async function readHostedPendingAssistantInputStateAtPath(input: {
  filePath: string;
}): Promise<HostedPendingAssistantInputStateReadResult> {
  try {
    const parsed = JSON.parse(
      (await readLocalStateTextFile({ currentPath: input.filePath })).text,
    );
    const envelope = assertPlainObject(
      parsed,
      HOSTED_PENDING_ASSISTANT_INPUT_STATE_LABEL,
    );
    const legacy = envelope.schema === HOSTED_PENDING_ASSISTANT_INPUT_LEGACY_STATE_SCHEMA
      && envelope.schemaVersion
        === HOSTED_PENDING_ASSISTANT_INPUT_LEGACY_STATE_SCHEMA_VERSION;
    const state = parseVersionedJsonStateEnvelope(parsed, {
      label: HOSTED_PENDING_ASSISTANT_INPUT_STATE_LABEL,
      parseValue: parseHostedPendingAssistantInputState,
      schema: legacy
        ? HOSTED_PENDING_ASSISTANT_INPUT_LEGACY_STATE_SCHEMA
        : HOSTED_PENDING_ASSISTANT_INPUT_STATE_SCHEMA,
      schemaVersion: legacy
        ? HOSTED_PENDING_ASSISTANT_INPUT_LEGACY_STATE_SCHEMA_VERSION
        : HOSTED_PENDING_ASSISTANT_INPUT_STATE_SCHEMA_VERSION,
    });
    return {
      legacy,
      missing: false,
      state,
    };
  } catch (error) {
    if (isNodeFileNotFoundError(error)) {
      return {
        legacy: false,
        missing: true,
        state: createEmptyHostedPendingAssistantInputState({
          backfilled: false,
        }),
      };
    }
    throw error;
  }
}

async function writeHostedPendingAssistantInputStateAtPath(input: {
  filePath: string;
  legacy?: boolean;
  state: HostedPendingAssistantInputState;
}): Promise<void> {
  const state = parseHostedPendingAssistantInputState(input.state);
  await writeAssistantStateVersionedJson({
    filePath: input.filePath,
    schema: input.legacy
      ? HOSTED_PENDING_ASSISTANT_INPUT_LEGACY_STATE_SCHEMA
      : HOSTED_PENDING_ASSISTANT_INPUT_STATE_SCHEMA,
    schemaVersion: input.legacy
      ? HOSTED_PENDING_ASSISTANT_INPUT_LEGACY_STATE_SCHEMA_VERSION
      : HOSTED_PENDING_ASSISTANT_INPUT_STATE_SCHEMA_VERSION,
    value: input.legacy
      ? {
          backfilled: state.backfilled,
          inputIds: state.inputIds,
        }
      : state,
  });
}

function resolveHostedPendingAssistantInputStatePathFromRoot(
  assistantStateRoot: string,
): string {
  return path.join(assistantStateRoot, "hosted-pending-inputs.json");
}

async function createBackfilledHostedPendingAssistantInputState(input: {
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<HostedPendingAssistantInputState> {
  input.signal?.throwIfAborted();
  const automationState = await readAssistantAutomationState(input.vaultRoot);
  input.signal?.throwIfAborted();
  if (automationState.autoReply.length === 0) {
    return createEmptyHostedPendingAssistantInputState({
      backfilled: true,
    });
  }

  const source = createStoreBackedAssistantInputSource({
    vault: input.vaultRoot,
  });
  let hasImageCompletionCandidate = false;
  const pending: { cursor: AssistantInputCursor; inputId: string }[] = [];

  for (const channelState of automationState.autoReply) {
    input.signal?.throwIfAborted();
    let cursor = channelState.eligibleAfter;

    while (true) {
      input.signal?.throwIfAborted();
      const listed = await source.listInputCandidates({
        afterCursor: cursor,
        limit: DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT,
        signal: input.signal ?? undefined,
        sourceId: channelState.channel,
      });
      input.signal?.throwIfAborted();
      const listedItems = listed.inputs;
      if (listedItems.length === 0) {
        break;
      }

      for (const candidate of listedItems) {
        input.signal?.throwIfAborted();
        if (candidate.event.source !== channelState.channel) {
          continue;
        }
        if (candidate.event.replyTarget?.channel !== channelState.channel) {
          continue;
        }
        const complete = await hasCompleteAssistantAutoReplyTerminalEvidence({
          captureId: candidate.projection.captureId,
          inputId: candidate.event.inputId,
          vault: input.vaultRoot,
        });
        input.signal?.throwIfAborted();
        if (!complete) {
          pending.push({
            cursor: candidate.event.cursor,
            inputId: candidate.event.inputId,
          });
          if (isAssistantHostedImageCompletionEvent(candidate.event)) {
            hasImageCompletionCandidate = true;
          }
        }
      }

      cursor = listed.nextCursor ?? cursor;
      if (
        listedItems.length < DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT
        || !listed.nextCursor
      ) {
        break;
      }
    }
  }

  const inputIds: string[] = [];
  const seen = new Set<string>();
  for (const item of pending.sort((left, right) =>
    compareAssistantInputCursors(left.cursor, right.cursor)
  )) {
    if (seen.has(item.inputId)) {
      continue;
    }
    seen.add(item.inputId);
    inputIds.push(item.inputId);
  }

  return createHostedPendingAssistantInputState(inputIds, {
    backfilled: true,
    hasImageCompletionCandidate,
  });
}

async function createLegacyHostedPendingAssistantTerminalRecoveryState(input: {
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<HostedPendingAssistantInputState> {
  input.signal?.throwIfAborted();
  const listed = await listAssistantInputEvents({
    limit: Number.MAX_SAFE_INTEGER,
    signal: input.signal,
    vault: input.vaultRoot,
  });
  const terminalInputIds: string[] = [];
  for (const event of listed.events) {
    input.signal?.throwIfAborted();
    if (
      event.sourceRef.kind !== "hosted-mailbox"
      || event.sourceRef.lane !== "conversation"
    ) {
      continue;
    }
    const complete = await hasCompleteAssistantAutoReplyTerminalEvidence({
      captureId: event.projection.captureId,
      inputId: event.inputId,
      vault: input.vaultRoot,
    });
    input.signal?.throwIfAborted();
    if (complete) {
      terminalInputIds.push(event.inputId);
    }
  }
  return createHostedPendingAssistantInputState(terminalInputIds, {
    backfilled: true,
  });
}

export function isHostedPendingAssistantInputStillReplyable(input: {
  enabledAutoReplyChannels: ReadonlySet<string>;
  event: HostedPendingAssistantInputReplyabilityEvent;
}): boolean {
  const replyChannel = input.event.replyTarget?.channel;
  if (!replyChannel) {
    return false;
  }
  if (
    (input.event.conversation?.source ?? input.event.sourceRef.source)
      !== replyChannel
  ) {
    return false;
  }

  return input.enabledAutoReplyChannels.has(replyChannel);
}

function createEmptyHostedPendingAssistantInputState(input: {
  backfilled: boolean;
}): HostedPendingAssistantInputState {
  return {
    backfilled: input.backfilled,
    hasImageCompletionCandidate: false,
    handledBatchCursorInputId: null,
    inputIds: [],
  };
}

function createHostedPendingAssistantInputState(
  inputIds: readonly string[],
  input?: {
    backfilled?: boolean;
    hasImageCompletionCandidate?: boolean;
    handledBatchCursorInputId?: string | null;
  },
): HostedPendingAssistantInputState {
  return {
    backfilled: input?.backfilled ?? false,
    hasImageCompletionCandidate: input?.hasImageCompletionCandidate ?? false,
    handledBatchCursorInputId:
      parseHostedPendingAssistantInputNullableId(
        input?.handledBatchCursorInputId ?? null,
        "hosted pending assistant input handled batch cursor",
      ),
    inputIds: parseHostedPendingAssistantInputIds(inputIds),
  };
}

function appendHostedPendingAssistantInputId(input: {
  hasImageCompletionCandidate: boolean;
  inputId: string;
  state: HostedPendingAssistantInputState;
}): HostedPendingAssistantInputState {
  const existingIndex = input.state.inputIds.indexOf(input.inputId);
  if (existingIndex >= 0) {
    if (
      input.hasImageCompletionCandidate
      && !input.state.hasImageCompletionCandidate
    ) {
      return {
        ...input.state,
        hasImageCompletionCandidate: true,
      };
    }
    return input.state;
  }
  return createHostedPendingAssistantInputState([
    ...input.state.inputIds,
    input.inputId,
  ], {
    backfilled: input.state.backfilled,
    hasImageCompletionCandidate:
      input.state.hasImageCompletionCandidate
      || input.hasImageCompletionCandidate,
    handledBatchCursorInputId: input.state.handledBatchCursorInputId,
  });
}

function mergeHostedPendingAssistantInputBackfill(input: {
  backfilledState: HostedPendingAssistantInputState;
  state: HostedPendingAssistantInputState;
}): HostedPendingAssistantInputState {
  return createHostedPendingAssistantInputState(
    uniqueHostedPendingAssistantInputIds([
      ...input.state.inputIds,
      ...input.backfilledState.inputIds,
    ]),
    {
      backfilled: true,
      hasImageCompletionCandidate:
        input.state.hasImageCompletionCandidate
        || input.backfilledState.hasImageCompletionCandidate,
      handledBatchCursorInputId: input.state.handledBatchCursorInputId,
    },
  );
}

function parseHostedPendingAssistantInputIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(
      "hosted pending assistant input state inputIds must be an array.",
    );
  }

  const inputIds = value.map(parseHostedPendingAssistantInputId);
  if (new Set(inputIds).size !== inputIds.length) {
    throw new TypeError(
      "hosted pending assistant input state inputIds must not contain duplicates.",
    );
  }
  return inputIds;
}

function parseHostedPendingAssistantInputId(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(
      "hosted pending assistant input id must be a non-empty string.",
    );
  }
  return value;
}

function parseHostedPendingAssistantInputNullableId(
  value: unknown,
  label: string,
): string | null {
  if (value === null) {
    return null;
  }
  try {
    return parseHostedPendingAssistantInputId(value);
  } catch {
    throw new TypeError(`${label} must be null or a non-empty string.`);
  }
}

function parseHostedPendingAssistantInputBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }
  return value;
}

function assertPlainObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
  ) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertObjectKeys(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`${label} contains unsupported key: ${key}.`);
    }
  }
}

function sameStringArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sameHostedPendingAssistantInputState(
  left: HostedPendingAssistantInputState,
  right: HostedPendingAssistantInputState,
): boolean {
  return left.backfilled === right.backfilled
    && left.hasImageCompletionCandidate === right.hasImageCompletionCandidate
    && left.handledBatchCursorInputId === right.handledBatchCursorInputId
    && sameStringArray(left.inputIds, right.inputIds);
}

function uniqueHostedPendingAssistantInputIds(inputIds: readonly string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const inputId of inputIds) {
    const parsed = parseHostedPendingAssistantInputId(inputId);
    if (seen.has(parsed)) {
      continue;
    }
    seen.add(parsed);
    unique.push(parsed);
  }
  return unique;
}

function isRetainableAssistantInputMediaKind(kind: string): boolean {
  return kind === "audio" || kind === "image" || kind === "video";
}

function isNodeFileNotFoundError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT",
  );
}
