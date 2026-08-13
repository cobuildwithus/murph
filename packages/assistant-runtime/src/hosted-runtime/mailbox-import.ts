import type {
  HostedMailboxFetchResponse,
  HostedMailboxItem,
  HostedMailboxLane,
} from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_MAILBOX_LANES,
} from "@murphai/hosted-execution/runtime-control";

import {
  advanceHostedMailboxLaneWatermark,
  recordHostedMailboxImportQuarantine,
  recordHostedMailboxImportStatus,
  type HostedMailboxImportState,
} from "./mailbox-state.ts";
import {
  createHostedMailboxRoutingPlan,
  type HostedMailboxRoutePlan,
} from "./mailbox-routing.ts";
import {
  resolveHostedMailboxItemPayload,
  type HostedMailboxPayloadResolutionResult,
} from "./mailbox-payloads.ts";
import type {
  HostedRuntimeMailboxPort,
} from "./platform.ts";
import type {
  HostedAssistantLinqDeliveryContext,
} from "./linq-delivery-context.ts";
import type {
  HostedAssistantEmailDeliveryContext,
} from "./email-delivery-context.ts";

const HOSTED_MAILBOX_RETRYABLE_BLOCK_RETRY_DELAY_MS = 15 * 1000;
const HOSTED_MAILBOX_LEGACY_VAULT_SHARE_SKIP_REASON =
  "legacy_vault_share.web_owned";
const HOSTED_MAILBOX_RETIRED_NEWSLETTER_SKIP_REASON =
  "legacy_group_newsletter_email_needed.retired";
export const HOSTED_MAILBOX_ITEM_BUDGET_REASON_CODE = "budget.mailbox_items";

export type HostedMailboxItemImportOutcome =
  | {
      status: "blocked";
      reasonCode: string;
      retryable: boolean;
    }
  | {
      status: "deferred";
      reasonCode: string;
    }
  | {
      status: "imported" | "skipped";
      assistantInputId?: string | null;
      emailDeliveryContext?: HostedAssistantEmailDeliveryContext | null;
      linqDeliveryContext?: HostedAssistantLinqDeliveryContext | null;
      reasonCode?: string | null;
      afterCheckpoint?: HostedMailboxPostCheckpointEffect | null;
      conversationImportTiming?: HostedMailboxConversationImportTiming | null;
    };

export interface HostedMailboxConversationImportTiming {
  projectionPrepareMs?: number;
  projectionImportMs?: number;
  attachmentEvidenceMs?: number;
  projectionTotalMs?: number;
}

export interface HostedMailboxPostCheckpointEffectResult {
  kind: "inbox_projection" | "meal_photo_cleanup";
  projectionUpdated: boolean | null;
  attachmentEvidenceUpdated: boolean | null;
  status: "succeeded" | "failed" | "partial";
  reasonCode: string | null;
}

export type HostedMailboxPostCheckpointEffect = () =>
  Promise<HostedMailboxPostCheckpointEffectResult>;

export interface HostedMailboxResolvedImportItem {
  // True when this item is durably marked handled by its item stamp or the
  // lane consumed watermark: it must stay conversation context only, never a
  // fresh reply candidate.
  durablyConsumed?: boolean;
  groupRunningBit?: HostedMailboxFetchResponse["groupRunningBit"];
  usageRunningLow?: true;
  item: HostedMailboxItem;
  payload: Extract<HostedMailboxPayloadResolutionResult, { status: "resolved" }>;
  route: HostedMailboxRoutePlan;
}

export interface HostedMailboxImportLoopResult {
  assistantInputIds?: string[];
  assistantInputRecords?: HostedMailboxAssistantInputRecord[];
  blocked: HostedMailboxImportLoopBlockedItem[];
  conversationImportedCount?: number;
  consumedSeqByLane: Record<HostedMailboxLane, string | null>;
  fetchedLanes?: readonly HostedMailboxLane[];
  fetchedCount: number;
  importedCount: number;
  importedSystemMailboxItemIds?: string[];
  emailDeliveryContexts?: HostedAssistantEmailDeliveryContext[];
  latestLinqDeliveryContext?: HostedAssistantLinqDeliveryContext | null;
  linqDeliveryContexts?: HostedAssistantLinqDeliveryContext[];
  conversationImportTiming?: HostedMailboxConversationImportTiming;
  nextRetryAt?: string | null;
  state: HostedMailboxImportState;
}

export interface HostedMailboxAssistantInputRecord {
  assistantInputId: string;
  causalSeq?: string | null;
  emailDeliveryContext?: HostedAssistantEmailDeliveryContext;
  linqDeliveryContext?: HostedAssistantLinqDeliveryContext;
}

export interface HostedMailboxImportLoopBlockedItem {
  itemId: string | null;
  lane: string;
  reasonCode: string;
  retryable: boolean;
  seq: string | null;
}

export interface HostedMailboxConversationDeferral {
  ready(): boolean;
  reasonCode: string;
}

export interface HostedMailboxPrefixPrefetch {
  importedSeqByLane: Record<HostedMailboxLane, string>;
  lanes: readonly HostedMailboxLane[];
  limitPerLane: number;
  response: Promise<HostedMailboxFetchResponse>;
  signal?: AbortSignal | null;
}

export class HostedMailboxUserMismatchError extends Error {
  readonly itemId: string | null;
  readonly scope: "fetch_response" | "item";

  constructor(input: {
    itemId?: string | null;
    scope: "fetch_response" | "item";
  }) {
    super("Hosted mailbox fetch returned data for an unexpected user.");
    this.name = "HostedMailboxUserMismatchError";
    this.itemId = input.itemId ?? null;
    this.scope = input.scope;
  }
}

export function prefetchHostedMailboxPrefix(input: {
  lanes?: readonly HostedMailboxLane[];
  limitPerLane: number;
  mailboxPort: HostedRuntimeMailboxPort;
  requestId: string;
  signal?: AbortSignal | null;
  state: HostedMailboxImportState;
}): HostedMailboxPrefixPrefetch {
  const lanes = input.lanes ?? HOSTED_MAILBOX_LANES;
  const importedSeqByLane = Object.fromEntries(
    HOSTED_MAILBOX_LANES.map((lane) => [lane, input.state.watermarks[lane]]),
  ) as Record<HostedMailboxLane, string>;
  const request = {
    cursorMode: "imported_seq" as const,
    lanes: lanes.map((lane) => ({
      importedSeq: importedSeqByLane[lane],
      lane,
    })),
    limitPerLane: input.limitPerLane,
    requestId: input.requestId,
  };
  const signal = input.signal ?? null;
  let response: Promise<HostedMailboxFetchResponse>;
  try {
    response = signal
      ? input.mailboxPort.fetch(request, { signal })
      : input.mailboxPort.fetch(request);
  } catch (error) {
    response = Promise.reject(error);
  }
  void response.catch(() => undefined);

  return {
    importedSeqByLane,
    lanes,
    limitPerLane: input.limitPerLane,
    response,
    ...(signal ? { signal } : {}),
  };
}

export async function fetchAndProcessHostedMailboxPrefix(input: {
  deferConversationUntil?: HostedMailboxConversationDeferral | null;
  expectedUserId: string;
  fetchSignal?: AbortSignal | null;
  importItem(item: HostedMailboxResolvedImportItem): Promise<HostedMailboxItemImportOutcome>;
  lanes?: readonly HostedMailboxLane[];
  limitPerLane: number;
  mailboxPort: HostedRuntimeMailboxPort;
  now?: () => string;
  prefetch?: HostedMailboxPrefixPrefetch | null;
  requestId: string;
  state: HostedMailboxImportState;
}): Promise<HostedMailboxImportLoopResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const lanes = input.lanes ?? HOSTED_MAILBOX_LANES;
  const fetchedResponse = await fetchHostedMailboxPrefix({
    fetchSignal: input.fetchSignal ?? input.prefetch?.signal ?? null,
    lanes,
    limitPerLane: input.limitPerLane,
    mailboxPort: input.mailboxPort,
    prefetch: input.prefetch ?? null,
    requestId: input.requestId,
    state: input.state,
  });
  assertHostedMailboxFetchUser({
    expectedUserId: input.expectedUserId,
    fetched: fetchedResponse,
  });
  const fetched = selectHostedMailboxFetchResponseLanes(fetchedResponse, lanes);
  const itemsByLane = groupMailboxItemsByLane(fetched.items);
  const consumedSeqState = readHostedMailboxFetchConsumedSeqState(fetched);
  const consumedSeqByLane = consumedSeqState.seqByLane;
  let nextState = input.state;
  const assistantInputIds: string[] = [];
  const assistantInputRecords: HostedMailboxAssistantInputRecord[] = [];
  let conversationImportedCount = 0;
  let importedCount = 0;
  const importedSystemMailboxItemIds: string[] = [];
  const emailDeliveryContexts: HostedAssistantEmailDeliveryContext[] = [];
  const blocked: HostedMailboxImportLoopBlockedItem[] = [];
  let latestLinqDeliveryContext: HostedAssistantLinqDeliveryContext | null = null;
  const linqDeliveryContexts: HostedAssistantLinqDeliveryContext[] = [];
  let conversationImportTiming: HostedMailboxConversationImportTiming | null = null;
  let nextRetryAt: string | null = null;
  const stoppedLanes = new Set<HostedMailboxLane>();
  const expectedSeqByLane = resolveHostedMailboxExpectedSeqByLane({
    lanes,
    state: nextState,
  });
  const systemLaneFetched = itemsByLane.system.length > 0;
  const lanesWithConsumedReplayInBatch = new Set<HostedMailboxLane>();

  for (const { item, lane } of interleaveMailboxItemsByLane(lanes, itemsByLane)) {
    if (stoppedLanes.has(lane)) {
      continue;
    }

    const itemSeq = parseMailboxSeqForImportOrNull(item.laneSeq);
    const itemIsDurablyConsumedReplay = itemSeq !== null
      && isDurablyConsumedReplay({
        consumedSeq: consumedSeqByLane[lane],
        consumedSeqPresent: consumedSeqState.presentByLane[lane],
        item,
        itemSeq,
      });
    if (itemSeq !== null && shouldFastForwardHostedMailboxExpectedSeq({
      consumedSeq: consumedSeqByLane[lane],
      consumedSeqPresent: consumedSeqState.presentByLane[lane],
      expectedSeq: expectedSeqByLane[lane],
      itemSeq,
      processedConsumedReplayInBatch: lanesWithConsumedReplayInBatch.has(lane),
    })) {
      expectedSeqByLane[lane] = itemSeq;
    }
    const expectedSeq = expectedSeqByLane[lane];

    if (itemSeq !== null && itemSeq < expectedSeq) {
      continue;
    }

    if (itemSeq !== null && itemSeq !== expectedSeq) {
      blocked.push({
        itemId: item.id,
        lane,
        reasonCode: "lane.gap",
        retryable: true,
        seq: item.laneSeq,
      });
      nextRetryAt = earliestHostedMailboxRetryAt(nextRetryAt, computeHostedMailboxRetryAt(now()));
      stoppedLanes.add(lane);
      continue;
    }

    const route = createHostedMailboxRoutingPlan(item);

    if (itemIsDurablyConsumedReplay) {
      lanesWithConsumedReplayInBatch.add(lane);
    }

    if (
      lane === "conversation"
      && (systemLaneFetched || hasHostedMailboxSidecarPayload(item))
      && input.deferConversationUntil
      && !input.deferConversationUntil.ready()
    ) {
      const reasonCode = normalizeReasonCode(
        input.deferConversationUntil.reasonCode,
        "conversation.deferred",
      );
      blocked.push({
        itemId: item.id,
        lane,
        reasonCode,
        retryable: true,
        seq: item.laneSeq,
      });
      nextRetryAt = earliestHostedMailboxRetryAt(nextRetryAt, computeHostedMailboxRetryAt(now()));
      stoppedLanes.add(lane);
      continue;
    }

    if (route.state === "quarantine") {
      const reasonCode = `route.${route.quarantineCode}`;
      if (route.quarantineCode === "unsupported_kind") {
        blocked.push({
          itemId: item.id,
          lane,
          reasonCode,
          retryable: true,
          seq: item.laneSeq,
        });
        nextRetryAt = earliestHostedMailboxRetryAt(
          nextRetryAt,
          computeHostedMailboxRetryAt(now()),
        );
        stoppedLanes.add(lane);
        continue;
      }
      nextState = recordHostedMailboxImportQuarantine(nextState, {
        itemKind: item.kind,
        lane,
        occurredAt: now(),
        reasonCode,
        seq: normalizeSeqForStatus(item.laneSeq),
      });
      blocked.push({
        itemId: item.id,
        lane,
        reasonCode,
        retryable: false,
        seq: item.laneSeq,
      });
      if (itemSeq === null) {
        stoppedLanes.add(lane);
        continue;
      }
      nextState = advanceHostedMailboxLaneWatermark(nextState, {
        lane,
        seq: item.laneSeq,
      }).state;
      expectedSeqByLane[lane] += 1n;
      continue;
    }

    if (itemSeq === null) {
      throw new TypeError("Hosted mailbox routed seq must be a valid decimal string.");
    }

    const retiredSkipReason = resolveRetiredMailboxSkipReason(route.action);
    if (retiredSkipReason !== null) {
      nextState = recordHostedMailboxTerminalSkip({
        item,
        lane,
        now: now(),
        reasonCode: retiredSkipReason,
        state: nextState,
      });
      expectedSeqByLane[lane] += 1n;
      continue;
    }

    const payload = await resolveHostedMailboxItemPayload({
      item,
      mailboxPort: input.mailboxPort,
      requestId: `${input.requestId}:${item.id}:payload`,
    });
    if (payload.status === "blocked") {
      const reasonCode = `payload.${payload.code}`;
      if (payload.retryable && itemIsDurablyConsumedReplay) {
        nextState = recordHostedMailboxTerminalSkip({
          item,
          lane,
          now: now(),
          reasonCode,
          state: nextState,
        });
        expectedSeqByLane[lane] += 1n;
        continue;
      }
      blocked.push({
        itemId: item.id,
        lane,
        reasonCode,
        retryable: payload.retryable,
        seq: item.laneSeq,
      });
      if (payload.retryable) {
        nextRetryAt = earliestHostedMailboxRetryAt(nextRetryAt, computeHostedMailboxRetryAt(now()));
        stoppedLanes.add(lane);
        continue;
      }
      nextState = recordHostedMailboxImportQuarantine(nextState, {
        itemKind: item.kind,
        lane,
        occurredAt: now(),
        reasonCode,
        seq: item.laneSeq,
      });
      nextState = advanceHostedMailboxLaneWatermark(nextState, {
        lane,
        seq: item.laneSeq,
      }).state;
      expectedSeqByLane[lane] += 1n;
      continue;
    }

    const outcome = await input.importItem({
      durablyConsumed: itemIsDurablyConsumedReplay,
      ...(lane === "conversation"
        && !itemIsDurablyConsumedReplay
        && fetched.conversationUsageStatus === "low"
        ? { usageRunningLow: true as const }
        : {}),
      ...(lane === "conversation"
        && !itemIsDurablyConsumedReplay
        && fetched.groupRunningBit
        ? { groupRunningBit: fetched.groupRunningBit }
        : {}),
      item,
      payload,
      route,
    });
    if (outcome.status === "deferred") {
      const reasonCode = normalizeReasonCode(outcome.reasonCode, "import.deferred");
      if (
        itemIsDurablyConsumedReplay
        && reasonCode !== HOSTED_MAILBOX_ITEM_BUDGET_REASON_CODE
      ) {
        nextState = recordHostedMailboxTerminalSkip({
          item,
          lane,
          now: now(),
          reasonCode,
          state: nextState,
        });
        expectedSeqByLane[lane] += 1n;
        continue;
      }
      blocked.push({
        itemId: item.id,
        lane,
        reasonCode,
        retryable: true,
        seq: item.laneSeq,
      });
      nextRetryAt = earliestHostedMailboxRetryAt(nextRetryAt, computeHostedMailboxRetryAt(now()));
      stoppedLanes.add(lane);
      continue;
    }

    if (outcome.status === "blocked") {
      const reasonCode = normalizeReasonCode(outcome.reasonCode, "import.blocked");
      if (outcome.retryable && itemIsDurablyConsumedReplay) {
        nextState = recordHostedMailboxTerminalSkip({
          item,
          lane,
          now: now(),
          reasonCode,
          state: nextState,
        });
        expectedSeqByLane[lane] += 1n;
        continue;
      }
      blocked.push({
        itemId: item.id,
        lane,
        reasonCode,
        retryable: outcome.retryable,
        seq: item.laneSeq,
      });
      if (outcome.retryable) {
        nextRetryAt = earliestHostedMailboxRetryAt(nextRetryAt, computeHostedMailboxRetryAt(now()));
        stoppedLanes.add(lane);
        continue;
      }
      nextState = recordHostedMailboxImportQuarantine(nextState, {
        itemKind: item.kind,
        lane,
        occurredAt: now(),
        reasonCode,
        seq: item.laneSeq,
      });
      nextState = advanceHostedMailboxLaneWatermark(nextState, {
        lane,
        seq: item.laneSeq,
      }).state;
      expectedSeqByLane[lane] += 1n;
      continue;
    }

    nextState = advanceHostedMailboxLaneWatermark(nextState, {
      lane,
      seq: item.laneSeq,
    }).state;
    nextState = recordHostedMailboxImportStatus(nextState, {
      itemKind: item.kind,
      lane,
      occurredAt: now(),
      reasonCode: normalizeNullableReasonCode(outcome.reasonCode),
      seq: item.laneSeq,
      status: outcome.status,
    });
    if (outcome.status === "imported") {
      importedCount += 1;
      if (lane === "system") {
        importedSystemMailboxItemIds.push(item.id);
      }
      const replyableConversationInput =
        route.action === "import-conversation-message" && !itemIsDurablyConsumedReplay;
      if (replyableConversationInput) {
        conversationImportedCount += 1;
      }
      if (replyableConversationInput && outcome.assistantInputId) {
        assistantInputIds.push(outcome.assistantInputId);
        assistantInputRecords.push({
          assistantInputId: outcome.assistantInputId,
          causalSeq: item.causalSeq ?? null,
          ...(outcome.emailDeliveryContext
            ? { emailDeliveryContext: outcome.emailDeliveryContext }
            : {}),
          ...(outcome.linqDeliveryContext
            ? { linqDeliveryContext: outcome.linqDeliveryContext }
            : {}),
        });
      }
    }
    if ((outcome.status === "imported" || outcome.status === "skipped") && outcome.linqDeliveryContext) {
      latestLinqDeliveryContext = outcome.linqDeliveryContext;
      linqDeliveryContexts.push(outcome.linqDeliveryContext);
    }
    if (outcome.status === "imported" || outcome.status === "skipped") {
      conversationImportTiming = mergeHostedMailboxConversationImportTiming(
        conversationImportTiming,
        outcome.conversationImportTiming ?? null,
      );
    }
    if ((outcome.status === "imported" || outcome.status === "skipped") && outcome.emailDeliveryContext) {
      emailDeliveryContexts.push(outcome.emailDeliveryContext);
    }
    expectedSeqByLane[lane] += 1n;
  }

  if (nextRetryAt === null) {
    nextRetryAt = resolveHostedMailboxImmediateContinuationAt({
      fetched,
      lanes,
      nextState,
      now,
      stoppedLanes,
    });
  }

  return {
    assistantInputIds,
    ...(assistantInputRecords.length > 0 ? { assistantInputRecords } : {}),
    blocked,
    conversationImportedCount,
    consumedSeqByLane: serializeHostedMailboxConsumedSeqByLane(consumedSeqState),
    fetchedLanes: [...lanes],
    fetchedCount: fetched.items.length,
    importedCount,
    ...(importedSystemMailboxItemIds.length > 0 ? { importedSystemMailboxItemIds } : {}),
    ...(emailDeliveryContexts.length > 0 ? { emailDeliveryContexts } : {}),
    ...(latestLinqDeliveryContext ? { latestLinqDeliveryContext } : {}),
    ...(linqDeliveryContexts.length > 0 ? { linqDeliveryContexts } : {}),
    ...(conversationImportTiming ? { conversationImportTiming } : {}),
    ...(nextRetryAt ? { nextRetryAt } : {}),
    state: nextState,
  };
}

function mergeHostedMailboxConversationImportTiming(
  current: HostedMailboxConversationImportTiming | null,
  next: HostedMailboxConversationImportTiming | null,
): HostedMailboxConversationImportTiming | null {
  if (!next) {
    return current;
  }

  const merged: HostedMailboxConversationImportTiming = { ...(current ?? {}) };
  addHostedMailboxConversationImportTimingField(merged, "projectionPrepareMs", next.projectionPrepareMs);
  addHostedMailboxConversationImportTimingField(merged, "projectionImportMs", next.projectionImportMs);
  addHostedMailboxConversationImportTimingField(merged, "attachmentEvidenceMs", next.attachmentEvidenceMs);
  addHostedMailboxConversationImportTimingField(merged, "projectionTotalMs", next.projectionTotalMs);
  return Object.keys(merged).length > 0 ? merged : current;
}

function addHostedMailboxConversationImportTimingField(
  target: HostedMailboxConversationImportTiming,
  key: keyof HostedMailboxConversationImportTiming,
  value: number | undefined,
): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return;
  }

  target[key] = (target[key] ?? 0) + Math.trunc(value);
}

function isDurablyConsumedReplay(input: {
  consumedSeq: bigint;
  consumedSeqPresent: boolean;
  item: HostedMailboxItem;
  itemSeq: bigint;
}): boolean {
  // Two complementary consume signals, not redundant: consumedAt is the exact
  // per-item stamp (written early for accepted Linq replies and at the accepted
  // idle checkpoint for every other terminal conversation item); consumedSeq
  // is the checkpoint-derived contiguous replay floor. The exact stamp closes
  // the pre-checkpoint Linq window, while the floor lets retention and replay
  // advance safely across handled items without requiring every old row to
  // remain live forever.
  if (hasHostedMailboxItemConsumedAt(input.item)) {
    return true;
  }
  return input.consumedSeqPresent && input.itemSeq <= input.consumedSeq;
}

function hasHostedMailboxItemConsumedAt(item: HostedMailboxItem): boolean {
  return typeof item.consumedAt === "string" && item.consumedAt.trim().length > 0;
}

function recordHostedMailboxTerminalSkip(input: {
  item: HostedMailboxItem;
  lane: HostedMailboxLane;
  now: string;
  reasonCode: string;
  state: HostedMailboxImportState;
}): HostedMailboxImportState {
  let nextState = recordHostedMailboxImportStatus(input.state, {
    itemKind: input.item.kind,
    lane: input.lane,
    occurredAt: input.now,
    reasonCode: input.reasonCode,
    seq: input.item.laneSeq,
    status: "skipped",
  });
  nextState = advanceHostedMailboxLaneWatermark(nextState, {
    lane: input.lane,
    seq: input.item.laneSeq,
  }).state;

  return nextState;
}

function resolveRetiredMailboxSkipReason(
  action: HostedMailboxRoutePlan["action"],
): string | null {
  if (
    action === "import-vault-share-delivery"
    || action === "import-vault-share-revoke"
  ) {
    return HOSTED_MAILBOX_LEGACY_VAULT_SHARE_SKIP_REASON;
  }

  if (action === "skip-retired-mailbox-item") {
    return HOSTED_MAILBOX_RETIRED_NEWSLETTER_SKIP_REASON;
  }

  return null;
}

async function fetchHostedMailboxPrefix(input: {
  fetchSignal?: AbortSignal | null;
  lanes: readonly HostedMailboxLane[];
  limitPerLane: number;
  mailboxPort: HostedRuntimeMailboxPort;
  prefetch: HostedMailboxPrefixPrefetch | null;
  requestId: string;
  state: HostedMailboxImportState;
}): Promise<HostedMailboxFetchResponse> {
  if (input.prefetch && canUseHostedMailboxPrefixPrefetch({
    lanes: input.lanes,
    limitPerLane: input.limitPerLane,
    prefetch: input.prefetch,
    state: input.state,
  })) {
    try {
      return await input.prefetch.response;
    } catch (error) {
      if (input.prefetch.signal?.aborted) {
        throw error;
      }
      return await fetchHostedMailboxPrefixFromPort(input);
    }
  }

  return await fetchHostedMailboxPrefixFromPort(input);
}

function hasHostedMailboxSidecarPayload(item: HostedMailboxItem): boolean {
  return typeof item.payloadRef === "string" && item.payloadRef.trim().length > 0;
}

async function fetchHostedMailboxPrefixFromPort(input: {
  fetchSignal?: AbortSignal | null;
  lanes: readonly HostedMailboxLane[];
  limitPerLane: number;
  mailboxPort: HostedRuntimeMailboxPort;
  requestId: string;
  state: HostedMailboxImportState;
}): Promise<HostedMailboxFetchResponse> {
  const request = {
    cursorMode: "imported_seq" as const,
    lanes: input.lanes.map((lane) => ({
      importedSeq: input.state.watermarks[lane],
      lane,
    })),
    limitPerLane: input.limitPerLane,
    requestId: input.requestId,
  };
  const signal = input.fetchSignal ?? null;
  return await (signal
    ? input.mailboxPort.fetch(request, { signal })
    : input.mailboxPort.fetch(request));
}

function canUseHostedMailboxPrefixPrefetch(input: {
  lanes: readonly HostedMailboxLane[];
  limitPerLane: number;
  prefetch: HostedMailboxPrefixPrefetch;
  state: HostedMailboxImportState;
}): boolean {
  const prefetch = input.prefetch;
  if (prefetch.limitPerLane !== input.limitPerLane) {
    return false;
  }

  const prefetchedLanes = new Set(prefetch.lanes);
  if (!input.lanes.every((lane) => prefetchedLanes.has(lane))) {
    return false;
  }

  return input.lanes.every((lane) =>
    prefetch.importedSeqByLane[lane] === input.state.watermarks[lane]
  );
}

function selectHostedMailboxFetchResponseLanes(
  fetched: HostedMailboxFetchResponse,
  lanes: readonly HostedMailboxLane[],
): HostedMailboxFetchResponse {
  const requestedLanes = new Set(lanes);
  const selected = {
    ...fetched,
    items: fetched.items.filter((item) => requestedLanes.has(item.lane)),
    maxSeqByLane: fetched.maxSeqByLane.filter((entry) => requestedLanes.has(entry.lane)),
  };

  if (fetched.consumedSeqByLane === undefined) {
    return selected;
  }

  return {
    ...selected,
    consumedSeqByLane: fetched.consumedSeqByLane === null
      ? null
      : fetched.consumedSeqByLane.filter((entry) => requestedLanes.has(entry.lane)),
  };
}

function assertHostedMailboxFetchUser(input: {
  expectedUserId: string;
  fetched: HostedMailboxFetchResponse;
}): void {
  if (input.fetched.userId !== input.expectedUserId) {
    throw new HostedMailboxUserMismatchError({
      scope: "fetch_response",
    });
  }

  for (const item of input.fetched.items) {
    if (item.userId !== input.expectedUserId) {
      throw new HostedMailboxUserMismatchError({
        itemId: item.id,
        scope: "item",
      });
    }
  }
}

function readHostedMailboxFetchConsumedSeqState(
  fetched: HostedMailboxFetchResponse,
): {
  presentByLane: Record<HostedMailboxLane, boolean>;
  seqByLane: Record<HostedMailboxLane, bigint>;
} {
  // Missing/null consumedSeqByLane (older web responses) marks no item as
  // durably consumed. Rows below the local watermark are still ignored above so
  // a rolling deploy cannot wedge on a replay row from an older web fetcher.
  const presentByLane: Record<HostedMailboxLane, boolean> = {
    conversation: false,
    system: false,
  };
  const seqByLane: Record<HostedMailboxLane, bigint> = {
    conversation: 0n,
    system: 0n,
  };
  for (const entry of fetched.consumedSeqByLane ?? []) {
    if (entry.lane !== "conversation" && entry.lane !== "system") {
      continue;
    }
    presentByLane[entry.lane] = true;
    const seq = parseMailboxSeqForImportOrNull(entry.consumedSeq);
    if (seq !== null && seq > seqByLane[entry.lane]) {
      seqByLane[entry.lane] = seq;
    }
  }
  return {
    presentByLane,
    seqByLane,
  };
}

function readHostedMailboxFetchMaxSeqByLane(
  fetched: HostedMailboxFetchResponse,
): Record<HostedMailboxLane, bigint | null> {
  const maxSeqByLane: Record<HostedMailboxLane, bigint | null> = {
    conversation: null,
    system: null,
  };
  for (const entry of fetched.maxSeqByLane) {
    if (entry.lane !== "conversation" && entry.lane !== "system") {
      continue;
    }
    const maxSeq = parseMailboxSeqForImportOrNull(entry.maxSeq);
    const currentMaxSeq = maxSeqByLane[entry.lane];
    if (maxSeq !== null && (currentMaxSeq === null || maxSeq > currentMaxSeq)) {
      maxSeqByLane[entry.lane] = maxSeq;
    }
  }
  return maxSeqByLane;
}

function serializeHostedMailboxConsumedSeqByLane(input: {
  presentByLane: Record<HostedMailboxLane, boolean>;
  seqByLane: Record<HostedMailboxLane, bigint>;
}): Record<HostedMailboxLane, string | null> {
  return {
    conversation: input.presentByLane.conversation
      ? input.seqByLane.conversation.toString()
      : null,
    system: input.presentByLane.system
      ? input.seqByLane.system.toString()
      : null,
  };
}

function resolveHostedMailboxExpectedSeqByLane(input: {
  lanes: readonly HostedMailboxLane[];
  state: HostedMailboxImportState;
}): Record<HostedMailboxLane, bigint> {
  return Object.fromEntries(
    input.lanes.map((lane) => {
      const importedSeq = BigInt(input.state.watermarks[lane]);

      return [lane, importedSeq + 1n];
    }),
  ) as Record<HostedMailboxLane, bigint>;
}

function resolveHostedMailboxImmediateContinuationAt(input: {
  fetched: HostedMailboxFetchResponse;
  lanes: readonly HostedMailboxLane[];
  nextState: HostedMailboxImportState;
  now: () => string;
  stoppedLanes: ReadonlySet<HostedMailboxLane>;
}): string | null {
  const maxSeqByLane = readHostedMailboxFetchMaxSeqByLane(input.fetched);
  for (const lane of input.lanes) {
    if (input.stoppedLanes.has(lane)) {
      continue;
    }
    const maxSeq = maxSeqByLane[lane];
    const importedSeq = parseMailboxSeqForImportOrNull(input.nextState.watermarks[lane]);
    if (maxSeq !== null && importedSeq !== null && maxSeq > importedSeq) {
      return input.now();
    }
  }

  return null;
}

function shouldFastForwardHostedMailboxExpectedSeq(input: {
  consumedSeq: bigint;
  consumedSeqPresent: boolean;
  expectedSeq: bigint;
  itemSeq: bigint;
  processedConsumedReplayInBatch: boolean;
}): boolean {
  return input.itemSeq > input.expectedSeq
    && !input.processedConsumedReplayInBatch
    && input.consumedSeqPresent
    && input.expectedSeq <= input.consumedSeq + 1n
    && input.itemSeq <= input.consumedSeq + 1n;
}

function groupMailboxItemsByLane(
  items: readonly HostedMailboxItem[],
): Record<(typeof HOSTED_MAILBOX_LANES)[number], HostedMailboxItem[]> {
  const grouped = {
    conversation: [] as HostedMailboxItem[],
    system: [] as HostedMailboxItem[],
  };

  for (const item of items) {
    if (item.lane === "conversation" || item.lane === "system") {
      grouped[item.lane].push(item);
    }
  }

  return grouped;
}

function interleaveMailboxItemsByLane(
  lanes: readonly HostedMailboxLane[],
  itemsByLane: Record<HostedMailboxLane, HostedMailboxItem[]>,
): Array<{ lane: HostedMailboxLane; item: HostedMailboxItem }> {
  const ordered: Array<{ lane: HostedMailboxLane; item: HostedMailboxItem }> = [];
  const maxItems = lanes.reduce(
    (max, lane) => Math.max(max, itemsByLane[lane]?.length ?? 0),
    0,
  );

  for (let index = 0; index < maxItems; index += 1) {
    for (const lane of lanes) {
      const item = itemsByLane[lane]?.[index];
      if (item) {
        ordered.push({ item, lane });
      }
    }
  }

  return ordered;
}

function parseMailboxSeqForImportOrNull(value: string): bigint | null {
  return /^(?:0|[1-9][0-9]*)$/u.test(value) ? BigInt(value) : null;
}

function normalizeSeqForStatus(value: string): string | null {
  return /^(?:0|[1-9][0-9]*)$/u.test(value) ? value : null;
}

function normalizeNullableReasonCode(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return normalizeReasonCode(value, null);
}

function normalizeReasonCode(value: string, fallback: string): string;
function normalizeReasonCode(value: string, fallback: null): string | null;
function normalizeReasonCode(value: string, fallback: string | null): string | null {
  const normalized = value.trim();
  if (/^[a-z][a-z0-9._-]{0,95}$/u.test(normalized)) {
    return normalized;
  }

  return fallback;
}

function computeHostedMailboxRetryAt(nowIso: string): string {
  const nowMs = Date.parse(nowIso);
  const baseMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(baseMs + HOSTED_MAILBOX_RETRYABLE_BLOCK_RETRY_DELAY_MS).toISOString();
}

function earliestHostedMailboxRetryAt(
  left: string | null,
  right: string | null,
): string | null {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs)) {
    return right;
  }
  if (!Number.isFinite(rightMs)) {
    return left;
  }
  return rightMs < leftMs ? right : left;
}
