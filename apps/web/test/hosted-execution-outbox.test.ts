import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExecutionOutbox, Prisma, PrismaClient } from "@prisma/client";
import type {
  HostedExecutionDispatchLifecycleState,
  HostedExecutionDispatchRequest,
  HostedExecutionDispatchResult,
} from "@murphai/hosted-execution";
import {
  readHostedExecutionOutboxPayload,
  serializeHostedExecutionOutboxPayload,
} from "@/src/lib/hosted-execution/outbox-payload";

const mocks = vi.hoisted(() => ({
  dispatchHostedExecutionStatus: vi.fn(),
  dispatchHostedExecutionStoredReferenceStatus: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/dispatch", () => ({
  dispatchHostedExecutionStatus: mocks.dispatchHostedExecutionStatus,
  dispatchHostedExecutionStoredReferenceStatus: mocks.dispatchHostedExecutionStoredReferenceStatus,
}));

import {
  drainHostedExecutionOutbox,
  enqueueHostedExecutionOutbox,
} from "@/src/lib/hosted-execution/outbox";

describe("hosted execution outbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists direct enqueue payloads inline even for events that previously used staged payload refs", async () => {
    const dispatch = createGatewaySendDispatch();
    const prisma = createEnqueueOutboxPrisma(createOutboxRecord(dispatch));

    const record = await enqueueHostedExecutionOutbox({
      dispatch,
      sourceType: "hosted_execution",
      tx: prisma as PrismaClient,
    });

    const payload = readHostedExecutionOutboxPayload(record.payloadJson);
    expect(payload).toEqual({
      dispatch,
      storage: "inline",
    });
  });

  it.each([
    ["queued", "queued", null, null],
    ["completed", "completed", null, null],
    ["poisoned", "poisoned", null, null],
    ["backpressured", "backpressured", "runner full", "2026-03-28T11:00:05.000Z"],
  ] as const)(
    "maps %s dispatch results onto the canonical lifecycle",
    async (eventState, expectedDispatchState, lastError, nextAttemptAt) => {
      const dispatch = createCronDispatch();
      const prisma = createOutboxPrisma(createOutboxRecord(dispatch));
      mocks.dispatchHostedExecutionStatus.mockResolvedValue(
        createDispatchResult(eventState, { eventLastError: lastError }),
      );

      const [record] = await drainHostedExecutionOutbox({
        now: "2026-03-28T11:00:00.000Z",
        prisma,
      });

      expect(record?.dispatchState).toBe(expectedDispatchState);
      expect(record?.lastError).toBe(lastError);
      expect(record?.nextAttemptAt?.toISOString() ?? null).toBe(nextAttemptAt);
    },
  );

  it("dispatches a legacy reference payload row through the compatibility worker path", async () => {
    const dispatch = createGatewaySendDispatch();
    const prisma = createOutboxPrisma(createOutboxRecord(dispatch, {
      payloadJson: {
        dispatchRef: {
          eventId: dispatch.eventId,
          eventKind: dispatch.event.kind,
          occurredAt: dispatch.occurredAt,
          userId: dispatch.event.userId,
        },
        stagedPayloadId: `staged/${dispatch.eventId}`,
        storage: "reference",
      },
    }));
    mocks.dispatchHostedExecutionStoredReferenceStatus.mockResolvedValue(
      createDispatchResult("completed", { eventId: dispatch.eventId }),
    );

    const [record] = await drainHostedExecutionOutbox({
      now: "2026-03-28T11:00:00.000Z",
      prisma,
    });

    expect(mocks.dispatchHostedExecutionStoredReferenceStatus).toHaveBeenCalledWith({
      dispatchRef: {
        eventId: dispatch.eventId,
        eventKind: dispatch.event.kind,
        occurredAt: dispatch.occurredAt,
        userId: dispatch.event.userId,
      },
      stagedPayloadId: `staged/${dispatch.eventId}`,
      storage: "reference",
    });
    expect(record?.dispatchState).toBe("completed");
    expect(record?.lastError).toBeNull();
    expect(record?.nextAttemptAt).toBeNull();
    expect(record?.payloadJson).toEqual({
      dispatchRef: {
        eventId: dispatch.eventId,
        eventKind: dispatch.event.kind,
        occurredAt: dispatch.occurredAt,
        userId: dispatch.event.userId,
      },
      stagedPayloadId: `staged/${dispatch.eventId}`,
      storage: "reference",
    });
    expect(mocks.dispatchHostedExecutionStatus).not.toHaveBeenCalled();
  });

  it("keeps legacy reference payload rows retryable when the compatibility worker call fails", async () => {
    const dispatch = createGatewaySendDispatch();
    const prisma = createOutboxPrisma(createOutboxRecord(dispatch, {
      payloadJson: {
        dispatchRef: {
          eventId: dispatch.eventId,
          eventKind: dispatch.event.kind,
          occurredAt: dispatch.occurredAt,
          userId: dispatch.event.userId,
        },
        stagedPayloadId: `staged/${dispatch.eventId}`,
        storage: "reference",
      },
    }));
    mocks.dispatchHostedExecutionStoredReferenceStatus.mockRejectedValue(
      new Error("compat route unavailable"),
    );

    const [record] = await drainHostedExecutionOutbox({
      now: "2026-03-28T11:00:00.000Z",
      prisma,
    });

    expect(record?.dispatchState).toBe("queued");
    expect(record?.lastError).toContain("compat route unavailable");
    expect(record?.nextAttemptAt?.toISOString()).toBe("2026-03-28T11:00:05.000Z");
    expect(record?.payloadJson).toEqual({
      dispatchRef: {
        eventId: dispatch.eventId,
        eventKind: dispatch.event.kind,
        occurredAt: dispatch.occurredAt,
        userId: dispatch.event.userId,
      },
      stagedPayloadId: `staged/${dispatch.eventId}`,
      storage: "reference",
    });
    expect(mocks.dispatchHostedExecutionStatus).not.toHaveBeenCalled();
  });
});

function createCronDispatch(): HostedExecutionDispatchRequest {
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

function createGatewaySendDispatch(): HostedExecutionDispatchRequest {
  return {
    event: {
      clientRequestId: "req_123",
      kind: "gateway.message.send",
      replyToMessageId: "5001",
      sessionKey: "gwcs_secret",
      text: "Please keep this private.",
      userId: "member_123",
    },
    eventId: "evt_gateway_send",
    occurredAt: "2026-03-28T11:00:00.000Z",
  };
}

function createDispatchResult(
  eventState: HostedExecutionDispatchLifecycleState,
  input: {
    eventId?: string;
    eventLastError?: string | null;
    statusLastError?: string | null;
  } = {},
): HostedExecutionDispatchResult {
  return {
    event: {
      eventId: input.eventId ?? "evt_tick",
      lastError: input.eventLastError ?? null,
      state: eventState,
      userId: "member_123",
    },
    status: {
      backpressuredEventIds: eventState === "backpressured" ? ["evt_tick"] : [],
      bundleRef: null,
      inFlight: false,
      lastError: input.statusLastError ?? null,
      lastEventId: "evt_tick",
      lastRunAt: null,
      nextWakeAt: null,
      pendingEventCount: eventState === "queued" ? 1 : 0,
      poisonedEventIds: [],
      retryingEventId: null,
      userId: "member_123",
    },
  };
}

function createOutboxRecord(
  dispatch: HostedExecutionDispatchRequest,
  input: {
    payloadJson?: ExecutionOutbox["payloadJson"];
  } = {},
): ExecutionOutbox {
  return {
    attemptCount: 0,
    claimExpiresAt: null,
    claimToken: null,
    createdAt: new Date("2026-03-28T11:00:00.000Z"),
    dispatchState: "queued",
    eventId: dispatch.eventId,
    eventKind: dispatch.event.kind,
    id: "execout_123",
    lastAttemptAt: null,
    lastError: null,
    nextAttemptAt: new Date("2026-03-28T11:00:00.000Z"),
    payloadJson: (input.payloadJson ?? serializeHostedExecutionOutboxPayload(dispatch, {
      storage: "inline",
    })) as Prisma.JsonValue,
    sourceId: null,
    sourceType: "hosted_execution",
    updatedAt: new Date("2026-03-28T11:00:00.000Z"),
    userId: dispatch.event.userId,
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

        if ("dispatchState" in where && where.dispatchState !== current.dispatchState) {
          return { count: 0 };
        }

        if (
          "nextAttemptAt" in where
          && !sameDate(where.nextAttemptAt as Date | null | undefined, current.nextAttemptAt)
        ) {
          return { count: 0 };
        }

        if (
          "claimExpiresAt" in where
          && !sameDate(where.claimExpiresAt as Date | null | undefined, current.claimExpiresAt)
        ) {
          return { count: 0 };
        }

        current = {
          ...current,
          ...data,
          attemptCount:
            typeof data.attemptCount === "object"
              && data.attemptCount
              && "increment" in (data.attemptCount as Record<string, unknown>)
              ? current.attemptCount + Number((data.attemptCount as { increment: number }).increment)
              : (data.attemptCount as number | undefined) ?? current.attemptCount,
          updatedAt: new Date("2026-03-28T11:00:00.000Z"),
        };

        return { count: 1 };
      }),
    },
  } as unknown as PrismaClient;
}

function createEnqueueOutboxPrisma(record: ExecutionOutbox): Pick<PrismaClient, "executionOutbox"> {
  const current = structuredClone(record);

  return {
    executionOutbox: {
      upsert: vi.fn(async ({ create }: { create: ExecutionOutbox }) => ({
        ...current,
        ...create,
      })),
    },
  } as unknown as Pick<PrismaClient, "executionOutbox">;
}

function sameDate(left: Date | null | undefined, right: Date | null | undefined): boolean {
  return (left?.toISOString() ?? null) === (right?.toISOString() ?? null);
}
