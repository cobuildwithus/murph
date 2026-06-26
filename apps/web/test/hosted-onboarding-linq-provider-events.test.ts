import { describe, expect, it } from "vitest";

import type { HostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq";
import {
  parseHostedLinqProviderEvent,
} from "@/src/lib/hosted-onboarding/linq-provider-events";

describe("parseHostedLinqProviderEvent", () => {
  it("parses message.received telemetry without retaining message text", () => {
    const parsed = parseHostedLinqProviderEvent({
      event: buildMessageReceivedEvent({
        text: "private member text",
      }),
      rawBody: JSON.stringify(buildMessageReceivedEvent({
        text: "private member text",
      })),
    });

    expect(parsed).toMatchObject({
      deliveryStatus: null,
      direction: "inbound",
      eventId: "evt_123",
      eventType: "message.received",
      phoneNumberHint: expect.stringContaining("0000"),
      phoneNumberRole: "line",
      service: "iMessage",
    });
    expect(parsed?.linqChatLookupKey).toEqual(expect.stringMatching(/^hbidx:linq-chat:/u));
    expect(parsed?.messageLookupKey).toEqual(expect.stringMatching(/^hbidx:linq-message:/u));
    expect(JSON.stringify(parsed?.payloadSanitizedJson)).not.toContain("private member text");
    expect(JSON.stringify(parsed?.payloadShapeJson)).not.toContain("private member text");
  });

  it("does not treat outbound recipient_phone as the hosted line", () => {
    const parsed = parseHostedLinqProviderEvent({
      event: buildMessageReceivedEvent({
        direction: "outbound",
        isFromMe: true,
        recipientPhone: "+15551234567",
      }),
    });

    expect(parsed).toMatchObject({
      direction: "outbound",
      phoneNumberHint: expect.stringContaining("0000"),
      phoneNumberRole: "line",
    });
    expect(parsed?.phoneNumberLookupKey).toEqual(expect.stringMatching(/^hbidx:phone:/u));
    expect(JSON.stringify(parsed)).not.toContain("+15551234567");
  });

  it("skips line projection for outbound echoes without a confident hosted line", () => {
    const parsed = parseHostedLinqProviderEvent({
      event: buildMessageReceivedEvent({
        direction: "outbound",
        isFromMe: true,
        ownerHandle: null,
        recipientPhone: "+15551234567",
      }),
    });

    expect(parsed).toMatchObject({
      direction: "outbound",
      phoneNumber: null,
      phoneNumberHint: null,
      phoneNumberLookupKey: null,
      phoneNumberRole: "unknown",
    });
    expect(JSON.stringify(parsed)).not.toContain("+15551234567");
  });

  it("parses delivered and failed events with shape metadata only", () => {
    const delivered = parseHostedLinqProviderEvent({
      event: buildGenericEvent({
        data: {
          chat_id: "chat_123",
          message_id: "msg_delivered_123",
          phone_number: "+15550000000",
          service: "sms",
        },
        eventType: "message.delivered",
      }),
    });
    const failed = parseHostedLinqProviderEvent({
      event: buildGenericEvent({
        data: {
          error: {
            code: "30007",
            message: "carrier filtered +15551234567 provider_msg_123 private text",
          },
          message: "raw chat text must not be treated as failure reason",
          message_id: "msg_failed_123",
          phone_number: "+15550000000",
          service: "sms",
        },
        eventType: "message.failed",
      }),
    });

    expect(delivered).toMatchObject({
      deliveryStatus: "delivered",
      eventType: "message.delivered",
      phoneNumberRole: "line",
    });
    expect(failed).toMatchObject({
      deliveryStatus: "failed",
      eventType: "message.failed",
      failureCode: "30007",
      failureReason: "[redacted]",
      phoneNumberRole: "line",
    });
    expect(JSON.stringify(failed)).not.toContain("provider_msg_123");
    expect(JSON.stringify(failed)).not.toContain("+15551234567");
    expect(JSON.stringify(failed)).not.toContain("private text");
    expect(JSON.stringify(failed?.payloadSanitizedJson)).not.toContain("raw chat text");
    expect(JSON.stringify(failed?.payloadShapeJson)).not.toContain("raw chat text");
  });

  it("redacts free-form provider status reasons before persistence", () => {
    const parsed = parseHostedLinqProviderEvent({
      event: buildGenericEvent({
        data: {
          phone_number: "+15550000000",
          reason: "carrier review for +15551234567 provider_msg_123",
          status: "flagged",
        },
        eventType: "phone_number.status_updated",
      }),
    });

    expect(parsed).toMatchObject({
      eventType: "phone_number.status_updated",
      providerReason: "[redacted]",
      providerStatus: "flagged",
    });
    expect(JSON.stringify(parsed)).not.toContain("+15551234567");
    expect(JSON.stringify(parsed)).not.toContain("provider_msg_123");
  });

  it("parses phone number status updates conservatively", () => {
    const parsed = parseHostedLinqProviderEvent({
      event: buildGenericEvent({
        createdAt: "2026-03-26T11:59:59.000Z",
        data: {
          changed_at: "2026-03-26T12:00:00.000Z",
          new_reputation: "CRITICAL",
          new_status: "FLAGGED",
          phone_number: "+15550000000",
          previous_reputation: "AT_RISK",
          previous_status: "ACTIVE",
        },
        eventType: "phone_number.status_updated",
      }),
    });

    expect(parsed).toMatchObject({
      eventType: "phone_number.status_updated",
      phoneNumberRole: "line",
      providerCreatedAt: new Date("2026-03-26T12:00:00.000Z"),
      providerReason: null,
      providerStatus: "CRITICAL",
    });
  });

  it("does not let healthy reputation mask a flagged provider status", () => {
    const parsed = parseHostedLinqProviderEvent({
      event: buildGenericEvent({
        createdAt: "2026-03-26T11:59:59.000Z",
        data: {
          changed_at: "2026-03-26T12:00:00.000Z",
          new_reputation: "HEALTHY",
          new_status: "FLAGGED",
          phone_number: "+15550000000",
        },
        eventType: "phone_number.status_updated",
      }),
    });

    expect(parsed).toMatchObject({
      eventType: "phone_number.status_updated",
      providerCreatedAt: new Date("2026-03-26T12:00:00.000Z"),
      providerStatus: "FLAGGED",
    });
  });

  it("does not store participant phone lookup keys in the line FK column", () => {
    const parsed = parseHostedLinqProviderEvent({
      event: buildGenericEvent({
        data: {
          message_id: "msg_delivered_123",
          recipient_phone: "+15551234567",
          service: "sms",
        },
        eventType: "message.delivered",
      }),
    });

    expect(parsed).toMatchObject({
      eventType: "message.delivered",
      phoneNumberRole: "participant",
    });
    expect(parsed?.phoneNumberLookupKey).toBeNull();
    expect(parsed?.phoneNumberHint).toBeNull();
  });

  it("ignores unsupported Linq event types", () => {
    expect(parseHostedLinqProviderEvent({
      event: buildGenericEvent({
        data: {},
        eventType: "chat.typing_indicator.started",
      }),
    })).toBeNull();
  });
});

function buildMessageReceivedEvent(input: {
  direction?: "inbound" | "outbound";
  isFromMe?: boolean;
  ownerHandle?: string | null;
  recipientPhone?: string | null;
  text?: string;
} = {}): HostedLinqWebhookEvent {
  const isFromMe = input.isFromMe ?? false;
  const ownerHandle = input.ownerHandle === undefined ? "+15550000000" : input.ownerHandle;
  return {
    api_version: "v3",
    created_at: "2026-03-26T12:00:00.000Z",
    data: {
      chat: {
        id: "chat_123",
        owner_handle: ownerHandle
          ? {
              handle: ownerHandle,
              id: "handle_owner_123",
              is_me: true,
              service: "iMessage",
            }
          : null,
      },
      direction: input.direction ?? (isFromMe ? "outbound" : "inbound"),
      id: "msg_123",
      is_from_me: isFromMe,
      parts: [
        {
          type: "text",
          value: input.text ?? "hello",
        },
      ],
      recipient_phone: input.recipientPhone ?? undefined,
      sender_handle: {
        handle: "+15551234567",
        id: "handle_sender_123",
        is_me: false,
        service: "iMessage",
      },
      sent_at: "2026-03-26T12:00:00.000Z",
      service: "iMessage",
    },
    event_id: "evt_123",
    event_type: "message.received",
    trace_id: "trace_1234567890",
    webhook_version: "2026-02-03",
  } as HostedLinqWebhookEvent;
}

function buildGenericEvent(input: {
  createdAt?: string;
  data: Record<string, unknown>;
  eventType: string;
}): HostedLinqWebhookEvent {
  return {
    api_version: "v3",
    created_at: input.createdAt ?? "2026-03-26T12:00:00.000Z",
    data: input.data,
    event_id: "evt_123",
    event_type: input.eventType,
    trace_id: "trace_1234567890",
    webhook_version: "2026-02-03",
  } as HostedLinqWebhookEvent;
}
