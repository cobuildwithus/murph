import { describe, expect, it } from "vitest";

import type { HostedExecutionTelegramAttachment } from "../src/contracts.ts";

import {
  buildHostedExecutionAssistantCronTickDispatch,
  buildHostedExecutionEmailMessageReceivedDispatch,
  buildHostedExecutionGatewayMessageSendDispatch,
  buildHostedExecutionLinqMessageReceivedDispatch,
  buildHostedExecutionMemberActivatedDispatch,
  buildHostedExecutionMemberChannelsUpdatedDispatch,
  buildHostedExecutionTelegramMessageReceivedDispatch,
  buildHostedExecutionDeviceSyncWakeDispatch,
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

  it("normalizes gateway message send nullable ids to null", () => {
    expect(
      buildHostedExecutionGatewayMessageSendDispatch({
        eventId: "gateway-send-1",
        occurredAt,
        sessionKey: "session_123",
        text: "hello from gateway",
        userId: "user_123",
      }),
    ).toEqual({
      event: {
        clientRequestId: null,
        kind: "gateway.message.send",
        replyToMessageId: null,
        sessionKey: "session_123",
        text: "hello from gateway",
        userId: "user_123",
      },
      eventId: "gateway-send-1",
      occurredAt,
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
