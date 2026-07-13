import path from "node:path";

import {
  hasCompleteAssistantAutoReplyTerminalEvidence,
  writeAssistantAutoReplySuppressionEvidence,
} from "@murphai/assistant-engine/assistant-automation";
import {
  compareAssistantInputCursors,
  createStoreBackedAssistantInputSource,
  DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT,
  readAssistantInputEvent,
  repairLegacyPersonalHomeAutomationRoutesFromInputs,
  type AssistantInputCursor,
  type AssistantInputEventRecord,
} from "@murphai/assistant-engine";
import {
  readAssistantAutomationState,
  withAssistantRuntimeWriteLock,
} from "@murphai/assistant-engine/assistant-state";
import { INBOX_MEDIA_RETENTION_WINDOW_MS } from "@murphai/inboxd/retention";
import {
  HOSTED_DEFERRED_GROUP_CONTEXT_MAX_PER_GROUP,
  HOSTED_DEFERRED_GROUP_CONTEXT_MAX_TOTAL,
} from "@murphai/hosted-execution/runtime-control";
import {
  readVersionedJsonStateFile,
} from "@murphai/runtime-state/node";
import {
  resolveAssistantStatePaths,
  writeAssistantStateVersionedJson,
} from "@murphai/runtime-state/node/assistant-state-fs";

export const HOSTED_PENDING_ASSISTANT_INPUT_STATE_SCHEMA =
  "murph.hosted-pending-assistant-inputs.v1";
export const HOSTED_PENDING_ASSISTANT_INPUT_STATE_SCHEMA_VERSION = 1;
export const HOSTED_PENDING_ASSISTANT_INPUT_STATE_RELATIVE_PATH =
  ".runtime/operations/assistant/hosted-pending-inputs.json";

export interface HostedPendingAssistantInputState {
  backfilled: boolean;
  inputIds: string[];
}

export interface HostedPendingAssistantInputMediaRetentionProtections {
  protectedAttachmentIds: string[];
  protectedCaptureIds: string[];
  protectedStoredPaths: string[];
}

export interface HostedPendingRouteProofRepairResult {
  pending: boolean;
  processedInputIds: string[];
  repaired: number;
  yielded: boolean;
}

interface HostedPendingAssistantInputStateReadResult {
  missing: boolean;
  state: HostedPendingAssistantInputState;
}

const HOSTED_PENDING_ASSISTANT_INPUT_STATE_LABEL =
  "hosted pending assistant input state";
const HOSTED_PENDING_ASSISTANT_INPUT_STATE_KEYS =
  new Set(["backfilled", "inputIds"]);
const HOSTED_DEFERRED_CONTEXT_OVERFLOW_REASON =
  "deferred group context exceeded the hosted retention window";
export const HOSTED_PENDING_ROUTE_PROOF_REPAIR_BATCH_LIMIT = 4;

type HostedPendingAssistantInputReplyabilityEvent = Pick<
  AssistantInputEventRecord,
  "conversation" | "replyTarget" | "sourceMetadata" | "sourceRef"
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
  const inputIds = await compactHostedPendingAssistantInputIds({
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
  const existing = await readHostedPendingAssistantInputStateAtPath({
    filePath: resolveHostedPendingAssistantInputStatePath(input.vaultRoot),
  });
  if (await hasHostedPendingAssistantInputWakeCandidateInIds({
    inputIds: existing.state.inputIds,
    vaultRoot: input.vaultRoot,
  })) {
    return true;
  }
  if (!existing.missing && existing.state.backfilled) {
    return false;
  }

  const compactedInputIds = await compactHostedPendingAssistantInputIds({
    vaultRoot: input.vaultRoot,
  });
  return await hasHostedPendingAssistantInputWakeCandidateInIds({
    inputIds: compactedInputIds,
    vaultRoot: input.vaultRoot,
  });
}

async function hasHostedPendingAssistantInputWakeCandidateInIds(input: {
  inputIds: readonly string[];
  vaultRoot: string;
}): Promise<boolean> {
  for (const inputId of input.inputIds) {
    const event = await readAssistantInputEvent({
      inputId,
      vault: input.vaultRoot,
    });
    if (event && !isHostedContextOnlyAssistantInputEvent(event)) {
      return true;
    }
  }
  return false;
}

export async function enqueueHostedPendingAssistantInputId(input: {
  inputId: string;
  routeProof?: boolean;
  vaultRoot: string;
}): Promise<string[]> {
  const inputId = parseHostedPendingAssistantInputId(input.inputId);
  return await withAssistantRuntimeWriteLock(input.vaultRoot, async (paths) => {
    const state = await readHostedPendingAssistantInputStateForWrite({
      filePath: resolveHostedPendingAssistantInputStatePathFromRoot(
        paths.assistantStateRoot,
      ),
      missingState: createEmptyHostedPendingAssistantInputState({
        backfilled: false,
      }),
    });
    let nextState = appendHostedPendingAssistantInputId({
      inputId,
      routeProof: input.routeProof ?? false,
      state,
    });
    const enqueuedEvent = await readAssistantInputEvent({
      inputId,
      paths,
    });
    if (enqueuedEvent && isHostedDeferredGroupContextEvent(enqueuedEvent)) {
      const deferredContextEntries = await readHostedDeferredContextEntries({
        inputIds: nextState.inputIds,
        paths,
      });
      const overflow = selectHostedDeferredContextOverflow(deferredContextEntries);
      if (overflow.length > 0) {
        await suppressHostedDeferredContextOverflow({
          entries: overflow,
          vaultRoot: input.vaultRoot,
        });
        const overflowInputIds = new Set(overflow.map((entry) => entry.inputId));
        nextState = createHostedPendingAssistantInputState(
          nextState.inputIds.filter((candidate) => !overflowInputIds.has(candidate)),
          { backfilled: nextState.backfilled },
        );
      }
    }
    if (sameHostedPendingAssistantInputState(nextState, state)) {
      return [...state.inputIds];
    }

    await writeHostedPendingAssistantInputStateAtPath({
      filePath: resolveHostedPendingAssistantInputStatePathFromRoot(
        paths.assistantStateRoot,
      ),
      state: nextState,
    });
    return [...nextState.inputIds];
  });
}

export async function compactHostedPendingAssistantInputIds(input: {
  repairedRouteProofInputIds?: readonly string[];
  vaultRoot: string;
}): Promise<string[]> {
  const filePath = resolveHostedPendingAssistantInputStatePath(input.vaultRoot);
  const existingBeforeLock = await readHostedPendingAssistantInputStateAtPath({
    filePath,
  });
  const backfilledState = existingBeforeLock.missing || !existingBeforeLock.state.backfilled
    ? await createBackfilledHostedPendingAssistantInputState({
      respectEligibleAfter: true,
      vaultRoot: input.vaultRoot,
    })
    : null;
  return await withAssistantRuntimeWriteLock(input.vaultRoot, async (paths) => {
    const filePath = resolveHostedPendingAssistantInputStatePathFromRoot(
      paths.assistantStateRoot,
    );
    const stateBeforeCompaction = await readHostedPendingAssistantInputStateForWrite({
      filePath,
      missingState: backfilledState,
    });
    const state = stateBeforeCompaction.backfilled
      ? stateBeforeCompaction
      : mergeHostedPendingAssistantInputBackfill({
        backfilledState: backfilledState
          ?? await createBackfilledHostedPendingAssistantInputState({
            respectEligibleAfter: true,
            vaultRoot: input.vaultRoot,
          }),
        state: stateBeforeCompaction,
      });
    return await compactHostedPendingAssistantInputStateForWrite({
      backfilled: true,
      filePath,
      paths,
      repairedRouteProofInputIds: input.repairedRouteProofInputIds ?? [],
      state,
      stateBeforeCompaction,
      vaultRoot: input.vaultRoot,
    });
  });
}

export async function repairHostedPendingAssistantRouteProofBatch(input: {
  batchLimit?: number;
  now?: Date;
  shouldYield?: (() => boolean) | null;
  signal?: AbortSignal;
  vaultRoot: string;
}): Promise<HostedPendingRouteProofRepairResult> {
  const batchLimit = normalizeHostedPendingRouteProofBatchLimit(input.batchLimit);
  const pendingInputIds = await readExistingHostedPendingAssistantInputIds({
    vaultRoot: input.vaultRoot,
  });
  const proofInputIds: string[] = [];

  for (const inputId of pendingInputIds.slice(0, batchLimit)) {
    throwIfHostedPendingRouteProofRepairAborted(input.signal);
    if (input.shouldYield?.() === true) {
      return {
        pending: true,
        processedInputIds: [],
        repaired: 0,
        yielded: true,
      };
    }
    const event = await readAssistantInputEvent({
      inputId,
      vault: input.vaultRoot,
    });
    if (event && hasHostedPendingAssistantInputRouteProof(event)) {
      proofInputIds.push(inputId);
    }
  }

  if (proofInputIds.length === 0) {
    return {
      pending: false,
      processedInputIds: [],
      repaired: 0,
      yielded: false,
    };
  }

  throwIfHostedPendingRouteProofRepairAborted(input.signal);
  const repaired = await repairLegacyPersonalHomeAutomationRoutesFromInputs({
    inputIds: proofInputIds,
    now: input.now ?? new Date(),
    vaultRoot: input.vaultRoot,
  });
  const remainingInputIds = await compactHostedPendingAssistantInputIds({
    repairedRouteProofInputIds: proofInputIds,
    vaultRoot: input.vaultRoot,
  });
  const firstRemainingInputId = remainingInputIds[0] ?? null;
  const firstRemainingEvent = firstRemainingInputId
    ? await readAssistantInputEvent({
        inputId: firstRemainingInputId,
        vault: input.vaultRoot,
      })
    : null;

  return {
    pending: Boolean(
      firstRemainingEvent
      && !proofInputIds.includes(firstRemainingEvent.inputId)
      && hasHostedPendingAssistantInputRouteProof(firstRemainingEvent)
    ),
    processedInputIds: proofInputIds,
    repaired,
    yielded: false,
  };
}

async function compactHostedPendingAssistantInputStateForWrite(input: {
  backfilled: boolean;
  filePath: string;
  paths: Parameters<typeof readAssistantInputEvent>[0]["paths"];
  repairedRouteProofInputIds: readonly string[];
  state: HostedPendingAssistantInputState;
  stateBeforeCompaction: HostedPendingAssistantInputState;
  vaultRoot: string;
}): Promise<string[]> {
  if (input.state.inputIds.length === 0) {
    const emptyState = createHostedPendingAssistantInputState([], {
      backfilled: input.backfilled,
    });
    if (!sameHostedPendingAssistantInputState(emptyState, input.stateBeforeCompaction)) {
      await writeHostedPendingAssistantInputStateAtPath({
        filePath: input.filePath,
        state: emptyState,
      });
    }
    return [];
  }

  const enabledAutoReplyChannels = new Set(
    (await readAssistantAutomationState(input.vaultRoot)).autoReply
      .map((entry) => entry.channel),
  );
  const repairedRouteProofInputIds = new Set(input.repairedRouteProofInputIds);
  const pendingRouteProofInputIds: string[] = [];
  const remaining: HostedPendingAssistantInputEntry[] = [];
  const repairedReplyableRouteProofInputs: HostedPendingAssistantInputEntry[] = [];
  for (const inputId of input.state.inputIds) {
    const event = await readAssistantInputEvent({
      inputId,
      paths: input.paths,
    });
    if (!event) {
      continue;
    }
    const hasRouteProof = hasHostedPendingAssistantInputRouteProof(event);
    if (hasRouteProof && !repairedRouteProofInputIds.has(inputId)) {
      pendingRouteProofInputIds.push(inputId);
      continue;
    }
    if (
      !isHostedPendingAssistantInputStillReplyable({
        enabledAutoReplyChannels,
        event,
      })
    ) {
      continue;
    }
    const complete = await hasCompleteAssistantAutoReplyTerminalEvidence({
      captureId: event.projection.captureId,
      inputId,
      vault: input.vaultRoot,
    });
    if (!complete) {
      const destination = hasRouteProof
        ? repairedReplyableRouteProofInputs
        : remaining;
      destination.push({
        cursor: event.cursor,
        event,
        inputId,
      });
    }
  }

  const sortedRemaining = remaining.sort((left, right) =>
    compareAssistantInputCursors(left.cursor, right.cursor)
  );
  const overflow = selectHostedDeferredContextOverflow(sortedRemaining);
  if (overflow.length > 0) {
    await suppressHostedDeferredContextOverflow({
      entries: overflow,
      vaultRoot: input.vaultRoot,
    });
  }
  const overflowInputIds = new Set(overflow.map((entry) => entry.inputId));
  const remainingState = createHostedPendingAssistantInputState(
    [
      ...pendingRouteProofInputIds,
      ...sortedRemaining
        .filter((item) => !overflowInputIds.has(item.inputId))
        .map((item) => item.inputId),
      ...repairedReplyableRouteProofInputs
        .sort((left, right) => compareAssistantInputCursors(left.cursor, right.cursor))
        .map((item) => item.inputId),
    ],
    { backfilled: input.backfilled },
  );

  if (!sameHostedPendingAssistantInputState(remainingState, input.stateBeforeCompaction)) {
    await writeHostedPendingAssistantInputStateAtPath({
      filePath: input.filePath,
      state: remainingState,
    });
  }
  return [...remainingState.inputIds];
}

interface HostedPendingAssistantInputEntry {
  cursor: AssistantInputCursor;
  event: AssistantInputEventRecord;
  inputId: string;
}

async function readHostedDeferredContextEntries(input: {
  inputIds: readonly string[];
  paths: Parameters<typeof readAssistantInputEvent>[0]["paths"];
}): Promise<HostedPendingAssistantInputEntry[]> {
  const entries: HostedPendingAssistantInputEntry[] = [];
  for (const inputId of input.inputIds) {
    const event = await readAssistantInputEvent({
      inputId,
      paths: input.paths,
    });
    if (!event || !isHostedDeferredGroupContextEvent(event)) {
      continue;
    }
    entries.push({
      cursor: event.cursor,
      event,
      inputId,
    });
  }
  return entries.sort((left, right) =>
    compareAssistantInputCursors(left.cursor, right.cursor)
  );
}

function selectHostedDeferredContextOverflow(
  entries: readonly HostedPendingAssistantInputEntry[],
): HostedPendingAssistantInputEntry[] {
  const contextEntries = entries
    .filter((entry) => isHostedDeferredGroupContextEvent(entry.event))
    .sort(compareHostedDeferredContextSemanticOrder);
  const overflowInputIds = new Set<string>();
  const entriesByGroup = new Map<string, HostedPendingAssistantInputEntry[]>();

  for (const entry of contextEntries) {
    const groupKey = hostedDeferredContextGroupKey(entry.event);
    if (!groupKey) {
      continue;
    }
    const groupEntries = entriesByGroup.get(groupKey) ?? [];
    groupEntries.push(entry);
    entriesByGroup.set(groupKey, groupEntries);
  }
  for (const groupEntries of entriesByGroup.values()) {
    const overflowCount = Math.max(
      0,
      groupEntries.length - HOSTED_DEFERRED_GROUP_CONTEXT_MAX_PER_GROUP,
    );
    for (const entry of groupEntries.slice(0, overflowCount)) {
      overflowInputIds.add(entry.inputId);
    }
  }

  const globallyRetained = contextEntries.filter((entry) =>
    !overflowInputIds.has(entry.inputId)
  );
  const globalOverflowCount = Math.max(
    0,
    globallyRetained.length - HOSTED_DEFERRED_GROUP_CONTEXT_MAX_TOTAL,
  );
  for (const entry of globallyRetained.slice(0, globalOverflowCount)) {
    overflowInputIds.add(entry.inputId);
  }

  return contextEntries.filter((entry) => overflowInputIds.has(entry.inputId));
}

function compareHostedDeferredContextSemanticOrder(
  left: HostedPendingAssistantInputEntry,
  right: HostedPendingAssistantInputEntry,
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
  return compareAssistantInputCursors(left.cursor, right.cursor);
}

async function suppressHostedDeferredContextOverflow(input: {
  entries: readonly HostedPendingAssistantInputEntry[];
  vaultRoot: string;
}): Promise<void> {
  for (const entry of input.entries) {
    await writeAssistantAutoReplySuppressionEvidence({
      captureIds: entry.event.projection.captureId
        ? [entry.event.projection.captureId]
        : [],
      inputIds: [entry.inputId],
      reason: HOSTED_DEFERRED_CONTEXT_OVERFLOW_REASON,
      vault: input.vaultRoot,
    });
  }
}

function isHostedDeferredGroupContextEvent(
  event: HostedPendingAssistantInputReplyabilityEvent,
): boolean {
  return isHostedContextOnlyAssistantInputEvent(event)
    && event.conversation?.source === "linq"
    && event.conversation.threadIsDirect === false
    && Boolean(event.conversation.accountId)
    && Boolean(event.conversation.threadId);
}

function hostedDeferredContextGroupKey(
  event: HostedPendingAssistantInputReplyabilityEvent,
): string | null {
  if (!isHostedDeferredGroupContextEvent(event) || !event.conversation) {
    return null;
  }
  return JSON.stringify([
    event.conversation.source,
    event.conversation.accountId,
    event.conversation.threadId,
    event.conversation.threadIsDirect,
  ]);
}

export async function ensureHostedPendingAssistantInputIndex(input: {
  vaultRoot: string;
}): Promise<string[]> {
  return await withAssistantRuntimeWriteLock(input.vaultRoot, async (paths) => {
    const state = await readHostedPendingAssistantInputStateForWrite({
      filePath: resolveHostedPendingAssistantInputStatePathFromRoot(
        paths.assistantStateRoot,
      ),
      missingState: createEmptyHostedPendingAssistantInputState({
        backfilled: false,
      }),
    });
    return [...state.inputIds];
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

  return {
    backfilled,
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
}): Promise<HostedPendingAssistantInputState> {
  const existing = await readHostedPendingAssistantInputStateAtPath({
    filePath: input.filePath,
  });
  if (!existing.missing) {
    return existing.state;
  }

  const state = input.missingState ?? createEmptyHostedPendingAssistantInputState({
    backfilled: false,
  });
  await writeHostedPendingAssistantInputStateAtPath({
    filePath: input.filePath,
    state,
  });
  return state;
}

async function readHostedPendingAssistantInputStateAtPath(input: {
  filePath: string;
}): Promise<HostedPendingAssistantInputStateReadResult> {
  try {
    const result = await readVersionedJsonStateFile({
      currentPath: input.filePath,
      label: HOSTED_PENDING_ASSISTANT_INPUT_STATE_LABEL,
      parseValue: parseHostedPendingAssistantInputState,
      schema: HOSTED_PENDING_ASSISTANT_INPUT_STATE_SCHEMA,
      schemaVersion: HOSTED_PENDING_ASSISTANT_INPUT_STATE_SCHEMA_VERSION,
    });
    return {
      missing: false,
      state: result.value,
    };
  } catch (error) {
    if (isNodeFileNotFoundError(error)) {
      return {
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
  state: HostedPendingAssistantInputState;
}): Promise<void> {
  await writeAssistantStateVersionedJson({
    filePath: input.filePath,
    schema: HOSTED_PENDING_ASSISTANT_INPUT_STATE_SCHEMA,
    schemaVersion: HOSTED_PENDING_ASSISTANT_INPUT_STATE_SCHEMA_VERSION,
    value: parseHostedPendingAssistantInputState(input.state),
  });
}

function resolveHostedPendingAssistantInputStatePathFromRoot(
  assistantStateRoot: string,
): string {
  return path.join(assistantStateRoot, "hosted-pending-inputs.json");
}

async function createBackfilledHostedPendingAssistantInputState(input: {
  respectEligibleAfter: boolean;
  vaultRoot: string;
}): Promise<HostedPendingAssistantInputState> {
  const automationState = await readAssistantAutomationState(input.vaultRoot);
  if (automationState.autoReply.length === 0) {
    return createEmptyHostedPendingAssistantInputState({
      backfilled: true,
    });
  }

  const source = createStoreBackedAssistantInputSource({
    vault: input.vaultRoot,
  });
  const pending: { cursor: AssistantInputCursor; inputId: string }[] = [];

  for (const channelState of automationState.autoReply) {
    let cursor = input.respectEligibleAfter ? channelState.eligibleAfter : null;

    while (true) {
      const listed = await source.listInputCandidates({
        afterCursor: cursor,
        limit: DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT,
        sourceId: channelState.channel,
      });
      const listedItems = listed.inputs;
      if (listedItems.length === 0) {
        break;
      }

      for (const candidate of listedItems) {
        if (candidate.event.source !== channelState.channel) {
          continue;
        }
        if (
          !isHostedContextOnlyAssistantInputEvent(candidate.event)
          && candidate.event.replyTarget?.channel !== channelState.channel
        ) {
          continue;
        }
        const complete = await hasCompleteAssistantAutoReplyTerminalEvidence({
          captureId: candidate.projection.captureId,
          inputId: candidate.event.inputId,
          vault: input.vaultRoot,
        });
        if (!complete) {
          pending.push({
            cursor: candidate.event.cursor,
            inputId: candidate.event.inputId,
          });
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
  });
}

export function isHostedPendingAssistantInputStillReplyable(input: {
  enabledAutoReplyChannels: ReadonlySet<string>;
  event: HostedPendingAssistantInputReplyabilityEvent;
}): boolean {
  if (isHostedContextOnlyAssistantInputEvent(input.event)) {
    const source = input.event.conversation?.source ?? input.event.sourceRef.source;
    return source === "linq" && input.enabledAutoReplyChannels.has("linq");
  }
  return isHostedPendingAssistantInputActionable(input);
}

function isHostedPendingAssistantInputActionable(input: {
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

function isHostedContextOnlyAssistantInputEvent(
  event: HostedPendingAssistantInputReplyabilityEvent,
): boolean {
  return event.sourceMetadata?.kind === "linq"
    && event.sourceMetadata.contextOnly === true;
}

function createEmptyHostedPendingAssistantInputState(input: {
  backfilled: boolean;
}): HostedPendingAssistantInputState {
  return {
    backfilled: input.backfilled,
    inputIds: [],
  };
}

function createHostedPendingAssistantInputState(
  inputIds: readonly string[],
  input?: {
    backfilled?: boolean;
  },
): HostedPendingAssistantInputState {
  return {
    backfilled: input?.backfilled ?? false,
    inputIds: parseHostedPendingAssistantInputIds(inputIds),
  };
}

function appendHostedPendingAssistantInputId(input: {
  inputId: string;
  routeProof: boolean;
  state: HostedPendingAssistantInputState;
}): HostedPendingAssistantInputState {
  const existingIndex = input.state.inputIds.indexOf(input.inputId);
  if (existingIndex >= 0 && (!input.routeProof || existingIndex === 0)) {
    return input.state;
  }
  const inputIds = existingIndex >= 0
    ? input.state.inputIds.filter((inputId) => inputId !== input.inputId)
    : input.state.inputIds;
  return createHostedPendingAssistantInputState(input.routeProof
    ? [input.inputId, ...inputIds]
    : [...inputIds, input.inputId], {
    backfilled: input.state.backfilled,
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
    { backfilled: true },
  );
}

export function hasHostedPendingAssistantInputRouteProof(
  event: Pick<AssistantInputEventRecord, "conversation" | "replyTarget" | "sourceMetadata">,
): boolean {
  const sourceMetadata = event.sourceMetadata;
  return sourceMetadata?.kind === "linq"
    && event.conversation?.actorIsSelf === false
    && event.conversation.source === "linq"
    && event.conversation.threadIsDirect === true
    && event.replyTarget?.channel === "linq"
    && Boolean(event.replyTarget.threadId?.trim())
    && Boolean(sourceMetadata.previousHomeThreadId?.trim());
}

function normalizeHostedPendingRouteProofBatchLimit(value: number | undefined): number {
  if (value === undefined) {
    return HOSTED_PENDING_ROUTE_PROOF_REPAIR_BATCH_LIMIT;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("hosted pending route proof batch limit must be a positive integer");
  }
  return value;
}

function throwIfHostedPendingRouteProofRepairAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Hosted pending route proof repair was aborted.");
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
