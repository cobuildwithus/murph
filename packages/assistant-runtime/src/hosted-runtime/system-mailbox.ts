import { rm } from "node:fs/promises";
import path from "node:path";

import {
  buildHostedExecutionSafeErrorDiagnostics,
  deriveHostedExecutionErrorCode,
  readHostedRuntimeSafeErrorText,
  sanitizeHostedExecutionStructuredLogText,
} from "@murphai/hosted-execution";
import {
  HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
} from "@murphai/hosted-execution/vault-share";
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
  isHostedAssistantAskCompletionPreemptedError,
} from "./events/assistant-ask-completion-errors.ts";
import type {
  HostedLegacyUsageReferralAuthorityClassification,
} from "./events/assistant-notification.ts";
import type {
  HostedMailboxItemImportOutcome,
  HostedMailboxResolvedImportItem,
} from "./mailbox-import.ts";
import type {
  HostedVaultShareProjectionOfferResult,
} from "./vault-share-projection.ts";
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
  type HostedRuntimeWakeCandidate,
} from "./wake-candidates.ts";
import {
  writeHostedRuntimeLogBestEffort,
} from "./runtime-logs.ts";

const HOSTED_CODEX_HOME_DIR_NAME = ".codex-hosted";
const HOSTED_CODEX_AUTH_FILE_NAME = "auth.json";
const HOSTED_SYSTEM_MAILBOX_RETRY_DELAY_MS = 60_000;
const HOSTED_VAULT_SHARE_PROJECTION_DEFERRED_ERROR_CODE =
  "HOSTED_VAULT_SHARE_PROJECTION_DEFERRED";
const HOSTED_VAULT_SHARE_PROJECTION_DEFERRED_RETRY_MS = 5 * 60_000;
const HOSTED_VAULT_SHARE_PROJECTION_CONTINUE_ERROR_CODE =
  "HOSTED_VAULT_SHARE_PROJECTION_CONTINUE";
const HOSTED_VAULT_SHARE_PROJECTION_CONTINUE_RETRY_MS = 1_000;

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
      attemptCount: number;
      errorCode: string | null;
      errorMessage: string | null;
      itemId: string;
      legacyUsageReferralAuthorityClassification:
        HostedLegacyUsageReferralAuthorityClassification | null;
      nextWakeAt: string;
      nextWakeReason: string | null;
      routeAction: HostedSystemMailboxRouteAction;
      status: "retryable_failed";
      wakeKind: HostedExecutionSystemWake["kind"];
    }
  | {
      item: HostedSystemMailboxPendingItem;
      itemId: string;
      status: "preempted";
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

export async function claimHostedSystemMailboxItem(input: {
  allowedRouteActions: readonly HostedSystemMailboxRouteAction[];
  now?: () => string;
  vaultRoot: string;
}): Promise<HostedSystemMailboxPendingItem | null> {
  if (input.allowedRouteActions.length === 0) {
    return null;
  }
  const startedAt = (input.now ?? (() => new Date().toISOString()))();
  return await updateHostedSystemMailboxState(input.vaultRoot, (state) => {
    const firstAllowed = state.pending.find((item) =>
      input.allowedRouteActions.includes(item.routeAction)
    ) ?? null;
    if (!firstAllowed || firstAllowed.status === "recording") {
      return { result: null, state };
    }
    const pending = firstAllowed.status === "sending"
      ? firstAllowed
      : findNextHostedSystemMailboxQueueItem({
          allowedRouteActions: input.allowedRouteActions,
          now: startedAt,
          state,
        });
    if (!pending) {
      return { result: null, state };
    }
    const claimed: HostedSystemMailboxPendingItem = {
      ...pending,
      attemptCount: pending.attemptCount + 1,
      lastAttemptAt: startedAt,
      lastErrorCode: null,
      lastErrorMessage: null,
      nextAttemptAt: null,
      status: "sending",
    };
    return {
      result: claimed,
      state: {
        pending: state.pending.map((item) =>
          item.itemId === pending.itemId ? claimed : item
        ),
      },
    };
  });
}

export async function requeueClaimedHostedSystemMailboxItem(input: {
  error?: unknown;
  item: HostedSystemMailboxPendingItem;
  nextAttemptAt: string | null;
  vaultRoot: string;
}): Promise<boolean> {
  const normalized = input.error === undefined
    ? null
    : normalizeHostedSystemMailboxError(input.error);
  return await updateHostedSystemMailboxState(input.vaultRoot, (state) => {
    const current = state.pending.find((item) => item.itemId === input.item.itemId) ?? null;
    if (!current || !hostedSystemMailboxPendingItemsMatchForClaim(current, input.item)) {
      return { result: false, state };
    }
    const requeued: HostedSystemMailboxPendingItem = {
      ...input.item,
      lastErrorCode: normalized?.code ?? null,
      lastErrorMessage: normalized?.message ?? null,
      nextAttemptAt: input.nextAttemptAt,
      status: "pending",
    };
    return {
      result: true,
      state: {
        pending: state.pending.map((item) =>
          item.itemId === input.item.itemId ? requeued : item
        ),
      },
    };
  });
}

export type HostedSystemMailboxRuntime = Pick<
  NormalizedHostedAssistantRuntimeConfig,
  "commitTimeoutMs" | "forwardedEnv" | "platform" | "platformEnv" | "resolvedConfig" | "userEnv"
> & Partial<Pick<NormalizedHostedAssistantRuntimeConfig, "parserToolchain">>;

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
  const routedAction = readHostedSystemMailboxRouteAction(input.item);
  const routeAction =
    routedAction === "apply-member-activation"
      && input.wake.kind === "member.activated"
      && input.wake.initialGroupRoomModelMarkdown
      && input.wake.signupWelcome === null
      ? "initialize-group-room-model"
      : routedAction;
  if (!routeAction) {
    return {
      reasonCode: "system_mailbox.unsupported_route",
      status: "deferred",
    };
  }

  if (
    (
      routeAction === "apply-member-activation"
      || routeAction === "initialize-group-room-model"
    )
    && input.wake.kind === "member.activated"
  ) {
    await bootstrapHostedMemberContext(input.vaultRoot, input.wake);
  }
  const nextItem: HostedSystemMailboxPendingItem = {
    attemptCount: 0,
    itemId: input.item.item.id,
    lastAttemptAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    mailboxDedupeKey: input.item.item.dedupeKey,
    mailboxLaneSeq: input.item.item.laneSeq,
    nextAttemptAt: null,
    occurredAt: input.item.item.occurredAt,
    postCheckpointRecord: null,
    preferenceCausalSeq: routeAction === "apply-member-preferences"
      ? (input.item.item.causalSeq ?? null)
      : null,
    requestId: input.item.payload.requestId ?? null,
    routeAction,
    status: "pending",
    wake: input.wake,
  };
  await updateHostedSystemMailboxState(input.vaultRoot, (state) => ({
    pending: upsertHostedSystemMailboxPendingItem(state.pending, nextItem),
  }));

  return {
    reasonCode: "system_mailbox.queued",
    status: "imported",
  };
}

export async function prepareHostedSystemMailboxItemForCheckpoint(input: {
  allowedMailboxDedupeKeyPrefixes?: readonly string[] | null;
  allowedRouteActions?: readonly HostedSystemMailboxRouteAction[] | null;
  allowedWakeKinds?: readonly HostedExecutionSystemWake["kind"][] | null;
  assistantAskCompletionOccurredBefore?: string | null;
  executionContext?: AssistantExecutionContext | null;
  now?: () => string;
  operatorHomeRoot?: string | null;
  runtime: HostedSystemMailboxRuntime;
  runtimeEnv: Readonly<Record<string, string>>;
  retainProcessedItemUntilRecorded?: boolean;
  signal?: AbortSignal | null;
  shouldYieldBackgroundMaintenance?: (() => boolean) | null;
  vaultRoot: string;
}): Promise<HostedSystemMailboxCheckpointPreparation | null> {
  const startedAt = (input.now ?? (() => new Date().toISOString()))();
  const hasAssistantAskCompletionCutoff = Object.hasOwn(
    input,
    "assistantAskCompletionOccurredBefore",
  );
  const assistantAskCompletionOccurredBefore =
    input.assistantAskCompletionOccurredBefore ?? null;
  const prepared = await updateHostedSystemMailboxState(
    input.vaultRoot,
    (state) => {
      const selectionState = {
        pending: state.pending.filter((item) =>
          (
            input.allowedRouteActions != null
            || item.routeAction !== "run-assistant-ask"
          )
          && (
            input.allowedMailboxDedupeKeyPrefixes == null
            || input.allowedMailboxDedupeKeyPrefixes.some((prefix) =>
              item.mailboxDedupeKey.startsWith(prefix)
            )
          )
          && (
            input.allowedWakeKinds == null
            || input.allowedWakeKinds.includes(item.wake.kind)
          )
          && (
            item.wake.kind !== "assistant.ask.completed"
            || !hasAssistantAskCompletionCutoff
            || (
              assistantAskCompletionOccurredBefore !== null
              && hostedSystemMailboxTimestampPrecedes(
                item.occurredAt,
                assistantAskCompletionOccurredBefore,
              )
            )
          )
        ),
      };
      const pending = findNextHostedSystemMailboxQueueItem({
        allowedRouteActions: input.allowedRouteActions ?? null,
        now: startedAt,
        state: selectionState,
      });
      if (!pending) {
        return {
          result: null,
          state,
        };
      }

      const collapsed = collapseConsecutiveHostedBrowserVaultRefreshItems({
        pending: state.pending,
        selected: pending,
      });

      const nextItem: HostedSystemMailboxPendingItem = {
        ...collapsed.selected,
        attemptCount: collapsed.selected.attemptCount + 1,
        lastAttemptAt: startedAt,
        lastErrorCode: null,
        lastErrorMessage: null,
        nextAttemptAt: null,
        status: collapsed.selected.status === "recording"
          ? "recording"
          : "sending",
      };
      return {
        result: nextItem,
        state: {
          pending: collapsed.pending.map((item) =>
            item.itemId === collapsed.selected.itemId ? nextItem : item
          ),
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
    if (shouldPreemptHostedDeviceSyncSystemMailboxItem(input, prepared)) {
      return await retainHostedSystemMailboxPreparedItemAfterForegroundPreemption({
        prepared,
        vaultRoot: input.vaultRoot,
      });
    }
    const metrics = await executePendingHostedSystemMailboxItem({
      executionContext: input.executionContext ?? null,
      operatorHomeRoot: input.operatorHomeRoot ?? undefined,
      pendingItem: prepared,
      runtime: input.runtime,
      runtimeEnv: input.runtimeEnv,
      signal: input.signal ?? null,
      shouldYieldBackgroundMaintenance: input.shouldYieldBackgroundMaintenance ?? null,
      vaultRoot: input.vaultRoot,
    });
    const postCheckpointRecord = metrics.postCheckpointRecord ?? null;
    if (postCheckpointRecord || input.retainProcessedItemUntilRecorded === true) {
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
    if (
      isHostedAssistantAskCompletionPreemptedError(error)
      && input.shouldYieldBackgroundMaintenance?.() === true
    ) {
      return await retainHostedSystemMailboxPreparedItemAfterForegroundPreemption({
        prepared,
        vaultRoot: input.vaultRoot,
      });
    }
    const normalized = normalizeHostedSystemMailboxError(error);
    const nextWakeAt = new Date(
      Date.parse(startedAt) + HOSTED_SYSTEM_MAILBOX_RETRY_DELAY_MS,
    ).toISOString();
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
    const legacyUsageReferralAuthorityClassification =
      prepared.wake.kind === "assistant.notification.requested"
        ? (await import("./events/assistant-notification.ts"))
          .classifyLegacyHostedUsageReferralDirectLinqAuthority({
            executionContext:
              input.executionContext
              ?? buildHostedSystemMailboxExecutionContext({
                runtime: input.runtime,
                wake: prepared.wake,
              }),
            mailboxDedupeKey: prepared.mailboxDedupeKey,
            wake: prepared.wake,
          })
        : null;
    return {
      attemptCount: prepared.attemptCount,
      errorCode: normalized.code,
      errorMessage: normalized.message,
      itemId: prepared.itemId,
      legacyUsageReferralAuthorityClassification,
      nextWakeAt,
      nextWakeReason: resolveHostedSystemMailboxPreparedItemRetryWakeReason(prepared),
      routeAction: prepared.routeAction,
      status: "retryable_failed",
      wakeKind: prepared.wake.kind,
    };
  }
}

function resolveHostedSystemMailboxPreparedItemRetryWakeReason(
  item: HostedSystemMailboxPendingItem,
): string | null {
  return item.routeAction === "run-device-sync-wake"
    ? HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON
    : null;
}

function shouldPreemptHostedDeviceSyncSystemMailboxItem(
  input: { shouldYieldBackgroundMaintenance?: (() => boolean) | null },
  item: HostedSystemMailboxPendingItem,
): boolean {
  return item.routeAction === "run-device-sync-wake"
    && input.shouldYieldBackgroundMaintenance?.() === true;
}

async function retainHostedSystemMailboxPreparedItemAfterForegroundPreemption(input: {
  prepared: HostedSystemMailboxPendingItem;
  vaultRoot: string;
}): Promise<Extract<HostedSystemMailboxCheckpointPreparation, { status: "preempted" }>> {
  const retainedItem: HostedSystemMailboxPendingItem = {
    ...input.prepared,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextAttemptAt: null,
    status: "pending",
  };
  await retainHostedSystemMailboxItemAfterForegroundPreemption({
    item: retainedItem,
    vaultRoot: input.vaultRoot,
  });
  return {
    item: retainedItem,
    itemId: input.prepared.itemId,
    status: "preempted",
  };
}

function collapseConsecutiveHostedBrowserVaultRefreshItems(input: {
  pending: readonly HostedSystemMailboxPendingItem[];
  selected: HostedSystemMailboxPendingItem;
}): {
  pending: HostedSystemMailboxPendingItem[];
  selected: HostedSystemMailboxPendingItem;
} {
  // Each Browser Vault refresh control row requests the same invocation-local
  // idempotent intent. Compact only the pristine sequence-adjacent suffix that
  // ordinary mailbox selection already admitted. The last row remains as the
  // representative, so handled-through stays at representative - 1 until the
  // intent is durably consumed; retries and foreground preemption retain it.
  const selectedIndex = input.pending.findIndex((item) =>
    item.itemId === input.selected.itemId
  );
  const selectedSeq = readCollapsibleHostedBrowserVaultRefreshSeq(
    input.selected,
  );
  if (selectedIndex < 0 || selectedSeq === null) {
    return {
      pending: [...input.pending],
      selected: input.selected,
    };
  }

  let lastIndex = selectedIndex;
  let lastSeq = selectedSeq;
  while (lastIndex + 1 < input.pending.length) {
    const candidate = input.pending[lastIndex + 1];
    if (!candidate) {
      break;
    }
    const candidateSeq = readCollapsibleHostedBrowserVaultRefreshSeq(candidate);
    if (candidateSeq === null || candidateSeq !== lastSeq + 1n) {
      break;
    }
    lastIndex += 1;
    lastSeq = candidateSeq;
  }

  if (lastIndex === selectedIndex) {
    return {
      pending: [...input.pending],
      selected: input.selected,
    };
  }

  const representative = input.pending[lastIndex];
  if (!representative) {
    throw new Error("Collapsed Browser Vault refresh representative is missing.");
  }
  return {
    pending: [
      ...input.pending.slice(0, selectedIndex),
      representative,
      ...input.pending.slice(lastIndex + 1),
    ],
    selected: representative,
  };
}

function readCollapsibleHostedBrowserVaultRefreshSeq(
  item: HostedSystemMailboxPendingItem,
): bigint | null {
  if (
    item.wake.kind !== "runtime.browser-vault-refresh-requested"
    || item.routeAction !== "apply-runtime-control-request"
    || item.status !== "pending"
    || item.attemptCount !== 0
    || item.lastAttemptAt !== null
    || item.lastErrorCode !== null
    || item.lastErrorMessage !== null
    || item.nextAttemptAt !== null
    || item.postCheckpointRecord !== null
    || item.mailboxLaneSeq === null
    || !/^[1-9]\d*$/u.test(item.mailboxLaneSeq)
  ) {
    return null;
  }
  return BigInt(item.mailboxLaneSeq);
}

function hostedSystemMailboxTimestampPrecedes(
  occurredAt: string,
  beforeAt: string,
): boolean {
  const occurredAtMs = Date.parse(occurredAt);
  const beforeAtMs = Date.parse(beforeAt);
  return Number.isFinite(occurredAtMs)
    && Number.isFinite(beforeAtMs)
    && occurredAtMs < beforeAtMs;
}

export async function retainHostedSystemMailboxItemAfterForegroundPreemption(input: {
  item: HostedSystemMailboxPendingItem;
  vaultRoot: string;
}): Promise<void> {
  if (input.item.postCheckpointRecord) {
    throw new TypeError(
      "A system-mailbox item with a post-checkpoint record cannot be retained as pending.",
    );
  }
  await updateHostedSystemMailboxState(input.vaultRoot, (state) => ({
    pending: upsertHostedSystemMailboxPendingItem(state.pending, {
      ...input.item,
      nextAttemptAt: null,
      status: "pending",
    }),
  }));
}

function upsertHostedSystemMailboxPendingItem(
  pending: readonly HostedSystemMailboxPendingItem[],
  nextItem: HostedSystemMailboxPendingItem,
): HostedSystemMailboxPendingItem[] {
  const next: HostedSystemMailboxPendingItem[] = [];
  let inserted = false;

  for (const item of pending) {
    if (item.itemId === nextItem.itemId) {
      next.push(nextItem);
      inserted = true;
      continue;
    }
    next.push(item);
  }

  if (!inserted) {
    next.push(nextItem);
  }
  return next;
}

export async function recordHostedSystemMailboxItemAfterCheckpoint(input: {
  item: HostedSystemMailboxPendingItem;
  operatorHomeRoot?: string | null;
  runtime: HostedSystemMailboxRuntime;
  signal?: AbortSignal | null;
  vaultShareProjectionResult?: HostedVaultShareProjectionOfferResult;
  vaultRoot: string;
}): Promise<{
  failed: number;
  nextWakeAt: string | null;
  nextWakeReason?: string | null;
  recorded: number;
}> {
  if (!input.item.postCheckpointRecord) {
    await removeHostedSystemMailboxPendingItemIfCurrent({
      item: input.item,
      vaultRoot: input.vaultRoot,
    });
    const nextWake = await resolveHostedSystemMailboxNextWakeCandidate({
      vaultRoot: input.vaultRoot,
    });
    return {
      failed: 0,
      nextWakeAt: nextWake.at,
      ...(nextWake.reason ? { nextWakeReason: nextWake.reason } : {}),
      recorded: 0,
    };
  }

  try {
    const recordResult = await recordHostedSystemMailboxPostCheckpointRecord({
      operatorHomeRoot: input.operatorHomeRoot ?? null,
      record: input.item.postCheckpointRecord,
      runtime: input.runtime,
      signal: input.signal ?? null,
      vaultShareProjectionResult: input.vaultShareProjectionResult,
      vaultRoot: input.vaultRoot,
    });
    const retainUntil = resolveHostedDeviceSyncMailboxRetentionAt(input.item);
    if (retainUntil) {
      await retainHostedDeviceSyncSystemMailboxItem({
        item: input.item,
        nextAttemptAt: retainUntil,
        vaultRoot: input.vaultRoot,
      });
    } else {
      await removeHostedSystemMailboxPendingItemIfCurrent({
        item: input.item,
        vaultRoot: input.vaultRoot,
      });
    }
    const nextWake = selectHostedRuntimeWakeCandidate([
      await resolveHostedSystemMailboxNextWakeCandidate({ vaultRoot: input.vaultRoot }),
      createHostedRuntimeWakeCandidate(
        retainUntil,
        HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
      ),
      createHostedRuntimeWakeCandidate(
        recordResult.nextWakeAt,
        HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON,
      ),
    ]);
    return {
      failed: 0,
      nextWakeAt: nextWake.at,
      ...(nextWake.reason ? { nextWakeReason: nextWake.reason } : {}),
      recorded: recordResult.recorded,
    };
  } catch (error) {
    if (
      input.signal?.aborted
      && isHostedDeviceSyncDirtyPostCheckpointRecord(input.item.postCheckpointRecord)
    ) {
      throw input.signal.reason instanceof Error ? input.signal.reason : error;
    }
    const normalized = normalizeHostedSystemMailboxError(error);
    let retryMs = HOSTED_SYSTEM_MAILBOX_RETRY_DELAY_MS;
    if (normalized.code === HOSTED_VAULT_SHARE_PROJECTION_CONTINUE_ERROR_CODE) {
      retryMs = HOSTED_VAULT_SHARE_PROJECTION_CONTINUE_RETRY_MS;
    } else if (normalized.code === HOSTED_VAULT_SHARE_PROJECTION_DEFERRED_ERROR_CODE) {
      retryMs = HOSTED_VAULT_SHARE_PROJECTION_DEFERRED_RETRY_MS;
    }
    const retryAt = new Date(Date.now() + retryMs).toISOString();
    await updateHostedSystemMailboxPendingItem({
      item: {
        ...input.item,
        lastErrorCode: normalized.code,
        lastErrorMessage: normalized.message,
        nextAttemptAt: retryAt,
        status: "recording",
      },
      vaultRoot: input.vaultRoot,
    });
    if (isHostedDeviceSyncDirtyPostCheckpointRecord(input.item.postCheckpointRecord)) {
      await writeHostedDeviceSyncDirtyAckPersistenceFailureLog({
        error,
        runtime: input.runtime,
      });
    }
    const nextWakeAt = await resolveHostedSystemMailboxNextWakeAt({
      vaultRoot: input.vaultRoot,
    });
    return {
      failed: 1,
      nextWakeAt: nextWakeAt ?? retryAt,
      nextWakeReason: resolveHostedSystemMailboxPreparedItemRetryWakeReason(input.item),
      recorded: 0,
    };
  }
}

function resolveHostedDeviceSyncMailboxRetentionAt(
  item: HostedSystemMailboxPendingItem,
): string | null {
  if (
    item.routeAction !== "run-device-sync-wake"
    || item.postCheckpointRecord?.kind !== "device-sync.dirty-processed-batch"
  ) {
    return null;
  }
  return item.postCheckpointRecord.retainMailboxItemUntil ?? null;
}

async function retainHostedDeviceSyncSystemMailboxItem(input: {
  item: HostedSystemMailboxPendingItem;
  nextAttemptAt: string;
  vaultRoot: string;
}): Promise<void> {
  await updateHostedSystemMailboxState(input.vaultRoot, (state) => ({
    pending: state.pending.map((item) =>
      hostedSystemMailboxPendingItemsMatchForClaim(item, input.item)
        ? {
            ...input.item,
            lastErrorCode: null,
            lastErrorMessage: null,
            nextAttemptAt: input.nextAttemptAt,
            postCheckpointRecord: null,
            status: "pending" as const,
            wake: input.item.postCheckpointRecord?.kind === "device-sync.dirty-processed-batch"
              ? input.item.postCheckpointRecord.retainedWake ?? input.item.wake
              : input.item.wake,
          }
        : item
    ),
  }));
}

export async function deferHostedSystemMailboxItemAfterVaultShareProjectionFailure(input: {
  item: HostedSystemMailboxPendingItem;
  vaultRoot: string;
}): Promise<HostedRuntimeWakeCandidate> {
  const nextWakeAt = new Date(
    Date.now() + HOSTED_SYSTEM_MAILBOX_RETRY_DELAY_MS,
  ).toISOString();
  await updateHostedSystemMailboxPendingItem({
    item: {
      ...input.item,
      lastErrorCode: "HOSTED_VAULT_SHARE_PROJECTION_FAILED",
      lastErrorMessage: "Vault-share projection failed before device-sync acknowledgement.",
      nextAttemptAt: nextWakeAt,
      status: "recording",
    },
    vaultRoot: input.vaultRoot,
  });
  return createHostedRuntimeWakeCandidate(
    nextWakeAt,
    resolveHostedSystemMailboxPreparedItemRetryWakeReason(input.item),
  );
}

function isHostedDeviceSyncDirtyPostCheckpointRecord(
  record: HostedSystemMailboxPostCheckpointRecord,
): boolean {
  return record.kind === "device-sync.dirty-processed"
    || record.kind === "device-sync.dirty-processed-batch";
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
  signal: AbortSignal | null;
  shouldYieldBackgroundMaintenance?: (() => boolean) | null;
  vaultRoot: string;
}): Promise<HostedMailboxExecutionMetrics> {
  const executionContext =
    input.executionContext
    ?? buildHostedSystemMailboxExecutionContext({
      runtime: input.runtime,
      wake: input.pendingItem.wake,
    });
  let wake = input.pendingItem.wake;

  if (wake.kind === "assistant.notification.requested") {
    const {
      prepareHostedAssistantNotificationSystemMailboxWake,
    } = await import("./events/assistant-notification.ts");
    const preparation =
      await prepareHostedAssistantNotificationSystemMailboxWake({
        assertExternalThreadRouteAuthority:
          input.runtime.platform.effectsPort
            .assertExternalThreadRouteAuthority,
        executionContext,
        mailboxDedupeKey: input.pendingItem.mailboxDedupeKey,
        signal: input.signal,
        wake,
      });
    if (preparation.kind === "terminal_no_send") {
      const outcome = preparation.outcome;
      return {
        bootstrapResult: null,
        conversationMetrics: outcome.conversationMetrics,
        ...(outcome.deliveryIntentIds === undefined
          ? {}
          : { deliveryIntentIds: outcome.deliveryIntentIds }),
        mailboxLane: outcome.mailboxLane,
        nextWakeAt: outcome.nextWakeAt ?? null,
        ...(Object.hasOwn(outcome, "nextWakeReason")
          ? { nextWakeReason: outcome.nextWakeReason ?? null }
          : {}),
        postCheckpointRecord: outcome.postCheckpointRecord ?? null,
        redactedLogEntries: outcome.redactedLogEntries ?? [],
      };
    }
    wake = preparation.wake;
  }

  return executeHostedMailboxEvent({
    executionContext,
    forceQueueOnlyAssistantNotification: true,
    operatorHomeRoot: input.operatorHomeRoot ?? undefined,
    preferenceAppliedAt: input.pendingItem.lastAttemptAt ?? undefined,
    preferenceCausalSeq: input.pendingItem.preferenceCausalSeq ?? "0",
    runtime: input.runtime,
    runtimeEnv: input.runtimeEnv,
    signal: input.signal,
    ...(input.shouldYieldBackgroundMaintenance
      ? {
          shouldYieldAssistantAskCompletion: input.shouldYieldBackgroundMaintenance,
          shouldYieldClinicalRecords: input.shouldYieldBackgroundMaintenance,
          shouldYieldDeviceSync: input.shouldYieldBackgroundMaintenance,
        }
      : {}),
    sourceMailboxItemId: input.pendingItem.itemId,
    vaultRoot: input.vaultRoot,
    wake,
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
    || item.route.action === "apply-member-preferences"
    || item.route.action === "apply-member-action"
    || item.route.action === "dispatch-assistant-notification"
    || item.route.action === "run-assistant-ask"
    || item.route.action === "continue-assistant-ask"
    || item.route.action === "run-clinical-records-sync"
    || item.route.action === "run-device-sync-wake"
    || item.route.action === "run-environment-voice"
    || item.route.action === "import-reported-daily-metric"
    || item.route.action === "apply-runtime-control-request"
  ) {
    return item.route.action;
  }

  return null;
}

function hostedSystemMailboxPendingItemsMatchForClaim(
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

export async function recordHostedDeviceSyncDirtyPostCheckpointRecord(input: {
  record: HostedSystemMailboxPostCheckpointRecord;
  runtime: HostedSystemMailboxRuntime;
}): Promise<HostedSystemMailboxPostCheckpointRecordResult> {
  return await recordHostedSystemMailboxPostCheckpointRecord({
    ...input,
    operatorHomeRoot: null,
    vaultRoot: null,
  });
}

async function recordHostedSystemMailboxPostCheckpointRecord(input: {
  operatorHomeRoot: string | null;
  record: HostedSystemMailboxPostCheckpointRecord;
  runtime: HostedSystemMailboxRuntime;
  signal?: AbortSignal | null;
  vaultShareProjectionResult?: HostedVaultShareProjectionOfferResult;
  vaultRoot: string | null;
}): Promise<HostedSystemMailboxPostCheckpointRecordResult> {
  switch (input.record.kind) {
    case "vault-share.projection": {
      if (!input.vaultRoot) {
        throw new Error(
          "Hosted vault-share projection checkpoint requires a vault root.",
        );
      }
      const result = input.vaultShareProjectionResult;
      if (!result) {
        throw new Error(
          "Hosted vault-share projection checkpoint requires an owned projection result.",
        );
      }
      if (result.outcome === "deferred") {
        throw Object.assign(new Error(
          "Hosted vault-share projection checkpoint has deferred approved work.",
        ), {
          code: HOSTED_VAULT_SHARE_PROJECTION_DEFERRED_ERROR_CODE,
        });
      }
      if (result.outcome === "continued") {
        throw Object.assign(new Error(
          "Hosted vault-share projection checkpoint has more bounded work.",
        ), {
          code: HOSTED_VAULT_SHARE_PROJECTION_CONTINUE_ERROR_CODE,
        });
      }
      if (
        result.outcome === "error"
        || result.outcome === "no-port"
        || result.outcome === "preempted"
      ) {
        throw new Error(
          "Hosted vault-share projection checkpoint did not complete.",
        );
      }
      return {
        nextWakeAt: null,
        recorded: result.outcome === "delivered" ? 1 : 0,
        stillDirty: false,
      };
    }
    case "clinical-records.outcome-recorded": {
      const port = input.runtime.platform.clinicalRecordsPort;
      if (!port?.recordOutcome) {
        throw new Error(
          "Hosted clinical records outcome checkpoint requires a configured clinical records port.",
        );
      }
      if (input.signal) {
        await port.recordOutcome(input.record.request, { signal: input.signal });
      } else {
        await port.recordOutcome(input.record.request);
      }
      return {
        nextWakeAt: null,
        recorded: 1,
        stillDirty: false,
      };
    }
    case "codex-auth.updated": {
      const port = input.runtime.platform.codexAuthPort;
      if (!port) {
        throw new Error("Hosted Codex auth checkpoint requires a configured Codex auth port.");
      }
      const response = await port.update({
        attemptId: input.record.attemptId,
        phase: input.record.phase,
      });
      if (
        input.record.phase === "connected"
        && response.status === "superseded"
      ) {
        await removeHostedCodexAuthJson(input.operatorHomeRoot);
      }
      return {
        nextWakeAt: null,
        recorded: response.status === "superseded" ? 0 : 1,
        stillDirty: false,
      };
    }
    case "environment-voice.audio-delete": {
      const deleteEnvironmentVoice =
        input.runtime.platform.effectsPort.deleteEnvironmentVoice;
      if (!deleteEnvironmentVoice) {
        throw new Error(
          "Hosted environment voice checkpoint requires an audio deletion port.",
        );
      }
      await deleteEnvironmentVoice(input.record.audioKey);
      return {
        nextWakeAt: null,
        recorded: 1,
        stillDirty: false,
      };
    }
    case "member-action.outcome-recorded": {
      const port = input.runtime.platform.mailboxPort;
      if (!port?.recordMemberActionOutcome) {
        throw new Error(
          "Hosted member-action outcome checkpoint requires a configured mailbox port.",
        );
      }
      await port.recordMemberActionOutcome(
        input.record.outcome,
        input.signal ? { signal: input.signal } : undefined,
      );
      return {
        nextWakeAt: null,
        recorded: 1,
        stillDirty: false,
      };
    }
    case "device-sync.dirty-processed":
      return await recordHostedDeviceSyncDirtyProcessedRecords({
        records: [input.record],
        runtime: input.runtime,
        signal: input.signal ?? null,
      });
    case "device-sync.dirty-processed-batch":
      return await recordHostedDeviceSyncDirtyProcessedRecords({
        nextWakeAt: input.record.nextWakeAt ?? null,
        records: input.record.records,
        runtime: input.runtime,
        signal: input.signal ?? null,
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
  signal?: AbortSignal | null;
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
      ...(input.signal ? { signal: input.signal } : {}),
      ...(stagedDirtyAcks.length > 0 ? { stagedDirtyAcks } : {}),
    });
    if (response.recorded) {
      recorded += 1;
    }
    stillDirty = stillDirty || response.stillDirty;
    if (shouldUseHostedDirtyAckWake(index, input.records.length, response.stillDirty)) {
      const onlyRetainedPayloadsRemain = response.stillDirty
        && response.dirtyRevision !== null
        && response.dirtyRevision === response.processedRevision;
      const responseWakeAt = onlyRetainedPayloadsRemain && record.nextWakeAt
        ? record.nextWakeAt
        : response.nextWakeAt;
      nextWakeAt = earliestHostedSystemMailboxWakeAt(nextWakeAt, responseWakeAt);
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

async function writeHostedDeviceSyncDirtyAckPersistenceFailureLog(input: {
  error: unknown;
  runtime: HostedSystemMailboxRuntime;
}): Promise<void> {
  const diagnostics = buildHostedExecutionSafeErrorDiagnostics(input.error);
  const diagnosticErrorCode = typeof diagnostics?.errorCode === "string"
    ? diagnostics.errorCode
    : null;
  const diagnosticErrorMessage = typeof diagnostics?.errorMessage === "string"
    ? diagnostics.errorMessage
    : null;
  const errorCode = diagnosticErrorCode ?? deriveHostedExecutionErrorCode(input.error);
  const safeErrorMessage = sanitizeHostedExecutionStructuredLogText(
    diagnosticErrorMessage ?? "Hosted device-sync dirty checkpoint ack failed.",
  ) ?? "Hosted execution runtime failed.";

  await writeHostedRuntimeLogBestEffort({
    entry: {
      component: "device-sync",
      errorCode,
      eventCode: "device-sync.dirty_ack_persistence_failed",
      level: "warn",
      phase: "checkpoint",
      redactedJson: {
        errorCode,
        nextWakeAtPresent: true,
        safeErrorMessage,
      },
    },
    platform: input.runtime.platform,
  });
}
