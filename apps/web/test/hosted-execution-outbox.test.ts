import { ExecutionOutboxStatus } from "@prisma/client";
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
}));

vi.mock("@/src/lib/hosted-execution/dispatch", () => ({
  dispatchHostedExecutionStatus: mocks.dispatchHostedExecutionStatus,
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
    ["queued", ExecutionOutboxStatus.dispatched, "queued", null],
    ["completed", ExecutionOutboxStatus.dispatched, "completed", null],
    ["poisoned", ExecutionOutboxStatus.dispatched, "poisoned", null],
    ["backpressured", ExecutionOutboxStatus.delivery_failed, "backpressured", "runner full"],
  ] as const)(
    "maps %s dispatch results onto the canonical lifecycle",
    async (eventState, expectedStatus, expectedDispatchState, lastError) => {
      const dispatch = createCronDispatch();
      const prisma = createOutboxPrisma(createOutboxRecord(dispatch));
      mocks.dispatchHostedExecutionStatus.mockResolvedValue(
        createDispatchResult(eventState, { eventLastError: lastError }),
      );

      const [record] = await drainHostedExecutionOutbox({
        now: "2026-03-28T11:00:00.000Z",
        prisma,
      });

      expect(record?.status).toBe(expectedStatus);
      expect(record?.dispatchState).toBe(expectedDispatchState);
    },
  );

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

    expect(record?.status).toBe(ExecutionOutboxStatus.delivery_failed);
    expect(record?.lastError).toContain("missing a dispatch payload");
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
    status: ExecutionOutboxStatus.queued,
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

        if ("status" in where && where.status !== current.status) {
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
