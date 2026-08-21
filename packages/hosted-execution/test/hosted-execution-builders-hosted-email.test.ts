import { describe, expect, it } from "vitest";

import {
  HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_MAX_CHARS,
  type HostedExecutionTelegramAttachment,
} from "../src/contracts.ts";

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
} from "../src/builders.ts";
import {
  HOSTED_EMAIL_GROUP_RECIPIENTS_CALLBACK_PATH,
  HOSTED_EMAIL_REGISTER_REPLY_ALIAS_CALLBACK_PATH,
  HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
  HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID,
  createHostedEmailReplyAliasRoute,
  createHostedEmailGroupReplyAliasRoute,
  createHostedEmailUserReplyAliasRoute,
  isHostedEmailReplyAliasLookupKey,
  normalizeHostedEmailReplyAliasLookupKey,
  parseHostedEmailGroupRecipientsCallbackRequest,
  parseHostedEmailGroupRecipientsCallbackResponse,
  parseHostedEmailReplyAliasRegistrationCallbackRequest,
  parseHostedEmailRouteResolutionCallbackRequest,
  parseHostedEmailRouteResolutionCallbackResponse,
  readHostedEmailCapabilities,
  resolveHostedEmailSelfAddresses,
  resolveHostedEmailSenderIdentity,
} from "../src/hosted-email.ts";
import { parseHostedExecutionWake } from "../src/parsers.ts";

const occurredAt = "2026-04-08T00:00:00.000Z";
const defaultMemberChannels = {
  email: false,
  linq: false,
  telegram: false,
} as const;

function buildNonDirectLinqMessage() {
  return {
    chatId: "chat_group_123",
    from: "+15551234567",
    isFromMe: false,
    messageId: "msg_group_123",
    parts: [{ type: "text" as const, value: "hello group" }],
    threadIsDirect: false,
  };
}

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
      initialGroupRoomModelMarkdown:
        "  ## Explicit setup\n\nKeep this room low-key.  ",
      memberChannels: defaultMemberChannels,
      memberId: "user_123",
      onboardingFollowupRoute: signupWelcome.route,
      occurredAt,
      signupWelcome,
    });

    signupWelcome.firstContact.markSeenOnDeliveryAccepted = false;
    signupWelcome.route.delivery.source!.fromPhoneNumber = "+15550009999";
    signupWelcome.text = "mutated";

    expect(wake).toMatchObject({
      eventId: "member-activation-1",
      initialGroupRoomModelMarkdown:
        "## Explicit setup\n\nKeep this room low-key.",
      kind: "member.activated",
      onboardingFollowupRoute: {
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
      externalThreadRouteAuthority: {
        accountLookupKey: "linq-account-key",
        channel: "linq" as const,
        containerMemberId: "thread-container",
        threadId: "group-thread",
      },
      firstContact: {
        markSeenOnDeliveryAccepted: true,
      },
      instructions: "Send the Murph signup welcome.",
      privateAssistantAskCompletion: {
        expiresAt: "2026-04-08T00:10:00.000Z",
        requestId: `aask_req_${"a".repeat(64)}`,
      },
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
    notification.externalThreadRouteAuthority.threadId = "mutated-thread";
    notification.privateAssistantAskCompletion.requestId =
      `aask_req_${"b".repeat(64)}`;
    notification.responsePolicy.text = "mutated";
    notification.route.delivery.source!.fromPhoneNumber = "+15550009999";

    expect(wake).toMatchObject({
      eventId: "assistant-notification-1",
      kind: "assistant.notification.requested",
      notification: {
        deliveryDispatchMode: "queue-only",
        deliveryDedupeToken: "signup-welcome:user_123",
        deliveryIdempotencyKey: "signup-welcome:user_123",
        externalThreadRouteAuthority: {
          accountLookupKey: "linq-account-key",
          channel: "linq",
          containerMemberId: "thread-container",
          threadId: "group-thread",
        },
        firstContact: {
          markSeenOnDeliveryAccepted: true,
        },
        instructions: "Send the Murph signup welcome.",
        privateAssistantAskCompletion: {
          expiresAt: "2026-04-08T00:10:00.000Z",
          requestId: `aask_req_${"a".repeat(64)}`,
        },
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
    const routeAuthority = {
      accountLookupKey: "hbidx:phone:v1:account",
      channel: "linq" as const,
      containerMemberId: "user_123",
      threadId: "chat_123",
    };
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "linq-1",
      groupParticipantAdded: true,
      groupReactionContext: "Someone reacted ❤️ to “morning walk”.",
      linqMessage,
      occurredAt,
      phoneLookupKey: "phone_lookup_123",
      routeAuthority,
      userId: "user_123",
    });

    linqMessage.parts[0]!.value = "mutated";
    routeAuthority.threadId = "mutated";

    expect(wake.message).toEqual({
      channel: "linq",
      contactKind: "phone",
      contactLookupKey: "phone_lookup_123",
      groupParticipantAdded: true,
      groupReactionContext: "Someone reacted ❤️ to “morning walk”.",
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
      routeAuthority: {
        accountLookupKey: "hbidx:phone:v1:account",
        channel: "linq",
        containerMemberId: "user_123",
        threadId: "chat_123",
      },
    });
    expect(wake.message).not.toHaveProperty("linqEvent");
    expect(wake.message).not.toHaveProperty("linqMessageId");
    expect(wake.message.linqMessage).not.toBe(linqMessage);
    expect(wake.message.linqMessage.parts).not.toBe(linqMessage.parts);
    expect(wake.message.routeAuthority).not.toBe(routeAuthority);
  });

  it.each([
    ["blank", "   "],
    [
      "over the bounded reaction context limit",
      "x".repeat(HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_MAX_CHARS + 1),
    ],
  ])("rejects %s Linq group reaction context in the builder", (_label, groupReactionContext) => {
    expect(() => buildHostedExecutionLinqConversationMessageWake({
      eventId: "linq-invalid-reaction-context",
      groupReactionContext,
      linqMessage: buildNonDirectLinqMessage(),
      occurredAt,
      phoneLookupKey: "phone_lookup_123",
      routeAuthority: {
        channel: "linq",
        containerMemberId: "member_thread_container_123",
        threadId: "chat_group_123",
      },
      userId: "member_thread_container_123",
    })).toThrow(/group reaction context is invalid/u);
  });

  it("accepts the maximum bounded Linq group reaction context in the builder", () => {
    const groupReactionContext = "x".repeat(
      HOSTED_EXECUTION_LINQ_GROUP_REACTION_CONTEXT_MAX_CHARS,
    );
    expect(buildHostedExecutionLinqConversationMessageWake({
      eventId: "linq-max-reaction-context",
      groupReactionContext,
      linqMessage: buildNonDirectLinqMessage(),
      occurredAt,
      phoneLookupKey: "phone_lookup_123",
      routeAuthority: {
        channel: "linq",
        containerMemberId: "member_thread_container_123",
        threadId: "chat_group_123",
      },
      userId: "member_thread_container_123",
    }).message.groupReactionContext).toBe(groupReactionContext);
  });

  it("rejects non-direct Linq wakes without thread-container route authority", () => {
    expect(() => buildHostedExecutionLinqConversationMessageWake({
      eventId: "linq-group-missing-authority",
      linqMessage: buildNonDirectLinqMessage(),
      occurredAt,
      phoneLookupKey: "phone_lookup_123",
      userId: "member_personal_123",
    })).toThrow("requires thread route authority");
  });

  it("rejects generic non-direct Linq wakes targeting a different workspace", () => {
    expect(() => buildHostedExecutionConversationMessageWake({
      eventId: "linq-group-wrong-workspace",
      message: {
        channel: "linq",
        contactKind: "phone",
        contactLookupKey: "phone_lookup_123",
        linqMessage: buildNonDirectLinqMessage(),
        routeAuthority: {
          channel: "linq",
          containerMemberId: "member_thread_container_123",
          threadId: "chat_group_123",
        },
      },
      occurredAt,
      userId: "member_personal_123",
    })).toThrow("must target its route container");
  });

  it("rejects generic non-direct Linq wakes whose route authority names another chat", () => {
    expect(() => buildHostedExecutionConversationMessageWake({
      eventId: "linq-group-wrong-chat",
      message: {
        channel: "linq",
        contactKind: "phone",
        contactLookupKey: "phone_lookup_123",
        linqMessage: buildNonDirectLinqMessage(),
        routeAuthority: {
          channel: "linq",
          containerMemberId: "member_thread_container_123",
          threadId: "chat_other_123",
        },
      },
      occurredAt,
      userId: "member_thread_container_123",
    })).toThrow("must match its chat");
  });

  it("accepts non-direct Linq wakes only when route, chat, and workspace agree", () => {
    expect(buildHostedExecutionLinqConversationMessageWake({
      eventId: "linq-group-authorized",
      linqMessage: buildNonDirectLinqMessage(),
      occurredAt,
      phoneLookupKey: "phone_lookup_123",
      routeAuthority: {
        channel: "linq",
        containerMemberId: "member_thread_container_123",
        threadId: "chat_group_123",
      },
      userId: "member_thread_container_123",
    })).toMatchObject({
      message: {
        linqMessage: {
          threadIsDirect: false,
        },
      },
      userId: "member_thread_container_123",
    });
  });

  it("round-trips admission-time group sender members and rejects them on direct wakes", () => {
    const linqWake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "linq-group-stable-sender",
      linqMessage: buildNonDirectLinqMessage(),
      occurredAt,
      phoneLookupKey: "phone_lookup_123",
      routeAuthority: {
        channel: "linq",
        containerMemberId: "member_thread_container_123",
        threadId: "chat_group_123",
      },
      senderMemberId: "member_sender_123",
      userId: "member_thread_container_123",
    });
    const telegramWake = buildHostedExecutionTelegramConversationMessageWake({
      eventId: "telegram-group-stable-sender",
      occurredAt,
      routeAuthority: {
        channel: "telegram",
        containerMemberId: "member_thread_container_123",
        threadId: "thread_group_123",
      },
      senderMemberId: "member_sender_123",
      telegramMessage: {
        from: "456",
        messageId: "telegram_message_123",
        schema: "murph.hosted-telegram-message.v1",
        text: "hello group",
        threadId: "thread_group_123",
        threadIsDirect: false,
      },
      userId: "member_thread_container_123",
    });

    expect(parseHostedExecutionWake(linqWake)).toEqual(linqWake);
    expect(parseHostedExecutionWake(telegramWake)).toEqual(telegramWake);

    expect(() => buildHostedExecutionLinqConversationMessageWake({
      eventId: "linq-direct-stable-sender",
      linqMessage: {
        ...buildNonDirectLinqMessage(),
        threadIsDirect: true,
      },
      occurredAt,
      phoneLookupKey: "phone_lookup_123",
      senderMemberId: "member_sender_123",
      userId: "member_sender_123",
    })).toThrow("must not carry a group sender member");
    expect(() => buildHostedExecutionTelegramConversationMessageWake({
      eventId: "telegram-direct-stable-sender",
      occurredAt,
      senderMemberId: "member_sender_123",
      telegramMessage: {
        messageId: "telegram_message_direct_123",
        schema: "murph.hosted-telegram-message.v1",
        text: "hello",
        threadId: "thread_direct_123",
        threadIsDirect: true,
      },
      userId: "member_sender_123",
    })).toThrow("must not carry group sender identity");
    expect(() => parseHostedExecutionWake({
      ...linqWake,
      message: {
        ...linqWake.message,
        senderMemberId: " ",
      },
    })).toThrow("senderMemberId must be a non-empty normalized string");
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

  it("requires matching thread-container authority for non-direct Telegram wakes", () => {
    const telegramMessage = {
      messageId: "message_group_123",
      schema: "murph.hosted-telegram-message.v1" as const,
      text: "hello group",
      threadId: "thread_group_123",
      threadIsDirect: false,
    };

    expect(() => buildHostedExecutionTelegramConversationMessageWake({
      eventId: "telegram-group-missing-authority",
      occurredAt,
      telegramMessage,
      userId: "member_personal_123",
    })).toThrow("requires thread route authority");

    expect(buildHostedExecutionTelegramConversationMessageWake({
      eventId: "telegram-group-authorized",
      occurredAt,
      routeAuthority: {
        channel: "telegram",
        containerMemberId: "member_thread_container_123",
        threadId: "thread_group_123",
      },
      telegramMessage,
      userId: "member_thread_container_123",
    })).toMatchObject({
      message: {
        routeAuthority: {
          channel: "telegram",
          containerMemberId: "member_thread_container_123",
          threadId: "thread_group_123",
        },
        telegramMessage: {
          threadIsDirect: false,
        },
      },
      userId: "member_thread_container_123",
    });
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
      assistantStyleSettingsAuthorized: true,
      eventId: "email-null",
      identityId: "identity_123",
      messageId: null,
      occurredAt,
      rawMessageKey: "raw_123",
      selfAddress: null,
      threadKey: null,
      threadIsDirect: null,
      threadTarget: null,
      userId: "user_123",
    });

    if (omitted.message.channel !== "email" || explicitNull.message.channel !== "email") {
      throw new Error("Expected email wake messages.");
    }

    expect("selfAddress" in omitted.message).toBe(false);
    expect("assistantStyleSettingsAuthorized" in omitted.message).toBe(false);
    expect("messageId" in omitted.message).toBe(false);
    expect("threadKey" in omitted.message).toBe(false);
    expect("threadIsDirect" in omitted.message).toBe(false);
    expect("threadTarget" in omitted.message).toBe(false);
    expect(explicitNull.message.messageId).toBeNull();
    expect(explicitNull.message.assistantStyleSettingsAuthorized).toBe(true);
    expect(explicitNull.message.selfAddress).toBeNull();
    expect(explicitNull.message.threadKey).toBeNull();
    expect(explicitNull.message.threadIsDirect).toBeNull();
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
        connectionId: "conn_device_sync_1",
        eventId: "device-sync-1",
        expectedConnectedAt: "2026-04-25T00:00:00.000Z",
        hint: null,
        occurredAt,
        provider: null,
        reason: "connected",
        userId: "user_123",
      }),
    ).toEqual({
      connectionId: "conn_device_sync_1",
      eventId: "device-sync-1",
      expectedConnectedAt: "2026-04-25T00:00:00.000Z",
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
        kind: "runtime.maintenance-requested",
        occurredAt,
        userId: "user_123",
      }),
    ).toEqual({
      eventId: "runtime-control-1",
      kind: "runtime.maintenance-requested",
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

  it("creates compact signed reply alias routes for hosted groups without lengthening the local part", async () => {
    const route = await createHostedEmailGroupReplyAliasRoute({
      domain: "Mail.Example.TEST",
      groupId: "hgrp_AAAAAAAAAAAAAAAA",
      localPart: "assistant",
      signingSecret: "test-email-signing-secret",
    });
    const derivedAgain = await createHostedEmailGroupReplyAliasRoute({
      domain: "mail.example.test",
      groupId: "hgrp_AAAAAAAAAAAAAAAA",
      localPart: "assistant",
      signingSecret: "test-email-signing-secret",
    });

    expect(route.groupId).toBe("hgrp_AAAAAAAAAAAAAAAA");
    expect(route.token).toMatch(/^g2-[0-9a-z]{20}-[0-9a-z]{25}$/u);
    expect(route.address).toBe(`assistant+${route.token}@mail.example.test`);
    expect(route.address.split("@")[0]?.length).toBeLessThanOrEqual(64);
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
    expect(HOSTED_EMAIL_GROUP_RECIPIENTS_CALLBACK_PATH).toBe(
      "/api/internal/hosted-execution/email/group-recipients",
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
      groupId: " hgrp_123 ",
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
      groupId: "hgrp_123",
      hasRepeatedHeaderFrom: true,
      headerFrom: "Owner <owner@example.test>",
    });
    expect(parseHostedEmailRouteResolutionCallbackRequest({})).toEqual({
      aliasKey: null,
      authenticatedSender: null,
      envelopeFrom: null,
      groupId: null,
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

  it("parses group-recipient callback contracts through normalized email addresses", () => {
    const authorizationProof = "a".repeat(64);
    expect(parseHostedEmailGroupRecipientsCallbackRequest({
      expectedGroupEmailAuthorizationProof: authorizationProof,
      groupId: " group_123 ",
    })).toEqual({
      expectedGroupEmailAuthorizationProof: authorizationProof,
      groupId: "group_123",
    });
    expect(() => parseHostedEmailGroupRecipientsCallbackRequest({
      expectedGroupEmailAuthorizationProof: "not-a-proof",
      groupId: "group_123",
    })).toThrow(/SHA-256 hex digest/u);
    expect(() => parseHostedEmailGroupRecipientsCallbackRequest({
      expectedNewsletterAuthorizationProof: authorizationProof,
      groupId: "group_legacy",
    })).toThrow(/retired proof field/u);
    expect(() => parseHostedEmailGroupRecipientsCallbackRequest({
      expectedGroupEmailAuthorizationProof: authorizationProof,
      expectedNewsletterAuthorizationProof: "b".repeat(64),
      groupId: "group_mismatched",
    })).toThrow(/retired proof field/u);
    expect(() => parseHostedEmailGroupRecipientsCallbackRequest({})).toThrow(
      /groupId must be present/u,
    );

    expect(parseHostedEmailGroupRecipientsCallbackResponse({
      recipients: [
        {
          address: "Alex <ALEX@EXAMPLE.TEST>",
          memberId: " member_123 ",
        },
      ],
    })).toEqual({
      recipients: [
        {
          address: "alex@example.test",
          memberId: "member_123",
        },
      ],
    });
    expect(() =>
      parseHostedEmailGroupRecipientsCallbackResponse({
        recipients: [{ address: " ", memberId: "member_123" }],
      })
    ).toThrow(/memberId and address/u);
  });
});
