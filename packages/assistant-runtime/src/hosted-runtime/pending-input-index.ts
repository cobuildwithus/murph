import path from "node:path";

import {
  hasCompleteAssistantAutoReplyTerminalEvidence,
} from "@murphai/assistant-engine/assistant-automation";
import {
  compareAssistantInputCursors,
  createStoreBackedAssistantInputSource,
  DEFAULT_ASSISTANT_AUTOMATION_SCAN_LIMIT,
  readAssistantInputEvent,
  type AssistantInputCursor,
  type AssistantInputEventRecord,
} from "@murphai/assistant-engine";
import {
  readAssistantAutomationState,
  withAssistantRuntimeWriteLock,
} from "@murphai/assistant-engine/assistant-state";
import { INBOX_MEDIA_RETENTION_WINDOW_MS } from "@murphai/inboxd/retention";
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

interface HostedPendingAssistantInputStateReadResult {
  missing: boolean;
  state: HostedPendingAssistantInputState;
}

interface HostedPendingAssistantInputCompactionResult {
  conversationPrefixEvidenceComplete: boolean;
  earliestPendingConversationLaneSeq: string | null;
  inputIds: string[];
}

const HOSTED_PENDING_ASSISTANT_INPUT_STATE_LABEL =
  "hosted pending assistant input state";
const HOSTED_PENDING_ASSISTANT_INPUT_STATE_KEYS =
  new Set(["backfilled", "inputIds"]);
const HOSTED_PENDING_ASSISTANT_INPUT_INSPECTION_WAVE_SIZE = 8;
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
    if (existingEvents.some((event) => event !== null)) {
      return {
        hasCandidate: true,
        indexComplete: !existing.missing && existing.state.backfilled,
      };
    }
    probed += waveSize;
    end = start;
  }

  return {
    // Missing indexed events remain durable replay-prefix blockers, but they
    // cannot be selected as runnable assistant work or schedule an immediate
    // hot loop. Probe newest-first in bounded waves so fresh appended input is
    // discovered quickly without an unbounded filesystem burst. If the bound
    // is exhausted, defer ordinary maintenance instead of guessing that the
    // whole index contains no runnable event.
    hasCandidate: false,
    indexComplete:
      !existing.missing
      && existing.state.backfilled
      && probed === inputIds.length,
  };
}

export async function enqueueHostedPendingAssistantInputId(input: {
  inputId: string;
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
    const nextState = appendHostedPendingAssistantInputId({
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
    inspectConversationPrefix: false,
  })).inputIds];
}

export async function compactHostedConversationMailboxHandledThroughSeq(input: {
  importedThroughSeq: string;
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<string | null> {
  const importedThroughSeq = parseHostedMailboxConversationSeq(
    input.importedThroughSeq,
  );
  if (importedThroughSeq === null) {
    return null;
  }

  const compacted = await compactHostedPendingAssistantInputState({
    ...input,
    inspectConversationPrefix: true,
  });
  if (!compacted.conversationPrefixEvidenceComplete) {
    return null;
  }

  const earliestPendingSeq = compacted.earliestPendingConversationLaneSeq === null
    ? null
    : BigInt(compacted.earliestPendingConversationLaneSeq);
  if (earliestPendingSeq === null || earliestPendingSeq > importedThroughSeq) {
    return importedThroughSeq.toString();
  }

  return (earliestPendingSeq - 1n).toString();
}

async function compactHostedPendingAssistantInputState(input: {
  inspectConversationPrefix: boolean;
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<HostedPendingAssistantInputCompactionResult> {
  input.signal?.throwIfAborted();
  const filePath = resolveHostedPendingAssistantInputStatePath(input.vaultRoot);
  const existingBeforeLock = await readHostedPendingAssistantInputStateAtPath({
    filePath,
  });
  input.signal?.throwIfAborted();
  const backfilledState = existingBeforeLock.missing || !existingBeforeLock.state.backfilled
    ? await createBackfilledHostedPendingAssistantInputState({
      respectEligibleAfter: true,
      signal: input.signal,
      vaultRoot: input.vaultRoot,
    })
    : null;
  input.signal?.throwIfAborted();
  const result = await withAssistantRuntimeWriteLock(input.vaultRoot, async (paths) => {
    const filePath = resolveHostedPendingAssistantInputStatePathFromRoot(
      paths.assistantStateRoot,
    );
    const stateBeforeCompaction = await readHostedPendingAssistantInputStateForWrite({
      filePath,
      missingState: backfilledState,
    });
    input.signal?.throwIfAborted();
    const state = stateBeforeCompaction.backfilled
      ? stateBeforeCompaction
      : mergeHostedPendingAssistantInputBackfill({
        backfilledState: backfilledState
          ?? await createBackfilledHostedPendingAssistantInputState({
            respectEligibleAfter: true,
            signal: input.signal,
            vaultRoot: input.vaultRoot,
          }),
        state: stateBeforeCompaction,
      });
    input.signal?.throwIfAborted();
    return await compactHostedPendingAssistantInputStateForWrite({
      backfilled: true,
      filePath,
      inspectConversationPrefix: input.inspectConversationPrefix,
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
  filePath: string;
  inspectConversationPrefix: boolean;
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
    if (!sameHostedPendingAssistantInputState(emptyState, input.stateBeforeCompaction)) {
      await writeHostedPendingAssistantInputStateAtPath({
        filePath: input.filePath,
        state: emptyState,
      });
      input.signal?.throwIfAborted();
    }
    return {
      conversationPrefixEvidenceComplete: true,
      earliestPendingConversationLaneSeq: null,
      inputIds: [],
    };
  }

  const enabledAutoReplyChannels = new Set(
    (await readAssistantAutomationState(input.vaultRoot)).autoReply
      .map((entry) => entry.channel),
  );
  input.signal?.throwIfAborted();
  const remaining: { cursor: AssistantInputCursor; inputId: string }[] = [];
  const missingInputIds: string[] = [];
  let conversationPrefixEvidenceComplete = true;
  let earliestPendingConversationLaneSeq: bigint | null = null;
  for (const inputId of input.state.inputIds) {
    input.signal?.throwIfAborted();
    const event = await readAssistantInputEvent({
      inputId,
      paths: input.paths,
    });
    input.signal?.throwIfAborted();
    if (!event) {
      missingInputIds.push(inputId);
      if (input.inspectConversationPrefix) {
        conversationPrefixEvidenceComplete = false;
      }
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
    input.signal?.throwIfAborted();
    if (!complete) {
      if (
        input.inspectConversationPrefix
        && event.sourceRef.kind === "hosted-mailbox"
        && event.sourceRef.lane === "conversation"
      ) {
        const laneSeq = parseHostedMailboxConversationPositiveSeq(
          event.sourceRef.laneSeq,
        );
        if (laneSeq === null) {
          conversationPrefixEvidenceComplete = false;
        } else if (
          earliestPendingConversationLaneSeq === null
          || laneSeq < earliestPendingConversationLaneSeq
        ) {
          earliestPendingConversationLaneSeq = laneSeq;
        }
      }
      remaining.push({
        cursor: event.cursor,
        inputId,
      });
    }
  }

  const runnableInputIds = remaining
    .sort((left, right) => compareAssistantInputCursors(left.cursor, right.cursor))
    .map((item) => item.inputId);
  const remainingState = createHostedPendingAssistantInputState(
    [
      ...missingInputIds,
      ...runnableInputIds,
    ],
    { backfilled: input.backfilled },
  );

  // A missing event or malformed conversation sequence means this pass cannot
  // prove a safe replay prefix. Keep the index untouched so a later call does
  // not mistake information loss for terminal handling.
  if (input.inspectConversationPrefix && !conversationPrefixEvidenceComplete) {
    return {
      conversationPrefixEvidenceComplete: false,
      earliestPendingConversationLaneSeq: null,
      inputIds: [...input.state.inputIds],
    };
  }

  if (!sameHostedPendingAssistantInputState(remainingState, input.stateBeforeCompaction)) {
    await writeHostedPendingAssistantInputStateAtPath({
      filePath: input.filePath,
      state: remainingState,
    });
    input.signal?.throwIfAborted();
  }
  return {
    conversationPrefixEvidenceComplete: true,
    earliestPendingConversationLaneSeq:
      earliestPendingConversationLaneSeq?.toString() ?? null,
    inputIds: runnableInputIds,
  };
}

function parseHostedMailboxConversationSeq(value: unknown): bigint | null {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)
    ? BigInt(value)
    : null;
}

function parseHostedMailboxConversationPositiveSeq(value: unknown): bigint | null {
  const parsed = parseHostedMailboxConversationSeq(value);
  return parsed !== null && parsed > 0n ? parsed : null;
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
  const pending: { cursor: AssistantInputCursor; inputId: string }[] = [];

  for (const channelState of automationState.autoReply) {
    input.signal?.throwIfAborted();
    let cursor = input.respectEligibleAfter ? channelState.eligibleAfter : null;

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
  state: HostedPendingAssistantInputState;
}): HostedPendingAssistantInputState {
  const existingIndex = input.state.inputIds.indexOf(input.inputId);
  if (existingIndex >= 0) {
    return input.state;
  }
  return createHostedPendingAssistantInputState([
    ...input.state.inputIds,
    input.inputId,
  ], {
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
