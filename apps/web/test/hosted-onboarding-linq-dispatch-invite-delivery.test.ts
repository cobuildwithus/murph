import { HostedBillingStatus, type HostedLinqDailyState } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  asPrismaTransactionClient,
  buildHostedLinqWebhookBody,
  buildTypingWebhookBody,
  createHostedLinqFirstContactEventReceiptFixture,
  expectHostedLinqPointerSignalAccepted,
  expectHostedLinqReadReceiptSent,
  handleHostedOnboardingLinqWebhook,
  makeHostedLinqDailyState,
  mocks,
  readHostedMemberRoutingUpsertMock,
  readHostedWebhookReceiptCreateMock,
  readHostedWebhookReceiptUpdateManyMock,
  readHostedWebhookSideEffectUpsertCalls,
  resetHostedOnboardingLinqDispatchMocks,
  withPrismaTransaction,
  withSerializedPrismaTransactions,
  type HostedLinqReceiptRecord,
  type HostedMemberRecord,
} from "./__helpers__/hosted-onboarding-linq-dispatch";
import {
  buildHostedAiUsageGateNoticeIdempotencyKey,
  type HostedAiUsageGateDecision,
} from "@/src/lib/hosted-execution/usage-allowance";
import { encryptHostedWebNullableString } from "@/src/lib/hosted-web/encryption";
import {
  createHostedExternalThreadLookupKey,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
import {
  buildHostedInviteReply,
  buildHostedLinqConversationHomeRedirectReply,
  parseHostedLinqWebhookEvent,
  requireHostedLinqMessageReceivedEvent,
} from "@/src/lib/hosted-onboarding/linq";
import { createHostedLinqParticipantContact } from "@/src/lib/hosted-onboarding/linq-participant-contact";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { hostedLinqFirstContactContainsBlockedContent } from "@/src/lib/hosted-onboarding/webhook-provider-linq-shared";

describe("handleHostedOnboardingLinqWebhook (invite-delivery)", () => {
  beforeEach(() => {
    resetHostedOnboardingLinqDispatchMocks();
  });

  it("sends the signup link on the first inbound Linq message", async () => {
    const invite = {
      channel: "linq",
      id: "invite_123",
      inviteCode: "code_first_text",
      memberId: "member_123",
      sentAt: null,
      status: "pending",
    };
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventType: "message.received",
            receiptAttemptCount: 1,
            receiptStatus: "processing",
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({
          id: "invite_123",
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          phoneLookupKey: "+15551234567",
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          parts: [
            {
              type: "text",
              value: "hello there",
            },
          ],
        },
        eventId: "evt_non_trigger",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      inviteCode: "code_first_text",
      joinUrl: "https://join.example.test/join/code_first_text",
      ok: true,
      reason: "sent-signup-link",
    });
    expect(prismaMocks.hostedMember.findUnique).toHaveBeenCalledTimes(2);
    expect(prismaMocks.hostedInvite.findFirst).toHaveBeenCalledTimes(2);
    expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.updateMany).toHaveBeenCalledWith({
      where: {
        id: "invite_123",
        OR: [
          {
            sentAt: null,
          },
          {
            linqFirstContactEventId: "evt_non_trigger",
          },
        ],
      },
      data: {
        linqFirstContactEventId: "evt_non_trigger",
        sentAt: expect.any(Date),
      },
    });
    expect(prismaMocks.hostedMember.create).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: buildHostedInviteReply({
          joinUrl: "https://join.example.test/join/code_first_text",
        }),
        replyToMessageId: "msg_123",
      }),
    );
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.claimHostedLinqOnboardingLinkNotice).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
      sentAt: expect.any(Date),
    });
    expect(mocks.claimHostedLinqOnboardingLinkNotice.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendHostedLinqChatMessage.mock.invocationCallOrder[0],
    );
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("retries signup delivery with the same invite after a stale daily claim without delivered invite evidence", async () => {
    mocks.readHostedLinqDailyState.mockResolvedValueOnce(makeHostedLinqDailyState({
      onboardingLinkSentAt: new Date("2026-03-26T12:00:01.000Z"),
    }));
    const invite: {
      channel: string;
      id: string;
      inviteCode: string;
      memberId: string;
      sentAt: Date | null;
      status: string;
    } = {
      channel: "linq",
      id: "invite_stale_claim",
      inviteCode: "code_stale_claim",
      memberId: "member_stale_claim",
      sentAt: null,
      status: "pending",
    };
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventType: "message.received",
            receiptAttemptCount: 1,
            receiptStatus: "processing",
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn(async (
          { where }: { select?: Record<string, unknown>; where?: Record<string, unknown> } = {},
        ) => (where?.sentAt || where?.linqFirstContactEventId ? null : invite)),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn(async ({ data }: { data: { sentAt?: Date } }) => {
          if (data.sentAt) {
            invite.sentAt = data.sentAt;
          }
          return invite;
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_stale_claim",
          phoneLookupKey: "+15551234567",
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_stale_daily_claim_retry",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      inviteCode: "code_stale_claim",
      ok: true,
      reason: "sent-signup-link",
    });

    expect(mocks.releaseHostedLinqOnboardingLinkNoticeClaim).toHaveBeenCalledWith({
      memberId: "member_stale_claim",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
      sentAt: new Date("2026-03-26T12:00:01.000Z"),
    });
    expect(prismaMocks.hostedInvite.findFirst).toHaveBeenCalledWith({
      orderBy: {
        sentAt: "desc",
      },
      where: {
        channel: "linq",
        memberId: "member_stale_claim",
        sentAt: {
          gte: new Date("2026-03-26T12:00:01.000Z"),
          not: null,
        },
      },
    });
    expect(prismaMocks.hostedInvite.findFirst).toHaveBeenCalledWith({
      orderBy: {
        createdAt: "desc",
      },
      where: {
        expiresAt: {
          gt: expect.any(Date),
        },
        memberId: "member_stale_claim",
      },
    });
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.update).toHaveBeenCalledWith({
      where: {
        id: "invite_stale_claim",
      },
      data: {
        channel: "linq",
        linqFirstContactEventId: "evt_stale_daily_claim_retry",
      },
    });
    expect(prismaMocks.hostedInvite.updateMany).toHaveBeenCalledWith({
      where: {
        id: "invite_stale_claim",
        OR: [
          {
            sentAt: null,
          },
          {
            linqFirstContactEventId: "evt_stale_daily_claim_retry",
          },
        ],
      },
      data: {
        linqFirstContactEventId: "evt_stale_daily_claim_retry",
        sentAt: expect.any(Date),
      },
    });
  });

  it("creates a fresh invite instead of rewriting a sent invite's first-contact event proof", async () => {
    mocks.readHostedLinqDailyState.mockResolvedValueOnce(null);
    const sentInvite = {
      channel: "linq",
      id: "invite_prior_sent_event",
      inviteCode: "code_prior_sent_event",
      linqFirstContactEventId: "evt_prior_sent_event",
      memberId: "member_new_send_after_sent_invite",
      sentAt: new Date("2026-03-25T12:00:01.000Z"),
      status: "pending",
    };
    const newInvite = {
      channel: "linq",
      id: "invite_new_send_after_sent_invite",
      inviteCode: "code_new_send_after_sent_invite",
      linqFirstContactEventId: "evt_new_send_after_sent_invite",
      memberId: "member_new_send_after_sent_invite",
      sentAt: null as Date | null,
      status: "pending",
    };
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventType: "message.received",
            receiptAttemptCount: 1,
            receiptStatus: "processing",
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          ...newInvite,
          linqFirstContactEventId: data.linqFirstContactEventId,
        })),
        findFirst: vi.fn(async ({ where }: { where?: Record<string, unknown> }) =>
          where?.linqFirstContactEventId === "evt_new_send_after_sent_invite" ? null : sentInvite
        ),
        findUnique: vi.fn().mockResolvedValue(newInvite),
        update: vi.fn(async ({ data, where }: { data: Record<string, unknown>; where: Record<string, unknown> }) => {
          if (where.id === newInvite.id && data.sentAt instanceof Date) {
            newInvite.sentAt = data.sentAt;
          }
          return {
            ...newInvite,
            ...data,
          };
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_new_send_after_sent_invite",
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_new_send_after_sent_invite",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      inviteCode: "code_new_send_after_sent_invite",
      ok: true,
      reason: "sent-signup-link",
    });

    expect(prismaMocks.hostedInvite.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        linqFirstContactEventId: "evt_new_send_after_sent_invite",
        memberId: "member_new_send_after_sent_invite",
      }),
    });
    expect(prismaMocks.hostedInvite.update).not.toHaveBeenCalledWith({
      where: {
        id: sentInvite.id,
      },
      data: expect.objectContaining({
        linqFirstContactEventId: "evt_new_send_after_sent_invite",
      }),
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
  });

  it("reuses an in-flight first-contact invite and rebinds its event proof", async () => {
    mocks.readHostedLinqDailyState.mockResolvedValueOnce(null);
    const inFlightInvite = {
      channel: "linq",
      id: "invite_in_flight_event_a",
      inviteCode: "code_in_flight_event_a",
      linqFirstContactEventId: "evt_in_flight_event_a",
      memberId: "member_in_flight_rebind",
      sentAt: null as Date | null,
      status: "pending",
    };
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventType: "message.received",
            receiptAttemptCount: 1,
            receiptStatus: "processing",
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn(async ({ where }: { where?: Record<string, unknown> }) =>
          where?.linqFirstContactEventId === "evt_in_flight_event_b" ? null : inFlightInvite
        ),
        findUnique: vi.fn().mockResolvedValue(inFlightInvite),
        update: vi.fn(async ({ data, where }: { data: Record<string, unknown>; where: Record<string, unknown> }) => {
          if (where.id === inFlightInvite.id && typeof data.linqFirstContactEventId === "string") {
            inFlightInvite.linqFirstContactEventId = data.linqFirstContactEventId;
          }
          if (where.id === inFlightInvite.id && data.sentAt instanceof Date) {
            inFlightInvite.sentAt = data.sentAt;
          }
          return {
            ...inFlightInvite,
            ...data,
          };
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_in_flight_rebind",
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_in_flight_event_b",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      inviteCode: "code_in_flight_event_a",
      ok: true,
      reason: "sent-signup-link",
    });

    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.update).toHaveBeenCalledWith({
      where: {
        id: inFlightInvite.id,
      },
      data: {
        channel: "linq",
        linqFirstContactEventId: "evt_in_flight_event_b",
      },
    });
    expect(inFlightInvite.linqFirstContactEventId).toBe("evt_in_flight_event_b");
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
  });

  it("reuses an older same-event invite when a newer invite belongs to another event", async () => {
    mocks.readHostedLinqDailyState.mockResolvedValueOnce(null);
    const sameEventInvite = {
      channel: "linq",
      id: "invite_same_event_retry_a1",
      inviteCode: "code_same_event_retry_a1",
      linqFirstContactEventId: "evt_same_event_retry_a",
      memberId: "member_same_event_retry",
      sentAt: null as Date | null,
      status: "pending",
    };
    const newerOtherEventInvite = {
      channel: "linq",
      id: "invite_same_event_retry_b1",
      inviteCode: "code_same_event_retry_b1",
      linqFirstContactEventId: "evt_same_event_retry_b",
      memberId: "member_same_event_retry",
      sentAt: null as Date | null,
      status: "pending",
    };
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventType: "message.received",
            receiptAttemptCount: 1,
            receiptStatus: "processing",
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn(async ({ where }: { where?: Record<string, unknown> }) =>
          where?.linqFirstContactEventId === "evt_same_event_retry_a"
            ? sameEventInvite
            : newerOtherEventInvite
        ),
        findUnique: vi.fn().mockResolvedValue(sameEventInvite),
        update: vi.fn(async ({ data, where }: { data: Record<string, unknown>; where: Record<string, unknown> }) => {
          if (where.id === sameEventInvite.id && data.sentAt instanceof Date) {
            sameEventInvite.sentAt = data.sentAt;
          }
          return {
            ...sameEventInvite,
            ...data,
          };
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_same_event_retry",
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_same_event_retry_a",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      inviteCode: "code_same_event_retry_a1",
      ok: true,
      reason: "sent-signup-link",
    });

    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.update).toHaveBeenCalledWith({
      where: {
        id: sameEventInvite.id,
      },
      data: {
        channel: "linq",
      },
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
  });

  it("does not clear an in-flight daily onboarding claim before invite delivery proof exists", async () => {
    const claimSentAt = new Date();
    mocks.readHostedLinqDailyState.mockResolvedValueOnce(makeHostedLinqDailyState({
      onboardingLinkSentAt: claimSentAt,
    }));
    const hostedInviteCreate = vi.fn();
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventType: "message.received",
            receiptAttemptCount: 1,
            receiptStatus: "processing",
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: hostedInviteCreate,
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_in_flight_claim",
          phoneLookupKey: "+15551234567",
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_in_flight_daily_claim",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toMatchObject({
      code: "LINQ_FIRST_CONTACT_EVENT_PROCESSING",
      retryable: true,
    });

    expect(prismaMocks.hostedInvite.findFirst).toHaveBeenCalledWith({
      orderBy: {
        sentAt: "desc",
      },
      where: {
        channel: "linq",
        memberId: "member_in_flight_claim",
        sentAt: {
          gte: claimSentAt,
          not: null,
        },
      },
    });
    expect(mocks.releaseHostedLinqOnboardingLinkNoticeClaim).not.toHaveBeenCalled();
    expect(hostedInviteCreate).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("stores iMessage email handles as pending Linq contact claims instead of verified emails", async () => {
    const invite = {
      channel: "linq",
      id: "invite_email_handle",
      inviteCode: "code_email_handle",
      memberId: "member_email",
      sentAt: null,
      status: "pending",
    };
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventType: "message.received",
            receiptAttemptCount: 1,
            receiptStatus: "processing",
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({
          id: "invite_email_handle",
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_email",
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      hostedMemberEmailAuthorization: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      hostedMemberIdentity: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({
          ...create,
          ...update,
        })),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({
          ...create,
          ...update,
        })),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          sender_handle: {
            handle: "Buddy@iCloud.com",
            id: "handle_sender_email",
            service: "iMessage",
          },
        },
        eventId: "evt_email_handle",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      inviteCode: "code_email_handle",
      joinUrl: "https://join.example.test/join/code_email_handle",
      ok: true,
      reason: "sent-signup-link",
    });
    expect(prismaMocks.hostedMemberEmailAuthorization.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedMemberIdentity.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          phoneLookupKey: null,
          phoneNumberEncrypted: null,
        }),
      }),
    );
    expect(prismaMocks.hostedMemberRouting.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          pendingLinqParticipantContactKind: "email",
          pendingLinqParticipantContactLookupKey: expect.stringMatching(/^hbidx:email:v1:/u),
        }),
        update: expect.objectContaining({
          pendingLinqParticipantContactKind: "email",
          pendingLinqParticipantContactLookupKey: expect.stringMatching(/^hbidx:email:v1:/u),
        }),
      }),
    );
    expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: buildHostedInviteReply({
          joinUrl: "https://join.example.test/join/code_email_handle",
        }),
        replyToMessageId: "msg_123",
      }),
    );
  });

  it("sends first-contact signup links even when inbound Linq parts exceed mailbox limits", async () => {
    const invite = {
      channel: "linq",
      id: "invite_many_parts",
      inviteCode: "code_many_parts",
      memberId: "member_123",
      sentAt: null,
      status: "pending",
    };
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventType: "message.received",
            receiptAttemptCount: 1,
            receiptStatus: "processing",
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({
          id: "invite_many_parts",
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          phoneLookupKey: "+15551234567",
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          parts: Array.from({ length: 33 }, (_, index) => ({
            type: "text",
            value: `part ${index}`,
          })),
        },
        eventId: "evt_first_contact_many_parts",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      inviteCode: "code_many_parts",
      joinUrl: "https://join.example.test/join/code_many_parts",
      ok: true,
      reason: "sent-signup-link",
    });

    expect(prismaMocks.hostedMember.findUnique).toHaveBeenCalledTimes(2);
    expect(prismaMocks.hostedMember.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.findFirst).toHaveBeenCalledTimes(2);
    expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.updateMany).toHaveBeenCalledWith({
      where: {
        id: "invite_many_parts",
        OR: [
          {
            sentAt: null,
          },
          {
            linqFirstContactEventId: "evt_first_contact_many_parts",
          },
        ],
      },
      data: {
        linqFirstContactEventId: "evt_first_contact_many_parts",
        sentAt: expect.any(Date),
      },
    });
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: buildHostedInviteReply({
          joinUrl: "https://join.example.test/join/code_many_parts",
        }),
        replyToMessageId: "msg_123",
      }),
    );
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("sends the signup link on the first inbound SMS phone message", async () => {
    const invite = {
      channel: "linq",
      id: "invite_sms",
      inviteCode: "code_sms",
      memberId: "member_123",
      sentAt: null,
      status: "pending",
    };
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventType: "message.received",
            receiptAttemptCount: 1,
            receiptStatus: "processing",
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({
          id: "invite_sms",
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          phoneLookupKey: "+15551234567",
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_sms_first_contact",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      inviteCode: "code_sms",
      joinUrl: "https://join.example.test/join/code_sms",
      ok: true,
      reason: "sent-signup-link",
    });
    expect(prismaMocks.hostedMember.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.findFirst).toHaveBeenCalledTimes(2);
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.claimHostedLinqOnboardingLinkNotice).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
      sentAt: expect.any(Date),
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: buildHostedInviteReply({
          joinUrl: "https://join.example.test/join/code_sms",
        }),
        replyToMessageId: "msg_123",
      }),
    );
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("ignores non-phone SMS first contact before invite side effects", async () => {
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMemberEmailAuthorization: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      hostedMemberRouting: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn(),
      },
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventType: "message.received",
            receiptAttemptCount: 1,
            receiptStatus: "processing",
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          sender_handle: {
            handle: "buddy@example.test",
            id: "handle_sender_email_sms",
            service: "sms",
          },
        },
        eventId: "evt_sms_email_first_contact",
        service: "sms",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "undeliverable-first-contact",
    });
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.findFirst).not.toHaveBeenCalled();
    expect(prismaMocks.hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("applies standalone opt-out blocking only to SMS-like or unknown phone first-contact services", () => {
    const phoneContact = createHostedLinqParticipantContact({
      kind: "phone",
      value: "+15551234567",
    });
    const emailContact = createHostedLinqParticipantContact({
      kind: "email",
      value: "buddy@example.test",
    });
    if (!phoneContact || !emailContact) {
      throw new Error("Expected valid Linq participant contacts.");
    }

    const messageEvent = requireHostedLinqMessageReceivedEvent(parseHostedLinqWebhookEvent(
      buildHostedLinqWebhookBody({
        data: {
          parts: [
            {
              type: "text",
              value: "STOP",
            },
          ],
        },
        service: "iMessage",
      }),
    ));
    const messageEventWithoutService = {
      ...messageEvent,
      data: {
        ...messageEvent.data,
        service: undefined,
      },
    };

    expect(hostedLinqFirstContactContainsBlockedContent({
      event: messageEventWithoutService,
      participantContact: phoneContact,
    })).toBe(true);
    expect(hostedLinqFirstContactContainsBlockedContent({
      event: messageEventWithoutService,
      participantContact: emailContact,
    })).toBe(false);
    expect(hostedLinqFirstContactContainsBlockedContent({
      event: messageEvent,
      participantContact: phoneContact,
    })).toBe(false);
  });

  it("keeps first-contact signup replies inline", async () => {
    const invite = {
      channel: "linq",
      id: "invite_123",
      inviteCode: "code_deferred",
      memberId: "member_123",
      sentAt: null,
      status: "pending",
    };
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventType: "message.received",
            receiptAttemptCount: 1,
            receiptStatus: "processing",
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({
          id: "invite_123",
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          phoneLookupKey: "+15551234567",
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_deferred_signup",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      inviteCode: "code_deferred",
      joinUrl: "https://join.example.test/join/code_deferred",
      ok: true,
      reason: "sent-signup-link",
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: buildHostedInviteReply({
          joinUrl: "https://join.example.test/join/code_deferred",
        }),
        replyToMessageId: "msg_123",
      }),
    );
  });

  it("passes the request signal through inline signup replies", async () => {
    const invite = {
      channel: "linq",
      id: "invite_123",
      inviteCode: "code_aborted",
      memberId: "member_123",
      sentAt: null,
      status: "pending",
    };
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventType: "message.received",
            receiptAttemptCount: 1,
            receiptStatus: "processing",
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({
          id: "invite_123",
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          phoneLookupKey: "+15551234567",
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);
    const controller = new AbortController();

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_aborted_signup",
        service: "iMessage",
      }),
      signal: controller.signal,
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "sent-signup-link",
    });

    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: buildHostedInviteReply({
          joinUrl: "https://join.example.test/join/code_aborted",
        }),
        replyToMessageId: "msg_123",
        signal: controller.signal,
      }),
    );
    controller.abort();
  });

  it("sends the signup link even when the first-contact Linq message has no text", async () => {
    const invite = {
      channel: "linq",
      id: "invite_123",
      inviteCode: "code_non_text",
      memberId: "member_123",
      sentAt: null,
      status: "pending",
    };
    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventType: "message.received",
            receiptAttemptCount: 1,
            receiptStatus: "processing",
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({
          id: "invite_123",
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          phoneLookupKey: "+15551234567",
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          parts: [
            {
              type: "media",
              url: "https://example.test/signup.jpg",
            },
          ],
        },
        eventId: "evt_non_text",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      inviteCode: "code_non_text",
      joinUrl: "https://join.example.test/join/code_non_text",
      ok: true,
      reason: "sent-signup-link",
    });
    expect(prismaMocks.hostedMember.findUnique).toHaveBeenCalledTimes(2);
    expect(prismaMocks.hostedInvite.findFirst).toHaveBeenCalledTimes(2);
    expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedMember.create).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: buildHostedInviteReply({
          joinUrl: "https://join.example.test/join/code_non_text",
        }),
        replyToMessageId: "msg_123",
      }),
    );
  });

  it("suppresses repeat signup links after the first send that day even when the invite expired", async () => {
    mocks.readHostedLinqDailyState.mockResolvedValueOnce(makeHostedLinqDailyState({
      inboundCount: 1,
      onboardingLinkSentAt: new Date("2026-03-26T12:00:01.000Z"),
    }));
    const prisma = asPrismaTransactionClient({
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventType: "message.received",
            receiptAttemptCount: 1,
            receiptStatus: "processing",
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue({
          channel: "linq",
          expiresAt: new Date("2026-03-26T12:00:00.500Z"),
          id: "invite_repeat_signup",
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_repeat_signup",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "signup-link-already-sent",
    });
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.findFirst).toHaveBeenCalledWith({
      orderBy: {
        sentAt: "desc",
      },
      where: {
        channel: "linq",
        memberId: "member_123",
        sentAt: {
          gte: new Date("2026-03-26T12:00:01.000Z"),
          not: null,
        },
      },
    });
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("does not ACK signup link delivery when another request only claimed the one-shot notice", async () => {
    mocks.claimHostedLinqOnboardingLinkNotice.mockResolvedValueOnce(false);
    mocks.readHostedLinqDailyState.mockResolvedValueOnce(null);
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValueOnce(makeHostedLinqDailyState());
    const hostedInviteCreate = vi.fn().mockResolvedValue({
      channel: "linq",
      id: "invite_123",
      inviteCode: "code_first_text",
      memberId: "member_123",
      sentAt: null,
      status: "pending",
    });
    const hostedFirstContactEventReceiptCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => data);
    const prisma = asPrismaTransactionClient({
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventType: "message.received",
            receiptAttemptCount: 1,
            receiptStatus: "processing",
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: hostedInviteCreate,
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({}),
      },
      hostedLinqFirstContactEventReceipt: {
        create: hostedFirstContactEventReceiptCreate,
        deleteMany: vi.fn(async () => ({ count: 0 })),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_signup_mark_after_send",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toMatchObject({
      code: "LINQ_FIRST_CONTACT_EVENT_PROCESSING",
      retryable: true,
    });
    expect(hostedInviteCreate).toHaveBeenCalled();
    expect(hostedFirstContactEventReceiptCreate).toHaveBeenCalledWith({
      data: {
        eventId: "evt_signup_mark_after_send",
        processingOwnerToken: expect.any(String),
        status: "processing",
      },
    });
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
      sentAt: expect.any(Date),
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
  });
});
