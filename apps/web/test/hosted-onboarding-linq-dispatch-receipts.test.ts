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

describe("handleHostedOnboardingLinqWebhook (receipts)", () => {
  beforeEach(() => {
    resetHostedOnboardingLinqDispatchMocks();
  });

  it("consumes admitted stale first-contact receipts before explicit thread-route wake", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    const eventId = "evt_stale_first_contact_thread_route";
    const routeAccountLookupKey = createHostedPhoneLookupKey("+15550000000");
    if (!routeAccountLookupKey) {
      throw new Error("Expected test account lookup key.");
    }
    const routeLookupKey = createHostedExternalThreadLookupKey({
      accountLookupKey: routeAccountLookupKey,
      channel: "linq",
      threadId: "chat_123",
    });
    if (!routeLookupKey) {
      throw new Error("Expected test route lookup key.");
    }
    const firstContactReceipt = createHostedLinqFirstContactEventReceiptFixture();
    const staleReceipt = await firstContactReceipt.create({
      data: {
        eventId,
        processingOwnerToken: "owner_stale_thread_route",
        status: "processing",
      },
    }) as HostedLinqReceiptRecord;
    staleReceipt.updatedAt = new Date("2026-03-26T11:54:00.000Z");
    const prisma = asPrismaTransactionClient({
      hostedLinqFirstContactAdmissionDecision: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          category: "join_intent",
          confidence: 0.94,
          decision: "allow",
          eventId,
          source: "model",
        }),
      },
      hostedLinqFirstContactEventReceipt: firstContactReceipt,
      hostedThreadRoute: {
        findMany: vi.fn().mockResolvedValue([
          {
            channel: "linq",
            container: {
              member: {
                billingStatus: HostedBillingStatus.active,
                createdAt: new Date("2026-03-26T00:00:00.000Z"),
                id: "member_thread_container_stale",
                suspendedAt: null,
                updatedAt: new Date("2026-03-26T00:00:00.000Z"),
              },
              owner: {
                billingStatus: HostedBillingStatus.active,
                createdAt: new Date("2026-03-26T00:00:00.000Z"),
                id: "member_owner_stale",
                suspendedAt: null,
                updatedAt: new Date("2026-03-26T00:00:00.000Z"),
              },
            },
            containerMemberId: "member_thread_container_stale",
            threadLookupKey: routeLookupKey,
          },
        ]),
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
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId,
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "stale-first-contact",
    });

    expect(await firstContactReceipt.findUnique({
      where: {
        eventId,
      },
    })).toMatchObject({
      eventId,
      status: "consumed",
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it.each([
    "enforce",
    "off",
  ] as const)("recovers an explicit thread-route mailbox duplicate before consuming a stale first-contact receipt in %s mode", async (mode) => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = mode;
    const eventId = `evt_thread_route_duplicate_before_stale_${mode}`;
    const routeAccountLookupKey = createHostedPhoneLookupKey("+15550000000");
    if (!routeAccountLookupKey) {
      throw new Error("Expected test account lookup key.");
    }
    const routeLookupKey = createHostedExternalThreadLookupKey({
      accountLookupKey: routeAccountLookupKey,
      channel: "linq",
      threadId: "chat_123",
    });
    if (!routeLookupKey) {
      throw new Error("Expected test route lookup key.");
    }
    const firstContactReceipt = createHostedLinqFirstContactEventReceiptFixture();
    const staleReceipt = await firstContactReceipt.create({
      data: {
        eventId,
        processingOwnerToken: `owner_stale_thread_route_duplicate_${mode}`,
        status: "processing",
      },
    }) as HostedLinqReceiptRecord;
    staleReceipt.updatedAt = new Date("2026-03-26T11:54:00.000Z");
    const threadRoute = {
      channel: "linq",
      container: {
        member: {
          billingStatus: HostedBillingStatus.active,
          createdAt: new Date("2026-03-26T00:00:00.000Z"),
          id: "member_thread_container_duplicate",
          suspendedAt: null,
          updatedAt: new Date("2026-03-26T00:00:00.000Z"),
        },
        owner: {
          billingStatus: HostedBillingStatus.active,
          createdAt: new Date("2026-03-26T00:00:00.000Z"),
          id: "member_owner_duplicate",
          suspendedAt: null,
          updatedAt: new Date("2026-03-26T00:00:00.000Z"),
        },
      },
      containerMemberId: "member_thread_container_duplicate",
      threadLookupKey: routeLookupKey,
    };
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValueOnce({
      id: `mailbox_${eventId}`,
    });
    const prismaMocks = {
      hostedLinqFirstContactAdmissionDecision: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedLinqFirstContactEventReceipt: firstContactReceipt,
      hostedThreadRoute: {
        findMany: vi.fn().mockResolvedValue([threadRoute]),
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
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId,
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      duplicate: true,
      ignored: true,
      ok: true,
      reason: "duplicate-webhook-event",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).not.toHaveBeenCalled();
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_thread_container_duplicate",
      mailboxItemId: `mailbox_${eventId}`,
    });
    expectHostedLinqReadReceiptSent();
    expect(await firstContactReceipt.findUnique({
      where: {
        eventId,
      },
    })).toMatchObject({
      eventId,
      status: "consumed",
    });
  });

  it("requires admission before explicit thread-route wake for unclassified stale first-contact receipts", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    mocks.classifyHostedLinqFirstContactAdmission.mockResolvedValueOnce({
      category: "wrong_number_or_personal_logistics",
      confidence: 0.96,
      kind: "block",
      source: "model",
    });
    const eventId = "evt_stale_first_contact_thread_route_unclassified";
    const routeAccountLookupKey = createHostedPhoneLookupKey("+15550000000");
    if (!routeAccountLookupKey) {
      throw new Error("Expected test account lookup key.");
    }
    const routeLookupKey = createHostedExternalThreadLookupKey({
      accountLookupKey: routeAccountLookupKey,
      channel: "linq",
      threadId: "chat_123",
    });
    if (!routeLookupKey) {
      throw new Error("Expected test route lookup key.");
    }
    const firstContactReceipt = createHostedLinqFirstContactEventReceiptFixture();
    const staleReceipt = await firstContactReceipt.create({
      data: {
        eventId,
        processingOwnerToken: "owner_stale_thread_route_unclassified",
        status: "processing",
      },
    }) as HostedLinqReceiptRecord;
    staleReceipt.updatedAt = new Date("2026-03-26T11:54:00.000Z");
    const prismaMocks = {
      hostedLinqFirstContactAdmissionDecision: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedLinqFirstContactEventReceipt: firstContactReceipt,
      hostedThreadRoute: {
        findMany: vi.fn().mockResolvedValue([
          {
            channel: "linq",
            container: {
              member: {
                billingStatus: HostedBillingStatus.active,
                createdAt: new Date("2026-03-26T00:00:00.000Z"),
                id: "member_thread_container_unclassified",
                suspendedAt: null,
                updatedAt: new Date("2026-03-26T00:00:00.000Z"),
              },
              owner: {
                billingStatus: HostedBillingStatus.active,
                createdAt: new Date("2026-03-26T00:00:00.000Z"),
                id: "member_owner_unclassified",
                suspendedAt: null,
                updatedAt: new Date("2026-03-26T00:00:00.000Z"),
              },
            },
            containerMemberId: "member_thread_container_unclassified",
            threadLookupKey: routeLookupKey,
          },
        ]),
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
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId,
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "blocked-first-contact-admission",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          decision: "block",
          eventId,
        }),
      }),
    );
    expect(await firstContactReceipt.findUnique({
      where: {
        eventId,
      },
    })).toMatchObject({
      eventId,
      status: "consumed",
    });
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("consumes a stale fail-open signup receipt with same-event delivered proof before pending-member reclassification", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    const eventId = "evt_fail_open_delivered_retry_blocks";
    const claimSentAt = new Date("2026-03-26T12:00:00.500Z");
    mocks.readHostedLinqDailyState
      .mockResolvedValueOnce(null)
      .mockResolvedValue(makeHostedLinqDailyState({
        onboardingLinkSentAt: claimSentAt,
      }));
    mocks.classifyHostedLinqFirstContactAdmission
      .mockRejectedValueOnce(hostedOnboardingError({
        cause: new Error("fetch failed"),
        code: "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE",
        details: {
          operationName: "hosted_linq_first_contact_admission",
          type: "transport",
        },
        httpStatus: 503,
        message: "Linq first-contact admission classifier is unavailable.",
        retryable: true,
      }))
      .mockResolvedValueOnce({
        category: "wrong_number_or_personal_logistics",
        confidence: 0.94,
        kind: "block",
        source: "model",
      });

    let member = null as HostedMemberRecord | null;
    const invite = {
      channel: "linq",
      id: "invite_fail_open_delivered_retry_blocks",
      inviteCode: "code_fail_open_delivered_retry_blocks",
      linqFirstContactEventId: null as string | null,
      memberId: "member_fail_open_delivered_retry_blocks",
      sentAt: null as Date | null,
      status: "pending",
    };
    const firstContactReceipt = createHostedLinqFirstContactEventReceiptFixture();
    let failFirstConsume = true;
    firstContactReceipt.updateMany.mockImplementation(async (input: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    }) => {
      const current = await firstContactReceipt.findUnique({
        where: {
          eventId: input.where.eventId,
        },
      }) as HostedLinqReceiptRecord | null;
      if (!current) {
        return {
          count: 0,
        };
      }
      if (typeof input.where.status === "string" && current.status !== input.where.status) {
        return {
          count: 0,
        };
      }
      if (
        typeof input.where.processingOwnerToken === "string"
        && current.processingOwnerToken !== input.where.processingOwnerToken
      ) {
        return {
          count: 0,
        };
      }
      if (input.where.updatedAt && typeof input.where.updatedAt === "object") {
        if (!(current.updatedAt instanceof Date)) {
          return {
            count: 0,
          };
        }
        const cutoff = input.where.updatedAt as { gte?: Date; lt?: Date };
        if (cutoff.lt instanceof Date && current.updatedAt.getTime() >= cutoff.lt.getTime()) {
          return {
            count: 0,
          };
        }
        if (cutoff.gte instanceof Date && current.updatedAt.getTime() < cutoff.gte.getTime()) {
          return {
            count: 0,
          };
        }
      }
      if (failFirstConsume && input.data.status === "consumed") {
        failFirstConsume = false;
        throw new Error("receipt consume failed");
      }
      Object.assign(current, input.data, {
        updatedAt: new Date(),
      });
      return {
        count: 1,
      };
    });
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
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          invite.linqFirstContactEventId = typeof data.linqFirstContactEventId === "string"
            ? data.linqFirstContactEventId
            : null;
          return invite;
        }),
        findFirst: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => {
          if (where?.sentAt) {
            return invite.sentAt && where.linqFirstContactEventId === invite.linqFirstContactEventId
              ? invite
              : null;
          }
          return null;
        }),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn(),
        updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (typeof data.linqFirstContactEventId === "string") {
            invite.linqFirstContactEventId = data.linqFirstContactEventId;
          }
          if (data.sentAt instanceof Date) {
            invite.sentAt = data.sentAt;
          }
          return { count: 1 };
        }),
      },
      hostedLinqFirstContactAdmissionDecision: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedLinqFirstContactEventReceipt: firstContactReceipt,
      hostedMember: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          member = {
            billingStatus: HostedBillingStatus.not_started,
            id: invite.memberId,
            phoneLookupKey: data.phoneLookupKey,
            suspendedAt: null,
          };
          return member;
        }),
        findUnique: vi.fn(async () => member),
        update: vi.fn(),
      },
      hostedMemberRouting: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);
    const rawBody = buildHostedLinqWebhookBody({
      eventId,
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody,
      signature: null,
      timestamp: null,
    })).rejects.toThrow("receipt consume failed");

    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(invite.linqFirstContactEventId).toBe(eventId);
    expect(invite.sentAt).toBeInstanceOf(Date);
    expect(invite.sentAt?.getTime()).toBeGreaterThanOrEqual(claimSentAt.getTime());
    const staleReceipt = await firstContactReceipt.findUnique({
      where: {
        eventId,
      },
    }) as HostedLinqReceiptRecord | null;
    expect(staleReceipt).toMatchObject({
      status: "processing",
    });
    if (!staleReceipt) {
      throw new Error("Expected stale first-contact receipt.");
    }
    staleReceipt.updatedAt = new Date("2026-03-26T11:54:00.000Z");
    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody,
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "signup-link-already-sent",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(await firstContactReceipt.findUnique({
      where: {
        eventId,
      },
    })).toMatchObject({
      status: "consumed",
    });
    expect(firstContactReceipt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "consumed",
      }),
      where: expect.objectContaining({
        eventId,
        processingOwnerToken: expect.any(String),
        status: "processing",
      }),
    }));
  });

  it("does not use another event's delivered signup proof to admit a stale retry", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    const staleEventId = "evt_stale_fail_open_cross_event_a";
    const deliveredEventId = "evt_delivered_fail_open_cross_event_b";
    const memberId = "member_fail_open_cross_event";
    const claimSentAt = new Date("2026-03-26T12:00:00.500Z");
    const firstContactReceipt = createHostedLinqFirstContactEventReceiptFixture();
    const staleReceipt = await firstContactReceipt.create({
      data: {
        eventId: staleEventId,
        processingOwnerToken: "owner_stale_cross_event_a",
        status: "processing",
      },
    }) as HostedLinqReceiptRecord;
    staleReceipt.updatedAt = new Date("2026-03-26T11:54:00.000Z");
    mocks.readHostedLinqDailyState.mockResolvedValue(makeHostedLinqDailyState({
      onboardingLinkSentAt: claimSentAt,
    }));
    mocks.classifyHostedLinqFirstContactAdmission.mockResolvedValueOnce({
      category: "wrong_number_or_personal_logistics",
      confidence: 0.94,
      kind: "block",
      source: "model",
    });

    const deliveredInvite = {
      channel: "linq",
      id: "invite_fail_open_cross_event_b",
      inviteCode: "code_fail_open_cross_event_b",
      linqFirstContactEventId: deliveredEventId,
      memberId,
      sentAt: new Date("2026-03-26T12:00:01.000Z"),
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
        findFirst: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => {
          if (where?.sentAt) {
            if (
              where.linqFirstContactEventId
              && where.linqFirstContactEventId !== deliveredInvite.linqFirstContactEventId
            ) {
              return null;
            }
            return deliveredInvite;
          }
          return null;
        }),
        findUnique: vi.fn().mockResolvedValue(deliveredInvite),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqFirstContactAdmissionDecision: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedLinqFirstContactEventReceipt: firstContactReceipt,
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: memberId,
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
        update: vi.fn(),
      },
      hostedMemberRouting: {
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: staleEventId,
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "blocked-first-contact-admission",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          decision: "block",
          eventId: staleEventId,
        }),
      }),
    );
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("does not treat pending fail-open member state as admission after pre-send signup delivery failure", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    mocks.classifyHostedLinqFirstContactAdmission.mockReset();
    mocks.classifyHostedLinqFirstContactAdmission
      .mockRejectedValueOnce(hostedOnboardingError({
        cause: new Error("fetch failed"),
        code: "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE",
        details: {
          operationName: "hosted_linq_first_contact_admission",
          type: "transport",
        },
        httpStatus: 503,
        message: "Linq first-contact admission classifier is unavailable.",
        retryable: true,
      }))
      .mockResolvedValueOnce({
        category: "wrong_number_or_personal_logistics",
        confidence: 0.94,
        kind: "block",
        source: "model",
      });
    mocks.sendHostedLinqChatMessage.mockRejectedValueOnce(new Error("linq send failed"));

    const eventId = "evt_fail_open_pre_send_failure";
    let member = null as HostedMemberRecord | null;
    let invite: Record<string, unknown> | null = null;
    const admissionDecisions = new Map<string, Record<string, unknown>>();
    const firstContactReceipt = createHostedLinqFirstContactEventReceiptFixture();
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
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          invite = {
            channel: data.channel,
            expiresAt: data.expiresAt,
            id: "invite_fail_open_pre_send_failure",
            inviteCode: "code_fail_open_pre_send_failure",
            memberId: data.memberId,
            sentAt: null,
            status: "pending",
          };
          return invite;
        }),
        findFirst: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => {
          if (!invite) {
            return null;
          }
          if (where?.sentAt) {
            return invite.sentAt ? invite : null;
          }
          if (where?.expiresAt) {
            return invite;
          }
          return null;
        }),
        findUnique: vi.fn(async () => invite),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          invite = {
            ...(invite ?? {}),
            ...data,
          };
          return invite;
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqFirstContactAdmissionDecision: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          admissionDecisions.set(String(data.eventId), data);
          return data;
        }),
        findUnique: vi.fn(async ({ where }: { where: { eventId: string } }) =>
          admissionDecisions.get(where.eventId) ?? null),
      },
      hostedLinqFirstContactEventReceipt: firstContactReceipt,
      hostedMember: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          member = {
            billingStatus: HostedBillingStatus.not_started,
            id: "member_fail_open_pre_send_failure",
            phoneLookupKey: data.phoneLookupKey,
            suspendedAt: null,
          };
          return member;
        }),
        findUnique: vi.fn(async () => member),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);
    const rawBody = buildHostedLinqWebhookBody({
      eventId,
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody,
      signature: null,
      timestamp: null,
    })).rejects.toThrow("linq send failed");

    expect(prismaMocks.hostedMember.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).not.toHaveBeenCalled();
    expect(mocks.releaseHostedLinqOnboardingLinkNoticeClaim).toHaveBeenCalledTimes(1);
    expect(await firstContactReceipt.findUnique({
      where: {
        eventId,
      },
    })).toMatchObject({
      eventId,
      status: "processing",
    });

    if (!member) {
      throw new Error("Expected fail-open attempt to create a pending member.");
    }
    member.billingStatus = HostedBillingStatus.active;

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody,
      signature: null,
      timestamp: null,
    })).rejects.toMatchObject({
      code: "LINQ_FIRST_CONTACT_EVENT_PROCESSING",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();

    const retainedReceipt = await firstContactReceipt.findUnique({
      where: {
        eventId,
      },
    }) as HostedLinqReceiptRecord | null;
    if (!retainedReceipt) {
      throw new Error("Expected pre-send failure to retain the first-contact receipt.");
    }
    retainedReceipt.updatedAt = new Date("2026-03-26T11:54:00.000Z");

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody,
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "blocked-first-contact-admission",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledTimes(2);
    expect(prismaMocks.hostedMember.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          decision: "block",
          eventId,
        }),
      }),
    );
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(invite).toMatchObject({
      id: "invite_fail_open_pre_send_failure",
      sentAt: null,
    });
    expect(await firstContactReceipt.findUnique({
      where: {
        eventId,
      },
    })).toMatchObject({
      eventId,
      status: "consumed",
    });
  });

  it("consumes stale first-contact receipts before active routing when admission is disabled", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "off";
    mocks.classifyHostedLinqFirstContactAdmission.mockReset();
    mocks.sendHostedLinqChatMessage.mockRejectedValueOnce(new Error("linq send failed"));

    const eventId = "evt_admission_off_pre_send_failure";
    let member = null as HostedMemberRecord | null;
    let invite: Record<string, unknown> | null = null;
    const firstContactReceipt = createHostedLinqFirstContactEventReceiptFixture();
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
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          invite = {
            channel: data.channel,
            expiresAt: data.expiresAt,
            id: "invite_admission_off_pre_send_failure",
            inviteCode: "code_admission_off_pre_send_failure",
            memberId: data.memberId,
            sentAt: null,
            status: "pending",
          };
          return invite;
        }),
        findFirst: vi.fn(async ({ where }: { where?: Record<string, unknown> }) => {
          if (!invite) {
            return null;
          }
          if (where?.sentAt) {
            return invite.sentAt ? invite : null;
          }
          if (where?.expiresAt) {
            return invite;
          }
          return null;
        }),
        findUnique: vi.fn(async () => invite),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          invite = {
            ...(invite ?? {}),
            ...data,
          };
          return invite;
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqFirstContactEventReceipt: firstContactReceipt,
      hostedMember: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          member = {
            billingStatus: HostedBillingStatus.not_started,
            id: "member_admission_off_pre_send_failure",
            phoneLookupKey: data.phoneLookupKey,
            suspendedAt: null,
          };
          return member;
        }),
        findUnique: vi.fn(async () => member),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);
    const rawBody = buildHostedLinqWebhookBody({
      eventId,
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody,
      signature: null,
      timestamp: null,
    })).rejects.toThrow("linq send failed");

    expect(mocks.classifyHostedLinqFirstContactAdmission).not.toHaveBeenCalled();
    expect(prismaMocks.hostedMember.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(mocks.releaseHostedLinqOnboardingLinkNoticeClaim).toHaveBeenCalledTimes(1);
    const retainedReceipt = await firstContactReceipt.findUnique({
      where: {
        eventId,
      },
    }) as HostedLinqReceiptRecord | null;
    expect(retainedReceipt).toMatchObject({
      eventId,
      status: "processing",
    });

    if (!member || !retainedReceipt) {
      throw new Error("Expected failed signup send to leave member and first-contact receipt.");
    }
    member.billingStatus = HostedBillingStatus.active;
    retainedReceipt.updatedAt = new Date("2026-03-26T11:54:00.000Z");

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody,
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "stale-first-contact",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).not.toHaveBeenCalled();
    expect(prismaMocks.hostedMember.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(await firstContactReceipt.findUnique({
      where: {
        eventId,
      },
    })).toMatchObject({
      eventId,
      status: "consumed",
    });
  });

  it("consumes stale first-contact receipts before active home-line redirects", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "off";
    const eventId = "evt_stale_first_contact_redirect";
    const memberId = "member_stale_first_contact_redirect";
    const firstContactReceipt = createHostedLinqFirstContactEventReceiptFixture();
    const staleReceipt = await firstContactReceipt.create({
      data: {
        eventId,
        processingOwnerToken: "owner_stale_first_contact_redirect",
        status: "processing",
      },
    }) as HostedLinqReceiptRecord;
    staleReceipt.updatedAt = new Date("2026-03-26T11:54:00.000Z");
    const homeRoute = {
      linqChatIdEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-routing.home-linq-chat-id",
        memberId,
        value: "chat_home",
      }),
      linqRecipientPhoneEncrypted: await encryptHostedWebNullableString({
        field: "hosted-member-routing.home-linq-recipient-phone",
        memberId,
        value: "+15550100001",
      }),
      memberId,
      pendingLinqChatIdEncrypted: null,
      pendingLinqRecipientPhoneEncrypted: null,
      telegramUserIdEncrypted: null,
      telegramUserLookupKey: null,
    };
    const prismaMocks = {
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
      hostedLinqFirstContactEventReceipt: firstContactReceipt,
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          id: memberId,
          invites: [],
          phoneLookupKey: "+15551234567",
          routing: homeRoute,
          suspendedAt: null,
        }),
        update: vi.fn(),
      },
      hostedMemberRouting: {
        findUnique: vi.fn().mockResolvedValue(homeRoute),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_other",
            owner_handle: {
              handle: "+15550100002",
              id: "handle_owner_other",
              is_me: true,
              service: "sms",
            },
          },
        },
        eventId,
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "stale-first-contact",
    });

    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(await firstContactReceipt.findUnique({
      where: {
        eventId,
      },
    })).toMatchObject({
      eventId,
      status: "consumed",
    });
  });
});
