import { describe, expect, it } from "vitest";

import type { HostedExecutionTelegramAttachment } from "../src/contracts.ts";

import {
  buildHostedExecutionAssistantCronTickWake,
  buildHostedExecutionConversationMessageWake,
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionMemberChannelsUpdatedWake,
  buildHostedExecutionTelegramConversationMessageWake,
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionVaultShareAcceptedWake,
  buildHostedWakeEmailMessageReceivedPayload,
  buildHostedWakeLinqMessageReceivedPayload,
  buildHostedWakeTelegramMessageReceivedPayload,
} from "../src/builders.ts";
import {
  readHostedEmailCapabilities,
  resolveHostedEmailSelfAddresses,
  resolveHostedEmailSenderIdentity,
} from "../src/hosted-email.ts";

const occurredAt = "2026-04-08T00:00:00.000Z";
const defaultMemberChannels = {
  email: false,
  linq: false,
  telegram: false,
} as const;

describe("hosted execution wake builders", () => {
  it("preserves optional member activation first-contact data when present", () => {
    const wake = buildHostedExecutionMemberActivatedWake({
      eventId: "member-activated-1",
      firstContact: {
        channel: "email",
        identityId: "assistant@example.com",
        threadId: "thread_123",
        threadIsDirect: true,
      },
      memberId: "user_123",
      memberChannels: defaultMemberChannels,
      occurredAt,
    });

    expect(wake).toMatchObject({
      eventId: "member-activated-1",
      firstContact: {
        channel: "email",
        identityId: "assistant@example.com",
        threadId: "thread_123",
        threadIsDirect: true,
      },
      kind: "member.activated",
      userId: "user_123",
    });
  });

  it("copies member channel updates into a standalone wake", () => {
    const memberChannels = {
      email: true,
      linq: false,
      telegram: true,
    } as const;
    const wake = buildHostedExecutionMemberChannelsUpdatedWake({
      eventId: "member-channels-1",
      memberChannels,
      memberId: "user_123",
      occurredAt,
    });

    expect(wake).toEqual({
      eventId: "member-channels-1",
      kind: "member.channels.updated",
      memberChannels,
      occurredAt,
      userId: "user_123",
    });
    expect(wake.memberChannels).not.toBe(memberChannels);
  });

  it("copies linq event objects and preserves explicit null message ids", () => {
    const linqEvent = {
      delivery: "incoming",
      nested: { traceId: "trace_123" },
    };
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "linq-1",
      linqEvent,
      linqMessageId: null,
      occurredAt,
      phoneLookupKey: "phone_lookup_123",
      userId: "user_123",
    });

    linqEvent.delivery = "mutated";

    expect(wake.message).toEqual({
      channel: "linq",
      linqEvent: {
        delivery: "incoming",
        nested: { traceId: "trace_123" },
      },
      linqMessageId: null,
      phoneLookupKey: "phone_lookup_123",
    });
    expect(wake.message.linqEvent).not.toBe(linqEvent);
  });

  it("deep-copies telegram attachment arrays and attachment entries", () => {
    const attachments: HostedExecutionTelegramAttachment[] = [
      {
        fileId: "file_1",
        fileName: "photo.jpg",
        kind: "photo",
      },
    ];
    const wake = buildHostedExecutionTelegramConversationMessageWake({
      eventId: "telegram-1",
      occurredAt,
      telegramMessage: {
        attachments,
        messageId: "message_123",
        schema: "murph.hosted-telegram-message.v1",
        text: "hello",
        threadId: "thread_123",
      },
      userId: "user_123",
    });

    attachments[0]!.fileName = "mutated.jpg";
    attachments.push({
      fileId: "file_2",
      kind: "document",
    });

    if (wake.message.channel !== "telegram") {
      throw new Error("Expected a telegram wake message.");
    }

    expect(wake.message.telegramMessage.attachments).toEqual([
      {
        fileId: "file_1",
        fileName: "photo.jpg",
        kind: "photo",
      },
    ]);
    expect(wake.message.telegramMessage.attachments).not.toBe(attachments);
    expect(wake.message.telegramMessage.attachments?.[0]).not.toBe(attachments[0]);
  });

  it("distinguishes omitted versus explicit nullable email self addresses", () => {
    const omitted = buildHostedExecutionEmailConversationMessageWake({
      eventId: "email-omitted",
      identityId: "identity_123",
      occurredAt,
      rawMessageKey: "raw_123",
      userId: "user_123",
    });
    const explicitNull = buildHostedExecutionEmailConversationMessageWake({
      eventId: "email-null",
      identityId: "identity_123",
      occurredAt,
      rawMessageKey: "raw_123",
      selfAddress: null,
      userId: "user_123",
    });

    if (omitted.message.channel !== "email" || explicitNull.message.channel !== "email") {
      throw new Error("Expected email wake messages.");
    }

    expect("selfAddress" in omitted.message).toBe(false);
    expect(explicitNull.message.selfAddress).toBeNull();
  });

  it("builds direct system wakes", () => {
    expect(
      buildHostedExecutionAssistantCronTickWake({
        eventId: "cron-1",
        occurredAt,
        reason: "manual",
        userId: "user_123",
      }),
    ).toEqual({
      eventId: "cron-1",
      kind: "assistant.cron.tick",
      occurredAt,
      reason: "manual",
      userId: "user_123",
    });

    expect(
      buildHostedExecutionDeviceSyncWake({
        connectionId: null,
        eventId: "device-sync-1",
        hint: null,
        occurredAt,
        provider: null,
        reason: "connected",
        userId: "user_123",
      }),
    ).toEqual({
      connectionId: null,
      eventId: "device-sync-1",
      hint: null,
      kind: "device-sync.wake",
      occurredAt,
      provider: null,
      reason: "connected",
      userId: "user_123",
    });

    expect(
      buildHostedExecutionVaultShareAcceptedWake({
        eventId: "share-accepted-1",
        memberId: "user_123",
        occurredAt,
        share: {
          ownerUserId: "owner_123",
          shareId: "share_123",
        },
      }),
    ).toEqual({
      eventId: "share-accepted-1",
      kind: "vault.share.accepted",
      occurredAt,
      share: {
        ownerUserId: "owner_123",
        shareId: "share_123",
      },
      userId: "user_123",
    });
  });

  it("builds generic conversation wakes without mutating caller-owned data", () => {
    const linqEvent = {
      delivery: "incoming",
      nested: {
        traceId: "trace_123",
      },
    };
    const wake = buildHostedExecutionConversationMessageWake({
      eventId: "conversation-linq-1",
      message: {
        channel: "linq",
        linqEvent,
        linqMessageId: null,
        phoneLookupKey: "phone_lookup_123",
      },
      occurredAt,
      userId: "user_123",
    });

    linqEvent.delivery = "mutated";

    expect(wake).toEqual({
      eventId: "conversation-linq-1",
      kind: "conversation.message",
      message: {
        channel: "linq",
        linqEvent: {
          delivery: "incoming",
          nested: {
            traceId: "trace_123",
          },
        },
        linqMessageId: null,
        phoneLookupKey: "phone_lookup_123",
      },
      occurredAt,
      userId: "user_123",
    });
  });

  it("builds hosted wake payload helpers without mutating caller-owned message data", () => {
    const linqEvent = {
      delivery: "incoming",
    };
    const linqPayload = buildHostedWakeLinqMessageReceivedPayload({
      eventId: "linq-payload-1",
      linqEvent,
      phoneLookupKey: "phone_lookup_789",
    });

    linqEvent.delivery = "mutated";

    expect(linqPayload).toEqual({
      channel: "linq",
      eventId: "linq-payload-1",
      linqEvent: {
        delivery: "incoming",
      },
      phoneLookupKey: "phone_lookup_789",
    });

    const attachments: HostedExecutionTelegramAttachment[] = [
      {
        fileId: "file_payload_1",
        fileName: "receipt.jpg",
        kind: "photo",
      },
    ];
    const telegramPayload = buildHostedWakeTelegramMessageReceivedPayload({
      eventId: "telegram-payload-1",
      telegramMessage: {
        attachments,
        messageId: "message_payload_1",
        schema: "murph.hosted-telegram-message.v1",
        text: "hello payload",
        threadId: "thread_payload_1",
      },
    });

    attachments[0]!.fileName = "mutated.jpg";

    expect(telegramPayload).toEqual({
      channel: "telegram",
      eventId: "telegram-payload-1",
      telegramMessage: {
        attachments: [
          {
            fileId: "file_payload_1",
            fileName: "receipt.jpg",
            kind: "photo",
          },
        ],
        messageId: "message_payload_1",
        schema: "murph.hosted-telegram-message.v1",
        text: "hello payload",
        threadId: "thread_payload_1",
      },
    });

    expect(buildHostedWakeEmailMessageReceivedPayload({
      eventId: "email-payload-2",
      identityId: null,
      rawMessageKey: "raw_payload_2",
      selfAddress: null,
    })).toEqual({
      channel: "email",
      eventId: "email-payload-2",
      identityId: null,
      rawMessageKey: "raw_payload_2",
      selfAddress: null,
    });
  });
});

describe("hosted email helpers", () => {
  it("prefers and normalizes an explicit sender identity", () => {
    expect(resolveHostedEmailSenderIdentity({
      HOSTED_EMAIL_DOMAIN: "example.com",
      HOSTED_EMAIL_FROM_ADDRESS: "Murph Assistant <Assistant+Ops@Example.com>",
      HOSTED_EMAIL_LOCAL_PART: "ignored",
    })).toBe("assistant+ops@example.com");
  });

  it("infers a sender identity from local part and domain defaults", () => {
    expect(resolveHostedEmailSenderIdentity({
      HOSTED_EMAIL_DOMAIN: "Example.com",
      HOSTED_EMAIL_LOCAL_PART: "Support",
    })).toBe("support@example.com");

    expect(resolveHostedEmailSenderIdentity({
      HOSTED_EMAIL_DOMAIN: "Example.com",
    })).toBe("assistant@example.com");
  });

  it("derives capabilities from env defaults and explicit flags", () => {
    expect(readHostedEmailCapabilities({
      HOSTED_EMAIL: {
        send: async (_message: unknown) => undefined,
      },
      HOSTED_EMAIL_DOMAIN: "example.com",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SIGNING_SECRET: "secret_123",
    })).toEqual({
      ingressReady: true,
      sendReady: true,
      senderIdentity: "assistant@example.com",
    });

    expect(readHostedEmailCapabilities({
      HOSTED_EMAIL_DOMAIN: "example.com",
      HOSTED_EMAIL_FROM_ADDRESS: "assistant@example.com",
      HOSTED_EMAIL_INGRESS_READY: "false",
      HOSTED_EMAIL_SEND_READY: "1",
    })).toEqual({
      ingressReady: false,
      sendReady: false,
      senderIdentity: "assistant@example.com",
    });
  });

  it("dedupes and normalizes self addresses", () => {
    expect(resolveHostedEmailSelfAddresses({
      extra: ["Assistant+Route@Example.com", "assistant@example.com"],
      senderIdentity: "Assistant@Example.com",
    })).toEqual([
      "assistant@example.com",
      "assistant+route@example.com",
    ]);
  });
});
