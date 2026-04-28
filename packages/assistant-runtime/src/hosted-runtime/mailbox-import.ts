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
      reasonCode?: string | null;
      afterCheckpoint?: (() => Promise<void>) | null;
      afterCheckpointBeforeAssistant?: (() => Promise<void>) | null;
    };

export interface HostedMailboxResolvedImportItem {
  item: HostedMailboxItem;
  payload: Extract<HostedMailboxPayloadResolutionResult, { status: "resolved" }>;
  route: HostedMailboxRoutePlan;
}

export interface HostedMailboxImportLoopResult {
  blocked: HostedMailboxImportLoopBlockedItem[];
  fetchedCount: number;
  importedCount: number;
  state: HostedMailboxImportState;
}

export interface HostedMailboxImportLoopBlockedItem {
  itemId: string | null;
  lane: string;
  reasonCode: string;
  retryable: boolean;
  seq: string | null;
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

export async function fetchAndProcessHostedMailboxPrefix(input: {
  expectedUserId: string;
  importItem(item: HostedMailboxResolvedImportItem): Promise<HostedMailboxItemImportOutcome>;
  lanes?: readonly HostedMailboxLane[];
  limitPerLane: number;
  mailboxPort: HostedRuntimeMailboxPort;
  now?: () => string;
  requestId: string;
  state: HostedMailboxImportState;
}): Promise<HostedMailboxImportLoopResult> {
  const now = input.now ?? (() => new Date().toISOString());
  const lanes = input.lanes ?? HOSTED_MAILBOX_LANES;
  const fetched = await input.mailboxPort.fetch({
    lanes: lanes.map((lane) => ({
      importedSeq: input.state.watermarks[lane],
      lane,
    })),
    limitPerLane: input.limitPerLane,
    requestId: input.requestId,
  });
  assertHostedMailboxFetchUser({
    expectedUserId: input.expectedUserId,
    fetched,
  });
  const itemsByLane = groupMailboxItemsByLane(fetched.items);
  let nextState = input.state;
  let importedCount = 0;
  const blocked: HostedMailboxImportLoopBlockedItem[] = [];

  for (const lane of lanes) {
    let expectedSeq = BigInt(nextState.watermarks[lane]) + 1n;

    for (const item of itemsByLane[lane]) {
      const route = createHostedMailboxRoutingPlan(item);
      const itemSeq = parseMailboxSeqForImportOrNull(item.laneSeq);

      if (itemSeq !== null && itemSeq !== expectedSeq) {
        blocked.push({
          itemId: item.id,
          lane,
          reasonCode: "lane.gap",
          retryable: true,
          seq: item.laneSeq,
        });
        break;
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
          break;
        }
        nextState = advanceHostedMailboxLaneWatermark(nextState, {
          lane,
          seq: item.laneSeq,
        }).state;
        expectedSeq += 1n;
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
        blocked.push({
          itemId: item.id,
          lane,
          reasonCode,
          retryable: payload.retryable,
          seq: item.laneSeq,
        });
        if (payload.retryable) {
          break;
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
        expectedSeq += 1n;
        continue;
      }

      const outcome = await input.importItem({
        item,
        payload,
        route,
      });
      if (outcome.status === "deferred") {
        blocked.push({
          itemId: item.id,
          lane,
          reasonCode: normalizeReasonCode(outcome.reasonCode, "import.deferred"),
          retryable: true,
          seq: item.laneSeq,
        });
        break;
      }

      if (outcome.status === "blocked") {
        const reasonCode = normalizeReasonCode(outcome.reasonCode, "import.blocked");
        blocked.push({
          itemId: item.id,
          lane,
          reasonCode,
          retryable: outcome.retryable,
          seq: item.laneSeq,
        });
        if (outcome.retryable) {
          break;
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
        expectedSeq += 1n;
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
      importedCount += outcome.status === "imported" ? 1 : 0;
      expectedSeq += 1n;
    }
  }

  return {
    blocked,
    fetchedCount: fetched.items.length,
    importedCount,
    state: nextState,
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
