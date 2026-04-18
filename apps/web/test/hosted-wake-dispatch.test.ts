import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOSTED_WAKE_MESSAGE_PAYLOAD_SCHEMA,
  buildHostedWakeLinqMessageReceivedPayload,
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
        kind: "linq.message.received",
        occurredAt: "2026-04-18T00:00:00.000Z",
        payloadSchema: HOSTED_WAKE_MESSAGE_PAYLOAD_SCHEMA,
        seq: "1",
        updatedAt: "2026-04-18T00:00:00.000Z",
        userId: "member_123",
      },
    });
  });

  it("persists direct Linq message wake payloads without a nested dispatch envelope", async () => {
    const payload = buildHostedWakeLinqMessageReceivedPayload({
      eventId: "evt_linq_message",
      linqEvent: {
        id: "msg_123",
      },
      linqMessageId: "msg_123",
      phoneLookupKey: "lookup_123",
    });

    await appendHostedExecutionWakeTx({
      eventId: "evt_linq_message",
      kind: "linq.message.received",
      occurredAt: "2026-04-18T00:00:00.000Z",
      payload,
      sourceType: "hosted_webhook_receipt",
      tx: {} as never,
      userId: "member_123",
    });

    expect(mocks.appendHostedOrderedWakeTx).toHaveBeenCalledWith(expect.objectContaining({
      dedupeKey: "dispatch:linq.message.received:evt_linq_message",
      kind: "linq.message.received",
      occurredAt: "2026-04-18T00:00:00.000Z",
      payload,
      payloadSchema: HOSTED_WAKE_MESSAGE_PAYLOAD_SCHEMA,
      userId: "member_123",
    }));
    expect(mocks.appendHostedOrderedWakeTx).not.toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        event: expect.anything(),
      }),
    }));
  });
});
