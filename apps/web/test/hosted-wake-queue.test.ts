import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
  buildHostedExecutionAssistantCronTickWake,
  buildHostedExecutionLinqConversationMessageWake,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  appendHostedCoalescingWakeTx: vi.fn(),
  appendHostedOrderedWakeTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-wake/store", () => ({
  appendHostedCoalescingWakeTx: mocks.appendHostedCoalescingWakeTx,
  appendHostedOrderedWakeTx: mocks.appendHostedOrderedWakeTx,
  findHostedWakeEventIdByEventIdTx: vi.fn(),
  readHostedWakeLifecycleByEventIdTx: vi.fn(),
  readHostedWakeScheduleByEventIdTx: vi.fn(),
}));

import { materializeHostedExecutionWakeTx } from "@/src/lib/hosted-wake/lifecycle";

describe("materializeHostedExecutionWakeTx", () => {
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
        payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
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
        kind: "assistant.cron.tick",
        occurredAt: "2026-04-18T00:00:00.000Z",
        payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
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

    await materializeHostedExecutionWakeTx({
      wake,
      tx: {} as never,
    });

    expect(mocks.appendHostedOrderedWakeTx).toHaveBeenCalledWith(expect.objectContaining({
      dedupeKey: "evt_linq_message",
      eventId: "evt_linq_message",
      kind: "conversation.message",
      occurredAt: "2026-04-18T00:00:00.000Z",
      payload: wake,
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
      userId: "member_123",
    }));
    expect(mocks.appendHostedOrderedWakeTx).not.toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        event: expect.anything(),
      }),
    }));
  });

  it("coalesces assistant cron wakes by user instead of defaulting to ordered appends", async () => {
    const wake = buildHostedExecutionAssistantCronTickWake({
      eventId: "evt_tick",
      occurredAt: "2026-04-18T00:00:00.000Z",
      reason: "alarm",
      userId: "member_123",
    });

    await materializeHostedExecutionWakeTx({
      wake,
      tx: {} as never,
    });

    expect(mocks.appendHostedCoalescingWakeTx).toHaveBeenCalledWith(expect.objectContaining({
      coalescingKey: "assistant.cron.tick:member_123",
      dedupeKey: "evt_tick",
      eventId: "evt_tick",
      kind: "assistant.cron.tick",
      occurredAt: "2026-04-18T00:00:00.000Z",
      userId: "member_123",
    }));
    expect(mocks.appendHostedOrderedWakeTx).not.toHaveBeenCalledWith(expect.objectContaining({
      kind: "assistant.cron.tick",
    }));
  });

  it("persists assistant cron wakes with the full canonical wake payload", async () => {
    const wake = buildHostedExecutionAssistantCronTickWake({
      eventId: "evt_tick_full_payload",
      occurredAt: "2026-04-18T00:00:00.000Z",
      reason: "manual",
      userId: "member_123",
    });

    await materializeHostedExecutionWakeTx({
      wake,
      tx: {} as never,
    });

    expect(mocks.appendHostedCoalescingWakeTx).toHaveBeenCalledWith(expect.objectContaining({
      coalescingKey: "assistant.cron.tick:member_123",
      dedupeKey: "evt_tick_full_payload",
      eventId: "evt_tick_full_payload",
      kind: "assistant.cron.tick",
      occurredAt: "2026-04-18T00:00:00.000Z",
      payload: wake,
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
      userId: "member_123",
    }));
    expect(mocks.appendHostedCoalescingWakeTx).not.toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        event: expect.anything(),
      }),
    }));
  });
});
