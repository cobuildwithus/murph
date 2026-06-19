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

const HOSTED_MAILBOX_RETRYABLE_BLOCK_RETRY_DELAY_MS = 15 * 1000;

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
      linqDeliveryContext?: HostedAssistantLinqDeliveryContext | null;
      reasonCode?: string | null;
      afterCheckpoint?: HostedMailboxPostCheckpointEffect | null;
    };

export interface HostedMailboxPostCheckpointEffectResult {
  kind: "inbox_projection";
  projectionUpdated: boolean | null;
  attachmentEvidenceUpdated: boolean | null;
  status: "succeeded" | "failed" | "partial";
  reasonCode: string | null;
}

export type HostedMailboxPostCheckpointEffect = () =>
  Promise<HostedMailboxPostCheckpointEffectResult>;

export interface HostedMailboxResolvedImportItem {
  // True when the durable consumed watermark from the mailbox fetch response
  // already covers this item's laneSeq: the item is a replay of an
  // already-handled message and must stay conversation context only, never a
  // fresh reply candidate.
  durablyConsumed?: boolean;
  item: HostedMailboxItem;
  payload: Extract<HostedMailboxPayloadResolutionResult, { status: "resolved" }>;
  route: HostedMailboxRoutePlan;
}

export interface HostedMailboxImportLoopResult {
  assistantInputIds?: string[];
  blocked: HostedMailboxImportLoopBlockedItem[];
  conversationCoverage?: HostedMailboxConversationCoverageEntry[];
  conversationImportedCount?: number;
  consumedSeqByLane: Record<HostedMailboxLane, string | null>;
  fetchedCount: number;
  importedCount: number;
  latestLinqDeliveryContext?: HostedAssistantLinqDeliveryContext | null;
  nextRetryAt?: string | null;
  state: HostedMailboxImportState;
}

export interface HostedMailboxImportLoopBlockedItem {
  itemId: string | null;
  lane: string;
  reasonCode: string;
  retryable: boolean;
  seq: string | null;
}

export type HostedMailboxConversationCoverageDisposition =
  | "assistant_input"
  | "terminal_skip";

export interface HostedMailboxConversationCoverageEntry {
  assistantInputId?: string | null;
  disposition: HostedMailboxConversationCoverageDisposition;
  laneSeq: string;
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
  let response: Promise<HostedMailboxFetchResponse>;
  try {
    response = input.mailboxPort.fetch(request);
  } catch (error) {
    response = Promise.reject(error);
  }
  void response.catch(() => undefined);

  return {
    importedSeqByLane,
    lanes,
    limitPerLane: input.limitPerLane,
    response,
  };
}

export async function fetchAndProcessHostedMailboxPrefix(input: {
  deferConversationUntil?: HostedMailboxConversationDeferral | null;
  expectedUserId: string;
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
  const fetched = await fetchHostedMailboxPrefix({
    lanes,
    limitPerLane: input.limitPerLane,
    mailboxPort: input.mailboxPort,
    prefetch: input.prefetch ?? null,
    requestId: input.requestId,
    state: input.state,
  });
  assertHostedMailboxFetchUser({
    expectedUserId: input.expectedUserId,
    fetched,
  });
  const itemsByLane = groupMailboxItemsByLane(fetched.items);
  const consumedSeqState = readHostedMailboxFetchConsumedSeqState(fetched);
  const consumedSeqByLane = consumedSeqState.seqByLane;
  let nextState = input.state;
  const assistantInputIds: string[] = [];
  const conversationCoverage: HostedMailboxConversationCoverageEntry[] = [];
  let conversationImportedCount = 0;
  let importedCount = 0;
  const blocked: HostedMailboxImportLoopBlockedItem[] = [];
  let latestLinqDeliveryContext: HostedAssistantLinqDeliveryContext | null = null;
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
      && isDurablyConsumedConversationReplay({
        consumedSeq: consumedSeqByLane[lane],
        consumedSeqPresent: consumedSeqState.presentByLane[lane],
        itemSeq,
        lane,
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
      nextState = recordHostedMailboxImportQuarantine(nextState, {
        itemKind: item.kind,
        lane,
        occurredAt: now(),
        reasonCode: `route.${route.quarantineCode}`,
        seq: normalizeSeqForStatus(item.laneSeq),
      });
      blocked.push({
        itemId: item.id,
        lane,
        reasonCode: `route.${route.quarantineCode}`,
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
      appendHostedMailboxConversationCoverage(conversationCoverage, {
        disposition: "terminal_skip",
        itemSeq,
        lane,
      });
      expectedSeqByLane[lane] += 1n;
      continue;
    }

    if (itemSeq === null) {
      throw new TypeError("Hosted mailbox routed seq must be a valid decimal string.");
    }

    const payload = await resolveHostedMailboxItemPayload({
      item,
      mailboxPort: input.mailboxPort,
      requestId: `${input.requestId}:${item.id}:payload`,
    });
    if (payload.status === "blocked") {
      const reasonCode = `payload.${payload.code}`;
      if (payload.retryable && itemIsDurablyConsumedReplay) {
        nextState = recordHostedMailboxDurablyConsumedReplaySkip({
          conversationCoverage,
          item,
          itemSeq,
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
      appendHostedMailboxConversationCoverage(conversationCoverage, {
        disposition: "terminal_skip",
        itemSeq,
        lane,
      });
      expectedSeqByLane[lane] += 1n;
      continue;
    }

    const outcome = await input.importItem({
      durablyConsumed: itemSeq <= consumedSeqByLane[lane],
      item,
      payload,
      route,
    });
    if (outcome.status === "deferred") {
      const reasonCode = normalizeReasonCode(outcome.reasonCode, "import.deferred");
      if (itemIsDurablyConsumedReplay) {
        nextState = recordHostedMailboxDurablyConsumedReplaySkip({
          conversationCoverage,
          item,
          itemSeq,
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
        nextState = recordHostedMailboxDurablyConsumedReplaySkip({
          conversationCoverage,
          item,
          itemSeq,
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
      appendHostedMailboxConversationCoverage(conversationCoverage, {
        disposition: "terminal_skip",
        itemSeq,
        lane,
      });
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
      const replyableConversationInput =
        route.action === "import-conversation-message" && itemSeq > consumedSeqByLane[lane];
      if (replyableConversationInput) {
        conversationImportedCount += 1;
      }
      if (replyableConversationInput && outcome.assistantInputId) {
        assistantInputIds.push(outcome.assistantInputId);
      }
    }
    if (outcome.assistantInputId || outcome.status === "skipped") {
      appendHostedMailboxConversationCoverage(conversationCoverage, {
        assistantInputId: outcome.assistantInputId ?? null,
        disposition: outcome.assistantInputId ? "assistant_input" : "terminal_skip",
        itemSeq,
        lane,
      });
    }
    if ((outcome.status === "imported" || outcome.status === "skipped") && outcome.linqDeliveryContext) {
      latestLinqDeliveryContext = outcome.linqDeliveryContext;
    }
    expectedSeqByLane[lane] += 1n;
  }

  return {
    assistantInputIds,
    blocked,
    conversationCoverage,
    conversationImportedCount,
    consumedSeqByLane: serializeHostedMailboxConsumedSeqByLane(consumedSeqState),
    fetchedCount: fetched.items.length,
    importedCount,
    ...(latestLinqDeliveryContext ? { latestLinqDeliveryContext } : {}),
    ...(nextRetryAt ? { nextRetryAt } : {}),
    state: nextState,
  };
}

function isDurablyConsumedConversationReplay(input: {
  consumedSeq: bigint;
  consumedSeqPresent: boolean;
  itemSeq: bigint;
  lane: HostedMailboxLane;
}): boolean {
  return input.lane === "conversation"
    && input.consumedSeqPresent
    && input.itemSeq <= input.consumedSeq;
}

function recordHostedMailboxDurablyConsumedReplaySkip(input: {
  conversationCoverage: HostedMailboxConversationCoverageEntry[];
  item: HostedMailboxItem;
  itemSeq: bigint;
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
  appendHostedMailboxConversationCoverage(input.conversationCoverage, {
    disposition: "terminal_skip",
    itemSeq: input.itemSeq,
    lane: input.lane,
  });

  return nextState;
}

function appendHostedMailboxConversationCoverage(
  entries: HostedMailboxConversationCoverageEntry[],
  input: {
    assistantInputId?: string | null;
    disposition: HostedMailboxConversationCoverageDisposition;
    itemSeq: bigint;
    lane: HostedMailboxLane;
  },
): void {
  if (input.lane !== "conversation") {
    return;
  }

  entries.push({
    ...(input.assistantInputId ? { assistantInputId: input.assistantInputId } : {}),
    disposition: input.disposition,
    laneSeq: input.itemSeq.toString(),
  });
}

async function fetchHostedMailboxPrefix(input: {
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
    } catch {
      return await fetchHostedMailboxPrefixFromPort(input);
    }
  }

  return await fetchHostedMailboxPrefixFromPort(input);
}

function hasHostedMailboxSidecarPayload(item: HostedMailboxItem): boolean {
  return typeof item.payloadRef === "string" && item.payloadRef.trim().length > 0;
}

async function fetchHostedMailboxPrefixFromPort(input: {
  lanes: readonly HostedMailboxLane[];
  limitPerLane: number;
  mailboxPort: HostedRuntimeMailboxPort;
  requestId: string;
  state: HostedMailboxImportState;
}): Promise<HostedMailboxFetchResponse> {
  return await input.mailboxPort.fetch({
    cursorMode: "imported_seq",
    lanes: input.lanes.map((lane) => ({
      importedSeq: input.state.watermarks[lane],
      lane,
    })),
    limitPerLane: input.limitPerLane,
    requestId: input.requestId,
  });
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

  if (!sameHostedMailboxLaneSet(prefetch.lanes, input.lanes)) {
    return false;
  }

  return input.lanes.every((lane) =>
    prefetch.importedSeqByLane[lane] === input.state.watermarks[lane]
  );
}

function sameHostedMailboxLaneSet(
  left: readonly HostedMailboxLane[],
  right: readonly HostedMailboxLane[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const rightSet = new Set(right);
  return left.every((lane) => rightSet.has(lane));
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
