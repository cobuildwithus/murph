import { describe, expect, it } from "vitest";

import type { HostedLinqWebhookEvent } from "@/src/lib/hosted-onboarding/linq";
import {
  isHostedLinqAffirmativeReaction,
  parseHostedLinqProviderEvent,
} from "@/src/lib/hosted-onboarding/linq-provider-events";

describe("parseHostedLinqProviderEvent", () => {
  it("parses message.edited telemetry without retaining replacement text", () => {
    const event = buildGenericEvent({
      eventType: "message.edited",
      data: {
        chat: {
          id: "chat_edit",
          is_group: false,
          owner_handle: {
            handle: "+15550000000",
            is_me: true,
            service: "iMessage",
          },
        },
        direction: "inbound",
        edited_at: "2026-07-28T18:00:01.000Z",
        id: "msg_edit",
        part: {
          index: 0,
          text: "private corrected text",
        },
        sender_handle: {
          handle: "+15551234567",
          is_me: false,
          service: "iMessage",
        },
      },
    });
    const parsed = parseHostedLinqProviderEvent({
      event,
      rawBody: JSON.stringify(event),
    });

    expect(parsed).toMatchObject({
      direction: "inbound",
      eventType: "message.edited",
      linqChatId: "chat_edit",
      linqMessageId: "msg_edit",
      phoneNumberRole: "line",
      providerCreatedAt: new Date("2026-07-28T18:00:01.000Z"),
      service: "iMessage",
    });
    expect(JSON.stringify(parsed?.payloadSanitizedJson)).not.toContain(
      "private corrected text",
    );
    expect(JSON.stringify(parsed?.payloadShapeJson)).not.toContain(
      "private corrected text",
    );
  });

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

  it.each([
    {
      data: {
        chat: {
          id: "chat_sent_2026",
          owner_handle: {
            handle: "+15550000000",
            is_me: true,
            service: "SMS",
          },
        },
        direction: "outbound",
        id: "msg_sent_2026",
        parts: [{ type: "text", value: "private sent text" }],
        sent_at: "2026-03-26T12:00:01.000Z",
        service: "SMS",
      },
      messageId: "msg_sent_2026",
      providerCreatedAt: "2026-03-26T12:00:01.000Z",
      version: "2026-02-03",
    },
    {
      data: {
        chat_id: "chat_sent_2025",
        from: "+15550000000",
        from_handle: {
          handle: "+15550000000",
          is_me: true,
          service: "SMS",
        },
        is_from_me: true,
        message: {
          id: "msg_sent_2025",
          parts: [{ type: "text", value: "private sent text" }],
          sent_at: "2026-03-26T12:00:02.000Z",
        },
        service: "SMS",
      },
      messageId: "msg_sent_2025",
      providerCreatedAt: "2026-03-26T12:00:02.000Z",
      version: "2025-01-01",
    },
  ])("parses $version message.sent as non-delivery provider evidence", ({
    data,
    messageId,
    providerCreatedAt,
    version,
  }) => {
    const parsed = parseHostedLinqProviderEvent({
      event: buildGenericEvent({
        createdAt: "2026-03-26T12:00:03.000Z",
        data,
        eventType: "message.sent",
        webhookVersion: version,
      }),
    });

    expect(parsed).toMatchObject({
      deliveryStatus: null,
      direction: "outbound",
      eventType: "message.sent",
      phoneNumberHint: expect.stringContaining("0000"),
      phoneNumberRole: "line",
      providerCreatedAt: new Date(providerCreatedAt),
      service: "SMS",
      webhookVersion: version,
    });
    expect(parsed?.linqChatLookupKey).toEqual(expect.stringMatching(/^hbidx:linq-chat:/u));
    expect(parsed?.messageLookupKey).toEqual(expect.stringMatching(/^hbidx:linq-message:/u));
    expect(parsed?.messageIdSuffix).toBe(messageId.slice(-6));
    expect(JSON.stringify(parsed?.payloadSanitizedJson)).not.toContain("private sent text");
    expect(JSON.stringify(parsed?.payloadShapeJson)).not.toContain("private sent text");
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

  it("keeps provider reason text out of the parsed event whatever the provider embeds", () => {
    // Pattern-based scrubbing cannot recognize these: a national-format phone
    // number, a schemeless URL, a person's name, and a health statement all
    // survive `sanitizeJsonLogString`. Presence-only redaction is what actually
    // holds the boundary, so assert against the leak vectors directly.
    const leaky = [
      "undeliverable to 415-555-2671",
      "see www.example.test/help",
      "blocked after member reported chest pain",
      "recipient handle rejected the send",
    ];

    for (const reason of leaky) {
      const failed = parseHostedLinqProviderEvent({
        event: buildGenericEvent({
          data: {
            error: { code: "30007", message: reason },
            message_id: "msg_failed_leak",
            phone_number: "+15550000000",
          },
          eventType: "message.failed",
        }),
      });
      const status = parseHostedLinqProviderEvent({
        event: buildGenericEvent({
          data: {
            phone_number: "+15550000000",
            reason,
            status: "flagged",
          },
          eventType: "phone_number.status_updated",
        }),
      });

      expect(failed?.failureReason).toBe("[redacted]");
      expect(status?.providerReason).toBe("[redacted]");
      for (const parsed of [failed, status]) {
        const serialized = JSON.stringify(parsed);
        expect(serialized).not.toContain("415-555-2671");
        expect(serialized).not.toContain("www.example.test");
        expect(serialized).not.toContain("chest pain");
        expect(serialized).not.toContain("recipient handle");
      }
    }
  });

  it("parses reaction events for join-offer dispatch without persisting raw handles", () => {
    const parsed = parseHostedLinqProviderEvent({
      event: buildGenericEvent({
        data: {
          chat_id: "chat_123",
          custom_emoji: "👍🏽",
          from_handle: {
            handle: "+15551234567",
            service: "iMessage",
          },
          line: { phone_number: "+15550000000" },
          message_id: "msg_offer_123",
          reacted_at: "2026-03-26T12:01:00.000Z",
          reaction_type: "custom",
        },
        eventType: "reaction.added",
      }),
    });

    expect(parsed).toMatchObject({
      eventType: "reaction.added",
      linqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:/u),
      messageLookupKey: expect.stringMatching(/^hbidx:linq-message:/u),
      phoneNumberRole: "line",
      reactionCustomEmoji: "👍🏽",
      reactionFromHandle: "+15551234567",
      reactionType: "custom",
    });
    expect(parsed?.providerCreatedAt.toISOString()).toBe("2026-03-26T12:01:00.000Z");
    expect(JSON.stringify(parsed?.payloadSanitizedJson)).not.toContain("+15551234567");
    expect(JSON.stringify(parsed?.payloadShapeJson)).not.toContain("+15551234567");
    expect(isHostedLinqAffirmativeReaction({
      customEmoji: parsed?.reactionCustomEmoji,
      eventType: parsed?.eventType ?? "reaction.added",
      reactionType: parsed?.reactionType,
    })).toBe(true);
  });

  it("parses canonical reaction from and part_index fields", () => {
    const parsed = parseHostedLinqProviderEvent({
      event: buildGenericEvent({
        data: {
          chat_id: "chat_123",
          from: "+15551234567",
          is_from_me: false,
          message_id: "msg_123",
          part_index: 0,
          reaction_type: "like",
        },
        eventType: "reaction.added",
      }),
    });

    expect(parsed).toMatchObject({
      reactionFromHandle: "+15551234567",
      reactionIsFromMe: false,
      reactionPartIndex: 0,
    });
  });

  it.each([
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])("ignores unsafe reaction part_index %s", (partIndex) => {
    const parsed = parseHostedLinqProviderEvent({
      event: buildGenericEvent({
        data: {
          chat_id: "chat_123",
          from: "+15551234567",
          message_id: "msg_123",
          part_index: partIndex,
          reaction_type: "like",
        },
        eventType: "reaction.added",
      }),
    });

    expect(parsed?.reactionPartIndex).toBeNull();
  });

  it("parses participant changes without retaining participant identifiers", () => {
    const added = parseHostedLinqProviderEvent({
      event: buildGenericEvent({
        data: {
          added_at: "2026-03-26T12:01:00.000Z",
          chat_id: "chat_group_123",
          participant: {
            handle: "+15551234567",
            id: "participant_private_123",
            service: "iMessage",
          },
        },
        eventType: "participant.added",
      }),
    });
    const removed = parseHostedLinqProviderEvent({
      event: buildGenericEvent({
        data: {
          chat_id: "chat_group_123",
          handle: "person@example.test",
          removed_at: "not-a-provider-timestamp",
        },
        eventType: "participant.removed",
      }),
    });

    expect(added).toMatchObject({
      eventType: "participant.added",
      linqChatLookupKey: expect.stringMatching(/^hbidx:linq-chat:/u),
      phoneNumber: null,
      phoneNumberRole: "unknown",
      providerCreatedAt: new Date("2026-03-26T12:01:00.000Z"),
      service: "iMessage",
    });
    expect(removed).toMatchObject({
      eventType: "participant.removed",
      phoneNumber: null,
      phoneNumberRole: "unknown",
      providerCreatedAt: new Date("2026-03-26T12:00:00.000Z"),
    });
    const persisted = JSON.stringify([added, removed]);
    expect(persisted).not.toContain("+15551234567");
    expect(persisted).not.toContain("person@example.test");
    expect(persisted).not.toContain("participant_private_123");
  });

  it("recognizes the affirmative reaction allowlist deterministically", () => {
    expect(isHostedLinqAffirmativeReaction({
      eventType: "reaction.added",
      reactionType: "love",
    })).toBe(true);
    expect(isHostedLinqAffirmativeReaction({
      customEmoji: "❤️",
      eventType: "reaction.added",
      reactionType: "custom",
    })).toBe(true);
    expect(isHostedLinqAffirmativeReaction({
      customEmoji: "😂",
      eventType: "reaction.added",
      reactionType: "custom",
    })).toBe(false);
    expect(isHostedLinqAffirmativeReaction({
      customEmoji: "👍",
      eventType: "reaction.removed",
      reactionType: "custom",
    })).toBe(false);
  });

  it("stores provider payload shape without raw dynamic webhook keys", () => {
    const parsed = parseHostedLinqProviderEvent({
      event: buildGenericEvent({
        data: {
          failures_by_message: {
            provider_msg_123: {
              "+15551234567": {
                note: "private nested provider text",
              },
            },
          },
          message_id: "msg_failed_123",
          phone_number: "+15550000000",
          service: "sms",
        },
        eventType: "message.failed",
      }),
    });

    expect(parsed?.payloadShapeJson).toMatchObject({
      kind: "object",
      keyCount: expect.any(Number),
      sampleValues: expect.any(Array),
    });
    expect(parsed?.payloadSanitizedJson).toMatchObject({
      created_at: "2026-03-26T12:00:00.000Z",
    });
    // The shape has one home: the sanitized payload must not carry a copy.
    expect(parsed?.payloadSanitizedJson).not.toHaveProperty("data_shape");

    const persistedShape = JSON.stringify(parsed?.payloadShapeJson);
    const persistedSanitizedPayload = JSON.stringify(parsed?.payloadSanitizedJson);
    expect(persistedShape).not.toContain("provider_msg_123");
    expect(persistedShape).not.toContain("+15551234567");
    expect(persistedShape).not.toContain("private nested provider text");
    expect(persistedSanitizedPayload).not.toContain("provider_msg_123");
    expect(persistedSanitizedPayload).not.toContain("+15551234567");
    expect(persistedSanitizedPayload).not.toContain("private nested provider text");
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

  it("keeps phone-number service and reputation status independent", () => {
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
      providerHealth: {
        chat: null,
        line: expect.objectContaining({
          reputationStatus: "CRITICAL",
          serviceStatus: "FLAGGED",
        }),
      },
      providerStatus: "FLAGGED",
    });
  });

  it("does not merge healthy reputation into a flagged service status", () => {
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

  it("uses a deterministic minimum timestamp for malformed provider created_at values", () => {
    const parsed = parseHostedLinqProviderEvent({
      event: buildGenericEvent({
        createdAt: "not-a-date",
        data: {
          message_id: "msg_delivered_123",
          phone_number: "+15550000000",
        },
        eventType: "message.delivered",
      }),
    });

    expect(parsed?.providerCreatedAt).toEqual(new Date(0));
  });

  it("rejects timezone-less generic provider timestamps", () => {
    const parsed = parseHostedLinqProviderEvent({
      event: buildGenericEvent({
        createdAt: "2026-03-26T11:59:59.000Z",
        data: {
          changed_at: "2026-03-26T12:00:00",
          new_reputation: "CRITICAL",
          phone_number: "+15550000000",
        },
        eventType: "phone_number.status_updated",
      }),
    });

    expect(parsed).toMatchObject({
      eventType: "phone_number.status_updated",
      providerCreatedAt: new Date("2026-03-26T11:59:59.000Z"),
      payloadSanitizedJson: expect.objectContaining({
        created_at: "2026-03-26T11:59:59.000Z",
      }),
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
  webhookVersion?: string;
}): HostedLinqWebhookEvent {
  return {
    api_version: "v3",
    created_at: input.createdAt ?? "2026-03-26T12:00:00.000Z",
    data: input.data,
    event_id: "evt_123",
    event_type: input.eventType,
    trace_id: "trace_1234567890",
    webhook_version: input.webhookVersion ?? "2026-02-03",
  } as HostedLinqWebhookEvent;
}
