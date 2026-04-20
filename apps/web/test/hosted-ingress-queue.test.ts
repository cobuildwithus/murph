import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOSTED_INGRESS_PAYLOAD_SCHEMA,
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionLinqConversationMessageWake,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  appendHostedCoalescingWakeTx: vi.fn(),
  appendHostedOrderedWakeTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-ingress/store", () => ({
  appendHostedCoalescingWakeTx: mocks.appendHostedCoalescingWakeTx,
  appendHostedOrderedWakeTx: mocks.appendHostedOrderedWakeTx,
  findHostedIngressEventAliasIdByEventIdTx: vi.fn(),
  readHostedIngressLifecycleByEventIdTx: vi.fn(),
  readHostedIngressScheduleByEventIdTx: vi.fn(),
}));

import { materializeHostedIngressEnvelopeTx } from "@/src/lib/hosted-ingress/lifecycle";

describe("materializeHostedIngressEnvelopeTx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendHostedOrderedWakeTx.mockResolvedValue({
      duplicate: false,
      inserted: true,
      updatedExisting: false,
      wake: {
        behavior: "ordered",
        createdAt: "2026-04-18T00:00:00.000Z",
        id: "wake_1",
        kind: "conversation.message",
        occurredAt: "2026-04-18T00:00:00.000Z",
        payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
        seq: "1",
        updatedAt: "2026-04-18T00:00:00.000Z",
        userId: "member_123",
      },
    });
    mocks.appendHostedCoalescingWakeTx.mockResolvedValue({
      duplicate: false,
      inserted: true,
      updatedExisting: false,
      wake: {
        behavior: "coalescing",
        createdAt: "2026-04-18T00:00:00.000Z",
        id: "wake_2",
        kind: "device-sync.wake",
        occurredAt: "2026-04-18T00:00:00.000Z",
        payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
        seq: "2",
        updatedAt: "2026-04-18T00:00:00.000Z",
        userId: "member_123",
      },
    });
  });

  it("persists canonical Linq conversation wakes without a nested dispatch envelope", async () => {
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq_message",
      linqMessage: {
        chatId: "chat_123",
        from: "+15555550123",
        isFromMe: false,
        messageId: "msg_123",
        parts: [
          {
            type: "text",
            value: "hello",
          },
        ],
      },
      occurredAt: "2026-04-18T00:00:00.000Z",
      phoneLookupKey: "lookup_123",
      userId: "member_123",
    });

    await materializeHostedIngressEnvelopeTx({
      wake,
      tx: {} as never,
    });

    expect(mocks.appendHostedOrderedWakeTx).toHaveBeenCalledWith(expect.objectContaining({
      dedupeKey: "evt_linq_message",
      eventId: "evt_linq_message",
      kind: "conversation.message",
      occurredAt: "2026-04-18T00:00:00.000Z",
      payload: wake,
      payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
      userId: "member_123",
    }));
    expect(mocks.appendHostedOrderedWakeTx).not.toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        event: expect.anything(),
      }),
    }));
  });

  it("appends device-sync wakes as ordered ingress so same-connection payloads are preserved", async () => {
    const wake = buildHostedExecutionDeviceSyncWake({
      eventId: "evt_device_sync",
      hint: {
        jobs: [
          {
            dedupeKey: "wake:resource-sync",
            kind: "resource-sync",
          },
        ],
      },
      occurredAt: "2026-04-18T00:00:00.000Z",
      connectionId: "conn_123",
      reason: "connected",
      userId: "member_123",
    });

    await materializeHostedIngressEnvelopeTx({
      wake,
      tx: {} as never,
    });

    expect(mocks.appendHostedOrderedWakeTx).toHaveBeenCalledWith(expect.objectContaining({
      dedupeKey: "evt_device_sync",
      eventId: "evt_device_sync",
      kind: "device-sync.wake",
      occurredAt: "2026-04-18T00:00:00.000Z",
      payload: wake,
      payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
      userId: "member_123",
    }));
    expect(mocks.appendHostedCoalescingWakeTx).not.toHaveBeenCalledWith(expect.objectContaining({
      kind: "device-sync.wake",
    }));
  });

  it("does not coalesce same-connection device-sync wakes with distinct job dedupe keys", async () => {
    const firstWake = buildHostedExecutionDeviceSyncWake({
      connectionId: "conn_123",
      eventId: "evt_device_sync_first",
      hint: {
        jobs: [
          {
            dedupeKey: "wake:resource-sync",
            kind: "resource-sync",
          },
        ],
      },
      occurredAt: "2026-04-18T00:00:00.000Z",
      reason: "webhook_hint",
      userId: "member_123",
    });
    const secondWake = buildHostedExecutionDeviceSyncWake({
      connectionId: "conn_123",
      eventId: "evt_device_sync_second",
      hint: {
        jobs: [
          {
            dedupeKey: "wake:sleep-sync",
            kind: "sleep-sync",
          },
        ],
      },
      occurredAt: "2026-04-18T00:00:01.000Z",
      reason: "webhook_hint",
      userId: "member_123",
    });

    await materializeHostedIngressEnvelopeTx({
      tx: {} as never,
      wake: firstWake,
    });
    await materializeHostedIngressEnvelopeTx({
      tx: {} as never,
      wake: secondWake,
    });

    expect(mocks.appendHostedOrderedWakeTx).toHaveBeenCalledTimes(2);
    expect(
      mocks.appendHostedOrderedWakeTx.mock.calls.map(([input]) => ({
        dedupeKey: input.dedupeKey,
        eventId: input.eventId,
        jobDedupeKey: input.payload.hint?.jobs?.[0]?.dedupeKey ?? null,
      })),
    ).toEqual([
      {
        dedupeKey: "evt_device_sync_first",
        eventId: "evt_device_sync_first",
        jobDedupeKey: "wake:resource-sync",
      },
      {
        dedupeKey: "evt_device_sync_second",
        eventId: "evt_device_sync_second",
        jobDedupeKey: "wake:sleep-sync",
      },
    ]);
    expect(mocks.appendHostedCoalescingWakeTx).not.toHaveBeenCalledWith(expect.objectContaining({
      kind: "device-sync.wake",
    }));
  });

  it("rejects non-canonical ingress kinds", async () => {
    const wake = {
      eventId: "evt_invalid_ingress",
      kind: "unsupported.kind" as const,
      occurredAt: "2026-04-18T00:00:00.000Z",
      userId: "member_123",
    };

    await expect(materializeHostedIngressEnvelopeTx({
      wake,
      tx: {} as never,
    } as never)).rejects.toThrow(/canonical external ingress kinds/i);
    expect(mocks.appendHostedCoalescingWakeTx).not.toHaveBeenCalled();
    expect(mocks.appendHostedOrderedWakeTx).not.toHaveBeenCalled();
  });
});
