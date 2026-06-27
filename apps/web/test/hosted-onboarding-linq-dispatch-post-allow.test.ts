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

describe("handleHostedOnboardingLinqWebhook (post-allow)", () => {
  beforeEach(() => {
    resetHostedOnboardingLinqDispatchMocks();
  });

  it("reclaims stale first-contact processing before active-member replay side effects", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    mocks.classifyHostedLinqFirstContactAdmission.mockResolvedValueOnce({
      category: "wrong_number_or_personal_logistics",
      confidence: 0.96,
      kind: "block",
      source: "model",
    });
    const eventId = "evt_stale_first_contact_active_replay";
    const firstContactReceipt = createHostedLinqFirstContactEventReceiptFixture();
    const staleReceipt = await firstContactReceipt.create({
      data: {
        eventId,
        processingOwnerToken: "owner_stale_active_replay",
        status: "processing",
      },
    }) as HostedLinqReceiptRecord;
    staleReceipt.updatedAt = new Date("2026-03-26T11:54:00.000Z");

    const activeMember = {
      billingStatus: HostedBillingStatus.active,
      id: "member_stale_active_replay",
      phoneLookupKey: "+15551234567",
      suspendedAt: null,
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
        findFirst: vi.fn(),
        findUnique: vi.fn(),
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
        findUnique: vi.fn().mockResolvedValue(activeMember),
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
      ignored: true,
      ok: true,
      reason: "blocked-first-contact-admission",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          decision: "block",
          eventId,
        }),
      }),
    );
    expect(prismaMocks.hostedLinqFirstContactEventReceipt.updateMany).toHaveBeenCalledWith({
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
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffort).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it.each([
    {
      admissionDecisionCreates: 1,
      classifierResult: {
        category: "join_intent",
        confidence: 0.94,
        kind: "allow",
        source: "model",
      },
      expectedDecision: "allow",
      name: "classified allow",
    },
    {
      admissionDecisionCreates: 0,
      classifierError: hostedOnboardingError({
        cause: new Error("fetch failed"),
        code: "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE",
        details: {
          operationName: "hosted_linq_first_contact_admission",
          type: "transport",
        },
        httpStatus: 503,
        message: "Linq first-contact admission classifier is unavailable.",
        retryable: true,
      }),
      expectedDecision: null,
      name: "fail-open",
    },
  ] as const)("consumes stale first-contact processing after active-member $name resolution", async (scenario) => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    if ("classifierError" in scenario) {
      mocks.classifyHostedLinqFirstContactAdmission.mockRejectedValueOnce(scenario.classifierError);
    } else {
      mocks.classifyHostedLinqFirstContactAdmission.mockResolvedValueOnce(scenario.classifierResult);
    }

    const eventId = `evt_stale_first_contact_active_${scenario.name.replace("-", "_").replace(" ", "_")}`;
    const memberId = `member_stale_active_${scenario.name.replace("-", "_").replace(" ", "_")}`;
    const firstContactReceipt = createHostedLinqFirstContactEventReceiptFixture();
    const staleReceipt = await firstContactReceipt.create({
      data: {
        eventId,
        processingOwnerToken: `owner_stale_${scenario.name}`,
        status: "processing",
      },
    }) as HostedLinqReceiptRecord;
    staleReceipt.updatedAt = new Date("2026-03-26T11:54:00.000Z");

    const activeMember = {
      billingStatus: HostedBillingStatus.active,
      id: memberId,
      phoneLookupKey: "+15551234567",
      suspendedAt: null,
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
        findFirst: vi.fn(),
        findUnique: vi.fn(),
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
        findUnique: vi.fn().mockResolvedValue(activeMember),
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
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "stale-first-contact",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create)
      .toHaveBeenCalledTimes(scenario.admissionDecisionCreates);
    if (scenario.expectedDecision) {
      expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            decision: scenario.expectedDecision,
            eventId,
          }),
        }),
      );
    }
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
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("consumes stale first-contact processing after recorded allow active-member resolution", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    const eventId = "evt_recorded_allow_stale_first_contact_active";
    const memberId = "member_recorded_allow_stale_active";
    const firstContactReceipt = createHostedLinqFirstContactEventReceiptFixture();
    const staleReceipt = await firstContactReceipt.create({
      data: {
        eventId,
        processingOwnerToken: "owner_stale_recorded_allow",
        status: "processing",
      },
    }) as HostedLinqReceiptRecord;
    staleReceipt.updatedAt = new Date("2026-03-26T11:54:00.000Z");

    const activeMember = {
      billingStatus: HostedBillingStatus.active,
      id: memberId,
      phoneLookupKey: "+15551234567",
      suspendedAt: null,
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
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
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
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(activeMember),
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
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "stale-first-contact",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).not.toHaveBeenCalled();
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).not.toHaveBeenCalled();
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

    expect(mocks.classifyHostedLinqFirstContactAdmission).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("does not replay recorded allow side effects when a stale receipt is consumed during reclaim", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    const eventId = "evt_recorded_allow_consumed_during_reclaim";
    const memberId = "member_recorded_allow_consumed_reclaim";
    const firstContactReceipt = createHostedLinqFirstContactEventReceiptFixture();
    const staleReceipt = await firstContactReceipt.create({
      data: {
        eventId,
        processingOwnerToken: "owner_stale_recorded_allow",
        status: "processing",
      },
    }) as HostedLinqReceiptRecord;
    staleReceipt.updatedAt = new Date("2026-03-26T11:54:00.000Z");
    let receiptReads = 0;
    firstContactReceipt.findUnique.mockImplementation(async () => {
      receiptReads += 1;
      if (receiptReads >= 3) {
        return {
          eventId,
          processingOwnerToken: null,
          status: "consumed",
          updatedAt: new Date("2026-03-26T11:55:00.000Z"),
        };
      }
      return staleReceipt;
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
        findUnique: vi.fn().mockResolvedValue({
          category: "join_intent",
          confidence: 0.94,
          decision: "allow",
          eventId,
          source: "model",
        }),
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
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("treats an allowed first-contact signup-link event as handled after later activation", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    mocks.classifyHostedLinqFirstContactAdmission.mockResolvedValueOnce({
      category: "join_intent",
      confidence: 0.92,
      kind: "allow",
      source: "model",
    });
    const invite = {
      channel: "linq",
      id: "invite_allowed_replay",
      inviteCode: "code_allowed_replay",
      memberId: "member_allowed_replay",
      sentAt: null,
      status: "pending",
    };
    let member = null as HostedMemberRecord | null;
    let recordedDecision: Record<string, unknown> | null = null;
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
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          recordedDecision = data;
          return data;
        }),
        findUnique: vi.fn(async () => recordedDecision),
      },
      hostedLinqFirstContactEventReceipt: firstContactReceipt,
      hostedMember: {
        create: vi.fn(async () => {
          member = {
            billingStatus: HostedBillingStatus.not_started,
            id: "member_allowed_replay",
            linqChatId: "chat_123",
            phoneLookupKey: "+15551234567",
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
      eventId: "evt_allowed_first_contact_replay",
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody,
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      inviteCode: "code_allowed_replay",
      ok: true,
      reason: "sent-signup-link",
    });

    expect(await firstContactReceipt.findUnique({
      where: {
        eventId: "evt_allowed_first_contact_replay",
      },
    })).toMatchObject({
      eventId: "evt_allowed_first_contact_replay",
      status: "consumed",
    });
    if (member) {
      member.billingStatus = HostedBillingStatus.active;
    }

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
    expect(prismaMocks.hostedLinqFirstContactEventReceipt.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedMember.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("treats a fail-open first-contact signup-link event as handled after later activation", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    mocks.classifyHostedLinqFirstContactAdmission.mockRejectedValueOnce(hostedOnboardingError({
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
      id: "invite_fail_open_replay",
      inviteCode: "code_fail_open_replay",
      memberId: "member_fail_open_replay",
      sentAt: null,
      status: "pending",
    };
    let member = null as HostedMemberRecord | null;
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
      hostedLinqFirstContactEventReceipt: firstContactReceipt,
      hostedMember: {
        create: vi.fn(async () => {
          member = {
            billingStatus: HostedBillingStatus.not_started,
            id: "member_fail_open_replay",
            linqChatId: "chat_123",
            phoneLookupKey: "+15551234567",
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
      eventId: "evt_fail_open_first_contact_replay",
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody,
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      inviteCode: "code_fail_open_replay",
      ok: true,
      reason: "sent-signup-link",
    });

    expect(await firstContactReceipt.findUnique({
      where: {
        eventId: "evt_fail_open_first_contact_replay",
      },
    })).toMatchObject({
      eventId: "evt_fail_open_first_contact_replay",
      status: "consumed",
    });
    if (member) {
      member.billingStatus = HostedBillingStatus.active;
    }

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
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedLinqFirstContactEventReceipt.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedMember.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("treats a signup-link-already-sent first-contact event as handled after later activation", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    mocks.classifyHostedLinqFirstContactAdmission.mockResolvedValueOnce({
      category: "join_intent",
      confidence: 0.92,
      kind: "allow",
      source: "model",
    });
    mocks.readHostedLinqDailyState
      .mockResolvedValueOnce(null)
      .mockResolvedValue(makeHostedLinqDailyState({
        onboardingLinkSentAt: new Date("2026-03-26T12:00:01.000Z"),
      }));
    const invite: {
      channel: string;
      id: string;
      inviteCode: string;
      memberId: string;
      linqFirstContactEventId: string | null;
      sentAt: Date | null;
      status: string;
    } = {
      channel: "linq",
      id: "invite_already_sent_replay",
      inviteCode: "code_already_sent_replay",
      linqFirstContactEventId: null,
      memberId: "member_already_sent_replay",
      sentAt: null,
      status: "pending",
    };
    let member = null as HostedMemberRecord | null;
    const admissionDecisions = new Map<string, Record<string, unknown>>();
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
        findFirst: vi.fn(async () => invite.sentAt ? invite : null),
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
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          admissionDecisions.set(String(data.eventId), data);
          return data;
        }),
        findUnique: vi.fn(async ({ where }: { where: { eventId: string } }) =>
          admissionDecisions.get(where.eventId) ?? null),
      },
      hostedLinqFirstContactEventReceipt: firstContactReceipts,
      hostedMember: {
        create: vi.fn(async () => {
          member = {
            billingStatus: HostedBillingStatus.not_started,
            id: "member_already_sent_replay",
            linqChatId: "chat_123",
            phoneLookupKey: "+15551234567",
            suspendedAt: null,
          };
          return member;
        }),
        findUnique: vi.fn(async () => member),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);
    const firstRawBody = buildHostedLinqWebhookBody({
      eventId: "evt_already_sent_first_contact_a",
    });
    const secondRawBody = buildHostedLinqWebhookBody({
      eventId: "evt_already_sent_first_contact_b",
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: firstRawBody,
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "sent-signup-link",
    });
    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: secondRawBody,
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "signup-link-already-sent",
    });
    expect(await firstContactReceipts.findUnique({
      where: {
        eventId: "evt_already_sent_first_contact_b",
      },
    })).toMatchObject({
      eventId: "evt_already_sent_first_contact_b",
      status: "consumed",
    });
    if (member) {
      member.billingStatus = HostedBillingStatus.active;
    }

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: secondRawBody,
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      duplicate: true,
      ignored: true,
      ok: true,
      reason: "duplicate-webhook-event",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedLinqFirstContactEventReceipt.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedMember.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("treats a deterministic blocked first-contact event as handled after later activation", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    let member = null as HostedMemberRecord | null;
    const firstContactReceipts = new Map<string, Record<string, unknown>>();
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
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          firstContactReceipts.set(String(data.eventId), data);
          return data;
        }),
        findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          typeof where.eventId === "string" ? firstContactReceipts.get(where.eventId) ?? null : null),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn(async () => member),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);
    const rawBody = buildHostedLinqWebhookBody({
      data: {
        parts: [
          {
            type: "text",
            value: "https://example.test/spam",
          },
        ],
      },
      eventId: "evt_blocked_first_contact_replay",
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody,
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "blocked-first-contact-content",
    });
    expect(firstContactReceipts.has("evt_blocked_first_contact_replay")).toBe(true);
    member = {
      billingStatus: HostedBillingStatus.active,
      id: "member_blocked_replay",
      linqChatId: "chat_123",
      phoneLookupKey: "+15551234567",
      suspendedAt: null,
    };

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

    expect(mocks.classifyHostedLinqFirstContactAdmission).not.toHaveBeenCalled();
    expect(prismaMocks.hostedLinqFirstContactEventReceipt.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("honors a classifier block when member state changes before admission resolution", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    let member = null as HostedMemberRecord | null;
    mocks.classifyHostedLinqFirstContactAdmission.mockImplementationOnce(async () => {
      member = {
        billingStatus: HostedBillingStatus.not_started,
        id: "member_state_changed_during_classification",
        phoneLookupKey: "+15551234567",
        suspendedAt: null,
      };
      return {
        category: "marketing_outreach",
        confidence: 0.96,
        kind: "block",
        source: "model",
      };
    });
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
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedLinqFirstContactEventReceipt: firstContactReceipt,
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn(async () => member),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_block_after_member_state_change",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "blocked-first-contact-admission",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedLinqFirstContactEventReceipt.create).toHaveBeenCalledWith({
      data: {
        eventId: "evt_block_after_member_state_change",
        processingOwnerToken: expect.any(String),
        status: "processing",
      },
    });
    const processingOwnerToken = prismaMocks.hostedLinqFirstContactEventReceipt.create.mock.calls[0]?.[0]?.data
      ?.processingOwnerToken;
    expect(prismaMocks.hostedLinqFirstContactEventReceipt.updateMany).toHaveBeenCalledWith({
      data: {
        processingOwnerToken: null,
        status: "consumed",
      },
      where: {
        eventId: "evt_block_after_member_state_change",
        processingOwnerToken,
        status: "processing",
        updatedAt: {
          gte: expect.any(Date),
        },
      },
    });
    expect(await firstContactReceipt.findUnique({
      where: {
        eventId: "evt_block_after_member_state_change",
      },
    })).toMatchObject({
      eventId: "evt_block_after_member_state_change",
      status: "consumed",
    });
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("routes a fresh first-contact message when the member activates during admission classification", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    let member: HostedMemberRecord = {
      billingStatus: HostedBillingStatus.not_started,
      id: "member_activates_during_classification",
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
        confidence: 0.94,
        kind: "allow",
        source: "model",
      };
    });
    const eventId = "evt_allow_after_member_activation";
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
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
        findUnique: vi.fn().mockResolvedValue(null),
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

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId,
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          decision: "allow",
          eventId,
        }),
      }),
    );
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalledTimes(1);
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
    expectHostedLinqPointerSignalAccepted(eventId, "member_activates_during_classification");
    expectHostedLinqReadReceiptSent();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
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
