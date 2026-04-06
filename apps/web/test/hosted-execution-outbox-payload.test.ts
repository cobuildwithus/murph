import { describe, expect, it } from "vitest";

import { serializeHostedExecutionOutboxPayload } from "@/src/lib/hosted-execution/outbox-payload";

describe("hosted execution outbox payload storage", () => {
  it("stores hosted share acceptance by reference without persisting the share id inline", () => {
    const payload = serializeHostedExecutionOutboxPayload({
      event: {
        kind: "vault.share.accepted",
        share: {
          shareId: "hshare_123",
        },
        userId: "member_123",
      },
      eventId: "evt_share_123",
      occurredAt: "2026-04-04T00:00:00.000Z",
    }, {
      payloadRef: buildTestPayloadRef("evt_share_123"),
    });

    expect((payload as { storage?: unknown }).storage).toBe("reference");
    expect(JSON.stringify(payload)).not.toContain("hshare_123");
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
      payloadRef: buildTestPayloadRef("evt_wake_123"),
    });

    expect((payload as { storage?: unknown }).storage).toBe("reference");
    expect(JSON.stringify(payload)).not.toContain("sleep.updated");
    expect(JSON.stringify(payload)).not.toContain("trace_123");
  });

  it("stores member activation first-contact targets by reference", () => {
    const payload = serializeHostedExecutionOutboxPayload({
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
      eventId: "evt_activation_123",
      occurredAt: "2026-04-04T00:00:00.000Z",
    }, {
      payloadRef: buildTestPayloadRef("evt_activation_123"),
    });

    expect((payload as { storage?: unknown }).storage).toBe("reference");
    expect(JSON.stringify(payload)).not.toContain("chat_123");
    expect(JSON.stringify(payload)).not.toContain("hbidx:phone:v1:test");
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
      payloadRef: buildTestPayloadRef("evt_gateway_123"),
    });

    expect((payload as { storage?: unknown }).storage).toBe("reference");
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
});

function buildTestPayloadRef(eventId: string): { key: string } {
  return {
    key: `transient/dispatch-payloads/member_123/${eventId}.json`,
  };
}
