import { describe, expect, it } from "vitest";

import {
  areHostedExecutionDispatchPayloadsEquivalent,
  readHostedExecutionDispatchPayload,
  serializeHostedExecutionDispatchPayload,
  summarizeHostedExecutionDispatchPayload,
} from "@/src/lib/hosted-execution/dispatch-payload";

describe("hosted execution dispatch payload storage", () => {
  it("stores hosted share acceptance inline as a tiny share ref", () => {
    const payload = serializeHostedExecutionDispatchPayload({
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
    const payload = serializeHostedExecutionDispatchPayload({
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
    expect(summarizeHostedExecutionDispatchPayload(
      readHostedExecutionDispatchPayload(payload) as NonNullable<
        ReturnType<typeof readHostedExecutionDispatchPayload>
      >,
    )).toEqual({
      dispatchRef: {
        eventId: "evt_wake_123",
        eventKind: "device-sync.wake",
        occurredAt: "2026-04-04T00:00:00.000Z",
        userId: "member_123",
      },
      payloadHash: expect.any(String),
      schema: "murph.hosted-execution-inline-dispatch-payload-pruned.v1",
      storage: "pruned",
    });
  });

  it("stores member activation inline when first contact is omitted", () => {
    const payload = serializeHostedExecutionDispatchPayload({
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
    const payload = serializeHostedExecutionDispatchPayload({
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

  it("stores Linq webhook payloads inline when the web layer serializes them directly", () => {
    const payload = serializeHostedExecutionDispatchPayload({
      event: {
        kind: "linq.message.received",
        linqEvent: {
          body: "private inbound message",
          sender: "+15551234567",
        },
        linqMessageId: "linq_msg_123",
        phoneLookupKey: "hbidx:phone:v1:secret",
        userId: "member_123",
      },
      eventId: "evt_linq_123",
      occurredAt: "2026-04-04T00:00:00.000Z",
    });

    expect((payload as { storage?: unknown }).storage).toBe("inline");
    expect(payload).not.toHaveProperty("stagedPayloadId");
    expect(JSON.stringify(payload)).toContain("private inbound message");
    expect(JSON.stringify(payload)).toContain("+15551234567");
    expect(JSON.stringify(payload)).toContain("linq_msg_123");
  });

  it("ignores legacy storage hints and still serializes direct outbox payloads inline", () => {
    const payload = serializeHostedExecutionDispatchPayload({
      event: {
        kind: "linq.message.received",
        linqEvent: {
          body: "still private",
        },
        linqMessageId: null,
        phoneLookupKey: "hbidx:phone:v1:legacy",
        userId: "member_123",
      },
      eventId: "evt_linq_456",
      occurredAt: "2026-04-04T00:00:00.000Z",
    });

    expect((payload as { storage?: unknown }).storage).toBe("inline");
    expect(payload).not.toHaveProperty("stagedPayloadId");
  });

  it("summarizes settled inline payloads down to a hashed inline dispatch ref", () => {
    const serialized = serializeHostedExecutionDispatchPayload({
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
    const payload = readHostedExecutionDispatchPayload(serialized);

    expect(payload).not.toBeNull();
    if (!payload) {
      return;
    }

    const summary = summarizeHostedExecutionDispatchPayload(payload);

    expect(summary).toMatchObject({
      dispatchRef: {
        eventId: "evt_share_summary_123",
        eventKind: "vault.share.accepted",
        occurredAt: "2026-04-04T00:00:00.000Z",
        userId: "member_123",
      },
      schema: "murph.hosted-execution-inline-dispatch-payload-pruned.v1",
      storage: "pruned",
    });
    expect(summary).not.toHaveProperty("dispatch");
    expect(areHostedExecutionDispatchPayloadsEquivalent(summary, serialized)).toBe(true);
  });

  it("rejects malformed pruned inline payload summaries", () => {
    const serialized = serializeHostedExecutionDispatchPayload({
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
    const summary = summarizeHostedExecutionDispatchPayload(
      readHostedExecutionDispatchPayload(serialized) as NonNullable<
        ReturnType<typeof readHostedExecutionDispatchPayload>
      >,
    );

    expect(summary).not.toBeNull();
    if (!summary) {
      throw new Error("Expected a pruned inline payload summary.");
    }

    expect(areHostedExecutionDispatchPayloadsEquivalent({
      dispatchRef: {
        eventId: "evt_activation_123",
        eventKind: "device-sync.wake",
        occurredAt: "2026-04-04T00:00:00.000Z",
        userId: "member_123",
      },
      payloadHash: summary.payloadHash,
      schema: "murph.hosted-execution-inline-dispatch-payload-pruned.v1",
      storage: "pruned",
    }, serialized)).toBe(false);
  });

  it("treats pruned inline Linq payload summaries as idempotent equivalents", () => {
    const serialized = serializeHostedExecutionDispatchPayload({
      event: {
        kind: "linq.message.received",
        linqEvent: {
          body: "private inbound message",
          sender: "+15551234567",
        },
        linqMessageId: "linq_msg_123",
        phoneLookupKey: "hbidx:phone:v1:secret",
        userId: "member_123",
      },
      eventId: "evt_linq_123",
      occurredAt: "2026-04-04T00:00:00.000Z",
    });
    const payload = readHostedExecutionDispatchPayload(serialized);

    expect(payload).not.toBeNull();
    if (!payload) {
      throw new Error("Expected an inline payload.");
    }

    const summary = summarizeHostedExecutionDispatchPayload(payload);

    expect(summary).toEqual({
      dispatchRef: {
        eventId: "evt_linq_123",
        eventKind: "linq.message.received",
        occurredAt: "2026-04-04T00:00:00.000Z",
        userId: "member_123",
      },
      payloadHash: expect.any(String),
      schema: "murph.hosted-execution-inline-dispatch-payload-pruned.v1",
      storage: "pruned",
    });
    expect(areHostedExecutionDispatchPayloadsEquivalent(summary, serialized)).toBe(true);
  });
});
