import { describe, expect, it } from "vitest";

import type { HostedExecutionTelegramAttachment } from "../src/contracts.ts";

import {
  buildHostedExecutionAssistantNotificationRequestedWake,
  buildHostedExecutionConversationMessageWake,
  buildHostedExecutionEmailConversationMessageWake,
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionMemberActivatedWake,
  buildHostedExecutionMemberChannelsUpdatedWake,
  buildHostedExecutionRuntimeControlWake,
  buildHostedExecutionRuntimeTimerWake,
  buildHostedExecutionTelegramConversationMessageWake,
  buildHostedExecutionDeviceSyncWake,
  buildHostedExecutionWhatsAppConversationMessageWake,
} from "../src/builders.ts";
import {
  HOSTED_EMAIL_REGISTER_REPLY_ALIAS_CALLBACK_PATH,
  HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
  HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID,
  createHostedEmailReplyAliasRoute,
  createHostedEmailUserReplyAliasRoute,
  isHostedEmailReplyAliasLookupKey,
  normalizeHostedEmailReplyAliasLookupKey,
  parseHostedEmailReplyAliasRegistrationCallbackRequest,
  parseHostedEmailRouteResolutionCallbackRequest,
  parseHostedEmailRouteResolutionCallbackResponse,
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
  it("deep-copies member activation signup welcome payloads and strips legacy policy fields", () => {
    const signupWelcome = {
      deliveryDedupeToken: "signup-welcome:user_123",
      deliveryDispatchMode: "queue-only" as const,
      deliveryIdempotencyKey: "signup-welcome:user_123",
      firstContact: {
        markSeenOnDeliveryAccepted: true,
      },
      route: {
        actorId: "+15551234567",
        channel: "linq" as const,
        delivery: {
          kind: "participant" as const,
          source: {
            fromPhoneNumber: "+15550001111",
            kind: "linq" as const,
          },
          target: "+15551234567",
        },
        identityId: "hbidx:phone:v1:test",
        threadId: null,
        threadIsDirect: true,
      },
      text: "Welcome to Murph.",
    };
    const wake = buildHostedExecutionMemberActivatedWake({
      eventId: "member-activation-1",
      memberChannels: defaultMemberChannels,
      memberId: "user_123",
      occurredAt,
      signupWelcome,
    });

    signupWelcome.firstContact.markSeenOnDeliveryAccepted = false;
    signupWelcome.route.delivery.source!.fromPhoneNumber = "+15550009999";
    signupWelcome.text = "mutated";

    expect(wake).toMatchObject({
      eventId: "member-activation-1",
      kind: "member.activated",
      signupWelcome: {
        route: {
          actorId: "+15551234567",
          channel: "linq",
          delivery: {
            kind: "participant",
            source: {
              fromPhoneNumber: "+15550001111",
              kind: "linq",
            },
            target: "+15551234567",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: null,
          threadIsDirect: true,
        },
        text: "Welcome to Murph.",
      },
      userId: "user_123",
    });
    expect(wake.signupWelcome).toEqual({
      route: {
        actorId: "+15551234567",
        channel: "linq",
        delivery: {
          kind: "participant",
          source: {
            fromPhoneNumber: "+15550001111",
            kind: "linq",
          },
          target: "+15551234567",
        },
        identityId: "hbidx:phone:v1:test",
        threadId: null,
        threadIsDirect: true,
      },
      text: "Welcome to Murph.",
    });
  });

  it("deep-copies assistant notification payloads when building notification wakes", () => {
    const notification = {
      deliveryDispatchMode: "queue-only" as const,
      deliveryDedupeToken: "signup-welcome:user_123",
      deliveryIdempotencyKey: "signup-welcome:user_123",
      firstContact: {
        markSeenOnDeliveryAccepted: true,
      },
      instructions: "Send the Murph signup welcome.",
      responsePolicy: {
        kind: "require_send_exact_text" as const,
        text: "Welcome to Murph, your personal health assistant.",
      },
      route: {
        actorId: "+15551234567",
        channel: "linq" as const,
        delivery: {
          kind: "participant" as const,
          source: {
            fromPhoneNumber: "+15550001111",
            kind: "linq" as const,
          },
          target: "+15551234567",
        },
        identityId: "hbidx:phone:v1:test",
        threadId: null,
        threadIsDirect: true,
      },
    };
    const wake = buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: "assistant-notification-1",
      memberId: "user_123",
      notification,
      occurredAt,
    });

    notification.firstContact.markSeenOnDeliveryAccepted = false;
    notification.responsePolicy.text = "mutated";
    notification.route.delivery.source!.fromPhoneNumber = "+15550009999";

    expect(wake).toMatchObject({
      eventId: "assistant-notification-1",
      kind: "assistant.notification.requested",
      notification: {
        deliveryDispatchMode: "queue-only",
        deliveryDedupeToken: "signup-welcome:user_123",
        deliveryIdempotencyKey: "signup-welcome:user_123",
        firstContact: {
          markSeenOnDeliveryAccepted: true,
        },
        instructions: "Send the Murph signup welcome.",
        responsePolicy: {
          kind: "require_send_exact_text",
          text: "Welcome to Murph, your personal health assistant.",
        },
        route: {
          actorId: "+15551234567",
          channel: "linq",
          delivery: {
            kind: "participant",
            source: {
              fromPhoneNumber: "+15550001111",
              kind: "linq",
            },
            target: "+15551234567",
          },
          identityId: "hbidx:phone:v1:test",
          threadId: null,
          threadIsDirect: true,
        },
      },
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

  it("copies typed Linq message payloads without mutating caller-owned parts", () => {
    const linqMessage = {
      chatId: "chat_123",
      from: "+15551234567",
      isFromMe: false,
      messageId: "msg_123",
      parts: [
        {
          type: "text" as const,
          value: "hello",
        },
      ],
      replyToMessageId: null,
      service: "SMS",
    };
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "linq-1",
      linqMessage,
      occurredAt,
      phoneLookupKey: "phone_lookup_123",
      userId: "user_123",
    });

    linqMessage.parts[0]!.value = "mutated";

    expect(wake.message).toEqual({
      channel: "linq",
      contactKind: "phone",
      contactLookupKey: "phone_lookup_123",
      linqMessage: {
        chatId: "chat_123",
        from: "+15551234567",
        isFromMe: false,
        messageId: "msg_123",
        parts: [
          {
            type: "text",
            value: "hello",
          },
        ],
        replyToMessageId: null,
        service: "SMS",
      },
      phoneLookupKey: "phone_lookup_123",
    });
    expect(wake.message).not.toHaveProperty("linqEvent");
    expect(wake.message).not.toHaveProperty("linqMessageId");
    expect(wake.message.linqMessage).not.toBe(linqMessage);
    expect(wake.message.linqMessage.parts).not.toBe(linqMessage.parts);
  });

  it("preserves Linq email contact lookup metadata alongside the legacy phone lookup field", () => {
    const linqMessage = {
      chatId: "chat_email_123",
      from: "buddy@example.test",
      isFromMe: false,
      messageId: "msg_email_123",
      parts: [
        {
          type: "text" as const,
          value: "hello",
        },
      ],
      service: "iMessage",
    };

    const wake = buildHostedExecutionLinqConversationMessageWake({
      contactKind: "email",
      contactLookupKey: "hbidx:email:v1:test",
      eventId: "linq-email-1",
      linqMessage,
      occurredAt,
      phoneLookupKey: null,
      userId: "user_123",
    });

    expect(wake.message).toEqual({
      channel: "linq",
      contactKind: "email",
      contactLookupKey: "hbidx:email:v1:test",
      linqMessage: {
        chatId: "chat_email_123",
        from: "buddy@example.test",
        isFromMe: false,
        messageId: "msg_email_123",
        parts: [
          {
            type: "text",
            value: "hello",
          },
        ],
        service: "iMessage",
      },
      phoneLookupKey: null,
    });
    expect(wake.message.linqMessage).not.toBe(linqMessage);
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
        replyContextPreview: "Replying to: Earlier message",
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
    expect(wake.message.telegramMessage.replyContextPreview).toBe(
      "Replying to: Earlier message",
    );
    expect(wake.message.telegramMessage.attachments).not.toBe(attachments);
    expect(wake.message.telegramMessage.attachments?.[0]).not.toBe(attachments[0]);
  });

  it("copies WhatsApp message payloads without mutating caller-owned data", () => {
    const whatsappMessage = {
      fromWaId: "15551234567",
      messageId: "wamid.test",
      phoneNumberId: "phone-number-id",
      schema: "murph.hosted-whatsapp-message.v1" as const,
      text: "CHECKIN",
      threadId: "15551234567",
    };
    const wake = buildHostedExecutionWhatsAppConversationMessageWake({
      eventId: "whatsapp-1",
      occurredAt,
      userId: "user_123",
      whatsappMessage,
    });

    whatsappMessage.text = "mutated";

    expect(wake.message).toEqual({
      channel: "whatsapp",
      whatsappMessage: {
        fromWaId: "15551234567",
        messageId: "wamid.test",
        phoneNumberId: "phone-number-id",
        schema: "murph.hosted-whatsapp-message.v1",
        text: "CHECKIN",
        threadId: "15551234567",
      },
    });
    expect(wake.message.whatsappMessage).not.toBe(whatsappMessage);
  });

  it("distinguishes omitted versus explicit nullable email routing metadata", () => {
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
      messageId: null,
      occurredAt,
      rawMessageKey: "raw_123",
      selfAddress: null,
      threadKey: null,
      threadTarget: null,
      userId: "user_123",
    });

    if (omitted.message.channel !== "email" || explicitNull.message.channel !== "email") {
      throw new Error("Expected email wake messages.");
    }

    expect("selfAddress" in omitted.message).toBe(false);
    expect("messageId" in omitted.message).toBe(false);
    expect("threadKey" in omitted.message).toBe(false);
    expect("threadTarget" in omitted.message).toBe(false);
    expect(explicitNull.message.messageId).toBeNull();
    expect(explicitNull.message.selfAddress).toBeNull();
    expect(explicitNull.message.threadKey).toBeNull();
    expect(explicitNull.message.threadTarget).toBeNull();
  });

  it("builds direct system wakes", () => {
    expect(
      buildHostedExecutionRuntimeTimerWake({
        eventId: "timer-1",
        occurredAt,
        triggerKind: "runtime_timer",
        userId: "user_123",
      }),
    ).toEqual({
      eventId: "timer-1",
      kind: "runtime.timer",
      occurredAt,
      triggerKind: "runtime_timer",
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
      buildHostedExecutionRuntimeControlWake({
        eventId: "runtime-control-1",
        kind: "runtime.browser-vault-refresh-requested",
        occurredAt,
        userId: "user_123",
      }),
    ).toEqual({
      eventId: "runtime-control-1",
      kind: "runtime.browser-vault-refresh-requested",
      occurredAt,
      userId: "user_123",
    });
  });

  it("builds generic conversation wakes without mutating caller-owned data", () => {
    const linqMessage = {
      chatId: "chat_123",
      from: "+15551234567",
      isFromMe: false,
      messageId: "msg_123",
      parts: [
        {
          type: "text" as const,
          value: "hello",
        },
      ],
    };
    const wake = buildHostedExecutionConversationMessageWake({
      eventId: "conversation-linq-1",
      message: {
        channel: "linq",
        linqMessage,
        phoneLookupKey: "phone_lookup_123",
      },
      occurredAt,
      userId: "user_123",
    });

    linqMessage.parts[0]!.value = "mutated";

    expect(wake).toEqual({
      eventId: "conversation-linq-1",
      kind: "conversation.message",
      message: {
        channel: "linq",
        linqMessage: {
          chatId: "chat_123",
          from: "+15551234567",
          isFromMe: false,
          messageId: "msg_123",
          parts: [
            {
              type: "text",
              value: "hello",
            },
          ],
        },
        phoneLookupKey: "phone_lookup_123",
      },
      occurredAt,
      userId: "user_123",
    });
  });

});

describe("hosted email helpers", () => {
  it("creates stable current-format reply alias routes for a hosted user", async () => {
    const route = await createHostedEmailUserReplyAliasRoute({
      domain: "Mail.Example.TEST",
      localPart: "Murph",
      signingSecret: "test-email-signing-secret",
      userId: " member_123 ",
    });
    const derivedAgain = await createHostedEmailReplyAliasRoute({
      aliasKey: route.aliasKey,
      domain: "mail.example.test",
      localPart: "murph",
      signingSecret: "test-email-signing-secret",
    });

    expect(route.aliasKey).toMatch(/^[0-9a-f]{32}$/u);
    expect(route.token).toMatch(/^u2-[0-9a-z]{25}-[0-9a-z]{25}$/u);
    expect(route.address).toBe(`murph+${route.token}@mail.example.test`);
    expect(derivedAgain).toEqual(route);
  });

  it("normalizes and validates only current reply alias lookup keys", () => {
    expect(normalizeHostedEmailReplyAliasLookupKey(
      "  0123456789ABCDEF0123456789abcdef  ",
    )).toBe("0123456789abcdef0123456789abcdef");
    expect(isHostedEmailReplyAliasLookupKey("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isHostedEmailReplyAliasLookupKey("0123456789abcdef")).toBe(false);
    expect(isHostedEmailReplyAliasLookupKey("replyalias1234")).toBe(false);
  });

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

  it("derives capabilities from env defaults and the ingress flag", () => {
    // Fully configured ingress (domain + sender + signing secret) implies send
    // readiness without needing the live HOSTED_EMAIL binding object.
    expect(readHostedEmailCapabilities({
      HOSTED_EMAIL_DOMAIN: "example.com",
      HOSTED_EMAIL_LOCAL_PART: "assistant",
      HOSTED_EMAIL_SIGNING_SECRET: "secret_123",
    })).toEqual({
      ingressReady: true,
      sendReady: true,
      senderIdentity: "assistant@example.com",
    });

    // Runner-shaped env: only the forwarded sender + ingress flag are present
    // (no signing secret, no binding object). Send must still be ready so the
    // assistant can reply by email.
    expect(readHostedEmailCapabilities({
      HOSTED_EMAIL_DOMAIN: "example.com",
      HOSTED_EMAIL_FROM_ADDRESS: "assistant@example.com",
      HOSTED_EMAIL_INGRESS_READY: "true",
    })).toEqual({
      ingressReady: true,
      sendReady: true,
      senderIdentity: "assistant@example.com",
    });

    expect(readHostedEmailCapabilities({
      HOSTED_EMAIL_DOMAIN: "example.com",
      HOSTED_EMAIL_FROM_ADDRESS: "assistant@example.com",
      HOSTED_EMAIL_INGRESS_READY: "false",
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

  it("exposes the hosted email callback contract from one shared surface", () => {
    expect(HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID).toBe(
      "hosted-email-route-resolution",
    );
    expect(HOSTED_EMAIL_REGISTER_REPLY_ALIAS_CALLBACK_PATH).toBe(
      "/api/internal/hosted-execution/email/register-reply-alias",
    );
    expect(HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH).toBe(
      "/api/internal/hosted-execution/email/resolve-route",
    );
    expect(parseHostedEmailReplyAliasRegistrationCallbackRequest({
      aliasKey: " replyalias1234 ",
    })).toEqual({
      aliasKey: "replyalias1234",
    });
    expect(parseHostedEmailRouteResolutionCallbackRequest({
      aliasKey: " replyalias1234 ",
      authenticatedSender: {
        dkimAligned: true,
        dmarcPass: false,
        spfAligned: false,
      },
      envelopeFrom: "owner@example.test",
      hasRepeatedHeaderFrom: true,
      headerFrom: "Owner <owner@example.test>",
    })).toEqual({
      aliasKey: "replyalias1234",
      authenticatedSender: {
        dkimAligned: true,
        dmarcPass: false,
        spfAligned: false,
      },
      envelopeFrom: "owner@example.test",
      hasRepeatedHeaderFrom: true,
      headerFrom: "Owner <owner@example.test>",
    });
    expect(parseHostedEmailRouteResolutionCallbackRequest({})).toEqual({
      aliasKey: null,
      authenticatedSender: null,
      envelopeFrom: null,
      hasRepeatedHeaderFrom: false,
      headerFrom: null,
    });
    expect(parseHostedEmailRouteResolutionCallbackResponse({
      userId: "member_123",
    })).toEqual({
      userId: "member_123",
    });
    expect(() => parseHostedEmailRouteResolutionCallbackResponse({})).toThrow(
      /userId must be present/u,
    );
  });
});
