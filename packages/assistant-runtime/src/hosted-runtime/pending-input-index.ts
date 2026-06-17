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
  inputIds: string[];
}

interface HostedPendingAssistantInputStateReadResult {
  missing: boolean;
  state: HostedPendingAssistantInputState;
}

const HOSTED_PENDING_ASSISTANT_INPUT_STATE_LABEL =
  "hosted pending assistant input state";
const HOSTED_PENDING_ASSISTANT_INPUT_STATE_KEYS =
  new Set(["backfilled", "inputIds"]);

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

export async function hasHostedPendingAssistantInputWakeCandidate(input: {
  vaultRoot: string;
}): Promise<boolean> {
  const existing = await readHostedPendingAssistantInputStateAtPath({
    filePath: resolveHostedPendingAssistantInputStatePath(input.vaultRoot),
  });
  if (existing.missing) {
    return false;
  }
  if (existing.state.inputIds.length > 0) {
    return true;
  }
  if (existing.state.backfilled) {
    return false;
  }

  const automationState = await readAssistantAutomationState(input.vaultRoot);
  return automationState.autoReply.length > 0;
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
    if (state.inputIds.length === 0) {
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
    const remainingInputIds: string[] = [];
    for (const inputId of state.inputIds) {
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
        remainingInputIds.push(inputId);
      }
    }

    const remainingState = createHostedPendingAssistantInputState(
      remainingInputIds,
      { backfilled: true },
    );

    if (sameHostedPendingAssistantInputState(remainingState, stateBeforeCompaction)) {
      return [...state.inputIds];
    }

    await writeHostedPendingAssistantInputStateAtPath({
      filePath,
      state: remainingState,
    });
    return [...remainingState.inputIds];
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
  if (input.state.inputIds.includes(input.inputId)) {
    return input.state;
  }
  return createHostedPendingAssistantInputState([...input.state.inputIds, input.inputId], {
    backfilled: input.state.backfilled,
  });
}

function mergeHostedPendingAssistantInputBackfill(input: {
  backfilledState: HostedPendingAssistantInputState;
  state: HostedPendingAssistantInputState;
}): HostedPendingAssistantInputState {
  return createHostedPendingAssistantInputState(
    uniqueHostedPendingAssistantInputIds([
      ...input.backfilledState.inputIds,
      ...input.state.inputIds,
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

function isNodeFileNotFoundError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT",
  );
}
