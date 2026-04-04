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
    });

    expect((payload as { storage?: unknown }).storage).toBe("reference");
    expect(JSON.stringify(payload)).not.toContain("chat_123");
    expect(JSON.stringify(payload)).not.toContain("hbidx:phone:v1:test");
  });
});
