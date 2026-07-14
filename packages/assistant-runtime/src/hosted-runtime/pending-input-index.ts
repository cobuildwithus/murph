import path from "node:path";

import {
  hasCompleteAssistantAutoReplyTerminalEvidence,
} from "@murphai/assistant-engine/assistant-automation";
import {
  compareAssistantInputCursors,
  listAssistantInputEventsByInputId,
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
  backfillAfterInputId: string | null;
  backfilled: boolean;
  inputIds: string[];
}

export interface HostedPendingAssistantInputMigrationResult {
  pending: boolean;
  processed: number;
  progressed: boolean;
  yielded: boolean;
}

export interface HostedPendingAssistantInputMediaRetentionProtections {
  migrationPending: boolean;
  protectedAttachmentIds: string[];
  protectedCaptureIds: string[];
  protectedStoredPaths: string[];
}

interface HostedPendingAssistantInputStateReadResult {
  missing: boolean;
  state: HostedPendingAssistantInputState;
}

const HOSTED_PENDING_ASSISTANT_INPUT_STATE_LABEL =
  "hosted pending assistant input state";
const HOSTED_PENDING_ASSISTANT_INPUT_STATE_KEYS =
  new Set(["backfillAfterInputId", "backfilled", "inputIds"]);
export const HOSTED_PENDING_INPUT_MIGRATION_BATCH_LIMIT = 4;
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
  const [pendingState, automationState] = await Promise.all([
    readHostedPendingAssistantInputState(input),
    readAssistantAutomationState(input.vaultRoot),
  ]);
  const migrationPending = automationState.autoReply.length > 0
    && !pendingState.backfilled;
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
    migrationPending,
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
  return existing.state.inputIds.length > 0;
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
  const existing = await readHostedPendingAssistantInputStateAtPath({
    filePath,
  });
  if (existing.missing) {
    return [];
  }
  return await withAssistantRuntimeWriteLock(input.vaultRoot, async (paths) => {
    const filePath = resolveHostedPendingAssistantInputStatePathFromRoot(
      paths.assistantStateRoot,
    );
    const state = await readHostedPendingAssistantInputStateForWrite({
      filePath,
      missingState: null,
    });
    return await compactHostedPendingAssistantInputStateForWrite({
      filePath,
      paths,
      state,
      vaultRoot: input.vaultRoot,
    });
  });
}

export async function migrateLegacyHostedPendingAssistantInputIndex(input: {
  batchLimit?: number;
  shouldYield?: (() => boolean) | null;
  signal?: AbortSignal;
  vaultRoot: string;
}): Promise<HostedPendingAssistantInputMigrationResult> {
  const batchLimit = normalizeHostedPendingAssistantInputMigrationBatchLimit(
    input.batchLimit,
  );
  if (shouldYieldHostedPendingInputMigration(input)) {
    return pendingHostedPendingInputMigrationYield();
  }
  const automationState = await readAssistantAutomationState(input.vaultRoot);
  const enabledAutoReplyChannels = new Set(
    automationState.autoReply.map((entry) => entry.channel),
  );
  if (automationState.autoReply.length === 0) {
    return {
      pending: false,
      processed: 0,
      progressed: false,
      yielded: false,
    };
  }
  const paths = resolveAssistantStatePaths(input.vaultRoot);
  const filePath = resolveHostedPendingAssistantInputStatePathFromRoot(
    paths.assistantStateRoot,
  );
  const observedState = (await readHostedPendingAssistantInputStateAtPath({
    filePath,
  })).state;
  if (observedState.backfilled) {
    return {
      pending: false,
      processed: 0,
      progressed: false,
      yielded: false,
    };
  }

  let page: Awaited<ReturnType<typeof listAssistantInputEventsByInputId>>;
  try {
    page = await listAssistantInputEventsByInputId({
      afterInputId: observedState.backfillAfterInputId,
      limit: batchLimit,
      paths,
      shouldYield: input.shouldYield ?? null,
      signal: input.signal,
    });
  } catch (error) {
    if (!shouldYieldHostedPendingInputMigration(input)) {
      throw error;
    }
    return pendingHostedPendingInputMigrationYield();
  }

  let processed = 0;
  let backfillAfterInputId = observedState.backfillAfterInputId;
  const recoveredInputIds: string[] = [];
  let yielded = false;
  for (const event of page.events) {
    if (shouldYieldHostedPendingInputMigration(input)) {
      yielded = true;
      break;
    }
    processed += 1;
    backfillAfterInputId = event.inputId;
    if (
      isHostedPendingAssistantInputStillReplyable({
        enabledAutoReplyChannels,
        event,
      })
      && isHostedLegacyPendingBackfillCandidateAfterEligibleCursor({
        automationState,
        event,
      })
      && !await hasCompleteAssistantAutoReplyTerminalEvidence({
        captureId: event.projection.captureId,
        inputId: event.inputId,
        vault: input.vaultRoot,
      })
    ) {
      recoveredInputIds.push(event.inputId);
    }
  }

  return await withAssistantRuntimeWriteLock(input.vaultRoot, async () => {
    const state = (await readHostedPendingAssistantInputStateAtPath({ filePath })).state;
    if (state.backfilled) {
      return {
        pending: false,
        processed: 0,
        progressed: false,
        yielded: false,
      };
    }
    if (state.backfillAfterInputId !== observedState.backfillAfterInputId) {
      return {
        pending: true,
        processed: 0,
        progressed: false,
        yielded: false,
      };
    }
    const backfilled = !yielded && page.events.length < batchLimit;
    const nextState = createHostedPendingAssistantInputState([
      ...state.inputIds,
      ...recoveredInputIds.filter((inputId) => !state.inputIds.includes(inputId)),
    ], {
      backfillAfterInputId: backfilled ? null : backfillAfterInputId,
      backfilled,
    });
    const progressed = !sameHostedPendingAssistantInputState(nextState, state);
    if (progressed) {
      await writeHostedPendingAssistantInputStateAtPath({ filePath, state: nextState });
    }
    return {
      pending: !nextState.backfilled,
      processed,
      progressed,
      yielded,
    };
  });
}

function pendingHostedPendingInputMigrationYield(): HostedPendingAssistantInputMigrationResult {
  return {
    pending: true,
    processed: 0,
    progressed: false,
    yielded: true,
  };
}

function shouldYieldHostedPendingInputMigration(input: {
  shouldYield?: (() => boolean) | null;
  signal?: AbortSignal;
}): boolean {
  return input.signal?.aborted === true || input.shouldYield?.() === true;
}

function isHostedLegacyPendingBackfillCandidateAfterEligibleCursor(input: {
  automationState: Awaited<ReturnType<typeof readAssistantAutomationState>>;
  event: AssistantInputEventRecord;
}): boolean {
  const channel = input.event.replyTarget?.channel;
  if (!channel) {
    return false;
  }
  const channelState = input.automationState.autoReply.find(
    (entry) => entry.channel === channel,
  );
  return channelState !== undefined
    && (
      channelState.eligibleAfter === null
      || compareAssistantInputCursors(input.event.cursor, channelState.eligibleAfter) > 0
    );
}

async function compactHostedPendingAssistantInputStateForWrite(input: {
  filePath: string;
  paths: Parameters<typeof readAssistantInputEvent>[0]["paths"];
  state: HostedPendingAssistantInputState;
  vaultRoot: string;
}): Promise<string[]> {
  if (input.state.inputIds.length === 0) {
    return [];
  }

  const enabledAutoReplyChannels = new Set(
    (await readAssistantAutomationState(input.vaultRoot)).autoReply
      .map((entry) => entry.channel),
  );
  const remaining: { cursor: AssistantInputCursor; inputId: string }[] = [];
  for (const inputId of input.state.inputIds) {
    const event = await readAssistantInputEvent({
      inputId,
      paths: input.paths,
    });
    if (!event) {
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
      remaining.push({
        cursor: event.cursor,
        inputId,
      });
    }
  }

  const remainingState = createHostedPendingAssistantInputState(
    remaining
      .sort((left, right) => compareAssistantInputCursors(left.cursor, right.cursor))
      .map((item) => item.inputId),
    {
      backfillAfterInputId: input.state.backfillAfterInputId,
      backfilled: input.state.backfilled,
    },
  );

  if (!sameHostedPendingAssistantInputState(remainingState, input.state)) {
    await writeHostedPendingAssistantInputStateAtPath({
      filePath: input.filePath,
      state: remainingState,
    });
  }
  return [...remainingState.inputIds];
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
  const backfillAfterInputId = "backfillAfterInputId" in state
    ? state.backfillAfterInputId === null
      ? null
      : parseHostedPendingAssistantInputId(state.backfillAfterInputId)
    : null;
  const backfilled = "backfilled" in state
    ? parseHostedPendingAssistantInputBoolean(
      state.backfilled,
      "hosted pending assistant input state backfilled",
    )
    : false;
  if (backfilled && backfillAfterInputId !== null) {
    throw new TypeError(
      "hosted pending assistant input state cannot retain a backfill cursor after backfill.",
    );
  }

  return {
    backfillAfterInputId,
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
  const state = parseHostedPendingAssistantInputState(input.state);
  await writeAssistantStateVersionedJson({
    filePath: input.filePath,
    schema: HOSTED_PENDING_ASSISTANT_INPUT_STATE_SCHEMA,
    schemaVersion: HOSTED_PENDING_ASSISTANT_INPUT_STATE_SCHEMA_VERSION,
    value: state.backfillAfterInputId
      ? state
      : {
          backfilled: state.backfilled,
          inputIds: state.inputIds,
        },
  });
}

function resolveHostedPendingAssistantInputStatePathFromRoot(
  assistantStateRoot: string,
): string {
  return path.join(assistantStateRoot, "hosted-pending-inputs.json");
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
    backfillAfterInputId: null,
    backfilled: input.backfilled,
    inputIds: [],
  };
}

function createHostedPendingAssistantInputState(
  inputIds: readonly string[],
  input?: {
    backfillAfterInputId?: string | null;
    backfilled?: boolean;
  },
): HostedPendingAssistantInputState {
  return {
    backfillAfterInputId: input?.backfillAfterInputId ?? null,
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
    backfillAfterInputId: input.state.backfillAfterInputId,
    backfilled: input.state.backfilled,
  });
}

function normalizeHostedPendingAssistantInputMigrationBatchLimit(
  value: number | undefined,
): number {
  if (value === undefined) {
    return HOSTED_PENDING_INPUT_MIGRATION_BATCH_LIMIT;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError("hosted pending assistant input batch limit must be a positive integer.");
  }
  return Math.min(value, HOSTED_PENDING_INPUT_MIGRATION_BATCH_LIMIT);
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
    && left.backfillAfterInputId === right.backfillAfterInputId
    && sameStringArray(left.inputIds, right.inputIds);
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
