import {
  HostedBillingMode,
  HostedBillingStatus,
  HostedMemberStatus,
  Prisma,
} from "@prisma/client";
import { REVNET_NATIVE_TOKEN } from "@cobuild/wire";
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

vi.mock("@/src/lib/hosted-onboarding/linq", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/linq")>(
    "@/src/lib/hosted-onboarding/linq",
  );

  return {
    ...actual,
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
    sessionCookieName: "hb_hosted_session",
    sessionTtlDays: 30,
    stripeBillingMode: "payment",
    stripePriceId: "price_123",
    stripeSecretKey: "sk_test_123",
    stripeWebhookSecret: "whsec_123",
  }),
  getHostedOnboardingSecretCodec: () => ({
    encrypt: (value: string) => `enc:${value}`,
  }),
  requireHostedOnboardingPublicBaseUrl: () => "https://join.example.test",
  requireHostedOnboardingStripeConfig: () => ({
    billingMode: "payment",
    priceId: "price_123",
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
} from "@/src/lib/hosted-onboarding/service";

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
    expect(receiptCalls[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: expect.any(String),
            eventPayload: {
              eventType: "message.received",
            },
            lastReceivedAt: expect.any(String),
            sideEffects: [
              buildDispatchSideEffect({
                eventId: "evt_123",
                status: "pending",
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
            attemptCount: 1,
            attemptId: expect.any(String),
            completedAt: expect.any(String),
            eventPayload: {
              eventType: "message.received",
            },
            lastReceivedAt: expect.any(String),
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
  });

  it("completes a Stripe invoice webhook after durable updates queue activation dispatch", async () => {
    mocks.stripeConstructEvent.mockReturnValue({
      data: {
        object: {
          customer: "cus_123",
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
        findUnique: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.past_due,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
        }),
        update: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          status: "active",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
        }),
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

    expect(prisma.hostedMember.update).toHaveBeenCalledTimes(1);
    const receiptCalls = prisma.hostedWebhookReceipt.updateMany.mock.calls.map(
      ([payload]: [Record<string, unknown>]) => payload,
    );
    expect(receiptCalls).toHaveLength(4);
    expect(receiptCalls[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: expect.any(String),
            eventPayload: {
              type: "invoice.paid",
            },
            lastReceivedAt: expect.any(String),
            sideEffects: [
              buildMemberActivationDispatchSideEffect({
                occurredAt: expect.any(String),
                sourceEventId: "evt_stripe_123",
                sourceType: "stripe.invoice.paid",
                status: "pending",
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
            attemptCount: 1,
            attemptId: expect.any(String),
            completedAt: expect.any(String),
            eventPayload: {
              type: "invoice.paid",
            },
            lastReceivedAt: expect.any(String),
            sideEffects: [
              buildMemberActivationDispatchSideEffect({
                attemptCount: 1,
                lastAttemptAt: expect.any(String),
                occurredAt: expect.any(String),
                sentAt: expect.any(String),
                sourceEventId: "evt_stripe_123",
                sourceType: "stripe.invoice.paid",
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
            kind: "member.activated",
            userId: "member_123",
          }),
          eventId: "member.activated:stripe.invoice.paid:member_123:evt_stripe_123",
        }),
        sourceId: "stripe:evt_stripe_123",
        sourceType: "hosted_webhook_receipt",
      }),
    );
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledTimes(1);
  });

  it("falls back to the legacy top-level invoice subscription field when parent subscription details are absent", async () => {
    mocks.stripeConstructEvent.mockReturnValue({
      data: {
        object: {
          customer: null,
          subscription: "sub_legacy_123",
        },
      },
      id: "evt_stripe_invoice_legacy_123",
      type: "invoice.paid",
    });

    const findUnique = vi.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      if (where.stripeSubscriptionId === "sub_legacy_123") {
        return Promise.resolve({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.past_due,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          stripeCustomerId: null,
          stripeSubscriptionId: "sub_legacy_123",
          status: HostedMemberStatus.active,
        });
      }

      return Promise.resolve(null);
    });

    const prisma: any = withPrismaTransaction({
      hostedInvite: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique,
        update: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          stripeCustomerId: null,
          stripeSubscriptionId: "sub_legacy_123",
          status: HostedMemberStatus.active,
        }),
      },
    });

    await expect(
      handleHostedStripeWebhook({
        prisma,
        rawBody: JSON.stringify({ id: "evt_stripe_invoice_legacy_123" }),
        signature: "sig_123",
      }),
    ).resolves.toMatchObject({
      ok: true,
      type: "invoice.paid",
    });

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        stripeSubscriptionId: "sub_legacy_123",
      },
    });
  });

  it("does not activate or mark the invite paid from checkout.session.completed when RevNet subscriptions are enabled", async () => {
    mocks.isHostedOnboardingRevnetEnabled.mockReturnValue(true);
    mocks.stripeConstructEvent.mockReturnValue({
      data: {
        object: {
          client_reference_id: "member_123",
          customer: "cus_123",
          id: "cs_123",
          inviteId: "invite_123",
          metadata: {
            inviteId: "invite_123",
            memberId: "member_123",
          },
          mode: "subscription",
          payment_status: "paid",
          subscription: "sub_123",
        },
      },
      id: "evt_checkout_revnet_123",
      type: "checkout.session.completed",
    });

    const prisma: any = withPrismaTransaction({
      hostedBillingCheckout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.checkout_open,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          status: HostedMemberStatus.registered,
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: null,
        }),
        update: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.incomplete,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          status: HostedMemberStatus.registered,
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
        }),
      },
    });

    await expect(
      handleHostedStripeWebhook({
        prisma,
        rawBody: JSON.stringify({ id: "evt_checkout_revnet_123" }),
        signature: "sig_123",
      }),
    ).resolves.toMatchObject({
      ok: true,
      type: "checkout.session.completed",
    });

    expect(prisma.hostedMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          billingStatus: HostedBillingStatus.incomplete,
          status: HostedMemberStatus.registered,
        }),
      }),
    );
    expect(prisma.hostedInvite.updateMany).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("does not activate from customer.subscription.updated before invoice.paid when RevNet is enabled", async () => {
    mocks.isHostedOnboardingRevnetEnabled.mockReturnValue(true);
    mocks.stripeConstructEvent.mockReturnValue({
      data: {
        object: {
          customer: "cus_123",
          id: "sub_123",
          metadata: {
            memberId: "member_123",
          },
          status: "active",
        },
      },
      id: "evt_subscription_revnet_123",
      type: "customer.subscription.updated",
    });

    const prisma: any = withPrismaTransaction({
      hostedBillingCheckout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.checkout_open,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          status: HostedMemberStatus.registered,
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: null,
        }),
        update: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.incomplete,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          status: HostedMemberStatus.registered,
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
        }),
      },
    });

    await expect(
      handleHostedStripeWebhook({
        prisma,
        rawBody: JSON.stringify({ id: "evt_subscription_revnet_123" }),
        signature: "sig_123",
      }),
    ).resolves.toMatchObject({
      ok: true,
      type: "customer.subscription.updated",
    });

    expect(prisma.hostedMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          billingStatus: HostedBillingStatus.incomplete,
          status: HostedMemberStatus.registered,
        }),
      }),
    );
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
        data: expect.objectContaining({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 2,
            attemptId: expect.any(String),
            eventPayload: {
              eventType: "message.received",
            },
            lastReceivedAt: expect.any(String),
            sideEffects: [
              buildDispatchSideEffect({
                attemptCount: 1,
                eventId: "evt_123",
                lastAttemptAt: "2026-03-26T12:00:00.250Z",
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
            sideEffects: [
              buildDispatchSideEffect({
                attemptCount: 1,
                eventId: "evt_123",
                lastAttemptAt: "2026-03-26T12:00:00.250Z",
                sentAt: "2026-03-26T12:00:00.400Z",
                status: "sent",
              }),
            ],
            status: "completed",
          }),
        }),
      }),
    );
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("allows a Linq invite reply webhook to retry after a Linq send failure", async () => {
    mocks.sendHostedLinqChatMessage
      .mockRejectedValueOnce(new Error("linq unavailable"))
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
      triggerText: "I want to get healthy",
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
          text: "I want to get healthy",
        }),
        signature: null,
        timestamp: null,
      }),
    ).rejects.toMatchObject({
      message: "linq unavailable",
      name: "Error",
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
            sideEffects: [
              buildLinqMessageSideEffect({
                inviteId: "invite_123",
                message: expect.any(String),
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
              message: "linq unavailable",
              name: "Error",
            },
            lastReceivedAt: expect.any(String),
            sideEffects: [
              buildLinqMessageSideEffect({
                attemptCount: 1,
                inviteId: "invite_123",
                lastAttemptAt: expect.any(String),
                lastError: {
                  code: null,
                  message: "linq unavailable",
                  name: "Error",
                  retryable: null,
                },
                message: expect.any(String),
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
            sideEffects: [
              buildLinqMessageSideEffect({
                attemptCount: 2,
                inviteId: "invite_123",
                lastAttemptAt: expect.any(String),
                message: expect.any(String),
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
    expect(prisma.hostedInvite.create).toHaveBeenCalledTimes(1);
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
          message: "Use this invite link to join Healthy Bob: https://join.example.test/join/join_123",
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
            sideEffects: [
              buildLinqMessageSideEffect({
                attemptCount: 1,
                inviteId: "invite_123",
                lastAttemptAt: "2026-03-26T12:00:00.250Z",
                message: expect.any(String),
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

  it("treats completed legacy flat Linq receipts as duplicates without redispatching the event", async () => {
    const prisma: any = {
      hostedWebhookReceipt: {
        create: vi.fn().mockRejectedValue(createUniqueConstraintError()),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: buildLegacyWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: "attempt-1",
            completedAt: "2026-03-26T12:00:00.000Z",
            eventPayload: {
              eventType: "message.received",
            },
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

  it("treats in-flight legacy flat Linq receipts as duplicates without redispatching the event", async () => {
    const prisma: any = {
      hostedWebhookReceipt: {
        create: vi.fn().mockRejectedValue(createUniqueConstraintError()),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: buildLegacyWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: "attempt-processing",
            eventPayload: {
              eventType: "message.received",
            },
            lastReceivedAt: "2026-03-26T12:00:00.000Z",
            status: "processing",
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
    expect(receiptCalls[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          payloadJson: {
            equals: malformedReceiptPayload,
          },
        }),
        data: expect.objectContaining({
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: expect.any(String),
            eventPayload: {
              eventType: "message.received",
              strayLegacyField: "keep-me-if-possible",
            },
            lastReceivedAt: expect.any(String),
            sideEffects: [],
            status: "processing",
          }),
        }),
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
              strayLegacyField: "keep-me-if-possible",
            },
            lastReceivedAt: expect.any(String),
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
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledTimes(1);
  });

  it("submits an inline RevNet payment exactly once for a paid invoice", async () => {
    mocks.isHostedOnboardingRevnetEnabled.mockReturnValue(true);
    mocks.stripeConstructEvent.mockReturnValue({
      data: {
        object: {
          amount_paid: 500,
          currency: "usd",
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

    const issuanceRow = {
      beneficiaryAddress: "0x00000000000000000000000000000000000000aa",
      chainId: 8453,
      id: "hbrv_123",
      idempotencyKey: "stripe:invoice:in_123",
      payTxHash: null,
      paymentAmount: "1000000000000000",
      projectId: "1",
      status: "pending",
      stripeChargeId: null,
      stripePaymentIntentId: "pi_123",
      terminalAddress: "0x0000000000000000000000000000000000000001",
      updatedAt: new Date("2026-03-26T12:00:00.000Z"),
    };
    const submittedIssuanceRow = {
      ...issuanceRow,
      payTxHash: "0xabc123",
      status: "submitted",
      updatedAt: new Date("2026-03-26T12:00:01.000Z"),
    };

    const prisma: any = withPrismaTransaction({
      hostedBillingCheckout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.past_due,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
          walletAddress: "0x00000000000000000000000000000000000000aa",
        }),
        update: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
          walletAddress: "0x00000000000000000000000000000000000000aa",
        }),
      },
      hostedRevnetIssuance: {
        create: vi.fn().mockResolvedValue(issuanceRow),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn()
          .mockResolvedValueOnce(submittedIssuanceRow)
          .mockResolvedValueOnce({
            ...submittedIssuanceRow,
            confirmedAt: new Date("2026-03-26T12:00:02.000Z"),
            status: "confirmed",
          }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });

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

    expect(prisma.hostedRevnetIssuance.findUnique).toHaveBeenCalledWith({
      where: {
        idempotencyKey: "stripe:invoice:in_123",
      },
    });
    expect(prisma.hostedRevnetIssuance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        beneficiaryAddress: "0x00000000000000000000000000000000000000aa",
        idempotencyKey: "stripe:invoice:in_123",
        paymentAmount: "1000000000000000",
        paymentAssetAddress: REVNET_NATIVE_TOKEN,
        stripeInvoiceId: "in_123",
        stripePaymentIntentId: "pi_123",
        stripePaymentAmountMinor: 500,
        stripePaymentCurrency: "usd",
      }),
    });
    expect(mocks.submitHostedRevnetPayment).toHaveBeenCalledWith({
      beneficiaryAddress: "0x00000000000000000000000000000000000000aa",
      chainId: 8453,
      memo: "issuance:hbrv_123",
      paymentAmount: 1_000_000_000_000_000n,
      projectId: 1n,
      terminalAddress: "0x0000000000000000000000000000000000000001",
    });
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledTimes(1);
  });

  it("leaves broadcast-unknown RevNet submissions stuck instead of marking them failed", async () => {
    mocks.isHostedOnboardingRevnetEnabled.mockReturnValue(true);
    mocks.submitHostedRevnetPayment.mockRejectedValue(new Error("already known"));
    mocks.stripeConstructEvent.mockReturnValue({
      data: {
        object: {
          amount_paid: 500,
          currency: "usd",
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
      id: "evt_stripe_revnet_unknown_123",
      type: "invoice.paid",
    });

    const issuanceRow = {
      beneficiaryAddress: "0x00000000000000000000000000000000000000aa",
      chainId: 8453,
      id: "hbrv_123",
      idempotencyKey: "stripe:invoice:in_123",
      payTxHash: null,
      paymentAmount: "1000000000000000",
      projectId: "1",
      status: "pending",
      stripeChargeId: null,
      stripePaymentIntentId: "pi_123",
      terminalAddress: "0x0000000000000000000000000000000000000001",
      updatedAt: new Date("2026-03-26T12:00:00.000Z"),
    };

    const prisma: any = withPrismaTransaction({
      hostedBillingCheckout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.past_due,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
          walletAddress: "0x00000000000000000000000000000000000000aa",
        }),
        update: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
          walletAddress: "0x00000000000000000000000000000000000000aa",
        }),
      },
      hostedRevnetIssuance: {
        create: vi.fn().mockResolvedValue(issuanceRow),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({
          ...issuanceRow,
          failureCode: "REVNET_PAYMENT_BROADCAST_STATUS_UNKNOWN",
          failureMessage: "already known",
          status: "submitting",
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });

    await expect(
      handleHostedStripeWebhook({
        prisma,
        rawBody: JSON.stringify({ id: "evt_stripe_revnet_unknown_123" }),
        signature: "sig_123",
      }),
    ).resolves.toMatchObject({
      ok: true,
      type: "invoice.paid",
    });

    expect(prisma.hostedRevnetIssuance.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          failureCode: "REVNET_PAYMENT_BROADCAST_STATUS_UNKNOWN",
          status: "submitting",
        }),
      }),
    );
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledTimes(1);
  });

  it("does not resubmit a RevNet payment when the issuance is already confirmed", async () => {
    mocks.isHostedOnboardingRevnetEnabled.mockReturnValue(true);
    mocks.stripeConstructEvent.mockReturnValue({
      data: {
        object: {
          amount_paid: 500,
          currency: "usd",
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
      id: "evt_stripe_revnet_confirmed_123",
      type: "invoice.paid",
    });

    const prisma: any = withPrismaTransaction({
      hostedBillingCheckout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.past_due,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
          walletAddress: "0x00000000000000000000000000000000000000aa",
        }),
        update: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
          walletAddress: "0x00000000000000000000000000000000000000aa",
        }),
      },
      hostedRevnetIssuance: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({
          beneficiaryAddress: "0x00000000000000000000000000000000000000aa",
          chainId: 8453,
          id: "hbrv_123",
          idempotencyKey: "stripe:invoice:in_123",
          payTxHash: "0xabc123",
          paymentAmount: "1000000000000000",
          projectId: "1",
          status: "confirmed",
          terminalAddress: "0x0000000000000000000000000000000000000001",
          updatedAt: new Date("2026-03-26T12:00:02.000Z"),
        }),
      },
    });

    await expect(
      handleHostedStripeWebhook({
        prisma,
        rawBody: JSON.stringify({ id: "evt_stripe_revnet_confirmed_123" }),
        signature: "sig_123",
      }),
    ).resolves.toMatchObject({
      ok: true,
      type: "invoice.paid",
    });

    expect(prisma.hostedRevnetIssuance.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.hostedRevnetIssuance.create).not.toHaveBeenCalled();
    expect(mocks.submitHostedRevnetPayment).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).toHaveBeenCalledTimes(1);
  });

  it("submits using the stored issuance amount and addresses instead of recomputing from live config", async () => {
    mocks.isHostedOnboardingRevnetEnabled.mockReturnValue(true);
    mocks.stripeConstructEvent.mockReturnValue({
      data: {
        object: {
          amount_paid: 500,
          currency: "usd",
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
      id: "evt_stripe_revnet_frozen_123",
      type: "invoice.paid",
    });

    const issuanceRow = {
      beneficiaryAddress: "0x00000000000000000000000000000000000000bb",
      chainId: 8453,
      id: "hbrv_existing_123",
      idempotencyKey: "stripe:invoice:in_123",
      payTxHash: null,
      paymentAmount: "42",
      projectId: "99",
      status: "pending",
      stripeChargeId: null,
      stripePaymentIntentId: "pi_123",
      terminalAddress: "0x0000000000000000000000000000000000000002",
      updatedAt: new Date("2026-03-26T12:00:00.000Z"),
    };

    const prisma: any = withPrismaTransaction({
      hostedBillingCheckout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.past_due,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
          walletAddress: "0x00000000000000000000000000000000000000aa",
        }),
        update: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
          walletAddress: "0x00000000000000000000000000000000000000aa",
        }),
      },
      hostedRevnetIssuance: {
        create: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(issuanceRow),
        update: vi.fn()
          .mockResolvedValueOnce({
            ...issuanceRow,
            payTxHash: "0xabc123",
            status: "submitted",
            updatedAt: new Date("2026-03-26T12:00:01.000Z"),
          })
          .mockResolvedValueOnce({
            ...issuanceRow,
            confirmedAt: new Date("2026-03-26T12:00:02.000Z"),
            payTxHash: "0xabc123",
            status: "confirmed",
          }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });

    await expect(
      handleHostedStripeWebhook({
        prisma,
        rawBody: JSON.stringify({ id: "evt_stripe_revnet_frozen_123" }),
        signature: "sig_123",
      }),
    ).resolves.toMatchObject({
      ok: true,
      type: "invoice.paid",
    });

    expect(mocks.submitHostedRevnetPayment).toHaveBeenCalledWith({
      beneficiaryAddress: "0x00000000000000000000000000000000000000bb",
      chainId: 8453,
      memo: "issuance:hbrv_existing_123",
      paymentAmount: 42n,
      projectId: 99n,
      terminalAddress: "0x0000000000000000000000000000000000000002",
    });
  });

  it("suspends hosted access and revokes sessions when Stripe creates a refund", async () => {
    mocks.stripeConstructEvent.mockReturnValue({
      data: {
        object: {
          charge: "ch_123",
          id: "re_123",
          payment_intent: "pi_123",
        },
      },
      id: "evt_stripe_refund_123",
      type: "refund.created",
    });

    const prisma: any = withPrismaTransaction({
      hostedRevnetIssuance: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.payment,
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          normalizedPhoneNumber: "+15551234567",
          status: HostedMemberStatus.active,
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: null,
        }),
        update: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.payment,
          billingStatus: HostedBillingStatus.unpaid,
          id: "member_123",
          normalizedPhoneNumber: "+15551234567",
          status: HostedMemberStatus.suspended,
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: null,
        }),
      },
      hostedSession: {
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    });

    await expect(
      handleHostedStripeWebhook({
        prisma,
        rawBody: JSON.stringify({ id: "evt_stripe_refund_123" }),
        signature: "sig_123",
      }),
    ).resolves.toMatchObject({
      ok: true,
      type: "refund.created",
    });

    expect(mocks.stripePaymentIntentsRetrieve).toHaveBeenCalledWith("pi_123");
    expect(prisma.hostedMember.update).toHaveBeenCalledWith({
      where: {
        id: "member_123",
      },
      data: {
        billingStatus: HostedBillingStatus.unpaid,
        status: HostedMemberStatus.suspended,
        stripeCustomerId: "cus_123",
      },
    });
    expect(prisma.hostedSession.updateMany).toHaveBeenCalledWith({
      where: {
        expiresAt: {
          gt: expect.any(Date),
        },
        memberId: "member_123",
        revokedAt: null,
      },
      data: {
        revokedAt: expect.any(Date),
        revokeReason: "billing_reversal:refund.created",
      },
    });
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.submitHostedRevnetPayment).not.toHaveBeenCalled();
  });

  it("keeps suspended members from reactivating or issuing RevNet on later invoice.paid events", async () => {
    mocks.isHostedOnboardingRevnetEnabled.mockReturnValue(true);
    mocks.stripeConstructEvent.mockReturnValue({
      data: {
        object: {
          amount_paid: 500,
          currency: "usd",
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
      id: "evt_stripe_revnet_suspended_123",
      type: "invoice.paid",
    });

    const prisma: any = withPrismaTransaction({
      hostedBillingCheckout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.unpaid,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          status: HostedMemberStatus.suspended,
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
          walletAddress: "0x00000000000000000000000000000000000000aa",
        }),
        update: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          status: HostedMemberStatus.suspended,
          stripeCustomerId: "cus_123",
          stripeSubscriptionId: "sub_123",
          walletAddress: "0x00000000000000000000000000000000000000aa",
        }),
      },
    });

    await expect(
      handleHostedStripeWebhook({
        prisma,
        rawBody: JSON.stringify({ id: "evt_stripe_revnet_suspended_123" }),
        signature: "sig_123",
      }),
    ).resolves.toMatchObject({
      ok: true,
      type: "invoice.paid",
    });

    expect(prisma.hostedMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          billingStatus: HostedBillingStatus.active,
          status: HostedMemberStatus.suspended,
        }),
      }),
    );
    expect(mocks.submitHostedRevnetPayment).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("treats completed Stripe receipts as duplicates without replaying durable updates", async () => {
    mocks.stripeConstructEvent.mockReturnValue({
      data: {
        object: {
          customer: "cus_123",
        },
      },
      id: "evt_stripe_123",
      type: "invoice.paid",
    });

    const prisma: any = {
      hostedWebhookReceipt: {
        create: vi.fn().mockRejectedValue(createUniqueConstraintError()),
        findUnique: vi.fn().mockResolvedValue({
          payloadJson: buildLegacyWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: "attempt-1",
            completedAt: "2026-03-26T12:00:00.000Z",
            eventPayload: {
              type: "invoice.paid",
            },
            status: "completed",
          }),
        }),
        updateMany: vi.fn(),
      },
      hostedMember: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    };

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

    expect(prisma.hostedWebhookReceipt.updateMany).not.toHaveBeenCalled();
    expect(prisma.hostedMember.findUnique).not.toHaveBeenCalled();
    expect(prisma.hostedMember.update).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });
});

function buildLinqMessageWebhookBody(input: {
  text?: string;
} = {}): string {
  return JSON.stringify({
    api_version: "v1",
    created_at: "2026-03-26T12:00:00.000Z",
    data: {
      chat_id: "chat_123",
      from: "+15551234567",
      is_from_me: false,
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
    event_type: "message.received",
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
      sideEffects: input.sideEffects ?? [],
      status: input.status,
    },
  };
}

function buildLegacyWebhookReceiptPayload(input: {
  attemptCount: number;
  attemptId?: unknown;
  completedAt?: unknown;
  eventPayload: Record<string, unknown>;
  lastError?: unknown;
  lastReceivedAt?: unknown;
  status: "completed" | "failed" | "processing";
}) {
  return {
    ...input.eventPayload,
    receiptAttemptCount: input.attemptCount,
    receiptAttemptId: input.attemptId ?? "attempt-1",
    receiptCompletedAt:
      input.completedAt ??
      (input.status === "completed" ? "2026-03-26T12:00:00.000Z" : null),
    receiptLastError:
      input.lastError ??
      (input.status === "failed"
        ? {
          message: "Unknown hosted webhook failure.",
          name: "UnknownError",
        }
        : null),
    receiptLastReceivedAt: input.lastReceivedAt ?? "2026-03-26T12:00:00.000Z",
    receiptStatus: input.status,
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
  return {
    attemptCount: input.attemptCount ?? 0,
    effectId: input.effectId ?? `dispatch:${input.eventId}`,
    kind: "hosted_execution_dispatch",
    lastAttemptAt: input.lastAttemptAt ?? null,
    lastError: input.lastError ?? null,
    payload: {
      dispatch: {
        event: {
          kind: "linq.message.received",
          linqChatId: "chat_123",
          linqEvent: {
            api_version: "v1",
            created_at: "2026-03-26T12:00:00.000Z",
            data: {
              chat_id: "chat_123",
              from: "+15551234567",
              is_from_me: false,
              message: {
                id: "msg_123",
                parts: [
                  {
                    type: "text",
                    value: "hello",
                  },
                ],
              },
              received_at: "2026-03-26T12:00:00.000Z",
              recipient_phone: "+15550000000",
              service: "sms",
            },
            event_id: "evt_123",
            event_type: "message.received",
            partner_id: null,
            trace_id: null,
          },
          normalizedPhoneNumber: "+15551234567",
          userId: "member_123",
        },
        eventId: input.eventId,
        occurredAt: input.occurredAt ?? "2026-03-26T12:00:00.000Z",
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
  linqChatId?: string | null;
  memberId?: string;
  normalizedPhoneNumber?: string;
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

  return {
    attemptCount: input.attemptCount ?? 0,
    effectId: eventId,
    kind: "hosted_execution_dispatch",
    lastAttemptAt: input.lastAttemptAt ?? null,
    lastError: input.lastError ?? null,
    payload: {
      dispatch: {
        event: {
          kind: "member.activated",
          linqChatId: input.linqChatId ?? "chat_123",
          normalizedPhoneNumber: input.normalizedPhoneNumber ?? "+15551234567",
          userId: memberId,
        },
        eventId: String(eventId).replace(/^dispatch:/u, ""),
        occurredAt: input.occurredAt ?? "2026-03-26T12:00:00.000Z",
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
  sentAt?: unknown;
  sourceEventId?: string;
  status: "pending" | "sent";
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
    },
    result:
      input.status === "sent"
        ? {
          chatId: input.chatId ?? "chat_123",
          messageId: input.messageId ?? "out_msg_123",
        }
        : null,
    sentAt:
      input.sentAt ??
      (input.status === "sent" ? "2026-03-26T12:00:01.000Z" : null),
    status: input.status,
  };
}

function withPrismaTransaction<T extends Record<string, unknown>>(prisma: T): T {
  const prismaWithTransaction = prisma as T & {
    $transaction: (callback: (tx: T) => Promise<unknown>) => Promise<unknown>;
  };
  prismaWithTransaction.$transaction = async (callback) => callback(prismaWithTransaction);
  return prismaWithTransaction;
}
