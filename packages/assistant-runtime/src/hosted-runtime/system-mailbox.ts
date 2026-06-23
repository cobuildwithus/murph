import { rm } from "node:fs/promises";
import path from "node:path";

import {
  type HostedExecutionSystemWake,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedExecutionWake,
} from "@murphai/hosted-execution/parsers";
import type {
  AssistantExecutionContext,
} from "@murphai/assistant-engine";
import {
  withAssistantRuntimeWriteLock,
} from "@murphai/assistant-engine/assistant-state";
import {
  parseVersionedJsonStateEnvelope,
  readVersionedJsonStateFile,
} from "@murphai/runtime-state/node";
import {
  resolveAssistantStatePaths,
  writeAssistantStateVersionedJson,
} from "@murphai/runtime-state/node/assistant-state-fs";

import {
  createHostedAssistantChannelTypingDependencies,
} from "./channel-activity.ts";
import {
  bootstrapHostedMemberContext,
} from "./context.ts";
import {
  executeHostedMailboxEvent,
} from "./events.ts";
import {
  readHostedRuntimeSafeErrorText,
} from "./diagnostic-redaction.ts";
import type {
  HostedMailboxItemImportOutcome,
  HostedMailboxResolvedImportItem,
} from "./mailbox-import.ts";
import {
  HOSTED_DEVICE_SYNC_DIRTY_PENDING_FETCH_LIMIT,
} from "../hosted-device-sync-limits.ts";
import type {
  HostedDeviceSyncDirtyProcessedPostCheckpointRecord,
  HostedMailboxExecutionMetrics,
  HostedSystemMailboxPostCheckpointRecord,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import {
  HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
  createHostedRuntimeWakeCandidate,
  selectHostedRuntimeWakeCandidate,
} from "./wake-candidates.ts";

const HOSTED_SYSTEM_MAILBOX_STATE_SCHEMA = "murph.hosted-system-mailbox-state.v1";
const HOSTED_SYSTEM_MAILBOX_STATE_SCHEMA_VERSION = 1;
const HOSTED_SYSTEM_MAILBOX_STATE_LABEL = "hosted system mailbox state";
const HOSTED_DEVICE_SYNC_DIRTY_ACK_BATCH_MAX_RECORDS = HOSTED_DEVICE_SYNC_DIRTY_PENDING_FETCH_LIMIT;
const HOSTED_DEVICE_SYNC_DIRTY_ACK_MAX_PAYLOAD_IDS = 500;
const HOSTED_CODEX_HOME_DIR_NAME = ".codex-hosted";
const HOSTED_CODEX_AUTH_FILE_NAME = "auth.json";

export type HostedSystemMailboxRouteAction =
  | "apply-member-activation"
  | "apply-member-channels-update"
  | "dispatch-assistant-notification"
  | "run-device-sync-wake"
  | "apply-runtime-control-request";

export interface HostedSystemMailboxPendingItem {
  attemptCount: number;
  itemId: string;
  lastAttemptAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  mailboxDedupeKey: string;
  nextAttemptAt: string | null;
  occurredAt: string;
  postCheckpointRecord: HostedSystemMailboxPostCheckpointRecord | null;
  requestId: string | null;
  routeAction: HostedSystemMailboxRouteAction;
  status: "pending" | "recording" | "sending";
  wake: HostedExecutionSystemWake;
}

interface HostedSystemMailboxState {
  pending: HostedSystemMailboxPendingItem[];
}

export type HostedSystemMailboxCheckpointPreparation =
  | {
      errorCode: string | null;
      errorMessage: string | null;
      itemId: string;
      nextWakeAt: string;
      status: "retryable_failed";
    }
  | {
      item: HostedSystemMailboxPendingItem;
      itemId: string;
      metrics: HostedMailboxExecutionMetrics;
      status: "processed";
    }
  | {
      item: HostedSystemMailboxPendingItem;
      itemId: string;
      status: "recording";
    };

export type HostedSystemMailboxRuntime = Pick<
  NormalizedHostedAssistantRuntimeConfig,
  "commitTimeoutMs" | "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
>;

interface HostedSystemMailboxPostCheckpointRecordResult {
  nextWakeAt: string | null;
  recorded: number;
  stillDirty: boolean;
}

export async function enqueueHostedSystemMailboxItem(input: {
  item: HostedMailboxResolvedImportItem;
  vaultRoot: string;
  wake: HostedExecutionSystemWake;
}): Promise<HostedMailboxItemImportOutcome> {
  const routeAction = readHostedSystemMailboxRouteAction(input.item);
  if (!routeAction) {
    return {
      reasonCode: "system_mailbox.unsupported_route",
      status: "deferred",
    };
  }

  if (routeAction === "apply-member-activation" && input.wake.kind === "member.activated") {
    await bootstrapHostedMemberContext(input.vaultRoot, input.wake);
  }

  const nextItem: HostedSystemMailboxPendingItem = {
    attemptCount: 0,
    itemId: input.item.item.id,
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    mailboxDedupeKey: input.item.item.dedupeKey,
    nextAttemptAt: null,
    occurredAt: input.item.item.occurredAt,
    postCheckpointRecord: null,
    requestId: input.item.payload.requestId ?? null,
    routeAction,
    status: "pending",
    wake: input.wake,
  };
  await updateHostedSystemMailboxState(input.vaultRoot, (state) => ({
    pending: state.pending.some((item) => item.itemId === nextItem.itemId)
      ? state.pending.map((item) => item.itemId === nextItem.itemId ? nextItem : item)
      : [...state.pending, nextItem],
  }));

  return {
    reasonCode: "system_mailbox.queued",
    status: "imported",
  };
}

export async function prepareHostedSystemMailboxItemForCheckpoint(input: {
  allowedRouteActions?: readonly HostedSystemMailboxRouteAction[] | null;
  executionContext?: AssistantExecutionContext | null;
  now?: () => string;
  operatorHomeRoot?: string | null;
  runtime: HostedSystemMailboxRuntime;
  runtimeEnv: Readonly<Record<string, string>>;
  shouldYieldBackgroundMaintenance?: (() => boolean) | null;
  vaultRoot: string;
}): Promise<HostedSystemMailboxCheckpointPreparation | null> {
  const startedAt = (input.now ?? (() => new Date().toISOString()))();
  const prepared = await updateHostedSystemMailboxState(
    input.vaultRoot,
    (state) => {
      const pending = findNextHostedSystemMailboxQueueItem({
        allowedRouteActions: input.allowedRouteActions ?? null,
        now: startedAt,
        state,
      });
      if (!pending) {
        return {
          result: null,
          state,
        };
      }

      const nextItem: HostedSystemMailboxPendingItem = {
        ...pending,
        attemptCount: pending.attemptCount + 1,
        lastAttemptAt: startedAt,
        lastErrorCode: null,
        lastErrorMessage: null,
        nextAttemptAt: null,
        status: pending.status === "recording" ? "recording" : "sending",
      };
      return {
        result: nextItem,
        state: {
          pending: state.pending.map((item) => item.itemId === pending.itemId ? nextItem : item),
        },
      };
    },
  );
  if (!prepared) {
    return null;
  }

  if (prepared.status === "recording") {
    return {
      item: prepared,
      itemId: prepared.itemId,
      status: "recording",
    };
  }

  try {
    const metrics = await executePendingHostedSystemMailboxItem({
      executionContext: input.executionContext ?? null,
      operatorHomeRoot: input.operatorHomeRoot ?? undefined,
      pendingItem: prepared,
      runtime: input.runtime,
      runtimeEnv: input.runtimeEnv,
      shouldYieldBackgroundMaintenance: input.shouldYieldBackgroundMaintenance ?? null,
      vaultRoot: input.vaultRoot,
    });
    const postCheckpointRecord = metrics.postCheckpointRecord ?? null;
    if (postCheckpointRecord) {
      const processedItem: HostedSystemMailboxPendingItem = {
        ...prepared,
        postCheckpointRecord,
        status: "recording",
      };
      await updateHostedSystemMailboxPendingItem({
        item: processedItem,
        vaultRoot: input.vaultRoot,
      });
      return {
        item: processedItem,
        itemId: prepared.itemId,
        metrics,
        status: "processed",
      };
    } else {
      await removeHostedSystemMailboxPendingItem({
        itemId: prepared.itemId,
        vaultRoot: input.vaultRoot,
      });
    }
    return {
      item: prepared,
      itemId: prepared.itemId,
      metrics,
      status: "processed",
    };
  } catch (error) {
    const normalized = normalizeHostedSystemMailboxError(error);
    const nextWakeAt = new Date(Date.parse(startedAt) + 60_000).toISOString();
    await updateHostedSystemMailboxPendingItem({
      item: {
        ...prepared,
        lastErrorCode: normalized.code,
        lastErrorMessage: normalized.message,
        nextAttemptAt: nextWakeAt,
        status: "pending",
      },
      vaultRoot: input.vaultRoot,
    });
    return {
      errorCode: normalized.code,
      errorMessage: normalized.message,
      itemId: prepared.itemId,
      nextWakeAt,
      status: "retryable_failed",
    };
  }
}

export async function resolveHostedSystemMailboxNextWakeAt(input: {
  allowedRouteActions?: readonly HostedSystemMailboxRouteAction[] | null;
  now?: () => string;
  vaultRoot: string;
}): Promise<string | null> {
  const now = (input.now ?? (() => new Date().toISOString()))();
  const state = await readHostedSystemMailboxState(input.vaultRoot);
  const items = findNextHostedSystemMailboxQueueItemsForWake({
    allowedRouteActions: input.allowedRouteActions ?? null,
    state,
  });
  const wakeTimes = items
    .map((item) => resolveSystemMailboxItemNextWakeAt(item, now))
    .filter((value): value is string => value !== null)
    .sort();

  return wakeTimes[0] ?? null;
}

export async function recordHostedSystemMailboxItemAfterCheckpoint(input: {
  item: HostedSystemMailboxPendingItem;
  operatorHomeRoot?: string | null;
  runtime: HostedSystemMailboxRuntime;
  vaultRoot: string;
}): Promise<{
  failed: number;
  nextWakeAt: string | null;
  nextWakeReason?: string | null;
  recorded: number;
}> {
  if (!input.item.postCheckpointRecord) {
    return {
      failed: 0,
      nextWakeAt: await resolveHostedSystemMailboxNextWakeAt({ vaultRoot: input.vaultRoot }),
      recorded: 0,
    };
  }

  try {
    const recordResult = await recordHostedSystemMailboxPostCheckpointRecord({
      operatorHomeRoot: input.operatorHomeRoot ?? null,
      record: input.item.postCheckpointRecord,
      runtime: input.runtime,
    });
    await removeHostedSystemMailboxPendingItem({
      itemId: input.item.itemId,
      vaultRoot: input.vaultRoot,
    });
    const nextWake = selectHostedRuntimeWakeCandidate([
      createHostedRuntimeWakeCandidate(
        await resolveHostedSystemMailboxNextWakeAt({ vaultRoot: input.vaultRoot }),
        "assistant",
      ),
      createHostedRuntimeWakeCandidate(
        recordResult.nextWakeAt,
        HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
      ),
    ]);
    return {
      failed: 0,
      nextWakeAt: nextWake.at,
      ...(nextWake.reason === HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON
        ? { nextWakeReason: nextWake.reason }
        : {}),
      recorded: recordResult.recorded,
    };
  } catch (error) {
    const normalized = normalizeHostedSystemMailboxError(error);
    const nextWakeAt = new Date(Date.now() + 60_000).toISOString();
    await updateHostedSystemMailboxPendingItem({
      item: {
        ...input.item,
        lastErrorCode: normalized.code,
        lastErrorMessage: normalized.message,
        nextAttemptAt: nextWakeAt,
        status: "recording",
      },
      vaultRoot: input.vaultRoot,
    });
    return {
      failed: 1,
      nextWakeAt,
      recorded: 0,
    };
  }
}

export async function readHostedSystemMailboxCheckpointRollbackState(input: {
  vaultRoot: string;
}): Promise<HostedSystemMailboxState> {
  return readHostedSystemMailboxState(input.vaultRoot);
}

export async function restoreHostedSystemMailboxCheckpointRollbackState(input: {
  discardItemIds?: readonly string[];
  state: HostedSystemMailboxState;
  vaultRoot: string;
}): Promise<void> {
  if (input.discardItemIds && input.discardItemIds.length > 0) {
    const discardItemIds = new Set(input.discardItemIds);
    const rollbackItemsById = new Map(
      input.state.pending
        .filter((item) => discardItemIds.has(item.itemId))
        .map((item) => [item.itemId, item] as const),
    );
    await updateHostedSystemMailboxState(input.vaultRoot, (state) => ({
      pending: mergeHostedSystemMailboxRollbackItems({
        current: state.pending,
        discardItemIds,
        rollback: input.state.pending,
        rollbackItemsById,
      }),
    }));
    return;
  }

  await updateHostedSystemMailboxState(input.vaultRoot, () => input.state);
}

async function executePendingHostedSystemMailboxItem(input: {
  executionContext: AssistantExecutionContext | null;
  operatorHomeRoot?: string | null;
  pendingItem: HostedSystemMailboxPendingItem;
  runtime: HostedSystemMailboxRuntime;
  runtimeEnv: Readonly<Record<string, string>>;
  shouldYieldBackgroundMaintenance?: (() => boolean) | null;
  vaultRoot: string;
}): Promise<HostedMailboxExecutionMetrics> {
  const executionContext =
    input.executionContext
    ?? buildHostedSystemMailboxExecutionContext({
      runtime: input.runtime,
      wake: input.pendingItem.wake,
    });

  return executeHostedMailboxEvent({
    executionContext,
    forceQueueOnlyAssistantNotification: true,
    operatorHomeRoot: input.operatorHomeRoot ?? undefined,
    runtime: input.runtime,
    runtimeEnv: input.runtimeEnv,
    ...(input.shouldYieldBackgroundMaintenance
      ? { shouldYieldDeviceSync: input.shouldYieldBackgroundMaintenance }
      : {}),
    sourceMailboxItemId: input.pendingItem.itemId,
    vaultRoot: input.vaultRoot,
    wake: input.pendingItem.wake,
  });
}

function buildHostedSystemMailboxExecutionContext(input: {
  runtime: HostedSystemMailboxRuntime;
  wake: HostedExecutionSystemWake;
}): AssistantExecutionContext {
  return {
    hosted: {
      channelTypingDependencies: createHostedAssistantChannelTypingDependencies({
        forwardedEnv: input.runtime.forwardedEnv,
        platformEnv: input.runtime.platformEnv,
        providerFetch: input.runtime.platform.providerFetch ?? null,
        userEnv: input.runtime.userEnv,
      }),
      memberId: input.wake.userId,
      userEnvKeys: Object.keys(input.runtime.userEnv),
    },
  };
}

async function removeHostedSystemMailboxPendingItem(input: {
  itemId: string;
  vaultRoot: string;
}): Promise<void> {
  await removeHostedSystemMailboxPendingItems({
    itemIds: [input.itemId],
    vaultRoot: input.vaultRoot,
  });
}

async function removeHostedSystemMailboxPendingItems(input: {
  itemIds: readonly string[];
  vaultRoot: string;
}): Promise<void> {
  const itemIds = new Set(input.itemIds);
  await updateHostedSystemMailboxState(input.vaultRoot, (state) => ({
    pending: state.pending.filter((item) => !itemIds.has(item.itemId)),
  }));
}

async function updateHostedSystemMailboxPendingItem(input: {
  item: HostedSystemMailboxPendingItem;
  vaultRoot: string;
}): Promise<void> {
  await updateHostedSystemMailboxState(input.vaultRoot, (state) => ({
    pending: state.pending.map((item) =>
      item.itemId === input.item.itemId ? input.item : item
    ),
  }));
}

async function updateHostedSystemMailboxState<TResult = void>(
  vaultRoot: string,
  update: (
    state: HostedSystemMailboxState,
  ) =>
    | HostedSystemMailboxState
    | { result: TResult; state: HostedSystemMailboxState }
    | Promise<HostedSystemMailboxState | { result: TResult; state: HostedSystemMailboxState }>,
): Promise<TResult> {
  return await withAssistantRuntimeWriteLock(vaultRoot, async () => {
    const current = await readHostedSystemMailboxState(vaultRoot);
    const updated = await update(current);
    const nextState = isHostedSystemMailboxStateUpdateResult<TResult>(updated)
      ? updated.state
      : updated;
    await writeHostedSystemMailboxState(vaultRoot, nextState);
    return isHostedSystemMailboxStateUpdateResult<TResult>(updated)
      ? updated.result
      : undefined as TResult;
  });
}

function isHostedSystemMailboxStateUpdateResult<TResult>(
  value: HostedSystemMailboxState | { result: TResult; state: HostedSystemMailboxState },
): value is { result: TResult; state: HostedSystemMailboxState } {
  return typeof (value as { result?: unknown }).result !== "undefined"
    && typeof (value as { state?: unknown }).state !== "undefined";
}

async function readHostedSystemMailboxState(
  vaultRoot: string,
): Promise<HostedSystemMailboxState> {
  try {
    const result = await readVersionedJsonStateFile({
      currentPath: resolveHostedSystemMailboxStatePath(vaultRoot),
      label: HOSTED_SYSTEM_MAILBOX_STATE_LABEL,
      parseValue: parseHostedSystemMailboxStateValue,
      schema: HOSTED_SYSTEM_MAILBOX_STATE_SCHEMA,
      schemaVersion: HOSTED_SYSTEM_MAILBOX_STATE_SCHEMA_VERSION,
    });
    return result.value;
  } catch (error) {
    if (isNodeFileNotFoundError(error)) {
      return {
        pending: [],
      };
    }
    throw error;
  }
}

async function writeHostedSystemMailboxState(
  vaultRoot: string,
  state: HostedSystemMailboxState,
): Promise<void> {
  await writeAssistantStateVersionedJson({
    filePath: resolveHostedSystemMailboxStatePath(vaultRoot),
    schema: HOSTED_SYSTEM_MAILBOX_STATE_SCHEMA,
    schemaVersion: HOSTED_SYSTEM_MAILBOX_STATE_SCHEMA_VERSION,
    value: parseHostedSystemMailboxStateValue(state),
  });
}

function resolveHostedSystemMailboxStatePath(vaultRoot: string): string {
  return path.join(
    resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
    "hosted-system-mailbox.json",
  );
}

function parseHostedSystemMailboxStateValue(value: unknown): HostedSystemMailboxState {
  if (isVersionedJsonEnvelope(value)) {
    return parseVersionedJsonStateEnvelope(value, {
      label: HOSTED_SYSTEM_MAILBOX_STATE_LABEL,
      parseValue: parseHostedSystemMailboxStateValue,
      schema: HOSTED_SYSTEM_MAILBOX_STATE_SCHEMA,
      schemaVersion: HOSTED_SYSTEM_MAILBOX_STATE_SCHEMA_VERSION,
    });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("hosted system mailbox state must be an object.");
  }
  const pending = (value as { pending?: unknown }).pending;
  if (!Array.isArray(pending)) {
    throw new TypeError("hosted system mailbox state.pending must be an array.");
  }

  return {
    pending: pending.map(parseHostedSystemMailboxPendingItem),
  };
}

function parseHostedSystemMailboxPendingItem(value: unknown): HostedSystemMailboxPendingItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("hosted system mailbox pending item must be an object.");
  }
  const record = value as Record<string, unknown>;
  const wake = parseHostedExecutionWake(record.wake);
  if (wake.kind === "conversation.message") {
    throw new TypeError("hosted system mailbox wake must be a system wake.");
  }

  return {
    itemId: readRequiredString(record.itemId, "hosted system mailbox itemId"),
    attemptCount: readNonNegativeInteger(
      record.attemptCount ?? 0,
      "hosted system mailbox attemptCount",
    ),
    lastAttemptAt: record.lastAttemptAt === null || record.lastAttemptAt === undefined
      ? null
      : readRequiredString(record.lastAttemptAt, "hosted system mailbox lastAttemptAt"),
    lastErrorCode: record.lastErrorCode === null || record.lastErrorCode === undefined
      ? null
      : readRequiredString(record.lastErrorCode, "hosted system mailbox lastErrorCode"),
    lastErrorMessage: record.lastErrorMessage === null || record.lastErrorMessage === undefined
      ? null
      : readRequiredString(record.lastErrorMessage, "hosted system mailbox lastErrorMessage"),
    mailboxDedupeKey: readRequiredString(
      record.mailboxDedupeKey,
      "hosted system mailbox mailboxDedupeKey",
    ),
    nextAttemptAt: record.nextAttemptAt === null || record.nextAttemptAt === undefined
      ? null
      : readRequiredString(record.nextAttemptAt, "hosted system mailbox nextAttemptAt"),
    occurredAt: readRequiredString(record.occurredAt, "hosted system mailbox occurredAt"),
    postCheckpointRecord: record.postCheckpointRecord === null
      || record.postCheckpointRecord === undefined
      ? null
      : parseHostedSystemMailboxRecordRequest(record.postCheckpointRecord),
    requestId: record.requestId === null || record.requestId === undefined
      ? null
      : readRequiredString(record.requestId, "hosted system mailbox requestId"),
    routeAction: parseHostedSystemMailboxRouteAction(record.routeAction),
    status: record.status === undefined
      ? "pending"
      : parseHostedSystemMailboxStatus(record.status),
    wake,
  };
}

function readHostedSystemMailboxRouteAction(
  item: HostedMailboxResolvedImportItem,
): HostedSystemMailboxRouteAction | null {
  if (
    item.route.action === "apply-member-activation"
    || item.route.action === "apply-member-channels-update"
    || item.route.action === "dispatch-assistant-notification"
    || item.route.action === "run-device-sync-wake"
    || item.route.action === "apply-runtime-control-request"
  ) {
    return item.route.action;
  }

  return null;
}

function parseHostedSystemMailboxRouteAction(value: unknown): HostedSystemMailboxRouteAction {
  if (
    value === "apply-member-activation"
    || value === "apply-member-channels-update"
    || value === "dispatch-assistant-notification"
    || value === "run-device-sync-wake"
    || value === "apply-runtime-control-request"
  ) {
    return value;
  }

  throw new TypeError("hosted system mailbox routeAction is invalid.");
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function readOptionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array when present.`);
  }
  if (value.length > HOSTED_DEVICE_SYNC_DIRTY_ACK_MAX_PAYLOAD_IDS) {
    throw new TypeError(
      `${label} must contain at most ${HOSTED_DEVICE_SYNC_DIRTY_ACK_MAX_PAYLOAD_IDS} entries.`,
    );
  }
  return value.map((entry, index) => readRequiredString(entry, `${label}[${index}]`));
}

function readNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer.`);
  }
  return value as number;
}

function parseHostedSystemMailboxStatus(value: unknown): "pending" | "recording" | "sending" {
  if (value === "pending" || value === "recording" || value === "sending") {
    return value;
  }
  throw new TypeError("hosted system mailbox status is invalid.");
}

function parseHostedSystemMailboxRecordRequest(
  value: unknown,
): HostedSystemMailboxPostCheckpointRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("hosted system mailbox postCheckpointRecord must be an object.");
  }
  const record = value as Record<string, unknown>;

  if (record.kind === "device-sync.dirty-processed") {
    return {
      kind: "device-sync.dirty-processed",
      ...parseHostedDeviceSyncDirtyProcessedPostCheckpointRecord(
        record,
        "hosted system mailbox postCheckpointRecord",
      ),
    };
  }

  if (record.kind === "device-sync.dirty-processed-batch") {
    if (!Array.isArray(record.records) || record.records.length === 0) {
      throw new TypeError(
        "hosted system mailbox postCheckpointRecord records must be a non-empty array.",
      );
    }
    if (record.records.length > HOSTED_DEVICE_SYNC_DIRTY_ACK_BATCH_MAX_RECORDS) {
      throw new TypeError(
        "hosted system mailbox postCheckpointRecord records exceeds the dirty ack batch limit.",
      );
    }
    return {
      kind: "device-sync.dirty-processed-batch",
      ...(record.nextWakeAt === undefined
        ? {}
        : {
            nextWakeAt: readNullableIsoTimestamp(
              record.nextWakeAt,
              "hosted system mailbox postCheckpointRecord nextWakeAt",
            ),
          }),
      records: record.records.map((entry, index) =>
        parseHostedDeviceSyncDirtyProcessedPostCheckpointRecord(
          entry,
          `hosted system mailbox postCheckpointRecord records[${index}]`,
        )
      ),
    };
  }

  if (record.kind === "codex-auth.updated") {
    assertHostedSystemMailboxRecordKeys(
      record,
      ["attemptId", "kind", "phase"],
      "hosted system mailbox Codex auth postCheckpointRecord",
    );
    if (record.phase !== "connected" && record.phase !== "disconnected") {
      throw new TypeError(
        "hosted system mailbox Codex auth postCheckpointRecord phase is invalid.",
      );
    }
    return {
      attemptId: readRequiredString(
        record.attemptId,
        "hosted system mailbox Codex auth postCheckpointRecord attemptId",
      ),
      kind: "codex-auth.updated",
      phase: record.phase,
    };
  }

  throw new TypeError("hosted system mailbox postCheckpointRecord kind is invalid.");
}

function assertHostedSystemMailboxRecordKeys(
  record: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  const unsupported = Object.keys(record).find((key) => !allowed.has(key));
  if (unsupported) {
    throw new TypeError(`${label} contains unsupported field ${unsupported}.`);
  }
}

function parseHostedDeviceSyncDirtyProcessedPostCheckpointRecord(
  value: unknown,
  label: string,
): HostedDeviceSyncDirtyProcessedPostCheckpointRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const record = value as Record<string, unknown>;

  return {
    connectionId: readRequiredString(record.connectionId, `${label} connectionId`),
    ...(record.nextWakeAt === undefined
      ? {}
      : {
          nextWakeAt: readNullableIsoTimestamp(
            record.nextWakeAt,
            `${label} nextWakeAt`,
          ),
        }),
    ...(record.processedDirtyPayloadIds === undefined
      ? {}
      : {
          processedDirtyPayloadIds: readOptionalStringArray(
            record.processedDirtyPayloadIds,
            `${label} processedDirtyPayloadIds`,
          ),
        }),
    processedRevision: readRequiredString(record.processedRevision, `${label} processedRevision`),
  };
}

export async function recordHostedDeviceSyncDirtyPostCheckpointRecord(input: {
  record: HostedSystemMailboxPostCheckpointRecord;
  runtime: HostedSystemMailboxRuntime;
}): Promise<HostedSystemMailboxPostCheckpointRecordResult> {
  return await recordHostedSystemMailboxPostCheckpointRecord({
    ...input,
    operatorHomeRoot: null,
  });
}

async function recordHostedSystemMailboxPostCheckpointRecord(input: {
  operatorHomeRoot: string | null;
  record: HostedSystemMailboxPostCheckpointRecord;
  runtime: HostedSystemMailboxRuntime;
}): Promise<HostedSystemMailboxPostCheckpointRecordResult> {
  switch (input.record.kind) {
    case "codex-auth.updated": {
      const port = input.runtime.platform.codexAuthPort;
      if (!port) {
        throw new Error("Hosted Codex auth checkpoint requires a configured Codex auth port.");
      }
      const response = await port.update({
        attemptId: input.record.attemptId,
        phase: input.record.phase,
      });
      if (input.record.phase === "connected" && response.status === "superseded") {
        await removeHostedCodexAuthJson(input.operatorHomeRoot);
      }
      return {
        nextWakeAt: null,
        recorded: response.status === "superseded" ? 0 : 1,
        stillDirty: false,
      };
    }
    case "device-sync.dirty-processed":
      return await recordHostedDeviceSyncDirtyProcessedRecords({
        records: [input.record],
        runtime: input.runtime,
      });
    case "device-sync.dirty-processed-batch":
      return await recordHostedDeviceSyncDirtyProcessedRecords({
        nextWakeAt: input.record.nextWakeAt ?? null,
        records: input.record.records,
        runtime: input.runtime,
      });
  }
}

async function removeHostedCodexAuthJson(
  operatorHomeRoot: string | null,
): Promise<void> {
  if (!operatorHomeRoot) {
    return;
  }
  await rm(
    path.join(operatorHomeRoot, HOSTED_CODEX_HOME_DIR_NAME, HOSTED_CODEX_AUTH_FILE_NAME),
    { force: true },
  );
}

async function recordHostedDeviceSyncDirtyProcessedRecords(input: {
  nextWakeAt?: string | null;
  records: readonly HostedDeviceSyncDirtyProcessedPostCheckpointRecord[];
  runtime: HostedSystemMailboxRuntime;
}): Promise<HostedSystemMailboxPostCheckpointRecordResult> {
  const port = input.runtime.platform.deviceSyncPort;
  if (!port) {
    throw new Error("Hosted device-sync dirty ack requires a configured device-sync runtime port.");
  }

  let nextWakeAt = input.records.length === 0 ? input.nextWakeAt ?? null : null;
  let recorded = 0;
  let stillDirty = false;

  for (const [index, record] of input.records.entries()) {
    const stagedDirtyAcks = input.records
      .slice(index + 1)
      .map(toHostedDeviceSyncStagedDirtyAck);
    const response = await port.ackDirtyStateProcessed({
      connectionId: record.connectionId,
      ...(record.processedDirtyPayloadIds
        ? { processedDirtyPayloadIds: record.processedDirtyPayloadIds }
        : {}),
      processedRevision: record.processedRevision,
      ...(stagedDirtyAcks.length > 0 ? { stagedDirtyAcks } : {}),
    });
    if (response.recorded) {
      recorded += 1;
    }
    stillDirty = stillDirty || response.stillDirty;
    if (shouldUseHostedDirtyAckWake(index, input.records.length, response.stillDirty)) {
      nextWakeAt = earliestHostedSystemMailboxWakeAt(nextWakeAt, response.nextWakeAt);
    }
  }

  return {
    nextWakeAt,
    recorded,
    stillDirty,
  };
}

function toHostedDeviceSyncStagedDirtyAck(
  record: HostedDeviceSyncDirtyProcessedPostCheckpointRecord,
): {
  connectionId: string;
  processedDirtyPayloadIds?: string[];
  processedRevision: string;
} {
  return {
    connectionId: record.connectionId,
    ...(record.processedDirtyPayloadIds
      ? { processedDirtyPayloadIds: [...record.processedDirtyPayloadIds] }
      : {}),
    processedRevision: record.processedRevision,
  };
}

function shouldUseHostedDirtyAckWake(
  index: number,
  length: number,
  stillDirty: boolean,
): boolean {
  return stillDirty || index === length - 1;
}

function readNullableIsoTimestamp(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string or null.`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`${label} must be an ISO timestamp.`);
  }
  return value;
}

function earliestHostedSystemMailboxWakeAt(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function systemMailboxItemIsDue(
  item: HostedSystemMailboxPendingItem,
  now: string,
): boolean {
  return resolveSystemMailboxItemNextWakeAt(item, now) === now;
}

function findNextHostedSystemMailboxQueueItem(input: {
  allowedRouteActions: readonly HostedSystemMailboxRouteAction[] | null;
  now: string;
  state: HostedSystemMailboxState;
}): HostedSystemMailboxPendingItem | null {
  if (input.allowedRouteActions) {
    const item = input.state.pending.find((pending) =>
      systemMailboxItemRouteActionAllowed(pending, input.allowedRouteActions)
    ) ?? null;
    return item && systemMailboxItemIsDue(item, input.now) ? item : null;
  }

  const blockedRouteActions = new Set<HostedSystemMailboxRouteAction>();
  for (const item of input.state.pending) {
    if (blockedRouteActions.has(item.routeAction)) {
      continue;
    }
    if (systemMailboxItemIsDue(item, input.now)) {
      return item;
    }
    blockedRouteActions.add(item.routeAction);
  }

  return null;
}

function findNextHostedSystemMailboxQueueItemsForWake(input: {
  allowedRouteActions: readonly HostedSystemMailboxRouteAction[] | null;
  state: HostedSystemMailboxState;
}): HostedSystemMailboxPendingItem[] {
  if (input.allowedRouteActions) {
    const item = input.state.pending.find((pending) =>
      systemMailboxItemRouteActionAllowed(pending, input.allowedRouteActions)
    ) ?? null;
    return item ? [item] : [];
  }

  const seenRouteActions = new Set<HostedSystemMailboxRouteAction>();
  const items: HostedSystemMailboxPendingItem[] = [];
  for (const item of input.state.pending) {
    if (seenRouteActions.has(item.routeAction)) {
      continue;
    }
    seenRouteActions.add(item.routeAction);
    items.push(item);
  }
  return items;
}

function systemMailboxItemRouteActionAllowed(
  item: HostedSystemMailboxPendingItem,
  allowedRouteActions: readonly HostedSystemMailboxRouteAction[] | null,
): boolean {
  return !allowedRouteActions || allowedRouteActions.includes(item.routeAction);
}

function resolveSystemMailboxItemNextWakeAt(
  item: HostedSystemMailboxPendingItem,
  now: string,
): string | null {
  if (!item.nextAttemptAt) {
    return now;
  }

  const nextAttemptMs = Date.parse(item.nextAttemptAt);
  if (!Number.isFinite(nextAttemptMs)) {
    return now;
  }

  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs) || nextAttemptMs <= nowMs) {
    return now;
  }

  return item.nextAttemptAt;
}

function mergeHostedSystemMailboxRollbackItems(input: {
  current: readonly HostedSystemMailboxPendingItem[];
  discardItemIds: ReadonlySet<string>;
  rollback: readonly HostedSystemMailboxPendingItem[];
  rollbackItemsById: ReadonlyMap<string, HostedSystemMailboxPendingItem>;
}): HostedSystemMailboxPendingItem[] {
  const currentById = new Map(input.current.map((item) => [item.itemId, item] as const));
  const emitted = new Set<string>();
  const pending: HostedSystemMailboxPendingItem[] = [];

  for (const rollbackItem of input.rollback) {
    const restored = input.rollbackItemsById.get(rollbackItem.itemId) ?? null;
    const current = currentById.get(rollbackItem.itemId) ?? null;
    const item = restored ?? current;
    if (!item) {
      continue;
    }
    pending.push(item);
    emitted.add(item.itemId);
  }

  for (const current of input.current) {
    if (!emitted.has(current.itemId) && !input.discardItemIds.has(current.itemId)) {
      pending.push(current);
    }
  }

  return pending;
}

function normalizeHostedSystemMailboxError(error: unknown): {
  code: string;
  message: string;
} {
  if (error instanceof Error) {
    const codedError: Error & { code?: unknown } = error;
    const code = typeof codedError.code === "string"
      ? codedError.code
      : "HOSTED_SYSTEM_MAILBOX_AMBIGUOUS";
    return {
      code,
      message: readHostedRuntimeSafeErrorText(error) ?? "Hosted system mailbox effect failed.",
    };
  }

  return {
    code: "HOSTED_SYSTEM_MAILBOX_AMBIGUOUS",
    message: readHostedRuntimeSafeErrorText(error) ?? "Hosted system mailbox effect failed.",
  };
}

function isVersionedJsonEnvelope(value: unknown): boolean {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && "schema" in value
    && "schemaVersion" in value
    && "value" in value;
}

function isNodeFileNotFoundError(error: unknown): boolean {
  return !!error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}
