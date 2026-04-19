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
  readHostedWakeLifecycleByDedupeKeyTx: vi.fn(),
  readHostedWakeLifecycleByEventIdTx: vi.fn(),
  readHostedWakeScheduleByEventIdTx: vi.fn(),
}));

import { materializeHostedExecutionWakeTx } from "@/src/lib/hosted-wake/lifecycle";
import { projectHostedWakeRecord } from "@/src/lib/hosted-wake/store-projections";

describe("hosted wake payload unification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendHostedOrderedWakeTx.mockResolvedValue({
      duplicate: false,
      inserted: true,
      updatedExisting: false,
      wake: {
        behavior: "ordered",
        createdAt: "2026-04-18T00:00:00.000Z",
        id: "wake_ordered",
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
        id: "wake_coalesced",
        kind: "assistant.cron.tick",
        occurredAt: "2026-04-18T00:00:00.000Z",
        payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
        seq: "2",
        updatedAt: "2026-04-18T00:00:00.000Z",
        userId: "member_123",
      },
    });
  });

  it("stores conversation wakes as the full canonical wake object", async () => {
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
      tx: {} as never,
      wake,
    });

    expect(mocks.appendHostedOrderedWakeTx).toHaveBeenCalledWith(expect.objectContaining({
      kind: "conversation.message",
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

  it("stores system wakes as the full canonical wake object", async () => {
    const wake = buildHostedExecutionAssistantCronTickWake({
      eventId: "evt_tick",
      occurredAt: "2026-04-18T00:00:00.000Z",
      reason: "alarm",
      userId: "member_123",
    });

    await materializeHostedExecutionWakeTx({
      tx: {} as never,
      wake,
    });

    expect(mocks.appendHostedCoalescingWakeTx).toHaveBeenCalledWith(expect.objectContaining({
      kind: "assistant.cron.tick",
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

  it("projects both conversation and system rows through the canonical schema", () => {
    expect(projectHostedWakeRecord({
      behavior: "ordered",
      coalescingKey: null,
      createdAt: new Date("2026-04-18T00:00:00.000Z"),
      dedupeKey: "evt_linq_message",
      id: "wake_conversation",
      kind: "conversation.message",
      occurredAt: new Date("2026-04-18T00:00:00.000Z"),
      payloadBytes: 128,
      payloadInlineCiphertext: "ciphertext_inline",
      payloadRef: null,
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
      quarantineCode: null,
      quarantinedAt: null,
      seq: 1n,
      updatedAt: new Date("2026-04-18T00:00:00.000Z"),
      userId: "member_123",
    })).toMatchObject({
      kind: "conversation.message",
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
    });

    expect(projectHostedWakeRecord({
      behavior: "coalescing",
      coalescingKey: "assistant.cron.tick:member_123",
      createdAt: new Date("2026-04-18T00:00:00.000Z"),
      dedupeKey: "evt_tick",
      id: "wake_system",
      kind: "assistant.cron.tick",
      occurredAt: new Date("2026-04-18T00:00:00.000Z"),
      payloadBytes: 128,
      payloadInlineCiphertext: "ciphertext_inline",
      payloadRef: null,
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
      quarantineCode: null,
      quarantinedAt: null,
      seq: 2n,
      updatedAt: new Date("2026-04-18T00:00:00.000Z"),
      userId: "member_123",
    })).toMatchObject({
      kind: "assistant.cron.tick",
      payloadSchema: HOSTED_WAKE_EXECUTION_PAYLOAD_SCHEMA,
    });
  });

  it("fails closed on legacy per-kind payload schemas", () => {
    expect(() => projectHostedWakeRecord({
      behavior: "ordered",
      coalescingKey: null,
      createdAt: new Date("2026-04-18T00:00:00.000Z"),
      dedupeKey: "evt_legacy",
      id: "wake_legacy",
      kind: "conversation.message",
      occurredAt: new Date("2026-04-18T00:00:00.000Z"),
      payloadBytes: 128,
      payloadInlineCiphertext: "ciphertext_inline",
      payloadRef: null,
      payloadSchema: "murph.hosted-wake-conversation-message.v1",
      quarantineCode: null,
      quarantinedAt: null,
      seq: 3n,
      updatedAt: new Date("2026-04-18T00:00:00.000Z"),
      userId: "member_123",
    })).toThrow(/payload schema is invalid/i);
  });
});
