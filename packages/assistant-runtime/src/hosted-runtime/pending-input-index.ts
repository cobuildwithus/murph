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
  entries: HostedPendingAssistantInputEntry[];
}

export interface HostedPendingAssistantInputEntry {
  conversation: AssistantInputEventRecord["conversation"];
  cursor: AssistantInputCursor | null;
  inputId: string;
}

type HostedPendingAssistantInputEntryWithCursor =
  HostedPendingAssistantInputEntry & {
    cursor: AssistantInputCursor;
  };

type HostedPendingAssistantInputEntrySource = {
  conversation: AssistantInputEventRecord["conversation"];
  cursor: AssistantInputCursor;
  inputId: string;
};

interface HostedPendingAssistantInputStateReadResult {
  missing: boolean;
  state: HostedPendingAssistantInputState;
}

const HOSTED_PENDING_ASSISTANT_INPUT_STATE_LABEL =
  "hosted pending assistant input state";
const HOSTED_PENDING_ASSISTANT_INPUT_STATE_KEYS =
  new Set(["backfilled", "entries", "inputIds"]);
const HOSTED_PENDING_ASSISTANT_INPUT_ENTRY_KEYS =
  new Set(["conversation", "cursor", "inputId"]);
const HOSTED_PENDING_ASSISTANT_INPUT_CONVERSATION_KEYS =
  new Set(["accountId", "actorId", "actorIsSelf", "source", "threadId", "threadIsDirect"]);
const HOSTED_PENDING_ASSISTANT_INPUT_CURSOR_KEYS =
  new Set(["createdAt", "inputId", "occurredAt", "sourceKind", "sourcePosition"]);

type HostedPendingAssistantInputEvent = NonNullable<
  Awaited<ReturnType<typeof readAssistantInputEvent>>
>;
type HostedPendingAssistantAutoReplyEntry =
  Awaited<ReturnType<typeof readAssistantAutomationState>>["autoReply"][number];

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
  return hostedPendingAssistantInputIdsFromEntries(
    (await readHostedPendingAssistantInputState(input)).entries,
  );
}

export async function readExistingHostedPendingAssistantInputIds(input: {
  vaultRoot: string;
}): Promise<string[]> {
  return (await readExistingHostedPendingAssistantInputEntries(input))
    .map((entry) => entry.inputId);
}

export async function readExistingHostedPendingAssistantInputEntries(input: {
  vaultRoot: string;
}): Promise<HostedPendingAssistantInputEntry[]> {
  const existing = await readHostedPendingAssistantInputStateAtPath({
    filePath: resolveHostedPendingAssistantInputStatePath(input.vaultRoot),
  });
  return existing.missing ? [] : existing.state.entries;
}

export async function hasHostedPendingAssistantInputWakeCandidate(input: {
  vaultRoot: string;
}): Promise<boolean> {
  const existing = await readHostedPendingAssistantInputStateAtPath({
    filePath: resolveHostedPendingAssistantInputStatePath(input.vaultRoot),
  });
  if (!existing.missing && existing.state.entries.length > 0) {
    return true;
  }
  if (!existing.missing && existing.state.backfilled) {
    return false;
  }

  const automationState = await readAssistantAutomationState(input.vaultRoot);
  return automationState.autoReply.length > 0;
}

export async function enqueueHostedPendingAssistantInputId(input: {
  event?: HostedPendingAssistantInputEntrySource | null;
  inputId: string;
  vaultRoot: string;
}): Promise<string[]> {
  const inputId = parseHostedPendingAssistantInputId(input.inputId);
  const entry = await createHostedPendingAssistantInputEntry({
    event: input.event ?? null,
    inputId,
    vaultRoot: input.vaultRoot,
  });
  return await withAssistantRuntimeWriteLock(input.vaultRoot, async (paths) => {
    const state = await readHostedPendingAssistantInputStateForWrite({
      filePath: resolveHostedPendingAssistantInputStatePathFromRoot(
        paths.assistantStateRoot,
      ),
      missingState: createEmptyHostedPendingAssistantInputState({
        backfilled: false,
      }),
    });
    const nextState = appendHostedPendingAssistantInputEntry({
      entry,
      state,
    });
    if (sameHostedPendingAssistantInputState(nextState, state)) {
      return hostedPendingAssistantInputIdsFromEntries(state.entries);
    }

    await writeHostedPendingAssistantInputStateAtPath({
      filePath: resolveHostedPendingAssistantInputStatePathFromRoot(
        paths.assistantStateRoot,
      ),
      state: nextState,
    });
    return hostedPendingAssistantInputIdsFromEntries(nextState.entries);
  });
}

export async function compactHostedPendingAssistantInputIds(input: {
  vaultRoot: string;
}): Promise<string[]> {
  const filePath = resolveHostedPendingAssistantInputStatePath(input.vaultRoot);
  const existingBeforeLock = await readHostedPendingAssistantInputStateAtPath({
    filePath,
  });
  const backfilledState = existingBeforeLock.missing || !existingBeforeLock.state.backfilled
    ? await createBackfilledHostedPendingAssistantInputState({
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
            vaultRoot: input.vaultRoot,
          }),
        state: stateBeforeCompaction,
      });
    if (state.entries.length === 0) {
      if (!sameHostedPendingAssistantInputState(state, stateBeforeCompaction)) {
        await writeHostedPendingAssistantInputStateAtPath({
          filePath,
          state,
        });
      }
      return [];
    }

    const automationState = await readAssistantAutomationState(input.vaultRoot);
    const autoReplyByChannel = new Map(
      automationState.autoReply.map((entry) => [entry.channel, entry] as const),
    );
    const remainingEntries: HostedPendingAssistantInputEntry[] = [];
    for (const entry of state.entries) {
      const inputId = entry.inputId;
      const event = await readAssistantInputEvent({
        inputId,
        paths,
      });
      if (!event) {
        throw new Error(
          `Hosted pending assistant input index references a missing input event: ${inputId}`,
        );
      }
      if (
        !isCurrentHostedPendingAssistantInputCandidate({
          autoReplyByChannel,
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
        remainingEntries.push(createHostedPendingAssistantInputEntryFromEvent(event));
      }
    }

    const remainingState = createHostedPendingAssistantInputStateFromEntries(
      remainingEntries,
      { backfilled: true },
    );

    if (sameHostedPendingAssistantInputState(remainingState, stateBeforeCompaction)) {
      return hostedPendingAssistantInputIdsFromEntries(state.entries);
    }

    await writeHostedPendingAssistantInputStateAtPath({
      filePath,
      state: remainingState,
    });
    return hostedPendingAssistantInputIdsFromEntries(remainingState.entries);
  });
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
    return hostedPendingAssistantInputIdsFromEntries(state.entries);
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
  const legacyInputIds = "inputIds" in state
    ? parseHostedPendingAssistantInputIds(state.inputIds)
    : [];
  const entries = "entries" in state
    ? parseHostedPendingAssistantInputEntries(state.entries)
    : legacyInputIds.map((inputId) => createLegacyHostedPendingAssistantInputEntry(inputId));
  const backfilled = "backfilled" in state
    ? parseHostedPendingAssistantInputBoolean(
      state.backfilled,
      "hosted pending assistant input state backfilled",
    )
    : false;
  if (!("entries" in state) && !("inputIds" in state)) {
    throw new TypeError(
      "hosted pending assistant input state must contain entries.",
    );
  }
  if (
    "entries" in state
    && "inputIds" in state
    && !sameStringArray(
      legacyInputIds,
      hostedPendingAssistantInputIdsFromEntries(entries),
    )
  ) {
    throw new TypeError(
      "hosted pending assistant input state entries must match inputIds.",
    );
  }

  return {
    backfilled,
    entries,
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
  const pending: HostedPendingAssistantInputEntryWithCursor[] = [];

  for (const channelState of automationState.autoReply) {
    let cursor = channelState.eligibleAfter;

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
        if (candidate.event.replyTarget?.channel !== channelState.channel) {
          continue;
        }
        const complete = await hasCompleteAssistantAutoReplyTerminalEvidence({
          captureId: candidate.projection.captureId,
          inputId: candidate.event.inputId,
          vault: input.vaultRoot,
        });
        if (!complete) {
          pending.push(createHostedPendingAssistantInputEntryFromEvent(candidate.event));
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

  const entries: HostedPendingAssistantInputEntry[] = [];
  const seen = new Set<string>();
  for (const item of pending.sort((left, right) =>
    compareAssistantInputCursors(left.cursor, right.cursor)
  )) {
    if (seen.has(item.inputId)) {
      continue;
    }
    seen.add(item.inputId);
    entries.push(item);
  }

  return createHostedPendingAssistantInputStateFromEntries(entries, {
    backfilled: true,
  });
}

function isCurrentHostedPendingAssistantInputCandidate(input: {
  autoReplyByChannel: ReadonlyMap<string, HostedPendingAssistantAutoReplyEntry>;
  event: HostedPendingAssistantInputEvent;
}): boolean {
  const replyChannel = input.event.replyTarget?.channel;
  if (!replyChannel) {
    return false;
  }

  const channelState = input.autoReplyByChannel.get(replyChannel);
  if (!channelState) {
    return false;
  }

  return !channelState.eligibleAfter
    || compareAssistantInputCursors(input.event.cursor, channelState.eligibleAfter) > 0;
}

function createEmptyHostedPendingAssistantInputState(input: {
  backfilled: boolean;
}): HostedPendingAssistantInputState {
  return {
    backfilled: input.backfilled,
    entries: [],
  };
}

async function createHostedPendingAssistantInputEntry(input: {
  event: HostedPendingAssistantInputEntrySource | null;
  inputId: string;
  vaultRoot: string;
}): Promise<HostedPendingAssistantInputEntry> {
  const event = input.event ?? await readAssistantInputEvent({
    inputId: input.inputId,
    vault: input.vaultRoot,
  });
  return event
    ? createHostedPendingAssistantInputEntryFromEvent(event)
    : createLegacyHostedPendingAssistantInputEntry(input.inputId);
}

function createHostedPendingAssistantInputEntryFromEvent(
  event: HostedPendingAssistantInputEntrySource,
): HostedPendingAssistantInputEntryWithCursor {
  return {
    conversation: event.conversation,
    cursor: {
      createdAt: event.cursor.createdAt ?? null,
      inputId: parseHostedPendingAssistantInputId(event.cursor.inputId),
      occurredAt: event.cursor.occurredAt,
      sourceKind: event.cursor.sourceKind,
      sourcePosition: event.cursor.sourcePosition ?? null,
    },
    inputId: parseHostedPendingAssistantInputId(event.inputId),
  };
}

function createLegacyHostedPendingAssistantInputEntry(
  inputId: string,
): HostedPendingAssistantInputEntry {
  return {
    conversation: null,
    cursor: null,
    inputId: parseHostedPendingAssistantInputId(inputId),
  };
}

function createHostedPendingAssistantInputStateFromEntries(
  entries: readonly HostedPendingAssistantInputEntry[],
  input?: {
    backfilled?: boolean;
  },
): HostedPendingAssistantInputState {
  return {
    backfilled: input?.backfilled ?? false,
    entries: parseHostedPendingAssistantInputEntries(entries),
  };
}

function appendHostedPendingAssistantInputEntry(input: {
  entry: HostedPendingAssistantInputEntry;
  state: HostedPendingAssistantInputState;
}): HostedPendingAssistantInputState {
  const entries = [...input.state.entries];
  const existingIndex = entries.findIndex((entry) =>
    entry.inputId === input.entry.inputId
  );
  if (existingIndex === -1) {
    entries.push(input.entry);
  } else {
    entries[existingIndex] = mergeHostedPendingAssistantInputEntry(
      entries[existingIndex]!,
      input.entry,
    );
  }
  return createHostedPendingAssistantInputStateFromEntries(entries, {
    backfilled: input.state.backfilled,
  });
}

function mergeHostedPendingAssistantInputBackfill(input: {
  backfilledState: HostedPendingAssistantInputState;
  state: HostedPendingAssistantInputState;
}): HostedPendingAssistantInputState {
  let merged = createHostedPendingAssistantInputStateFromEntries(
    input.backfilledState.entries,
    { backfilled: true },
  );
  for (const entry of input.state.entries) {
    merged = appendHostedPendingAssistantInputEntry({
      entry,
      state: merged,
    });
  }
  return {
    ...merged,
    backfilled: true,
  };
}

function mergeHostedPendingAssistantInputEntry(
  current: HostedPendingAssistantInputEntry,
  next: HostedPendingAssistantInputEntry,
): HostedPendingAssistantInputEntry {
  return {
    conversation: next.conversation ?? current.conversation,
    cursor: next.cursor ?? current.cursor,
    inputId: current.inputId,
  };
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

function parseHostedPendingAssistantInputEntries(
  value: unknown,
): HostedPendingAssistantInputEntry[] {
  if (!Array.isArray(value)) {
    throw new TypeError(
      "hosted pending assistant input state entries must be an array.",
    );
  }
  const entries = value.map(parseHostedPendingAssistantInputEntry);
  const inputIds = entries.map((entry) => entry.inputId);
  if (new Set(inputIds).size !== inputIds.length) {
    throw new TypeError(
      "hosted pending assistant input state entries must not contain duplicate inputIds.",
    );
  }
  return entries;
}

function parseHostedPendingAssistantInputEntry(
  value: unknown,
): HostedPendingAssistantInputEntry {
  const entry = assertPlainObject(value, "hosted pending assistant input entry");
  assertObjectKeys(
    entry,
    HOSTED_PENDING_ASSISTANT_INPUT_ENTRY_KEYS,
    "hosted pending assistant input entry value",
  );

  return {
    conversation: parseHostedPendingAssistantInputConversation(entry.conversation),
    cursor: parseHostedPendingAssistantInputCursor(entry.cursor),
    inputId: parseHostedPendingAssistantInputId(entry.inputId),
  };
}

function parseHostedPendingAssistantInputId(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(
      "hosted pending assistant input id must be a non-empty string.",
    );
  }
  return value;
}

function parseHostedPendingAssistantInputConversation(
  value: unknown,
): AssistantInputEventRecord["conversation"] {
  if (value === null) {
    return null;
  }
  const conversation = assertPlainObject(
    value,
    "hosted pending assistant input conversation",
  );
  assertObjectKeys(
    conversation,
    HOSTED_PENDING_ASSISTANT_INPUT_CONVERSATION_KEYS,
    "hosted pending assistant input conversation value",
  );
  return {
    accountId: parseNullableHostedPendingAssistantInputString(conversation.accountId),
    actorId: parseNullableHostedPendingAssistantInputString(conversation.actorId),
    actorIsSelf: parseHostedPendingAssistantInputBoolean(
      conversation.actorIsSelf,
      "hosted pending assistant input conversation actorIsSelf",
    ),
    source: parseNullableHostedPendingAssistantInputString(conversation.source),
    threadId: parseNullableHostedPendingAssistantInputString(conversation.threadId),
    threadIsDirect: parseNullableHostedPendingAssistantInputBoolean(
      conversation.threadIsDirect,
      "hosted pending assistant input conversation threadIsDirect",
    ),
  };
}

function parseHostedPendingAssistantInputCursor(
  value: unknown,
): AssistantInputCursor | null {
  if (value === null) {
    return null;
  }
  const cursor = assertPlainObject(
    value,
    "hosted pending assistant input cursor",
  );
  assertObjectKeys(
    cursor,
    HOSTED_PENDING_ASSISTANT_INPUT_CURSOR_KEYS,
    "hosted pending assistant input cursor value",
  );
  const sourceKind = parseHostedPendingAssistantInputString(cursor.sourceKind);
  if (sourceKind !== "hosted-mailbox" && sourceKind !== "inbox-capture") {
    throw new TypeError(
      "hosted pending assistant input cursor sourceKind must be hosted-mailbox or inbox-capture.",
    );
  }
  return {
    createdAt: parseNullableHostedPendingAssistantInputString(cursor.createdAt),
    inputId: parseHostedPendingAssistantInputId(cursor.inputId),
    occurredAt: parseHostedPendingAssistantInputString(cursor.occurredAt),
    sourceKind,
    sourcePosition: parseNullableHostedPendingAssistantInputString(cursor.sourcePosition),
  };
}

function parseHostedPendingAssistantInputString(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError("hosted pending assistant input value must be a non-empty string.");
  }
  return value;
}

function parseNullableHostedPendingAssistantInputString(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return parseHostedPendingAssistantInputString(value);
}

function parseHostedPendingAssistantInputBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean.`);
  }
  return value;
}

function parseNullableHostedPendingAssistantInputBoolean(
  value: unknown,
  label: string,
): boolean | null {
  if (value === null) {
    return null;
  }
  return parseHostedPendingAssistantInputBoolean(value, label);
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
    && left.entries.length === right.entries.length
    && left.entries.every((entry, index) =>
      sameHostedPendingAssistantInputEntry(entry, right.entries[index]!)
    );
}

function sameHostedPendingAssistantInputEntry(
  left: HostedPendingAssistantInputEntry,
  right: HostedPendingAssistantInputEntry,
): boolean {
  return left.inputId === right.inputId
    && JSON.stringify(left.cursor) === JSON.stringify(right.cursor)
    && JSON.stringify(left.conversation) === JSON.stringify(right.conversation);
}

function hostedPendingAssistantInputIdsFromEntries(
  entries: readonly HostedPendingAssistantInputEntry[],
): string[] {
  return entries.map((entry) => entry.inputId);
}

function isNodeFileNotFoundError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT",
  );
}
