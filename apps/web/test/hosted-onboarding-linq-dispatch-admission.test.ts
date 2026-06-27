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

describe("handleHostedOnboardingLinqWebhook (admission)", () => {
  beforeEach(() => {
    resetHostedOnboardingLinqDispatchMocks();
  });

  it("blocks classifier-denied unknown Linq first contacts before member or invite side effects", async () => {
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
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMember: {
        create: vi.fn(),
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
              value:
                "Hey Gail! I was on a hike, just got home. I will leave the plates and box next to the garage door.",
            },
          ],
        },
        eventId: "evt_wrong_person_first_contact",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "blocked-first-contact-admission",
    });
    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledWith({
      request: expect.objectContaining({
        eventId: "evt_wrong_person_first_contact",
        participantContactKind: "phone",
        partTypes: ["text"],
        service: "imessage",
        text: expect.stringContaining("Hey Gail!"),
      }),
      signal: undefined,
    });
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedMember.findUnique).toHaveBeenCalledTimes(2);
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.findFirst).not.toHaveBeenCalled();
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).toHaveBeenCalledWith({
      data: {
        category: "wrong_number_or_personal_logistics",
        confidence: 0.94,
        decision: "block",
        eventId: "evt_wrong_person_first_contact",
        source: "model",
      },
    });
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("reuses stored classifier blocks for duplicate unknown Linq first contacts", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";

    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventType: "message.received",
            receiptAttemptCount: 2,
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
          category: "wrong_number_or_personal_logistics",
          confidence: 0.94,
          decision: "block",
          eventId: "evt_recorded_wrong_person_first_contact",
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

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          parts: [
            {
              type: "text",
              value: "Hey Gail, I left the plates outside.",
            },
          ],
        },
        eventId: "evt_recorded_wrong_person_first_contact",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "blocked-first-contact-admission",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).not.toHaveBeenCalled();
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.findFirst).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("reuses stored classifier blocks even after the sender has active member state", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";

    const prismaMocks = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: {
            eventType: "message.received",
            receiptAttemptCount: 2,
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
          category: "wrong_number_or_personal_logistics",
          confidence: 0.94,
          decision: "block",
          eventId: "evt_recorded_block_after_member_state",
          source: "model",
        }),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          id: "member_after_block",
          invites: [],
          linqChatId: "chat_123",
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_recorded_block_after_member_state",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "blocked-first-contact-admission",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).not.toHaveBeenCalled();
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedMember.findUnique).not.toHaveBeenCalled();
    expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("bounds first-contact classifier service metadata before OpenAI egress", async () => {
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
      hostedLinqFirstContactAdmissionDecision: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
        findUnique: vi.fn().mockResolvedValue(null),
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
        eventId: "evt_first_contact_untrusted_service",
        service: `malformed-${"x".repeat(4_096)}`,
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason: "blocked-first-contact-admission",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledWith({
      request: expect.objectContaining({
        eventId: "evt_first_contact_untrusted_service",
        service: "unknown",
      }),
      signal: undefined,
    });
  });

  it("admits unknown Linq first contacts when the classifier is unavailable", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
    const rawProviderBodyMarker = "RAW_PROVIDER_SENTINEL_SHOULD_NOT_LOG";
    const invalidJsonCause = await new Response(`{"k": bad ${rawProviderBodyMarker} user@example.com}`, {
      headers: {
        "content-type": "application/json",
      },
    }).json().catch((error: unknown) => error);
    if (!(invalidJsonCause instanceof SyntaxError)) {
      throw new Error("Expected invalid JSON response to throw a SyntaxError.");
    }
    mocks.classifyHostedLinqFirstContactAdmission.mockRejectedValueOnce(hostedOnboardingError({
      cause: invalidJsonCause,
      code: "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE",
      details: {
        operationName: "hosted_linq_first_contact_admission",
        type: "invalid_json",
      },
      httpStatus: 503,
      message: "Linq first-contact admission classifier is unavailable.",
      retryable: true,
    }));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const invite = {
      channel: "linq",
      id: "invite_classifier_unavailable",
      inviteCode: "code_classifier_unavailable",
      memberId: "member_classifier_unavailable",
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
          id: invite.id,
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedLinqFirstContactAdmissionDecision: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_classifier_unavailable",
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
        eventId: "evt_classifier_transport_retry",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      inviteCode: "code_classifier_unavailable",
      joinUrl: "https://join.example.test/join/code_classifier_unavailable",
      ok: true,
      reason: "sent-signup-link",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).not.toHaveBeenCalled();
    expect(prismaMocks.hostedMember.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(prismaMocks.hostedInvite.findFirst).toHaveBeenCalledTimes(2);
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledWith({
      memberId: "member_classifier_unavailable",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.claimHostedLinqOnboardingLinkNotice).toHaveBeenCalledWith({
      memberId: "member_classifier_unavailable",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
      sentAt: expect.any(Date),
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: buildHostedInviteReply({
          joinUrl: "https://join.example.test/join/code_classifier_unavailable",
        }),
        replyToMessageId: "msg_123",
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "Hosted Linq first-contact admission classifier unavailable; admitting first contact.",
      expect.objectContaining({
        admissionDisposition: "fail_open",
        errorCode: "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE",
        errorCauseMessage: "Unexpected token 'b', [redacted JSON body excerpt] is not valid JSON",
        errorCauseType: "SyntaxError",
        errorMessage: "Linq first-contact admission classifier is unavailable.",
        eventIdSuffix: "_retry",
        operationName: "hosted_linq_first_contact_admission",
        retryable: true,
        type: "invalid_json",
      }),
    );
    const warnPayload = warnSpy.mock.calls[0]?.[1];
    expect(JSON.stringify(warnPayload)).not.toContain(rawProviderBodyMarker);
    expect(JSON.stringify(warnPayload)).not.toContain("RAW_PROVIDER");
    expect(JSON.stringify(warnPayload)).not.toContain("SENTINEL");
    expect(JSON.stringify(warnPayload)).not.toContain("bad RAW_PR");
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("bypasses first-contact admission for known active Linq members", async () => {
    mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
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
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          linqChatId: "chat_123",
          phoneLookupKey: "+15551234567",
          suspendedAt: null,
        }),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_active_member_no_first_contact_classifier",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.classifyHostedLinqFirstContactAdmission).not.toHaveBeenCalled();
    expectHostedLinqReadReceiptSent();
  });

  it.each(["sms", "RCS"] as const)(
    "classifies existing inactive phone first-contact %s texts before sending signup links",
    async (service) => {
      mocks.hostedOnboardingEnvironment.linqFirstContactAdmissionMode = "enforce";
      mocks.classifyHostedLinqFirstContactAdmission.mockReset();
      mocks.classifyHostedLinqFirstContactAdmission.mockResolvedValue({
        category: "join_intent",
        confidence: 0.94,
        kind: "allow",
        source: "model",
      });
      const invite = {
        channel: "linq",
        id: `invite_${service.toLowerCase()}`,
        inviteCode: `code_${service.toLowerCase()}`,
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
            id: invite.id,
            sentAt: new Date("2026-03-26T12:00:01.000Z"),
          }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        hostedMember: {
          create: vi.fn(),
          findUnique: vi.fn().mockResolvedValue({
            billingStatus: HostedBillingStatus.not_started,
            id: "member_123",
            invites: [],
            phoneLookupKey: "+15551234567",
            suspendedAt: null,
          }),
          update: vi.fn(),
        },
        hostedLinqFirstContactAdmissionDecision: {
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
          findUnique: vi.fn().mockResolvedValue(null),
        },
      };
      const prisma = asPrismaTransactionClient(prismaMocks);

      const response = await handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildHostedLinqWebhookBody({
          eventId: `evt_${service.toLowerCase()}_inactive_first_contact`,
          service,
        }),
        signature: null,
        timestamp: null,
      });

      expect(response).toMatchObject({
        inviteCode: invite.inviteCode,
        joinUrl: `https://join.example.test/join/${invite.inviteCode}`,
        ok: true,
        reason: "sent-signup-link",
      });
      expect(prismaMocks.hostedMember.create).not.toHaveBeenCalled();
      expect(mocks.classifyHostedLinqFirstContactAdmission).toHaveBeenCalledTimes(1);
      expect(prismaMocks.hostedLinqFirstContactAdmissionDecision.create).toHaveBeenCalledTimes(1);
      expect(prismaMocks.hostedInvite.create).toHaveBeenCalledTimes(1);
      expect(prismaMocks.hostedInvite.findFirst).toHaveBeenCalledTimes(2);
      expect(readHostedMemberRoutingUpsertMock(prisma)).toHaveBeenCalled();
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
            joinUrl: `https://join.example.test/join/${invite.inviteCode}`,
          }),
          replyToMessageId: "msg_123",
        }),
      );
      expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
      expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      label: "URL text",
      parts: [
        {
          type: "text",
          value: "Check this out https://spam.example.test",
        },
      ],
    },
    {
      label: "bare domain URL text",
      parts: [
        {
          type: "text",
          value: "Open example.com/join for details",
        },
      ],
    },
    {
      label: "short bare domain URL text",
      parts: [
        {
          type: "text",
          value: "bit.ly/foo",
        },
      ],
    },
    {
      label: "unlisted short bare domain URL text",
      parts: [
        {
          type: "text",
          value: "rb.gy/foo",
        },
      ],
    },
    {
      label: "unlisted bare domain URL text",
      parts: [
        {
          type: "text",
          value: "example.xyz/join",
        },
      ],
    },
    {
      label: "shopping bare domain URL text",
      parts: [
        {
          type: "text",
          value: "site.shop/path",
        },
      ],
    },
    {
      label: "punctuation-wrapped bare domain URL text",
      parts: [
        {
          type: "text",
          value: "(example.com/path).",
        },
      ],
    },
    {
      label: "link part",
      parts: [
        {
          type: "link",
          value: "https://spam.example.test",
        },
      ],
    },
    {
      label: "message/data rates boilerplate",
      parts: [
        {
          type: "text",
          value: "Msg&data rates may apply. Text 'STOP' to quit.",
        },
      ],
    },
    {
      label: "slash-separated message/data rates boilerplate",
      parts: [
        {
          type: "text",
          value: "Msg/data rates apply.",
        },
      ],
    },
    {
      label: "standard message rates boilerplate",
      parts: [
        {
          type: "text",
          value: "Standard message rates apply.",
        },
      ],
    },
    {
      label: "STOP opt-out boilerplate",
      parts: [
        {
          type: "text",
          value: "Reply STOP to unsubscribe",
        },
      ],
    },
    {
      label: "hyphenated STOP opt-out boilerplate",
      parts: [
        {
          type: "text",
          value: "Text STOP to opt-out",
        },
      ],
    },
    {
      label: "STOP end boilerplate",
      parts: [
        {
          type: "text",
          value: "Text STOP to end",
        },
      ],
    },
    {
      label: "standalone STOP opt-out command",
      parts: [
        {
          type: "text",
          value: "STOP",
        },
      ],
    },
    {
      label: "standalone lowercase stop opt-out command",
      parts: [
        {
          type: "text",
          value: "stop",
        },
      ],
    },
    {
      label: "standalone UNSUBSCRIBE opt-out command",
      parts: [
        {
          type: "text",
          value: "UNSUBSCRIBE",
        },
      ],
    },
    {
      label: "standalone CANCEL opt-out command",
      parts: [
        {
          type: "text",
          value: "CANCEL",
        },
      ],
    },
    {
      label: "standalone END opt-out command",
      parts: [
        {
          type: "text",
          value: "END",
        },
      ],
    },
    {
      label: "standalone QUIT opt-out command",
      parts: [
        {
          type: "text",
          value: "QUIT",
        },
      ],
    },
    {
      label: "standalone STOP opt-out command over RCS",
      parts: [
        {
          type: "text",
          value: "STOP",
        },
      ],
      service: "RCS",
    },
  ])("ignores first-contact phone message with $label before invite side effects", async ({ parts, service }) => {
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
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    };
    const prisma = asPrismaTransactionClient(prismaMocks);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          parts,
        },
        eventId: "evt_blocked_first_contact",
        service,
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "blocked-first-contact-content",
    });
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
});
