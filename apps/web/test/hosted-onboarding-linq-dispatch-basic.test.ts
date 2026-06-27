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

describe("handleHostedOnboardingLinqWebhook (basic)", () => {
  beforeEach(() => {
    resetHostedOnboardingLinqDispatchMocks();
  });

  it("builds the inactive signup invite with the concise Murph positioning line", () => {
    expect(buildHostedInviteReply({
      joinUrl: "https://join.example.test/join/code_first_text",
    })).toBe(`Welcome to Murph, your personal health assistant.

Verify your phone to finish signup here:
https://join.example.test/join/code_first_text`);
  });

  it("accepts Linq typing events without signaling runtime work", async () => {
    const response = await handleHostedOnboardingLinqWebhook({
      rawBody: buildTypingWebhookBody(),
      signature: null,
      timestamp: null,
    });

    expect(response).toEqual({
      ignored: true,
      ok: true,
      reason: "typing-ignored",
    });
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.appendHostedMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it.each(["sms", "RCS"] as const)(
    "reuses an existing transaction when dispatching active-member Linq %s messages",
    async (service) => {
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
        hostedMember: {
          findUnique: vi.fn().mockResolvedValue({
            billingStatus: HostedBillingStatus.active,
            id: "member_123",
            invites: [],
            linqChatId: "chat_123",
            phoneLookupKey: "+15551234567",
          }),
        },
      });

      const response = await handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildHostedLinqWebhookBody({
          data: {
            extra_field: "discard-me",
            extra_message_field: "discard-me-too",
          },
          service,
        }),
        signature: null,
        timestamp: null,
      });

      expect(response).toMatchObject({
        ok: true,
        reason: "wake-appended-active-member",
      });
      expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
        expect.objectContaining({
          envelope: expect.objectContaining({
            eventId: "evt_123",
            kind: "conversation.message",
            message: expect.objectContaining({
              channel: "linq",
              linqMessage: expect.objectContaining({
                messageId: "msg_123",
                reactionEligible: false,
                service,
              }),
            }),
            userId: "member_123",
          }),
        }),
      );
      expect(mocks.nudgeHostedRunnerUserBestEffort).not.toHaveBeenCalled();
      expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
      expectHostedLinqPointerSignalAccepted();
      expect(response).not.toHaveProperty("wakeUserId");
      expect(readHostedWebhookReceiptUpdateManyMock(prisma)).not.toHaveBeenCalled();
      expect(readHostedWebhookSideEffectUpsertCalls(prisma)).toEqual([]);
      expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
      expectHostedLinqReadReceiptSent();
      expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledWith({
        memberId: "member_123",
        occurredAt: "2026-03-26T12:00:00.000Z",
        prisma,
      });
      expect(mocks.checkHostedAiUsageGate).toHaveBeenCalledWith({
        memberId: "member_123",
        prisma,
      });
      expect(mocks.startHostedOnboardingTiming).toHaveBeenCalledWith(
        "hosted-onboarding.webhook.linq.plan",
        expect.objectContaining({
          eventIdSuffix: "vt_123",
          eventType: "message.received",
        }),
      );
      expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
        expect.objectContaining({
          step: "hosted-onboarding.webhook.linq.plan",
        }),
        "wake-appended-active-member",
        expect.objectContaining({
          desiredSideEffectCount: 0,
          duplicate: false,
          ok: true,
          wakeUserPresent: true,
        }),
      );
      expect(mocks.startHostedOnboardingTiming).toHaveBeenCalledWith(
        "hosted-onboarding.webhook.linq.verify-request",
        expect.objectContaining({
          signaturePresent: false,
          timestampPresent: false,
        }),
      );
      expect(mocks.startHostedOnboardingTiming).not.toHaveBeenCalledWith(
        "hosted-onboarding.webhook.linq.receipt",
        expect.anything(),
      );
      expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
        expect.objectContaining({
          step: "hosted-onboarding.webhook.linq",
        }),
        "completed",
        expect.objectContaining({
          duplicate: false,
          eventIdSuffix: "vt_123",
          eventType: "message.received",
          responseReason: "wake-appended-active-member",
          signalAbortedBeforeReturn: false,
        }),
      );
      expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
        expect.objectContaining({
          step: "hosted-onboarding.webhook.linq.wake-handoff",
        }),
        "temporal-signaled",
        expect.objectContaining({
          workflowIdSuffix: expect.any(String),
        }),
      );
      expect(mocks.startHostedOnboardingTiming).toHaveBeenCalledWith(
        "hosted-onboarding.webhook.linq.wake-handoff",
        expect.objectContaining({
          eventIdSuffix: "vt_123",
          responseReason: "wake-appended-active-member",
          userIdPresent: true,
          userIdSuffix: "er_123",
        }),
      );
    },
  );

  it("marks Linq reaction eligibility from raw parts before mailbox text compaction", async () => {
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
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          linqChatId: "chat_123",
          phoneLookupKey: "+15551234567",
        }),
      },
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          parts: [
            {
              type: "text",
              value: "hello",
            },
            {
              type: "link",
              value: "https://example.test/check-in",
            },
          ],
        },
        eventId: "evt_text_link_reaction_eligible",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          eventId: "evt_text_link_reaction_eligible",
          message: expect.objectContaining({
            linqMessage: expect.objectContaining({
              parts: [
                {
                  type: "text",
                  value: "hello\nhttps://example.test/check-in",
                },
              ],
              reactionEligible: false,
              service: "iMessage",
            }),
          }),
        }),
      }),
    );
  });

  it("ignores non-allowlisted local Linq inbound messages before member lookup or wake handoff", async () => {
    mocks.hostedOnboardingEnvironment.linqLocalAllowedInboundPhoneNumbers = ["+15559999999"];
    const prisma = asPrismaTransactionClient({
      hostedMember: {
        findUnique: vi.fn(),
      },
      hostedMemberIdentity: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      hostedMemberRouting: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
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
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_local_guard_blocked",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "local-inbound-not-allowlisted",
    });
    expect(prisma.hostedMemberIdentity.findFirst).not.toHaveBeenCalled();
    expect(prisma.hostedMemberIdentity.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.findFirst).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.findUnique).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("ignores empty Linq message events before member lookup or wake handoff", async () => {
    const prisma = asPrismaTransactionClient({
      hostedMember: {
        findUnique: vi.fn(),
      },
      hostedMemberIdentity: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      hostedMemberRouting: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
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
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          parts: [],
        },
        eventId: "evt_empty_linq_message",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "empty-message-parts",
    });
    expect(prisma.hostedMember.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedMemberIdentity.findFirst).not.toHaveBeenCalled();
    expect(prisma.hostedMemberIdentity.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.findFirst).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqOutboundDailyState).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("ignores Linq group chats before active-member or signup side effects", async () => {
    const prisma = asPrismaTransactionClient({
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn(),
      },
      hostedMemberIdentity: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
      },
      hostedMemberRouting: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
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
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          chat: {
            id: "chat_group_123",
            is_group: true,
            owner_handle: {
              handle: "+15550000000",
              id: "handle_owner_123",
              is_me: true,
              service: "iMessage",
            },
          },
        },
        eventId: "evt_group_chat",
        service: "iMessage",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "group-chat",
    });
    expect(prisma.hostedMemberIdentity.findFirst).not.toHaveBeenCalled();
    expect(prisma.hostedMemberIdentity.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.findFirst).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.upsert).not.toHaveBeenCalled();
    expect(prisma.hostedMember.create).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).not.toHaveBeenCalled();
    expect(mocks.claimHostedLinqOnboardingLinkNotice).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("preserves all active-member Linq text parts when the inbound part count exceeds the old cap", async () => {
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
        }),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          parts: Array.from({ length: 33 }, (_, index) => ({
            type: "text",
            value: `part ${index}`,
          })),
        },
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-active-member",
    });

    const envelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]?.envelope;
    const serializedEnvelope = JSON.stringify(envelope);
    expect(envelope).toEqual(expect.objectContaining({
      message: expect.objectContaining({
        linqMessage: expect.objectContaining({
          parts: expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              value: expect.stringContaining("part 32"),
            }),
          ]),
        }),
      }),
    }));
    expect(serializedEnvelope).toContain("part 0");
    expect(serializedEnvelope).not.toContain("LINQ_MESSAGE_PARTS_TOO_MANY");
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalled();
    expectHostedLinqReadReceiptSent();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expectHostedLinqPointerSignalAccepted();
  });

  it("prioritizes active-member Linq text when attachment descriptors arrive first", async () => {
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
        }),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          parts: [
            ...Array.from({ length: 33 }, (_, index) => ({
              attachment_id: `att_${index}`,
              filename: `file-${index}.jpg`,
              mime_type: "image/jpeg",
              size: 1234,
              type: "media" as const,
              url: `https://cdn.linq.example.test/file-${index}.jpg`,
            })),
            {
              type: "text",
              value: "late user question after attachments",
            },
          ],
        },
        eventId: "evt_attachments_before_text",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ignored: false,
      ok: true,
      reason: "wake-appended-active-member",
    });

    const envelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]?.envelope;
    const serializedEnvelope = JSON.stringify(envelope);
    expect(envelope).toEqual(expect.objectContaining({
      message: expect.objectContaining({
        linqMessage: expect.objectContaining({
          parts: expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              value: expect.stringContaining("late user question after attachments"),
            }),
            expect.objectContaining({
              type: "text",
              value: expect.stringContaining("1 attachment descriptor(s) omitted"),
            }),
          ]),
        }),
      }),
    }));
    expect(serializedEnvelope).not.toContain("file-32.jpg");
    expect(serializedEnvelope).not.toContain("cdn.linq.example.test");
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalled();
    expectHostedLinqReadReceiptSent();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expectHostedLinqPointerSignalAccepted("evt_attachments_before_text");
  });

  it("compacts active-member Linq messages with oversized content and still appends a wake", async () => {
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
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          linqChatId: "chat_123",
          phoneLookupKey: "+15551234567",
        }),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          parts: [
            {
              type: "text",
              value: "x".repeat((128 * 1024) + 1),
            },
          ],
        },
        eventId: "evt_oversized_parts",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    const envelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]?.envelope;
    expect(JSON.stringify(envelope).length).toBeLessThan(128 * 1024);
    expect(envelope).toEqual(expect.objectContaining({
      message: expect.objectContaining({
        linqMessage: expect.objectContaining({
          parts: expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              value: expect.stringContaining("[truncated]"),
            }),
            expect.objectContaining({
              type: "text",
              value: expect.stringContaining("some content truncated"),
            }),
          ]),
        }),
      }),
    }));
    expect(mocks.appendHostedMailboxEnvelopeTx).toHaveBeenCalled();
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalled();
    expectHostedLinqReadReceiptSent();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expectHostedLinqPointerSignalAccepted("evt_oversized_parts");
  });

  it("preserves active-member Linq link content when truncation is required", async () => {
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
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          linqChatId: "chat_123",
          phoneLookupKey: "+15551234567",
        }),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          parts: [
            {
              type: "link",
              value: "https://example.test/linked-context",
            },
            {
              type: "text",
              value: "x".repeat((128 * 1024) + 1),
            },
            {
              attachment_id: "att_link_compaction",
              filename: "proof.jpg",
              mime_type: "image/jpeg",
              size: 1234,
              type: "media",
              url: "https://cdn.example.test/proof.jpg",
            },
          ],
        },
        eventId: "evt_link_compaction",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    const envelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]?.envelope;
    const serializedEnvelope = JSON.stringify(envelope);
    expect(envelope).toEqual(expect.objectContaining({
      message: expect.objectContaining({
        linqMessage: expect.objectContaining({
          parts: expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              value: expect.stringContaining("https://example.test/linked-context"),
            }),
          ]),
        }),
      }),
    }));
    expect(serializedEnvelope).toContain("some content truncated");
    expect(serializedEnvelope).not.toContain("cdn.example.test");
    expectHostedLinqReadReceiptSent();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expectHostedLinqPointerSignalAccepted("evt_link_compaction");
  });

  it("omits signed Linq attachment URLs from active-member mailbox wakes", async () => {
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
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          linqChatId: "chat_123",
          phoneLookupKey: "+15551234567",
        }),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          parts: [
            {
              attachment_id: "att_voice_123",
              filename: "voice-note.m4a",
              mime_type: "audio/mp4",
              size: 12345,
              type: "voice_memo",
              url: "https://cdn.linqapp.com/files/signed-voice-url.m4a",
            },
          ],
        },
        eventId: "evt_attachment_url_omitted",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    const envelope = mocks.appendHostedMailboxEnvelopeTx.mock.calls[0]?.[0]?.envelope;
    expect(envelope).toEqual(expect.objectContaining({
      message: expect.objectContaining({
        linqMessage: expect.objectContaining({
          parts: [
            expect.objectContaining({
              attachmentId: "att_voice_123",
              fileName: "voice-note.m4a",
              mimeType: "audio/mp4",
              size: 12345,
              type: "voice_memo",
            }),
          ],
        }),
      }),
    }));
    expect(JSON.stringify(envelope)).not.toContain("signed-voice-url");
  });

  it("signals Temporal after an active-member mailbox append", async () => {
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
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          linqChatId: "chat_123",
          phoneLookupKey: "+15551234567",
        }),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_required_nudge_failed",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.nudgeHostedRunnerUserBestEffort).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expectHostedLinqPointerSignalAccepted("evt_required_nudge_failed");
    expectHostedLinqReadReceiptSent();
    expect(mocks.startHostedLinqTypingIndicator).not.toHaveBeenCalled();
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "hosted-onboarding.webhook.linq.wake-handoff",
      }),
      "temporal-signaled",
      expect.objectContaining({
        workflowIdSuffix: expect.any(String),
      }),
    );
  });

  it("keeps active-member Linq webhook success independent of read receipt failures", async () => {
    mocks.sendHostedLinqReadReceipt.mockRejectedValueOnce(new Error("read receipt unavailable"));
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
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          linqChatId: "chat_123",
          phoneLookupKey: "+15551234567",
        }),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_read_receipt_failure",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expectHostedLinqReadReceiptSent();
    expectHostedLinqPointerSignalAccepted("evt_read_receipt_failure");
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "hosted-onboarding.webhook.linq.ingress-read-receipt",
      }),
      "failed",
      expect.objectContaining({
        errorName: "Error",
        responseReason: "wake-appended-active-member",
        wakeHandoffStarted: true,
        wakeHandoffSignalAccepted: true,
      }),
    );
  });

  it("can schedule active-member Linq read receipts after the webhook response", async () => {
    const scheduledTasks: Array<() => Promise<void>> = [];
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
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          linqChatId: "chat_123",
          phoneLookupKey: "+15551234567",
        }),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_scheduled_read_receipt",
      }),
      scheduleAfterResponse: (task) => {
        scheduledTasks.push(task);
      },
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });

    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
    expect(scheduledTasks).toHaveLength(2);

    await scheduledTasks[1]?.();

    expectHostedLinqReadReceiptSent();
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "hosted-onboarding.webhook.linq.ingress-read-receipt",
      }),
      "sent",
      expect.objectContaining({
        httpStatus: 204,
        responseReason: "wake-appended-active-member",
        wakeHandoffStarted: true,
        wakeHandoffSignalAccepted: true,
      }),
    );
  });

  it("revalidates routed Linq read receipts before provider delivery", async () => {
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
    const prisma = asPrismaTransactionClient({
      hostedThreadRoute: {
        findMany: vi.fn()
          .mockResolvedValueOnce([
            {
              channel: "linq",
              container: {
                member: {
                  billingStatus: HostedBillingStatus.active,
                  createdAt: new Date("2026-03-26T00:00:00.000Z"),
                  id: "member_thread_container_123",
                  suspendedAt: null,
                  updatedAt: new Date("2026-03-26T00:00:00.000Z"),
                },
                owner: {
                  billingStatus: HostedBillingStatus.active,
                  createdAt: new Date("2026-03-26T00:00:00.000Z"),
                  id: "member_owner_123",
                  suspendedAt: null,
                  updatedAt: new Date("2026-03-26T00:00:00.000Z"),
                },
              },
              containerMemberId: "member_thread_container_123",
              threadLookupKey: routeLookupKey,
            },
          ])
          .mockResolvedValueOnce([]),
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
        eventId: "evt_routed_read_receipt_stale",
      }),
      signature: null,
      timestamp: null,
    })).resolves.toMatchObject({
      ok: true,
      reason: "wake-appended-thread-route",
    });

    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_thread_container_123",
      mailboxItemId: "mailbox_evt_routed_read_receipt_stale",
    });
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
    expect(prisma.hostedThreadRoute?.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.hostedThreadRoute?.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          threadLookupKey: {
            in: expect.arrayContaining([routeLookupKey]),
          },
        }),
      }),
    );
    expect(prisma.hostedThreadRoute?.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          threadLookupKey: {
            in: expect.arrayContaining([routeLookupKey]),
          },
        }),
      }),
    );
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "hosted-onboarding.webhook.linq.ingress-read-receipt",
      }),
      "failed",
      expect.objectContaining({
        errorName: "Error",
        responseReason: "wake-appended-thread-route",
        wakeHandoffStarted: true,
        wakeHandoffSignalAccepted: true,
      }),
    );
  });

  it("fails the Linq webhook before read receipt when Temporal signaling fails", async () => {
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(new Error("Temporal unavailable"));
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
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          linqChatId: "chat_123",
          phoneLookupKey: "+15551234567",
        }),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_direct_nudge_read_receipt",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toThrow("Temporal unavailable");

    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_evt_direct_nudge_read_receipt",
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "hosted-onboarding.webhook.linq.wake-handoff",
      }),
      "failed",
      expect.objectContaining({
        errorName: "Error",
      }),
    );
  });

  it("fails webhook success when Temporal signaling fails after mailbox append", async () => {
    mocks.nudgeHostedRunnerUserBestEffortResult.mockResolvedValueOnce({
      accepted: false,
      alarmScheduled: false,
      configured: false,
      errorCode: null,
      immediateDriveStarted: false,
      inFlight: false,
      nextAlarmAtPresent: false,
    });
    mocks.signalHostedMailboxAppendRuntime.mockRejectedValueOnce(new Error("Temporal unavailable"));
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
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          linqChatId: "chat_123",
          phoneLookupKey: "+15551234567",
        }),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_ingress_read_receipt_skipped",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toThrow("Temporal unavailable");

    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: "member_123",
      mailboxItemId: "mailbox_evt_ingress_read_receipt_skipped",
    });
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expect(mocks.startHostedLinqTypingIndicator).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "hosted-onboarding.webhook.linq.wake-handoff",
      }),
      "failed",
      expect.objectContaining({
        errorName: "Error",
      }),
    );
  });

  it("opens a Prisma transaction when dispatching an active-member Linq message from a root client", async () => {
    const transactionReceiptUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transactionHostedMemberFindUnique = vi.fn().mockResolvedValue({
      billingStatus: HostedBillingStatus.active,
      id: "member_123",
      invites: [],
      linqChatId: "chat_123",
      phoneLookupKey: "+15551234567",
    });
    const transactionClient = {
      hostedWebhookReceipt: {
        updateMany: transactionReceiptUpdateMany,
      },
      hostedMember: {
        findUnique: transactionHostedMemberFindUnique,
      },
    };
    const prisma = withPrismaTransaction({
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
        }),
      },
    }, transactionClient);

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody(),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ok: true,
      reason: "wake-appended-active-member",
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(transactionHostedMemberFindUnique).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        tx: transactionClient,
        envelope: expect.objectContaining({
          eventId: "evt_123",
          kind: "conversation.message",
          occurredAt: "2026-03-26T12:00:00.000Z",
          message: expect.objectContaining({
            channel: "linq",
            linqMessage: expect.objectContaining({
              messageId: "msg_123",
            }),
          }),
          userId: "member_123",
        }),
      }),
    );
    expect(transactionReceiptUpdateMany).not.toHaveBeenCalled();
    expect(readHostedWebhookSideEffectUpsertCalls(transactionClient)).toEqual([]);
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expectHostedLinqReadReceiptSent();
    expect(mocks.nudgeHostedRunnerUserBestEffortResult).not.toHaveBeenCalled();
    expectHostedLinqPointerSignalAccepted();
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma: transactionClient,
    });
  });

  it("rejects malformed message.received events before journaling or side effects", async () => {
    const hostedWebhookReceiptCreate = vi.fn().mockResolvedValue({});
    const hostedWebhookReceiptUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const hostedMemberFindUnique = vi.fn().mockResolvedValue(null);
    const prisma = asPrismaTransactionClient({
      hostedWebhookReceipt: {
        create: hostedWebhookReceiptCreate,
        updateMany: hostedWebhookReceiptUpdateMany,
      },
      hostedMember: {
        findUnique: hostedMemberFindUnique,
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          id: null,
          sent_at: "2026-03-26T12:00:05.000Z",
        },
        eventId: "evt_missing_message_id",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toThrow("Linq message.received message.id");

    expect(hostedWebhookReceiptCreate).not.toHaveBeenCalled();
    expect(hostedWebhookReceiptUpdateMany).not.toHaveBeenCalled();
    expect(hostedMemberFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("rejects invalid message.received timestamps before journaling or side effects", async () => {
    const hostedWebhookReceiptCreate = vi.fn().mockResolvedValue({});
    const hostedWebhookReceiptUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const hostedMemberFindUnique = vi.fn().mockResolvedValue(null);
    const prisma = asPrismaTransactionClient({
      hostedWebhookReceipt: {
        create: hostedWebhookReceiptCreate,
        updateMany: hostedWebhookReceiptUpdateMany,
      },
      hostedMember: {
        findUnique: hostedMemberFindUnique,
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          sent_at: "not-a-timestamp",
        },
        eventId: "evt_invalid_sent_at",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toThrow("sent_at must be a valid timestamp");

    expect(hostedWebhookReceiptCreate).not.toHaveBeenCalled();
    expect(hostedWebhookReceiptUpdateMany).not.toHaveBeenCalled();
    expect(hostedMemberFindUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("prefers sent_at when building active-member dispatch metadata", async () => {
    const transactionReceiptUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transactionClient = {
      hostedWebhookReceipt: {
        updateMany: transactionReceiptUpdateMany,
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          linqChatId: "chat_123",
          phoneLookupKey: "+15551234567",
        }),
      },
    };
    const prisma = withPrismaTransaction({
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
        }),
      },
    }, transactionClient);

    await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          sent_at: "2026-03-26T12:00:05.000Z",
        },
        eventId: "evt_456",
      }),
      signature: null,
      timestamp: null,
    });

    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          eventId: "evt_456",
          kind: "conversation.message",
          occurredAt: "2026-03-26T12:00:05.000Z",
        }),
      }),
    );
    expect(readHostedWebhookSideEffectUpsertCalls(transactionClient)).toEqual([]);
    expect(mocks.incrementHostedLinqInboundDailyState).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:05.000Z",
      prisma: transactionClient,
    });
  });

  it("ignores suspended Linq members before dispatching or inviting", async () => {
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
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          phoneLookupKey: "+15551234567",
          suspendedAt: new Date("2026-03-26T12:00:00.000Z"),
        }),
      },
    });

    const response = await handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_suspended",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "suspended-member",
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
  });

  it("does not send a Linq read receipt when active-member mailbox persistence fails", async () => {
    mocks.enqueueHostedExecutionOutbox.mockRejectedValueOnce(new Error("mailbox append failed"));
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
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          invites: [],
          linqChatId: "chat_123",
          phoneLookupKey: "+15551234567",
        }),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        eventId: "evt_mailbox_append_failure",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toThrow("mailbox append failed");

    expect(mocks.sendHostedLinqReadReceipt).not.toHaveBeenCalled();
    expect(mocks.nudgeHostedRunnerUserBestEffort).not.toHaveBeenCalled();
  });

  it("tracks echoed outbound Linq messages without dispatching hosted execution", async () => {
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
        data: {
          direction: "outbound",
          recipient_phone: "+15559876543",
          sender_handle: {
            handle: "+15551234567",
            id: "handle_sender_123",
            service: "sms",
          },
        },
        eventId: "evt_outbound_echo",
      }),
      signature: null,
      timestamp: null,
    });

    expect(response).toMatchObject({
      ignored: true,
      ok: true,
      reason: "own-message",
    });
    expect(mocks.incrementHostedLinqOutboundDailyState).toHaveBeenCalledWith({
      memberId: "member_123",
      occurredAt: "2026-03-26T12:00:00.000Z",
      prisma,
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("rejects malformed Linq message payloads with the hosted payload error surface", async () => {
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
      hostedMember: {
        findUnique: vi.fn(),
      },
    });

    await expect(handleHostedOnboardingLinqWebhook({
      prisma,
      rawBody: buildHostedLinqWebhookBody({
        data: {
          parts: "not-an-array",
        },
        eventId: "evt_invalid_payload",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toMatchObject({
      code: "LINQ_PAYLOAD_INVALID",
      httpStatus: 400,
    });
  });
});
