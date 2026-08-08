import { describe, expect, it, vi } from "vitest";

import {
  requireHostedLinqMessageReceivedEvent,
} from "@/src/lib/hosted-onboarding/linq";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  createHostedLinqParticipantContact,
} from "@/src/lib/hosted-onboarding/linq-participant-contact";
import {
  type HostedOnboardingLinqWebhookHandler,
  type HostedVisibleSecondaryLinqDependencies,
  withHostedVisibleSecondaryLinqOutcomes,
} from "@/src/lib/hosted-onboarding/visible-secondary-webhooks";

const BILLING_INACTIVE_MESSAGE =
  "Murph can't use this account right now. Check your account settings or contact support: https://withmurph.ai/settings";
const SIGNUP_MESSAGE =
  "Murph isn't fully set up on this account yet. Finish setup here:\nhttps://withmurph.ai/join/invite-123";
const GROUP_SENDER_PHONE = "+15551234567";

const GROUP_SENDER_CONTACT = requireTestLinqParticipantContact({
  kind: "phone",
  value: GROUP_SENDER_PHONE,
});
const OTHER_PHONE_CONTACT = requireTestLinqParticipantContact({
  kind: "phone",
  value: "+15559876543",
});
const GROUP_SENDER_EMAIL = "member@example.com";
const GROUP_SENDER_EMAIL_CONTACT = requireTestLinqParticipantContact({
  kind: "email",
  value: GROUP_SENDER_EMAIL,
});

const MATCHING_PRIVATE_HANDLES = [{
  handle: GROUP_SENDER_PHONE,
  isMe: false,
  status: null,
}];

function requireTestLinqParticipantContact(
  input: Parameters<typeof createHostedLinqParticipantContact>[0],
) {
  const contact = createHostedLinqParticipantContact(input);
  if (!contact) {
    throw new Error("Expected a valid Linq participant contact fixture.");
  }
  return contact;
}

describe("Linq group-chat visible access recovery", () => {
  it("privately explains inactive access after neutral setup guidance is sent", async () => {
    const event = buildGroupLinqEvent("evt_group_setup_private");
    const sendHostedLinqChatMessage = vi.fn(async () => ({
      chatId: "chat_private_member",
      messageId: "msg_private_recovery",
    }));
    const dependencies = buildLinqDependencies({
      event,
      getHostedLinqChatSummary: vi.fn(async () => ({
        handles: MATCHING_PRIVATE_HANDLES,
        isGroup: false,
      })),
      readHostedMemberRoutingState: vi.fn(async () => ({
        linqChatId: "chat_private_member",
        linqRecipientPhone: "+15550000000",
      }) as never),
      resolveHostedRecognizedInboundAccess: vi.fn(async () => ({
        kind: "access_notice" as const,
        message: BILLING_INACTIVE_MESSAGE,
        noticeCode: "billing_inactive" as const,
        responseReason: "sent-billing-inactive-notice",
      })),
      sendHostedLinqChatMessage,
    });
    const handler: HostedOnboardingLinqWebhookHandler = vi.fn(async () => ({
      joinUrl: "https://withmurph.ai/groups/start",
      ok: true as const,
      reason: "sent-group-setup",
    }));

    const response = await withHostedVisibleSecondaryLinqOutcomes(
      handler,
      dependencies,
    )({
      rawBody: JSON.stringify(event),
      signature: "signature",
      timestamp: "timestamp",
    });

    expect(response).toEqual({
      joinUrl: "https://withmurph.ai/groups/start",
      ok: true,
      reason: "sent-group-setup",
    });
    expect(sendHostedLinqChatMessage).toHaveBeenCalledOnce();
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat_private_member",
      idempotencyKey: expect.stringMatching(
        /^visible-secondary-private:[0-9a-f]{32}$/u,
      ),
      message: `${BILLING_INACTIVE_MESSAGE}\n\nOnce that's sorted, send me another message in the group and I'll try again.`,
      replyToMessageId: null,
    }));
  });

  it("stabilizes private recovery by group day, member, and recovery kind", async () => {
    const idempotencyKeys: string[] = [];
    const noticeSeeds: string[] = [];
    const sendHostedLinqChatMessage:
      HostedVisibleSecondaryLinqDependencies["sendHostedLinqChatMessage"] =
      async (input) => {
        if (!input.idempotencyKey) {
          throw new Error("Expected private recovery to carry an idempotency key.");
        }
        idempotencyKeys.push(input.idempotencyKey);
        return {
          chatId: "chat_private_member",
          messageId: `msg_private_${idempotencyKeys.length}`,
        };
      };
    const handler: HostedOnboardingLinqWebhookHandler = vi.fn(async () => ({
      joinUrl: "https://withmurph.ai/groups/start",
      ok: true as const,
      reason: "sent-group-setup",
    }));
    const run = async (input: {
      createdAt: string;
      eventId: string;
      recoveryKind?: "access-notice" | "signup";
    }) => {
      const event = buildGroupLinqEvent(
        input.eventId,
        GROUP_SENDER_PHONE,
        input.createdAt,
      );
      const dependencies = buildLinqDependencies({
        event,
        getHostedLinqChatSummary: vi.fn(async () => ({
          handles: MATCHING_PRIVATE_HANDLES,
          isGroup: false,
        })),
        readHostedMemberRoutingState: vi.fn(async () => ({
          linqChatId: "chat_private_member",
          linqRecipientPhone: "+15550000000",
        }) as never),
        resolveHostedRecognizedInboundAccess: vi.fn(async (accessInput) => {
          noticeSeeds.push(accessInput.noticeSeed);
          return input.recoveryKind === "signup"
            ? {
                inviteCode: "invite-123",
                inviteId: "invite_123",
                joinUrl: "https://withmurph.ai/join/invite-123",
                kind: "signup" as const,
                message: SIGNUP_MESSAGE,
                responseReason: "sent-signup-link" as const,
              }
            : {
                kind: "access_notice" as const,
                message: BILLING_INACTIVE_MESSAGE,
                noticeCode: "billing_inactive" as const,
                responseReason: "sent-billing-inactive-notice",
              };
        }),
        sendHostedLinqChatMessage,
      });

      await withHostedVisibleSecondaryLinqOutcomes(handler, dependencies)({
        rawBody: JSON.stringify(event),
        signature: "signature",
        timestamp: "timestamp",
      });
    };

    await run({
      createdAt: "2026-07-27T12:00:00.000Z",
      eventId: "evt_group_setup_same_day_a",
    });
    await run({
      createdAt: "2026-07-27T20:00:00.000Z",
      eventId: "evt_group_setup_same_day_b",
    });
    await run({
      createdAt: "2026-07-28T12:00:00.000Z",
      eventId: "evt_group_setup_next_day",
    });
    await run({
      createdAt: "2026-07-27T22:00:00.000Z",
      eventId: "evt_group_setup_changed_kind",
      recoveryKind: "signup",
    });

    expect(idempotencyKeys).toHaveLength(4);
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
    expect(idempotencyKeys[2]).not.toBe(idempotencyKeys[0]);
    expect(idempotencyKeys[3]).not.toBe(idempotencyKeys[0]);
    expect(noticeSeeds[1]).toBe(noticeSeeds[0]);
    expect(noticeSeeds[2]).not.toBe(noticeSeeds[0]);
    expect(noticeSeeds[3]).toBe(noticeSeeds[0]);
    for (const idempotencyKey of idempotencyKeys) {
      expect(idempotencyKey).toMatch(
        /^visible-secondary-private:[0-9a-f]{32}$/u,
      );
    }
  });

  it("retries private recovery with the same provider key after room completion", async () => {
    const event = buildGroupLinqEvent(
      "evt_group_setup_private_retry",
      GROUP_SENDER_PHONE,
      "2026-07-27T12:00:00.000Z",
    );
    const retryableError = hostedOnboardingError({
      code: "LINQ_SEND_FAILED",
      httpStatus: 502,
      message: "Linq outbound reply failed with HTTP 503.",
      retryable: true,
    });
    const sendHostedLinqChatMessage = vi.fn()
      .mockRejectedValueOnce(retryableError)
      .mockResolvedValueOnce({
        chatId: "chat_private_member",
        messageId: "msg_private_retry",
      });
    const dependencies = buildLinqDependencies({
      event,
      getHostedLinqChatSummary: vi.fn(async () => ({
        handles: MATCHING_PRIVATE_HANDLES,
        isGroup: false,
      })),
      readHostedMemberRoutingState: vi.fn(async () => ({
        linqChatId: "chat_private_member",
        linqRecipientPhone: "+15550000000",
      }) as never),
      resolveHostedRecognizedInboundAccess: vi.fn(async () => ({
        kind: "access_notice" as const,
        message: BILLING_INACTIVE_MESSAGE,
        noticeCode: "billing_inactive" as const,
        responseReason: "sent-billing-inactive-notice",
      })),
      sendHostedLinqChatMessage,
    });
    const handler: HostedOnboardingLinqWebhookHandler = vi.fn(async () => ({
      joinUrl: "https://withmurph.ai/groups/start",
      ok: true as const,
      reason: "sent-group-setup",
    }));
    const input = {
      rawBody: JSON.stringify(event),
      signature: "signature",
      timestamp: "timestamp",
    };

    await expect(withHostedVisibleSecondaryLinqOutcomes(
      handler,
      dependencies,
    )(input)).rejects.toBe(retryableError);
    await expect(withHostedVisibleSecondaryLinqOutcomes(
      handler,
      dependencies,
    )(input)).resolves.toMatchObject({
      ok: true,
      reason: "sent-group-setup",
    });

    const providerKeys = sendHostedLinqChatMessage.mock.calls.map(
      ([sendInput]) => sendInput.idempotencyKey,
    );
    expect(providerKeys).toHaveLength(2);
    expect(providerKeys[1]).toBe(providerKeys[0]);
    expect(providerKeys[0]).toMatch(
      /^visible-secondary-private:[0-9a-f]{32}$/u,
    );
  });

  it("adds no disclosure when setup guidance has no safe private route", async () => {
    const event = buildGroupLinqEvent("evt_group_setup_no_private");
    const sendHostedLinqChatMessage = vi.fn();
    const dependencies = buildLinqDependencies({
      event,
      readHostedMemberRoutingState: vi.fn(async () => null),
      resolveHostedRecognizedInboundAccess: vi.fn(),
      sendHostedLinqChatMessage,
    });
    const handler: HostedOnboardingLinqWebhookHandler = vi.fn(async () => ({
      joinUrl: "https://withmurph.ai/groups/start",
      ok: true as const,
      reason: "sent-group-setup",
    }));

    await withHostedVisibleSecondaryLinqOutcomes(handler, dependencies)({
      rawBody: JSON.stringify(event),
      signature: "signature",
      timestamp: "timestamp",
    });

    expect(sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

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
      .mockResolvedValueOnce({
        linqChatId: "chat_private_member",
        linqRecipientPhone: "+15550000000",
      })
      .mockResolvedValueOnce({
        linqChatId: "chat_private_member",
        linqRecipientPhone: "+15550000000",
      });
    const resolveHostedRecognizedInboundAccess = vi.fn(async () => ({
      kind: "access_notice" as const,
      message: BILLING_INACTIVE_MESSAGE,
      noticeCode: "billing_inactive" as const,
      responseReason: "sent-billing-inactive-notice",
    }));
    const dependencies = buildLinqDependencies({
      event,
      getHostedLinqChatSummary: vi.fn(async () => ({
        handles: MATCHING_PRIVATE_HANDLES,
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
      message: `${BILLING_INACTIVE_MESSAGE}\n\nOnce that's sorted, send me another message in the group and I'll try again.`,
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
        handles: MATCHING_PRIVATE_HANDLES,
        isGroup: false,
      })),
      readHostedMemberRoutingState: vi.fn(async () => ({
        linqChatId: "chat_private_member",
        linqRecipientPhone: "+15550000000",
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

  it("sends one private recovery when the stored and provider email audience match", async () => {
    const event = buildGroupLinqEvent(
      "evt_matching_email",
      GROUP_SENDER_EMAIL,
    );
    const sendHostedLinqChatMessage = vi.fn(async () => ({
      chatId: "chat_private_email_member",
      messageId: "msg_private_recovery",
    }));
    const routing = {
      linqChatId: "chat_private_email_member",
      linqParticipantContact: {
        kind: GROUP_SENDER_EMAIL_CONTACT.kind,
        lookupKey: GROUP_SENDER_EMAIL_CONTACT.lookupKey,
      },
      linqRecipientPhone: "+15550000000",
    };
    const dependencies = buildLinqDependencies({
      event,
      getHostedLinqChatSummary: vi.fn(async () => ({
        handles: [{
          handle: GROUP_SENDER_EMAIL,
          isMe: false,
          status: null,
        }],
        isGroup: false,
      })),
      lookupHostedMemberByVerifiedEmailAddress: vi.fn(async () => ({
        core: {
          id: "member_group_sender",
          suspendedAt: null,
        },
      }) as never),
      readHostedMemberRoutingState: vi.fn(async () => routing as never),
      resolveHostedRecognizedInboundAccess: vi.fn(async () => ({
        kind: "access_notice" as const,
        message: BILLING_INACTIVE_MESSAGE,
        noticeCode: "billing_inactive" as const,
        responseReason: "sent-billing-inactive-notice",
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

    expect(sendHostedLinqChatMessage).toHaveBeenCalledOnce();
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat_private_email_member",
      idempotencyKey: "visible-secondary-private:evt_matching_email",
    }));
  });

  it("does not misclassify an allowed active starter account as setup-incomplete", async () => {
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
        handles: MATCHING_PRIVATE_HANDLES,
        isGroup: false,
      })),
      readHostedMemberRoutingState: vi.fn(async () => ({
        linqChatId: "chat_private_member",
        linqRecipientPhone: "+15550000000",
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
      message: expect.stringContaining("same Murph number"),
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
      message: expect.stringContaining("same Murph number"),
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
        handles: MATCHING_PRIVATE_HANDLES,
        isGroup: true,
      })),
      readHostedMemberRoutingState: vi.fn(async () => ({
        linqChatId: "chat_legacy_group",
        linqRecipientPhone: "+15550000000",
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

  it("never sends private recovery to a committed route owned by another contact", async () => {
    const event = buildGroupLinqEvent("evt_stale_committed_contact");
    const sendHostedLinqChatMessage = vi.fn(async () => ({
      chatId: "chat_group_visible",
      messageId: "msg_group_fallback",
    }));
    const resolveHostedRecognizedInboundAccess = vi.fn();
    const dependencies = buildLinqDependencies({
      event,
      getHostedLinqChatSummary: vi.fn(async () => ({
        handles: MATCHING_PRIVATE_HANDLES,
        isGroup: false,
      })),
      readHostedMemberRoutingState: vi.fn(async () => ({
        linqChatId: "chat_stale_private_member",
        linqParticipantContact: {
          kind: OTHER_PHONE_CONTACT.kind,
          lookupKey: OTHER_PHONE_CONTACT.lookupKey,
        },
        linqRecipientPhone: "+15550000000",
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
    expect(sendHostedLinqChatMessage).toHaveBeenCalledOnce();
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat_group_visible",
      idempotencyKey: "visible-secondary:evt_stale_committed_contact",
    }));
  });

  it("uses a matching pending route when the committed route belongs to an old contact", async () => {
    const event = buildGroupLinqEvent("evt_matching_pending_after_stale_committed");
    const sendHostedLinqChatMessage = vi.fn(async () => ({
      chatId: "chat_pending_member",
      messageId: "msg_private_recovery",
    }));
    const routing = {
      linqChatId: "chat_stale_private_member",
      linqParticipantContact: {
        kind: OTHER_PHONE_CONTACT.kind,
        lookupKey: OTHER_PHONE_CONTACT.lookupKey,
      },
      linqRecipientPhone: "+15550000000",
      pendingLinqChatId: "chat_pending_member",
      pendingLinqParticipantContact: {
        ...GROUP_SENDER_CONTACT,
        observedAt: new Date("2026-07-27T12:00:00.000Z"),
      },
      pendingLinqRecipientPhone: "+15550000000",
    };
    const dependencies = buildLinqDependencies({
      event,
      getHostedLinqChatSummary: vi.fn(async () => ({
        handles: MATCHING_PRIVATE_HANDLES,
        isGroup: false,
      })),
      readHostedMemberRoutingState: vi.fn(async () => routing as never),
      resolveHostedRecognizedInboundAccess: vi.fn(async () => ({
        kind: "access_notice" as const,
        message: BILLING_INACTIVE_MESSAGE,
        noticeCode: "billing_inactive" as const,
        responseReason: "sent-billing-inactive-notice",
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

    expect(sendHostedLinqChatMessage).toHaveBeenCalledOnce();
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat_pending_member",
      idempotencyKey:
        "visible-secondary-private:evt_matching_pending_after_stale_committed",
    }));
  });

  it("never sends private recovery to a pending route owned by another contact", async () => {
    const event = buildGroupLinqEvent("evt_stale_pending_contact");
    const sendHostedLinqChatMessage = vi.fn(async () => ({
      chatId: "chat_group_visible",
      messageId: "msg_group_fallback",
    }));
    const resolveHostedRecognizedInboundAccess = vi.fn();
    const dependencies = buildLinqDependencies({
      event,
      readHostedMemberRoutingState: vi.fn(async () => ({
        linqChatId: null,
        linqRecipientPhone: null,
        pendingLinqChatId: "chat_stale_pending_member",
        pendingLinqParticipantContact: {
          ...OTHER_PHONE_CONTACT,
          observedAt: new Date("2026-07-27T12:00:00.000Z"),
        },
        pendingLinqRecipientPhone: "+15550000000",
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
    expect(sendHostedLinqChatMessage).toHaveBeenCalledOnce();
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
      .mockResolvedValueOnce({
        linqChatId: "chat_private_member",
        linqRecipientPhone: "+15550000000",
      })
      .mockResolvedValueOnce({
        linqChatId: "chat_new_private_member",
        linqRecipientPhone: "+15550000000",
      });
    const dependencies = buildLinqDependencies({
      event,
      getHostedLinqChatSummary: vi.fn(async () => ({
        handles: MATCHING_PRIVATE_HANDLES,
        isGroup: false,
      })),
      readHostedMemberRoutingState,
      resolveHostedRecognizedInboundAccess: vi.fn(async () => ({
        kind: "access_notice" as const,
        message: BILLING_INACTIVE_MESSAGE,
        noticeCode: "billing_inactive" as const,
        responseReason: "sent-billing-inactive-notice",
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

  it("falls back when the stored private-route contact changes before send", async () => {
    const event = buildGroupLinqEvent("evt_route_contact_changed");
    const sendHostedLinqChatMessage = vi.fn(async () => ({
      chatId: "chat_group_visible",
      messageId: "msg_group_fallback",
    }));
    const readHostedMemberRoutingState = vi.fn()
      .mockResolvedValueOnce({
        linqChatId: "chat_private_member",
        linqRecipientPhone: "+15550000000",
      })
      .mockResolvedValueOnce({
        linqChatId: "chat_private_member",
        linqParticipantContact: {
          kind: OTHER_PHONE_CONTACT.kind,
          lookupKey: OTHER_PHONE_CONTACT.lookupKey,
        },
        linqRecipientPhone: "+15550000000",
      });
    const dependencies = buildLinqDependencies({
      event,
      getHostedLinqChatSummary: vi.fn(async () => ({
        handles: MATCHING_PRIVATE_HANDLES,
        isGroup: false,
      })),
      readHostedMemberRoutingState,
      resolveHostedRecognizedInboundAccess: vi.fn(async () => ({
        kind: "access_notice" as const,
        message: BILLING_INACTIVE_MESSAGE,
        noticeCode: "billing_inactive" as const,
        responseReason: "sent-billing-inactive-notice",
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

    expect(sendHostedLinqChatMessage).toHaveBeenCalledOnce();
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat_group_visible",
      idempotencyKey: "visible-secondary:evt_route_contact_changed",
    }));
  });

  it("falls back to the room when the private provider route becomes a group before send", async () => {
    const event = buildGroupLinqEvent("evt_private_became_group");
    const sendHostedLinqChatMessage = vi.fn(async () => ({
      chatId: "chat_group_visible",
      messageId: "msg_group_fallback",
    }));
    const getHostedLinqChatSummary = vi.fn()
      .mockResolvedValueOnce({
        handles: MATCHING_PRIVATE_HANDLES,
        isGroup: false,
      })
      .mockResolvedValueOnce({
        handles: MATCHING_PRIVATE_HANDLES,
        isGroup: true,
      });
    const dependencies = buildLinqDependencies({
      event,
      getHostedLinqChatSummary,
      readHostedMemberRoutingState: vi.fn(async () => ({
        linqChatId: "chat_private_member",
        linqRecipientPhone: "+15550000000",
      }) as never),
      resolveHostedRecognizedInboundAccess: vi.fn(async () => ({
        kind: "access_notice" as const,
        message: BILLING_INACTIVE_MESSAGE,
        noticeCode: "billing_inactive" as const,
        responseReason: "sent-billing-inactive-notice",
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

    expect(getHostedLinqChatSummary).toHaveBeenCalledTimes(2);
    expect(sendHostedLinqChatMessage).toHaveBeenCalledOnce();
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat_group_visible",
      idempotencyKey: "visible-secondary:evt_private_became_group",
    }));
  });

  it("falls back to the room when the private provider audience changes before send", async () => {
    const event = buildGroupLinqEvent("evt_private_audience_changed");
    const sendHostedLinqChatMessage = vi.fn(async () => ({
      chatId: "chat_group_visible",
      messageId: "msg_group_fallback",
    }));
    const getHostedLinqChatSummary = vi.fn()
      .mockResolvedValueOnce({
        handles: MATCHING_PRIVATE_HANDLES,
        isGroup: false,
      })
      .mockResolvedValueOnce({
        handles: [{
          handle: OTHER_PHONE_CONTACT.value,
          isMe: false,
          status: null,
        }],
        isGroup: false,
      });
    const dependencies = buildLinqDependencies({
      event,
      getHostedLinqChatSummary,
      readHostedMemberRoutingState: vi.fn(async () => ({
        linqChatId: "chat_private_member",
        linqRecipientPhone: "+15550000000",
      }) as never),
      resolveHostedRecognizedInboundAccess: vi.fn(async () => ({
        kind: "access_notice" as const,
        message: BILLING_INACTIVE_MESSAGE,
        noticeCode: "billing_inactive" as const,
        responseReason: "sent-billing-inactive-notice",
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

    expect(getHostedLinqChatSummary).toHaveBeenCalledTimes(2);
    expect(sendHostedLinqChatMessage).toHaveBeenCalledOnce();
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat_group_visible",
      idempotencyKey: "visible-secondary:evt_private_audience_changed",
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

  it("uses an attested pending private route while setup is still incomplete", async () => {
    const event = buildGroupLinqEvent("evt_pending_private_route");
    const sendHostedLinqChatMessage = vi.fn(async () => ({
      chatId: "chat_pending_member",
      messageId: "msg_private_setup",
    }));
    const readHostedMemberRoutingState = vi.fn()
      .mockResolvedValueOnce({
        linqChatId: null,
        linqRecipientPhone: null,
        pendingLinqChatId: "chat_pending_member",
        pendingLinqRecipientPhone: "+15550000000",
      })
      .mockResolvedValueOnce({
        linqChatId: null,
        linqRecipientPhone: null,
        pendingLinqChatId: "chat_pending_member",
        pendingLinqRecipientPhone: "+15550000000",
      });
    const dependencies = buildLinqDependencies({
      event,
      getHostedLinqChatSummary: vi.fn(async () => ({
        handles: MATCHING_PRIVATE_HANDLES,
        isGroup: false,
      })),
      readHostedMemberRoutingState,
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

    expect(sendHostedLinqChatMessage).toHaveBeenCalledOnce();
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat_pending_member",
      message: expect.stringContaining("Finish setup here"),
      replyToMessageId: null,
    }));
  });

  it("does not promise recovery when the group contains another member's Murph line", async () => {
    const event = buildGroupLinqEvent("evt_wrong_murph_line");
    const sendHostedLinqChatMessage = vi.fn(async () => ({
      chatId: "chat_group_visible",
      messageId: "msg_group_fallback",
    }));
    const resolveHostedRecognizedInboundAccess = vi.fn();
    const dependencies = buildLinqDependencies({
      event,
      readHostedMemberRoutingState: vi.fn(async () => ({
        linqChatId: "chat_private_member",
        linqRecipientPhone: "+15559999999",
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
    expect(sendHostedLinqChatMessage).toHaveBeenCalledOnce();
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat_group_visible",
      message: expect.stringContaining("same Murph number"),
      replyToMessageId: "msg_evt_wrong_murph_line",
    }));
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat_group_visible",
      idempotencyKey: "visible-secondary:evt_wrong_murph_line",
    }));
  });

  it("preserves webhook retry ownership for a retryable private-route failure", async () => {
    const event = buildGroupLinqEvent("evt_retryable_private_route");
    const retryableError = hostedOnboardingError({
      code: "LINQ_SEND_FAILED",
      httpStatus: 502,
      message: "Linq outbound reply failed with HTTP 503.",
      retryable: true,
    });
    const sendHostedLinqChatMessage = vi.fn().mockRejectedValue(retryableError);
    const readHostedMemberRoutingState = vi.fn()
      .mockResolvedValueOnce({
        linqChatId: "chat_private_member",
        linqRecipientPhone: "+15550000000",
      })
      .mockResolvedValueOnce({
        linqChatId: "chat_private_member",
        linqRecipientPhone: "+15550000000",
      });
    const dependencies = buildLinqDependencies({
      event,
      getHostedLinqChatSummary: vi.fn(async () => ({
        handles: MATCHING_PRIVATE_HANDLES,
        isGroup: false,
      })),
      readHostedMemberRoutingState,
      resolveHostedRecognizedInboundAccess: vi.fn(async () => ({
        kind: "access_notice" as const,
        message: BILLING_INACTIVE_MESSAGE,
        noticeCode: "billing_inactive" as const,
        responseReason: "sent-billing-inactive-notice",
      })),
      sendHostedLinqChatMessage,
    });
    const handler: HostedOnboardingLinqWebhookHandler = vi.fn(async () => ({
      ignored: true,
      ok: true as const,
      reason: "group-chat",
    }));

    await expect(withHostedVisibleSecondaryLinqOutcomes(
      handler,
      dependencies,
    )({
      rawBody: JSON.stringify(event),
      signature: "signature",
      timestamp: "timestamp",
    })).rejects.toBe(retryableError);

    expect(sendHostedLinqChatMessage).toHaveBeenCalledOnce();
    expect(sendHostedLinqChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat_private_member",
      idempotencyKey: "visible-secondary-private:evt_retryable_private_route",
      replyToMessageId: null,
    }));
  });

  it("falls back to the neutral group reply after a definite private-route rejection", async () => {
    const event = buildGroupLinqEvent("evt_stale_private_route");
    const sendHostedLinqChatMessage = vi.fn()
      .mockRejectedValueOnce(hostedOnboardingError({
        code: "LINQ_SEND_FAILED",
        httpStatus: 502,
        message: "Linq outbound reply failed with HTTP 404.",
        retryable: false,
      }))
      .mockResolvedValueOnce({
        chatId: "chat_group_visible",
        messageId: "msg_group_fallback",
      });
    const readHostedMemberRoutingState = vi.fn()
      .mockResolvedValueOnce({
        linqChatId: "chat_private_member",
        linqRecipientPhone: "+15550000000",
      })
      .mockResolvedValueOnce({
        linqChatId: "chat_private_member",
        linqRecipientPhone: "+15550000000",
      });
    const dependencies = buildLinqDependencies({
      event,
      getHostedLinqChatSummary: vi.fn(async () => ({
        handles: MATCHING_PRIVATE_HANDLES,
        isGroup: false,
      })),
      readHostedMemberRoutingState,
      resolveHostedRecognizedInboundAccess: vi.fn(async () => ({
        kind: "access_notice" as const,
        message: BILLING_INACTIVE_MESSAGE,
        noticeCode: "billing_inactive" as const,
        responseReason: "sent-billing-inactive-notice",
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

    expect(sendHostedLinqChatMessage).toHaveBeenCalledTimes(2);
    expect(sendHostedLinqChatMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      chatId: "chat_group_visible",
      idempotencyKey: "visible-secondary:evt_stale_private_route",
      replyToMessageId: "msg_evt_stale_private_route",
    }));
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
  lookupHostedMemberByVerifiedEmailAddress?: HostedVisibleSecondaryLinqDependencies[
    "lookupHostedMemberByVerifiedEmailAddress"
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
  const readHostedMemberRoutingState = async (
    args: Parameters<
      NonNullable<
        HostedVisibleSecondaryLinqDependencies["readHostedMemberRoutingState"]
      >
    >[0],
  ) => {
    const routing = await input.readHostedMemberRoutingState(args);
    if (!routing) {
      return null;
    }

    return {
      ...routing,
      ...(routing.linqChatId && routing.linqParticipantContact === undefined
        ? {
            linqParticipantContact: {
              kind: GROUP_SENDER_CONTACT.kind,
              lookupKey: GROUP_SENDER_CONTACT.lookupKey,
            },
          }
        : {}),
      ...(routing.pendingLinqChatId
        && routing.pendingLinqParticipantContact === undefined
        ? {
            pendingLinqParticipantContact: {
              ...GROUP_SENDER_CONTACT,
              observedAt: new Date("2026-07-27T12:00:00.000Z"),
            },
          }
        : {}),
    };
  };

  return {
    ...(input.getHostedLinqChatSummary
      ? { getHostedLinqChatSummary: input.getHostedLinqChatSummary }
      : {}),
    getPrisma: vi.fn(() => ({}) as never),
    lookupHostedMemberByVerifiedEmailAddress:
      input.lookupHostedMemberByVerifiedEmailAddress
      ?? vi.fn(async () => null),
    lookupHostedMemberIdentityByPhoneNumber:
      input.lookupHostedMemberIdentityByPhoneNumber
      ?? vi.fn(async () => ({
        core: {
          id: "member_group_sender",
          suspendedAt: null,
        },
      }) as never),
    parseHostedLinqWebhookEvent: vi.fn(() => input.event),
    readHostedMemberRoutingState,
    resolveHostedRecognizedInboundAccess:
      input.resolveHostedRecognizedInboundAccess,
    sendHostedLinqChatMessage: input.sendHostedLinqChatMessage,
  };
}

function buildGroupLinqEvent(
  eventId: string,
  senderHandle = GROUP_SENDER_PHONE,
  createdAt = "2026-07-27T12:00:00.000Z",
): ReturnType<typeof requireHostedLinqMessageReceivedEvent> {
  return requireHostedLinqMessageReceivedEvent({
    api_version: "v3",
    created_at: createdAt,
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
        handle: senderHandle,
        id: "handle_sender",
        service: "imessage",
      },
      sent_at: createdAt,
      service: "imessage",
    },
    event_id: eventId,
    event_type: "message.received",
    webhook_version: "2026-02-03",
  });
}
