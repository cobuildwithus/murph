import { describe, expect, it } from "vitest";

import {
  readHostedExecutionOutboxPayload,
  readHostedExecutionOutboxPayloadIdentity,
  serializeHostedExecutionOutboxPayload,
  summarizeHostedExecutionOutboxPayload,
} from "@/src/lib/hosted-execution/outbox-payload";

describe("hosted execution outbox payload storage", () => {
  it("stores hosted share acceptance inline as a tiny share ref", () => {
    const payload = serializeHostedExecutionOutboxPayload({
      event: {
        kind: "vault.share.accepted",
        share: {
          ownerUserId: "member_sender",
          shareId: "hshare_123",
        },
        userId: "member_123",
      },
      eventId: "evt_share_123",
      occurredAt: "2026-04-04T00:00:00.000Z",
    });

    expect((payload as { storage?: unknown }).storage).toBe("inline");
    expect(JSON.stringify(payload)).not.toContain("Shared breakfast");
  });

  it("stores device-sync wake events by reference instead of persisting hint payloads inline", () => {
    const payload = serializeHostedExecutionOutboxPayload({
      event: {
        kind: "device-sync.wake",
        connectionId: "conn_123",
        hint: {
          eventType: "sleep.updated",
          traceId: "trace_123",
        },
        provider: "oura",
        reason: "webhook_hint",
        userId: "member_123",
      },
      eventId: "evt_wake_123",
      occurredAt: "2026-04-04T00:00:00.000Z",
    }, {
      stagedPayloadId: buildTestPayloadRef("evt_wake_123"),
    });

    expect((payload as { storage?: unknown }).storage).toBe("reference");
    expect((payload as { stagedPayloadId?: unknown }).stagedPayloadId)
      .toBe("staged/dispatch-payloads/member_123/evt_wake_123");
    expect(JSON.stringify(payload)).not.toContain("sleep.updated");
    expect(JSON.stringify(payload)).not.toContain("trace_123");
  });

  it("stores member activation inline when first contact is omitted", () => {
    const payload = serializeHostedExecutionOutboxPayload({
      event: {
        kind: "member.activated",
        userId: "member_123",
      },
      eventId: "evt_activation_123",
      occurredAt: "2026-04-04T00:00:00.000Z",
    });

    expect((payload as { storage?: unknown }).storage).toBe("inline");
    expect(payload).not.toHaveProperty("stagedPayloadId");
    expect(JSON.stringify(payload)).not.toContain("firstContact");
  });

  it("stores gateway message sends by reference without persisting text or session identifiers", () => {
    const payload = serializeHostedExecutionOutboxPayload({
      event: {
        clientRequestId: "req_123",
        kind: "gateway.message.send",
        replyToMessageId: null,
        sessionKey: "gwcs_secret_123",
        text: "private outbound message",
        userId: "member_123",
      },
      eventId: "evt_gateway_123",
      occurredAt: "2026-04-04T00:00:00.000Z",
    }, {
      stagedPayloadId: buildTestPayloadRef("evt_gateway_123"),
    });

    expect((payload as { storage?: unknown }).storage).toBe("reference");
    expect((payload as { stagedPayloadId?: unknown }).stagedPayloadId)
      .toBe("staged/dispatch-payloads/member_123/evt_gateway_123");
    expect(JSON.stringify(payload)).not.toContain("private outbound message");
    expect(JSON.stringify(payload)).not.toContain("gwcs_secret_123");
    expect(JSON.stringify(payload)).not.toContain("req_123");
  });

  it("rejects forced inline storage for gateway message sends", () => {
    expect(() => serializeHostedExecutionOutboxPayload(
      {
        event: {
          clientRequestId: null,
          kind: "gateway.message.send",
          replyToMessageId: null,
          sessionKey: "gwcs_secret_456",
          text: "still private",
          userId: "member_123",
        },
        eventId: "evt_gateway_456",
        occurredAt: "2026-04-04T00:00:00.000Z",
      },
      {
        storage: "inline",
      },
    )).toThrow("Hosted execution gateway.message.send outbox payloads must use reference storage.");
  });

  it("summarizes settled payloads down to a hashed identity", () => {
    const serialized = serializeHostedExecutionOutboxPayload({
      event: {
        kind: "vault.share.accepted",
        share: {
          ownerUserId: "member_sender",
          shareId: "hshare_123",
        },
        userId: "member_123",
      },
      eventId: "evt_share_summary_123",
      occurredAt: "2026-04-04T00:00:00.000Z",
    });
    const payload = readHostedExecutionOutboxPayload(serialized);

    expect(payload).not.toBeNull();
    if (!payload) {
      return;
    }

    const summary = summarizeHostedExecutionOutboxPayload(payload);

    expect(summary).toMatchObject({
      eventId: "evt_share_summary_123",
      eventKind: "vault.share.accepted",
      occurredAt: "2026-04-04T00:00:00.000Z",
      schema: "murph.hosted-execution-outbox-payload-pruned.v1",
      storage: "pruned",
      userId: "member_123",
    });
    expect(summary).not.toHaveProperty("dispatch");
    expect(readHostedExecutionOutboxPayloadIdentity(summary)).toEqual(
      readHostedExecutionOutboxPayloadIdentity(serialized),
    );
  });
});

function buildTestPayloadRef(eventId: string): string {
  return `staged/dispatch-payloads/member_123/${eventId}`;
}
