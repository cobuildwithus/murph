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

describe("handleHostedOnboardingLinqWebhook (fences)", () => {
  beforeEach(() => {
    resetHostedOnboardingLinqDispatchMocks();
  });

  it("claims first-contact admission processing before classification so overlapping deliveries cannot classify independently", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    mocks.readHostedLinqDailyState
      .mockResolvedValueOnce(null)
      .mockResolvedValue(makeHostedLinqDailyState({
        onboardingLinkSentAt: new Date("2026-03-26T12:00:01.000Z"),
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
      }));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const invite = {
      channel: "linq",
      id: "invite_fail_open_wins",
      inviteCode: "code_fail_open_wins",
      memberId: "member_fail_open_wins",
      sentAt: null,
      status: "pending",
    };
    let member = null as HostedMemberRecord | null;
    const firstContactReceipts = createHostedLinqFirstContactEventReceiptFixture();
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
          id: invite.id,
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqFirstContactAdmissionDecision: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedLinqFirstContactEventReceipt: firstContactReceipts,
      hostedMember: {
        create: vi.fn().mockImplementation(async () => {
          member = {
            billingStatus: HostedBillingStatus.not_started,
            id: "member_fail_open_wins",
            phoneLookupKey: "+15551234567",
            suspendedAt: null,
          };
          return member;
        }),
        findUnique: vi.fn(async () => member),
        update: vi.fn(),
      },
    };
    const prisma = withSerializedPrismaTransactions(prismaMocks);
    const rawBody = buildHostedLinqWebhookBody({
      eventId: "evt_classifier_fail_open_wins_race",
    });

    const results = await Promise.allSettled([
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody,
        signature: null,
        timestamp: null,
      }),
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody,
        signature: null,
        timestamp: null,
      }),
    ]);

    expect(results).toEqual(expect.arrayContaining([
      {
        status: "fulfilled",
        value: expect.objectContaining({
          inviteCode: "code_fail_open_wins",
          joinUrl: "https://join.example.test/join/code_fail_open_wins",
          ok: true,
          reason: "sent-signup-link",
        }),
      },
      {
        reason: expect.objectContaining({
          code: "LINQ_FIRST_CONTACT_EVENT_PROCESSING",
          retryable: true,
        }),
        status: "rejected",
      },
    ]));

    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedMember.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "Hosted Linq first-contact admission classifier unavailable; admitting first contact.",
      expect.objectContaining({
        admissionDisposition: "fail_open",
        errorCode: "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE",
        eventIdSuffix: "s_race",
        operationName: "hosted_linq_first_contact_admission",
        retryable: true,
        type: "transport",
      }),
    );
  });

  it("rejects a stale first-contact classifier owner after another delivery reclaims the event lease", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";

    let releaseStaleOwner: () => void = () => {};
    const staleOwnerReleased = new Promise<void>((resolve) => {
      releaseStaleOwner = resolve;
    });
    let releaseCurrentOwner: () => void = () => {};
    const currentOwnerReleased = new Promise<void>((resolve) => {
      releaseCurrentOwner = resolve;
    });
    const classifierUnavailable = hostedOnboardingError({
      cause: new Error("fetch failed"),
      code: "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE",
      details: {
        operationName: "hosted_linq_first_contact_admission",
        type: "transport",
      },
      httpStatus: 503,
      message: "Linq first-contact admission classifier is unavailable.",
      retryable: true,
    });
    mocks.classifyHostedLinqFirstContactAdmission
      .mockImplementationOnce(async () => {
        await staleOwnerReleased;
        throw classifierUnavailable;
      })
      .mockImplementationOnce(async () => {
        await currentOwnerReleased;
        return {
          category: "wrong_number_or_personal_logistics",
          confidence: 0.96,
          kind: "block",
          source: "model",
        };
      });

    let receiptRecord = null as HostedLinqReceiptRecord | null;
    let resolveInitialClaim: () => void = () => {};
    const initialClaimed = new Promise<void>((resolve) => {
      resolveInitialClaim = resolve;
    });
    let resolveReclaimed: () => void = () => {};
    const reclaimed = new Promise<void>((resolve) => {
      resolveReclaimed = resolve;
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
        create: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqFirstContactAdmissionDecision: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedLinqFirstContactEventReceipt: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          if (receiptRecord) {
            throw {
              code: "P2002",
            };
          }
          receiptRecord = {
            ...data,
            updatedAt: new Date("2026-03-26T12:00:00.000Z"),
          };
          resolveInitialClaim();
          return receiptRecord;
        }),
        deleteMany: vi.fn(),
        findUnique: vi.fn(async () => receiptRecord),
        updateMany: vi.fn(async ({ data, where }: { data: Record<string, unknown>; where: Record<string, unknown> }) => {
          if (
            !receiptRecord
            || receiptRecord.status !== where.status
          ) {
            return { count: 0 };
          }
          if (
            typeof where.processingOwnerToken === "string"
            && receiptRecord.processingOwnerToken !== where.processingOwnerToken
          ) {
            return { count: 0 };
          }
          if (where.updatedAt && typeof where.updatedAt === "object") {
            if (!(receiptRecord.updatedAt instanceof Date)) {
              return { count: 0 };
            }
            const cutoff = where.updatedAt as { gte?: Date; lt?: Date };
            if (cutoff.lt instanceof Date && receiptRecord.updatedAt.getTime() >= cutoff.lt.getTime()) {
              return { count: 0 };
            }
            if (cutoff.gte instanceof Date && receiptRecord.updatedAt.getTime() < cutoff.gte.getTime()) {
              return { count: 0 };
            }
          }
          receiptRecord = {
            ...receiptRecord,
            ...data,
            updatedAt: new Date(),
          };
          resolveReclaimed();
          return { count: 1 };
        }),
        upsert: vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
          receiptRecord = {
            ...(receiptRecord ?? create),
            ...update,
            updatedAt: new Date(),
          };
          return receiptRecord;
        }),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const prisma = withSerializedPrismaTransactions(prismaMocks);
    const rawBody = buildHostedLinqWebhookBody({
      eventId: "evt_classifier_stale_owner_reclaim",
    });

    const staleOwner = handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody,
      signature: null,
      timestamp: null,
    });
    await initialClaimed;
    if (receiptRecord) {
      receiptRecord.updatedAt = new Date("2026-03-26T11:59:00.000Z");
    }

    const currentOwner = handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody,
      signature: null,
      timestamp: null,
    });
    await reclaimed;

    releaseStaleOwner();
    await expect(staleOwner).rejects.toMatchObject({
      code: "LINQ_FIRST_CONTACT_EVENT_PROCESSING",
      retryable: true,
    });
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();

    releaseCurrentOwner();
    await expect(currentOwner).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "blocked-first-contact-admission",
    });
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("retries an active-member wake after a first-contact append succeeds but signaling fails", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(new Error("temporal unavailable"));
    const eventId = "evt_active_duplicate_after_signal_failure";
    let member: HostedMemberRecord = {
      billingStatus: HostedBillingStatus.not_started,
      id: "member_active_duplicate_after_signal_failure",
      phoneLookupKey: "+15551234567",
      suspendedAt: null,
    };
    mocks.classifyHostedLinqFirstContactAdmission.mockImplementationOnce(async () => {
      member = {
        ...member,
        billingStatus: HostedBillingStatus.active,
      };
      return {
        category: "join_intent",
        confidence: 0.95,
        kind: "allow",
        source: "model",
      };
    });
    let existingMailboxAvailable = false;
    mocks.readHostedMailboxItemByDedupeKey.mockImplementation(async () =>
      existingMailboxAvailable
        ? {
            id: `mailbox_${eventId}`,
          }
        : null);

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
        create: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
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
        create: vi.fn(),
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
    })).rejects.toThrow("temporal unavailable");

    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
    expect(await firstContactReceipt.findUnique({
      where: {
        eventId,
      },
    })).toMatchObject({
      eventId,
      status: "processing",
    });
    existingMailboxAvailable = true;

    const retainedReceipt = await firstContactReceipt.findUnique({
      where: {
        eventId,
      },
    }) as HostedLinqReceiptRecord | null;
    if (!retainedReceipt) {
      throw new Error("Expected failed handoff to retain the first-contact receipt.");
    }
    retainedReceipt.updatedAt = new Date("2026-03-26T11:54:00.000Z");

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody,
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      duplicate: true,
      ignored: true,
      ok: true,
      reason: "duplicate-webhook-event",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(2);
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenNthCalledWith(2, {
      expectedUserId: "member_active_duplicate_after_signal_failure",
      mailboxItemId: `mailbox_${eventId}`,
    });
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(await firstContactReceipt.findUnique({
      where: {
        eventId,
      },
    })).toMatchObject({
      eventId,
      status: "consumed",
    });
    mocks.readHostedMailboxItemByDedupeKey.mockImplementation(async () => null);
  });

  it.each([
    "enforce",
    "off",
  ] as const)("recovers a fresh active-member duplicate before the %s first-contact processing gate", async (mode) => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = mode;
    const eventId = `evt_fresh_active_duplicate_${mode}`;
    const memberId = `member_fresh_active_duplicate_${mode}`;
    const firstContactReceipt = createHostedLinqFirstContactEventReceiptFixture();
    await firstContactReceipt.create({
      data: {
        eventId,
        processingOwnerToken: `owner_fresh_active_duplicate_${mode}`,
        status: "processing",
      },
    });
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValueOnce({
      id: `mailbox_${eventId}`,
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
        create: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqFirstContactAdmissionDecision: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedLinqFirstContactEventReceipt: firstContactReceipt,
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
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
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: memberId,
      mailboxItemId: `mailbox_${eventId}`,
    });
    expect(await firstContactReceipt.findUnique({
      where: {
        eventId,
      },
    })).toMatchObject({
      eventId,
      status: "consumed",
    });
    mocks.readHostedMailboxItemByDedupeKey.mockImplementation(async () => null);
  });

  it("reclaims a stale active-member duplicate receipt before admission-off wake recovery", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "off";
    const eventId = "evt_stale_active_duplicate_admission_off";
    const memberId = "member_stale_active_duplicate_admission_off";
    const firstContactReceipt = createHostedLinqFirstContactEventReceiptFixture();
    const staleReceipt = await firstContactReceipt.create({
      data: {
        eventId,
        processingOwnerToken: "owner_stale_active_duplicate_admission_off",
        status: "processing",
      },
    }) as HostedLinqReceiptRecord;
    staleReceipt.updatedAt = new Date("2026-03-26T11:54:00.000Z");
    mocks.readHostedMailboxItemByDedupeKey.mockResolvedValueOnce({
      id: `mailbox_${eventId}`,
    });

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
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqFirstContactEventReceipt: firstContactReceipt,
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
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
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: memberId,
      mailboxItemId: `mailbox_${eventId}`,
    });
    expect(firstContactReceipt.updateMany).toHaveBeenCalledWith({
      data: {
        processingOwnerToken: expect.any(String),
        status: "processing",
      },
      where: {
        eventId,
        status: "processing",
        updatedAt: {
          lt: expect.any(Date),
        },
      },
    });
    expect(await firstContactReceipt.findUnique({
      where: {
        eventId,
      },
    })).toMatchObject({
      eventId,
      status: "consumed",
    });
    mocks.readHostedMailboxItemByDedupeKey.mockImplementation(async () => null);
  });

  it("does not fail open when an earlier delivery has recorded a classifier block", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    mocks.classifyHostedLinqFirstContactAdmission.mockResolvedValueOnce({
      category: "wrong_number_or_personal_logistics",
      confidence: 0.94,
      kind: "block",
      source: "model",
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
        create: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqFirstContactAdmissionDecision: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
          .mockResolvedValue({
            category: "wrong_number_or_personal_logistics",
            confidence: 0.94,
            decision: "block",
            eventId: "evt_classifier_unavailable_after_block",
            source: "model",
          }),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);
    const rawBody = buildHostedLinqWebhookBody({
      eventId: "evt_classifier_unavailable_after_block",
    });

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
    mocks.classifyHostedLinqFirstContactAdmission.mockRejectedValueOnce(hostedOnboardingError({
      code: "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE",
      details: {
        operationName: "hosted_linq_first_contact_admission",
        type: "transport",
      },
      httpStatus: 503,
      message: "Linq first-contact admission classifier is unavailable.",
      retryable: true,
    }));

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

    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.findFirst).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("does not ACK duplicate first-contact events while signup delivery is still processing", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
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
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqFirstContactAdmissionDecision: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedLinqFirstContactEventReceipt: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          eventId: "evt_signup_delivery_processing",
          status: "processing",
        }),
        upsert: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_signup_delivery_processing",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toMatchObject({
      code: "LINQ_FIRST_CONTACT_EVENT_PROCESSING",
      httpStatus: 503,
      retryable: true,
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).not.toHaveBeenCalled();
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });
});
