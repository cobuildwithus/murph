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

  it("coalesces device-sync wakes by user instead of defaulting to ordered appends", async () => {
    const wake = buildHostedExecutionDeviceSyncWake({
      eventId: "evt_device_sync",
      occurredAt: "2026-04-18T00:00:00.000Z",
      reason: "connected",
      userId: "member_123",
    });

    await materializeHostedIngressEnvelopeTx({
      wake,
      tx: {} as never,
    });

    expect(mocks.appendHostedCoalescingWakeTx).toHaveBeenCalledWith(expect.objectContaining({
      coalescingKey: "device-sync.wake:member_123:global",
      dedupeKey: "evt_device_sync",
      eventId: "evt_device_sync",
      kind: "device-sync.wake",
      occurredAt: "2026-04-18T00:00:00.000Z",
      userId: "member_123",
    }));
    expect(mocks.appendHostedOrderedWakeTx).not.toHaveBeenCalledWith(expect.objectContaining({
      kind: "device-sync.wake",
    }));
  });

  it("rejects assistant cron ticks as persisted ingress", async () => {
    const wake = {
      eventId: "evt_tick_full_payload",
      kind: "assistant.cron.tick" as const,
      occurredAt: "2026-04-18T00:00:00.000Z",
      reason: "manual",
      userId: "member_123",
    };

    await expect(materializeHostedIngressEnvelopeTx({
      wake,
      tx: {} as never,
    } as never)).rejects.toThrow(/no longer accepts assistant\.cron\.tick/i);
    expect(mocks.appendHostedCoalescingWakeTx).not.toHaveBeenCalled();
    expect(mocks.appendHostedOrderedWakeTx).not.toHaveBeenCalled();
  });
});
