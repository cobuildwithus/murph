import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedThreadRouteEgressAuthority: vi.fn(),
  decodeHostedMailboxStoredPayload: vi.fn(),
  getPrisma: vi.fn(),
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  decodeHostedMailboxStoredPayload: mocks.decodeHostedMailboxStoredPayload,
}));

vi.mock("@/src/lib/hosted-routing/thread-route-store", () => ({
  assertHostedThreadRouteEgressAuthority:
    mocks.assertHostedThreadRouteEgressAuthority,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

import type {
  HostedRuntimeManagedGroupActivityDecisionRequest,
} from "@murphai/hosted-execution/runtime-control";
import {
  evaluateHostedManagedGroupActivityMailboxRows,
  readHostedManagedGroupActivityDecision,
  type ManagedGroupActivityMailboxRow,
} from "@/src/lib/hosted-groups/managed-group-activity-decision";

const MEMBER_ID = "member_group_runtime";
const ROUTE_TARGET = "group-thread-1";
const OCCURRENCE_AT = "2026-07-26T22:00:00.000Z";
const WINDOW_START_AT = "2026-07-19T22:00:00.000Z";

const request: HostedRuntimeManagedGroupActivityDecisionRequest = {
  occurrenceAt: OCCURRENCE_AT,
  policy: "group-sunday-superlatives-v1",
  route: {
    channel: "linq",
    target: ROUTE_TARGET,
  },
  timeZone: "America/New_York",
};

function buildRow(input: {
  createdAt?: string;
  id: string;
  occurredAt?: string;
}): ManagedGroupActivityMailboxRow {
  const occurredAt = input.occurredAt ?? "2026-07-20T12:00:00.000Z";
  return {
    createdAt: new Date(input.createdAt ?? occurredAt),
    dedupeKey: `dedupe:${input.id}`,
    id: input.id,
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: BigInt(input.id.replace(/\D/gu, "") || "1"),
    occurredAt: new Date(occurredAt),
    payload: null,
    payloadInlineCiphertext: "ciphertext",
    payloadSchema: "murph.hosted-mailbox-item-payload.v1",
    userId: MEMBER_ID,
  };
}

function buildLinqWake(row: ManagedGroupActivityMailboxRow, input: {
  affirmativeReaction?: true;
  from?: string;
  isFromMe?: boolean;
  target?: string;
} = {}) {
  const target = input.target ?? ROUTE_TARGET;
  return {
    eventId: `event:${row.id}`,
    kind: "conversation.message",
    message: {
      accountLookupKey: "hbidx:phone:v1:account",
      channel: "linq",
      contactKind: "phone",
      contactLookupKey: "hbidx:phone:v1:sender",
      linqMessage: {
        ...(input.affirmativeReaction === true
          ? { affirmativeReaction: true }
          : {}),
        chatId: target,
        from: input.from ?? "+15550001111",
        isFromMe: input.isFromMe ?? false,
        messageId: `message:${row.id}`,
        parts: [{ type: "text", value: "private message content" }],
        threadIsDirect: false,
      },
      routeAuthority: {
        accountLookupKey: "hbidx:phone:v1:account",
        channel: "linq",
        containerMemberId: MEMBER_ID,
        threadId: target,
      },
    },
    occurredAt: row.occurredAt.toISOString(),
    userId: MEMBER_ID,
  };
}

function buildTelegramWake(row: ManagedGroupActivityMailboxRow) {
  return {
    eventId: `event:${row.id}`,
    kind: "conversation.message",
    message: {
      channel: "telegram",
      routeAuthority: {
        channel: "telegram",
        containerMemberId: MEMBER_ID,
        threadId: ROUTE_TARGET,
      },
      telegramMessage: {
        from: "1234567890",
        messageId: `message:${row.id}`,
        schema: "murph.hosted-telegram-message.v1",
        senderUsername: "private_username",
        text: "private message content",
        threadId: ROUTE_TARGET,
        threadIsDirect: false,
      },
    },
    occurredAt: row.occurredAt.toISOString(),
    userId: MEMBER_ID,
  };
}

async function evaluate(input: {
  request?: HostedRuntimeManagedGroupActivityDecisionRequest;
  rows: ManagedGroupActivityMailboxRow[];
  wakeForRow?: (row: ManagedGroupActivityMailboxRow) => unknown | null;
}) {
  return await evaluateHostedManagedGroupActivityMailboxRows({
    decodePayload: async (row) =>
      input.wakeForRow ? input.wakeForRow(row) : buildLinqWake(row),
    memberId: MEMBER_ID,
    request: input.request ?? request,
    rows: input.rows,
  });
}

describe("managed group activity decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires the callback member to be the exact synthetic group runtime", async () => {
    const findMany = vi.fn();
    const findUnique = vi.fn().mockResolvedValue(null);
    mocks.getPrisma.mockReturnValue({
      hostedGroup: { findUnique },
      hostedMailboxItem: { findMany },
    });

    await expect(readHostedManagedGroupActivityDecision({
      memberId: MEMBER_ID,
      request,
    })).resolves.toEqual({ status: "unavailable" });
    expect(findUnique).toHaveBeenCalledWith({
      select: { id: true },
      where: { runtimeMemberId: MEMBER_ID },
    });
    expect(mocks.assertHostedThreadRouteEgressAuthority).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("proves the exact 99/100 canonical envelope threshold without returning a count", async () => {
    const ninetyNine = Array.from({ length: 99 }, (_, index) =>
      buildRow({ id: `row-${index + 1}` }));
    await expect(evaluate({ rows: ninetyNine })).resolves.toEqual({
      status: "ineligible",
    });

    const oneHundred = [...ninetyNine, buildRow({ id: "row-100" })];
    const result = await evaluate({ rows: oneHundred });
    expect(result).toEqual({ status: "eligible" });
    expect(Object.keys(result)).toEqual(["status"]);
    expect(JSON.stringify(result)).not.toContain("private message content");
    expect(JSON.stringify(result)).not.toContain(ROUTE_TARGET);
    expect(JSON.stringify(result)).not.toContain("100");
  });

  it("uses an inclusive window start and exclusive occurrence/commit boundary", async () => {
    const base = Array.from({ length: 99 }, (_, index) =>
      buildRow({ id: `base-${index + 1}` }));
    await expect(evaluate({
      rows: [...base, buildRow({
        id: "window-start",
        occurredAt: WINDOW_START_AT,
      })],
    })).resolves.toEqual({ status: "eligible" });

    await expect(evaluate({
      rows: [...base, buildRow({
        id: "occurrence-boundary",
        occurredAt: OCCURRENCE_AT,
      })],
    })).resolves.toEqual({ status: "ineligible" });

    await expect(evaluate({
      rows: [...base, buildRow({
        createdAt: OCCURRENCE_AT,
        id: "commit-boundary",
      })],
    })).resolves.toEqual({ status: "ineligible" });
  });

  it("excludes Linq from-me, reaction-only, and inexact-route envelopes", async () => {
    const base = Array.from({ length: 99 }, (_, index) =>
      buildRow({ id: `base-${index + 1}` }));
    for (const [id, wakeForRow] of [
      ["from-me", (row: ManagedGroupActivityMailboxRow) =>
        buildLinqWake(row, { isFromMe: true })],
      ["reaction", (row: ManagedGroupActivityMailboxRow) =>
        buildLinqWake(row, { affirmativeReaction: true })],
      ["wrong-route", (row: ManagedGroupActivityMailboxRow) =>
        buildLinqWake(row, { target: "another-thread" })],
    ] as const) {
      await expect(evaluate({
        rows: [...base, buildRow({ id })],
        wakeForRow: (row) => row.id === id ? wakeForRow(row) : buildLinqWake(row),
      })).resolves.toEqual({ status: "ineligible" });
    }
  });

  it("counts authenticated non-direct Telegram envelopes", async () => {
    const telegramRequest: HostedRuntimeManagedGroupActivityDecisionRequest = {
      ...request,
      route: { channel: "telegram", target: ROUTE_TARGET },
    };
    const rows = Array.from({ length: 100 }, (_, index) =>
      buildRow({ id: `telegram-${index + 1}` }));
    await expect(evaluate({
      request: telegramRequest,
      rows,
      wakeForRow: buildTelegramWake,
    })).resolves.toEqual({ status: "eligible" });
  });

  it("fails closed on unreadable payloads and scan exhaustion without logging private data", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unreadable = buildRow({ id: "unreadable" });
    await expect(evaluate({
      rows: [unreadable],
      wakeForRow: () => null,
    })).resolves.toEqual({ status: "unavailable" });

    const overScanBound = Array.from({ length: 2_001 }, (_, index) =>
      buildRow({ id: `wrong-route-${index + 1}` }));
    await expect(evaluate({
      rows: overScanBound,
      wakeForRow: (row) => buildLinqWake(row, { target: "another-thread" }),
    })).resolves.toEqual({ status: "unavailable" });
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
