import { ExecutionOutboxStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExecutionOutbox, PrismaClient } from "@prisma/client";
import type { HostedExecutionDispatchRequest, HostedExecutionDispatchResult } from "@murphai/hosted-execution";
import { serializeHostedExecutionOutboxPayload } from "@/src/lib/hosted-execution/outbox-payload";

const mocks = vi.hoisted(() => ({
  deleteHostedStoredDispatchPayloadBestEffort: vi.fn(),
  dispatchHostedExecutionStatus: vi.fn(),
  dispatchStoredHostedExecutionStatus: vi.fn(),
  maybeStageHostedExecutionDispatchPayload: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/control", () => ({
  deleteHostedStoredDispatchPayloadBestEffort: mocks.deleteHostedStoredDispatchPayloadBestEffort,
  maybeStageHostedExecutionDispatchPayload: mocks.maybeStageHostedExecutionDispatchPayload,
}));

vi.mock("@/src/lib/hosted-execution/dispatch", () => ({
  dispatchHostedExecutionStatus: mocks.dispatchHostedExecutionStatus,
  dispatchStoredHostedExecutionStatus: mocks.dispatchStoredHostedExecutionStatus,
}));

import {
  drainHostedExecutionOutbox,
  enqueueHostedExecutionOutbox,
} from "@/src/lib/hosted-execution/outbox";

describe("drainHostedExecutionOutbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteHostedStoredDispatchPayloadBestEffort.mockResolvedValue(undefined);
    mocks.dispatchStoredHostedExecutionStatus.mockImplementation(mocks.dispatchHostedExecutionStatus);
    mocks.maybeStageHostedExecutionDispatchPayload.mockImplementation(async (dispatch: HostedExecutionDispatchRequest) => ({
      dispatchRef: {
        eventId: dispatch.eventId,
        eventKind: dispatch.event.kind,
        occurredAt: dispatch.occurredAt,
        userId: dispatch.event.userId,
      },
      stagedPayloadId: `staged/dispatch-payloads/${dispatch.event.userId}/${dispatch.eventId}`,
      storage: "reference",
    }));
  });

  it("marks completed inline share outcomes as dispatched without staged-payload cleanup", async () => {
    const dispatch = createShareDispatch();
    const prisma = createOutboxPrisma(createOutboxRecord({
      eventId: dispatch.eventId,
      eventKind: dispatch.event.kind,
      sourceType: "hosted_share_link",
      userId: dispatch.event.userId,
    }));
    mocks.dispatchHostedExecutionStatus.mockResolvedValue(createDispatchResult("completed"));

    const [record] = await drainHostedExecutionOutbox({
      now: "2026-03-28T11:00:00.000Z",
      prisma,
    });

    expect(record?.status).toBe(ExecutionOutboxStatus.dispatched);
    expect(record?.nextAttemptAt).toBeNull();
    expect(mocks.deleteHostedStoredDispatchPayloadBestEffort).not.toHaveBeenCalled();
  });

  it("treats duplicate consumed outcomes as dispatched without any web-owned share finalization", async () => {
    const dispatch = createTickDispatch();
    const prisma = createOutboxPrisma(createOutboxRecord({
      eventId: dispatch.eventId,
      eventKind: dispatch.event.kind,
      sourceType: "device_sync",
      userId: dispatch.event.userId,
    }));
    mocks.dispatchHostedExecutionStatus.mockResolvedValue(createDispatchResult("duplicate_consumed"));

    const [record] = await drainHostedExecutionOutbox({
      now: "2026-03-28T11:00:00.000Z",
      prisma,
    });

    expect(record?.status).toBe(ExecutionOutboxStatus.dispatched);
  });

  it.each([
    ["queued", ExecutionOutboxStatus.dispatched, null],
    ["duplicate_pending", ExecutionOutboxStatus.dispatched, null],
    ["backpressured", ExecutionOutboxStatus.delivery_failed, "runner full"],
  ] as const)(
    "maps %s outcomes onto the right retry status",
    async (eventState, expectedStatus, lastError) => {
      const dispatch = createTickDispatch();
      const prisma = createOutboxPrisma(createOutboxRecord({
        eventId: dispatch.eventId,
        eventKind: dispatch.event.kind,
        userId: dispatch.event.userId,
      }));
      mocks.dispatchHostedExecutionStatus.mockResolvedValue(createDispatchResult(eventState, {
        eventLastError: lastError,
      }));

      const [record] = await drainHostedExecutionOutbox({
        now: "2026-03-28T11:00:00.000Z",
        prisma,
      });

      expect(record?.status).toBe(expectedStatus);
    },
  );

  it("keeps not-configured queued outcomes retryable as delivery failures", async () => {
    const dispatch = createTickDispatch();
    const prisma = createOutboxPrisma(createOutboxRecord({
      eventId: dispatch.eventId,
      eventKind: dispatch.event.kind,
      userId: dispatch.event.userId,
    }));
    mocks.dispatchHostedExecutionStatus.mockResolvedValue(createDispatchResult("queued", {
      statusLastError: "Hosted execution dispatch is not configured.",
    }));

    const [record] = await drainHostedExecutionOutbox({
      now: "2026-03-28T11:00:00.000Z",
      prisma,
    });

    expect(record?.status).toBe(ExecutionOutboxStatus.delivery_failed);
    expect(record?.lastError).toBe("Hosted execution dispatch is not configured.");
    expect(record?.nextAttemptAt).toEqual(new Date("2026-03-28T11:00:05.000Z"));
  });

  it("treats poisoned outcomes as dispatched because Cloudflare owns the post-handoff lifecycle", async () => {
    const dispatch = createTickDispatch();
    const prisma = createOutboxPrisma(createOutboxRecord({
      eventId: dispatch.eventId,
      eventKind: dispatch.event.kind,
      userId: dispatch.event.userId,
    }));
    mocks.dispatchHostedExecutionStatus.mockResolvedValue(createDispatchResult("poisoned", {
      eventLastError: "poisoned by runner",
      statusLastError: "global fallback",
    }));

    const [record] = await drainHostedExecutionOutbox({
      now: "2026-03-28T11:00:00.000Z",
      prisma,
    });

    expect(record?.status).toBe(ExecutionOutboxStatus.dispatched);
    expect(record?.lastError).toBeNull();
  });

  it.each([
    "queued",
    "duplicate_pending",
  ] as const)(
    "keeps adopted staged payloads when Cloudflare reports %s",
    async (eventState) => {
      const dispatch = createGatewaySendDispatch();
      const prisma = createOutboxPrisma(createOutboxRecord({
        eventId: dispatch.eventId,
        eventKind: dispatch.event.kind,
        sourceType: "gateway_send",
        userId: dispatch.event.userId,
      }));
      mocks.dispatchStoredHostedExecutionStatus.mockResolvedValue(createDispatchResult(eventState));

      const [record] = await drainHostedExecutionOutbox({
        now: "2026-03-28T11:00:00.000Z",
        prisma,
      });

      expect(record?.status).toBe(ExecutionOutboxStatus.dispatched);
      expect(mocks.deleteHostedStoredDispatchPayloadBestEffort).not.toHaveBeenCalled();
    },
  );

  it("marks missing staged payload refs as terminal delivery failures instead of retrying forever", async () => {
    const prisma = createOutboxPrisma(createOutboxRecord({
      eventId: "evt_tick",
      eventKind: "gateway.message.send",
      payloadJson: {
        dispatchRef: {
          eventId: "evt_tick",
          eventKind: "gateway.message.send",
          occurredAt: "2026-03-28T11:00:00.000Z",
          userId: "member_123",
        },
        storage: "reference",
      },
      userId: "member_123",
    }));

    const [record] = await drainHostedExecutionOutbox({
      now: "2026-03-28T11:00:00.000Z",
      prisma,
    });

    expect(record?.status).toBe(ExecutionOutboxStatus.delivery_failed);
    expect(record?.nextAttemptAt).toBeNull();
  });

  it("rejects reused event ids when source metadata changes", async () => {
    const dispatch = createTickDispatch();
    const prisma = createEnqueueOutboxPrisma(createOutboxRecord({
      eventId: dispatch.eventId,
      eventKind: dispatch.event.kind,
      sourceId: "signal_1",
      sourceType: "device_sync_signal",
      userId: dispatch.event.userId,
    }));

    await expect(enqueueHostedExecutionOutbox({
      dispatch,
      sourceId: "signal_2",
      sourceType: "device_sync_signal",
      tx: prisma as never,
    })).rejects.toThrow(
      "Hosted execution outbox event evt_tick already exists with conflicting metadata.",
    );
  });

  it("rejects stale numeric device-sync source ids when the stable event id is re-enqueued", async () => {
    const dispatch = createTickDispatch();
    const prisma = createEnqueueOutboxPrisma(createOutboxRecord({
      eventId: dispatch.eventId,
      eventKind: dispatch.event.kind,
      sourceId: "8",
      sourceType: "device_sync_signal",
      userId: dispatch.event.userId,
    }));

    await expect(enqueueHostedExecutionOutbox({
      dispatch,
      sourceId: dispatch.eventId,
      sourceType: "device_sync_signal",
      tx: prisma as never,
    })).rejects.toThrow(
      "Hosted execution outbox event evt_tick already exists with conflicting metadata.",
    );
  });

  it("accepts idempotent re-enqueue when stored payload JSON key order differs", async () => {
    const dispatch = createShareDispatch();
    const prisma = createEnqueueOutboxPrisma(createOutboxRecord({
      eventId: dispatch.eventId,
      eventKind: dispatch.event.kind,
      payloadJson: JSON.parse(JSON.stringify(serializeHostedExecutionOutboxPayload(dispatch))),
      sourceId: "share_123",
      sourceType: "hosted_share_link",
      userId: dispatch.event.userId,
    }));

    await expect(enqueueHostedExecutionOutbox({
      dispatch,
      sourceId: "share_123",
      sourceType: "hosted_share_link",
      tx: prisma as never,
    })).resolves.toMatchObject({
      eventId: dispatch.eventId,
    });
  });

  it("persists inline outbox rows without staging a Cloudflare payload id", async () => {
    const dispatch = createMemberActivatedDispatch();
    const upsert = vi.fn(async ({ create }: {
      create: ExecutionOutbox;
    }) => structuredClone({
      ...createOutboxRecord({
        eventId: dispatch.eventId,
        eventKind: dispatch.event.kind,
        payloadJson: create.payloadJson,
        sourceType: "hosted_stripe_event",
        userId: dispatch.event.userId,
      }),
      payloadJson: create.payloadJson,
      sourceId: create.sourceId,
      sourceType: create.sourceType,
    }));
    const prisma = {
      executionOutbox: {
        upsert,
      },
    } as unknown as Pick<PrismaClient, "executionOutbox">;

    const record = await enqueueHostedExecutionOutbox({
      dispatch,
      sourceId: "stripe:evt_invoice_paid_123",
      sourceType: "hosted_stripe_event",
      storage: "inline",
      tx: prisma as never,
    });

    expect(mocks.maybeStageHostedExecutionDispatchPayload).not.toHaveBeenCalled();
    expect((record.payloadJson as { storage?: unknown }).storage).toBe("inline");
    expect(record.payloadJson).toEqual(serializeHostedExecutionOutboxPayload(dispatch, {
      storage: "inline",
    }));
  });

  it("persists gateway sends by reference without storing message text inline", async () => {
    const dispatch = createGatewaySendDispatch();
    const upsert = vi.fn(async ({ create }: {
      create: ExecutionOutbox;
    }) => structuredClone({
      ...createOutboxRecord({
        eventId: dispatch.eventId,
        eventKind: dispatch.event.kind,
        payloadJson: create.payloadJson,
        sourceType: "gateway_send",
        userId: dispatch.event.userId,
      }),
      payloadJson: create.payloadJson,
      sourceId: create.sourceId,
      sourceType: create.sourceType,
    }));
    const prisma = {
      executionOutbox: {
        upsert,
      },
    } as unknown as Pick<PrismaClient, "executionOutbox">;

    const record = await enqueueHostedExecutionOutbox({
      dispatch,
      sourceType: "gateway_send",
      tx: prisma as never,
    });

    expect(upsert).toHaveBeenCalledTimes(1);
    const persistedPayload = upsert.mock.calls[0]?.[0]?.create?.payloadJson;
    expect((persistedPayload as { storage?: unknown }).storage).toBe("reference");
    expect(JSON.stringify(persistedPayload)).not.toContain("Please keep this private.");
    expect(JSON.stringify(persistedPayload)).not.toContain("gwcs_secret");
    expect(record.payloadJson).toEqual(persistedPayload);
  });

  it("stages reference-backed payload ids when the Cloudflare control client is available", async () => {
    const dispatch = createGatewaySendDispatch();
    const stagedPayload = {
      dispatchRef: {
        eventId: dispatch.eventId,
        eventKind: dispatch.event.kind,
        occurredAt: dispatch.occurredAt,
        userId: dispatch.event.userId,
      },
      stagedPayloadId: "staged/dispatch-payloads/member_123/ref",
      storage: "reference",
    } as const;
    mocks.maybeStageHostedExecutionDispatchPayload.mockResolvedValue(stagedPayload);

    const upsert = vi.fn(async ({ create }: {
      create: ExecutionOutbox;
    }) => structuredClone({
      ...createOutboxRecord({
        eventId: dispatch.eventId,
        eventKind: dispatch.event.kind,
        payloadJson: create.payloadJson,
        sourceType: "gateway_send",
        userId: dispatch.event.userId,
      }),
      payloadJson: create.payloadJson,
      sourceId: create.sourceId,
      sourceType: create.sourceType,
    }));
    const prisma = {
      executionOutbox: {
        upsert,
      },
    } as unknown as Pick<PrismaClient, "executionOutbox">;

    const record = await enqueueHostedExecutionOutbox({
      dispatch,
      sourceType: "gateway_send",
      tx: prisma as never,
    });

    expect(mocks.maybeStageHostedExecutionDispatchPayload).toHaveBeenCalledWith(dispatch);
    expect(record.payloadJson).toEqual(stagedPayload);
  });

  it("deletes a newly staged payload when the outbox upsert fails before persistence", async () => {
    const dispatch = createGatewaySendDispatch();
    const stagedPayload = {
      dispatchRef: {
        eventId: dispatch.eventId,
        eventKind: dispatch.event.kind,
        occurredAt: dispatch.occurredAt,
        userId: dispatch.event.userId,
      },
      stagedPayloadId: "staged/dispatch-payloads/member_123/ref",
      storage: "reference",
    } as const;
    const upsertError = new Error("write failed");

    mocks.maybeStageHostedExecutionDispatchPayload.mockResolvedValue(stagedPayload);
    const prisma = {
      executionOutbox: {
        upsert: vi.fn(async () => {
          throw upsertError;
        }),
      },
    } as unknown as Pick<PrismaClient, "executionOutbox">;

    await expect(enqueueHostedExecutionOutbox({
      dispatch,
      sourceType: "gateway_send",
      tx: prisma as never,
    })).rejects.toThrow("write failed");

    expect(mocks.deleteHostedStoredDispatchPayloadBestEffort).toHaveBeenCalledWith(stagedPayload);
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

function createMemberActivatedDispatch(): HostedExecutionDispatchRequest {
  return {
    event: {
      firstContact: {
        channel: "linq",
        identityId: "hbidx:phone:v1:test",
        threadId: "chat_123",
        threadIsDirect: true,
      },
      kind: "member.activated",
      userId: "member_123",
    },
    eventId: "member.activated:stripe:member_123:evt_invoice_paid_123",
    occurredAt: "2026-03-28T11:00:00.000Z",
  };
}

function createShareDispatch(): HostedExecutionDispatchRequest {
  return {
    event: {
      kind: "vault.share.accepted",
      share: {
        ownerUserId: "member_sender",
        shareId: "share_123",
      },
      userId: "member_123",
    },
    eventId: "evt_share",
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
      bundleRef: null,
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
  payloadJson?: ExecutionOutbox["payloadJson"];
  sourceId?: string | null;
  sourceType?: string;
  userId: string;
}): ExecutionOutbox {
  return {
    attemptCount: 0,
    claimExpiresAt: null,
    claimToken: null,
    createdAt: new Date("2026-03-28T11:00:00.000Z"),
    eventId: input.eventId,
    eventKind: input.eventKind,
    id: "execout_123",
    lastAttemptAt: null,
    lastError: null,
    nextAttemptAt: new Date("2026-03-28T11:00:00.000Z"),
    payloadJson: (input.payloadJson ?? (
      input.eventKind === "assistant.cron.tick"
      || input.eventKind === "vault.share.accepted"
        ? serializeHostedExecutionOutboxPayload({
            event:
              input.eventKind === "vault.share.accepted"
                ? {
                    kind: "vault.share.accepted",
                    share: {
                      ownerUserId: "member_sender",
                      shareId: "share_123",
                    },
                    userId: input.userId,
                  }
                : {
                    kind: "assistant.cron.tick",
                    reason: "manual",
                    userId: input.userId,
                  },
            eventId: input.eventId,
            occurredAt: "2026-03-28T11:00:00.000Z",
          })
        : {
            dispatchRef: {
              eventId: input.eventId,
              eventKind: input.eventKind,
              occurredAt: "2026-03-28T11:00:00.000Z",
              userId: input.userId,
            },
            stagedPayloadId: `staged/dispatch-payloads/${input.userId}/${input.eventId}`,
            storage: "reference",
          }
    )) as ExecutionOutbox["payloadJson"],
    sourceId: input.sourceId ?? (input.sourceType === "hosted_share_link" ? "share_123" : null),
    sourceType: input.sourceType ?? "hosted_execution",
    status: ExecutionOutboxStatus.queued,
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

        const currentNextAttemptAt = current.nextAttemptAt;
        if (
          "nextAttemptAt" in where
          && where.nextAttemptAt
          && currentNextAttemptAt
          && currentNextAttemptAt > (where.nextAttemptAt as Date)
        ) {
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

function createEnqueueOutboxPrisma(record: ExecutionOutbox): Pick<PrismaClient, "executionOutbox"> {
  let current = structuredClone(record);

  return {
    executionOutbox: {
      upsert: vi.fn(async () => structuredClone(current)),
      update: vi.fn(async ({ data, where }: {
        data: Partial<ExecutionOutbox>;
        where: { id: string };
      }) => {
        if (where.id !== current.id) {
          throw new Error(`missing execution outbox record ${where.id}`);
        }

        current = {
          ...current,
          ...data,
        };

        return structuredClone(current);
      }),
    },
  } as unknown as Pick<PrismaClient, "executionOutbox">;
}
