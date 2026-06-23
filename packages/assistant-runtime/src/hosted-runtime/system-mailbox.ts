import {
  type HostedExecutionSystemWake,
} from "@murphai/hosted-execution/contracts";
import type {
  AssistantExecutionContext,
} from "@murphai/assistant-engine";

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
  findNextHostedSystemMailboxQueueItem,
  mergeHostedSystemMailboxRollbackItems,
  readHostedSystemMailboxState,
  removeHostedSystemMailboxPendingItemIfCurrent,
  resolveHostedSystemMailboxNextWakeAt,
  resolveHostedSystemMailboxNextWakeCandidate,
  updateHostedSystemMailboxPendingItem,
  updateHostedSystemMailboxState,
  type HostedSystemMailboxPendingItem,
  type HostedSystemMailboxRouteAction,
  type HostedSystemMailboxState,
} from "./system-mailbox-state.ts";
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

export {
  resolveHostedSystemMailboxNextWakeAt,
  resolveHostedSystemMailboxNextWakeCandidate,
} from "./system-mailbox-state.ts";
export type {
  HostedSystemMailboxPendingItem,
  HostedSystemMailboxRouteAction,
  HostedSystemMailboxState,
} from "./system-mailbox-state.ts";

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
      await removeHostedSystemMailboxPendingItemIfCurrent({
        item: prepared,
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
    await removeHostedSystemMailboxPendingItemIfCurrent({
      item: input.item,
      vaultRoot: input.vaultRoot,
    });
    const nextWake = selectHostedRuntimeWakeCandidate([
      await resolveHostedSystemMailboxNextWakeCandidate({ vaultRoot: input.vaultRoot }),
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
  if (!input.runtime.platform.deviceSyncPort) {
    throw new Error("Hosted device-sync dirty ack requires a configured device-sync runtime port.");
  }

  switch (input.record.kind) {
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

function earliestHostedSystemMailboxWakeAt(left: string | null, right: string | null): string | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }

  return Date.parse(left) <= Date.parse(right) ? left : right;
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
