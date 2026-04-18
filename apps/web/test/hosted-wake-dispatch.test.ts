import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA,
  buildHostedExecutionLinqConversationMessageWake,
} from "@murphai/hosted-execution";

const mocks = vi.hoisted(() => ({
  appendHostedCoalescingWakeTx: vi.fn(),
  appendHostedEdgeTriggeredWakeTx: vi.fn(),
  appendHostedOrderedWakeTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-wake/store", () => ({
  appendHostedCoalescingWakeTx: mocks.appendHostedCoalescingWakeTx,
  appendHostedEdgeTriggeredWakeTx: mocks.appendHostedEdgeTriggeredWakeTx,
  appendHostedOrderedWakeTx: mocks.appendHostedOrderedWakeTx,
  findHostedWakeEventIdByEventIdTx: vi.fn(),
  readHostedWakeLifecycleByDedupeKeyTx: vi.fn(),
  readHostedWakeScheduleByEventIdTx: vi.fn(),
}));

import { appendHostedExecutionWakeTx } from "@/src/lib/hosted-execution/dispatch-lifecycle";

describe("appendHostedExecutionWakeTx", () => {
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
        payloadSchema: HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA,
        seq: "1",
        updatedAt: "2026-04-18T00:00:00.000Z",
        userId: "member_123",
      },
    });
  });

  it("persists canonical Linq conversation wakes without a nested dispatch envelope", async () => {
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_linq_message",
      linqEvent: {
        id: "msg_123",
      },
      linqMessageId: "msg_123",
      occurredAt: "2026-04-18T00:00:00.000Z",
      phoneLookupKey: "lookup_123",
      userId: "member_123",
    });

    await appendHostedExecutionWakeTx({
      wake,
      sourceType: "hosted_webhook_receipt",
      tx: {} as never,
    });

    expect(mocks.appendHostedOrderedWakeTx).toHaveBeenCalledWith(expect.objectContaining({
      dedupeKey: "dispatch:conversation.message:evt_linq_message",
      kind: "conversation.message",
      occurredAt: "2026-04-18T00:00:00.000Z",
      payload: {
        eventId: "evt_linq_message",
        ...wake.message,
      },
      payloadSchema: HOSTED_WAKE_CONVERSATION_MESSAGE_PAYLOAD_SCHEMA,
      userId: "member_123",
    }));
    expect(mocks.appendHostedOrderedWakeTx).not.toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        event: expect.anything(),
      }),
    }));
  });
});
