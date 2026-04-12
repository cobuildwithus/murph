import {
  HostedBillingStatus,
  Prisma,
} from "@prisma/client";
import type { HostedExecutionDispatchRequest } from "@murphai/hosted-execution";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHostedLinqChatLookupKey,
  createHostedOpaqueIdentifier,
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";

const mocks = vi.hoisted(() => {
  const stripeConstructEvent = vi.fn();
  const stripeChargesRetrieve = vi.fn();
  const stripePaymentIntentsRetrieve = vi.fn();

  return {
    claimHostedLinqOnboardingLinkNotice: vi.fn(),
    claimHostedLinqQuotaReplyNotice: vi.fn(),
    deleteHostedStoredDispatchPayloadBestEffort: vi.fn(),
    drainHostedExecutionOutboxBestEffort: vi.fn(),
    drainHostedRevnetIssuanceSubmissionQueue: vi.fn(),
    enqueueHostedExecutionOutbox: vi.fn(),
    incrementHostedLinqInboundDailyState: vi.fn(),
    incrementHostedLinqOutboundDailyState: vi.fn(),
    isHostedRevnetBroadcastStatusUnknownError: vi.fn(),
    isHostedOnboardingRevnetEnabled: vi.fn(),
    maybeStageHostedExecutionDispatchPayload: vi.fn(),
    normalizeHostedWalletAddress: vi.fn((value: string | null | undefined) => value ?? null),
    requireHostedRevnetConfig: vi.fn(),
    reconcileHostedStripeEventById: vi.fn(),
    recordHostedStripeEvent: vi.fn(),
    sendHostedLinqChatMessage: vi.fn(),
    submitHostedRevnetPayment: vi.fn(),
    stagedDispatches: new Map<string, HostedExecutionDispatchRequest>(),
    stripeChargesRetrieve,
    stripeConstructEvent,
    stripePaymentIntentsRetrieve,
  };
});

vi.mock("@/src/lib/hosted-execution/outbox", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-execution/outbox")>(
    "@/src/lib/hosted-execution/outbox",
  );

  return {
    ...actual,
    drainHostedExecutionOutboxBestEffort: mocks.drainHostedExecutionOutboxBestEffort,
    enqueueHostedExecutionOutbox: mocks.enqueueHostedExecutionOutbox,
    enqueueHostedExecutionOutboxPayload: (input: {
      payload: {
        dispatch?: HostedExecutionDispatchRequest;
        dispatchRef?: {
          eventId: string;
        };
      };
      sourceId: string;
      sourceType: string;
      tx: unknown;
    }) => mocks.enqueueHostedExecutionOutbox({
      dispatch:
        input.payload.dispatch
        ?? (input.payload.dispatchRef
          ? mocks.stagedDispatches.get(input.payload.dispatchRef.eventId)
          : undefined),
      sourceId: input.sourceId,
      sourceType: input.sourceType,
      tx: input.tx,
    }),
  };
});

vi.mock("@/src/lib/hosted-execution/control", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-execution/control")>(
    "@/src/lib/hosted-execution/control",
  );

  return {
    ...actual,
    deleteHostedStoredDispatchPayloadBestEffort: mocks.deleteHostedStoredDispatchPayloadBestEffort,
    maybeStageHostedExecutionDispatchPayload: mocks.maybeStageHostedExecutionDispatchPayload,
  };
});

vi.mock("@/src/lib/hosted-onboarding/linq-daily-state", () => ({
  claimHostedLinqOnboardingLinkNotice: mocks.claimHostedLinqOnboardingLinkNotice,
  claimHostedLinqQuotaReplyNotice: mocks.claimHostedLinqQuotaReplyNotice,
  incrementHostedLinqInboundDailyState: mocks.incrementHostedLinqInboundDailyState,
  incrementHostedLinqOutboundDailyState: mocks.incrementHostedLinqOutboundDailyState,
  resolveHostedLinqDayUtc: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-event-reconciliation", () => ({
  reconcileHostedStripeEventById: mocks.reconcileHostedStripeEventById,
  recordHostedStripeEvent: mocks.recordHostedStripeEvent,
}));

vi.mock("@/src/lib/hosted-onboarding/stripe-revnet-issuance", () => ({
  drainHostedRevnetIssuanceSubmissionQueue: mocks.drainHostedRevnetIssuanceSubmissionQueue,
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
    inviteTtlHours: 24,
    isProduction: false,
    linqApiBaseUrl: "https://linq.example.test",
    linqApiToken: "linq-token",
    linqWebhookSecret: null,
    linqWebhookTimestampToleranceMs: 5 * 60_000,
    publicBaseUrl: "https://join.example.test",
    revnetChainId: null,
    revnetProjectId: null,
    revnetRpcUrl: null,
    revnetStripeCurrency: null,
    revnetTerminalAddress: null,
    revnetTreasuryPrivateKey: null,
    revnetWeiPerStripeMinorUnit: null,
    stripeBillingMode: "payment",
    stripePriceId: "price_123",
    stripeSecretKey: "sk_test_123",
    stripeWebhookSecret: "whsec_123",
    telegramBotUsername: null,
    telegramWebhookSecret: null,
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

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: vi.fn(() => {
    throw new Error("Unexpected getPrisma call in hosted-onboarding-webhook-idempotency.test.ts");
  }),
}));

import {
  handleHostedOnboardingLinqWebhook,
  handleHostedStripeWebhook,
} from "@/src/lib/hosted-onboarding/webhook-service";
import {
  buildHostedInviteReply,
} from "@/src/lib/hosted-onboarding/linq";

type HostedWebhookPrisma = Parameters<typeof handleHostedOnboardingLinqWebhook>[0]["prisma"];

describe("hosted onboarding webhook retry safety", () => {
  beforeEach(() => {
    mocks.stagedDispatches.clear();
    mocks.claimHostedLinqOnboardingLinkNotice.mockReset();
    mocks.claimHostedLinqQuotaReplyNotice.mockReset();
    mocks.drainHostedExecutionOutboxBestEffort.mockReset();
    mocks.drainHostedRevnetIssuanceSubmissionQueue.mockReset();
    mocks.enqueueHostedExecutionOutbox.mockReset();
    mocks.incrementHostedLinqInboundDailyState.mockReset();
    mocks.incrementHostedLinqOutboundDailyState.mockReset();
    mocks.isHostedRevnetBroadcastStatusUnknownError.mockReset();
    mocks.isHostedOnboardingRevnetEnabled.mockReset();
    mocks.maybeStageHostedExecutionDispatchPayload.mockReset();
    mocks.normalizeHostedWalletAddress.mockReset();
    mocks.recordHostedStripeEvent.mockReset();
    mocks.requireHostedRevnetConfig.mockReset();
    mocks.reconcileHostedStripeEventById.mockReset();
    mocks.sendHostedLinqChatMessage.mockReset();
    mocks.submitHostedRevnetPayment.mockReset();
    mocks.stripeChargesRetrieve.mockReset();
    mocks.stripeConstructEvent.mockReset();
    mocks.stripePaymentIntentsRetrieve.mockReset();
    mocks.drainHostedExecutionOutboxBestEffort.mockResolvedValue(undefined);
    mocks.drainHostedRevnetIssuanceSubmissionQueue.mockResolvedValue([]);
    mocks.enqueueHostedExecutionOutbox.mockResolvedValue(undefined);
    mocks.claimHostedLinqOnboardingLinkNotice.mockResolvedValue(true);
    mocks.claimHostedLinqQuotaReplyNotice.mockResolvedValue(true);
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValue(makeHostedLinqDailyState());
    mocks.incrementHostedLinqOutboundDailyState.mockResolvedValue(makeHostedLinqDailyState({
      outboundCount: 1,
    }));
    mocks.maybeStageHostedExecutionDispatchPayload.mockImplementation(
      async (dispatch: HostedExecutionDispatchRequest) => {
        mocks.stagedDispatches.set(dispatch.eventId, dispatch);
        return createStagedPayload(dispatch);
      },
    );
    mocks.isHostedRevnetBroadcastStatusUnknownError.mockImplementation((error: unknown) =>
      String(error instanceof Error ? error.message : error).toLowerCase().includes("already known"),
    );
    mocks.isHostedOnboardingRevnetEnabled.mockReturnValue(false);
    mocks.normalizeHostedWalletAddress.mockImplementation((value: string | null | undefined) => value ?? null);
    mocks.recordHostedStripeEvent.mockImplementation(async (input: { event: { type: string } }) => ({
      duplicate: false,
      type: input.event.type,
    }));
    mocks.reconcileHostedStripeEventById.mockResolvedValue(null);
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
    const prisma = withPrismaTransaction({
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

    if (reason === "own-message") {
      expect(prisma.hostedMember.findUnique).toHaveBeenCalledTimes(1);
      expect(mocks.incrementHostedLinqOutboundDailyState).not.toHaveBeenCalled();
    } else {
      expect(prisma.hostedMember.findUnique).not.toHaveBeenCalled();
    }
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("sends the signup link immediately for an existing inactive member", async () => {
    const invite = makePendingInvite({
      inviteCode: "code_returning_member",
      sentAt: null,
    });
    const prisma = withPrismaTransaction({
      hostedBillingCheckout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({
          ...invite,
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
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
          phoneLookupKey: "+15551234567",
        }),
        update: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          linqChatId: "chat_123",
          phoneLookupKey: "+15551234567",
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
      inviteCode: "code_returning_member",
      joinUrl: "https://join.example.test/join/code_returning_member",
      ok: true,
      reason: "sent-signup-link",
    });

    const receiptCalls = readMockCallPayloads(prisma.hostedWebhookReceipt.updateMany.mock.calls);
    expect(receiptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          attemptCount: 1,
          attemptId: expect.any(String),
          completedAt: expect.any(Date),
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorName: null,
          lastErrorRetryable: null,
          lastReceivedAt: expect.any(Date),
          plannedAt: expect.any(Date),
          status: "completed",
        }),
      }),
    );
    expect(readHostedWebhookSideEffectUpsertCalls(prisma)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          create: expect.objectContaining({
            attemptCount: 1,
            linqChatId: "chat_123",
            linqInviteId: "invite_123",
            linqReplyToMessageId: "msg_123",
            linqTemplate: "invite_signup",
            status: "pending",
          }),
        }),
      ]),
    );
    expect(prisma.hostedMember.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.hostedInvite.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.hostedMember.create).not.toHaveBeenCalled();
    expect(prisma.hostedMemberRouting.upsert).toHaveBeenCalledWith({
      create: expect.objectContaining({
        linqChatIdEncrypted: null,
        linqChatLookupKey: null,
        linqRecipientPhoneEncrypted: null,
        linqRecipientPhoneLookupKey: null,
        memberId: "member_123",
        pendingLinqChatIdEncrypted: expect.stringMatching(/^hbds:/u),
        pendingLinqChatLookupKey: createHostedLinqChatLookupKey("chat_123"),
        pendingLinqRecipientPhoneEncrypted: expect.stringMatching(/^hbds:/u),
        pendingLinqRecipientPhoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
        telegramUserIdEncrypted: null,
        telegramUserLookupKey: null,
      }),
      update: expect.objectContaining({
        pendingLinqChatIdEncrypted: expect.stringMatching(/^hbds:/u),
        pendingLinqChatLookupKey: createHostedLinqChatLookupKey("chat_123"),
        pendingLinqRecipientPhoneEncrypted: expect.stringMatching(/^hbds:/u),
        pendingLinqRecipientPhoneLookupKey: expect.stringMatching(/^hbidx:phone:v1:/u),
      }),
      where: {
        memberId: "member_123",
      },
    });
    expect(prisma.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(prisma.hostedInvite.update).toHaveBeenCalledWith({
      where: {
        id: "invite_123",
      },
      data: {
        sentAt: expect.any(Date),
      },
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: buildHostedInviteReply({
          activeSubscription: false,
          joinUrl: "https://join.example.test/join/code_returning_member",
        }),
        replyToMessageId: "msg_123",
      }),
    );
  });

  it("sends the signup link on the first inbound message for a new member", async () => {
    const invite = makePendingInvite({
      inviteCode: "code_first_contact",
      sentAt: null,
    });
    const prisma = withPrismaTransaction({
      hostedBillingCheckout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn().mockResolvedValue(invite),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue(invite),
        update: vi.fn().mockResolvedValue({
          ...invite,
          sentAt: new Date("2026-03-26T12:00:01.000Z"),
        }),
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
          phoneLookupKey: "+15551234567",
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
      inviteCode: "code_first_contact",
      joinUrl: "https://join.example.test/join/code_first_contact",
      ok: true,
      reason: "sent-signup-link",
    });

    const receiptCalls = readMockCallPayloads(prisma.hostedWebhookReceipt.updateMany.mock.calls);
    expect(receiptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          attemptCount: 1,
          attemptId: expect.any(String),
          completedAt: expect.any(Date),
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorName: null,
          lastErrorRetryable: null,
          lastReceivedAt: expect.any(Date),
          plannedAt: expect.any(Date),
          status: "completed",
        }),
      }),
    );
    expect(readHostedWebhookSideEffectUpsertCalls(prisma)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          create: expect.objectContaining({
            attemptCount: 1,
            linqChatId: "chat_123",
            linqInviteId: "invite_123",
            linqReplyToMessageId: "msg_123",
            linqTemplate: "invite_signup",
            status: "pending",
          }),
        }),
      ]),
    );
    expect(prisma.hostedInvite.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.hostedInvite.create).toHaveBeenCalledTimes(1);
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
          joinUrl: "https://join.example.test/join/code_first_contact",
        }),
        replyToMessageId: "msg_123",
      }),
    );
  });

  it("suppresses same-day follow-up replies after the signup link was already sent", async () => {
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValueOnce(makeHostedLinqDailyState({
      inboundCount: 2,
      onboardingLinkSentAt: new Date("2026-03-26T12:00:01.000Z"),
    }));
    const prisma = withPrismaTransaction({
      hostedBillingCheckout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
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
          phoneLookupKey: "+15551234567",
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
      ignored: true,
      ok: true,
      reason: "signup-link-already-sent",
    });

    const receiptCalls = readMockCallPayloads(prisma.hostedWebhookReceipt.updateMany.mock.calls);
    expect(receiptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          attemptCount: 1,
          attemptId: expect.any(String),
          completedAt: expect.any(Date),
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorName: null,
          lastErrorRetryable: null,
          lastReceivedAt: expect.any(Date),
          plannedAt: expect.any(Date),
          status: "completed",
        }),
      }),
    );
    expect(prisma.hostedInvite.create).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.update).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
  });

  it("resends the signup link on a later UTC day while the member is still inactive", async () => {
    const sentInvite = makePendingInvite({
      inviteCode: "code_repeat_link",
      sentAt: new Date("2026-03-26T12:05:00.000Z"),
    });
    mocks.incrementHostedLinqInboundDailyState.mockResolvedValueOnce(makeHostedLinqDailyState({
      dayUtc: new Date("2026-03-27T00:00:00.000Z"),
      inboundCount: 1,
      onboardingLinkSentAt: null,
    }));
    const prisma = withPrismaTransaction({
      hostedBillingCheckout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(sentInvite),
        findUnique: vi.fn().mockResolvedValue(sentInvite),
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
          phoneLookupKey: "+15551234567",
        }),
        update: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          linqChatId: "chat_123",
          phoneLookupKey: "+15551234567",
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

    expect(prisma.hostedInvite.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.hostedInvite.update).toHaveBeenNthCalledWith(1, {
      where: {
        id: "invite_123",
      },
      data: {
        channel: "linq",
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

  it("reuses an unsent non-Linq invite by switching it onto Linq and sending the signup link", async () => {
    const pendingWebInvite = makePendingInvite({
      channel: "web",
      inviteCode: "code_from_web",
      sentAt: null,
    });
    const prisma = withPrismaTransaction({
      hostedBillingCheckout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(pendingWebInvite),
        findUnique: vi.fn().mockResolvedValue(pendingWebInvite),
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
          phoneLookupKey: "+15551234567",
        }),
        update: vi.fn().mockResolvedValue({
          billingStatus: HostedBillingStatus.not_started,
          id: "member_123",
          linqChatId: "chat_123",
          phoneLookupKey: "+15551234567",
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
      inviteCode: "code_from_web",
      joinUrl: "https://join.example.test/join/code_from_web",
      ok: true,
      reason: "sent-signup-link",
    });

    expect(prisma.hostedInvite.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.hostedInvite.update).toHaveBeenCalledWith({
      where: {
        id: "invite_123",
      },
      data: {
        channel: "linq",
      },
    });
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "chat_123",
        message: buildHostedInviteReply({
          activeSubscription: false,
          joinUrl: "https://join.example.test/join/code_from_web",
        }),
        replyToMessageId: "msg_123",
      }),
    );
  });

  it("completes a Linq active-member webhook after the dispatch is durably queued", async () => {
    const prisma = withPrismaTransaction({
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

    const receiptCalls = readMockCallPayloads(prisma.hostedWebhookReceipt.updateMany.mock.calls);
    expect(receiptCalls).toHaveLength(4);
    expect(receiptCalls[0]?.data).toEqual(
      expect.objectContaining({
        attemptCount: 1,
        attemptId: expect.any(String),
        completedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        lastErrorName: null,
        lastErrorRetryable: null,
        lastReceivedAt: expect.any(Date),
        plannedAt: expect.any(Date),
        status: "processing",
      }),
    );
    expect(receiptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          attemptCount: 1,
          attemptId: expect.any(String),
          completedAt: expect.any(Date),
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorName: null,
          lastErrorRetryable: null,
          lastReceivedAt: expect.any(Date),
          plannedAt: expect.any(Date),
          status: "completed",
        }),
      }),
    );
    expect(readHostedWebhookSideEffectUpsertCalls(prisma)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          create: expect.objectContaining({
            attemptCount: 1,
            dispatchPayloadJson: expect.objectContaining({
              dispatchRef: expect.objectContaining({
                eventId: "evt_123",
                eventKind: "linq.message.received",
                userId: "member_123",
              }),
              stagedPayloadId: expect.stringContaining("/member_123/evt_123.json"),
            }),
            kind: "hosted_execution_dispatch",
            status: "pending",
          }),
        }),
      ]),
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
    expect(mocks.drainHostedExecutionOutboxBestEffort).toHaveBeenCalledWith({
      eventIds: [
        "evt_123",
      ],
      limit: 1,
      prisma,
    });
  });

  it("processes Stripe events inline and immediately drains activation side effects", async () => {
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
    mocks.recordHostedStripeEvent.mockResolvedValue({
      duplicate: false,
      type: "invoice.paid",
    });
    mocks.reconcileHostedStripeEventById.mockResolvedValue({
      activatedMemberId: "member_123",
      createdOrUpdatedRevnetIssuance: false,
      eventId: "evt_stripe_123",
      hostedExecutionEventId: "member.activated:stripe.invoice.paid:member_123:evt_stripe_123",
      status: "completed",
    });

    const prisma = withPrismaTransaction({});

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

    expect(mocks.recordHostedStripeEvent).toHaveBeenCalledWith({
      event: expect.objectContaining({
        id: "evt_stripe_123",
        type: "invoice.paid",
      }),
      prisma,
    });
    expect(mocks.reconcileHostedStripeEventById).toHaveBeenCalledWith({
      eventId: "evt_stripe_123",
      prisma,
    });
    expect(mocks.drainHostedExecutionOutboxBestEffort).toHaveBeenCalledWith({
      eventIds: [
        "member.activated:stripe.invoice.paid:member_123:evt_stripe_123",
      ],
      limit: 1,
      prisma,
    });
    expect(mocks.drainHostedRevnetIssuanceSubmissionQueue).not.toHaveBeenCalled();
  });

  it("best-effort drains RevNet submissions when inline reconciliation queues one", async () => {
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
      id: "evt_stripe_revnet_123",
      type: "invoice.paid",
    });
    mocks.recordHostedStripeEvent.mockResolvedValue({
      duplicate: false,
      type: "invoice.paid",
    });
    mocks.reconcileHostedStripeEventById.mockResolvedValue({
      activatedMemberId: null,
      createdOrUpdatedRevnetIssuance: true,
      eventId: "evt_stripe_revnet_123",
      hostedExecutionEventId: null,
      status: "completed",
    });

    const prisma = withPrismaTransaction({});

    await expect(
      handleHostedStripeWebhook({
        prisma,
        rawBody: JSON.stringify({ id: "evt_stripe_revnet_123" }),
        signature: "sig_123",
      }),
    ).resolves.toMatchObject({
      ok: true,
      type: "invoice.paid",
    });

    expect(mocks.drainHostedRevnetIssuanceSubmissionQueue).toHaveBeenCalledWith({
      limit: 1,
      prisma,
    });
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
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

    mocks.recordHostedStripeEvent.mockResolvedValue({
      duplicate: true,
      type: "invoice.paid",
    });
    const prisma = withPrismaTransaction({});

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

    expect(mocks.reconcileHostedStripeEventById).not.toHaveBeenCalled();
    expect(mocks.drainHostedRevnetIssuanceSubmissionQueue).not.toHaveBeenCalled();
    expect(mocks.drainHostedExecutionOutboxBestEffort).not.toHaveBeenCalled();
  });

  it("replans a failed active-member dispatch after durable handoff and relies on outbox idempotency", async () => {
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
    const prisma = withPrismaTransaction({
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

    const receiptCalls = readMockCallPayloads(prisma.hostedWebhookReceipt.updateMany.mock.calls);
    expect(receiptCalls[0]).toEqual(
      expect.objectContaining({
        where: {
          eventId: "evt_123",
          source: "linq",
          version: 1,
        },
        data: expect.objectContaining({
          attemptCount: 2,
          attemptId: expect.any(String),
          completedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorName: null,
          lastErrorRetryable: null,
          lastReceivedAt: expect.any(Date),
          plannedAt: null,
          status: "processing",
          version: {
            increment: 1,
          },
        }),
      }),
    );
    expect(receiptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          attemptCount: 2,
          attemptId: expect.any(String),
          completedAt: expect.any(Date),
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorName: null,
          lastErrorRetryable: null,
          lastReceivedAt: expect.any(Date),
          plannedAt: expect.any(Date),
          status: "completed",
        }),
        where: expect.objectContaining({
          eventId: "evt_123",
          source: "linq",
          version: expect.any(Number),
        }),
      }),
    );
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatch: expect.objectContaining({
          eventId: "evt_123",
        }),
        sourceId: "linq:evt_123",
        sourceType: "hosted_webhook_receipt",
      }),
    );
    expect(mocks.drainHostedExecutionOutboxBestEffort).toHaveBeenCalledWith({
      eventIds: [
        "evt_123",
      ],
      limit: 1,
      prisma,
    });
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
    const prisma = withPrismaTransaction({
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

    const receiptCalls = readMockCallPayloads(prisma.hostedWebhookReceipt.updateMany.mock.calls);
    const dispatchQueueCalls = receiptCalls.slice(2, 5);
    expect(dispatchQueueCalls).toHaveLength(3);
    for (const call of dispatchQueueCalls) {
      expect(call).toEqual(
        expect.objectContaining({
          where: expect.objectContaining({
            eventId: "evt_123",
            source: "linq",
            version: expect.any(Number),
          }),
          data: expect.objectContaining({
            attemptCount: 1,
            attemptId: expect.any(String),
            completedAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            lastErrorName: null,
            lastErrorRetryable: null,
            version: {
              increment: 1,
            },
          }),
        }),
      );
    }
    expect(prisma.hostedWebhookReceipt.findUnique).toHaveBeenCalledTimes(3);
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(prisma.hostedMember.findUnique).toHaveBeenCalledTimes(2);
    expect(receiptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          completedAt: null,
          lastErrorCode: "WEBHOOK_RECEIPT_UPDATE_FAILED",
          lastErrorName: "HostedOnboardingError",
          lastErrorRetryable: true,
          plannedAt: null,
          status: "failed",
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
      id: "member_123",
      invites: [],
      linqChatId: "chat_123",
      phoneLookupKey: "+15551234567",
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
      memberId: "member_123",
      sentAt: null,
      status: "pending",
      updatedAt: new Date("2026-03-26T12:00:00.000Z"),
    };
    const receiptStore = createInMemoryHostedWebhookReceiptStore();
    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: receiptStore.hostedWebhookReceipt,
      hostedWebhookReceiptSideEffect: receiptStore.hostedWebhookReceiptSideEffect,
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
        findUnique: vi.fn().mockResolvedValue(invite),
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
          text: "hello",
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

    const firstAttemptCalls = readMockCallPayloads(prisma.hostedWebhookReceipt.updateMany.mock.calls);
    expect(firstAttemptCalls).toHaveLength(5);
    expect(firstAttemptCalls[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          attemptCount: 1,
          attemptId: expect.any(String),
          completedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorName: null,
          lastErrorRetryable: null,
          lastReceivedAt: expect.any(Date),
          plannedAt: expect.any(Date),
          status: "processing",
        }),
      }),
    );
    expect(firstAttemptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          attemptCount: 1,
          attemptId: expect.any(String),
          completedAt: null,
          lastErrorCode: null,
          lastErrorMessage: "[redacted]",
          lastErrorName: "HostedOnboardingError",
          lastErrorRetryable: null,
          lastReceivedAt: expect.any(Date),
          plannedAt: expect.any(Date),
          status: "failed",
        }),
      }),
    );

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
      duplicate: true,
      ok: true,
    });

    const secondAttemptCalls = prisma.hostedWebhookReceipt.updateMany.mock.calls
      .slice(firstAttemptCalls.length)
      .map((call) => ((call[0] as Record<string, unknown> | undefined) ?? {}));
    expect(secondAttemptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          attemptCount: 2,
          attemptId: expect.any(String),
          completedAt: expect.any(Date),
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorName: null,
          lastErrorRetryable: null,
          lastReceivedAt: expect.any(Date),
          plannedAt: expect.any(Date),
          status: "completed",
        }),
      }),
    );
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(2);
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: buildHostedInviteReply({
          activeSubscription: false,
          joinUrl: "https://join.example.test/join/join_123",
        }),
        replyToMessageId: "msg_123",
      }),
    );
    expect(prisma.hostedInvite.create).toHaveBeenCalledTimes(1);
    expect(prisma.hostedInvite.update).toHaveBeenCalledWith({
      where: {
        id: "invite_123",
      },
      data: {
        sentAt: expect.any(Date),
      },
    });
  });

  it("retries the Linq invite reply when reclaiming a failed receipt without a durable side-effect row", async () => {
    const member = {
      billingStatus: HostedBillingStatus.not_started,
      id: "member_123",
      invites: [],
      linqChatId: "chat_123",
      phoneLookupKey: "+15551234567",
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
      memberId: "member_123",
      sentAt: new Date("2026-03-26T12:00:00.400Z"),
      status: "pending",
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
          sentAt: "2026-03-26T12:00:00.400Z",
          status: "sent",
          template: "invite_signup",
        }),
      ],
      status: "failed",
    });
    const prisma = withPrismaTransaction({
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
    ).resolves.toEqual({
      inviteCode: "join_123",
      joinUrl: "https://join.example.test/join/join_123",
      ok: true,
      reason: "sent-signup-link",
    });

    const receiptCalls = readMockCallPayloads(prisma.hostedWebhookReceipt.updateMany.mock.calls);
    expect(receiptCalls[0]).toEqual(
      expect.objectContaining({
        where: {
          eventId: "evt_123",
          source: "linq",
          version: 1,
        },
        data: expect.objectContaining({
          attemptCount: 2,
          attemptId: expect.any(String),
          completedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorName: null,
          lastErrorRetryable: null,
          lastReceivedAt: expect.any(Date),
          plannedAt: null,
          status: "processing",
        }),
      }),
    );
    expect(mocks.sendHostedLinqChatMessage).toHaveBeenCalledTimes(1);
    expect(prisma.hostedInvite.create).not.toHaveBeenCalled();
  });

  it("treats completed Linq receipts as duplicates without redispatching the event", async () => {
    const prisma = asHostedWebhookPrisma({
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
    });

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
      id: "member_123",
      invites: [],
      linqChatId: "chat_123",
      phoneLookupKey: "+15551234567",
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
      memberId: "member_123",
      sentAt: null,
      status: "pending",
      updatedAt: new Date("2026-03-26T12:00:00.000Z"),
    };
    const receiptStore = createInMemoryHostedWebhookReceiptStore();
    let failSentWriteOnce = true;
    const baseDeleteMany = receiptStore.hostedWebhookReceiptSideEffect.deleteMany;
    receiptStore.hostedWebhookReceiptSideEffect.deleteMany = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (failSentWriteOnce && !("effectId" in where)) {
        failSentWriteOnce = false;
        throw new Error("Receipt persistence failed after the Linq send.");
      }

      return baseDeleteMany({ where });
    });

    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: receiptStore.hostedWebhookReceipt,
      hostedWebhookReceiptSideEffect: receiptStore.hostedWebhookReceiptSideEffect,
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
    expect(receiptStore.readStoredReceipt()).toEqual(
      expect.objectContaining({
        attemptCount: 1,
        completedAt: null,
        lastErrorCode: "hosted_webhook_side_effect_delivery_uncertain",
        lastErrorMessage: "[redacted]",
        lastErrorName: "HostedOnboardingError",
        lastErrorRetryable: false,
        plannedAt: expect.any(Date),
        sideEffects: [
          expect.objectContaining({
            attemptCount: 1,
            linqChatId: "chat_123",
            linqInviteId: "invite_123",
            linqReplyToMessageId: "msg_123",
            linqResultChatId: "chat_123",
            linqResultMessageId: "out_msg_123",
            linqTemplate: "invite_signup",
            lastErrorMessage: "[redacted]",
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
    expect(receiptStore.readStoredReceipt()).toEqual(
      expect.objectContaining({
        attemptCount: 1,
        completedAt: null,
        lastErrorCode: "hosted_webhook_side_effect_delivery_uncertain",
        lastErrorMessage: "[redacted]",
        lastErrorName: "HostedOnboardingError",
        lastErrorRetryable: false,
        plannedAt: expect.any(Date),
        sideEffects: [
          expect.objectContaining({
            attemptCount: 1,
            linqChatId: "chat_123",
            linqInviteId: "invite_123",
            linqReplyToMessageId: "msg_123",
            linqResultChatId: "chat_123",
            linqResultMessageId: "out_msg_123",
            linqTemplate: "invite_signup",
            lastErrorMessage: "[redacted]",
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
      id: "member_123",
      invites: [],
      linqChatId: "chat_123",
      phoneLookupKey: "+15551234567",
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
      memberId: "member_123",
      sentAt: null,
      status: "pending",
      updatedAt: new Date("2026-03-26T12:00:00.000Z"),
    };
    const receiptStore = createInMemoryHostedWebhookReceiptStore();
    let failSentWriteOnce = true;
    const baseDeleteMany = receiptStore.hostedWebhookReceiptSideEffect.deleteMany;
    const baseUpsert = receiptStore.hostedWebhookReceiptSideEffect.upsert;
    receiptStore.hostedWebhookReceiptSideEffect.deleteMany = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if (failSentWriteOnce && !("effectId" in where)) {
        failSentWriteOnce = false;
        throw new Error("Receipt persistence failed after the Linq send.");
      }

      return baseDeleteMany({ where });
    });
    receiptStore.hostedWebhookReceiptSideEffect.upsert = vi.fn(async (input: {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
      where: {
        source_eventId_effectId: {
          effectId: string;
          eventId: string;
          source: string;
        };
      };
    }) => {
      if (input.create.status === "sent_unconfirmed" || input.update.status === "sent_unconfirmed") {
        throw new Error("Receipt persistence failed while recording sent_unconfirmed.");
      }

      return baseUpsert(input);
    });

    const prisma = withPrismaTransaction({
      hostedWebhookReceipt: receiptStore.hostedWebhookReceipt,
      hostedWebhookReceiptSideEffect: receiptStore.hostedWebhookReceiptSideEffect,
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
    expect(receiptStore.readStoredReceipt()).toEqual(
      expect.objectContaining({
        attemptCount: 1,
        completedAt: null,
        lastErrorCode: "hosted_webhook_side_effect_delivery_uncertain",
        lastErrorMessage: "[redacted]",
        lastErrorName: "HostedOnboardingError",
        lastErrorRetryable: false,
        plannedAt: expect.any(Date),
        sideEffects: [],
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
    expect(receiptStore.readStoredReceipt()).toEqual(
      expect.objectContaining({
        attemptCount: 1,
        completedAt: null,
        lastErrorCode: "hosted_webhook_side_effect_delivery_uncertain",
        lastErrorMessage: "[redacted]",
        lastErrorName: "HostedOnboardingError",
        lastErrorRetryable: false,
        plannedAt: expect.any(Date),
        sideEffects: [],
        status: "failed",
      }),
    );
  });

  it("surfaces in-flight processing Linq receipts as retryable errors without redispatching the event", async () => {
    const prisma = asHostedWebhookPrisma({
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
    });

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody(),
        signature: null,
        timestamp: null,
      }),
    ).rejects.toMatchObject({
      code: "WEBHOOK_RECEIPT_IN_PROGRESS",
      httpStatus: 503,
      retryable: true,
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
    const prisma = asHostedWebhookPrisma({
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

    const receiptCalls = readMockCallPayloads(prisma.hostedWebhookReceipt.updateMany.mock.calls);
    expect(receiptCalls[0]).toEqual(
      expect.objectContaining({
        where: {
          eventId: "evt_123",
          source: "linq",
          version: 1,
        },
        data: expect.objectContaining({
          attemptCount: 2,
          attemptId: expect.any(String),
          completedAt: null,
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorName: null,
          lastErrorRetryable: null,
          lastReceivedAt: expect.any(Date),
          plannedAt: null,
          status: "processing",
        }),
      }),
    );
    expect(receiptCalls.at(-1)).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          attemptCount: 2,
          attemptId: expect.any(String),
          completedAt: expect.any(Date),
          lastErrorCode: null,
          lastErrorMessage: null,
          lastErrorName: null,
          lastErrorRetryable: null,
          lastReceivedAt: expect.any(Date),
          plannedAt: expect.any(Date),
          status: "completed",
        }),
      }),
    );
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledTimes(1);
    expect(mocks.drainHostedExecutionOutboxBestEffort).toHaveBeenCalledWith({
      eventIds: [
        "evt_123",
      ],
      limit: 1,
      prisma,
    });
  });

  it("fails reclaiming malformed Linq receipts after three stale compare-and-swap misses", async () => {
    const malformedReceiptPayload = {
      receiptState: {
        attemptCount: "bad",
        status: 42,
      },
      strayLegacyField: "keep-me-if-possible",
    };
    const prisma = asHostedWebhookPrisma({
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
    });

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

    const reclaimCalls = readMockCallPayloads(prisma.hostedWebhookReceipt.updateMany.mock.calls);
    expect(reclaimCalls).toHaveLength(3);
    for (const call of reclaimCalls) {
      expect(call).toEqual(
        expect.objectContaining({
          where: {
            eventId: "evt_123",
            source: "linq",
            version: 1,
          },
          data: expect.objectContaining({
            attemptCount: 2,
            attemptId: expect.any(String),
            completedAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            lastErrorName: null,
            lastErrorRetryable: null,
            lastReceivedAt: expect.any(Date),
            plannedAt: null,
            status: "processing",
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
    const prisma = asHostedWebhookPrisma({
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
    });

    await expect(
      handleHostedOnboardingLinqWebhook({
        prisma,
        rawBody: buildLinqMessageWebhookBody(),
        signature: null,
        timestamp: null,
      }),
    ).rejects.toMatchObject({
      code: "WEBHOOK_RECEIPT_IN_PROGRESS",
      httpStatus: 503,
      retryable: true,
    });

    expect(prisma.hostedWebhookReceipt.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.hostedWebhookReceipt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          eventId: "evt_123",
          source: "linq",
          version: 1,
        },
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
    api_version: "v3",
    created_at: "2026-03-26T12:00:00.000Z",
    webhook_version: "2026-02-03",
    data: {
      chat: {
        id: "chat_123",
        owner_handle: {
          handle: "+15550000000",
          id: "handle_owner_123",
          is_me: true,
          service: "sms",
        },
      },
      direction: input.isFromMe ? "outbound" : "inbound",
      id: "msg_123",
      parts: [
        {
          type: "text",
          value: input.text ?? "hello",
        },
      ],
      sender_handle: {
        handle: input.from ?? "+15551234567",
        id: "handle_sender_123",
        service: "sms",
      },
      sent_at: "2026-03-26T12:00:00.000Z",
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
    phoneLookupKey: "+15551234567",
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
    api_version: "v3",
    created_at: occurredAt,
    webhook_version: "2026-02-03",
    data: {
      chat: {
        id: "chat_123",
        owner_handle: {
          handle: createHostedOpaqueIdentifier("linq.recipient", "+15550000000"),
          id: "handle_owner_123",
          is_me: true,
          service: "sms",
        },
      },
      chat_id: "chat_123",
      direction: "inbound",
      from: createHostedOpaqueIdentifier("linq.from", "+15551234567"),
      from_handle: {
        handle: createHostedOpaqueIdentifier("linq.from", "+15551234567"),
        id: "handle_sender_123",
        service: "sms",
      },
      is_from_me: false,
      message: {
        id: createHostedOpaqueIdentifier("linq.message", "msg_123"),
        parts: [
          {
            type: "text",
            value: "hello",
          },
        ],
      },
      recipient_handle: {
        handle: createHostedOpaqueIdentifier("linq.recipient", "+15550000000"),
        id: "handle_owner_123",
        is_me: true,
        service: "sms",
      },
      received_at: "2026-03-26T12:00:00.000Z",
      service: "sms",
      sender_handle: {
        handle: createHostedOpaqueIdentifier("linq.from", "+15551234567"),
        id: "handle_sender_123",
        service: "sms",
      },
      sent_at: "2026-03-26T12:00:00.000Z",
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
    payload: {
      dispatchRef: {
        eventId: input.eventId,
        eventKind: "linq.message.received",
        occurredAt,
        userId: "member_123",
      },
      stagedPayloadId: `transient/dispatch-payloads/member_123/${input.eventId}.json`,
      storage: "reference",
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
  messageId?: string | null;
  replyToMessageId?: unknown;
  sentAt?: unknown;
  sourceEventId?: string;
  status: "pending" | "sent" | "sent_unconfirmed";
  template?: "daily_quota" | "invite_signin" | "invite_signup";
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
      replyToMessageId: input.replyToMessageId ?? "msg_123",
      template: input.template ?? "invite_signup",
    },
    result:
      input.status === "pending"
        ? null
        : {
            chatId: createHostedOpaqueIdentifier("linq.chat", input.chatId ?? "chat_123"),
            messageId: createHostedOpaqueIdentifier("linq.message", input.messageId ?? "out_msg_123"),
          },
    sentAt:
      input.sentAt ??
      (input.status === "pending" ? null : "2026-03-26T12:00:01.000Z"),
    status: input.status,
  };
}

function makeHostedLinqDailyState(input: {
  dayUtc?: Date;
  inboundCount?: number;
  onboardingLinkSentAt?: Date | null;
  outboundCount?: number;
  quotaReplySentAt?: Date | null;
} = {}) {
  return {
    createdAt: new Date("2026-03-26T12:00:00.000Z"),
    dayUtc: input.dayUtc ?? new Date("2026-03-26T00:00:00.000Z"),
    firstSeenAt: new Date("2026-03-26T12:00:00.000Z"),
    inboundCount: input.inboundCount ?? 1,
    lastSeenAt: new Date("2026-03-26T12:00:00.000Z"),
    memberId: "member_123",
    onboardingLinkSentAt: input.onboardingLinkSentAt ?? null,
    outboundCount: input.outboundCount ?? 0,
    quotaReplySentAt: input.quotaReplySentAt ?? null,
    updatedAt: new Date("2026-03-26T12:00:00.000Z"),
  };
}

function asHostedWebhookPrisma<T extends Record<string, unknown>>(prisma: T): T & HostedWebhookPrisma {
  const prismaWithHostedMember = prisma as T & HostedWebhookPrisma & {
    hostedInvite?: {
      findFirst?: ReturnType<typeof vi.fn>;
      findUnique?: ReturnType<typeof vi.fn>;
    };
    hostedMember?: {
      findUnique?: ((input: { where?: Record<string, unknown>; include?: Record<string, unknown> }) => Promise<unknown>) | undefined;
      update?: ReturnType<typeof vi.fn>;
      updateMany?: unknown;
    };
    hostedMemberIdentity?: {
      findFirst?: ReturnType<typeof vi.fn>;
      findUnique?: ReturnType<typeof vi.fn>;
      upsert?: ReturnType<typeof vi.fn>;
    };
    hostedMemberRouting?: {
      findFirst?: ReturnType<typeof vi.fn>;
      findUnique?: ReturnType<typeof vi.fn>;
      updateMany?: ReturnType<typeof vi.fn>;
      upsert?: ReturnType<typeof vi.fn>;
    };
    hostedWebhookReceipt?: {
      findUnique?: ((input: { include?: Record<string, unknown>; where?: Record<string, unknown> }) => Promise<unknown>) | undefined;
    };
    hostedWebhookReceiptSideEffect?: {
      deleteMany?: ReturnType<typeof vi.fn>;
      upsert?: ReturnType<typeof vi.fn>;
    };
  };
  const hostedMember = prismaWithHostedMember.hostedMember as {
    findUnique?: ((input: { where?: Record<string, unknown>; include?: Record<string, unknown> }) => Promise<unknown>) | undefined;
    update?: ((input: { data: Record<string, unknown> }) => Promise<unknown>) | undefined;
    updateMany?: unknown;
  } | undefined;
  const hostedMemberIdentity = prismaWithHostedMember.hostedMemberIdentity as {
    findFirst?: ((input: { include?: Record<string, unknown>; where: Record<string, unknown> }) => Promise<unknown>) | undefined;
    findUnique?: ((input: { include?: Record<string, unknown>; where: Record<string, unknown> }) => Promise<unknown>) | undefined;
    upsert?: ((input: { create: Record<string, unknown>; update: Record<string, unknown> }) => Promise<unknown>) | undefined;
  } | undefined;
  const hostedMemberRouting = prismaWithHostedMember.hostedMemberRouting as {
    findFirst?: ((input: { where: Record<string, unknown> }) => Promise<unknown>) | undefined;
    findUnique?: ((input: { where: Record<string, unknown> }) => Promise<unknown>) | undefined;
    updateMany?: ((input: { data: Record<string, unknown>; where: Record<string, unknown> }) => Promise<unknown>) | undefined;
    upsert?: ((input: { create: Record<string, unknown>; update: Record<string, unknown> }) => Promise<unknown>) | undefined;
  } | undefined;
  const hostedInvite = prismaWithHostedMember.hostedInvite as {
    findFirst?: ((input: { where?: Record<string, unknown>; select?: Record<string, unknown> }) => Promise<unknown>) | undefined;
    findUnique?: ReturnType<typeof vi.fn>;
  } | undefined;
  const hostedWebhookReceipt = prismaWithHostedMember.hostedWebhookReceipt as {
    findUnique?: ((input: { include?: Record<string, unknown>; where?: Record<string, unknown> }) => Promise<unknown>) | undefined;
  } | undefined;
  const hostedWebhookReceiptSideEffect = prismaWithHostedMember.hostedWebhookReceiptSideEffect as {
    deleteMany?: ReturnType<typeof vi.fn>;
    upsert?: ReturnType<typeof vi.fn>;
  } | undefined;

  if (hostedMember && !hostedMember.updateMany) {
    hostedMember.updateMany = vi.fn(async (input: { data: Record<string, unknown> }) => {
      if (hostedMember.update) {
        await hostedMember.update(input);
      }

      return { count: 1 };
    });
  }

  if (!hostedMemberRouting?.upsert) {
    const hostedMemberRoutingFallback = {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn(async (input: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        if (hostedMember?.update) {
          await hostedMember.update({
            data: input.update,
          });
        }

        return input.create;
      }),
    };
    Object.defineProperty(prismaWithHostedMember, "hostedMemberRouting", {
      configurable: true,
      value: hostedMemberRoutingFallback,
    });
  } else if (!hostedMemberRouting.findFirst && hostedMemberRouting.findUnique) {
    hostedMemberRouting.findFirst = hostedMemberRouting.findUnique;
  }

  if (!hostedMemberIdentity?.findUnique) {
    const hostedMemberIdentityFallback = {
      findFirst: vi.fn(async ({ include, where }: { include?: Record<string, unknown>; where: Record<string, unknown> }) => {
        const phoneLookupKey = Array.isArray((where.phoneLookupKey as { in?: unknown[] } | undefined)?.in)
          ? (where.phoneLookupKey as { in: unknown[] }).in[0]
          : undefined;
        const member = await hostedMember?.findUnique?.({
          include,
          where: {
            ...(typeof phoneLookupKey === "string"
              ? {
                  phoneLookupKey,
                }
              : {}),
          },
        });
        const identity = readHostedMemberIdentityFromMockMember(member, phoneLookupKey);

        if (!identity) {
          return null;
        }

        return include?.member ? { ...identity, member } : identity;
      }),
      findUnique: vi.fn(async ({ include, where }: { include?: Record<string, unknown>; where: Record<string, unknown> }) => {
        const member = await hostedMember?.findUnique?.({
          include,
          where,
        });
        const identity = readHostedMemberIdentityFromMockMember(member, where.phoneLookupKey);

        if (!identity) {
          return null;
        }

        return include?.member ? { ...identity, member } : identity;
      }),
      upsert: vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({
        ...create,
        ...update,
      })),
    };
    Object.defineProperty(prismaWithHostedMember, "hostedMemberIdentity", {
      configurable: true,
      value: hostedMemberIdentityFallback,
    });
  } else if (!hostedMemberIdentity.findFirst && hostedMemberIdentity.findUnique) {
    hostedMemberIdentity.findFirst = vi.fn(async ({
      include,
      where,
    }: {
      include?: Record<string, unknown>;
      where: Record<string, unknown>;
    }) => {
      const phoneLookupKey = Array.isArray((where.phoneLookupKey as { in?: unknown[] } | undefined)?.in)
        ? (where.phoneLookupKey as { in: unknown[] }).in[0]
        : undefined;

      return hostedMemberIdentity.findUnique?.({
        include,
        where: {
          ...(typeof phoneLookupKey === "string"
            ? {
                phoneLookupKey,
              }
            : {}),
        },
      });
    });
  }

  if (hostedInvite && !hostedInvite.findUnique && hostedInvite.findFirst) {
    hostedInvite.findUnique = vi.fn(async (input: { where?: Record<string, unknown>; select?: Record<string, unknown> }) =>
      hostedInvite.findFirst?.({
        select: input.select,
        where: input.where,
      }),
    );
  }

  if (hostedWebhookReceipt?.findUnique) {
    const originalFindUnique = hostedWebhookReceipt.findUnique;
    hostedWebhookReceipt.findUnique = vi.fn(async (input: { include?: Record<string, unknown>; where?: Record<string, unknown> }) =>
      normalizeLegacyMockHostedWebhookReceipt(await originalFindUnique(input), input),
    );
  }

  if (!hostedWebhookReceiptSideEffect?.deleteMany || !hostedWebhookReceiptSideEffect?.upsert) {
    Object.defineProperty(prismaWithHostedMember, "hostedWebhookReceiptSideEffect", {
      configurable: true,
      value: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        upsert: vi.fn().mockResolvedValue({}),
      },
    });
  }

  return prismaWithHostedMember;
}

function withPrismaTransaction<T extends Record<string, unknown>>(prisma: T): T & HostedWebhookPrisma {
  const prismaWithTransaction = asHostedWebhookPrisma(prisma) as T & HostedWebhookPrisma & {
    $transaction?: unknown;
  };
  if (!("$queryRaw" in prismaWithTransaction)) {
    Object.defineProperty(prismaWithTransaction, "$queryRaw", {
      configurable: true,
      value: vi.fn(async () => []),
    });
  }
  (prismaWithTransaction as { $transaction?: unknown }).$transaction = (
    async (callback: (tx: T & HostedWebhookPrisma) => Promise<unknown>) => callback(prismaWithTransaction)
  );
  return prismaWithTransaction;
}

function readMockCallPayloads(calls: unknown[][]): Record<string, unknown>[] {
  return calls.map((call) => ((call[0] as Record<string, unknown> | undefined) ?? {}));
}

function readHostedWebhookSideEffectUpsertCalls(
  prisma: object,
): Record<string, unknown>[] {
  const hostedWebhookReceiptSideEffect = (prisma as {
    hostedWebhookReceiptSideEffect?: {
      upsert?: {
        mock?: {
          calls?: unknown[][];
        };
      };
    };
  }).hostedWebhookReceiptSideEffect as {
    upsert?: {
      mock?: {
        calls?: unknown[][];
      };
    };
  } | undefined;

  return readMockCallPayloads(hostedWebhookReceiptSideEffect?.upsert?.mock?.calls ?? []).map((call) => ({
    ...call,
    create: normalizeStoredWebhookSideEffectRecord(call.create),
    update: normalizeStoredWebhookSideEffectRecord(call.update),
  }));
}

function createInMemoryHostedWebhookReceiptStore() {
  let receipt: Record<string, unknown> | null = null;
  let sideEffects: Array<Record<string, unknown>> = [];

  const hostedWebhookReceipt = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (receipt) {
        throw createUniqueConstraintError();
      }

      receipt = {
        ...data,
        claimExpiresAt: data.claimExpiresAt ?? null,
        completedAt: data.completedAt ?? null,
        plannedAt: data.plannedAt ?? null,
        updatedAt: data.updatedAt ?? new Date("2026-03-26T12:00:00.000Z"),
        version: typeof data.version === "number" ? data.version : 1,
      };
      return {};
    }),
    findUnique: vi.fn(async () =>
      receipt
        ? {
            ...receipt,
            sideEffects: sideEffects.map((effect) => ({ ...effect })),
          }
        : null),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (!receipt) {
        return { count: 0 };
      }

      if (typeof where.version === "number" && where.version !== receipt.version) {
        return { count: 0 };
      }

      const versionIncrement =
        data.version && typeof data.version === "object" && "increment" in data.version
          ? Number((data.version as { increment: number }).increment)
          : 0;
      const { version, ...nextData } = data;

      receipt = {
        ...receipt,
        ...nextData,
        updatedAt: new Date("2026-03-26T12:00:00.000Z"),
        version: typeof receipt.version === "number" ? receipt.version + versionIncrement : versionIncrement,
      };

      return { count: 1 };
    }),
  };

  const hostedWebhookReceiptSideEffect = {
    deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const before = sideEffects.length;
      const notIn = Array.isArray((where.effectId as { notIn?: unknown[] } | undefined)?.notIn)
        ? new Set((where.effectId as { notIn: string[] }).notIn)
        : null;

      sideEffects = sideEffects.filter((effect) => {
        if (effect.source !== where.source || effect.eventId !== where.eventId) {
          return true;
        }

        if (!notIn) {
          return false;
        }

        return notIn.has(effect.effectId as string);
      });

      return { count: before - sideEffects.length };
    }),
    upsert: vi.fn(async ({ where, create, update }: {
      where: {
        source_eventId_effectId: {
          effectId: string;
          eventId: string;
          source: string;
        };
      };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => {
      const key = where.source_eventId_effectId;
      const index = sideEffects.findIndex((effect) =>
        effect.source === key.source
        && effect.eventId === key.eventId
        && effect.effectId === key.effectId,
      );

      if (index === -1) {
        sideEffects.push({ ...create });
      } else {
        sideEffects[index] = {
          ...sideEffects[index],
          ...update,
        };
      }

      return {};
    }),
  };

  return {
    hostedWebhookReceipt,
    hostedWebhookReceiptSideEffect,
    readStoredReceipt() {
      return receipt
        ? {
            ...receipt,
            sideEffects: sideEffects.map((effect) => normalizeStoredWebhookSideEffectRecord(effect)),
          }
        : null;
    },
  };
}

function normalizeLegacyMockHostedWebhookReceipt(
  value: unknown,
  input: {
    where?: Record<string, unknown>;
  },
) {
  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;
  const payloadJson = record.payloadJson;
  const normalizedPayload = readLegacyWebhookReceiptPayload(payloadJson);
  const compoundWhere = readCompoundReceiptWhere(input.where);

  if (!normalizedPayload) {
    return {
      ...record,
      attemptCount: typeof record.attemptCount === "number" ? record.attemptCount : 1,
      attemptId: typeof record.attemptId === "string" ? record.attemptId : "attempt-1",
      claimExpiresAt: record.claimExpiresAt ?? null,
      completedAt: record.completedAt ?? null,
      eventId: typeof record.eventId === "string" ? record.eventId : compoundWhere?.eventId ?? "evt_123",
      lastErrorCode: record.lastErrorCode ?? null,
      lastErrorMessage: record.lastErrorMessage ?? null,
      lastErrorName: record.lastErrorName ?? null,
      lastErrorRetryable: record.lastErrorRetryable ?? null,
      lastReceivedAt:
        record.lastReceivedAt instanceof Date
          ? record.lastReceivedAt
          : new Date("2026-03-26T12:00:00.000Z"),
      plannedAt: record.plannedAt ?? null,
      sideEffects: Array.isArray(record.sideEffects) ? record.sideEffects : [],
      source: typeof record.source === "string" ? record.source : compoundWhere?.source ?? "linq",
      status: typeof record.status === "string" ? record.status : undefined,
      updatedAt: record.updatedAt ?? null,
      version: typeof record.version === "number" ? record.version : 1,
    };
  }

  return {
    ...record,
    attemptCount: normalizedPayload.receipt.attemptCount,
    attemptId: normalizedPayload.receipt.attemptId,
    claimExpiresAt: record.claimExpiresAt ?? null,
    completedAt: normalizedPayload.receipt.completedAt,
    eventId: typeof record.eventId === "string" ? record.eventId : compoundWhere?.eventId ?? "evt_123",
    lastErrorCode: normalizedPayload.receipt.lastErrorCode,
    lastErrorMessage: normalizedPayload.receipt.lastErrorMessage,
    lastErrorName: normalizedPayload.receipt.lastErrorName,
    lastErrorRetryable: normalizedPayload.receipt.lastErrorRetryable,
    lastReceivedAt: normalizedPayload.receipt.lastReceivedAt,
    plannedAt: normalizedPayload.receipt.plannedAt,
    sideEffects: normalizedPayload.sideEffects,
    source: typeof record.source === "string" ? record.source : compoundWhere?.source ?? "linq",
    status: normalizedPayload.receipt.status,
    updatedAt: record.updatedAt ?? null,
    version: typeof record.version === "number" ? record.version : 1,
  };
}

function readCompoundReceiptWhere(where: Record<string, unknown> | undefined) {
  const sourceEventId =
    where?.source_eventId && typeof where.source_eventId === "object"
      ? where.source_eventId as Record<string, unknown>
      : null;

  return sourceEventId
    && typeof sourceEventId.source === "string"
    && typeof sourceEventId.eventId === "string"
    ? {
        eventId: sourceEventId.eventId,
        source: sourceEventId.source,
      }
    : null;
}

function readLegacyWebhookReceiptPayload(value: unknown): null | {
  receipt: {
    attemptCount: number;
    attemptId: string;
    completedAt: Date | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    lastErrorName: string | null;
    lastErrorRetryable: boolean | null;
    lastReceivedAt: Date;
    plannedAt: Date | null;
    status: "completed" | "failed" | "processing";
  };
  sideEffects: Record<string, unknown>[];
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const receiptState =
    payload.receiptState && typeof payload.receiptState === "object" && !Array.isArray(payload.receiptState)
      ? payload.receiptState as Record<string, unknown>
      : null;

  if (!receiptState || !isHostedWebhookReceiptStatus(receiptState.status)) {
    return null;
  }

  const lastError =
    receiptState.lastError && typeof receiptState.lastError === "object" && !Array.isArray(receiptState.lastError)
      ? receiptState.lastError as Record<string, unknown>
      : null;
  const sideEffects = Array.isArray(receiptState.sideEffects)
    ? receiptState.sideEffects.flatMap((effect) => normalizeLegacyWebhookReceiptSideEffect(effect))
    : [];

  return {
    receipt: {
      attemptCount:
        typeof receiptState.attemptCount === "number" && Number.isFinite(receiptState.attemptCount)
          ? Math.max(Math.trunc(receiptState.attemptCount), 1)
          : 1,
      attemptId: typeof receiptState.attemptId === "string" ? receiptState.attemptId : "attempt-1",
      completedAt: toDateOrNull(receiptState.completedAt),
      lastErrorCode: typeof lastError?.code === "string" ? lastError.code : null,
      lastErrorMessage: typeof lastError?.message === "string" ? lastError.message : null,
      lastErrorName: typeof lastError?.name === "string" ? lastError.name : null,
      lastErrorRetryable: typeof lastError?.retryable === "boolean" ? lastError.retryable : null,
      lastReceivedAt: toRequiredDate(receiptState.lastReceivedAt),
      plannedAt: toDateOrNull(receiptState.plannedAt),
      status: receiptState.status,
    },
    sideEffects,
  };
}

function normalizeLegacyWebhookReceiptSideEffect(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const effect = value as Record<string, unknown>;
  const lastError =
    effect.lastError && typeof effect.lastError === "object" && !Array.isArray(effect.lastError)
      ? effect.lastError as Record<string, unknown>
      : null;
  const status =
    effect.status === "sent_unconfirmed"
      ? "sent_unconfirmed"
      : effect.status === "sent"
        ? (effect.kind === "hosted_execution_dispatch" ? null : "sent_unconfirmed")
        : "pending";

  if (!status || typeof effect.effectId !== "string" || typeof effect.kind !== "string") {
    return [];
  }

  if (effect.kind === "hosted_execution_dispatch") {
    return [{
      attemptCount: typeof effect.attemptCount === "number" ? effect.attemptCount : 0,
      dispatchPayloadJson: effect.payload ?? null,
      effectId: effect.effectId,
      kind: effect.kind,
      lastAttemptAt: toDateOrNull(effect.lastAttemptAt),
      lastErrorCode: typeof lastError?.code === "string" ? lastError.code : null,
      lastErrorMessage: typeof lastError?.message === "string" ? lastError.message : null,
      lastErrorName: typeof lastError?.name === "string" ? lastError.name : null,
      lastErrorRetryable: typeof lastError?.retryable === "boolean" ? lastError.retryable : null,
      linqChatId: null,
      linqInviteId: null,
      linqReplyToMessageId: null,
      linqResultChatId: null,
      linqResultMessageId: null,
      linqTemplate: null,
      revnetAmountPaid: null,
      revnetChargeId: null,
      revnetCurrency: null,
      revnetInvoiceId: null,
      revnetMemberId: null,
      revnetPaymentIntentId: null,
      revnetResultHandled: null,
      sentAt: toDateOrNull(effect.sentAt),
      status,
    }];
  }

  if (effect.kind === "linq_message_send") {
    const payload =
      effect.payload && typeof effect.payload === "object" && !Array.isArray(effect.payload)
        ? effect.payload as Record<string, unknown>
        : null;
    const result =
      effect.result && typeof effect.result === "object" && !Array.isArray(effect.result)
        ? effect.result as Record<string, unknown>
        : null;

    return [{
      attemptCount: typeof effect.attemptCount === "number" ? effect.attemptCount : 0,
      dispatchPayloadJson: null,
      effectId: effect.effectId,
      kind: effect.kind,
      lastAttemptAt: toDateOrNull(effect.lastAttemptAt),
      lastErrorCode: typeof lastError?.code === "string" ? lastError.code : null,
      lastErrorMessage: typeof lastError?.message === "string" ? lastError.message : null,
      lastErrorName: typeof lastError?.name === "string" ? lastError.name : null,
      lastErrorRetryable: typeof lastError?.retryable === "boolean" ? lastError.retryable : null,
      linqChatId: typeof payload?.chatId === "string" ? payload.chatId : null,
      linqInviteId: typeof payload?.inviteId === "string" ? payload.inviteId : null,
      linqReplyToMessageId: typeof payload?.replyToMessageId === "string" ? payload.replyToMessageId : null,
      linqResultChatId: typeof result?.chatId === "string" ? result.chatId : null,
      linqResultMessageId: typeof result?.messageId === "string" ? result.messageId : null,
      linqTemplate: typeof payload?.template === "string" ? payload.template : null,
      revnetAmountPaid: null,
      revnetChargeId: null,
      revnetCurrency: null,
      revnetInvoiceId: null,
      revnetMemberId: null,
      revnetPaymentIntentId: null,
      revnetResultHandled: null,
      sentAt: toDateOrNull(effect.sentAt),
      status,
    }];
  }

  if (effect.kind === "revnet_invoice_issue") {
    const payload =
      effect.payload && typeof effect.payload === "object" && !Array.isArray(effect.payload)
        ? effect.payload as Record<string, unknown>
        : null;
    const result =
      effect.result && typeof effect.result === "object" && !Array.isArray(effect.result)
        ? effect.result as Record<string, unknown>
        : null;

    return [{
      attemptCount: typeof effect.attemptCount === "number" ? effect.attemptCount : 0,
      dispatchPayloadJson: null,
      effectId: effect.effectId,
      kind: effect.kind,
      lastAttemptAt: toDateOrNull(effect.lastAttemptAt),
      lastErrorCode: typeof lastError?.code === "string" ? lastError.code : null,
      lastErrorMessage: typeof lastError?.message === "string" ? lastError.message : null,
      lastErrorName: typeof lastError?.name === "string" ? lastError.name : null,
      lastErrorRetryable: typeof lastError?.retryable === "boolean" ? lastError.retryable : null,
      linqChatId: null,
      linqInviteId: null,
      linqReplyToMessageId: null,
      linqResultChatId: null,
      linqResultMessageId: null,
      linqTemplate: null,
      revnetAmountPaid: typeof payload?.amountPaid === "number" ? payload.amountPaid : null,
      revnetChargeId: typeof payload?.chargeId === "string" ? payload.chargeId : null,
      revnetCurrency: typeof payload?.currency === "string" ? payload.currency : null,
      revnetInvoiceId: typeof payload?.invoiceId === "string" ? payload.invoiceId : null,
      revnetMemberId: typeof payload?.memberId === "string" ? payload.memberId : null,
      revnetPaymentIntentId: typeof payload?.paymentIntentId === "string" ? payload.paymentIntentId : null,
      revnetResultHandled: result?.handled === true ? true : null,
      sentAt: toDateOrNull(effect.sentAt),
      status,
    }];
  }

  return [];
}

function normalizeStoredWebhookSideEffectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const effect = value as Record<string, unknown>;
  const payload =
    effect.payloadJson && typeof effect.payloadJson === "object" && !Array.isArray(effect.payloadJson)
      ? effect.payloadJson as Record<string, unknown>
      : null;
  const result =
    effect.resultJson && typeof effect.resultJson === "object" && !Array.isArray(effect.resultJson)
      ? effect.resultJson as Record<string, unknown>
      : null;

  return {
    ...effect,
    dispatchPayloadJson: effect.kind === "hosted_execution_dispatch" ? effect.payloadJson ?? null : null,
    linqChatId: effect.kind === "linq_message_send" && typeof payload?.chatId === "string" ? payload.chatId : null,
    linqInviteId: effect.kind === "linq_message_send" && typeof payload?.inviteId === "string" ? payload.inviteId : null,
    linqReplyToMessageId:
      effect.kind === "linq_message_send" && typeof payload?.replyToMessageId === "string"
        ? payload.replyToMessageId
        : null,
    linqResultChatId:
      effect.kind === "linq_message_send" && typeof result?.chatId === "string" ? result.chatId : null,
    linqResultMessageId:
      effect.kind === "linq_message_send" && typeof result?.messageId === "string" ? result.messageId : null,
    linqTemplate: effect.kind === "linq_message_send" && typeof payload?.template === "string" ? payload.template : null,
    revnetAmountPaid:
      effect.kind === "revnet_invoice_issue" && typeof payload?.amountPaid === "number" ? payload.amountPaid : null,
    revnetChargeId:
      effect.kind === "revnet_invoice_issue" && typeof payload?.chargeId === "string" ? payload.chargeId : null,
    revnetCurrency:
      effect.kind === "revnet_invoice_issue" && typeof payload?.currency === "string" ? payload.currency : null,
    revnetInvoiceId:
      effect.kind === "revnet_invoice_issue" && typeof payload?.invoiceId === "string" ? payload.invoiceId : null,
    revnetMemberId:
      effect.kind === "revnet_invoice_issue" && typeof payload?.memberId === "string" ? payload.memberId : null,
    revnetPaymentIntentId:
      effect.kind === "revnet_invoice_issue" && typeof payload?.paymentIntentId === "string"
        ? payload.paymentIntentId
        : null,
    revnetResultHandled:
      effect.kind === "revnet_invoice_issue" && result?.handled === true ? true : null,
  };
}

function isHostedWebhookReceiptStatus(
  value: unknown,
): value is "completed" | "failed" | "processing" {
  return value === "completed" || value === "failed" || value === "processing";
}

function toDateOrNull(value: unknown): Date | null {
  return typeof value === "string" ? new Date(value) : value instanceof Date ? value : null;
}

function toRequiredDate(value: unknown): Date {
  return toDateOrNull(value) ?? new Date("2026-03-26T12:00:00.000Z");
}

function readHostedMemberIdentityFromMockMember(
  member: unknown,
  requestedPhoneLookupKey?: unknown,
) {
  if (!member || typeof member !== "object") {
    return null;
  }

  const record = member as Record<string, unknown>;
  const identity =
    record.identity && typeof record.identity === "object"
      ? (record.identity as Record<string, unknown>)
      : record;
  const memberId =
    typeof identity.memberId === "string"
      ? identity.memberId
      : typeof record.id === "string"
        ? record.id
        : null;

  if (!memberId) {
    return null;
  }

  const phoneLookupKey =
    typeof requestedPhoneLookupKey === "string"
      ? requestedPhoneLookupKey
      : typeof identity.phoneLookupKey === "string"
        ? identity.phoneLookupKey
        : null;

  if (!phoneLookupKey) {
    return null;
  }

  return {
    maskedPhoneNumberHint:
      typeof identity.maskedPhoneNumberHint === "string" ? identity.maskedPhoneNumberHint : "*** 4567",
    memberId,
    phoneLookupKey,
    phoneNumberVerifiedAt:
      identity.phoneNumberVerifiedAt instanceof Date ? identity.phoneNumberVerifiedAt : null,
    privyUserId: typeof identity.privyUserId === "string" ? identity.privyUserId : null,
    walletAddress: typeof identity.walletAddress === "string" ? identity.walletAddress : null,
    walletChainType: typeof identity.walletChainType === "string" ? identity.walletChainType : null,
    walletCreatedAt: identity.walletCreatedAt instanceof Date ? identity.walletCreatedAt : null,
    walletProvider: typeof identity.walletProvider === "string" ? identity.walletProvider : null,
  };
}

function readPayloadJsonFromUpdateCall(call: Record<string, unknown> | undefined): unknown {
  const data = call?.data;

  if (!data || typeof data !== "object") {
    return undefined;
  }

  return (data as { payloadJson?: unknown }).payloadJson;
}

function createStagedPayload(
  dispatch: HostedExecutionDispatchRequest,
) {
  return {
    dispatchRef: {
      eventId: dispatch.eventId,
      eventKind: dispatch.event.kind,
      occurredAt: dispatch.occurredAt,
      userId: dispatch.event.userId,
    },
    stagedPayloadId: `transient/dispatch-payloads/${dispatch.event.userId}/${dispatch.eventId}.json`,
    storage: "reference" as const,
  };
}
