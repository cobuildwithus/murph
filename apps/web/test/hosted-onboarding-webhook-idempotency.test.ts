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
  const requireHostedOnboardingStripeConfig = vi.fn();

  return {
    drainHostedExecutionOutboxBestEffort: vi.fn(),
    enqueueHostedExecutionOutbox: vi.fn(),
    isHostedRevnetBroadcastStatusUnknownError: vi.fn(),
    isHostedOnboardingRevnetEnabled: vi.fn(),
    normalizeHostedWalletAddress: vi.fn((value: string | null | undefined) => value ?? null),
    requireHostedOnboardingStripeConfig,
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
    assertHostedLinqWebhookSignature: vi.fn(),
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
  requireHostedOnboardingStripeClient: () => ({
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
  requireHostedOnboardingStripeConfig: mocks.requireHostedOnboardingStripeConfig,
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
    mocks.requireHostedOnboardingStripeConfig.mockReset();
    mocks.requireHostedOnboardingStripeConfig.mockReturnValue({
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
    });
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

  it("ignores a Linq webhook with no onboarding trigger without queueing side effects", async () => {
    const prisma: any = withPrismaTransaction({
      hostedBillingCheckout: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedInvite: {
        create: vi.fn(),
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
      ignored: true,
      ok: true,
      reason: "no-trigger",
    });

    expect(prisma.hostedMember.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.hostedMember.create).not.toHaveBeenCalled();
    expect(prisma.hostedMember.update).not.toHaveBeenCalled();
    expect(prisma.hostedInvite.create).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
    expect(mocks.sendHostedLinqChatMessage).not.toHaveBeenCalled();
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
            plannedAt: expect.any(String),
            response: expect.objectContaining({
              ok: true,
              type: "invoice.paid",
            }),
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
            plannedAt: expect.any(String),
            response: expect.objectContaining({
              ok: true,
              type: "invoice.paid",
            }),
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

  it("does not match members from the removed top-level invoice subscription field", async () => {
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

    const findUnique = vi.fn().mockResolvedValue(null);

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

    expect(findUnique).not.toHaveBeenCalledWith({
      where: {
        stripeSubscriptionId: "sub_legacy_123",
      },
    });
    expect(prisma.hostedMember.update).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("downgrades subscription members from invoice.payment_failed using parent subscription details", async () => {
    mocks.stripeConstructEvent.mockReturnValue({
      data: {
        object: {
          customer: null,
          parent: {
            subscription_details: {
              subscription: "sub_123",
            },
          },
        },
      },
      id: "evt_stripe_invoice_failed_123",
      type: "invoice.payment_failed",
    });

    const findUnique = vi.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
      if (where.stripeSubscriptionId === "sub_123") {
        return Promise.resolve({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.active,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          stripeCustomerId: null,
          stripeSubscriptionId: "sub_123",
          status: HostedMemberStatus.active,
        });
      }

      return Promise.resolve(null);
    });

    const prisma: any = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique,
        update: vi.fn().mockResolvedValue({
          billingMode: HostedBillingMode.subscription,
          billingStatus: HostedBillingStatus.past_due,
          id: "member_123",
          linqChatId: "chat_123",
          normalizedPhoneNumber: "+15551234567",
          stripeCustomerId: null,
          stripeSubscriptionId: "sub_123",
          status: HostedMemberStatus.active,
        }),
      },
    });

    await expect(
      handleHostedStripeWebhook({
        prisma,
        rawBody: JSON.stringify({ id: "evt_stripe_invoice_failed_123" }),
        signature: "sig_123",
      }),
    ).resolves.toMatchObject({
      ok: true,
      type: "invoice.payment_failed",
    });

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        stripeSubscriptionId: "sub_123",
      },
    });
    expect(prisma.hostedMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          billingStatus: HostedBillingStatus.past_due,
          stripeSubscriptionId: "sub_123",
        }),
      }),
    );
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
  });

  it("does not match invoice.payment_failed members from the removed top-level invoice subscription field", async () => {
    mocks.stripeConstructEvent.mockReturnValue({
      data: {
        object: {
          customer: null,
          subscription: "sub_legacy_123",
        },
      },
      id: "evt_stripe_invoice_failed_legacy_123",
      type: "invoice.payment_failed",
    });

    const findUnique = vi.fn().mockResolvedValue(null);

    const prisma: any = withPrismaTransaction({
      hostedWebhookReceipt: {
        create: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedMember: {
        findUnique,
        update: vi.fn(),
      },
    });

    await expect(
      handleHostedStripeWebhook({
        prisma,
        rawBody: JSON.stringify({ id: "evt_stripe_invoice_failed_legacy_123" }),
        signature: "sig_123",
      }),
    ).resolves.toMatchObject({
      ok: true,
      type: "invoice.payment_failed",
    });

    expect(findUnique).not.toHaveBeenCalledWith({
      where: {
        stripeSubscriptionId: "sub_legacy_123",
      },
    });
    expect(prisma.hostedMember.update).not.toHaveBeenCalled();
    expect(mocks.enqueueHostedExecutionOutbox).not.toHaveBeenCalled();
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
            plannedAt: expect.any(String),
            response: expect.objectContaining({
              inviteCode: "join_123",
              joinUrl: "https://join.example.test/join/join_123",
              ok: true,
            }),
            sideEffects: [
              buildLinqMessageSideEffect({
                inviteId: "invite_123",
                message: expect.any(String),
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
              message: "linq unavailable",
              name: "Error",
              retryable: null,
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
                lastAttemptAt: expect.any(String),
                lastError: {
                  code: null,
                  message: "linq unavailable",
                  name: "Error",
                  retryable: null,
                },
                message: expect.any(String),
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
            plannedAt: expect.any(String),
            response: expect.objectContaining({
              inviteCode: "join_123",
              joinUrl: "https://join.example.test/join/join_123",
              ok: true,
            }),
            sideEffects: [
              buildLinqMessageSideEffect({
                attemptCount: 2,
                inviteId: "invite_123",
                lastAttemptAt: expect.any(String),
                message: expect.any(String),
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
    expect(receiptCalls[0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          payloadJson: {
            equals: malformedReceiptPayload,
          },
        }),
        data: expect.objectContaining({
          payloadJson: expect.objectContaining({
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
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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

  it("does not rebroadcast a RevNet payment after a successful submission if tx-hash persistence fails", async () => {
    mocks.isHostedOnboardingRevnetEnabled.mockReturnValue(true);
    mocks.stripeConstructEvent
      .mockReturnValueOnce({
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
        id: "evt_stripe_revnet_recording_failed_1",
        type: "invoice.paid",
      })
      .mockReturnValueOnce({
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
        id: "evt_stripe_revnet_recording_failed_2",
        type: "invoice.paid",
      });

    let issuanceRow: Record<string, unknown> | null = null;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
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
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      hostedRevnetIssuance: {
        create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          issuanceRow = {
            ...data,
            failureCode: null,
            failureMessage: null,
            id: "hbrv_recording_failed_123",
            payTxHash: null,
            status: "pending",
            updatedAt: new Date("2026-03-26T12:00:00.000Z"),
          };

          return issuanceRow;
        }),
        findUnique: vi.fn().mockImplementation(async () => issuanceRow),
        update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          if ("payTxHash" in data || data.status === "submitted") {
            throw new Error("db write failed");
          }

          issuanceRow = {
            ...(issuanceRow ?? {}),
            ...data,
          };

          return issuanceRow;
        }),
        updateMany: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
          if (data.status === "submitting") {
            issuanceRow = {
              ...(issuanceRow ?? {}),
              failureCode: null,
              failureMessage: null,
              status: "submitting",
              updatedAt: new Date("2026-03-26T12:00:00.000Z"),
            };

            return { count: 1 };
          }

          return { count: 0 };
        }),
      },
    });

    try {
      await expect(
        handleHostedStripeWebhook({
          prisma,
          rawBody: JSON.stringify({ id: "evt_stripe_revnet_recording_failed_1" }),
          signature: "sig_123",
        }),
      ).rejects.toMatchObject({
        code: "REVNET_ISSUANCE_RECORDING_FAILED",
        retryable: false,
      });

      await expect(
        handleHostedStripeWebhook({
          prisma,
          rawBody: JSON.stringify({ id: "evt_stripe_revnet_recording_failed_2" }),
          signature: "sig_123",
        }),
      ).resolves.toMatchObject({
        ok: true,
        type: "invoice.paid",
      });
    } finally {
      consoleError.mockRestore();
    }

    expect(mocks.submitHostedRevnetPayment).toHaveBeenCalledTimes(1);
    expect(prisma.hostedRevnetIssuance.updateMany).toHaveBeenCalledTimes(2);
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

  it("does not overwrite existing Stripe payment references on duplicate invoice events", async () => {
    mocks.isHostedOnboardingRevnetEnabled.mockReturnValue(true);
    mocks.stripeConstructEvent.mockReturnValue({
      data: {
        object: {
          amount_paid: 500,
          charge: "ch_new",
          currency: "usd",
          customer: "cus_123",
          id: "in_123",
          payment_intent: "pi_new",
          parent: {
            subscription_details: {
              subscription: "sub_123",
            },
          },
        },
      },
      id: "evt_stripe_revnet_duplicate_refs_123",
      type: "invoice.paid",
    });

    const issuanceRow = {
      beneficiaryAddress: "0x00000000000000000000000000000000000000bb",
      chainId: 8453,
      id: "hbrv_existing_refs_123",
      idempotencyKey: "stripe:invoice:in_123",
      payTxHash: null,
      paymentAmount: "42",
      projectId: "99",
      status: "pending",
      stripeChargeId: "ch_existing",
      stripePaymentIntentId: "pi_existing",
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
        rawBody: JSON.stringify({ id: "evt_stripe_revnet_duplicate_refs_123" }),
        signature: "sig_123",
      }),
    ).resolves.toMatchObject({
      ok: true,
      type: "invoice.paid",
    });

    expect(
      prisma.hostedRevnetIssuance.update.mock.calls.some(
        ([payload]: [{ data?: { stripeChargeId?: string; stripePaymentIntentId?: string } }]) =>
          "stripeChargeId" in (payload.data ?? {}) || "stripePaymentIntentId" in (payload.data ?? {}),
      ),
    ).toBe(false);
    expect(mocks.submitHostedRevnetPayment).toHaveBeenCalledWith({
      beneficiaryAddress: "0x00000000000000000000000000000000000000bb",
      chainId: 8453,
      memo: "issuance:hbrv_existing_refs_123",
      paymentAmount: 42n,
      projectId: 99n,
      terminalAddress: "0x0000000000000000000000000000000000000002",
    });
  });

  it("backfills missing Stripe payment references exactly once on a duplicate invoice event", async () => {
    mocks.isHostedOnboardingRevnetEnabled.mockReturnValue(true);
    mocks.stripeConstructEvent.mockReturnValue({
      data: {
        object: {
          amount_paid: 500,
          charge: "ch_123",
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
      id: "evt_stripe_revnet_backfill_refs_123",
      type: "invoice.paid",
    });

    const issuanceRow = {
      beneficiaryAddress: "0x00000000000000000000000000000000000000bb",
      chainId: 8453,
      id: "hbrv_existing_backfill_123",
      idempotencyKey: "stripe:invoice:in_123",
      payTxHash: null,
      paymentAmount: "42",
      projectId: "99",
      status: "pending",
      stripeChargeId: null,
      stripePaymentIntentId: null,
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
            stripeChargeId: "ch_123",
            stripePaymentIntentId: "pi_123",
          })
          .mockResolvedValueOnce({
            ...issuanceRow,
            stripeChargeId: "ch_123",
            stripePaymentIntentId: "pi_123",
            payTxHash: "0xabc123",
            status: "submitted",
            updatedAt: new Date("2026-03-26T12:00:01.000Z"),
          })
          .mockResolvedValueOnce({
            ...issuanceRow,
            confirmedAt: new Date("2026-03-26T12:00:02.000Z"),
            payTxHash: "0xabc123",
            status: "confirmed",
            stripeChargeId: "ch_123",
            stripePaymentIntentId: "pi_123",
          }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });

    await expect(
      handleHostedStripeWebhook({
        prisma,
        rawBody: JSON.stringify({ id: "evt_stripe_revnet_backfill_refs_123" }),
        signature: "sig_123",
      }),
    ).resolves.toMatchObject({
      ok: true,
      type: "invoice.paid",
    });

    expect(prisma.hostedRevnetIssuance.update.mock.calls[0]?.[0]).toEqual({
      where: {
        id: "hbrv_existing_backfill_123",
      },
      data: {
        stripeChargeId: "ch_123",
        stripePaymentIntentId: "pi_123",
      },
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
    mocks.requireHostedOnboardingStripeConfig.mockImplementation(() => {
      throw new Error("checkout config should not be required for refund handling");
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

    expect(mocks.stripeChargesRetrieve).toHaveBeenCalledWith("ch_123");
    expect(mocks.stripePaymentIntentsRetrieve).not.toHaveBeenCalled();
    expect(mocks.requireHostedOnboardingStripeConfig).not.toHaveBeenCalled();
    expect(prisma.hostedMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "member_123",
          OR: expect.any(Array),
        }),
        data: expect.objectContaining({
          billingStatus: HostedBillingStatus.unpaid,
          status: HostedMemberStatus.suspended,
          stripeCustomerId: "cus_123",
          stripeLatestBillingEventCreatedAt: expect.any(Date),
          stripeLatestBillingEventId: "evt_stripe_refund_123",
        }),
      }),
    );
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
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: "attempt-1",
            completedAt: "2026-03-26T12:00:00.000Z",
            eventPayload: {
              type: "invoice.paid",
            },
            sideEffects: [],
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

  it("treats completed Stripe receipts with minimized activation side effects as duplicates", async () => {
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
          payloadJson: buildWebhookReceiptPayload({
            attemptCount: 1,
            attemptId: "attempt-1",
            completedAt: "2026-03-26T12:00:00.000Z",
            eventPayload: {
              type: "invoice.paid",
            },
            sideEffects: [
              buildMemberActivationDispatchSideEffect({
                attemptCount: 1,
                lastAttemptAt: "2026-03-26T12:00:00.250Z",
                sentAt: "2026-03-26T12:00:00.400Z",
                sourceEventId: "evt_stripe_123",
                sourceType: "stripe.invoice.paid",
                status: "sent",
              }),
            ],
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
