import { describe, expect, it, vi } from "vitest";

import {
  requireHostedLinqMessageReceivedEvent,
} from "@/src/lib/hosted-onboarding/linq";
import {
  type HostedOnboardingLinqWebhookHandler,
  type HostedVisibleSecondaryLinqDependencies,
  withHostedVisibleSecondaryLinqOutcomes,
} from "@/src/lib/hosted-onboarding/visible-secondary-webhooks";

const TRIAL_CONVERSION_MESSAGE =
  "Your Murph trial ended. Continue in Subscription settings: https://withmurph.ai/settings#subscription";
const SIGNUP_MESSAGE =
  "Murph isn't fully set up on this account yet. Finish setup here:\nhttps://withmurph.ai/join/invite-123";

describe("Linq group-chat visible access recovery", () => {
  it.each([
    "group-chat",
    "thread-container-inactive",
  ] as const)("privately recovers a recognized inactive member from %s", async (reason) => {
    const event = buildGroupLinqEvent(`evt_private_${reason}`);
    const sendHostedLinqChatMessage = vi.fn(async () => ({
      chatId: "chat_private_member",
      messageId: "msg_private_recovery",
    }));
    const readHostedMemberRoutingState = vi.fn()
      .mockResolvedValueOnce({ linqChatId: "chat_private_member" })
      .mockResolvedValueOnce({ linqChatId: "chat_private_member" });
    const resolveHostedRecognizedInboundAccess = vi.fn(async () => ({
      kind: "access_notice" as const,
      message: TRIAL_CONVERSION_MESSAGE,
      noticeCode: "trial_conversion_pending" as const,
      responseReason: "sent-trial-conversion-notice",
    }));
    const dependencies = buildLinqDependencies({
      event,
      getHostedLinqChatSummary: vi.fn(async () => ({
        handles: [],
        isGroup: false,
      })),
      readHostedMemberRoutingState,
      resolveHostedRecognizedInboundAccess,
      sendHostedLinqChatMessage,
    });
    const handler: HostedOnboardingLinqWebhookHandler = vi.fn(async () => ({
      ignored: true,
      ok: true as const,
      reason,
    }));

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
      reason: `visible-secondary-reply:${reason}`,
    });
    expect(resolveHostedRecognizedInboundAccess).toHaveBeenCalledWith({
      allowSignupFallback: true,
      inviteChannel: "linq",
      member: {
        id: "member_group_sender",
        suspendedAt: null,
      },
      noticeSeed: `evt_private_${reason}`,
      prisma: {},
    });
    expect(readHostedMemberRoutingState).toHaveBeenCalledTimes(2);
    expect(sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat_private_member",
      idempotencyKey: `visible-secondary-private:evt_private_${reason}`,
      message: `${TRIAL_CONVERSION_MESSAGE}\n\nOnce that's sorted, send me another message in the group and I'll try again.`,
      replyToMessageId: null,
    }));
  });

  it("uses the canonical signup fallback for a recognized first-time member", async () => {
    const event = buildGroupLinqEvent("evt_first_time_setup");
    const sendHostedLinqChatMessage = vi.fn(async () => ({
      chatId: "chat_private_member",
      messageId: "msg_private_setup",
    }));
    const dependencies = buildLinqDependencies({
      event,
      getHostedLinqChatSummary: vi.fn(async () => ({
        handles: [],
        isGroup: false,
      })),
      readHostedMemberRoutingState: vi.fn(async () => ({
        linqChatId: "chat_private_member",
      }) as never),
      resolveHostedRecognizedInboundAccess: vi.fn(async () => ({
        inviteCode: "invite-123",
        inviteId: "invite_123",
        joinUrl: "https://withmurph.ai/join/invite-123",
        kind: "signup" as const,
        message: SIGNUP_MESSAGE,
        responseReason: "sent-signup-link" as const,
      })),
      sendHostedLinqChatMessage,
    });
    const handler: HostedOnboardingLinqWebhookHandler = vi.fn(async () => ({
      ignored: true,
      ok: true as const,
      reason: "group-chat",
    }));

    await withHostedVisibleSecondaryLinqOutcomes(handler, dependencies)({
      rawBody: JSON.stringify(event),
      signature: "signature",
      timestamp: "timestamp",
    });

    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat_private_member",
      message: `${SIGNUP_MESSAGE}\n\nOnce that's sorted, send me another message in the group and I'll try again.`,
      replyToMessageId: null,
    }));
  });

  it("does not misclassify an allowed active trial as setup-incomplete", async () => {
    const event = buildGroupLinqEvent("evt_active_trial");
    const sendHostedLinqChatMessage = vi.fn(async () => ({
      chatId: "chat_group_visible",
      messageId: "msg_group_reply",
    }));
    const resolveHostedRecognizedInboundAccess = vi.fn(async () => ({
      kind: "allowed" as const,
    }));
    const dependencies = buildLinqDependencies({
      event,
      getHostedLinqChatSummary: vi.fn(async () => ({
        handles: [],
        isGroup: false,
      })),
      readHostedMemberRoutingState: vi.fn(async () => ({
        linqChatId: "chat_private_member",
      }) as never),
      resolveHostedRecognizedInboundAccess,
      sendHostedLinqChatMessage,
    });
    const handler: HostedOnboardingLinqWebhookHandler = vi.fn(async () => ({
      ignored: true,
      ok: true as const,
      reason: "group-chat",
    }));

    await expect(withHostedVisibleSecondaryLinqOutcomes(handler, dependencies)({
      rawBody: JSON.stringify(event),
      signature: "signature",
      timestamp: "timestamp",
    })).resolves.toMatchObject({
      ignored: false,
      reason: "visible-secondary-reply:group-chat",
    });

    expect(resolveHostedRecognizedInboundAccess).toHaveBeenCalledOnce();
    expect(sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat_group_visible",
      idempotencyKey: "visible-secondary:evt_active_trial",
      message: expect.stringContaining("active Murph member"),
      replyToMessageId: "msg_evt_active_trial",
    }));
  });

  it("falls back to a privacy-safe room reply without a distinct private route", async () => {
    const event = buildGroupLinqEvent("evt_no_private_route");
    const sendHostedLinqChatMessage = vi.fn(async () => ({
      chatId: "chat_group_visible",
      messageId: "msg_group_fallback",
    }));
    const resolveHostedRecognizedInboundAccess = vi.fn();
    const dependencies = buildLinqDependencies({
      event,
      readHostedMemberRoutingState: vi.fn(async () => null),
      resolveHostedRecognizedInboundAccess,
      sendHostedLinqChatMessage,
    });
    const handler: HostedOnboardingLinqWebhookHandler = vi.fn(async () => ({
      ignored: true,
      ok: true as const,
      reason: "group-chat",
    }));

    await withHostedVisibleSecondaryLinqOutcomes(handler, dependencies)({
      rawBody: JSON.stringify(event),
      signature: "signature",
      timestamp: "timestamp",
    });

    expect(resolveHostedRecognizedInboundAccess).not.toHaveBeenCalled();
    expect(sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat_group_visible",
      message: expect.stringContaining("active Murph member"),
      replyToMessageId: "msg_evt_no_private_route",
    }));
  });

  it("never sends account recovery to a stored route that is itself a group", async () => {
    const event = buildGroupLinqEvent("evt_stored_group_route");
    const sendHostedLinqChatMessage = vi.fn(async () => ({
      chatId: "chat_group_visible",
      messageId: "msg_group_fallback",
    }));
    const resolveHostedRecognizedInboundAccess = vi.fn();
    const dependencies = buildLinqDependencies({
      event,
      getHostedLinqChatSummary: vi.fn(async () => ({
        handles: [],
        isGroup: true,
      })),
      readHostedMemberRoutingState: vi.fn(async () => ({
        linqChatId: "chat_legacy_group",
      }) as never),
      resolveHostedRecognizedInboundAccess,
      sendHostedLinqChatMessage,
    });
    const handler: HostedOnboardingLinqWebhookHandler = vi.fn(async () => ({
      ignored: true,
      ok: true as const,
      reason: "group-chat",
    }));

    await withHostedVisibleSecondaryLinqOutcomes(handler, dependencies)({
      rawBody: JSON.stringify(event),
      signature: "signature",
      timestamp: "timestamp",
    });

    expect(resolveHostedRecognizedInboundAccess).not.toHaveBeenCalled();
    expect(sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat_group_visible",
    }));
  });

  it("rechecks the private route after access resolution before sending", async () => {
    const event = buildGroupLinqEvent("evt_route_changed");
    const sendHostedLinqChatMessage = vi.fn(async () => ({
      chatId: "chat_group_visible",
      messageId: "msg_group_fallback",
    }));
    const readHostedMemberRoutingState = vi.fn()
      .mockResolvedValueOnce({ linqChatId: "chat_private_member" })
      .mockResolvedValueOnce({ linqChatId: "chat_new_private_member" });
    const dependencies = buildLinqDependencies({
      event,
      getHostedLinqChatSummary: vi.fn(async () => ({
        handles: [],
        isGroup: false,
      })),
      readHostedMemberRoutingState,
      resolveHostedRecognizedInboundAccess: vi.fn(async () => ({
        kind: "access_notice" as const,
        message: TRIAL_CONVERSION_MESSAGE,
        noticeCode: "trial_conversion_pending" as const,
        responseReason: "sent-trial-conversion-notice",
      })),
      sendHostedLinqChatMessage,
    });
    const handler: HostedOnboardingLinqWebhookHandler = vi.fn(async () => ({
      ignored: true,
      ok: true as const,
      reason: "group-chat",
    }));

    await withHostedVisibleSecondaryLinqOutcomes(handler, dependencies)({
      rawBody: JSON.stringify(event),
      signature: "signature",
      timestamp: "timestamp",
    });

    expect(sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat_group_visible",
      idempotencyKey: "visible-secondary:evt_route_changed",
    }));
  });

  it("keeps an unknown group sender silent", async () => {
    const event = buildGroupLinqEvent("evt_unknown_sender");
    const sendHostedLinqChatMessage = vi.fn();
    const dependencies = buildLinqDependencies({
      event,
      lookupHostedMemberIdentityByPhoneNumber: vi.fn(async () => null),
      readHostedMemberRoutingState: vi.fn(),
      resolveHostedRecognizedInboundAccess: vi.fn(),
      sendHostedLinqChatMessage,
    });
    const handler: HostedOnboardingLinqWebhookHandler = vi.fn(async () => ({
      ignored: true,
      ok: true as const,
      reason: "group-chat",
    }));

    await expect(withHostedVisibleSecondaryLinqOutcomes(handler, dependencies)({
      rawBody: JSON.stringify(event),
      signature: "signature",
      timestamp: "timestamp",
    })).resolves.toEqual({
      ignored: true,
      ok: true,
      reason: "group-chat",
    });

    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });
});

function buildLinqDependencies(input: {
  event: ReturnType<typeof requireHostedLinqMessageReceivedEvent>;
  getHostedLinqChatSummary?: NonNullable<
    HostedVisibleSecondaryLinqDependencies["getHostedLinqChatSummary"]
  >;
  lookupHostedMemberIdentityByPhoneNumber?: HostedVisibleSecondaryLinqDependencies[
    "lookupHostedMemberIdentityByPhoneNumber"
  ];
  readHostedMemberRoutingState: NonNullable<
    HostedVisibleSecondaryLinqDependencies["readHostedMemberRoutingState"]
  >;
  resolveHostedRecognizedInboundAccess: NonNullable<
    HostedVisibleSecondaryLinqDependencies["resolveHostedRecognizedInboundAccess"]
  >;
  sendHostedLinqChatMessage: HostedVisibleSecondaryLinqDependencies[
    "sendHostedLinqChatMessage"
  ];
}): HostedVisibleSecondaryLinqDependencies {
  return {
    ...(input.getHostedLinqChatSummary
      ? { getHostedLinqChatSummary: input.getHostedLinqChatSummary }
      : {}),
    getPrisma: vi.fn(() => ({}) as never),
    lookupHostedMemberByVerifiedEmailAddress: vi.fn(async () => null),
    lookupHostedMemberIdentityByPhoneNumber:
      input.lookupHostedMemberIdentityByPhoneNumber
      ?? vi.fn(async () => ({
        core: {
          id: "member_group_sender",
          suspendedAt: null,
        },
      }) as never),
    parseHostedLinqWebhookEvent: vi.fn(() => input.event),
    readHostedMemberRoutingState: input.readHostedMemberRoutingState,
    resolveHostedRecognizedInboundAccess:
      input.resolveHostedRecognizedInboundAccess,
    sendHostedLinqChatMessage: input.sendHostedLinqChatMessage,
  };
}

function buildGroupLinqEvent(
  eventId: string,
): ReturnType<typeof requireHostedLinqMessageReceivedEvent> {
  return requireHostedLinqMessageReceivedEvent({
    api_version: "v3",
    created_at: "2026-07-27T12:00:00.000Z",
    data: {
      chat: {
        id: "chat_group_visible",
        is_group: true,
        owner_handle: {
          handle: "+15550000000",
          id: "handle_owner",
          is_me: true,
          service: "imessage",
        },
      },
      direction: "inbound",
      id: `msg_${eventId}`,
      is_from_me: false,
      parts: [{ type: "text", value: "Murph?" }],
      recipient_handle: {
        handle: "+15550000000",
        id: "handle_recipient",
        is_me: true,
        service: "imessage",
      },
      recipient_phone: "+15550000000",
      sender_handle: {
        handle: "+15551234567",
        id: "handle_sender",
        service: "imessage",
      },
      sent_at: "2026-07-27T12:00:00.000Z",
      service: "imessage",
    },
    event_id: eventId,
    event_type: "message.received",
    webhook_version: "2026-02-03",
  });
}
