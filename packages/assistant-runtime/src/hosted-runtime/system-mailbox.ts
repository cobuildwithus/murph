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
import type {
  HostedMailboxItemImportOutcome,
  HostedMailboxResolvedImportItem,
} from "./mailbox-import.ts";
import type {
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

type HostedSystemMailboxRouteAction =
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
  recorded: boolean;
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

  const previousState = await readHostedSystemMailboxState(input.vaultRoot);
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
  const pending = previousState.pending.some((item) => item.itemId === nextItem.itemId)
    ? previousState.pending.map((item) => item.itemId === nextItem.itemId ? nextItem : item)
    : [...previousState.pending, nextItem];

  await writeHostedSystemMailboxState(input.vaultRoot, {
    pending,
  });

  return {
    reasonCode: "system_mailbox.queued",
    status: "imported",
  };
}

export async function prepareHostedSystemMailboxItemForCheckpoint(input: {
  executionContext?: AssistantExecutionContext | null;
  now?: () => string;
  runtime: HostedSystemMailboxRuntime;
  runtimeEnv: Readonly<Record<string, string>>;
  vaultRoot: string;
}): Promise<HostedSystemMailboxCheckpointPreparation | null> {
  const startedAt = (input.now ?? (() => new Date().toISOString()))();
  const state = await readHostedSystemMailboxState(input.vaultRoot);
  const pending =
    state.pending.find((item) => item.status === "recording" && systemMailboxItemIsDue(item, startedAt))
    ?? state.pending.find((item) => item.status === "pending" && systemMailboxItemIsDue(item, startedAt))
    ?? state.pending.find((item) => item.status === "sending" && systemMailboxItemIsDue(item, startedAt))
    ?? null;
  if (!pending) {
    return null;
  }

  const prepared: HostedSystemMailboxPendingItem = {
    ...pending,
    attemptCount: pending.attemptCount + 1,
    lastAttemptAt: startedAt,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextAttemptAt: null,
    status: pending.status === "recording" ? "recording" : "sending",
  };
  await writeHostedSystemMailboxState(input.vaultRoot, {
    pending: state.pending.map((item) => item.itemId === pending.itemId ? prepared : item),
  });

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
      pendingItem: prepared,
      runtime: input.runtime,
      runtimeEnv: input.runtimeEnv,
      vaultRoot: input.vaultRoot,
    });
    const processedItem: HostedSystemMailboxPendingItem = {
      ...prepared,
      postCheckpointRecord: metrics.postCheckpointRecord ?? null,
      status: metrics.postCheckpointRecord ? "recording" : "sending",
    };
    if (processedItem.postCheckpointRecord) {
      await updateHostedSystemMailboxPendingItem({
        item: processedItem,
        vaultRoot: input.vaultRoot,
      });
    } else {
      await removeHostedSystemMailboxPendingItem({
        itemId: prepared.itemId,
        vaultRoot: input.vaultRoot,
      });
    }
    return {
      item: processedItem,
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
  now?: () => string;
  vaultRoot: string;
}): Promise<string | null> {
  const now = (input.now ?? (() => new Date().toISOString()))();
  const state = await readHostedSystemMailboxState(input.vaultRoot);
  const wakeTimes = state.pending
    .map((item) => resolveSystemMailboxItemNextWakeAt(item, now))
    .filter((value): value is string => value !== null)
    .sort();

  return wakeTimes[0] ?? null;
}

export async function recordHostedSystemMailboxItemAfterCheckpoint(input: {
  item: HostedSystemMailboxPendingItem;
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
      recorded: recordResult.recorded ? 1 : 0,
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
  state: HostedSystemMailboxState;
  vaultRoot: string;
}): Promise<void> {
  await writeHostedSystemMailboxState(input.vaultRoot, input.state);
}

async function executePendingHostedSystemMailboxItem(input: {
  executionContext: AssistantExecutionContext | null;
  pendingItem: HostedSystemMailboxPendingItem;
  runtime: HostedSystemMailboxRuntime;
  runtimeEnv: Readonly<Record<string, string>>;
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
    runtime: input.runtime,
    runtimeEnv: input.runtimeEnv,
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
  const state = await readHostedSystemMailboxState(input.vaultRoot);
  await writeHostedSystemMailboxState(input.vaultRoot, {
    pending: state.pending.filter((item) => item.itemId !== input.itemId),
  });
}

async function updateHostedSystemMailboxPendingItem(input: {
  item: HostedSystemMailboxPendingItem;
  vaultRoot: string;
}): Promise<void> {
  const state = await readHostedSystemMailboxState(input.vaultRoot);
  await writeHostedSystemMailboxState(input.vaultRoot, {
    pending: state.pending.map((item) =>
      item.itemId === input.item.itemId ? input.item : item
    ),
  });
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
      connectionId: readRequiredString(
        record.connectionId,
        "hosted system mailbox postCheckpointRecord connectionId",
      ),
      kind: "device-sync.dirty-processed",
      ...(record.nextWakeAt === undefined
        ? {}
        : {
            nextWakeAt: readNullableIsoTimestamp(
              record.nextWakeAt,
              "hosted system mailbox postCheckpointRecord nextWakeAt",
            ),
          }),
      ...(record.processedDirtyPayloadIds === undefined
        ? {}
        : {
            processedDirtyPayloadIds: readOptionalStringArray(
              record.processedDirtyPayloadIds,
              "hosted system mailbox postCheckpointRecord processedDirtyPayloadIds",
            ),
          }),
      processedRevision: readRequiredString(
        record.processedRevision,
        "hosted system mailbox postCheckpointRecord processedRevision",
      ),
    };
  }

  throw new TypeError("hosted system mailbox postCheckpointRecord kind is invalid.");
}

export async function recordHostedDeviceSyncDirtyPostCheckpointRecord(input: {
  record: HostedSystemMailboxPostCheckpointRecord;
  runtime: HostedSystemMailboxRuntime;
}): Promise<HostedSystemMailboxPostCheckpointRecordResult> {
  return await recordHostedSystemMailboxPostCheckpointRecord(input);
}

async function recordHostedSystemMailboxPostCheckpointRecord(input: {
  record: HostedSystemMailboxPostCheckpointRecord;
  runtime: HostedSystemMailboxRuntime;
}): Promise<HostedSystemMailboxPostCheckpointRecordResult> {
  switch (input.record.kind) {
    case "device-sync.dirty-processed":
      if (!input.runtime.platform.deviceSyncPort) {
        throw new Error("Hosted device-sync dirty ack requires a configured device-sync runtime port.");
      }
      const response = await input.runtime.platform.deviceSyncPort.ackDirtyStateProcessed({
        connectionId: input.record.connectionId,
        ...(input.record.processedDirtyPayloadIds
          ? { processedDirtyPayloadIds: input.record.processedDirtyPayloadIds }
          : {}),
        processedRevision: input.record.processedRevision,
      });
      return {
        nextWakeAt: response.nextWakeAt,
        recorded: response.recorded,
        stillDirty: response.stillDirty,
      };
  }
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
      message: error.message,
    };
  }

  return {
    code: "HOSTED_SYSTEM_MAILBOX_AMBIGUOUS",
    message: "Hosted system mailbox effect failed after checkpoint.",
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
