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
  summarizeHostedExecutionOutboxPayload,
} from "@/src/lib/hosted-execution/outbox-payload";

const mocks = vi.hoisted(() => ({
  appendHostedExecutionDispatchWakeTx: vi.fn(),
  dispatchHostedExecutionStatus: vi.fn(),
  findHostedExecutionWakeEventIdTx: vi.fn(),
  shouldRouteHostedSimpleProducerDispatchToWake: vi.fn(() => false),
}));

vi.mock("@/src/lib/hosted-execution/dispatch", () => ({
  dispatchHostedExecutionStatus: mocks.dispatchHostedExecutionStatus,
}));
vi.mock("@/src/lib/hosted-wake/dispatch", () => ({
  appendHostedExecutionDispatchWakeTx: mocks.appendHostedExecutionDispatchWakeTx,
  findHostedExecutionWakeEventIdTx: mocks.findHostedExecutionWakeEventIdTx,
}));
vi.mock("@/src/lib/hosted-wake/flags", () => ({
  shouldRouteHostedSimpleProducerDispatchToWake: mocks.shouldRouteHostedSimpleProducerDispatchToWake,
}));

import {
  drainHostedExecutionOutbox,
  enqueueHostedExecutionOutbox,
  findHostedExecutionScheduledEventIdTx,
  pruneHostedExecutionOutbox,
  scheduleHostedExecutionDispatchTx,
} from "@/src/lib/hosted-execution/outbox";

describe("hosted execution outbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.shouldRouteHostedSimpleProducerDispatchToWake.mockReturnValue(false);
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

  it("summarizes settled accepted rows once no further web retry work remains", async () => {
    const dispatch = createGatewaySendDispatch();
    const initialPayload = serializeHostedExecutionOutboxPayload(dispatch) as Prisma.JsonValue;
    const prisma = createOutboxPrisma(createOutboxRecord(dispatch, {
      payloadJson: initialPayload,
    }));
    mocks.dispatchHostedExecutionStatus.mockResolvedValue(
      createDispatchResult("queued"),
    );

    const [record] = await drainHostedExecutionOutbox({
      now: "2026-03-28T11:00:00.000Z",
      prisma,
    });

    expect(record?.dispatchState).toBe("queued");
    expect(record?.lastError).toBeNull();
    expect(record?.nextAttemptAt).toBeNull();
    expect(record?.payloadJson).toEqual(
      summarizeHostedExecutionOutboxPayload(
        readHostedExecutionOutboxPayload(initialPayload) as NonNullable<
          ReturnType<typeof readHostedExecutionOutboxPayload>
        >,
      ),
    );
  });

  it("fails closed when a legacy reference payload survives into the canonical outbox", async () => {
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

    const [record] = await drainHostedExecutionOutbox({
      now: "2026-03-28T11:00:00.000Z",
      prisma,
    });

    expect(record?.dispatchState).toBe("poisoned");
    expect(record?.lastError).toContain("missing a dispatch payload");
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

  it("prunes accepted rows with no remaining web-owned retry work", async () => {
    const deleteMany = vi.fn(async () => ({ count: 2 }));

    const deleted = await pruneHostedExecutionOutbox({
      now: "2026-04-27T11:00:00.000Z",
      prisma: {
        executionOutbox: {
          deleteMany,
        },
      } as unknown as PrismaClient,
    });

    expect(deleted).toBe(2);
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        claimToken: null,
        nextAttemptAt: null,
        updatedAt: {
          lt: new Date("2026-03-28T11:00:00.000Z"),
        },
      },
    });
  });

  it("routes flagged simple producers directly to HostedWake", async () => {
    const dispatch = createMemberActivatedDispatch();
    const prisma = createEnqueueOutboxPrisma(createOutboxRecord(dispatch));
    mocks.shouldRouteHostedSimpleProducerDispatchToWake.mockReturnValue(true);
    mocks.appendHostedExecutionDispatchWakeTx.mockResolvedValue({
      duplicate: false,
      inserted: true,
      updatedExisting: false,
      wake: {
        behavior: "ordered",
        coalescingKey: null,
        createdAt: dispatch.occurredAt,
        dedupeKey: `dispatch:${dispatch.event.kind}:${dispatch.eventId}`,
        id: "wake_123",
        kind: dispatch.event.kind,
        occurredAt: dispatch.occurredAt,
        payloadBytes: 1,
        payloadInlineCiphertext: "ciphertext",
        payloadRef: null,
        payloadSchema: "murph.hosted-wake-dispatch.v1",
        quarantineCode: null,
        quarantinedAt: null,
        seq: "1",
        updatedAt: dispatch.occurredAt,
        userId: dispatch.event.userId,
      },
    });

    await expect(scheduleHostedExecutionDispatchTx({
      dispatch,
      sourceType: "hosted_execution",
      tx: prisma as PrismaClient,
    })).resolves.toEqual({
      eventId: dispatch.eventId,
      route: "wake",
    });

    expect(mocks.appendHostedExecutionDispatchWakeTx).toHaveBeenCalledWith({
      dispatch,
      tx: expect.anything(),
    });
  });

  it("falls back to execution_outbox when wake routing cannot store the payload inline", async () => {
    const dispatch = createMemberChannelsUpdatedDispatch();
    const prisma = createEnqueueOutboxPrisma(createOutboxRecord(dispatch));
    mocks.shouldRouteHostedSimpleProducerDispatchToWake.mockReturnValue(true);
    mocks.appendHostedExecutionDispatchWakeTx.mockRejectedValue(
      new RangeError("payload too large"),
    );

    await expect(scheduleHostedExecutionDispatchTx({
      dispatch,
      sourceType: "hosted_execution",
      tx: prisma as PrismaClient,
    })).resolves.toEqual({
      eventId: dispatch.eventId,
      route: "outbox",
    });
  });

  it("finds scheduled event ids in HostedWake when the outbox row is absent", async () => {
    const dispatch = createMemberActivatedDispatch();
    const prisma = {
      executionOutbox: {
        findUnique: vi.fn(async () => null),
      },
    } as unknown as PrismaClient;
    mocks.findHostedExecutionWakeEventIdTx.mockResolvedValue(dispatch.eventId);

    await expect(findHostedExecutionScheduledEventIdTx({
      eventId: dispatch.eventId,
      tx: prisma,
    })).resolves.toBe(dispatch.eventId);
    expect(mocks.findHostedExecutionWakeEventIdTx).toHaveBeenCalledWith({
      eventId: dispatch.eventId,
      tx: prisma,
    });
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

function createMemberActivatedDispatch(): HostedExecutionDispatchRequest {
  return {
    event: {
      kind: "member.activated",
      memberChannels: {
        email: true,
        linq: false,
        telegram: false,
      },
      userId: "member_123",
    },
    eventId: "member.activated:stripe.invoice.paid:member_123:evt_123",
    occurredAt: "2026-03-28T11:00:00.000Z",
  };
}

function createMemberChannelsUpdatedDispatch(): HostedExecutionDispatchRequest {
  return {
    event: {
      kind: "member.channels.updated",
      memberChannels: {
        email: true,
        linq: true,
        telegram: false,
      },
      userId: "member_123",
    },
    eventId: "member.channels.updated:settings.phone.sync:member_123:2026-03-28T11:00:00.000Z",
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
    payloadJson: (input.payloadJson ?? serializeHostedExecutionOutboxPayload(dispatch)) as Prisma.JsonValue,
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
