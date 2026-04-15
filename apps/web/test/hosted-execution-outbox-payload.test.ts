import { describe, expect, it } from "vitest";

import {
  areHostedExecutionOutboxPayloadsEquivalent,
  readHostedExecutionOutboxPayload,
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

  it("stores device-sync wake events inline in the web-owned outbox row", () => {
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

    expect((payload as { storage?: unknown }).storage).toBe("inline");
    expect(payload).not.toHaveProperty("stagedPayloadId");
    expect(JSON.stringify(payload)).toContain("sleep.updated");
    expect(JSON.stringify(payload)).toContain("trace_123");
    expect(summarizeHostedExecutionOutboxPayload(
      readHostedExecutionOutboxPayload(payload) as NonNullable<
        ReturnType<typeof readHostedExecutionOutboxPayload>
      >,
    )).toEqual({
      dispatchRef: {
        eventId: "evt_wake_123",
        eventKind: "device-sync.wake",
        occurredAt: "2026-04-04T00:00:00.000Z",
        userId: "member_123",
      },
      payloadHash: expect.any(String),
      schema: "murph.hosted-execution-inline-outbox-payload-pruned.v1",
      storage: "pruned",
    });
  });

  it("stores member activation inline when first contact is omitted", () => {
    const payload = serializeHostedExecutionOutboxPayload({
      event: {
        kind: "member.activated",
        memberChannels: {
          email: false,
          linq: true,
          telegram: false,
        },
        userId: "member_123",
      },
      eventId: "evt_activation_123",
      occurredAt: "2026-04-04T00:00:00.000Z",
    });

    expect((payload as { storage?: unknown }).storage).toBe("inline");
    expect(payload).not.toHaveProperty("stagedPayloadId");
    expect(JSON.stringify(payload)).not.toContain("firstContact");
  });

  it("stores member channel sync inline as a compact explicit channel snapshot", () => {
    const payload = serializeHostedExecutionOutboxPayload({
      event: {
        kind: "member.channels.updated",
        memberChannels: {
          email: true,
          linq: false,
          telegram: true,
        },
        userId: "member_123",
      },
      eventId: "evt_member_channels_123",
      occurredAt: "2026-04-04T00:00:00.000Z",
    });

    expect((payload as { storage?: unknown }).storage).toBe("inline");
    expect(payload).not.toHaveProperty("stagedPayloadId");
    expect(JSON.stringify(payload)).toContain("\"memberChannels\"");
  });

  it("stores gateway message sends inline when the web layer serializes them directly", () => {
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
    });

    expect((payload as { storage?: unknown }).storage).toBe("inline");
    expect(payload).not.toHaveProperty("stagedPayloadId");
    expect(JSON.stringify(payload)).toContain("private outbound message");
    expect(JSON.stringify(payload)).toContain("gwcs_secret_123");
    expect(JSON.stringify(payload)).toContain("req_123");
  });

  it("ignores legacy storage hints and still serializes direct outbox payloads inline", () => {
    const payload = serializeHostedExecutionOutboxPayload(
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
    );

    expect((payload as { storage?: unknown }).storage).toBe("inline");
    expect(payload).not.toHaveProperty("stagedPayloadId");
  });

  it("summarizes settled inline payloads down to a hashed inline dispatch ref", () => {
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
      dispatchRef: {
        eventId: "evt_share_summary_123",
        eventKind: "vault.share.accepted",
        occurredAt: "2026-04-04T00:00:00.000Z",
        userId: "member_123",
      },
      schema: "murph.hosted-execution-inline-outbox-payload-pruned.v1",
      storage: "pruned",
    });
    expect(summary).not.toHaveProperty("dispatch");
    expect(areHostedExecutionOutboxPayloadsEquivalent(summary, serialized)).toBe(true);
  });

  it("rejects malformed pruned inline payload summaries", () => {
    const serialized = serializeHostedExecutionOutboxPayload({
      event: {
        kind: "member.activated",
        memberChannels: {
          email: false,
          linq: false,
          telegram: false,
        },
        userId: "member_123",
      },
      eventId: "evt_activation_123",
      occurredAt: "2026-04-04T00:00:00.000Z",
    });
    const summary = summarizeHostedExecutionOutboxPayload(
      readHostedExecutionOutboxPayload(serialized) as NonNullable<
        ReturnType<typeof readHostedExecutionOutboxPayload>
      >,
    );

    expect(summary).not.toBeNull();
    if (!summary) {
      throw new Error("Expected a pruned inline payload summary.");
    }

    expect(areHostedExecutionOutboxPayloadsEquivalent({
      dispatchRef: {
        eventId: "evt_activation_123",
        eventKind: "device-sync.wake",
        occurredAt: "2026-04-04T00:00:00.000Z",
        userId: "member_123",
      },
      payloadHash: summary.payloadHash,
      schema: "murph.hosted-execution-inline-outbox-payload-pruned.v1",
      storage: "pruned",
    }, serialized)).toBe(false);
  });

  it("treats pruned inline gateway payload summaries as idempotent equivalents", () => {
    const serialized = serializeHostedExecutionOutboxPayload({
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
    });
    const payload = readHostedExecutionOutboxPayload(serialized);

    expect(payload).not.toBeNull();
    if (!payload) {
      throw new Error("Expected an inline payload.");
    }

    const summary = summarizeHostedExecutionOutboxPayload(payload);

    expect(summary).toEqual({
      dispatchRef: {
        eventId: "evt_gateway_123",
        eventKind: "gateway.message.send",
        occurredAt: "2026-04-04T00:00:00.000Z",
        userId: "member_123",
      },
      payloadHash: expect.any(String),
      schema: "murph.hosted-execution-inline-outbox-payload-pruned.v1",
      storage: "pruned",
    });
    expect(areHostedExecutionOutboxPayloadsEquivalent(summary, serialized)).toBe(true);
  });
});
