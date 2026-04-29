import path from "node:path";

import {
  type HostedExecutionRunnerVaultSyncImport,
  type HostedExecutionSystemWake,
} from "@murphai/hosted-execution/contracts";
import {
  parseHostedExecutionWake,
} from "@murphai/hosted-execution/parsers";
import type {
  HostedRuntimeVaultSyncImportRequest,
  HostedRuntimeVaultSyncImportSummary,
} from "@murphai/hosted-execution/runtime-control";
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
  executeHostedMailboxEvent,
} from "./events.ts";
import type {
  HostedMailboxItemImportOutcome,
  HostedMailboxResolvedImportItem,
} from "./mailbox-import.ts";
import type {
  HostedMailboxExecutionMetrics,
  NormalizedHostedAssistantRuntimeConfig,
} from "./models.ts";
import {
  createHostedVaultSyncImportSummary,
  resolveHostedVaultSyncImportStatus,
} from "./vault-sync-import-summary.ts";

const HOSTED_SYSTEM_MAILBOX_STATE_SCHEMA = "murph.hosted-system-mailbox-state.v1";
const HOSTED_SYSTEM_MAILBOX_STATE_SCHEMA_VERSION = 1;
const HOSTED_SYSTEM_MAILBOX_STATE_LABEL = "hosted system mailbox state";

type HostedSystemMailboxRouteAction =
  | "apply-member-activation"
  | "apply-member-channels-update"
  | "dispatch-assistant-notification"
  | "import-vault-sync"
  | "run-device-sync-wake";

type HostedSystemMailboxRecordRequest =
  {
      kind: "vault-sync-import";
      request: HostedRuntimeVaultSyncImportRequest;
    };

class HostedSystemMailboxTerminalRecordError extends Error {
  readonly recordRequest: HostedSystemMailboxRecordRequest;

  constructor(input: {
    message: string;
    recordRequest: HostedSystemMailboxRecordRequest;
  }) {
    super(input.message);
    this.name = "HostedSystemMailboxTerminalRecordError";
    this.recordRequest = input.recordRequest;
  }
}

export interface HostedSystemMailboxPendingItem {
  attemptCount: number;
  itemId: string;
  lastAttemptAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  mailboxDedupeKey: string;
  nextAttemptAt: string | null;
  occurredAt: string;
  postCheckpointRecord: HostedSystemMailboxRecordRequest | null;
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

type HostedSystemMailboxRuntime = Pick<
  NormalizedHostedAssistantRuntimeConfig,
  "commitTimeoutMs" | "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
>;

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
    const recordRequest = buildHostedSystemMailboxRecordRequest({
      item: prepared,
      metrics,
    });
    const processedItem: HostedSystemMailboxPendingItem = {
      ...prepared,
      postCheckpointRecord: recordRequest,
      status: recordRequest ? "recording" : "sending",
    };
    if (recordRequest) {
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
    if (error instanceof HostedSystemMailboxTerminalRecordError) {
      const terminalItem: HostedSystemMailboxPendingItem = {
        ...prepared,
        lastErrorCode: normalized.code,
        lastErrorMessage: normalized.message,
        nextAttemptAt: null,
        postCheckpointRecord: error.recordRequest,
        status: "recording",
      };
      await updateHostedSystemMailboxPendingItem({
        item: terminalItem,
        vaultRoot: input.vaultRoot,
      });
      return {
        item: terminalItem,
        itemId: prepared.itemId,
        status: "recording",
      };
    }

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
    if (input.item.postCheckpointRecord.kind === "vault-sync-import") {
      const vaultSyncPort = input.runtime.platform.vaultSyncPort ?? null;
      if (!vaultSyncPort) {
        throw new TypeError("Hosted vault sync import receipt requires a vault sync port.");
      }
      const response = await vaultSyncPort.recordImport(input.item.postCheckpointRecord.request);
      await removeHostedSystemMailboxPendingItem({
        itemId: input.item.itemId,
        vaultRoot: input.vaultRoot,
      });
      return {
        failed: 0,
        nextWakeAt: await resolveHostedSystemMailboxNextWakeAt({ vaultRoot: input.vaultRoot }),
        recorded: response.recorded ? 1 : 0,
      };
    }

    return {
      failed: 0,
      nextWakeAt: await resolveHostedSystemMailboxNextWakeAt({ vaultRoot: input.vaultRoot }),
      recorded: 0,
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
    return { failed: 1, nextWakeAt, recorded: 0 };
  }
}

function buildHostedSystemMailboxRecordRequest(input: {
  item: HostedSystemMailboxPendingItem;
  metrics: HostedMailboxExecutionMetrics;
}): HostedSystemMailboxRecordRequest | null {
  const importedAt = input.item.lastAttemptAt ?? new Date().toISOString();
  if (input.item.wake.kind === "vault.sync.import" && input.metrics.vaultSyncImportResult) {
    return {
      kind: "vault-sync-import",
      request: {
        importedAt,
        sessionId: input.item.wake.vaultSync.sessionId,
        status: resolveHostedVaultSyncImportStatus(input.metrics.vaultSyncImportResult),
        summary: createHostedVaultSyncImportSummary(input.metrics.vaultSyncImportResult),
      },
    };
  }

  return null;
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

  if (input.pendingItem.wake.kind === "vault.sync.import") {
    return executePendingHostedVaultSyncImport({
      ...input,
      executionContext,
      pendingItem: {
        ...input.pendingItem,
        wake: input.pendingItem.wake,
      },
    });
  }

  return executeHostedMailboxEvent({
    executionContext,
    forceQueueOnlyAssistantNotification: true,
    runtime: input.runtime,
    runtimeEnv: input.runtimeEnv,
    vaultRoot: input.vaultRoot,
    wake: input.pendingItem.wake,
  });
}

async function executePendingHostedVaultSyncImport(input: {
  executionContext: AssistantExecutionContext;
  pendingItem: HostedSystemMailboxPendingItem & {
    wake: Extract<HostedExecutionSystemWake, { kind: "vault.sync.import" }>;
  };
  runtime: HostedSystemMailboxRuntime;
  runtimeEnv: Readonly<Record<string, string>>;
  vaultRoot: string;
}): Promise<HostedMailboxExecutionMetrics> {
  const vaultSyncPort = input.runtime.platform.vaultSyncPort ?? null;
  if (!vaultSyncPort) {
    throw new TypeError("Hosted vault sync import wake requires a vault sync port.");
  }

  const fetched = await vaultSyncPort.fetchPayload({
    requestId: `${input.pendingItem.itemId}:vault-sync-payload`,
    sessionId: input.pendingItem.wake.vaultSync.sessionId,
  });
  if (!fetched.payload) {
    const unavailable = fetched.unavailable ?? null;
    if (unavailable?.retryable === false) {
      throw new HostedSystemMailboxTerminalRecordError({
        message: `Hosted vault sync payload unavailable: ${unavailable.code}.`,
        recordRequest: {
          kind: "vault-sync-import",
          request: {
            errorCode: `vault_sync_payload.${unavailable.code}`,
            importedAt: input.pendingItem.lastAttemptAt ?? new Date().toISOString(),
            sessionId: input.pendingItem.wake.vaultSync.sessionId,
            status: "failed",
            summary: createEmptyHostedVaultSyncImportSummary(),
          },
        },
      });
    }
    throw new TypeError(
      unavailable
        ? `Hosted vault sync payload unavailable: ${unavailable.code}.`
        : "Hosted vault sync payload is missing.",
    );
  }

  const vaultSyncImport: HostedExecutionRunnerVaultSyncImport = {
    bundleBase64: fetched.payload.bundleBase64,
    sessionId: fetched.payload.sessionId,
    ...(fetched.payload.sourceSchemaVersion === undefined
      ? {}
      : { sourceSchemaVersion: fetched.payload.sourceSchemaVersion }),
  };
  const metrics = await executeHostedMailboxEvent({
    executionContext: input.executionContext,
    forceQueueOnlyAssistantNotification: true,
    runtime: input.runtime,
    runtimeEnv: input.runtimeEnv,
    vaultRoot: input.vaultRoot,
    vaultSyncImport,
    wake: input.pendingItem.wake,
  });
  if (!metrics.vaultSyncImportResult) {
    throw new TypeError("Hosted vault sync mailbox import did not return merge metrics.");
  }

  return metrics;
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
  if (isLegacySharePendingRecord(record)) {
    throw new TypeError("hosted system mailbox legacy share-import pending state is unsupported.");
  }
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

function isLegacySharePendingRecord(record: Record<string, unknown>): boolean {
  const wake = record.wake;
  const postCheckpointRecord = record.postCheckpointRecord;
  return record.routeAction === "import-vault-share"
    || (
      !!wake
      && typeof wake === "object"
      && !Array.isArray(wake)
      && (wake as { kind?: unknown }).kind === "vault.share.accepted"
    )
    || (
      !!postCheckpointRecord
      && typeof postCheckpointRecord === "object"
      && !Array.isArray(postCheckpointRecord)
      && (postCheckpointRecord as { kind?: unknown }).kind === "share-import"
    );
}

function readHostedSystemMailboxRouteAction(
  item: HostedMailboxResolvedImportItem,
): HostedSystemMailboxRouteAction | null {
  if (
    item.route.action === "apply-member-activation"
    || item.route.action === "apply-member-channels-update"
    || item.route.action === "dispatch-assistant-notification"
    || item.route.action === "import-vault-sync"
    || item.route.action === "run-device-sync-wake"
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
    || value === "import-vault-sync"
    || value === "run-device-sync-wake"
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

function readOptionalString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return readRequiredString(value, label);
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

function parseHostedSystemMailboxRecordRequest(value: unknown): HostedSystemMailboxRecordRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("hosted system mailbox postCheckpointRecord must be an object.");
  }
  const record = value as Record<string, unknown>;
  const request = record.request;
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new TypeError("hosted system mailbox postCheckpointRecord.request must be an object.");
  }
  const requestRecord = request as Record<string, unknown>;

  if (record.kind === "share-import") {
    throw new TypeError("hosted system mailbox legacy share-import pending state is unsupported.");
  }

  if (record.kind === "vault-sync-import") {
    const status = requestRecord.status;
    if (
      status !== "imported"
      && status !== "imported_with_conflicts"
      && status !== "failed"
    ) {
      throw new TypeError("hosted system mailbox vault sync import status is invalid.");
    }
    return {
      kind: "vault-sync-import",
      request: {
        errorCode: readOptionalString(
          requestRecord.errorCode,
          "hosted system mailbox vault sync errorCode",
        ),
        importedAt: readRequiredString(
          requestRecord.importedAt,
          "hosted system mailbox vault sync importedAt",
        ),
        sessionId: readRequiredString(
          requestRecord.sessionId,
          "hosted system mailbox vault sync sessionId",
        ),
        status,
        summary: parseHostedSystemMailboxVaultSyncImportSummary(requestRecord.summary),
      },
    };
  }

  throw new TypeError("hosted system mailbox postCheckpointRecord kind is invalid.");
}

function parseHostedSystemMailboxVaultSyncImportSummary(
  value: unknown,
): HostedRuntimeVaultSyncImportSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("hosted system mailbox vault sync summary must be an object.");
  }
  const record = value as Record<string, unknown>;
  return {
    conflictCount: readNonNegativeInteger(
      record.conflictCount,
      "hosted system mailbox vault sync conflictCount",
    ),
    importedJsonlRecords: readNonNegativeInteger(
      record.importedJsonlRecords,
      "hosted system mailbox vault sync importedJsonlRecords",
    ),
    importedRawFiles: readNonNegativeInteger(
      record.importedRawFiles,
      "hosted system mailbox vault sync importedRawFiles",
    ),
    importedTextFiles: readNonNegativeInteger(
      record.importedTextFiles,
      "hosted system mailbox vault sync importedTextFiles",
    ),
    skippedDuplicates: readNonNegativeInteger(
      record.skippedDuplicates,
      "hosted system mailbox vault sync skippedDuplicates",
    ),
    skippedExcludedFiles: readNonNegativeInteger(
      record.skippedExcludedFiles,
      "hosted system mailbox vault sync skippedExcludedFiles",
    ),
  };
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
  if (error instanceof HostedSystemMailboxTerminalRecordError) {
    const request = error.recordRequest.request;
    return {
      code: request.errorCode ?? "HOSTED_SYSTEM_MAILBOX_TERMINAL",
      message: error.message,
    };
  }

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

function createEmptyHostedVaultSyncImportSummary(): HostedRuntimeVaultSyncImportSummary {
  return {
    conflictCount: 0,
    importedJsonlRecords: 0,
    importedRawFiles: 0,
    importedTextFiles: 0,
    skippedDuplicates: 0,
    skippedExcludedFiles: 0,
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
