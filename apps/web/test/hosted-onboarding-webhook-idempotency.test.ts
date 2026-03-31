import {
  HostedBillingMode,
  HostedBillingStatus,
  HostedMemberStatus,
  Prisma,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const stripeConstructEvent = vi.fn();
  const stripeChargesRetrieve = vi.fn();
  const stripePaymentIntentsRetrieve = vi.fn();

  return {
    drainHostedExecutionOutboxBestEffort: vi.fn(),
    enqueueHostedExecutionOutbox: vi.fn(),
    isHostedRevnetBroadcastStatusUnknownError: vi.fn(),
    isHostedOnboardingRevnetEnabled: vi.fn(),
    normalizeHostedWalletAddress: vi.fn((value: string | null | undefined) => value ?? null),
    requireHostedRevnetConfig: vi.fn(),
    sendHostedLinqChatMessage: vi.fn(),
    submitHostedRevnetPayment: vi.fn(),
    stripeChargesRetrieve,
    stripeConstructEvent,
    stripePaymentIntentsRetrieve,
  };
});

vi.mock("@/src/lib/hosted-execution/outbox", () => ({
  drainHostedExecutionOutboxBestEffort: mocks.drainHostedExecutionOutboxBestEffort,
  enqueueHostedExecutionOutbox: mocks.enqueueHostedExecutionOutbox,
}));

vi.mock("../src/lib/hosted-onboarding/linq", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/hosted-onboarding/linq")>(
    "../src/lib/hosted-onboarding/linq",
  );

  return {
    ...actual,
    assertHostedLinqWebhookSignature: vi.fn(),
    verifyAndParseHostedLinqWebhookRequest: vi.fn((input: { rawBody: string }) =>
      actual.parseHostedLinqWebhookEvent(input.rawBody),
    ),
    sendHostedLinqChatMessage: mocks.sendHostedLinqChatMessage,
  };
});

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    encryptionKeyVersion: "v1",
    inviteTtlHours: 24,
    isProduction: false,
    linqApiBaseUrl: "https://linq.example.test",
    linqApiToken: "linq-token",
    linqWebhookSecret: null,
    publicBaseUrl: "https://join.example.test",
    revnetChainId: null,
    revnetProjectId: null,
    revnetRpcUrl: null,
    revnetStripeCurrency: null,
    revnetTerminalAddress: null,
    revnetTreasuryPrivateKey: null,
    revnetWeiPerStripeMinorUnit: null,
    sessionCookieName: "hosted_session",
    sessionTtlDays: 30,
    stripeBillingMode: "payment",
    stripePriceId: "price_123",
    stripeSecretKey: "sk_test_123",
    stripeWebhookSecret: "whsec_123",
    telegramBotUsername: null,
    telegramWebhookSecret: null,
  }),
  getHostedOnboardingSecretCodec: () => ({
    encrypt: (value: string) => `enc:${value}`,
  }),
  requireHostedOnboardingPublicBaseUrl: () => "https://join.example.test",
  requireHostedStripeWebhookVerificationConfig: () => ({
    stripe: {
      charges: {
        retrieve: mocks.stripeChargesRetrieve,
      },
      paymentIntents: {
        retrieve: mocks.stripePaymentIntentsRetrieve,
      },
      webhooks: {
        constructEvent: mocks.stripeConstructEvent,
      },
    },
    webhookSecret: "whsec_123",
  }),
}));

vi.mock("@/src/lib/hosted-onboarding/revnet", () => ({
  coerceHostedWalletAddress: (value: string | null | undefined) => value ?? null,
  convertStripeMinorAmountToRevnetPaymentAmount: (amountMinor: number, weiPerStripeMinorUnit: bigint) =>
    BigInt(amountMinor) * weiPerStripeMinorUnit,
  isHostedRevnetBroadcastStatusUnknownError: mocks.isHostedRevnetBroadcastStatusUnknownError,
  isHostedOnboardingRevnetEnabled: mocks.isHostedOnboardingRevnetEnabled,
  normalizeHostedWalletAddress: mocks.normalizeHostedWalletAddress,
  requireHostedRevnetConfig: mocks.requireHostedRevnetConfig,
  submitHostedRevnetPayment: mocks.submitHostedRevnetPayment,
}));

import {
  handleHostedOnboardingLinqWebhook,
  handleHostedStripeWebhook,
} from "@/src/lib/hosted-onboarding/webhook-service";
import {
  buildHostedGetStartedReply,
  buildHostedInviteReply,
} from "@/src/lib/hosted-onboarding/linq";

describe("hosted onboarding webhook retry safety", () => {
  beforeEach(() => {
    mocks.drainHostedExecutionOutboxBestEffort.mockReset();
    mocks.enqueueHostedExecutionOutbox.mockReset();
    mocks.isHostedRevnetBroadcastStatusUnknownError.mockReset();
    mocks.isHostedOnboardingRevnetEnabled.mockReset();
    mocks.normalizeHostedWalletAddress.mockReset();
    mocks.requireHostedRevnetConfig.mockReset();
    mocks.sendHostedLinqChatMessage.mockReset();
    mocks.submitHostedRevnetPayment.mockReset();
    mocks.stripeChargesRetrieve.mockReset();
    mocks.stripeConstructEvent.mockReset();
    mocks.stripePaymentIntentsRetrieve.mockReset();
    mocks.drainHostedExecutionOutboxBestEffort.mockResolvedValue(undefined);
    mocks.enqueueHostedExecutionOutbox.mockResolvedValue(undefined);
    mocks.isHostedRevnetBroadcastStatusUnknownError.mockImplementation((error: unknown) =>
      String(error instanceof Error ? error.message : error).toLowerCase().includes("already known"),
    );
    mocks.isHostedOnboardingRevnetEnabled.mockReturnValue(false);
    mocks.normalizeHostedWalletAddress.mockImplementation((value: string | null | undefined) => value ?? null);
    mocks.requireHostedRevnetConfig.mockReturnValue({
      chainId: 8453,
      projectId: 1n,
      rpcUrl: "https://rpc.example.test",
      stripeCurrency: "usd",
      terminalAddress: "0x0000000000000000000000000000000000000001",
      treasuryPrivateKey: `0x${"11".repeat(32)}`,
      weiPerStripeMinorUnit: 2_000_000_000_000n,
    });
    mocks.submitHostedRevnetPayment.mockResolvedValue({
      payTxHash: "0xabc123",
      paymentAmount: 1_000_000_000_000_000n,
    });
    mocks.sendHostedLinqChatMessage.mockResolvedValue({
      chatId: "chat_123",
      messageId: "out_msg_123",
    });
    mocks.stripeChargesRetrieve.mockResolvedValue({
      customer: "cus_123",
      payment_intent: "pi_123",
    });
    mocks.stripePaymentIntentsRetrieve.mockResolvedValue({
      customer: "cus_123",
    });
  });

  it.each([
    {
      body: buildLinqMessageWebhookBody({
        eventType: "message.delivered",
      }),
      reason: "message.delivered",
    },
    {
      body: buildLinqMessageWebhookBody({
        isFromMe: true,
      }),
      reason: "own-message",
    },
    {
      body: buildLinqMessageWebhookBody({
        from: "not-a-phone",
      }),
      reason: "invalid-phone",
    },
  ])("ignores Linq webhooks without side effects for $reason", async ({ body, reason }) => {
    const prisma: any = withPrismaTransaction({
      hostedBillingCheckout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn(),
      },
    });

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: body,
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      ignored: true,
      ok: true,
      reason,
    });

    expect(prisma.hostedMember.findUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("asks the Murph intro question for an existing inactive member even without an onboarding trigger", async () => {
    const prisma: any = withPrismaTransaction({
      hostedBillingCheckout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn().mockResolvedValue(makePendingInvite({
          inviteCode: "code_returning_member",
          sentAt: null,
        })),
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          invites: [],
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
        }),
        update: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
        }),
      },
    });

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody({
          text: "hello",
        }),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      ok: true,
      reason: "prompted-get-started",
    });

    const receiptCalls = prisma.hostedWebhookReceipt.updateMany.mock.calls.map(
      ([payload]: [Record<string, unknown>]) => payload,
    );
    expect(receiptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: expect.any(String),
            completedAt: expect.any(String),
            eventPayload: {
              eventType: "message.received",
            },
            lastReceivedAt: expect.any(String),
            plannedAt: expect.any(String),
            response: expect.objectContaining({
              ok: true,
              reason: "prompted-get-started",
            }),
            sideEffects: [
              buildLinqMessageSideEffect({
                attemptCount: 1,
                inviteId: null,
                lastAttemptAt: expect.any(String),
                message: buildHostedGetStartedReply(),
                sentAt: expect.any(String),
                status: "sent",
              }),
            ],
            status: "completed",
          }),
        }),
      }),
    );
    expect(prisma.hostedMember.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.hostedInvite.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.hostedMember.create).not.toHaveBeenCalled();
    expect(prisma.hostedMember.update).toHaveBeenCalledTimes(1);
    expect(prisma.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: buildHostedGetStartedReply(),
        replyToMessageId: "msg_123",
      }),
    );
  });

  it("asks the Murph intro question on first contact before sending the signup link", async () => {
    const prisma: any = withPrismaTransaction({
      hostedBillingCheckout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn().mockResolvedValue(makePendingInvite({
          inviteCode: "code_first_contact",
          sentAt: null,
        })),
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
        }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    });

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody({
          text: "hello",
        }),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      ok: true,
      reason: "prompted-get-started",
    });

    const receiptCalls = prisma.hostedWebhookReceipt.updateMany.mock.calls.map(
      ([payload]: [Record<string, unknown>]) => payload,
    );
    expect(receiptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: expect.any(String),
            completedAt: expect.any(String),
            eventPayload: {
              eventType: "message.received",
            },
            lastReceivedAt: expect.any(String),
            plannedAt: expect.any(String),
            response: expect.objectContaining({
              ok: true,
              reason: "prompted-get-started",
            }),
            sideEffects: [
              buildLinqMessageSideEffect({
                attemptCount: 1,
                inviteId: null,
                lastAttemptAt: expect.any(String),
                message: buildHostedGetStartedReply(),
                sentAt: expect.any(String),
                status: "sent",
              }),
            ],
            status: "completed",
          }),
        }),
      }),
    );
    expect(prisma.hostedInvite.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(prisma.hostedInvite.updateMany).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: buildHostedGetStartedReply(),
        replyToMessageId: "msg_123",
      }),
    );
  });

  it("sends the signup link on any follow-up reply after the intro question", async () => {
    const pendingInvite = makePendingInvite({
      inviteCode: "code_follow_up",
      sentAt: null,
    });
    const prisma: any = withPrismaTransaction({
      hostedBillingCheckout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(pendingInvite),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...pendingInvite,
          ...data,
        })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
        }),
        update: vi.fn(),
      },
    });

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody({
          text: "yep",
        }),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      inviteCode: "code_follow_up",
      joinUrl: "https://join.example.test/join/code_follow_up",
      ok: true,
      reason: "sent-signup-link",
    });

    const receiptCalls = prisma.hostedWebhookReceipt.updateMany.mock.calls.map(
      ([payload]: [Record<string, unknown>]) => payload,
    );
    expect(receiptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: expect.any(String),
            completedAt: expect.any(String),
            eventPayload: {
              eventType: "message.received",
            },
            lastReceivedAt: expect.any(String),
            plannedAt: expect.any(String),
            response: expect.objectContaining({
              inviteCode: "code_follow_up",
              joinUrl: "https://join.example.test/join/code_follow_up",
              ok: true,
              reason: "sent-signup-link",
            }),
            sideEffects: [
              buildLinqMessageSideEffect({
                attemptCount: 1,
                inviteId: "invite_123",
                lastAttemptAt: expect.any(String),
                message: buildHostedInviteReply({
                  activeSubscription: false,
                  joinUrl: "https://join.example.test/join/code_follow_up",
                }),
                sentAt: expect.any(String),
                status: "sent",
              }),
            ],
            status: "completed",
          }),
        }),
      }),
    );
    expect(prisma.hostedInvite.create).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.update).toHaveBeenCalledWith({
      where: {
        id: "invite_123",
      },
      data: {
        sentAt: expect.any(Date),
      },
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: buildHostedInviteReply({
          activeSubscription: false,
          joinUrl: "https://join.example.test/join/code_follow_up",
        }),
        replyToMessageId: "msg_123",
      }),
    );
  });

  it("resends the signup link on later replies while the member is still inactive", async () => {
    const sentInvite = makePendingInvite({
      inviteCode: "code_repeat_link",
      sentAt: new Date("2026-03-26T12:05:00.000Z"),
    });
    const prisma: any = withPrismaTransaction({
      hostedBillingCheckout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(sentInvite),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...sentInvite,
          ...data,
        })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
        }),
        update: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
        }),
      },
    });

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody({
          text: "still there?",
        }),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      inviteCode: "code_repeat_link",
      joinUrl: "https://join.example.test/join/code_repeat_link",
      ok: true,
      reason: "sent-signup-link",
    });

    expect(prisma.hostedInvite.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.hostedInvite.update).toHaveBeenNthCalledWith(1, {
      where: {
        id: "invite_123",
      },
      data: {
        channel: "linq",
        linqChatId: "chat_123",
        linqEventId: "evt_123",
        triggerText: "still there?",
      },
    });
    expect(prisma.hostedInvite.update).toHaveBeenNthCalledWith(2, {
      where: {
        id: "invite_123",
      },
      data: {
        sentAt: expect.any(Date),
      },
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: buildHostedInviteReply({
          activeSubscription: false,
          joinUrl: "https://join.example.test/join/code_repeat_link",
        }),
        replyToMessageId: "msg_123",
      }),
    );
  });

  it("does not skip the intro question when the member only has an unsent non-Linq invite", async () => {
    const pendingWebInvite = makePendingInvite({
      channel: "web",
      inviteCode: "code_from_web",
      sentAt: null,
    });
    const prisma: any = withPrismaTransaction({
      hostedBillingCheckout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(pendingWebInvite),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...pendingWebInvite,
          ...data,
        })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          linqChatId: null,
          normalizedPhoneNumber: "+15551234567",
        }),
        update: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
        }),
      },
    });

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody({
          text: "hello",
        }),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      ok: true,
      reason: "prompted-get-started",
    });

    expect(prisma.hostedInvite.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.hostedInvite.update).toHaveBeenCalledWith({
      where: {
        id: "invite_123",
      },
      data: {
        channel: "linq",
        linqChatId: "chat_123",
        linqEventId: "evt_123",
        triggerText: "hello",
      },
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: buildHostedGetStartedReply(),
        replyToMessageId: "msg_123",
      }),
    );
  });

  it("completes a Linq active-member webhook after the dispatch is durably queued", async () => {
    const prisma: any = withPrismaTransaction({
      hostedBillingCheckout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(makeActiveMember()),
      },
    });

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody(),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      ok: true,
      reason: "dispatched-active-member",
    });

    const receiptCalls = prisma.hostedWebhookReceipt.updateMany.mock.calls.map(
      ([payload]: [Record<string, unknown>]) => payload,
    );
    expect(receiptCalls).toHaveLength(4);
    expect(((receiptCalls[0]?.data as { payloadJson?: unknown } | undefined)?.payloadJson)).toEqual(
      buildWebhookReceiptPayload({
        attemptCount: 1,
        attemptId: expect.any(String),
        eventPayload: {
          eventType: "message.received",
        },
        lastReceivedAt: expect.any(String),
        plannedAt: expect.any(String),
        response: expect.objectContaining({
          ok: true,
          reason: "dispatched-active-member",
        }),
        sideEffects: [
          buildDispatchSideEffect({
            eventId: "evt_123",
            status: "pending",
          }),
        ],
        status: "processing",
      }),
    );
    expect(receiptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: expect.any(String),
            completedAt: expect.any(String),
            eventPayload: {
              eventType: "message.received",
            },
            lastReceivedAt: expect.any(String),
            plannedAt: expect.any(String),
            response: expect.objectContaining({
              ok: true,
              reason: "dispatched-active-member",
            }),
            sideEffects: [
              buildDispatchSideEffect({
                attemptCount: 1,
                eventId: "evt_123",
                lastAttemptAt: expect.any(String),
                sentAt: expect.any(String),
                status: "sent",
              }),
            ],
            status: "completed",
          }),
        }),
      }),
    );
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch: expect.objectContaining({
          event: expect.objectContaining({
            kind: "linq.message.received",
            userId: "member_123",
          }),
          eventId: "evt_123",
        }),
        sourceId: "linq:evt_123",
        sourceType: "hosted_webhook_receipt",
      }),
    );
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledTimes(1);
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
  });

  it("queues Stripe events for async reconciliation instead of mutating billing state inline", async () => {
    mocks.stripeConstructEvent.mockReturnValue({
      created: Math.floor(new Date("2026-03-28T10:00:00.000Z").getTime() / 1000),
      data: {
        object: {
          customer: "cus_123",
          id: "in_123",
          payment_intent: "pi_123",
          parent: {
            subscription_details: {
              subscription: "sub_123",
            },
          },
        },
      },
      id: "evt_stripe_123",
      type: "invoice.paid",
    });

    const prisma: any = withPrismaTransaction({
      hostedMember: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      hostedStripeEvent: {
        create: vi.fn().mockResolvedValue({}),
      },
    });

    await expect(
      handleHostedStripeWebhook({
        prisma,
        rawBody: JSON.stringify({ id: "evt_stripe_123" }),
        signature: "sig_123",
      }),
    ).resolves.toMatchObject({
      ok: true,
      type: "invoice.paid",
    });

    expect(prisma.hostedStripeEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attemptCount: 0,
        customerId: "cus_123",
        eventId: "evt_stripe_123",
        invoiceId: "in_123",
        paymentIntentId: "pi_123",
        status: "pending",
        subscriptionId: "sub_123",
        type: "invoice.paid",
      }),
    });
    expect(prisma.hostedMember.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedMember.update).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("treats duplicate Stripe events as ingress duplicates without replaying durable work", async () => {
    mocks.stripeConstructEvent.mockReturnValue({
      created: Math.floor(new Date("2026-03-28T10:00:00.000Z").getTime() / 1000),
      data: {
        object: {
          customer: "cus_123",
          id: "in_123",
        },
      },
      id: "evt_stripe_123",
      type: "invoice.paid",
    });

    const prisma: any = withPrismaTransaction({
      hostedMember: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      hostedStripeEvent: {
        create: vi.fn().mockRejectedValue(createUniqueConstraintError()),
      },
    });

    await expect(
      handleHostedStripeWebhook({
        prisma,
        rawBody: JSON.stringify({ id: "evt_stripe_123" }),
        signature: "sig_123",
      }),
    ).resolves.toMatchObject({
      duplicate: true,
      ok: true,
      type: "invoice.paid",
    });

    expect(prisma.hostedMember.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedMember.update).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("does not redispatch an already-sent Linq side effect when reclaiming a failed receipt", async () => {
    const failedReceiptPayload = buildWebhookReceiptPayload({
      attemptCount: 1,
      attemptId: "attempt-1",
      eventPayload: {
        eventType: "message.received",
      },
      lastError: {
        message: "Receipt completion failed after the outbound dispatch was recorded.",
        name: "HostedOnboardingError",
      },
      lastReceivedAt: "2026-03-26T12:00:00.500Z",
      sideEffects: [
        buildDispatchSideEffect({
          attemptCount: 1,
          eventId: "evt_123",
          lastAttemptAt: "2026-03-26T12:00:00.250Z",
          sentAt: "2026-03-26T12:00:00.400Z",
          status: "sent",
        }),
      ],
      status: "failed",
    });
    const prisma: any = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockRejectedValue(createUniqueConstraintError()),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: failedReceiptPayload,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(makeActiveMember()),
      },
    });

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody(),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      ok: true,
      reason: "dispatched-active-member",
    });

    const receiptCalls = prisma.hostedWebhookReceipt.updateMany.mock.calls.map(
      ([payload]: [Record<string, unknown>]) => payload,
    );
    expect(receiptCalls[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          payloadJson: {
            equals: failedReceiptPayload,
          },
        }),
      }),
    );
    expect(receiptCalls[0]?.data).toEqual(
      expect.objectContaining({
        payloadJson: expect.objectContaining({
          eventPayload: {
            eventType: "message.received",
          },
          receiptState: expect.objectContaining({
            attemptCount: 2,
            attemptId: expect.any(String),
            lastReceivedAt: expect.any(String),
            status: "processing",
          }),
        }),
      }),
    );
    expect(receiptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: expect.objectContaining({
            eventPayload: {
              eventType: "message.received",
            },
            receiptState: expect.objectContaining({
              attemptCount: 2,
              attemptId: expect.any(String),
              completedAt: expect.any(String),
              lastReceivedAt: expect.any(String),
              plannedAt: expect.any(String),
              response: expect.objectContaining({
                ok: true,
                reason: "dispatched-active-member",
              }),
              sideEffects: expect.arrayContaining([
                expect.objectContaining({
                  attemptCount: 1,
                  effectId: "dispatch:evt_123",
                  kind: "hosted_execution_dispatch",
                  lastAttemptAt: expect.any(String),
                  result: {
                    dispatched: true,
                  },
                  sentAt: expect.any(String),
                  status: "sent",
                }),
              ]),
              status: "completed",
            }),
          }),
        }),
        where: expect.objectContaining({
          payloadJson: {
            equals: expect.objectContaining({
              eventPayload: {
                eventType: "message.received",
              },
              receiptState: expect.objectContaining({
                attemptCount: 2,
                status: "processing",
              }),
            }),
          },
        }),
      }),
    );
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("fails dispatch queueing after three stale compare-and-swap misses", async () => {
    const startedReceiptPayload = buildWebhookReceiptPayload({
      attemptCount: 1,
      attemptId: "attempt-1",
      eventPayload: {
        eventType: "message.received",
      },
      lastReceivedAt: "2026-03-26T12:00:00.000Z",
      sideEffects: [
        buildDispatchSideEffect({
          attemptCount: 1,
          eventId: "evt_123",
          lastAttemptAt: "2026-03-26T12:00:00.250Z",
          status: "pending",
        }),
      ],
      status: "processing",
    });
    const hostedWebhookReceiptUpdateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    const prisma: any = withPrismaTransaction({
      hostedBillingCheckout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: startedReceiptPayload,
        }),
        updateMany: hostedWebhookReceiptUpdateMany,
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(makeActiveMember()),
      },
    });

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody(),
        signature: null,
        timestamp: null,
      }),
    ).rejects.toMatchObject({
      code: "WEBHOOK_RECEIPT_UPDATE_FAILED",
      httpStatus: 503,
      retryable: true,
    });

    const receiptCalls = prisma.hostedWebhookReceipt.updateMany.mock.calls.map(
      ([payload]: [Record<string, unknown>]) => payload,
    );
    const dispatchQueueCalls = receiptCalls.slice(2, 5);
    expect(dispatchQueueCalls).toHaveLength(3);
    for (const call of dispatchQueueCalls) {
      expect(call).toEqual(
        expect.objectContaining({
          where: expect.objectContaining({
            eventId: "evt_123",
            payloadJson: {
              equals: expect.objectContaining({
                eventPayload: {
                  eventType: "message.received",
                },
                receiptState: expect.objectContaining({
                  attemptCount: 1,
                  sideEffects: expect.arrayContaining([
                    expect.objectContaining({
                      attemptCount: 1,
                      effectId: "dispatch:evt_123",
                      kind: "hosted_execution_dispatch",
                      result: null,
                      status: "pending",
                    }),
                  ]),
                  status: "processing",
                }),
              }),
            },
          }),
          data: expect.objectContaining({
            payloadJson: expect.objectContaining({
              receiptState: expect.objectContaining({
                sideEffects: expect.arrayContaining([
                  expect.objectContaining({
                    effectId: "dispatch:evt_123",
                    kind: "hosted_execution_dispatch",
                    result: {
                      dispatched: true,
                    },
                    status: "sent",
                  }),
                ]),
                status: "processing",
              }),
            }),
          }),
        }),
      );
    }
    expect(prisma.hostedWebhookReceipt.findUnique).toHaveBeenCalledTimes(3);
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledTimes(3);
    expect(prisma.hostedMember.findUnique).toHaveBeenCalledTimes(1);
    expect(receiptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: expect.objectContaining({
            receiptState: expect.objectContaining({
              status: "failed",
            }),
          }),
        }),
      }),
    );
  });

  it("allows a Linq invite reply webhook to retry after a retryable Linq 429 send failure", async () => {
    const retryableRateLimitError = Object.assign(
      new Error("Linq outbound reply failed with HTTP 429."),
      {
        code: "LINQ_SEND_FAILED",
        httpStatus: 502,
        name: "HostedOnboardingError",
        retryable: true,
      },
    );
    mocks.sendHostedLinqChatMessage
      .mockRejectedValueOnce(retryableRateLimitError)
      .mockResolvedValueOnce({
        chatId: "chat_123",
        messageId: "out_msg_123",
      });
    const member = {
      billingStatus: HostedBillingStatus.not_started,
      encryptedBootstrapSecret: "enc:bootstrap",
      encryptionKeyVersion: "v1",
      id: "member_123",
      invites: [],
      linqChatId: "chat_123",
      normalizedPhoneNumber: "+15551234567",
      phoneNumber: "+15551234567",
      phoneNumberVerifiedAt: new Date("2026-03-26T12:00:00.000Z"),
      status: "invited",
    };
    const invite = {
      channel: "linq",
      createdAt: new Date("2026-03-26T12:00:00.000Z"),
      expiresAt: new Date("2026-03-27T12:00:00.000Z"),
      id: "invite_123",
      inviteCode: "join_123",
      linqChatId: "chat_123",
      linqEventId: "evt_123",
      memberId: "member_123",
      sentAt: null,
      status: "pending",
      triggerText: "start murph",
      updatedAt: new Date("2026-03-26T12:00:00.000Z"),
    };
    const prisma: any = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn()
          .mockResolvedValueOnce({})
          .mockRejectedValueOnce(createUniqueConstraintError()),
        findUnique: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        create: vi.fn().mockResolvedValue(member),
        findUnique: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(member)
          .mockResolvedValueOnce(member),
        update: vi.fn().mockResolvedValue(member),
      },
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(invite),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...invite,
          ...data,
        })),
      },
    });

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody({
          text: "start murph",
        }),
        signature: null,
        timestamp: null,
      }),
    ).rejects.toMatchObject({
      code: "LINQ_SEND_FAILED",
      message: "Linq outbound reply failed with HTTP 429.",
      name: "HostedOnboardingError",
      retryable: true,
    });

    const firstAttemptCalls = prisma.hostedWebhookReceipt.updateMany.mock.calls.map(
      ([payload]: [Record<string, unknown>]) => payload,
    );
    expect(firstAttemptCalls).toHaveLength(4);
    expect(firstAttemptCalls[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: expect.any(String),
            eventPayload: {
              eventType: "message.received",
            },
            lastReceivedAt: expect.any(String),
            plannedAt: expect.any(String),
            response: expect.objectContaining({
              ok: true,
              reason: "prompted-get-started",
            }),
            sideEffects: [
              buildLinqMessageSideEffect({
                inviteId: null,
                message: buildHostedGetStartedReply(),
                replyToMessageId: "msg_123",
                status: "pending",
              }),
            ],
            status: "processing",
          }),
        }),
      }),
    );
    expect(firstAttemptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: expect.any(String),
            eventPayload: {
              eventType: "message.received",
            },
            lastError: {
              code: null,
              message: "Linq outbound reply failed with HTTP 429.",
              name: "HostedOnboardingError",
              retryable: null,
            },
            lastReceivedAt: expect.any(String),
            plannedAt: expect.any(String),
            response: expect.objectContaining({
              ok: true,
              reason: "prompted-get-started",
            }),
            sideEffects: [
              buildLinqMessageSideEffect({
                attemptCount: 1,
                inviteId: null,
                lastAttemptAt: expect.any(String),
                lastError: {
                  code: null,
                  message: "Linq outbound reply failed with HTTP 429.",
                  name: "HostedOnboardingError",
                  retryable: true,
                },
                message: buildHostedGetStartedReply(),
                replyToMessageId: "msg_123",
                status: "pending",
              }),
            ],
            status: "failed",
          }),
        }),
      }),
    );
    prisma.hostedWebhookReceipt.findUnique.mockResolvedValueOnce({
      payloadJson: firstAttemptCalls.at(-1)?.data?.payloadJson,
    });

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody({
          text: "start murph",
        }),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      ok: true,
      reason: "prompted-get-started",
    });

    const secondAttemptCalls = prisma.hostedWebhookReceipt.updateMany.mock.calls
      .slice(firstAttemptCalls.length)
      .map(([payload]: [Record<string, unknown>]) => payload);
    expect(secondAttemptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 2,
            attemptId: expect.any(String),
            completedAt: expect.any(String),
            eventPayload: {
              eventType: "message.received",
            },
            lastReceivedAt: expect.any(String),
            plannedAt: expect.any(String),
            response: expect.objectContaining({
              ok: true,
              reason: "prompted-get-started",
            }),
            sideEffects: [
              buildLinqMessageSideEffect({
                attemptCount: 2,
                inviteId: null,
                lastAttemptAt: expect.any(String),
                message: buildHostedGetStartedReply(),
                replyToMessageId: "msg_123",
                sentAt: expect.any(String),
                status: "sent",
              }),
            ],
            status: "completed",
          }),
        }),
      }),
    );
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(2);
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: buildHostedGetStartedReply(),
        replyToMessageId: "msg_123",
      }),
    );
    expect(prisma.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(prisma.hostedInvite.update).not.toHaveBeenCalled();
  });

  it("does not resend an already-sent Linq invite reply when reclaiming a failed receipt", async () => {
    const member = {
      billingStatus: HostedBillingStatus.not_started,
      encryptedBootstrapSecret: "enc:bootstrap",
      encryptionKeyVersion: "v1",
      id: "member_123",
      invites: [],
      linqChatId: "chat_123",
      normalizedPhoneNumber: "+15551234567",
      phoneNumber: "+15551234567",
      phoneNumberVerifiedAt: new Date("2026-03-26T12:00:00.000Z"),
      status: "invited",
    };
    const invite = {
      channel: "linq",
      createdAt: new Date("2026-03-26T12:00:00.000Z"),
      expiresAt: new Date("2026-03-27T12:00:00.000Z"),
      id: "invite_123",
      inviteCode: "join_123",
      linqChatId: "chat_123",
      linqEventId: "evt_123",
      memberId: "member_123",
      sentAt: new Date("2026-03-26T12:00:00.400Z"),
      status: "pending",
      triggerText: "I want to get healthy",
      updatedAt: new Date("2026-03-26T12:00:00.000Z"),
    };
    const failedReceiptPayload = buildWebhookReceiptPayload({
      attemptCount: 1,
      attemptId: "attempt-1",
      eventPayload: {
        eventType: "message.received",
      },
      lastError: {
        message: "Receipt completion failed after the Linq reply was recorded.",
        name: "HostedOnboardingError",
      },
      lastReceivedAt: "2026-03-26T12:00:00.500Z",
      sideEffects: [
        buildLinqMessageSideEffect({
          attemptCount: 1,
          inviteId: "invite_123",
          lastAttemptAt: "2026-03-26T12:00:00.250Z",
          message: "Use this invite link to join Murph: https://join.example.test/join/join_123",
          sentAt: "2026-03-26T12:00:00.400Z",
          status: "sent",
        }),
      ],
      status: "failed",
    });
    const prisma: any = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockRejectedValue(createUniqueConstraintError()),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: failedReceiptPayload,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(member)
          .mockResolvedValueOnce(member),
        update: vi.fn().mockResolvedValue(member),
      },
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue(invite),
      },
    });

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody({
          text: "I want to get healthy",
        }),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      inviteCode: "join_123",
      joinUrl: "https://join.example.test/join/join_123",
      ok: true,
    });

    const receiptCalls = prisma.hostedWebhookReceipt.updateMany.mock.calls.map(
      ([payload]: [Record<string, unknown>]) => payload,
    );
    expect(receiptCalls[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          payloadJson: {
            equals: failedReceiptPayload,
          },
        }),
        data: expect.objectContaining({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 2,
            attemptId: expect.any(String),
            eventPayload: {
              eventType: "message.received",
            },
            lastReceivedAt: expect.any(String),
            sideEffects: [
              buildLinqMessageSideEffect({
                attemptCount: 1,
                inviteId: "invite_123",
                lastAttemptAt: "2026-03-26T12:00:00.250Z",
                message: expect.any(String),
                replyToMessageId: null,
                sentAt: "2026-03-26T12:00:00.400Z",
                status: "sent",
              }),
            ],
            status: "processing",
          }),
        }),
      }),
    );
    expect(receiptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 2,
            attemptId: expect.any(String),
            completedAt: expect.any(String),
            eventPayload: {
              eventType: "message.received",
            },
            lastReceivedAt: expect.any(String),
            plannedAt: expect.any(String),
            response: expect.objectContaining({
              inviteCode: "join_123",
              joinUrl: "https://join.example.test/join/join_123",
              ok: true,
            }),
            sideEffects: [
              buildLinqMessageSideEffect({
                attemptCount: 1,
                inviteId: "invite_123",
                lastAttemptAt: "2026-03-26T12:00:00.250Z",
                message: expect.any(String),
                replyToMessageId: "msg_123",
                sentAt: "2026-03-26T12:00:00.400Z",
                status: "sent",
              }),
            ],
            status: "completed",
          }),
        }),
      }),
    );
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.create).not.toHaveBeenCalled();
  });

  it("treats completed Linq receipts as duplicates without redispatching the event", async () => {
    const prisma: any = {
      hostedWebhookReceipt: {
        create: vi.fn().mockRejectedValue(createUniqueConstraintError()),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: "attempt-1",
            completedAt: "2026-03-26T12:00:00.000Z",
            eventPayload: {
              eventType: "message.received",
            },
            lastReceivedAt: "2026-03-26T12:00:00.000Z",
            status: "completed",
          }),
        }),
        updateMany: vi.fn(),
      },
      hostedMember: {
        findUnique: vi.fn(),
      },
    };

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody(),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      duplicate: true,
      ok: true,
    });

    expect(prisma.hostedWebhookReceipt.updateMany).not.toHaveBeenCalled();
    expect(prisma.hostedMember.findUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("does not resend a Linq invite reply after the external send succeeds but receipt persistence fails", async () => {
    const member = {
      billingStatus: HostedBillingStatus.not_started,
      encryptedBootstrapSecret: "enc:bootstrap",
      encryptionKeyVersion: "v1",
      id: "member_123",
      invites: [],
      linqChatId: "chat_123",
      normalizedPhoneNumber: "+15551234567",
      phoneNumber: "+15551234567",
      phoneNumberVerifiedAt: new Date("2026-03-26T12:00:00.000Z"),
      status: "invited",
    };
    const invite = {
      channel: "linq",
      createdAt: new Date("2026-03-26T12:00:00.000Z"),
      expiresAt: new Date("2026-03-27T12:00:00.000Z"),
      id: "invite_123",
      inviteCode: "join_123",
      linqChatId: "chat_123",
      linqEventId: "evt_123",
      memberId: "member_123",
      sentAt: null,
      status: "pending",
      triggerText: "I want to get healthy",
      updatedAt: new Date("2026-03-26T12:00:00.000Z"),
    };
    let storedReceiptPayload: Record<string, unknown> | null = null;
    let failSentWriteOnce = true;

    const prisma: any = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockImplementation(({ data }: { data: { payloadJson: Record<string, unknown> } }) => {
          if (storedReceiptPayload) {
            throw createUniqueConstraintError();
          }
          storedReceiptPayload = data.payloadJson;
          return {};
        }),
        findUnique: vi.fn().mockImplementation(() =>
          storedReceiptPayload
            ? {
                payloadJson: storedReceiptPayload,
              }
            : null),
        updateMany: vi.fn().mockImplementation(({ data }: { data: { payloadJson: Record<string, unknown> } }) => {
          const nextPayload = data.payloadJson;
          const nextSideEffects = (
            nextPayload.receiptState as {
              sideEffects?: Array<{ kind?: string; status?: string }>;
            } | undefined
          )?.sideEffects;
          const nextLinqStatus = nextSideEffects?.find((effect) => effect.kind === "linq_message_send")?.status;

          if (failSentWriteOnce && nextLinqStatus === "sent") {
            failSentWriteOnce = false;
            throw new Error("Receipt persistence failed after the Linq send.");
          }

          storedReceiptPayload = nextPayload;
          return { count: 1 };
        }),
      },
      hostedMember: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(member)
          .mockResolvedValueOnce(member)
          .mockResolvedValueOnce(member)
          .mockResolvedValueOnce(member),
        update: vi.fn().mockResolvedValue(member),
      },
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({
          ...invite,
          sentAt: new Date("2026-03-26T12:00:00.400Z"),
        }),
      },
    });

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody({
          text: "I want to get healthy",
        }),
        signature: null,
        timestamp: null,
      }),
    ).rejects.toMatchObject({
      code: "hosted_webhook_side_effect_delivery_uncertain",
      name: "HostedOnboardingError",
      retryable: false,
    });

    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(storedReceiptPayload).toEqual(
      buildWebhookReceiptPayload({
        attemptCount: 1,
        attemptId: expect.any(String),
        eventPayload: {
          eventType: "message.received",
        },
        lastError: expect.objectContaining({
          message: expect.stringContaining("may already have been delivered"),
          name: "HostedOnboardingError",
        }),
        lastReceivedAt: expect.any(String),
        plannedAt: expect.any(String),
        response: expect.objectContaining({
          inviteCode: "join_123",
          joinUrl: "https://join.example.test/join/join_123",
          ok: true,
        }),
        sideEffects: [
          buildLinqMessageSideEffect({
            attemptCount: 1,
            inviteId: "invite_123",
            lastAttemptAt: expect.any(String),
            lastError: {
              code: null,
              message: "Receipt persistence failed after the Linq send.",
              name: "Error",
              retryable: null,
            },
            message: expect.stringContaining("https://join.example.test/join/join_123"),
            replyToMessageId: "msg_123",
            sentAt: expect.any(String),
            status: "sent_unconfirmed",
          }),
        ],
        status: "failed",
      }),
    );

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody({
          text: "I want to get healthy",
        }),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      duplicate: true,
      ok: true,
    });

    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(storedReceiptPayload).toEqual(
      buildWebhookReceiptPayload({
        attemptCount: 1,
        attemptId: expect.any(String),
        eventPayload: {
          eventType: "message.received",
        },
        lastError: expect.objectContaining({
          message: expect.stringContaining("may already have been delivered"),
          name: "HostedOnboardingError",
        }),
        lastReceivedAt: expect.any(String),
        plannedAt: expect.any(String),
        response: expect.objectContaining({
          inviteCode: "join_123",
          joinUrl: "https://join.example.test/join/join_123",
          ok: true,
        }),
        sideEffects: [
          buildLinqMessageSideEffect({
            attemptCount: 1,
            inviteId: "invite_123",
            lastAttemptAt: expect.any(String),
            lastError: {
              code: null,
              message: "Receipt persistence failed after the Linq send.",
              name: "Error",
              retryable: null,
            },
            message: expect.stringContaining("https://join.example.test/join/join_123"),
            replyToMessageId: "msg_123",
            sentAt: expect.any(String),
            status: "sent_unconfirmed",
          }),
        ],
        status: "failed",
      }),
    );
  });

  it("does not replay a Linq invite reply when both sent and sent-unconfirmed receipt writes fail", async () => {
    const member = {
      billingStatus: HostedBillingStatus.not_started,
      encryptedBootstrapSecret: "enc:bootstrap",
      encryptionKeyVersion: "v1",
      id: "member_123",
      invites: [],
      linqChatId: "chat_123",
      normalizedPhoneNumber: "+15551234567",
      phoneNumber: "+15551234567",
      phoneNumberVerifiedAt: new Date("2026-03-26T12:00:00.000Z"),
      status: "invited",
    };
    const invite = {
      channel: "linq",
      createdAt: new Date("2026-03-26T12:00:00.000Z"),
      expiresAt: new Date("2026-03-27T12:00:00.000Z"),
      id: "invite_123",
      inviteCode: "join_123",
      linqChatId: "chat_123",
      linqEventId: "evt_123",
      memberId: "member_123",
      sentAt: null,
      status: "pending",
      triggerText: "I want to get healthy",
      updatedAt: new Date("2026-03-26T12:00:00.000Z"),
    };
    let storedReceiptPayload: Record<string, unknown> | null = null;

    const prisma: any = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockImplementation(({ data }: { data: { payloadJson: Record<string, unknown> } }) => {
          if (storedReceiptPayload) {
            throw createUniqueConstraintError();
          }
          storedReceiptPayload = data.payloadJson;
          return {};
        }),
        findUnique: vi.fn().mockImplementation(() =>
          storedReceiptPayload
            ? {
                payloadJson: storedReceiptPayload,
              }
            : null),
        updateMany: vi.fn().mockImplementation(({ data }: { data: { payloadJson: Record<string, unknown> } }) => {
          const nextPayload = data.payloadJson;
          const nextReceiptState = nextPayload.receiptState as {
            sideEffects?: Array<{ kind?: string; status?: string }>;
            status?: string;
          } | undefined;
          const nextLinqStatus = nextReceiptState?.sideEffects?.find(
            (effect) => effect.kind === "linq_message_send",
          )?.status;

          if (nextLinqStatus === "sent") {
            throw new Error("Receipt persistence failed after the Linq send.");
          }

          if (nextLinqStatus === "sent_unconfirmed") {
            throw new Error("Receipt persistence failed while recording sent_unconfirmed.");
          }

          storedReceiptPayload = nextPayload;
          return { count: 1 };
        }),
      },
      hostedMember: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(member)
          .mockResolvedValueOnce(member)
          .mockResolvedValueOnce(member)
          .mockResolvedValueOnce(member),
        update: vi.fn().mockResolvedValue(member),
      },
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue(invite),
      },
    });

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody({
          text: "I want to get healthy",
        }),
        signature: null,
        timestamp: null,
      }),
    ).rejects.toMatchObject({
      code: "hosted_webhook_side_effect_delivery_uncertain",
      name: "HostedOnboardingError",
      retryable: false,
    });

    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(storedReceiptPayload).toEqual(
      buildWebhookReceiptPayload({
        attemptCount: 1,
        attemptId: expect.any(String),
        eventPayload: {
          eventType: "message.received",
        },
        lastError: expect.objectContaining({
          code: "hosted_webhook_side_effect_delivery_uncertain",
          message: expect.stringContaining("may already have been delivered"),
          name: "HostedOnboardingError",
          retryable: false,
        }),
        lastReceivedAt: expect.any(String),
        plannedAt: expect.any(String),
        response: expect.objectContaining({
          inviteCode: "join_123",
          joinUrl: "https://join.example.test/join/join_123",
          ok: true,
        }),
        sideEffects: [
          buildLinqMessageSideEffect({
            attemptCount: 1,
            inviteId: "invite_123",
            lastAttemptAt: expect.any(String),
            lastError: null,
            message: expect.stringContaining("https://join.example.test/join/join_123"),
            replyToMessageId: "msg_123",
            sentAt: null,
            status: "pending",
          }),
        ],
        status: "failed",
      }),
    );

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody({
          text: "I want to get healthy",
        }),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      duplicate: true,
      ok: true,
    });

    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(storedReceiptPayload).toEqual(
      buildWebhookReceiptPayload({
        attemptCount: 1,
        attemptId: expect.any(String),
        eventPayload: {
          eventType: "message.received",
        },
        lastError: expect.objectContaining({
          code: "hosted_webhook_side_effect_delivery_uncertain",
          message: expect.stringContaining("may already have been delivered"),
          name: "HostedOnboardingError",
          retryable: false,
        }),
        lastReceivedAt: expect.any(String),
        plannedAt: expect.any(String),
        response: expect.objectContaining({
          inviteCode: "join_123",
          joinUrl: "https://join.example.test/join/join_123",
          ok: true,
        }),
        sideEffects: [
          buildLinqMessageSideEffect({
            attemptCount: 1,
            inviteId: "invite_123",
            lastAttemptAt: expect.any(String),
            lastError: null,
            message: expect.stringContaining("https://join.example.test/join/join_123"),
            replyToMessageId: "msg_123",
            sentAt: null,
            status: "pending",
          }),
        ],
        status: "failed",
      }),
    );
  });

  it("treats in-flight processing Linq receipts as duplicates without redispatching the event", async () => {
    const prisma: any = {
      hostedWebhookReceipt: {
        create: vi.fn().mockRejectedValue(createUniqueConstraintError()),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: "attempt-processing",
            eventPayload: {
              eventType: "message.received",
            },
            lastReceivedAt: "2026-03-26T12:00:00.000Z",
            status: "processing",
          }),
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      hostedMember: {
        findUnique: vi.fn(),
      },
    };

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody(),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      duplicate: true,
      ok: true,
    });

    expect(prisma.hostedWebhookReceipt.updateMany).not.toHaveBeenCalled();
    expect(prisma.hostedMember.findUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("reclaims malformed Linq receipts instead of treating them as duplicates", async () => {
    const malformedReceiptPayload = {
      receiptState: {
        attemptCount: "bad",
        status: 42,
      },
      strayLegacyField: "keep-me-if-possible",
    };
    const prisma: any = {
      hostedWebhookReceipt: {
        create: vi.fn().mockRejectedValue(createUniqueConstraintError()),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: malformedReceiptPayload,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue(makeActiveMember()),
      },
    };

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody(),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      ok: true,
      reason: "dispatched-active-member",
    });

    const receiptCalls = prisma.hostedWebhookReceipt.updateMany.mock.calls.map(
      ([payload]: [Record<string, unknown>]) => payload,
    );
    expect((receiptCalls[0]?.where as { payloadJson?: { equals?: unknown } } | undefined)?.payloadJson).toEqual({
      equals: malformedReceiptPayload,
    });
    expect(((receiptCalls[0]?.data as { payloadJson?: unknown } | undefined)?.payloadJson)).toEqual(
      expect.objectContaining({
        eventPayload: {
          eventType: "message.received",
        },
        receiptState: expect.objectContaining({
          attemptCount: 1,
          attemptId: expect.any(String),
          lastReceivedAt: expect.any(String),
          sideEffects: [],
          status: "processing",
        }),
      }),
    );
    expect(((receiptCalls.at(-1)?.data as { payloadJson?: unknown } | undefined)?.payloadJson)).toEqual(
      expect.objectContaining({
        eventPayload: {
          eventType: "message.received",
        },
        receiptState: expect.objectContaining({
          attemptCount: 1,
          attemptId: expect.any(String),
          completedAt: expect.any(String),
          lastReceivedAt: expect.any(String),
          plannedAt: expect.any(String),
          response: expect.objectContaining({
            ok: true,
            reason: "dispatched-active-member",
          }),
          sideEffects: [
            buildDispatchSideEffect({
              attemptCount: 1,
              eventId: "evt_123",
              lastAttemptAt: expect.any(String),
              sentAt: expect.any(String),
              status: "sent",
            }),
          ],
          status: "completed",
        }),
      }),
    );
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledTimes(1);
  });

  it("fails reclaiming malformed Linq receipts after three stale compare-and-swap misses", async () => {
    const malformedReceiptPayload = {
      receiptState: {
        attemptCount: "bad",
        status: 42,
      },
      strayLegacyField: "keep-me-if-possible",
    };
    const prisma: any = {
      hostedWebhookReceipt: {
        create: vi.fn().mockRejectedValue(createUniqueConstraintError()),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: malformedReceiptPayload,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      hostedMember: {
        findUnique: vi.fn(),
      },
    };

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody(),
        signature: null,
        timestamp: null,
      }),
    ).rejects.toMatchObject({
      code: "WEBHOOK_RECEIPT_CLAIM_FAILED",
      httpStatus: 503,
      retryable: true,
    });

    const reclaimCalls = prisma.hostedWebhookReceipt.updateMany.mock.calls.map(
      ([payload]: [Record<string, unknown>]) => payload,
    );
    expect(reclaimCalls).toHaveLength(3);
    for (const call of reclaimCalls) {
      expect(call).toEqual(
        expect.objectContaining({
          where: expect.objectContaining({
            payloadJson: {
              equals: malformedReceiptPayload,
            },
          }),
        }),
      );
    }
    expect(prisma.hostedWebhookReceipt.findUnique).toHaveBeenCalledTimes(4);
    expect(prisma.hostedMember.findUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("does not reclaim a refreshed processing receipt after a stale compare-and-swap miss", async () => {
    const expiredProcessingReceiptPayload = buildWebhookReceiptPayload({
      attemptCount: 1,
      attemptId: "attempt-1",
      eventPayload: {
        eventType: "message.received",
      },
      lastReceivedAt: "2026-03-26T12:00:00.000Z",
      status: "processing",
    });
    const refreshedProcessingReceiptPayload = buildWebhookReceiptPayload({
      attemptCount: 2,
      attemptId: "attempt-2",
      eventPayload: {
        eventType: "message.received",
      },
      lastReceivedAt: "2026-03-26T12:05:00.000Z",
      status: "processing",
    });
    const prisma: any = {
      hostedWebhookReceipt: {
        create: vi.fn().mockRejectedValue(createUniqueConstraintError()),
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            claimExpiresAt: new Date("2026-03-26T12:10:00.000Z"),
            payloadJson: expiredProcessingReceiptPayload,
            updatedAt: new Date("2026-03-26T12:00:00.000Z"),
          })
          .mockResolvedValueOnce({
            claimExpiresAt: new Date("2999-01-01T00:00:00.000Z"),
            payloadJson: refreshedProcessingReceiptPayload,
            updatedAt: new Date("2999-01-01T00:00:00.000Z"),
          }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      hostedMember: {
        findUnique: vi.fn(),
      },
    };

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody(),
        signature: null,
        timestamp: null,
      }),
    ).resolves.toMatchObject({
      duplicate: true,
      ok: true,
    });

    expect(prisma.hostedWebhookReceipt.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.hostedWebhookReceipt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          payloadJson: {
            equals: expiredProcessingReceiptPayload,
          },
        }),
      }),
    );
    expect(prisma.hostedWebhookReceipt.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.hostedMember.findUnique).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

});

function buildLinqMessageWebhookBody(input: {
  eventType?: string;
  from?: string;
  isFromMe?: boolean;
  text?: string;
} = {}): string {
  return JSON.stringify({
    api_version: "v1",
    created_at: "2026-03-26T12:00:00.000Z",
    data: {
      chat_id: "chat_123",
      from: input.from ?? "+15551234567",
      is_from_me: input.isFromMe ?? false,
      message: {
        id: "msg_123",
        parts: [
          {
            type: "text",
            value: input.text ?? "hello",
          },
        ],
      },
      recipient_phone: "+15550000000",
      received_at: "2026-03-26T12:00:00.000Z",
      service: "sms",
    },
    event_id: "evt_123",
    event_type: input.eventType ?? "message.received",
  });
}

function createUniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError("duplicate", {
    clientVersion: "test",
    code: "P2002",
  });
}

function buildWebhookReceiptPayload(input: {
  attemptCount: number;
  attemptId?: unknown;
  completedAt?: unknown;
  eventPayload: Record<string, unknown>;
  lastError?: unknown;
  lastReceivedAt?: unknown;
  plannedAt?: unknown;
  response?: unknown;
  sideEffects?: unknown[];
  status: "completed" | "failed" | "processing";
}) {
  return {
    eventPayload: input.eventPayload,
    receiptState: {
      attemptCount: input.attemptCount,
      attemptId: input.attemptId ?? "attempt-1",
      completedAt:
        input.completedAt ??
        (input.status === "completed" ? "2026-03-26T12:00:00.000Z" : null),
      lastError:
        input.lastError ??
        (input.status === "failed"
          ? {
              message: "Unknown hosted webhook failure.",
              name: "UnknownError",
            }
          : null),
      lastReceivedAt: input.lastReceivedAt ?? "2026-03-26T12:00:00.000Z",
      plannedAt: input.plannedAt ?? null,
      response: input.response ?? null,
      sideEffects: input.sideEffects ?? [],
      status: input.status,
    },
  };
}

function makeActiveMember() {
  return {
    billingStatus: HostedBillingStatus.active,
    id: "member_123",
    invites: [],
    linqChatId: "chat_123",
    normalizedPhoneNumber: "+15551234567",
  };
}

function makePendingInvite(input: {
  channel?: "linq" | "share" | "web";
  inviteCode?: string;
  sentAt?: Date | null;
} = {}) {
  return {
    channel: input.channel ?? "linq",
    createdAt: new Date("2026-03-26T12:00:00.000Z"),
    expiresAt: new Date("2026-04-02T12:00:00.000Z"),
    id: "invite_123",
    inviteCode: input.inviteCode ?? "code_123",
    sentAt: input.sentAt ?? null,
    status: "pending",
  };
}

function buildDispatchSideEffect(input: {
  attemptCount?: number;
  effectId?: unknown;
  eventId: string;
  lastAttemptAt?: unknown;
  lastError?: unknown;
  occurredAt?: unknown;
  sentAt?: unknown;
  status: "pending" | "sent";
}) {
  const occurredAt = input.occurredAt ?? "2026-03-26T12:00:00.000Z";
  const linqEvent = {
    api_version: "v1",
    created_at: occurredAt,
    data: {
      chat_id: "chat_123",
      from: "+15551234567",
      is_from_me: false,
      message: {
        effect: null,
        id: "msg_123",
        parts: [
          {
            type: "text",
            value: "hello",
          },
        ],
        reply_to: null,
      },
      received_at: "2026-03-26T12:00:00.000Z",
      recipient_phone: "+15550000000",
      service: "sms",
    },
    event_id: input.eventId,
    event_type: "message.received",
    partner_id: null,
    trace_id: null,
  };

  return {
    attemptCount: input.attemptCount ?? 0,
    effectId: input.effectId ?? `dispatch:${input.eventId}`,
    kind: "hosted_execution_dispatch",
    lastAttemptAt: input.lastAttemptAt ?? null,
    lastError: input.lastError ?? null,
    payload:
      input.status === "sent"
        ? {
            storage: "reference",
            schemaVersion: "murph.execution-outbox.v2",
            dispatchRef: {
              eventId: input.eventId,
              eventKind: "linq.message.received",
              occurredAt,
              userId: "member_123",
            },
            linqEvent,
          }
        : {
            dispatch: {
              event: {
                kind: "linq.message.received",
                linqEvent,
                normalizedPhoneNumber: "+15551234567",
                userId: "member_123",
              },
              eventId: input.eventId,
              occurredAt,
            },
          },
    result: input.status === "sent" ? { dispatched: true } : null,
    sentAt:
      input.sentAt ??
      (input.status === "sent" ? "2026-03-26T12:00:01.000Z" : null),
    status: input.status,
  };
}

function buildMemberActivationDispatchSideEffect(input: {
  attemptCount?: number;
  effectId?: unknown;
  lastAttemptAt?: unknown;
  lastError?: unknown;
  memberId?: string;
  occurredAt?: unknown;
  sentAt?: unknown;
  sourceEventId: string;
  sourceType: string;
  status: "pending" | "sent";
}) {
  const memberId = input.memberId ?? "member_123";
  const eventId =
    input.effectId ??
    `dispatch:member.activated:${input.sourceType}:${memberId}:${input.sourceEventId}`;
  const occurredAt = input.occurredAt ?? "2026-03-26T12:00:00.000Z";

  return {
    attemptCount: input.attemptCount ?? 0,
    effectId: eventId,
    kind: "hosted_execution_dispatch",
    lastAttemptAt: input.lastAttemptAt ?? null,
    lastError: input.lastError ?? null,
    payload:
      input.status === "sent"
        ? {
            storage: "reference",
            schemaVersion: "murph.execution-outbox.v2",
            dispatchRef: {
              eventId: String(eventId).replace(/^dispatch:/u, ""),
              eventKind: "member.activated",
              occurredAt,
              userId: memberId,
            },
          }
        : {
            dispatch: {
              event: {
                kind: "member.activated",
                userId: memberId,
              },
              eventId: String(eventId).replace(/^dispatch:/u, ""),
              occurredAt,
            },
          },
    result: input.status === "sent" ? { dispatched: true } : null,
    sentAt:
      input.sentAt ??
      (input.status === "sent" ? "2026-03-26T12:00:01.000Z" : null),
    status: input.status,
  };
}

function buildLinqMessageSideEffect(input: {
  attemptCount?: number;
  chatId?: string;
  effectId?: unknown;
  inviteId: string | null;
  lastAttemptAt?: unknown;
  lastError?: unknown;
  message?: unknown;
  messageId?: string | null;
  replyToMessageId?: unknown;
  sentAt?: unknown;
  sourceEventId?: string;
  status: "pending" | "sent" | "sent_unconfirmed";
}) {
  return {
    attemptCount: input.attemptCount ?? 0,
    effectId: input.effectId ?? `linq-message:${input.sourceEventId ?? "evt_123"}`,
    kind: "linq_message_send",
    lastAttemptAt: input.lastAttemptAt ?? null,
    lastError: input.lastError ?? null,
    payload: {
      chatId: input.chatId ?? "chat_123",
      inviteId: input.inviteId,
      message: input.message ?? expect.any(String),
      replyToMessageId: input.replyToMessageId ?? "msg_123",
    },
    result:
      input.status === "pending"
        ? null
        : {
            chatId: input.chatId ?? "chat_123",
            messageId: input.messageId ?? "out_msg_123",
          },
    sentAt:
      input.sentAt ??
      (input.status === "pending" ? null : "2026-03-26T12:00:01.000Z"),
    status: input.status,
  };
}

function withPrismaTransaction<T extends Record<string, unknown>>(prisma: T): T {
  const prismaWithTransaction = prisma as T & {
    $transaction: (callback: (tx: T) => Promise<unknown>) => Promise<unknown>;
    hostedMember?: {
      update?: ReturnType<typeof vi.fn>;
      updateMany?: ReturnType<typeof vi.fn>;
    };
  };
  if (
    prismaWithTransaction.hostedMember &&
    !prismaWithTransaction.hostedMember.updateMany &&
    prismaWithTransaction.hostedMember.update
  ) {
    prismaWithTransaction.hostedMember.updateMany = vi.fn(async (input: { data: Record<string, unknown> }) => {
      const update = prismaWithTransaction.hostedMember?.update as
        | ((input: { data: Record<string, unknown> }) => Promise<unknown>)
        | undefined;

      if (update) {
        await update(input);
      }

      return { count: 1 };
    });
  }
  prismaWithTransaction.$transaction = async (callback) => callback(prismaWithTransaction);
  return prismaWithTransaction;
}
