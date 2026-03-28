import { ExecutionOutboxStatus } from "@prisma/client";
import { HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION } from "@murph/hosted-execution";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExecutionOutbox, PrismaClient } from "@prisma/client";
import type { HostedExecutionDispatchRequest, HostedExecutionDispatchResult } from "@murph/hosted-execution";

const mocks = vi.hoisted(() => ({
  dispatchHostedExecutionStatus: vi.fn(),
  finalizeHostedShareAcceptance: vi.fn(),
  hydrateHostedExecutionDispatch: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/dispatch", () => ({
  dispatchHostedExecutionStatus: mocks.dispatchHostedExecutionStatus,
}));

vi.mock("@/src/lib/hosted-execution/hydration", () => ({
  hydrateHostedExecutionDispatch: mocks.hydrateHostedExecutionDispatch,
}));

vi.mock("@/src/lib/hosted-share/shared", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-share/shared")>("@/src/lib/hosted-share/shared");

  return {
    ...actual,
    finalizeHostedShareAcceptance: mocks.finalizeHostedShareAcceptance,
  };
});

import { drainHostedExecutionOutbox } from "@/src/lib/hosted-execution/outbox";

describe("drainHostedExecutionOutbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks completed outcomes as completed, stores the dispatch result, and finalizes hosted share imports", async () => {
    const dispatch = createShareDispatch();
    const dispatchResult = createDispatchResult("completed");
    const prisma = createOutboxPrisma(createOutboxRecord({
      eventId: dispatch.eventId,
      eventKind: dispatch.event.kind,
      sourceType: "hosted_share_link",
      userId: dispatch.event.userId,
    }));
    mocks.hydrateHostedExecutionDispatch.mockResolvedValue(dispatch);
    mocks.dispatchHostedExecutionStatus.mockResolvedValue(dispatchResult);

    const [record] = await drainHostedExecutionOutbox({
      now: "2026-03-28T11:00:00.000Z",
      prisma,
    });

    expect(record?.status).toBe(ExecutionOutboxStatus.completed);
    expect(record?.lastStatusJson).toEqual(dispatchResult);
    expect(mocks.finalizeHostedShareAcceptance).toHaveBeenCalledWith({
      eventId: dispatch.eventId,
      memberId: dispatch.event.userId,
      prisma,
      shareCode: "share-code",
    });
  });

  it("treats duplicate consumed outcomes as completed without requiring hosted-share finalization", async () => {
    const dispatch = createTickDispatch();
    const prisma = createOutboxPrisma(createOutboxRecord({
      eventId: dispatch.eventId,
      eventKind: dispatch.event.kind,
      sourceType: "device_sync",
      userId: dispatch.event.userId,
    }));
    mocks.hydrateHostedExecutionDispatch.mockResolvedValue(dispatch);
    mocks.dispatchHostedExecutionStatus.mockResolvedValue(createDispatchResult("duplicate_consumed"));

    const [record] = await drainHostedExecutionOutbox({
      now: "2026-03-28T11:00:00.000Z",
      prisma,
    });

    expect(record?.status).toBe(ExecutionOutboxStatus.completed);
    expect(mocks.finalizeHostedShareAcceptance).not.toHaveBeenCalled();
  });

  it.each([
    ["queued", ExecutionOutboxStatus.accepted, null],
    ["duplicate_pending", ExecutionOutboxStatus.accepted, null],
    ["backpressured", ExecutionOutboxStatus.pending, "runner full"],
  ] as const)(
    "maps %s outcomes onto the right retry status",
    async (eventState, expectedStatus, lastError) => {
      const dispatch = createTickDispatch();
      const prisma = createOutboxPrisma(createOutboxRecord({
        eventId: dispatch.eventId,
        eventKind: dispatch.event.kind,
        userId: dispatch.event.userId,
      }));
      mocks.hydrateHostedExecutionDispatch.mockResolvedValue(dispatch);
      mocks.dispatchHostedExecutionStatus.mockResolvedValue(createDispatchResult(eventState, {
        eventLastError: lastError,
      }));

      const [record] = await drainHostedExecutionOutbox({
        now: "2026-03-28T11:00:00.000Z",
        prisma,
      });

      expect(record?.status).toBe(expectedStatus);
      expect(record?.lastStatusJson).toEqual(createDispatchResult(eventState, {
        eventLastError: lastError,
      }));
    },
  );

  it("keeps not-configured queued outcomes pending", async () => {
    const dispatch = createTickDispatch();
    const dispatchResult = createDispatchResult("queued", {
      statusLastError: "Hosted execution dispatch is not configured.",
    });
    const prisma = createOutboxPrisma(createOutboxRecord({
      eventId: dispatch.eventId,
      eventKind: dispatch.event.kind,
      userId: dispatch.event.userId,
    }));
    mocks.hydrateHostedExecutionDispatch.mockResolvedValue(dispatch);
    mocks.dispatchHostedExecutionStatus.mockResolvedValue(dispatchResult);

    const [record] = await drainHostedExecutionOutbox({
      now: "2026-03-28T11:00:00.000Z",
      prisma,
    });

    expect(record?.status).toBe(ExecutionOutboxStatus.pending);
    expect(record?.lastError).toBe("Hosted execution dispatch is not configured.");
  });

  it("marks poisoned outcomes as failed and prefers the event-level error", async () => {
    const dispatch = createTickDispatch();
    const dispatchResult = createDispatchResult("poisoned", {
      eventLastError: "poisoned by runner",
      statusLastError: "global fallback",
    });
    const prisma = createOutboxPrisma(createOutboxRecord({
      eventId: dispatch.eventId,
      eventKind: dispatch.event.kind,
      userId: dispatch.event.userId,
    }));
    mocks.hydrateHostedExecutionDispatch.mockResolvedValue(dispatch);
    mocks.dispatchHostedExecutionStatus.mockResolvedValue(dispatchResult);

    const [record] = await drainHostedExecutionOutbox({
      now: "2026-03-28T11:00:00.000Z",
      prisma,
    });

    expect(record?.status).toBe(ExecutionOutboxStatus.failed);
    expect(record?.lastError).toBe("poisoned by runner");
  });
});

function createTickDispatch(): HostedExecutionDispatchRequest {
  return {
    event: {
      kind: "assistant.cron.tick",
      reason: "manual",
      userId: "member_123",
    },
    eventId: "evt_tick",
    occurredAt: "2026-03-28T11:00:00.000Z",
  };
}

function createShareDispatch(): HostedExecutionDispatchRequest {
  return {
    event: {
      kind: "vault.share.accepted",
      share: {
        shareCode: "share-code",
        shareId: "share_123",
      },
      userId: "member_123",
    },
    eventId: "evt_share",
    occurredAt: "2026-03-28T11:00:00.000Z",
  };
}

function createDispatchResult(
  eventState: HostedExecutionDispatchResult["event"]["state"],
  input: {
    eventLastError?: string | null;
    statusLastError?: string | null;
  } = {},
): HostedExecutionDispatchResult {
  return {
    event: {
      eventId: "evt_tick",
      lastError: input.eventLastError ?? null,
      state: eventState,
      userId: "member_123",
    },
    status: {
      backpressuredEventIds: eventState === "backpressured" ? ["evt_tick"] : [],
      bundleRefs: {
        agentState: null,
        vault: null,
      },
      inFlight: false,
      lastError: input.statusLastError ?? null,
      lastEventId: "evt_tick",
      lastRunAt: null,
      nextWakeAt: null,
      pendingEventCount: eventState === "queued" || eventState === "duplicate_pending" ? 1 : 0,
      poisonedEventIds: [],
      retryingEventId: null,
      userId: "member_123",
    },
  };
}

function createOutboxRecord(input: {
  eventId: string;
  eventKind: string;
  sourceType?: string;
  userId: string;
}): ExecutionOutbox {
  return {
    acceptedAt: null,
    attemptCount: 0,
    claimExpiresAt: null,
    claimToken: null,
    completedAt: null,
    createdAt: new Date("2026-03-28T11:00:00.000Z"),
    eventId: input.eventId,
    eventKind: input.eventKind,
    failedAt: null,
    id: "execout_123",
    lastAttemptAt: null,
    lastError: null,
    lastStatusJson: null,
    nextAttemptAt: new Date("2026-03-28T11:00:00.000Z"),
    payloadJson: {
      schemaVersion: HOSTED_EXECUTION_OUTBOX_PAYLOAD_SCHEMA_VERSION,
    },
    sourceId: input.sourceType === "hosted_share_link" ? "share_123" : null,
    sourceType: input.sourceType ?? "hosted_execution",
    status: ExecutionOutboxStatus.pending,
    updatedAt: new Date("2026-03-28T11:00:00.000Z"),
    userId: input.userId,
  };
}

function createOutboxPrisma(record: ExecutionOutbox): PrismaClient {
  let current = structuredClone(record);

  return {
    executionOutbox: {
      findMany: vi.fn(async () => [structuredClone(current)]),
      findUnique: vi.fn(async ({ where }: { where: { eventId: string } }) =>
        where.eventId === current.eventId ? structuredClone(current) : null),
      updateMany: vi.fn(async ({ where, data }: {
        data: Record<string, unknown>;
        where: Record<string, unknown>;
      }) => {
        if (where.id !== current.id) {
          return { count: 0 };
        }

        if ("claimToken" in where && where.claimToken !== current.claimToken) {
          return { count: 0 };
        }

        if ("status" in where && where.status !== current.status) {
          return { count: 0 };
        }

        if ("nextAttemptAt" in where && where.nextAttemptAt && current.nextAttemptAt > (where.nextAttemptAt as Date)) {
          return { count: 0 };
        }

        current = {
          ...current,
          ...data,
          attemptCount:
            typeof data.attemptCount === "object" && data.attemptCount && "increment" in (data.attemptCount as Record<string, unknown>)
              ? current.attemptCount + Number((data.attemptCount as { increment: number }).increment)
              : (data.attemptCount as number | undefined) ?? current.attemptCount,
          updatedAt: new Date("2026-03-28T11:00:00.000Z"),
        };

        return { count: 1 };
      }),
    },
  } as unknown as PrismaClient;
}
