import { HostedBillingStatus } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { HostedMemberEmailAuthorizationLookup } from "@/src/lib/hosted-onboarding/hosted-member-store";
import {
  parseHostedLinqWebhookEvent,
  requireHostedLinqMessageReceivedEvent,
} from "@/src/lib/hosted-onboarding/linq";
import {
  parseHostedTelegramWebhookUpdate,
  summarizeHostedTelegramWebhook,
} from "@/src/lib/hosted-onboarding/telegram";
import {
  resolveHostedLinqVisibleSecondaryReply,
  resolveHostedTelegramVisibleSecondaryReply,
  type HostedOnboardingLinqWebhookHandler,
  type HostedOnboardingTelegramWebhookHandler,
  type HostedVisibleSecondaryLinqDependencies,
  type HostedVisibleSecondaryTelegramDependencies,
  withHostedVisibleSecondaryLinqOutcomes,
  withHostedVisibleSecondaryTelegramOutcomes,
} from "@/src/lib/hosted-onboarding/visible-secondary-webhooks";

describe("visible secondary webhook outcomes", () => {
  it.each([
    ["stripe-effect-pending", "Billing is already changing"],
    ["family-invite-not-accepted", "Family invite"],
    ["signup-link-already-sent", "setup link"],
    ["home-line-capacity-exhausted", "connect this chat"],
    ["unassignable-home-line", "connect this chat"],
    ["unattested-direct-chat", "verify this as your Murph chat"],
    ["unknown-home-line", "verify this as your Murph chat"],
    ["thread-container-inactive", "group chat"],
  ] as const)("maps Linq %s to a visible reply", (reason, expectedText) => {
    expect(resolveHostedLinqVisibleSecondaryReply({
      reason,
      recognizedSender: reason === "family-invite-not-accepted"
        || reason === "signup-link-already-sent"
        || reason === "thread-container-inactive"
        ? false
        : true,
    })).toContain(expectedText);
  });

  it("keeps operational Linq replies limited to recognized members", () => {
    expect(resolveHostedLinqVisibleSecondaryReply({
      reason: "unattested-direct-chat",
      recognizedSender: false,
    })).toBeNull();
    expect(resolveHostedLinqVisibleSecondaryReply({
      reason: "group-chat",
      recognizedSender: false,
    })).toBeNull();
    expect(resolveHostedLinqVisibleSecondaryReply({
      reason: "group-chat",
      recognizedSender: true,
    })).toContain("group chat");
  });

  it("does not send an operational Linq reply when the participant phone is unknown", async () => {
    const event = buildOperationalLinqEvent({
      eventId: "evt_unknown_phone",
      messageId: "msg_unknown_phone",
      senderHandle: "+15551234567",
      senderService: "sms",
    });
    const lookupHostedMemberIdentityByPhoneNumber = vi.fn(async () => null);
    const sendHostedLinqChatMessage = vi.fn();
    const dependencies: HostedVisibleSecondaryLinqDependencies = {
      getPrisma: vi.fn(() => ({}) as never),
      lookupHostedMemberByVerifiedEmailAddress: vi.fn(async () => null),
      lookupHostedMemberIdentityByPhoneNumber,
      parseHostedLinqWebhookEvent: vi.fn(() => event),
      sendHostedLinqChatMessage,
    };
    const handler: HostedOnboardingLinqWebhookHandler = vi.fn(async () => ({
      ignored: true,
      ok: true as const,
      reason: "unattested-direct-chat",
    }));

    await expect(withHostedVisibleSecondaryLinqOutcomes(handler, dependencies)({
      rawBody: JSON.stringify(event),
      signature: "signature",
      timestamp: "timestamp",
    })).resolves.toEqual({
      ignored: true,
      ok: true,
      reason: "unattested-direct-chat",
    });
    expect(lookupHostedMemberIdentityByPhoneNumber).toHaveBeenCalledWith({
      phoneNumber: "+15551234567",
      prisma: {},
    });
    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("sends an operational Linq reply when the participant email is recognized", async () => {
    const event = buildOperationalLinqEvent({
      eventId: "evt_recognized_email",
      messageId: "msg_recognized_email",
      senderHandle: "member@example.test",
      senderService: "email",
    });
    const recognizedMember: HostedMemberEmailAuthorizationLookup = {
      core: {
        billingStatus: HostedBillingStatus.active,
        createdAt: new Date("2026-07-25T12:00:00.000Z"),
        id: "member_recognized",
        suspendedAt: null,
        updatedAt: new Date("2026-07-25T12:00:00.000Z"),
      },
      emailAuthorization: {
        directPublicSender: null,
        memberId: "member_recognized",
        stripeCheckoutEmail: null,
        verifiedEmail: {
          address: "member@example.test",
          lookupKey: "lookup_recognized",
          verifiedAt: new Date("2026-07-25T12:00:00.000Z"),
        },
      },
      matchedBy: "verifiedEmail",
    };
    const lookupHostedMemberByVerifiedEmailAddress = vi.fn(async () => recognizedMember);
    const sendHostedLinqChatMessage = vi.fn(async () => ({
      chatId: "chat_visible_operational",
      messageId: "msg_visible_reply",
    }));
    const dependencies: HostedVisibleSecondaryLinqDependencies = {
      getPrisma: vi.fn(() => ({}) as never),
      lookupHostedMemberByVerifiedEmailAddress,
      lookupHostedMemberIdentityByPhoneNumber: vi.fn(async () => null),
      parseHostedLinqWebhookEvent: vi.fn(() => event),
      sendHostedLinqChatMessage,
    };
    const handler: HostedOnboardingLinqWebhookHandler = vi.fn(async () => ({
      ignored: true,
      ok: true as const,
      reason: "unattested-direct-chat",
    }));

    await expect(withHostedVisibleSecondaryLinqOutcomes(handler, dependencies)({
      rawBody: JSON.stringify(event),
      signature: "signature",
      timestamp: "timestamp",
    })).resolves.toMatchObject({
      ignored: false,
      reason: "visible-secondary-reply:unattested-direct-chat",
    });
    expect(lookupHostedMemberByVerifiedEmailAddress).toHaveBeenCalledWith({
      address: "member@example.test",
      prisma: {},
    });
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat_visible_operational",
      idempotencyKey: "visible-secondary:evt_recognized_email",
      replyToMessageId: "msg_recognized_email",
    }));
  });

  it.each([
    "group-chat",
    "thread-container-inactive",
  ] as const)("does not answer an outbound Linq echo classified as %s", async (reason) => {
    const event = buildOperationalLinqEvent({
      eventId: `evt_echo_${reason}`,
      isFromMe: true,
      messageId: `msg_echo_${reason}`,
      senderHandle: "+15550000000",
      senderService: "sms",
    });
    const lookupHostedMemberIdentityByPhoneNumber = vi.fn(async () => ({
      memberId: "member_echo",
    }) as never);
    const sendHostedLinqChatMessage = vi.fn();
    const dependencies: HostedVisibleSecondaryLinqDependencies = {
      getPrisma: vi.fn(() => ({}) as never),
      lookupHostedMemberByVerifiedEmailAddress: vi.fn(async () => null),
      lookupHostedMemberIdentityByPhoneNumber,
      parseHostedLinqWebhookEvent: vi.fn(() => event),
      sendHostedLinqChatMessage,
    };
    const response = {
      ignored: true,
      ok: true as const,
      reason,
    };
    const handler: HostedOnboardingLinqWebhookHandler = vi.fn(async () => response);

    await expect(withHostedVisibleSecondaryLinqOutcomes(handler, dependencies)({
      rawBody: JSON.stringify(event),
      signature: "signature",
      timestamp: "timestamp",
    })).resolves.toEqual(response);

    expect(lookupHostedMemberIdentityByPhoneNumber).not.toHaveBeenCalled();
    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["stripe-effect-pending", true, null, "Billing is already changing"],
    ["family-invite-not-accepted", true, null, "Family invite"],
    ["unlinked-telegram", true, "https://withmurph.ai/", "choose Telegram"],
    ["ambiguous-telegram-binding", true, null, "isn't linked cleanly"],
    ["telegram-binding-changed", true, null, "isn't linked cleanly"],
    ["group-chat-provision-unavailable", false, null, "group chat"],
  ] as const)(
    "maps Telegram %s to a privacy-safe visible reply",
    (reason, isDirect, signupUrl, expectedText) => {
      expect(resolveHostedTelegramVisibleSecondaryReply({
        isDirect,
        reason,
        signupUrl,
      })).toContain(expectedText);
    },
  );

  it("keeps Telegram group replies privacy-safe", () => {
    expect(resolveHostedTelegramVisibleSecondaryReply({
      isDirect: false,
      reason: "ambiguous-telegram-binding",
      signupUrl: null,
    })).toContain("Message me privately");
    expect(resolveHostedTelegramVisibleSecondaryReply({
      isDirect: false,
      reason: "unlinked-telegram",
      signupUrl: null,
    })).toContain("Message me privately");
    expect(resolveHostedTelegramVisibleSecondaryReply({
      isDirect: true,
      reason: "group-chat-provision-unavailable",
      signupUrl: null,
    })).toBeNull();
  });

  it("maps a Family draft conflict to the exact invite recovery URL", () => {
    expect(resolveHostedTelegramVisibleSecondaryReply({
      familyInviteCode: "invite_visible_recovery",
      isDirect: true,
      reason: "family-invite-draft-recovery-required",
      signupUrl: null,
    })).toContain(
      "https://www.withmurph.ai/settings?familyInviteReturn=%2Ffamily%2Faccept%2Finvite_visible_recovery#subscription",
    );
  });

  it("keeps Stripe-pending Telegram recovery private", () => {
    expect(resolveHostedTelegramVisibleSecondaryReply({
      isDirect: false,
      reason: "stripe-effect-pending",
      signupUrl: null,
    })).toBeNull();
  });

  it("keeps a failed Linq Stripe-pending reply retryable", async () => {
    const event = buildOperationalLinqEvent({
      eventId: "evt_stripe_pending",
      messageId: "msg_stripe_pending",
      senderHandle: "+15551234567",
      senderService: "sms",
    });
    const sendError = new Error("Linq reply failed");
    const sendHostedLinqChatMessage = vi.fn().mockRejectedValue(sendError);
    const dependencies: HostedVisibleSecondaryLinqDependencies = {
      getPrisma: vi.fn(() => ({}) as never),
      lookupHostedMemberByVerifiedEmailAddress: vi.fn(async () => null),
      lookupHostedMemberIdentityByPhoneNumber: vi.fn(async () => null),
      parseHostedLinqWebhookEvent: vi.fn(() => event),
      sendHostedLinqChatMessage,
    };
    const handler: HostedOnboardingLinqWebhookHandler = vi.fn(async () => ({
      ignored: true,
      ok: true as const,
      reason: "stripe-effect-pending",
    }));

    await expect(withHostedVisibleSecondaryLinqOutcomes(handler, dependencies)({
      rawBody: JSON.stringify(event),
      signature: "signature",
      timestamp: "timestamp",
    })).rejects.toBe(sendError);
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      message: "Billing is already changing. Try again shortly.",
      replyToMessageId: "msg_stripe_pending",
    }));
  });

  it("keeps a failed Telegram Stripe-pending reply retryable", async () => {
    const update = parseHostedTelegramWebhookUpdate(JSON.stringify({
      message: {
        chat: { id: 42, type: "private" },
        date: 1_785_000_000,
        from: { first_name: "Invitee", id: 42, is_bot: false },
        message_id: 11,
        text: "/start family_pending_effect",
      },
      update_id: 127,
    }));
    const sendError = new Error("Telegram reply failed");
    const sendHostedTelegramTextMessage = vi.fn().mockRejectedValue(sendError);
    const handler: HostedOnboardingTelegramWebhookHandler = vi.fn(async () => ({
      ignored: true,
      ok: true as const,
      reason: "stripe-effect-pending",
    }));

    await expect(withHostedVisibleSecondaryTelegramOutcomes(handler, {
      parseHostedTelegramWebhookUpdate: vi.fn(() => update),
      requireHostedOnboardingPublicBaseUrl: vi.fn(() => "https://withmurph.ai"),
      sendHostedTelegramTextMessage,
      summarizeHostedTelegramWebhook,
    })({
      rawBody: JSON.stringify(update),
      secretToken: "secret",
    })).rejects.toBe(sendError);
    expect(sendHostedTelegramTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Billing is already changing. Try again shortly.",
        replyToMessageId: 11,
      }),
    );
  });

  it("turns a repeated Linq signup message into an idempotent reply", async () => {
    const event = requireHostedLinqMessageReceivedEvent({
      api_version: "v3",
      created_at: "2026-07-25T12:00:00.000Z",
      data: {
        chat: {
          id: "chat_visible_signup",
          is_group: false,
          owner_handle: {
            handle: "+15550000000",
            id: "handle_owner",
            is_me: true,
            service: "sms",
          },
        },
        direction: "inbound",
        id: "msg_visible_signup",
        parts: [{ type: "text", value: "hello again" }],
        recipient_handle: {
          handle: "+15550000000",
          id: "handle_recipient",
          is_me: true,
          service: "sms",
        },
        recipient_phone: "+15550000000",
        sender_handle: {
          handle: "+15551234567",
          id: "handle_sender",
          service: "sms",
        },
        sent_at: "2026-07-25T12:00:00.000Z",
        service: "sms",
      },
      event_id: "evt_visible_signup",
      event_type: "message.received",
      webhook_version: "2026-02-03",
    });
    const sendHostedLinqChatMessage = vi.fn(async () => ({
      chatId: "chat_visible_signup",
      messageId: "msg_reply",
    }));
    const handler: HostedOnboardingLinqWebhookHandler = vi.fn(async () => ({
      ignored: true,
      ok: true as const,
      reason: "signup-link-already-sent",
    }));
    const dependencies: HostedVisibleSecondaryLinqDependencies = {
      getPrisma: vi.fn(() => ({}) as never),
      lookupHostedMemberByVerifiedEmailAddress: vi.fn(async () => null),
      lookupHostedMemberIdentityByPhoneNumber: vi.fn(async () => null),
      parseHostedLinqWebhookEvent: vi.fn(() => event),
      sendHostedLinqChatMessage,
    };

    const response = await withHostedVisibleSecondaryLinqOutcomes(
      handler,
      dependencies,
    )({
      rawBody: JSON.stringify(event),
      signature: "signature",
      timestamp: "timestamp",
    });

    expect(response).toMatchObject({
      ignored: false,
      reason: "visible-secondary-reply:signup-link-already-sent",
    });
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat_visible_signup",
      idempotencyKey: "visible-secondary:evt_visible_signup",
      message: "I already sent your setup link in your Murph messages. Open it to finish setting up Murph.",
      replyToMessageId: "msg_visible_signup",
    }));
    expect(sendHostedLinqChatMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("above"),
    }));
  });

  it("gives an unlinked direct Telegram sender a signup path", async () => {
    const update = parseHostedTelegramWebhookUpdate(JSON.stringify({
      message: {
        chat: {
          first_name: "Ada",
          id: 42,
          type: "private",
        },
        date: 1_785_000_000,
        from: {
          first_name: "Ada",
          id: 42,
          is_bot: false,
        },
        message_id: 7,
        text: "/start",
      },
      update_id: 123,
    }));
    const sendHostedTelegramTextMessage = vi.fn(async () => {});
    const handler: HostedOnboardingTelegramWebhookHandler = vi.fn(async () => ({
      ignored: true,
      ok: true as const,
      reason: "unlinked-telegram",
    }));
    const dependencies: HostedVisibleSecondaryTelegramDependencies = {
      parseHostedTelegramWebhookUpdate: vi.fn(() => update),
      requireHostedOnboardingPublicBaseUrl: vi.fn(() => "https://withmurph.ai"),
      sendHostedTelegramTextMessage,
      summarizeHostedTelegramWebhook,
    };

    const response = await withHostedVisibleSecondaryTelegramOutcomes(
      handler,
      dependencies,
    )({
      rawBody: JSON.stringify(update),
      secretToken: "secret",
    });

    expect(response).toMatchObject({
      ignored: false,
      reason: "visible-secondary-reply:unlinked-telegram",
    });
    expect(sendHostedTelegramTextMessage).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringMatching(/choose Telegram: https:\/\/withmurph\.ai\//),
      replyToMessageId: 7,
      target: expect.objectContaining({ chatId: "42" }),
    }));
  });

  it("gives a relink race repair guidance without a signup URL", async () => {
    const update = parseHostedTelegramWebhookUpdate(JSON.stringify({
      message: {
        chat: {
          first_name: "Ada",
          id: 42,
          type: "private",
        },
        date: 1_785_000_000,
        from: {
          first_name: "Ada",
          id: 42,
          is_bot: false,
        },
        message_id: 8,
        text: "hello",
      },
      update_id: 124,
    }));
    const sendHostedTelegramTextMessage = vi.fn(async () => {});
    const requireHostedOnboardingPublicBaseUrl = vi.fn(() =>
      "https://withmurph.ai"
    );
    const handler: HostedOnboardingTelegramWebhookHandler = vi.fn(async () => ({
      ignored: true,
      ok: true as const,
      reason: "telegram-binding-changed",
    }));

    const response = await withHostedVisibleSecondaryTelegramOutcomes(
      handler,
      {
        parseHostedTelegramWebhookUpdate: vi.fn(() => update),
        requireHostedOnboardingPublicBaseUrl,
        sendHostedTelegramTextMessage,
        summarizeHostedTelegramWebhook,
      },
    )({
      rawBody: JSON.stringify(update),
      secretToken: "secret",
    });

    expect(response).toMatchObject({
      ignored: false,
      reason: "visible-secondary-reply:telegram-binding-changed",
    });
    expect(requireHostedOnboardingPublicBaseUrl).not.toHaveBeenCalled();
    expect(sendHostedTelegramTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("isn't linked cleanly"),
      }),
    );
    const telegramCalls = sendHostedTelegramTextMessage.mock.calls as unknown as
      Array<[{ message: string }]>;
    const sentMessage = telegramCalls[0]?.[0];
    expect(sentMessage?.message).not.toContain("https://");
  });

  it("replies to a Family draft conflict in the initiating Telegram thread", async () => {
    const update = parseHostedTelegramWebhookUpdate(JSON.stringify({
      message: {
        chat: {
          first_name: "Invitee",
          id: 42,
          type: "private",
        },
        date: 1_785_000_000,
        from: {
          first_name: "Invitee",
          id: 42,
          is_bot: false,
        },
        message_id: 8,
        text: "/start family_revoked_visible_recovery",
      },
      update_id: 124,
    }));
    const sendHostedTelegramTextMessage = vi.fn(async () => {});
    const handler: HostedOnboardingTelegramWebhookHandler = vi.fn(async () => ({
      familyInviteCode: "invite_visible_recovery",
      ignored: true,
      ok: true as const,
      reason: "family-invite-draft-recovery-required",
    }));
    const dependencies: HostedVisibleSecondaryTelegramDependencies = {
      parseHostedTelegramWebhookUpdate: vi.fn(() => update),
      requireHostedOnboardingPublicBaseUrl: vi.fn(() => "https://withmurph.ai"),
      sendHostedTelegramTextMessage,
      summarizeHostedTelegramWebhook,
    };

    const response = await withHostedVisibleSecondaryTelegramOutcomes(
      handler,
      dependencies,
    )({
      rawBody: JSON.stringify(update),
      secretToken: "secret",
    });

    expect(response).toMatchObject({
      ignored: false,
      reason: "visible-secondary-reply:family-invite-draft-recovery-required",
    });
    expect(response).not.toHaveProperty("familyInviteCode");
    expect(sendHostedTelegramTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "familyInviteReturn=%2Ffamily%2Faccept%2Finvite_visible_recovery",
        ),
        replyToMessageId: 8,
        target: expect.objectContaining({ chatId: "42" }),
      }),
    );
  });

  it("uses the planner's username-bound Family invite when Telegram omits the start token", async () => {
    const update = parseHostedTelegramWebhookUpdate(JSON.stringify({
      message: {
        chat: {
          first_name: "Invitee",
          id: 42,
          type: "private",
        },
        date: 1_785_000_000,
        from: {
          first_name: "Invitee",
          id: 42,
          is_bot: false,
          username: "invitee_handle",
        },
        message_id: 9,
        text: "/start",
      },
      update_id: 125,
    }));
    const sendHostedTelegramTextMessage = vi.fn(async () => {});
    const handler: HostedOnboardingTelegramWebhookHandler = vi.fn(async () => ({
      familyInviteCode: "invite_fallback_recovery",
      ignored: true,
      ok: true as const,
      reason: "family-invite-draft-recovery-required",
    }));
    const dependencies: HostedVisibleSecondaryTelegramDependencies = {
      parseHostedTelegramWebhookUpdate: vi.fn(() => update),
      requireHostedOnboardingPublicBaseUrl: vi.fn(() => "https://withmurph.ai"),
      sendHostedTelegramTextMessage,
      summarizeHostedTelegramWebhook,
    };

    await withHostedVisibleSecondaryTelegramOutcomes(handler, dependencies)({
      rawBody: JSON.stringify(update),
      secretToken: "secret",
    });

    expect(sendHostedTelegramTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "familyInviteReturn=%2Ffamily%2Faccept%2Finvite_fallback_recovery",
        ),
        replyToMessageId: 9,
        target: expect.objectContaining({ chatId: "42" }),
      }),
    );
  });

  it("fails closed when a Family draft conflict has no planner invite identity", async () => {
    const update = parseHostedTelegramWebhookUpdate(JSON.stringify({
      message: {
        chat: { id: 42, type: "private" },
        date: 1_785_000_000,
        from: { first_name: "Invitee", id: 42, is_bot: false },
        message_id: 10,
        text: "/start family_stale_raw_invite",
      },
      update_id: 126,
    }));
    const sendHostedTelegramTextMessage = vi.fn(async () => {});
    const handler: HostedOnboardingTelegramWebhookHandler = vi.fn(async () => ({
      ignored: true,
      ok: true as const,
      reason: "family-invite-draft-recovery-required",
    }));
    const dependencies: HostedVisibleSecondaryTelegramDependencies = {
      parseHostedTelegramWebhookUpdate: vi.fn(() => update),
      requireHostedOnboardingPublicBaseUrl: vi.fn(() => "https://withmurph.ai"),
      sendHostedTelegramTextMessage,
      summarizeHostedTelegramWebhook,
    };

    await expect(withHostedVisibleSecondaryTelegramOutcomes(
      handler,
      dependencies,
    )({
      rawBody: JSON.stringify(update),
      secretToken: "secret",
    })).resolves.toEqual({
      ignored: true,
      ok: true,
      reason: "family-invite-draft-recovery-required",
    });
    expect(sendHostedTelegramTextMessage).not.toHaveBeenCalled();
  });

  it("keeps unlinked Telegram referral evidence silent in the group", async () => {
    const update = parseHostedTelegramWebhookUpdate(JSON.stringify({
      message: {
        chat: {
          id: -100123,
          title: "Family chat",
          type: "group",
        },
        date: 1_785_000_000,
        from: {
          first_name: "Casey",
          id: 42,
          is_bot: false,
        },
        message_id: 7,
        text: "hello murph",
      },
      update_id: 123,
    }));
    const sendHostedTelegramTextMessage = vi.fn(async () => {});
    const handler: HostedOnboardingTelegramWebhookHandler = vi.fn(async () => ({
      ignored: true,
      ok: true as const,
      reason: "usage-referral-evidence-only",
    }));
    const dependencies: HostedVisibleSecondaryTelegramDependencies = {
      parseHostedTelegramWebhookUpdate: vi.fn(() => update),
      requireHostedOnboardingPublicBaseUrl: vi.fn(() => "https://withmurph.ai"),
      sendHostedTelegramTextMessage,
      summarizeHostedTelegramWebhook,
    };

    await expect(withHostedVisibleSecondaryTelegramOutcomes(
      handler,
      dependencies,
    )({
      rawBody: JSON.stringify(update),
      secretToken: "secret",
    })).resolves.toEqual({
      ignored: true,
      ok: true,
      reason: "usage-referral-evidence-only",
    });
    expect(sendHostedTelegramTextMessage).not.toHaveBeenCalled();
    expect(dependencies.requireHostedOnboardingPublicBaseUrl)
      .not.toHaveBeenCalled();
  });

  it("leaves unrelated silent outcomes unchanged", async () => {
    const handler: HostedOnboardingLinqWebhookHandler = vi.fn(async () => ({
      ignored: true,
      ok: true as const,
      reason: "own-message",
    }));
    const dependencies: HostedVisibleSecondaryLinqDependencies = {
      getPrisma: vi.fn(() => ({}) as never),
      lookupHostedMemberByVerifiedEmailAddress: vi.fn(async () => null),
      lookupHostedMemberIdentityByPhoneNumber: vi.fn(async () => null),
      parseHostedLinqWebhookEvent,
      sendHostedLinqChatMessage: vi.fn(async () => ({ chatId: null, messageId: null })),
    };

    await expect(withHostedVisibleSecondaryLinqOutcomes(handler, dependencies)({
      rawBody: "{}",
      signature: null,
      timestamp: null,
    })).resolves.toEqual({
      ignored: true,
      ok: true,
      reason: "own-message",
    });
    expect(dependencies.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });
});

function buildOperationalLinqEvent(input: {
  eventId: string;
  isFromMe?: boolean;
  messageId: string;
  senderHandle: string;
  senderService: "email" | "sms";
}): ReturnType<typeof requireHostedLinqMessageReceivedEvent> {
  return requireHostedLinqMessageReceivedEvent({
    api_version: "v3",
    created_at: "2026-07-25T12:00:00.000Z",
    data: {
      chat: {
        id: "chat_visible_operational",
        is_group: false,
        owner_handle: {
          handle: "+15550000000",
          id: "handle_owner",
          is_me: true,
          service: "sms",
        },
      },
      direction: input.isFromMe ? "outbound" : "inbound",
      id: input.messageId,
      is_from_me: input.isFromMe ?? false,
      parts: [{ type: "text", value: "hello" }],
      recipient_handle: {
        handle: "+15550000000",
        id: "handle_recipient",
        is_me: true,
        service: "sms",
      },
      recipient_phone: "+15550000000",
      sender_handle: {
        handle: input.senderHandle,
        id: "handle_sender",
        service: input.senderService,
      },
      sent_at: "2026-07-25T12:00:00.000Z",
      service: "sms",
    },
    event_id: input.eventId,
    event_type: "message.received",
    webhook_version: "2026-02-03",
  });
}
