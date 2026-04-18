import { describe, expect, it } from "vitest";

import type { HostedExecutionTelegramAttachment } from "../src/contracts.ts";

import {
  buildHostedExecutionAssistantCronTickDispatch,
  buildHostedExecutionConversationMessageWake,
  buildHostedExecutionEmailMessageReceivedDispatch,
  buildHostedExecutionDispatchFromWake,
  buildHostedExecutionLinqMessageReceivedDispatch,
  buildHostedExecutionMemberActivatedDispatch,
  buildHostedExecutionMemberChannelsUpdatedDispatch,
  buildHostedExecutionTelegramMessageReceivedDispatch,
  buildHostedExecutionDeviceSyncWakeDispatch,
  buildHostedExecutionVaultShareAcceptedDispatch,
  buildHostedExecutionWakeFromDispatch,
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

describe("hosted execution builders", () => {
  it("preserves optional member activation first-contact data when present", () => {
    const dispatch = buildHostedExecutionMemberActivatedDispatch({
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

    expect(dispatch.event).toMatchObject({
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

  it("omits optional member activation first-contact data when absent", () => {
    const dispatch = buildHostedExecutionMemberActivatedDispatch({
      eventId: "member-activated-2",
      memberId: "user_456",
      memberChannels: defaultMemberChannels,
      occurredAt,
    });

    expect(dispatch).toEqual({
      event: {
        kind: "member.activated",
        memberChannels: defaultMemberChannels,
        userId: "user_456",
      },
      eventId: "member-activated-2",
      occurredAt,
    });
    expect("firstContact" in dispatch.event).toBe(false);
  });

  it("preserves Linq home-thread materialization first-contact data when present", () => {
    const dispatch = buildHostedExecutionMemberActivatedDispatch({
      eventId: "member-activated-linq-home",
      firstContact: {
        channel: "linq",
        fromPhoneNumber: "+15550001111",
        identityId: "hbidx:phone:v1:test",
        kind: "linq-materialize-home-thread",
        toPhoneNumber: "+15550002222",
      },
      memberId: "user_123",
      memberChannels: defaultMemberChannels,
      occurredAt,
    });

    expect(dispatch.event).toMatchObject({
      firstContact: {
        channel: "linq",
        fromPhoneNumber: "+15550001111",
        identityId: "hbidx:phone:v1:test",
        kind: "linq-materialize-home-thread",
        toPhoneNumber: "+15550002222",
      },
      kind: "member.activated",
      userId: "user_123",
    });
  });

  it("copies member channel updates into a standalone dispatch", () => {
    const memberChannels = {
      email: true,
      linq: false,
      telegram: true,
    } as const;
    const dispatch = buildHostedExecutionMemberChannelsUpdatedDispatch({
      eventId: "member-channels-1",
      memberChannels,
      memberId: "user_123",
      occurredAt,
    });

    expect(dispatch).toEqual({
      event: {
        kind: "member.channels.updated",
        memberChannels,
        userId: "user_123",
      },
      eventId: "member-channels-1",
      occurredAt,
    });
    if (dispatch.event.kind !== "member.channels.updated") {
      throw new Error("Expected a member.channels.updated event.");
    }
    expect(dispatch.event.memberChannels).not.toBe(memberChannels);
  });

  it("copies linq event objects and preserves explicit null message ids", () => {
    const linqEvent = {
      delivery: "incoming",
      nested: { traceId: "trace_123" },
    };
    const dispatch = buildHostedExecutionLinqMessageReceivedDispatch({
      eventId: "linq-1",
      linqEvent,
      linqMessageId: null,
      occurredAt,
      phoneLookupKey: "phone_lookup_123",
      userId: "user_123",
    });

    linqEvent.delivery = "mutated";

    expect(dispatch.event.kind).toBe("linq.message.received");
    if (dispatch.event.kind !== "linq.message.received") {
      throw new Error("Expected a linq.message.received event.");
    }

    expect(dispatch.event.linqEvent).toEqual({
      delivery: "incoming",
      nested: { traceId: "trace_123" },
    });
    expect(dispatch.event.linqEvent).not.toBe(linqEvent);
    expect(dispatch.event.linqMessageId).toBeNull();
  });

  it("deep-copies telegram attachment arrays and attachment entries", () => {
    const attachments: HostedExecutionTelegramAttachment[] = [
      {
        fileId: "file_1",
        fileName: "photo.jpg",
        kind: "photo",
      },
    ];
    const dispatch = buildHostedExecutionTelegramMessageReceivedDispatch({
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

    if (dispatch.event.kind !== "telegram.message.received") {
      throw new Error("Expected a telegram.message.received event.");
    }

    expect(dispatch.event.telegramMessage.attachments).toEqual([
      {
        fileId: "file_1",
        fileName: "photo.jpg",
        kind: "photo",
      },
    ]);
    expect(dispatch.event.telegramMessage.attachments).not.toBe(attachments);
    expect(dispatch.event.telegramMessage.attachments?.[0]).not.toBe(attachments[0]);
  });

  it("keeps telegram messages without attachments free of synthetic attachment fields", () => {
    const dispatch = buildHostedExecutionTelegramMessageReceivedDispatch({
      eventId: "telegram-2",
      occurredAt,
      telegramMessage: {
        messageId: "message_456",
        schema: "murph.hosted-telegram-message.v1",
        text: "hello again",
        threadId: "thread_456",
      },
      userId: "user_123",
    });

    if (dispatch.event.kind !== "telegram.message.received") {
      throw new Error("Expected a telegram.message.received event.");
    }

    expect(dispatch.event.telegramMessage).not.toHaveProperty("attachments");
  });

  it("distinguishes omitted versus explicit nullable email self addresses", () => {
    const omitted = buildHostedExecutionEmailMessageReceivedDispatch({
      eventId: "email-omitted",
      identityId: "identity_123",
      occurredAt,
      rawMessageKey: "raw_123",
      userId: "user_123",
    });
    const explicitNull = buildHostedExecutionEmailMessageReceivedDispatch({
      eventId: "email-null",
      identityId: "identity_123",
      occurredAt,
      rawMessageKey: "raw_123",
      selfAddress: null,
      userId: "user_123",
    });

    expect("selfAddress" in omitted.event).toBe(false);
    expect(explicitNull.event).toMatchObject({
      kind: "email.message.received",
      selfAddress: null,
    });
  });

  it("builds assistant cron tick dispatches directly", () => {
    expect(
      buildHostedExecutionAssistantCronTickDispatch({
        eventId: "cron-1",
        occurredAt,
        reason: "manual",
        userId: "user_123",
      }),
    ).toEqual({
      event: {
        kind: "assistant.cron.tick",
        reason: "manual",
        userId: "user_123",
      },
      eventId: "cron-1",
      occurredAt,
    });
  });

  it("omits optional linq and device-sync fields when not provided and preserves explicit nulls when they are", () => {
    const linqDispatch = buildHostedExecutionLinqMessageReceivedDispatch({
      eventId: "linq-2",
      linqEvent: { delivery: "incoming" },
      occurredAt,
      phoneLookupKey: "phone_lookup_456",
      userId: "user_123",
    });
    const deviceSyncDispatch = buildHostedExecutionDeviceSyncWakeDispatch({
      connectionId: null,
      eventId: "device-sync-1",
      hint: null,
      occurredAt,
      provider: null,
      reason: "connected",
      userId: "user_123",
    });

    expect(linqDispatch.event).not.toHaveProperty("linqMessageId");
    expect(deviceSyncDispatch.event).toMatchObject({
      connectionId: null,
      hint: null,
      kind: "device-sync.wake",
      provider: null,
      reason: "connected",
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
    expect("linqMessageId" in linqPayload).toBe(false);

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
    attachments.push({
      fileId: "file_payload_2",
      kind: "document",
    });

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

    const emailPayload = buildHostedWakeEmailMessageReceivedPayload({
      eventId: "email-payload-1",
      identityId: "identity_payload_1",
      rawMessageKey: "raw_payload_1",
    });
    const emailPayloadWithNull = buildHostedWakeEmailMessageReceivedPayload({
      eventId: "email-payload-2",
      identityId: null,
      rawMessageKey: "raw_payload_2",
      selfAddress: null,
    });

    expect(emailPayload).toEqual({
      channel: "email",
      eventId: "email-payload-1",
      identityId: "identity_payload_1",
      rawMessageKey: "raw_payload_1",
    });
    expect("selfAddress" in emailPayload).toBe(false);
    expect(emailPayloadWithNull).toEqual({
      channel: "email",
      eventId: "email-payload-2",
      identityId: null,
      rawMessageKey: "raw_payload_2",
      selfAddress: null,
    });
  });

  it("builds vault-share accepted dispatches directly", () => {
    expect(
      buildHostedExecutionVaultShareAcceptedDispatch({
        eventId: "share-accepted-1",
        memberId: "user_123",
        occurredAt,
        share: {
          ownerUserId: "owner_123",
          shareId: "share_123",
        },
      }),
    ).toEqual({
      event: {
        kind: "vault.share.accepted",
        share: {
          ownerUserId: "owner_123",
          shareId: "share_123",
        },
        userId: "user_123",
      },
      eventId: "share-accepted-1",
      occurredAt,
    });
  });

  it("roundtrips hosted conversation wakes through dispatch conversion", () => {
    const linqEvent = {
      delivery: "incoming",
      nested: {
        traceId: "trace_123",
      },
    };
    const telegramAttachments: HostedExecutionTelegramAttachment[] = [
      {
        fileId: "file_roundtrip_1",
        kind: "photo",
      },
    ];
    const emailWake = buildHostedExecutionConversationMessageWake({
      eventId: "conversation-email-1",
      message: {
        channel: "email",
        identityId: "identity_123",
        rawMessageKey: "raw_123",
        selfAddress: null,
      },
      occurredAt,
      userId: "user_123",
    });
    const linqWake = buildHostedExecutionConversationMessageWake({
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
    const telegramWake = buildHostedExecutionConversationMessageWake({
      eventId: "conversation-telegram-1",
      message: {
        channel: "telegram",
        telegramMessage: {
          attachments: telegramAttachments,
          messageId: "message_123",
          schema: "murph.hosted-telegram-message.v1",
          threadId: "thread_123",
        },
      },
      occurredAt,
      userId: "user_123",
    });

    linqEvent.delivery = "mutated";
    telegramAttachments[0]!.fileId = "mutated";

    expect(buildHostedExecutionDispatchFromWake(emailWake)).toEqual({
      event: {
        identityId: "identity_123",
        kind: "email.message.received",
        rawMessageKey: "raw_123",
        selfAddress: null,
        userId: "user_123",
      },
      eventId: "conversation-email-1",
      occurredAt,
    });
    expect(buildHostedExecutionDispatchFromWake(linqWake)).toEqual({
      event: {
        kind: "linq.message.received",
        linqEvent: {
          delivery: "incoming",
          nested: {
            traceId: "trace_123",
          },
        },
        linqMessageId: null,
        phoneLookupKey: "phone_lookup_123",
        userId: "user_123",
      },
      eventId: "conversation-linq-1",
      occurredAt,
    });
    expect(buildHostedExecutionDispatchFromWake(telegramWake)).toEqual({
      event: {
        kind: "telegram.message.received",
        telegramMessage: {
          attachments: [
            {
              fileId: "file_roundtrip_1",
              kind: "photo",
            },
          ],
          messageId: "message_123",
          schema: "murph.hosted-telegram-message.v1",
          threadId: "thread_123",
        },
        userId: "user_123",
      },
      eventId: "conversation-telegram-1",
      occurredAt,
    });
  });

  it("roundtrips hosted wake dispatch variants back into wakes and fails closed on unsupported payloads", () => {
    const linqDispatch = buildHostedExecutionLinqMessageReceivedDispatch({
      eventId: "linq-roundtrip-1",
      linqEvent: {
        delivery: "incoming",
      },
      linqMessageId: null,
      occurredAt,
      phoneLookupKey: "phone_lookup_456",
      userId: "user_123",
    });
    const telegramDispatch = buildHostedExecutionTelegramMessageReceivedDispatch({
      eventId: "telegram-roundtrip-1",
      occurredAt,
      telegramMessage: {
        messageId: "message_roundtrip_1",
        schema: "murph.hosted-telegram-message.v1",
        text: "hello",
        threadId: "thread_roundtrip_1",
      },
      userId: "user_123",
    });
    const emailDispatch = buildHostedExecutionEmailMessageReceivedDispatch({
      eventId: "email-roundtrip-1",
      identityId: "assistant@example.com",
      occurredAt,
      rawMessageKey: "raw_roundtrip_1",
      selfAddress: null,
      userId: "user_123",
    });
    const memberDispatch = buildHostedExecutionMemberActivatedDispatch({
      eventId: "member-activated-roundtrip-1",
      firstContact: {
        channel: "email",
        identityId: "assistant@example.com",
        threadId: "thread_roundtrip_1",
        threadIsDirect: true,
      },
      memberChannels: defaultMemberChannels,
      memberId: "user_123",
      occurredAt,
    });
    const memberChannelsDispatch = buildHostedExecutionMemberChannelsUpdatedDispatch({
      eventId: "member-channels-roundtrip-1",
      memberChannels: {
        email: true,
        linq: false,
        telegram: true,
      },
      memberId: "user_123",
      occurredAt,
    });
    const assistantCronDispatch = buildHostedExecutionAssistantCronTickDispatch({
      eventId: "assistant-cron-roundtrip-1",
      occurredAt,
      reason: "device-sync",
      userId: "user_123",
    });
    const deviceSyncDispatch = buildHostedExecutionDeviceSyncWakeDispatch({
      connectionId: "connection_roundtrip_1",
      eventId: "device-sync-roundtrip-1",
      hint: null,
      occurredAt,
      provider: null,
      reason: "webhook_hint",
      userId: "user_123",
    });
    const shareDispatch = buildHostedExecutionVaultShareAcceptedDispatch({
      eventId: "share-roundtrip-1",
      memberId: "user_123",
      occurredAt,
      share: {
        ownerUserId: "owner_123",
        shareId: "share_123",
      },
    });

    expect(buildHostedExecutionWakeFromDispatch(linqDispatch)).toEqual({
      eventId: "linq-roundtrip-1",
      kind: "conversation.message",
      message: {
        channel: "linq",
        linqEvent: {
          delivery: "incoming",
        },
        linqMessageId: null,
        phoneLookupKey: "phone_lookup_456",
      },
      occurredAt,
      userId: "user_123",
    });
    expect(buildHostedExecutionWakeFromDispatch(telegramDispatch)).toEqual({
      eventId: "telegram-roundtrip-1",
      kind: "conversation.message",
      message: {
        channel: "telegram",
        telegramMessage: {
          messageId: "message_roundtrip_1",
          schema: "murph.hosted-telegram-message.v1",
          text: "hello",
          threadId: "thread_roundtrip_1",
        },
      },
      occurredAt,
      userId: "user_123",
    });
    expect(buildHostedExecutionWakeFromDispatch(emailDispatch)).toEqual({
      eventId: "email-roundtrip-1",
      kind: "conversation.message",
      message: {
        channel: "email",
        identityId: "assistant@example.com",
        rawMessageKey: "raw_roundtrip_1",
        selfAddress: null,
      },
      occurredAt,
      userId: "user_123",
    });
    expect(buildHostedExecutionWakeFromDispatch(memberDispatch)).toEqual({
      eventId: "member-activated-roundtrip-1",
      firstContact: {
        channel: "email",
        identityId: "assistant@example.com",
        threadId: "thread_roundtrip_1",
        threadIsDirect: true,
      },
      kind: "member.activated",
      memberChannels: defaultMemberChannels,
      occurredAt,
      userId: "user_123",
    });
    expect(buildHostedExecutionWakeFromDispatch(memberChannelsDispatch)).toEqual({
      eventId: "member-channels-roundtrip-1",
      kind: "member.channels.updated",
      memberChannels: {
        email: true,
        linq: false,
        telegram: true,
      },
      occurredAt,
      userId: "user_123",
    });
    expect(buildHostedExecutionWakeFromDispatch(assistantCronDispatch)).toEqual({
      eventId: "assistant-cron-roundtrip-1",
      kind: "assistant.cron.tick",
      occurredAt,
      reason: "device-sync",
      userId: "user_123",
    });
    expect(buildHostedExecutionWakeFromDispatch(deviceSyncDispatch)).toEqual({
      connectionId: "connection_roundtrip_1",
      eventId: "device-sync-roundtrip-1",
      hint: null,
      kind: "device-sync.wake",
      occurredAt,
      provider: null,
      reason: "webhook_hint",
      userId: "user_123",
    });
    expect(buildHostedExecutionWakeFromDispatch(shareDispatch)).toEqual({
      eventId: "share-roundtrip-1",
      kind: "vault.share.accepted",
      occurredAt,
      share: {
        ownerUserId: "owner_123",
        shareId: "share_123",
      },
      userId: "user_123",
    });

    expect(() =>
      buildHostedExecutionWakeFromDispatch({
        event: {
          kind: "unexpected.event",
          userId: "user_123",
        },
        eventId: "unexpected-roundtrip",
        occurredAt,
      } as never),
    ).toThrow(/Unexpected hosted execution event kind/i);

    expect(() =>
      buildHostedExecutionDispatchFromWake({
        eventId: "unexpected-wake",
        kind: "unexpected.wake",
        occurredAt,
        userId: "user_123",
      } as never),
    ).toThrow(/Unsupported hosted execution wake/u);
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

    expect(readHostedEmailCapabilities({
      HOSTED_EMAIL_INGRESS_READY: "true",
      HOSTED_EMAIL_SEND_READY: "true",
    })).toEqual({
      ingressReady: false,
      sendReady: false,
      senderIdentity: null,
    });
  });

  it("dedupes normalized self addresses across sender, envelope, and extras", () => {
    expect(resolveHostedEmailSelfAddresses({
      envelopeTo: "Assistant@example.com",
      extra: [
        "Route <assistant+route@example.com>",
        "assistant@example.com",
        null,
        "  ",
        "Assistant+Route@Example.com",
      ],
      senderIdentity: "Assistant@Example.com",
    })).toEqual([
      "assistant@example.com",
      "assistant+route@example.com",
    ]);
  });
});
