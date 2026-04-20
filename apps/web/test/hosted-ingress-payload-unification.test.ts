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
  readHostedIngressLifecycleByDedupeKeyTx: vi.fn(),
  readHostedIngressLifecycleByEventIdTx: vi.fn(),
  readHostedIngressScheduleByEventIdTx: vi.fn(),
}));

import { materializeHostedIngressEnvelopeTx } from "@/src/lib/hosted-ingress/lifecycle";
import { projectHostedIngressEvent } from "@/src/lib/hosted-ingress/store-projections";

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
        id: "wake_coalesced",
        kind: "device-sync.wake",
        occurredAt: "2026-04-18T00:00:00.000Z",
        payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
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

    await materializeHostedIngressEnvelopeTx({
      tx: {} as never,
      wake,
    });

    expect(mocks.appendHostedOrderedWakeTx).toHaveBeenCalledWith(expect.objectContaining({
      kind: "conversation.message",
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

  it("stores device-sync wakes as the full canonical wake object", async () => {
    const wake = buildHostedExecutionDeviceSyncWake({
      eventId: "evt_device_sync",
      occurredAt: "2026-04-18T00:00:00.000Z",
      reason: "connected",
      userId: "member_123",
    });

    await materializeHostedIngressEnvelopeTx({
      tx: {} as never,
      wake,
    });

    expect(mocks.appendHostedCoalescingWakeTx).toHaveBeenCalledWith(expect.objectContaining({
      kind: "device-sync.wake",
      payload: wake,
      payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
      userId: "member_123",
    }));
    expect(mocks.appendHostedCoalescingWakeTx).not.toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        event: expect.anything(),
      }),
    }));
  });

  it("projects both conversation and system rows through the canonical schema", () => {
    expect(projectHostedIngressEvent({
      behavior: "ordered",
      completedAt: null,
      coalescingKey: null,
      createdAt: new Date("2026-04-18T00:00:00.000Z"),
      dedupeKey: "evt_linq_message",
      id: "wake_conversation",
      kind: "conversation.message",
      occurredAt: new Date("2026-04-18T00:00:00.000Z"),
      payloadBytes: 128,
      payloadInlineCiphertext: "ciphertext_inline",
      payloadRef: null,
      payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
      quarantineCode: null,
      quarantinedAt: null,
      runId: null,
      seq: 1n,
      state: "queued",
      updatedAt: new Date("2026-04-18T00:00:00.000Z"),
      userId: "member_123",
    })).toMatchObject({
      kind: "conversation.message",
      payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
    });

    expect(projectHostedIngressEvent({
      behavior: "coalescing",
      completedAt: null,
      coalescingKey: "device-sync.wake:member_123:global",
      createdAt: new Date("2026-04-18T00:00:00.000Z"),
      dedupeKey: "evt_device_sync",
      id: "wake_system",
      kind: "device-sync.wake",
      occurredAt: new Date("2026-04-18T00:00:00.000Z"),
      payloadBytes: 128,
      payloadInlineCiphertext: "ciphertext_inline",
      payloadRef: null,
      payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
      quarantineCode: null,
      quarantinedAt: null,
      runId: null,
      seq: 2n,
      state: "queued",
      updatedAt: new Date("2026-04-18T00:00:00.000Z"),
      userId: "member_123",
    })).toMatchObject({
      kind: "device-sync.wake",
      payloadSchema: HOSTED_INGRESS_PAYLOAD_SCHEMA,
    });
  });

  it("fails closed on legacy per-kind payload schemas", () => {
    expect(() => projectHostedIngressEvent({
      behavior: "ordered",
      completedAt: null,
      coalescingKey: null,
      createdAt: new Date("2026-04-18T00:00:00.000Z"),
      dedupeKey: "evt_legacy",
      id: "wake_legacy",
      kind: "conversation.message",
      occurredAt: new Date("2026-04-18T00:00:00.000Z"),
      payloadBytes: 128,
      payloadInlineCiphertext: "ciphertext_inline",
      payloadRef: null,
      payloadSchema: "murph.hosted-ingress-conversation-message.v1",
      quarantineCode: null,
      quarantinedAt: null,
      runId: null,
      seq: 3n,
      state: "queued",
      updatedAt: new Date("2026-04-18T00:00:00.000Z"),
      userId: "member_123",
    })).toThrow(/payload schema is invalid/i);
  });
});
