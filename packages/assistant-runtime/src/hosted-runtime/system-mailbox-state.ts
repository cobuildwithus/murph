import path from "node:path";

import {
  type HostedExecutionSystemWake,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedExecutionWake,
} from "@murphai/hosted-execution/parsers";
import {
  parseHostedClinicalRecordsRecordOutcomeRequest,
} from "@murphai/hosted-execution/clinical-records-boundary";
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
  HOSTED_DEVICE_SYNC_DIRTY_PENDING_FETCH_LIMIT,
} from "../hosted-device-sync-limits.ts";
import type {
  HostedDeviceSyncDirtyProcessedPostCheckpointRecord,
  HostedSystemMailboxPostCheckpointRecord,
} from "./models.ts";
import {
  HOSTED_ASSISTANT_WAKE_REASON,
  HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
  createHostedRuntimeWakeCandidate,
  selectHostedRuntimeWakeCandidate,
  type HostedRuntimeWakeCandidate,
} from "./wake-candidates.ts";

const HOSTED_SYSTEM_MAILBOX_STATE_SCHEMA = "murph.hosted-system-mailbox-state.v1";
const HOSTED_SYSTEM_MAILBOX_STATE_SCHEMA_VERSION = 1;
const HOSTED_SYSTEM_MAILBOX_STATE_LABEL = "hosted system mailbox state";
const HOSTED_DEVICE_SYNC_DIRTY_ACK_BATCH_MAX_RECORDS = HOSTED_DEVICE_SYNC_DIRTY_PENDING_FETCH_LIMIT;
const HOSTED_DEVICE_SYNC_DIRTY_ACK_MAX_PAYLOAD_IDS = 500;
const HOSTED_DEVICE_SYNC_DENSE_RAW_RETENTION_MAILBOX_ITEM_ID_PREFIX =
  "system_mailbox_item_device_sync_dense_raw_retention";
const HOSTED_DEVICE_SYNC_DENSE_RAW_RETENTION_MAILBOX_DEDUPE_KEY =
  "device-sync.wake:dense-raw-retention";

export type HostedSystemMailboxRouteAction =
  | "apply-member-activation"
  | "apply-member-channels-update"
  | "apply-member-preferences"
  | "initialize-group-room-model"
  | "dispatch-assistant-notification"
  | "run-assistant-ask"
  | "continue-assistant-ask"
  | "run-clinical-records-sync"
  | "run-device-sync-wake"
  | "run-environment-voice"
  | "apply-runtime-control-request";

export interface HostedSystemMailboxPendingItem {
  attemptCount: number;
  itemId: string;
  lastAttemptAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  mailboxDedupeKey: string;
  mailboxLaneSeq: string | null;
  nextAttemptAt: string | null;
  occurredAt: string;
  postCheckpointRecord: HostedSystemMailboxPostCheckpointRecord | null;
  preferenceCausalSeq?: string | null;
  requestId: string | null;
  routeAction: HostedSystemMailboxRouteAction;
  status: "pending" | "recording" | "sending";
  wake: HostedExecutionSystemWake;
}

export interface HostedSystemMailboxState {
  pending: HostedSystemMailboxPendingItem[];
}

export async function readHostedSystemMailboxState(
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

export async function readHostedSystemMailboxHandledThroughSeq(input: {
  importedSeq: string;
  vaultRoot: string;
}): Promise<string> {
  return resolveHostedSystemMailboxHandledThroughSeq({
    importedSeq: input.importedSeq,
    state: await readHostedSystemMailboxState(input.vaultRoot),
  });
}

export function resolveHostedSystemMailboxHandledThroughSeq(input: {
  importedSeq: string;
  state: HostedSystemMailboxState;
}): string {
  if (!/^(?:0|[1-9]\d*)$/u.test(input.importedSeq)) {
    throw new TypeError("Hosted system mailbox imported seq must be a non-negative decimal string.");
  }

  const importedSeq = BigInt(input.importedSeq);
  let earliestPendingSeq: bigint | null = null;
  for (const item of input.state.pending) {
    if (isHostedDeviceSyncDenseRawRetentionMailboxItem(item)) {
      continue;
    }
    if (item.mailboxLaneSeq === null) {
      return "0";
    }
    const pendingSeq = BigInt(item.mailboxLaneSeq);
    if (earliestPendingSeq === null || pendingSeq < earliestPendingSeq) {
      earliestPendingSeq = pendingSeq;
    }
  }

  if (earliestPendingSeq === null) {
    return importedSeq.toString();
  }
  const handledBeforePending = earliestPendingSeq - 1n;
  return (handledBeforePending < importedSeq ? handledBeforePending : importedSeq).toString();
}

export async function updateHostedSystemMailboxState<TResult = void>(
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

export async function updateHostedSystemMailboxPendingItem(input: {
  item: HostedSystemMailboxPendingItem;
  vaultRoot: string;
}): Promise<void> {
  await updateHostedSystemMailboxState(input.vaultRoot, (state) => ({
    pending: state.pending.map((item) =>
      item.itemId === input.item.itemId ? input.item : item
    ),
  }));
}

export async function removeHostedSystemMailboxPendingItem(input: {
  itemId: string;
  vaultRoot: string;
}): Promise<void> {
  await removeHostedSystemMailboxPendingItems({
    itemIds: [input.itemId],
    vaultRoot: input.vaultRoot,
  });
}

export async function removeHostedSystemMailboxPendingItemIfCurrent(input: {
  item: HostedSystemMailboxPendingItem;
  vaultRoot: string;
}): Promise<boolean> {
  return await updateHostedSystemMailboxState(input.vaultRoot, (state) => {
    const current = state.pending.find((item) => item.itemId === input.item.itemId) ?? null;
    if (!current || !hostedSystemMailboxPendingItemsMatch(current, input.item)) {
      return {
        result: false,
        state,
      };
    }
    return {
      result: true,
      state: {
        pending: state.pending.filter((item) => item.itemId !== input.item.itemId),
      },
    };
  });
}

export async function removeHostedSystemMailboxPendingItems(input: {
  itemIds: readonly string[];
  vaultRoot: string;
}): Promise<void> {
  const itemIds = new Set(input.itemIds);
  await updateHostedSystemMailboxState(input.vaultRoot, (state) => ({
    pending: state.pending.filter((item) => !itemIds.has(item.itemId)),
  }));
}

export async function setHostedDeviceSyncDenseRawRetentionMailboxWakeAt(input: {
  nextWakeAt: string | null;
  now?: () => string;
  userId: string;
  vaultRoot: string;
}): Promise<void> {
  if (!input.nextWakeAt) {
    await removePendingHostedDeviceSyncDenseRawRetentionMailboxSuccessors(input.vaultRoot);
    return;
  }

  const occurredAt = (input.now ?? (() => new Date().toISOString()))();
  const itemId = resolveHostedDeviceSyncDenseRawRetentionMailboxItemId(input.nextWakeAt);
  const wake: HostedExecutionSystemWake = {
    eventId: itemId,
    kind: "device-sync.wake",
    occurredAt,
    reason: "reconcile_due",
    userId: input.userId,
  };
  const nextItem: HostedSystemMailboxPendingItem = {
    attemptCount: 0,
    itemId,
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    mailboxDedupeKey: HOSTED_DEVICE_SYNC_DENSE_RAW_RETENTION_MAILBOX_DEDUPE_KEY,
    mailboxLaneSeq: null,
    nextAttemptAt: input.nextWakeAt,
    occurredAt,
    postCheckpointRecord: null,
    preferenceCausalSeq: null,
    requestId: null,
    routeAction: "run-device-sync-wake",
    status: "pending",
    wake,
  };
  await updateHostedSystemMailboxState(input.vaultRoot, (state) => ({
    pending: [
      ...state.pending.filter((item) =>
        !isPendingHostedDeviceSyncDenseRawRetentionMailboxItem(item)
      ),
      nextItem,
    ],
  }));
}

async function removePendingHostedDeviceSyncDenseRawRetentionMailboxSuccessors(
  vaultRoot: string,
): Promise<void> {
  await updateHostedSystemMailboxState(vaultRoot, (state) => ({
    pending: state.pending.filter((item) =>
      !isPendingHostedDeviceSyncDenseRawRetentionMailboxItem(item)
    ),
  }));
}

function resolveHostedDeviceSyncDenseRawRetentionMailboxItemId(nextWakeAt: string): string {
  return `${HOSTED_DEVICE_SYNC_DENSE_RAW_RETENTION_MAILBOX_ITEM_ID_PREFIX}_${
    Buffer.from(nextWakeAt, "utf8").toString("base64url")
  }`;
}

function isPendingHostedDeviceSyncDenseRawRetentionMailboxItem(
  item: HostedSystemMailboxPendingItem,
): boolean {
  return item.status === "pending"
    && isHostedDeviceSyncDenseRawRetentionMailboxItem(item);
}

function isHostedDeviceSyncDenseRawRetentionMailboxItem(
  item: HostedSystemMailboxPendingItem,
): boolean {
  return item.routeAction === "run-device-sync-wake"
    && item.mailboxDedupeKey === HOSTED_DEVICE_SYNC_DENSE_RAW_RETENTION_MAILBOX_DEDUPE_KEY;
}

export async function resolveHostedSystemMailboxNextWakeAt(input: {
  allowedRouteActions?: readonly HostedSystemMailboxRouteAction[] | null;
  allowedWakeKinds?: readonly HostedExecutionSystemWake["kind"][] | null;
  now?: () => string;
  vaultRoot: string;
}): Promise<string | null> {
  return (await resolveHostedSystemMailboxNextWakeCandidate(input)).at;
}

export async function resolveHostedSystemMailboxNextWakeCandidate(input: {
  allowedRouteActions?: readonly HostedSystemMailboxRouteAction[] | null;
  allowedWakeKinds?: readonly HostedExecutionSystemWake["kind"][] | null;
  now?: () => string;
  vaultRoot: string;
}): Promise<HostedRuntimeWakeCandidate> {
  const now = (input.now ?? (() => new Date().toISOString()))();
  const state = await readHostedSystemMailboxState(input.vaultRoot);
  const selectionState = input.allowedWakeKinds == null
    ? state
    : {
        pending: state.pending.filter((item) =>
          input.allowedWakeKinds?.includes(item.wake.kind)
        ),
      };
  const items = findNextHostedSystemMailboxQueueItemsForWake({
    allowedRouteActions: input.allowedRouteActions ?? null,
    state: selectionState,
  });
  return selectHostedRuntimeWakeCandidate(
    items.map((item) =>
      createHostedRuntimeWakeCandidate(
        resolveSystemMailboxItemNextWakeAt(item, now),
        resolveHostedSystemMailboxItemWakeReason(item),
      )
    ),
  );
}

export function findNextHostedSystemMailboxQueueItem(input: {
  allowedRouteActions: readonly HostedSystemMailboxRouteAction[] | null;
  now: string;
  state: HostedSystemMailboxState;
}): HostedSystemMailboxPendingItem | null {
  if (input.allowedRouteActions) {
    const item = input.state.pending.find((pending) =>
      systemMailboxItemRouteActionAllowed(pending, input.allowedRouteActions)
    ) ?? null;
    return item
      && systemMailboxItemIsDue(item, input.now)
      ? item
      : null;
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

export function mergeHostedSystemMailboxRollbackItems(input: {
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

function writeHostedSystemMailboxState(
  vaultRoot: string,
  state: HostedSystemMailboxState,
): Promise<void> {
  return writeAssistantStateVersionedJson({
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
    mailboxLaneSeq: readOptionalPositiveIntegerString(
      record.mailboxLaneSeq,
      "hosted system mailbox mailboxLaneSeq",
    ),
    nextAttemptAt: record.nextAttemptAt === null || record.nextAttemptAt === undefined
      ? null
      : readRequiredString(record.nextAttemptAt, "hosted system mailbox nextAttemptAt"),
    occurredAt: readRequiredString(record.occurredAt, "hosted system mailbox occurredAt"),
    postCheckpointRecord: record.postCheckpointRecord === null
      || record.postCheckpointRecord === undefined
      ? null
      : parseHostedSystemMailboxRecordRequest(record.postCheckpointRecord),
    preferenceCausalSeq: readOptionalPositiveIntegerString(
      record.preferenceCausalSeq,
      "hosted system mailbox preferenceCausalSeq",
    ),
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

function parseHostedSystemMailboxRouteAction(value: unknown): HostedSystemMailboxRouteAction {
  if (
    value === "apply-member-activation"
    || value === "apply-member-channels-update"
    || value === "apply-member-preferences"
    || value === "initialize-group-room-model"
    || value === "dispatch-assistant-notification"
    || value === "run-assistant-ask"
    || value === "continue-assistant-ask"
    || value === "run-clinical-records-sync"
    || value === "run-device-sync-wake"
    || value === "run-environment-voice"
    || value === "apply-runtime-control-request"
  ) {
    return value;
  }

  throw new TypeError("hosted system mailbox routeAction is invalid.");
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

  if (record.kind === "clinical-records.outcome-recorded") {
    assertHostedSystemMailboxRecordKeys(
      record,
      ["kind", "nextWakeAt", "request"],
      "hosted system mailbox Clinical Records postCheckpointRecord",
    );
    if (record.nextWakeAt !== undefined && record.nextWakeAt !== null) {
      throw new TypeError(
        "hosted system mailbox Clinical Records postCheckpointRecord nextWakeAt must be null.",
      );
    }
    return {
      kind: "clinical-records.outcome-recorded",
      ...(record.nextWakeAt === null ? { nextWakeAt: null } : {}),
      request: parseHostedClinicalRecordsRecordOutcomeRequest(record.request),
    };
  }

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
    if (!Array.isArray(record.records)) {
      throw new TypeError(
        "hosted system mailbox postCheckpointRecord records must be an array.",
      );
    }
    if (record.records.length === 0 && record.nextWakeAt == null) {
      throw new TypeError(
        "hosted system mailbox postCheckpointRecord empty records must include nextWakeAt.",
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

  if (record.kind === "environment-voice.audio-delete") {
    assertHostedSystemMailboxRecordKeys(
      record,
      ["audioKey", "kind"],
      "hosted system mailbox Environment voice postCheckpointRecord",
    );
    const audioKey = readRequiredString(
      record.audioKey,
      "hosted system mailbox Environment voice postCheckpointRecord audioKey",
    );
    if (!/^[a-f0-9]{40}$/u.test(audioKey)) {
      throw new TypeError(
        "hosted system mailbox Environment voice postCheckpointRecord audioKey is invalid.",
      );
    }
    return {
      audioKey,
      kind: "environment-voice.audio-delete",
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

function findNextHostedSystemMailboxQueueItemsForWake(input: {
  allowedRouteActions: readonly HostedSystemMailboxRouteAction[] | null;
  state: HostedSystemMailboxState;
}): HostedSystemMailboxPendingItem[] {
  if (input.allowedRouteActions) {
    const item = input.state.pending.find((pending) =>
      systemMailboxItemRouteActionAllowed(pending, input.allowedRouteActions)
    ) ?? null;
    return item
      ? [item]
      : [];
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

function systemMailboxItemIsDue(
  item: HostedSystemMailboxPendingItem,
  now: string,
): boolean {
  return resolveSystemMailboxItemNextWakeAt(item, now) === now;
}

function resolveSystemMailboxItemNextWakeAt(
  item: HostedSystemMailboxPendingItem,
  now: string,
): string | null {
  // A detached assistant ask owns its own in-process completion signal while
  // it is sending. Re-projecting that claimed item as an immediate runtime
  // wake would spin the foreground runner without making mailbox progress.
  if (item.routeAction === "run-assistant-ask" && item.status === "sending") {
    return null;
  }

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

function resolveHostedSystemMailboxItemWakeReason(
  item: HostedSystemMailboxPendingItem,
): string {
  return item.routeAction === "run-device-sync-wake"
    ? HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON
    : HOSTED_ASSISTANT_WAKE_REASON;
}

function hostedSystemMailboxPendingItemsMatch(
  left: HostedSystemMailboxPendingItem,
  right: HostedSystemMailboxPendingItem,
): boolean {
  return left.itemId === right.itemId
    && left.attemptCount === right.attemptCount
    && left.lastAttemptAt === right.lastAttemptAt
    && left.mailboxDedupeKey === right.mailboxDedupeKey
    && left.mailboxLaneSeq === right.mailboxLaneSeq
    && left.preferenceCausalSeq === right.preferenceCausalSeq
    && left.nextAttemptAt === right.nextAttemptAt
    && left.occurredAt === right.occurredAt
    && left.requestId === right.requestId
    && left.routeAction === right.routeAction
    && left.status === right.status;
}

function readRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function readOptionalPositiveIntegerString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const seq = readRequiredString(value, label);
  if (!/^[1-9]\d*$/u.test(seq)) {
    throw new TypeError(`${label} must be a positive decimal string.`);
  }
  return seq;
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

function isHostedSystemMailboxStateUpdateResult<TResult>(
  value: HostedSystemMailboxState | { result: TResult; state: HostedSystemMailboxState },
): value is { result: TResult; state: HostedSystemMailboxState } {
  return typeof (value as { result?: unknown }).result !== "undefined"
    && typeof (value as { state?: unknown }).state !== "undefined";
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
