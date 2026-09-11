import path from "node:path";

import {
  type HostedExecutionSystemWake,
} from "@murphai/hosted-execution/contracts";
import {
  classifyHostedSystemMailboxExecutionClass,
  isHostedSystemMailboxModelFreeNotification,
} from "@murphai/hosted-execution/orchestration-control";
import {
  parseHostedExecutionWake,
} from "@murphai/hosted-execution/parsers";
import {
  HOSTED_RUNTIME_GROUP_CONTEXT_HANDOFF_EVENT_ID_PREFIX,
  HOSTED_RUNTIME_GROUP_CONTEXT_HANDOFF_TTL_MS,
  HOSTED_RUNTIME_DEVICE_SYNC_CONTINUATION_OWNER_MAX_COUNT,
} from "@murphai/hosted-execution/runtime-control";
import { parseMemberActionOutcomeV1 } from "@murphai/contracts";
import {
  parseHostedClinicalRecordsRecordOutcomeRequest,
} from "@murphai/hosted-execution/clinical-records-boundary";
import {
  persistHostedRuntimeStateAtCanonicalBoundary,
} from "@murphai/core";
import {
  withAssistantRuntimeWriteLock,
} from "@murphai/assistant-engine/assistant-state";
import {
  parseHostedExecutionDeviceSyncCompletedImport,
} from "@murphai/device-syncd/hosted-runtime";
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
import { readHostedMailboxImportState } from "./mailbox-state.ts";
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
  type HostedSystemMailboxWakeCandidate,
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
const HOSTED_VAULT_SHARE_PROJECTION_MAILBOX_DEDUPE_KEY_PREFIX =
  "runtime-control:group-share-projection:";

type HostedSystemMailboxSerializationKey =
  | HostedSystemMailboxRouteAction
  | "apply-vault-share-projection"
  | `run-device-sync-wake:${string}`;

export type HostedSystemMailboxRouteAction =
  | "apply-member-activation"
  | "apply-member-channels-update"
  | "apply-member-preferences"
  | "apply-member-action"
  | "initialize-group-room-model"
  | "dispatch-assistant-notification"
  | "run-assistant-ask"
  | "continue-assistant-ask"
  | "run-clinical-records-sync"
  | "apply-clinical-enrichment"
  | "run-device-sync-wake"
  | "run-environment-interview"
  | "run-environment-voice"
  | "import-group-journal-fact"
  | "import-reported-daily-metric"
  | "apply-runtime-control-request";

export interface HostedSystemMailboxPendingItem {
  attemptCount: number;
  deviceSyncContinuationOwner?: true;
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
  now?: () => string;
  vaultRoot: string;
}): Promise<string> {
  return (await readHostedSystemMailboxProgress(input)).handledThroughSeq;
}

/** The new fenced invocation owns the workspace; previous in-process attempts are gone. */
export async function recoverHostedSystemMailboxClaims(vaultRoot: string): Promise<void> {
  await updateHostedSystemMailboxState(vaultRoot, (state) => {
    if (!state.pending.some((item) => item.status === "sending")) {
      return { result: undefined, write: false };
    }
    return {
      pending: state.pending.map((item) => item.status === "sending"
        ? { ...item, status: "pending" as const }
        : item),
    };
  });
}

export async function readHostedSystemMailboxProgress(input: {
  importedSeq: string;
  now?: () => string;
  vaultRoot: string;
}): Promise<HostedSystemMailboxProgress> {
  return resolveHostedSystemMailboxProgress({
    importedSeq: input.importedSeq,
    now: (input.now ?? (() => new Date().toISOString()))(),
    state: await readHostedSystemMailboxState(input.vaultRoot),
  });
}

export interface HostedSystemMailboxProgress {
  deviceSyncContinuationSeqs: string[];
  firstPendingClassifierFailures: HostedSystemMailboxFirstPendingClassifierFailure[] | null;
  firstPendingSeq: string | null;
  handledThroughSeq: string;
}

const HOSTED_SYSTEM_MAILBOX_FIRST_PENDING_CLASSIFIER_FAILURE_VALUES = [
  "continuation_owner_missing",
  "continuation_projection_invalid",
  "wake_not_device_sync",
] as const;

export type HostedSystemMailboxFirstPendingClassifierFailure =
  typeof HOSTED_SYSTEM_MAILBOX_FIRST_PENDING_CLASSIFIER_FAILURE_VALUES[number];

const HOSTED_SYSTEM_MAILBOX_FIRST_PENDING_CLASSIFIER_FAILURES =
  new Set<string>(HOSTED_SYSTEM_MAILBOX_FIRST_PENDING_CLASSIFIER_FAILURE_VALUES);

export function isHostedSystemMailboxFirstPendingClassifierFailure(
  value: unknown,
): value is HostedSystemMailboxFirstPendingClassifierFailure {
  return typeof value === "string"
    && HOSTED_SYSTEM_MAILBOX_FIRST_PENDING_CLASSIFIER_FAILURES.has(value);
}

export function resolveHostedSystemMailboxHandledThroughSeq(input: {
  importedSeq: string;
  now?: string;
  state: HostedSystemMailboxState;
}): string {
  return resolveHostedSystemMailboxProgress(input).handledThroughSeq;
}

export function resolveHostedSystemMailboxProgress(input: {
  importedSeq: string;
  now?: string;
  state: HostedSystemMailboxState;
}): HostedSystemMailboxProgress {
  if (!/^(?:0|[1-9]\d*)$/u.test(input.importedSeq)) {
    throw new TypeError("Hosted system mailbox imported seq must be a non-negative decimal string.");
  }

  const importedSeq = BigInt(input.importedSeq);
  let earliestPendingSeq: bigint | null = null;
  let earliestPendingItem: HostedSystemMailboxPendingItem | null = null;
  const deviceSyncContinuation = resolveHostedDeviceSyncContinuationProjection({
    importedSeq,
    state: input.state,
  });
  const now = input.now ?? new Date().toISOString();
  for (const item of input.state.pending) {
    if (isHostedDeviceSyncDenseRawRetentionMailboxItem(item)) {
      continue;
    }
    if (isExpiredHostedGroupContextHandoffSystemMailboxItem(item, now)) {
      continue;
    }

    // A marked device item is a runtime-owned continuation until the existing
    // mailbox owner removes it. Its status transitions do not change ownership.
    if (deviceSyncContinuation?.itemIds.has(item.itemId)) {
      continue;
    }
    if (item.mailboxLaneSeq === null) {
      return {
        deviceSyncContinuationSeqs: [],
        firstPendingClassifierFailures: classifyHostedSystemMailboxFirstPendingItem(
          item,
          deviceSyncContinuation !== null,
        ),
        firstPendingSeq: null,
        handledThroughSeq: "0",
      };
    }
    const pendingSeq = BigInt(item.mailboxLaneSeq);
    if (earliestPendingSeq === null || pendingSeq < earliestPendingSeq) {
      earliestPendingSeq = pendingSeq;
      earliestPendingItem = item;
    }
  }

  const handledBeforePending = earliestPendingSeq === null
    ? importedSeq
    : earliestPendingSeq - 1n;
  return {
    deviceSyncContinuationSeqs:
      deviceSyncContinuation?.seqs.map((seq) => seq.toString()) ?? [],
    firstPendingClassifierFailures: earliestPendingItem === null
      ? null
      : classifyHostedSystemMailboxFirstPendingItem(
          earliestPendingItem,
          deviceSyncContinuation !== null,
        ),
    firstPendingSeq: earliestPendingSeq?.toString() ?? null,
    handledThroughSeq:
      (handledBeforePending < importedSeq ? handledBeforePending : importedSeq).toString(),
  };
}

function classifyHostedSystemMailboxFirstPendingItem(
  item: HostedSystemMailboxPendingItem,
  continuationProjectionValid: boolean,
): HostedSystemMailboxFirstPendingClassifierFailure[] {
  if (item.wake.kind !== "device-sync.wake") {
    return ["wake_not_device_sync"];
  }
  // Called only for a blocker left by the authoritative projection above.
  // Do not reconstruct continuation ownership from retry or status hints.
  return [continuationProjectionValid
    ? "continuation_owner_missing"
    : "continuation_projection_invalid"];
}

function resolveHostedDeviceSyncContinuationProjection(
  input: {
    importedSeq: bigint;
    state: HostedSystemMailboxState;
  },
): { itemIds: Set<string>; seqs: bigint[] } | null {
  const candidates = input.state.pending.filter((item) =>
    item.deviceSyncContinuationOwner === true
  );
  if (
    candidates.length
      > HOSTED_RUNTIME_DEVICE_SYNC_CONTINUATION_OWNER_MAX_COUNT
  ) {
    return null;
  }

  const connectionIds = new Set<string>();
  const itemIds = new Set<string>();
  const seqs = new Set<bigint>();
  for (const item of candidates) {
    const connectionId = item.wake.kind === "device-sync.wake"
      ? item.wake.connectionId ?? null
      : null;
    if (
      item.routeAction !== "run-device-sync-wake"
      || connectionId === null
      || item.mailboxLaneSeq === null
      || item.mailboxDedupeKey !== item.wake.eventId
      || connectionIds.has(connectionId)
      || itemIds.has(item.itemId)
    ) {
      return null;
    }
    const seq = BigInt(item.mailboxLaneSeq);
    if (seq > input.importedSeq || seqs.has(seq)) {
      return null;
    }
    connectionIds.add(connectionId);
    itemIds.add(item.itemId);
    seqs.add(seq);
  }

  return {
    itemIds,
    seqs: [...seqs].sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
  };
}

export async function readHostedSystemMailboxContinuationItemIds(input: {
  state: HostedSystemMailboxState;
  vaultRoot: string;
}): Promise<ReadonlySet<string>> {
  if (!input.state.pending.some((item) => item.deviceSyncContinuationOwner === true)) {
    return new Set();
  }
  const mailbox = await readHostedMailboxImportState({ vaultRoot: input.vaultRoot });
  return resolveHostedDeviceSyncContinuationProjection({
    importedSeq: BigInt(mailbox.watermarks.system),
    state: input.state,
  })?.itemIds ?? new Set();
}

export async function updateHostedSystemMailboxState<TResult = void>(
  vaultRoot: string,
  update: (
    state: HostedSystemMailboxState,
  ) =>
    | HostedSystemMailboxState
    | { result: TResult; state: HostedSystemMailboxState }
    | { result: TResult; write: false }
    | Promise<
        | HostedSystemMailboxState
        | { result: TResult; state: HostedSystemMailboxState }
        | { result: TResult; write: false }
      >,
  options: { now?: () => string } = {},
): Promise<TResult> {
  return await withAssistantRuntimeWriteLock(vaultRoot, async () => {
    const current = await readHostedSystemMailboxState(vaultRoot);
    const updated = await update(current);
    if (isHostedSystemMailboxStateReadResult(updated)) {
      return updated.result;
    }
    const nextState = isHostedSystemMailboxStateUpdateResult<TResult>(updated)
      ? updated.state
      : updated;
    await writeHostedSystemMailboxState(
      vaultRoot,
      excludeExpiredHostedGroupContextHandoffSystemMailboxItems(
        nextState,
        (options.now ?? (() => new Date().toISOString()))(),
      ),
    );
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
  persistAtCanonicalBoundary?: boolean;
  userId: string;
  vaultRoot: string;
}): Promise<void> {
  if (!input.nextWakeAt) {
    await removePendingHostedDeviceSyncDenseRawRetentionMailboxSuccessors(input.vaultRoot);
    if (input.persistAtCanonicalBoundary === true) {
      await persistHostedRuntimeStateAtCanonicalBoundary();
    }
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
  if (input.persistAtCanonicalBoundary === true) {
    await persistHostedRuntimeStateAtCanonicalBoundary();
  }
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
  excludeItemId?: string | null;
  now?: () => string;
  vaultRoot: string;
}): Promise<HostedSystemMailboxWakeCandidate> {
  const now = (input.now ?? (() => new Date().toISOString()))();
  const state = excludeExpiredHostedGroupContextHandoffSystemMailboxItems(
    await readHostedSystemMailboxState(input.vaultRoot),
    now,
  );
  return resolveHostedSystemMailboxWakeCandidatesFromState({
    ...input,
    continuationItemIds: await readHostedSystemMailboxContinuationItemIds({ ...input, state }),
    now,
    state,
  }).next;
}

export async function resolveHostedSystemMailboxWakeCandidates(input: {
  allowedRouteActions?: readonly HostedSystemMailboxRouteAction[] | null;
  allowedWakeKinds?: readonly HostedExecutionSystemWake["kind"][] | null;
  excludeItemId?: string | null;
  now?: () => string;
  state?: HostedSystemMailboxState;
  vaultRoot: string;
}): Promise<{
  defaultOwned: HostedRuntimeWakeCandidate;
  next: HostedSystemMailboxWakeCandidate;
}> {
  const now = (input.now ?? (() => new Date().toISOString()))();
  const state = excludeExpiredHostedGroupContextHandoffSystemMailboxItems(
    input.state ?? await readHostedSystemMailboxState(input.vaultRoot),
    now,
  );
  return resolveHostedSystemMailboxWakeCandidatesFromState({
    ...input,
    continuationItemIds: await readHostedSystemMailboxContinuationItemIds({ ...input, state }),
    now,
    state,
  });
}

function resolveHostedSystemMailboxWakeCandidatesFromState(input: {
  continuationItemIds: ReadonlySet<string>;
  allowedRouteActions?: readonly HostedSystemMailboxRouteAction[] | null;
  allowedWakeKinds?: readonly HostedExecutionSystemWake["kind"][] | null;
  excludeItemId?: string | null;
  now: string;
  state: HostedSystemMailboxState;
}): {
  defaultOwned: HostedRuntimeWakeCandidate;
  next: HostedSystemMailboxWakeCandidate;
} {
  const { now } = input;
  const remainingStateBeforeAdmission = input.excludeItemId
    ? {
        pending: input.state.pending.filter((item) =>
          item.itemId !== input.excludeItemId
        ),
      }
    : input.state;
  const remainingState = projectHostedSystemMailboxRetainedDeviceWakeAdmission({
    now,
    state: remainingStateBeforeAdmission,
  });
  const coverage = projectHostedDeviceHintCoverage({ now, pending: remainingState.pending });
  const eligibleDirtyHintIds = projectHostedEligibleDirtyHintIds({ ...input, state: remainingState });
  const modelFreeProjectedState = usesHostedModelFreeSystemMailboxSelection({
    allowedRouteActions: input.allowedRouteActions ?? null,
    allowedWakeKinds: input.allowedWakeKinds ?? null,
  }) ? selectHostedModelFreeSystemMailboxItems(remainingState) : remainingState;
  const selectionState = input.allowedWakeKinds == null
    ? modelFreeProjectedState
    : {
        pending: modelFreeProjectedState.pending.filter((item) =>
          input.allowedWakeKinds?.includes(item.wake.kind)
        ),
      };
  const items = findNextHostedSystemMailboxQueueItemsForWake({
    allowedRouteActions: input.allowedRouteActions ?? null,
    state: selectionState,
  });
  const ready = findHostedRunnableSystemMailboxItem({
    allowedRouteActions: input.allowedRouteActions ?? null,
    continuationItemIds: input.continuationItemIds, coverage, eligibleDirtyHintIds, now,
    state: selectionState,
  });
  const defaultOwnedItems = findNextHostedSystemMailboxQueueItemsForWake({
    allowedRouteActions: null,
    state: remainingState,
  }).filter((item) => resolveHostedSystemMailboxItemExecutionClass(item) === "default_owned");
  const readyDefaultOwnedItem = findNextHostedSystemMailboxQueueItem({
    allowedRouteActions: null,
    now,
    state: { pending: defaultOwnedItems },
  });
  const defaultOwned = readyDefaultOwnedItem === null
    ? selectHostedRuntimeWakeCandidate(defaultOwnedItems.map((item) =>
        createHostedRuntimeWakeCandidate(
          resolveSystemMailboxItemNextWakeAt(item, now),
          resolveHostedSystemMailboxItemWakeReason(item),
        )
      ))
    : createHostedRuntimeWakeCandidate(
        resolveSystemMailboxItemNextWakeAt(readyDefaultOwnedItem, now),
        resolveHostedSystemMailboxItemWakeReason(readyDefaultOwnedItem),
      );
  const next: HostedSystemMailboxWakeCandidate = ready !== null
    ? {
      ...createHostedRuntimeWakeCandidate(
        now,
        resolveHostedSystemMailboxItemWakeReason(ready),
      ),
      executionClass: resolveHostedSystemMailboxItemExecutionClass(ready),
    }
    : {
      ...selectHostedRuntimeWakeCandidate(items.map((item) =>
        createHostedRuntimeWakeCandidate(
          resolveSystemMailboxItemNextWakeAt(item, now),
          resolveHostedSystemMailboxItemWakeReason(item),
        )
      )),
      executionClass: null,
    };
  return {
    defaultOwned,
    next,
  };
}

function resolveHostedSystemMailboxItemExecutionClass(
  item: HostedSystemMailboxPendingItem,
): "default_owned" | "model_free" {
  // Local timers have no Web lane sequence, but use the same execution owner
  // as imported work. Sequence numbers track handling, not execution class.
  return isHostedModelFreeSystemMailboxItem(item)
    ? "model_free"
    : "default_owned";
}

export function findNextHostedSystemMailboxQueueItem(input: {
  allowedRouteActions: readonly HostedSystemMailboxRouteAction[] | null;
  pendingOnly?: boolean;
  now: string;
  state: HostedSystemMailboxState;
}): HostedSystemMailboxPendingItem | null {
  const state = projectHostedSystemMailboxRetainedDeviceWakeAdmission({
    now: input.now,
    state: excludeExpiredHostedGroupContextHandoffSystemMailboxItems(
      input.state,
      input.now,
    ),
  });
  if (input.allowedRouteActions == null) {
    const approvedContinuation = state.pending.find((item) =>
      item.status !== "sending"
      && systemMailboxItemIsDue(item, input.now)
      && (!input.pendingOnly || item.status === "pending")
      && isHostedPendingEffectsContinuationSystemMailboxItem(item)
    ) ?? null;
    if (approvedContinuation) {
      return approvedContinuation;
    }

    const delegatedItem = findNextHostedSystemMailboxQueueItemByOrder({
      allowedRouteActions: null,
      pendingOnly: input.pendingOnly,
      now: input.now,
      state: {
        pending: state.pending.filter(isHostedUserInvokedDelegatedSystemMailboxItem),
      },
    });
    if (delegatedItem) {
      return delegatedItem;
    }
  }

  return findNextHostedSystemMailboxQueueItemByOrder({
    ...input,
    state,
  });
}

export function findHostedRunnableSystemMailboxItem(input: {
  allowedRouteActions: readonly HostedSystemMailboxRouteAction[] | null;
  pendingOnly?: boolean;
  continuationItemIds: ReadonlySet<string>;
  coverage: ReadonlyMap<string, HostedDeviceHintCoverage>;
  eligibleDirtyHintIds: ReadonlySet<string>;
  now: string;
  state: HostedSystemMailboxState;
}): HostedSystemMailboxPendingItem | null {
  const selected = findNextHostedSystemMailboxQueueItem(input);
  if (selected) {
    const canYield = input.continuationItemIds.has(selected.itemId)
      && selected.status === "pending" && selected.postCheckpointRecord === null;
    const independent = canYield ? findNextHostedSystemMailboxQueueItem({
      ...input,
      state: { pending: input.state.pending.filter((item) => !input.continuationItemIds.has(item.itemId)) },
    }) : null;
    return independent && independent.wake.kind !== "device-sync.wake" ? independent : selected;
  }
  const owner = input.state.pending.find((item) =>
    input.continuationItemIds.has(item.itemId)
    && item.status !== "sending"
    && (!input.pendingOnly || item.status === "pending")
    && systemMailboxItemRouteActionAllowed(item, input.allowedRouteActions)
    && item.nextAttemptAt !== null
    && !systemMailboxItemIsDue(item, input.now)
    && Date.parse(item.occurredAt) <= Date.parse(input.now)
    && [...(input.coverage.get(item.itemId)?.coveredHintIds ?? [])]
      .some((id) => input.eligibleDirtyHintIds.has(id))
  );
  // Canonical dirty work is runnable now even when the owner's stored job retry
  // is later. A returned item is runnable now; its stored retry remains intact
  // and must not be used to re-derive the admission time by the wake publisher.
  return owner ?? null;
}

export function projectHostedEligibleDirtyHintIds(input: {
  allowedRouteActions?: readonly HostedSystemMailboxRouteAction[] | null;
  allowedWakeKinds?: readonly HostedExecutionSystemWake["kind"][] | null;
  eligibleItemIds?: ReadonlySet<string>;
  state: HostedSystemMailboxState;
}): ReadonlySet<string> {
  return new Set(input.state.pending.filter((item) =>
    item.wake.kind === "device-sync.wake" && item.wake.reason === "webhook_hint"
    && systemMailboxItemRouteActionAllowed(item, input.allowedRouteActions ?? null)
    && (input.allowedWakeKinds == null || input.allowedWakeKinds.includes(item.wake.kind))
    && (input.eligibleItemIds === undefined || input.eligibleItemIds.has(item.itemId))
  ).map((item) => item.itemId));
}

export function projectHostedSystemMailboxRetainedDeviceWakeAdmission(input: {
  now: string;
  state: HostedSystemMailboxState;
}): HostedSystemMailboxState {
  const futureRetainedByConnection = new Map<
    string,
    HostedSystemMailboxPendingItem
  >();
  const admittedItemIds = new Set<string>();

  for (const item of input.state.pending) {
    if (
      item.routeAction !== "run-device-sync-wake"
      || item.wake.kind !== "device-sync.wake"
      || !item.wake.connectionId
    ) {
      continue;
    }
    const connectionId = item.wake.connectionId;
    const retained = futureRetainedByConnection.get(connectionId);
    if (!retained) {
      if (isHostedFutureRetainedDeviceJobRetry(item, input.now)) {
        futureRetainedByConnection.set(connectionId, item);
      }
      continue;
    }
    if (
      (item.wake.reason === "webhook_hint"
        || isHostedRetainedDeviceScheduledAdmission(retained, item, input.now))
      && systemMailboxItemIsDue(item, input.now)
    ) {
      admittedItemIds.add(retained.itemId);
    }
  }

  return admittedItemIds.size === 0
    ? input.state
    : {
        pending: input.state.pending.map((item) =>
          admittedItemIds.has(item.itemId)
            ? { ...item, nextAttemptAt: null }
            : item
        ),
      };
}

export function isHostedPlainDeviceSyncWakeHint(item: HostedSystemMailboxPendingItem): boolean {
  const wake = item.wake;
  return item.routeAction === "run-device-sync-wake"
    && item.status === "pending"
    && item.attemptCount === 0
    && item.postCheckpointRecord === null
    && item.deviceSyncContinuationOwner !== true
    && wake.kind === "device-sync.wake"
    && (wake.reason === "webhook_hint" || wake.reason === "reconcile_due")
    && isHostedPlainDeviceSyncWakeHintReason(wake.hint?.reason)
    && (wake.hint?.jobs?.length ?? 0) === 0
    && wake.hint?.scopes === undefined
    && wake.hint?.revokeWarning == null;
}

export function isHostedPlainDeviceSyncWakeHintReason(reason: string | null | undefined): boolean {
  // These producers store their work in canonical dirty state, which the
  // retained connection owner fetches on its admitted pass.
  return reason == null
    || reason === "webhook_dirty_transition"
    || reason === "companion_health_metadata"
    || reason === "companion_hrv_rmssd";
}

export interface HostedDeviceHintCoverage {
  coveredHintIds: ReadonlySet<string>;
  coveredScheduleIds: ReadonlySet<string>;
}

type HostedDeviceHintCoverageOwner = HostedSystemMailboxPendingItem & {
  mailboxLaneSeq: string;
  wake: Extract<HostedExecutionSystemWake, { kind: "device-sync.wake" }>;
};

export function projectHostedDeviceHintCoverage(input: {
  now: string;
  pending: readonly HostedSystemMailboxPendingItem[];
}): ReadonlyMap<string, HostedDeviceHintCoverage> {
  const coverage = new Map<string, HostedDeviceHintCoverage>();
  const activeByConnection = new Map<string, {
    owner: HostedDeviceHintCoverageOwner;
    coveredHintIds: Set<string>;
    coveredScheduleIds: Set<string>;
    scheduleBlocked: boolean;
  }>();
  for (const item of input.pending) {
    if (item.wake.kind !== "device-sync.wake" || !item.wake.connectionId) continue;
    const connectionId = item.wake.connectionId;
    if (isHostedDeviceHintCoverageOwner(item)) {
      const active = {
        owner: item, coveredHintIds: new Set<string>(),
        coveredScheduleIds: new Set<string>(), scheduleBlocked: false,
      };
      // Another owner is a barrier for the preceding owner on this connection.
      activeByConnection.set(connectionId, active);
      coverage.set(item.itemId, {
        coveredHintIds: active.coveredHintIds,
        coveredScheduleIds: active.coveredScheduleIds,
      });
      continue;
    }
    const active = activeByConnection.get(connectionId);
    if (!active) continue;
    if (!isHostedDeviceHintCoveredByOwner(active.owner, item, input.now)) {
      activeByConnection.delete(connectionId);
      continue;
    }
    active.coveredHintIds.add(item.itemId);
    // Dirty work needs an executing owner. Idle schedule retirement cannot
    // cross it, even when later schedules would otherwise be superseded.
    if (item.wake.reason === "webhook_hint") active.scheduleBlocked = true;
    if (!active.scheduleBlocked) active.coveredScheduleIds.add(item.itemId);
  }
  return coverage;
}

function isHostedDeviceHintCoverageOwner(
  item: HostedSystemMailboxPendingItem,
): item is HostedDeviceHintCoverageOwner {
  return item.deviceSyncContinuationOwner === true
    && item.status === "pending"
    && item.postCheckpointRecord === null
    && item.wake.kind === "device-sync.wake"
    && Boolean(item.wake.connectionId)
    && Boolean(item.wake.expectedConnectedAt)
    && item.mailboxLaneSeq !== null
    && item.mailboxDedupeKey === item.wake.eventId;
}

function isHostedDeviceHintCoveredByOwner(
  owner: HostedDeviceHintCoverageOwner,
  item: HostedSystemMailboxPendingItem,
  now: string,
): boolean {
  const wake = item.wake;
  if (wake.kind !== "device-sync.wake" || !isHostedPlainDeviceSyncWakeHint(item)) return false;
  const cadence = wake.hint?.nextReconcileAt;
  const ownerCadence = owner.wake.hint?.nextReconcileAt;
  return item.mailboxLaneSeq !== null
    && BigInt(item.mailboxLaneSeq) > BigInt(owner.mailboxLaneSeq)
    && wake.userId === owner.wake.userId
    && wake.provider === owner.wake.provider
    && wake.expectedConnectedAt === owner.wake.expectedConnectedAt
    && (wake.reason !== "reconcile_due" || cadence != null)
    && (cadence == null || (ownerCadence != null && Date.parse(cadence) < Date.parse(ownerCadence)))
    && Date.parse(wake.occurredAt) <= Date.parse(now);
}

export function isHostedRetainedDeviceScheduledAdmission(
  owner: HostedSystemMailboxPendingItem,
  item: HostedSystemMailboxPendingItem,
  now: string,
): boolean {
  const wake = item.wake;
  return owner.wake.kind === "device-sync.wake"
    && Boolean(owner.wake.expectedConnectedAt)
    && wake.kind === "device-sync.wake"
    && wake.reason === "reconcile_due"
    && wake.expectedConnectedAt === owner.wake.expectedConnectedAt
    && wake.userId === owner.wake.userId
    && wake.provider === owner.wake.provider
    && isHostedPlainDeviceSyncWakeHint(item)
    && wake.hint?.nextReconcileAt != null
    && (owner.wake.hint?.nextReconcileAt == null
      || Date.parse(wake.hint.nextReconcileAt) >= Date.parse(owner.wake.hint.nextReconcileAt))
    && Date.parse(wake.hint.nextReconcileAt) <= Date.parse(now);
}

function isHostedFutureRetainedDeviceJobRetry(
  item: HostedSystemMailboxPendingItem,
  now: string,
): boolean {
  return (isHostedRetainedDeviceJobRetry(item)
      || (item.deviceSyncContinuationOwner === true
        && item.status === "pending"
        && item.postCheckpointRecord === null
        && item.wake.kind === "device-sync.wake"
        && (item.wake.hint?.jobs?.length ?? 0) > 0))
    && !systemMailboxItemIsDue(item, now);
}

function isHostedRetainedDeviceJobRetry(
  item: HostedSystemMailboxPendingItem,
): boolean {
  // Legacy promotion and retry admission only. Live continuation
  // authority belongs to resolveHostedDeviceSyncContinuationProjection.
  return item.wake.kind === "device-sync.wake"
    && item.status === "pending"
    && item.postCheckpointRecord === null
    && item.nextAttemptAt !== null
    && Boolean(item.wake.connectionId)
    && item.wake.hint?.jobs?.some((job) => job.availableAt === item.nextAttemptAt) === true;
}

function withHostedLegacyDeviceSyncContinuationOwnership(
  item: HostedSystemMailboxPendingItem,
): HostedSystemMailboxPendingItem {
  return item.deviceSyncContinuationOwner === undefined
      && item.routeAction === "run-device-sync-wake"
      && item.mailboxLaneSeq !== null
      && item.mailboxDedupeKey === item.wake.eventId
      && isHostedRetainedDeviceJobRetry(item)
    ? { ...item, deviceSyncContinuationOwner: true }
    : item;
}

function findNextHostedSystemMailboxQueueItemByOrder(input: {
  allowedRouteActions: readonly HostedSystemMailboxRouteAction[] | null;
  pendingOnly?: boolean;
  now: string;
  state: HostedSystemMailboxState;
}): HostedSystemMailboxPendingItem | null {
  const blockedSerializationKeys = new Set<HostedSystemMailboxSerializationKey>();
  let oldestDueItem: HostedSystemMailboxPendingItem | null = null;
  for (const item of input.state.pending) {
    if (!systemMailboxItemRouteActionAllowed(item, input.allowedRouteActions)) {
      continue;
    }
    const isDue = item.status !== "sending"
      && (!input.pendingOnly || item.status === "pending")
      && systemMailboxItemIsDue(item, input.now);
    const serializationKey = resolveHostedSystemMailboxSerializationKey(item);
    if (blockedSerializationKeys.has(serializationKey)) {
      continue;
    }
    if (isDue) {
      oldestDueItem ??= item;
      continue;
    }
    blockedSerializationKeys.add(serializationKey);
  }

  return oldestDueItem;
}

export function isHostedApprovedContinuationSystemMailboxItem(
  item: HostedSystemMailboxPendingItem,
): boolean {
  // Approved continuations belong to the ordinary assistant owner. Keep that
  // handoff derived from the exact local wake instead of adding another
  // orchestration or persisted-state owner.
  return isHostedPendingEffectsContinuationSystemMailboxItem(item)
    || isHostedUserInvokedDelegatedSystemMailboxItem(item);
}

function isHostedPendingEffectsContinuationSystemMailboxItem(
  item: HostedSystemMailboxPendingItem,
): boolean {
  return item.routeAction === "apply-runtime-control-request"
    && item.wake.kind === "runtime.pending-effects-reconcile-requested";
}

function isHostedUserInvokedDelegatedSystemMailboxItem(
  item: HostedSystemMailboxPendingItem,
): boolean {
  if (
    item.routeAction === "run-assistant-ask"
    && item.wake.kind === "assistant.ask.requested"
  ) {
    const targetKind = item.wake.ask.target.kind;
    return targetKind === "joined_group"
      || targetKind === "current_sender_personal"
      || targetKind === "group_sender"
      || targetKind === "group_sender_private";
  }
  return isHostedGroupContextHandoffSystemMailboxItem(item);
}

export function isHostedGroupContextHandoffSystemMailboxItem(
  item: HostedSystemMailboxPendingItem,
): boolean {
  if (
    item.routeAction !== "dispatch-assistant-notification"
    || item.wake.kind !== "assistant.notification.requested"
    || !item.mailboxDedupeKey.startsWith(
      HOSTED_RUNTIME_GROUP_CONTEXT_HANDOFF_EVENT_ID_PREFIX,
    )
  ) {
    return false;
  }

  const notification = item.wake.notification;
  return item.wake.eventId === item.mailboxDedupeKey
    && notification.deliveryDedupeToken === item.mailboxDedupeKey
    && notification.deliveryIdempotencyKey === item.mailboxDedupeKey
    && notification.deliveryDispatchMode === "queue-only"
    && notification.notificationPromptProfile === "context-handoff"
    && notification.responsePolicy?.kind === "require_send"
    && notification.groupContextHandoff != null;
}

function isExpiredHostedGroupContextHandoffSystemMailboxItem(
  item: HostedSystemMailboxPendingItem,
  now: string,
): boolean {
  if (
    !isHostedGroupContextHandoffSystemMailboxItem(item)
    || item.status !== "pending"
    || item.postCheckpointRecord !== null
  ) {
    return false;
  }
  const occurredAtMs = Date.parse(item.wake.occurredAt);
  const nowMs = Date.parse(now);
  return Number.isFinite(occurredAtMs)
    && Number.isFinite(nowMs)
    && nowMs >= occurredAtMs + HOSTED_RUNTIME_GROUP_CONTEXT_HANDOFF_TTL_MS;
}

function excludeExpiredHostedGroupContextHandoffSystemMailboxItems(
  state: HostedSystemMailboxState,
  now: string,
): HostedSystemMailboxState {
  return {
    pending: state.pending.filter((item) =>
      !isExpiredHostedGroupContextHandoffSystemMailboxItem(item, now)
    ),
  };
}

export function isHostedSystemMailboxModelFreeExactNotificationItem(
  item: HostedSystemMailboxPendingItem,
): boolean {
  if (
    item.routeAction !== "dispatch-assistant-notification"
    || item.wake.kind !== "assistant.notification.requested"
  ) {
    return false;
  }

  const notification = item.wake.notification;
  const deliveryDedupeToken = notification.deliveryDedupeToken ?? "";
  const deliveryIdempotencyKey = notification.deliveryIdempotencyKey ?? "";
  const expectedDedupeKey =
    `assistant.notification.requested:${deliveryDedupeToken}`;

  return deliveryDedupeToken.length > 0
    && deliveryDedupeToken === deliveryIdempotencyKey
    && item.mailboxDedupeKey === expectedDedupeKey
    && item.wake.eventId === expectedDedupeKey
    && notification.deliveryDispatchMode === "queue-only"
    && notification.responsePolicy?.kind === "require_send_exact_text"
    && notification.responsePolicy.text.length > 0
    && isHostedSystemMailboxModelFreeNotification({
      dedupeKey: item.mailboxDedupeKey,
      kind: item.wake.kind,
    });
}

export function isHostedModelFreeSystemMailboxItem(
  item: HostedSystemMailboxPendingItem,
): boolean {
  if (
    classifyHostedSystemMailboxExecutionClass({
      dedupeKey: item.mailboxDedupeKey,
      kind: item.wake.kind,
    }) !== "model_free"
  ) {
    return false;
  }

  return item.wake.kind !== "assistant.notification.requested"
    || isHostedSystemMailboxModelFreeExactNotificationItem(item);
}

export function selectHostedModelFreeSystemMailboxItems(
  state: HostedSystemMailboxState,
): HostedSystemMailboxState {
  return { pending: state.pending.filter(isHostedModelFreeSystemMailboxItem) };
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

  const item: HostedSystemMailboxPendingItem = {
    ...(record.deviceSyncContinuationOwner === undefined
      ? {}
      : {
          deviceSyncContinuationOwner: readRequiredTrue(
            record.deviceSyncContinuationOwner,
            "hosted system mailbox deviceSyncContinuationOwner",
          ),
        }),
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
  return withHostedLegacyDeviceSyncContinuationOwnership(item);
}

function parseHostedSystemMailboxRouteAction(value: unknown): HostedSystemMailboxRouteAction {
  if (
    value === "apply-member-activation"
    || value === "apply-member-channels-update"
    || value === "apply-member-preferences"
    || value === "apply-member-action"
    || value === "initialize-group-room-model"
    || value === "dispatch-assistant-notification"
    || value === "run-assistant-ask"
    || value === "continue-assistant-ask"
    || value === "run-clinical-records-sync"
    || value === "apply-clinical-enrichment"
    || value === "run-device-sync-wake"
    || value === "run-environment-interview"
    || value === "run-environment-voice"
    || value === "import-group-journal-fact"
    || value === "import-reported-daily-metric"
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

  if (record.kind === "vault-share.projection") {
    assertHostedSystemMailboxRecordKeys(
      record,
      ["kind"],
      "hosted system mailbox vault-share projection postCheckpointRecord",
    );
    return { kind: "vault-share.projection" };
  }

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
    if (
      record.records.length === 0
      && record.nextWakeAt == null
      && record.retainMailboxItemUntil == null
    ) {
      throw new TypeError(
        "hosted system mailbox postCheckpointRecord empty records must include a wake.",
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
      ...(record.retainMailboxItemUntil === undefined
        ? {}
        : {
            retainMailboxItemUntil: readNullableIsoTimestamp(
              record.retainMailboxItemUntil,
              "hosted system mailbox postCheckpointRecord retainMailboxItemUntil",
            ),
          }),
      ...(record.retainedWake === undefined
        ? {}
        : {
            retainedWake: parseHostedDeviceSyncRetainedWake(record.retainedWake),
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

  if (record.kind === "member-action.outcome-recorded") {
    assertHostedSystemMailboxRecordKeys(
      record,
      ["kind", "outcome"],
      "hosted system mailbox member-action postCheckpointRecord",
    );
    return {
      kind: "member-action.outcome-recorded",
      outcome: parseMemberActionOutcomeV1(record.outcome),
    };
  }

  throw new TypeError("hosted system mailbox postCheckpointRecord kind is invalid.");
}

function parseHostedDeviceSyncRetainedWake(
  value: unknown,
): Extract<HostedExecutionSystemWake, { kind: "device-sync.wake" }> {
  const wake = parseHostedExecutionWake(value);
  if (wake.kind !== "device-sync.wake") {
    throw new TypeError(
      "hosted system mailbox postCheckpointRecord retainedWake must be a device-sync wake.",
    );
  }
  return wake;
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
  const processedDirtyPayloadIds = readOptionalStringArray(
    record.processedDirtyPayloadIds,
    `${label} processedDirtyPayloadIds`,
  );
  const completedImports = readHostedDeviceSyncCompletedImports(
    record.completedImports,
    `${label} completedImports`,
  );
  if (completedImports) {
    const processedIds = new Set(processedDirtyPayloadIds ?? []);
    if (completedImports.some((receipt) => !processedIds.has(receipt.dirtyPayloadId))) {
      throw new TypeError(`${label} completedImports must reference processed dirty payload ids.`);
    }
  }

  return {
    ...(completedImports === undefined ? {} : { completedImports }),
    connectionId: readRequiredString(record.connectionId, `${label} connectionId`),
    ...(record.nextWakeAt === undefined
      ? {}
      : {
          nextWakeAt: readNullableIsoTimestamp(
            record.nextWakeAt,
            `${label} nextWakeAt`,
          ),
        }),
    ...(processedDirtyPayloadIds === undefined ? {} : { processedDirtyPayloadIds }),
    processedRevision: readRequiredString(record.processedRevision, `${label} processedRevision`),
  };
}

function readHostedDeviceSyncCompletedImports(
  value: unknown,
  label: string,
): NonNullable<HostedDeviceSyncDirtyProcessedPostCheckpointRecord["completedImports"]> | undefined {
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

  const seenPayloadIds = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError(`${label}[${index}] must be an object.`);
    }
    const completedImport = parseHostedExecutionDeviceSyncCompletedImport(
      entry,
      `${label}[${index}]`,
    );
    const dirtyPayloadId = completedImport.dirtyPayloadId;
    if (seenPayloadIds.has(dirtyPayloadId)) {
      throw new TypeError(`${label} must not repeat a dirty payload id.`);
    }
    seenPayloadIds.add(dirtyPayloadId);
    return completedImport;
  });
}

function findNextHostedSystemMailboxQueueItemsForWake(input: {
  allowedRouteActions: readonly HostedSystemMailboxRouteAction[] | null;
  state: HostedSystemMailboxState;
}): HostedSystemMailboxPendingItem[] {
  const items: HostedSystemMailboxPendingItem[] = [];
  const seenItemIds = new Set<string>();
  const appendItem = (item: HostedSystemMailboxPendingItem): void => {
    if (!seenItemIds.has(item.itemId)) {
      seenItemIds.add(item.itemId);
      items.push(item);
    }
  };
  const appendSerializationFrontier = (
    candidates: readonly HostedSystemMailboxPendingItem[],
  ): void => {
    const seenSerializationKeys =
      new Set<HostedSystemMailboxSerializationKey>();
    for (const item of candidates) {
      if (!systemMailboxItemRouteActionAllowed(item, input.allowedRouteActions)) {
        continue;
      }
      const serializationKey = resolveHostedSystemMailboxSerializationKey(item);
      if (seenSerializationKeys.has(serializationKey)) {
        continue;
      }
      seenSerializationKeys.add(serializationKey);
      appendItem(item);
    }
  };

  if (input.allowedRouteActions === null) {
    for (const item of input.state.pending) {
      if (isHostedPendingEffectsContinuationSystemMailboxItem(item)) {
        appendItem(item);
      }
    }
    appendSerializationFrontier(
      input.state.pending.filter(isHostedUserInvokedDelegatedSystemMailboxItem),
    );
  }
  appendSerializationFrontier(input.state.pending);
  return items;
}

export function usesHostedModelFreeSystemMailboxSelection(input: {
  allowedRouteActions: readonly HostedSystemMailboxRouteAction[] | null;
  allowedWakeKinds: readonly HostedExecutionSystemWake["kind"][] | null;
}): boolean {
  const includesModelFreeMaintenanceAction =
    input.allowedRouteActions?.includes("apply-runtime-control-request") === true
    || input.allowedRouteActions?.includes("run-device-sync-wake") === true;
  return input.allowedRouteActions?.includes(
    "dispatch-assistant-notification",
  ) === true
    && includesModelFreeMaintenanceAction
    && input.allowedWakeKinds?.includes(
      "assistant.notification.requested",
    ) === true;
}

function systemMailboxItemRouteActionAllowed(
  item: HostedSystemMailboxPendingItem,
  allowedRouteActions: readonly HostedSystemMailboxRouteAction[] | null,
): boolean {
  return !allowedRouteActions || allowedRouteActions.includes(item.routeAction);
}

function resolveHostedSystemMailboxSerializationKey(
  item: HostedSystemMailboxPendingItem,
): HostedSystemMailboxSerializationKey {
  if (
    item.postCheckpointRecord?.kind === "vault-share.projection"
    || item.mailboxDedupeKey.startsWith(
      HOSTED_VAULT_SHARE_PROJECTION_MAILBOX_DEDUPE_KEY_PREFIX,
    )
  ) {
    return "apply-vault-share-projection";
  }
  if (
    item.routeAction === "run-device-sync-wake"
    && item.wake.kind === "device-sync.wake"
    && item.wake.connectionId
  ) {
    return `${item.routeAction}:${item.wake.connectionId}`;
  }
  return item.routeAction;
}

export function systemMailboxItemIsDue(
  item: HostedSystemMailboxPendingItem,
  now: string,
): boolean {
  return resolveSystemMailboxItemNextWakeAt(item, now) === now;
}

function resolveSystemMailboxItemNextWakeAt(
  item: HostedSystemMailboxPendingItem,
  now: string,
): string | null {
  // Claimed attempts notify the invocation on completion. They cannot be
  // selected again or projected as immediate work while execution is in flight.
  if (item.status === "sending") {
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
  if (item.routeAction === "run-device-sync-wake") {
    return HOSTED_DEVICE_SYNC_RECONCILE_WAKE_REASON;
  }

  return isHostedModelFreeSystemMailboxItem(item)
    ? "mailbox"
    : HOSTED_ASSISTANT_WAKE_REASON;
}

function hostedSystemMailboxPendingItemsMatch(
  left: HostedSystemMailboxPendingItem,
  right: HostedSystemMailboxPendingItem,
): boolean {
  return left.itemId === right.itemId
    && left.deviceSyncContinuationOwner === right.deviceSyncContinuationOwner
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

function readRequiredTrue(value: unknown, label: string): true {
  if (value !== true) {
    throw new TypeError(`${label} must be true when present.`);
  }
  return true;
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
  value:
    | HostedSystemMailboxState
    | { result: TResult; state: HostedSystemMailboxState }
    | { result: TResult; write: false },
): value is { result: TResult; state: HostedSystemMailboxState } {
  return typeof (value as { result?: unknown }).result !== "undefined"
    && typeof (value as { state?: unknown }).state !== "undefined";
}

function isHostedSystemMailboxStateReadResult<TResult>(
  value:
    | HostedSystemMailboxState
    | { result: TResult; state: HostedSystemMailboxState }
    | { result: TResult; write: false },
): value is { result: TResult; write: false } {
  return "write" in value && value.write === false;
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
