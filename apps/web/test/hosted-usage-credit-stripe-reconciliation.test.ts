import {
  HostedUsageCreditPurchaseStatus,
} from "@prisma/client";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decryptStripeField: vi.fn(),
  encryptStripeField: vi.fn(),
  grantUsageCredit: vi.fn(),
  lockPurchaseReservationOwners: vi.fn(),
  readGrantCapacity: vi.fn(),
  reconcileDisputeNetReversal: vi.fn(),
  reconcileRefundNetReversal: vi.fn(),
  stripeApiMode: vi.fn(),
  stripe: {
    charges: {
      retrieve: vi.fn(),
    },
    checkout: {
      sessions: {
        list: vi.fn(),
        listLineItems: vi.fn(),
        retrieve: vi.fn(),
      },
    },
    disputes: {
      list: vi.fn(),
      retrieve: vi.fn(),
    },
    paymentIntents: {
      retrieve: vi.fn(),
    },
    refunds: {
      list: vi.fn(),
      retrieve: vi.fn(),
    },
  },
}));

vi.mock("@/src/lib/hosted-execution/usage-credits", () => ({
  grantHostedUsageCreditForPurchaseTx: mocks.grantUsageCredit,
  reconcileHostedUsageCreditDisputeNetReversalTx:
    mocks.reconcileDisputeNetReversal,
  reconcileHostedUsageCreditRefundNetReversalTx:
    mocks.reconcileRefundNetReversal,
}));

vi.mock("@/src/lib/hosted-execution/usage-credit-grant-capacity", () => ({
  readHostedUsageCreditGrantCapacityTx: mocks.readGrantCapacity,
}));

vi.mock("@/src/lib/hosted-onboarding/contact-privacy", () => ({
  createHostedStripeBillingEventLookupKey: (value: string | null | undefined) =>
    value ? `stripe-billing-event:${value}` : null,
  createHostedStripeBillingEventLookupKeyReadCandidates: (
    value: string | null | undefined,
  ) => value
    ? [
        `stripe-billing-event:${value}`,
        `stripe-billing-event:previous:${value}`,
      ]
    : [],
  createHostedStripeCheckoutSessionLookupKey: (value: string | null | undefined) =>
    value ? `stripe-checkout-session:${value}` : null,
  hostedLookupKeyMatchesValue: (input: {
    expectedLookupKey: string | null | undefined;
    kind: string;
    normalizedValue: string | null;
  }) => input.expectedLookupKey === (
    input.normalizedValue ? `${input.kind}:${input.normalizedValue}` : null
  ) || input.expectedLookupKey === (
    input.normalizedValue
      ? `${input.kind}:previous:${input.normalizedValue}`
      : null
  ),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  withHostedMemberStripeMutationLock: async (input: {
    prisma: UsageCreditStripePrismaHarnessClient;
    run: (tx: UsageCreditStripePrismaHarnessClient) => Promise<unknown>;
  }) => input.prisma.$transaction(input.run),
}));

vi.mock(
  "@/src/lib/hosted-onboarding/usage-credit-purchase-reservation-lock",
  () => ({
    lockHostedUsageCreditPurchaseReservationOwnersTx:
      mocks.lockPurchaseReservationOwners,
  }),
);

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedStripeApi: () => mocks.stripe,
  requireHostedStripeApiMode: mocks.stripeApiMode,
}));

vi.mock(
  "@/src/lib/hosted-onboarding/usage-credit-purchase-stripe",
  async (importOriginal) => {
    const original = await importOriginal<typeof import(
      "../src/lib/hosted-onboarding/usage-credit-purchase-stripe"
    )>();
    return {
      ...original,
      decryptHostedUsageCreditPurchaseStripeField: mocks.decryptStripeField,
      encryptHostedUsageCreditPurchaseStripeField: mocks.encryptStripeField,
      requireHostedUsageCreditPurchasePayerMemberId: (purchase: {
        payerMemberId: string | null;
      }) => {
        if (!purchase.payerMemberId) {
          throw new Error("payer detached");
        }
        return purchase.payerMemberId;
      },
    };
  },
);

import {
  HOSTED_USAGE_CREDIT_STRIPE_PREPARATION_BUDGET,
  isHostedUsageCreditStripeRetryableError,
  reconcileHostedUsageCreditStripeEvent as reconcileHostedUsageCreditStripeEventImpl,
} from "@/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation";
import {
  isRetryableHostedUsageCreditDependencyError,
  runHostedUsageCreditKmsOperation,
} from "@/src/lib/hosted-onboarding/usage-credit-stripe-reconciliation-context";

const BOUNDED_STRIPE_READ_OPTIONS = {
  maxNetworkRetries: 0,
  timeout: HOSTED_USAGE_CREDIT_STRIPE_PREPARATION_BUDGET.stripeReadTimeoutMs,
};

type MutableUsageCreditPurchase = ReturnType<typeof makeUsageCreditPurchase>;
type UsageCreditStripeLookupFilter = string | { in: string[] };

type UsageCreditStripePrismaHarnessClient = {
  $transaction: <T>(
    callback: (tx: UsageCreditStripePrismaHarnessClient) => Promise<T>,
  ) => Promise<T>;
  hostedUsageCreditPurchase: {
    findMany: (input: {
      where: {
        OR?: Array<Record<string, UsageCreditStripeLookupFilter>>;
      };
    }) => Promise<MutableUsageCreditPurchase[]>;
    findUnique: (input: {
      where: { id: string };
    }) => Promise<MutableUsageCreditPurchase | null>;
    updateMany: (input: {
      data: Partial<MutableUsageCreditPurchase> & {
        reconciliationVersion?: bigint | { increment: bigint };
      };
      where: {
        id: string;
        reconciliationVersion?: bigint;
        status?: { in: HostedUsageCreditPurchaseStatus[] };
      };
    }) => Promise<{ count: number }>;
  };
};

async function reconcileHostedUsageCreditStripeEvent(input: {
  event: Stripe.Event;
  prisma: UsageCreditStripePrismaHarnessClient;
}) {
  // @ts-expect-error - the focused harness implements only the Prisma delegates used here.
  return reconcileHostedUsageCreditStripeEventImpl(input);
}

describe("hosted usage-credit Stripe reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decryptStripeField.mockImplementation(async (input: {
      value: string | null;
    }) => input.value ? "cs_usage_123" : null);
    mocks.encryptStripeField.mockImplementation(async (input: {
      field: string;
      value: string | null;
    }) => input.value ? `encrypted:${input.field}:${input.value}` : null);
    mocks.grantUsageCredit.mockResolvedValue({
      balanceUsdMicros: 5_000_000n,
      entryId: "huce_grant_123",
      granted: true,
      ledgerVersion: 1n,
    });
    mocks.readGrantCapacity.mockResolvedValue({
      expectedPurchaseOwnsReservation: false,
      state: "available",
    });
    mocks.reconcileDisputeNetReversal.mockResolvedValue({
      balanceUsdMicros: 2_500_000n,
      entryId: "huce_dispute_123",
      ledgerVersion: 2n,
      netReversedUsdMicros: 2_500_000n,
      reversedNowUsdMicros: 2_500_000n,
      restoredNowUsdMicros: 0n,
      unmetTargetUsdMicros: 0n,
    });
    mocks.reconcileRefundNetReversal.mockResolvedValue({
      balanceUsdMicros: 2_500_000n,
      entryId: "huce_refund_123",
      ledgerVersion: 2n,
      netReversedUsdMicros: 2_500_000n,
      reversedNowUsdMicros: 2_500_000n,
      restoredNowUsdMicros: 0n,
      unmetTargetUsdMicros: 0n,
    });
    mocks.stripeApiMode.mockReturnValue({
      stripe: mocks.stripe,
      stripeLiveMode: false,
    });
    mocks.stripe.checkout.sessions.list.mockResolvedValue(
      makeCheckoutSessionList([makeCheckoutSession()]),
    );
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValue(
      makeCheckoutSession(),
    );
    mocks.stripe.checkout.sessions.listLineItems.mockResolvedValue(
      makeCheckoutLineItems(),
    );
    mocks.stripe.paymentIntents.retrieve.mockResolvedValue(
      makePaymentIntent(),
    );
    mocks.stripe.charges.retrieve.mockResolvedValue(
      makeCharge({ amountRefunded: 0 }),
    );
    mocks.stripe.refunds.retrieve.mockResolvedValue(makeRefund());
    mocks.stripe.refunds.list.mockResolvedValue(makeRefundList([]));
    mocks.stripe.disputes.retrieve.mockResolvedValue(makeDispute());
    mocks.stripe.disputes.list.mockResolvedValue(makeDisputeList([]));
  });

  it("derives a bounded preparation deadline from every provider read", () => {
    expect(HOSTED_USAGE_CREDIT_STRIPE_PREPARATION_BUDGET.timeoutMs).toBe(
      HOSTED_USAGE_CREDIT_STRIPE_PREPARATION_BUDGET.stripeMaxReads *
          HOSTED_USAGE_CREDIT_STRIPE_PREPARATION_BUDGET.stripeReadTimeoutMs +
        HOSTED_USAGE_CREDIT_STRIPE_PREPARATION_BUDGET.kmsMaxOperations *
          HOSTED_USAGE_CREDIT_STRIPE_PREPARATION_BUDGET.kmsOperationTimeoutMs +
        HOSTED_USAGE_CREDIT_STRIPE_PREPARATION_BUDGET.localMarginMs,
    );
    expect(HOSTED_USAGE_CREDIT_STRIPE_PREPARATION_BUDGET.timeoutMs)
      .toBe(5 * 60_000);
  });

  it("keeps transient official KMS provider failures retryable at reconciliation", async () => {
    const kmsError = Object.assign(new Error("KMS unavailable"), {
      code: "HOSTED_GCP_KMS_PROVIDER_ERROR",
      providerReason: "UNAVAILABLE",
      retryable: false,
      status: null,
    });

    expect(isRetryableHostedUsageCreditDependencyError(kmsError)).toBe(true);
    const error = await runHostedUsageCreditKmsOperation({
      run: async () => {
        throw kmsError;
      },
    }).catch((caught: unknown) => caught);
    expect(isHostedUsageCreditStripeRetryableError(error)).toBe(true);
    expect(error).toEqual(expect.objectContaining({
      cause: kmsError,
      code: "HOSTED_USAGE_CREDIT_STRIPE_RECONCILIATION_RETRYABLE",
    }));
  });

  it("does not retry definitive official KMS provider failures", async () => {
    const kmsError = Object.assign(new Error("KMS permission denied"), {
      code: "HOSTED_GCP_KMS_PROVIDER_ERROR",
      providerReason: "PERMISSION_DENIED",
      retryable: false,
      status: null,
    });

    expect(isRetryableHostedUsageCreditDependencyError(kmsError)).toBe(false);
    const error = await runHostedUsageCreditKmsOperation({
      run: async () => {
        throw kmsError;
      },
    }).catch((caught: unknown) => caught);
    expect(error).toBe(kmsError);
  });

  it("retains legacy and HTTP KMS retry classification compatibility", () => {
    expect(isRetryableHostedUsageCreditDependencyError({
      code: "GOOGLE_CLOUD_API_ERROR",
      status: 503,
    })).toBe(true);
    expect(isRetryableHostedUsageCreditDependencyError({
      code: "HOSTED_GCP_KMS_PROVIDER_ERROR",
      providerReason: "PERMISSION_DENIED",
      retryable: false,
      status: 429,
    })).toBe(true);
    expect(isRetryableHostedUsageCreditDependencyError({
      code: "HOSTED_GCP_KMS_PROVIDER_ERROR",
      providerReason: "INVALID_ARGUMENT",
      retryable: false,
      status: 400,
    })).toBe(false);
  });

  it("times out read-only preparation before entering the member transaction", async () => {
    vi.useFakeTimers();
    try {
      const harness = createUsageCreditStripePrismaHarness();
      mocks.stripe.checkout.sessions.retrieve.mockReturnValue(
        new Promise<Stripe.Checkout.Session>(() => {}),
      );
      const reconciliation = reconcileHostedUsageCreditStripeEvent({
        event: makeCheckoutEvent("checkout.session.completed"),
        prisma: harness.client,
      });
      const rejected = expect(reconciliation).rejects.toThrow(
        "Usage-credit Stripe preparation exceeded its bounded read budget.",
      );

      await vi.advanceTimersByTimeAsync(
        HOSTED_USAGE_CREDIT_STRIPE_PREPARATION_BUDGET.timeoutMs,
      );
      await rejected;
      expect(harness.client.$transaction).not.toHaveBeenCalled();
      expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks a transient Stripe preparation read for receipt-level retry", async () => {
    const harness = createUsageCreditStripePrismaHarness();
    mocks.stripe.checkout.sessions.retrieve.mockRejectedValueOnce(
      new Error("Stripe unavailable"),
    );

    const error = await reconcileHostedUsageCreditStripeEvent({
      event: makeCheckoutEvent("checkout.session.completed"),
      prisma: harness.client,
    }).catch((caught: unknown) => caught);

    expect(isHostedUsageCreditStripeRetryableError(error)).toBe(true);
    expect(error).toEqual(expect.objectContaining({
      code: "HOSTED_USAGE_CREDIT_STRIPE_RECONCILIATION_RETRYABLE",
      message: "Stripe unavailable",
    }));
    expect(harness.client.$transaction).not.toHaveBeenCalled();
    expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
  });

  it("honors a case-insensitive Stripe retry directive over a definitive status", async () => {
    const harness = createUsageCreditStripePrismaHarness();
    const stripeError = Object.assign(new Error("Stripe requested a retry"), {
      headers: {
        "StRiPe-ShOuLd-ReTrY": " TRUE ",
      },
      statusCode: 400,
      type: "StripeInvalidRequestError",
    });
    mocks.stripe.checkout.sessions.retrieve.mockRejectedValueOnce(stripeError);

    const error = await reconcileHostedUsageCreditStripeEvent({
      event: makeCheckoutEvent("checkout.session.completed"),
      prisma: harness.client,
    }).catch((caught: unknown) => caught);

    expect(isHostedUsageCreditStripeRetryableError(error)).toBe(true);
    expect(error).toEqual(expect.objectContaining({
      code: "HOSTED_USAGE_CREDIT_STRIPE_RECONCILIATION_RETRYABLE",
      message: "Stripe requested a retry",
    }));
    expect(harness.client.$transaction).not.toHaveBeenCalled();
    expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
  });

  it("honors a Stripe no-retry directive over a retryable status", async () => {
    const harness = createUsageCreditStripePrismaHarness();
    const stripeError = Object.assign(new Error("Stripe rejected the read"), {
      headers: {
        "STRIPE-SHOULD-RETRY": "false",
      },
      statusCode: 500,
      type: "StripeAPIError",
    });
    mocks.stripe.checkout.sessions.retrieve.mockRejectedValueOnce(stripeError);

    const error = await reconcileHostedUsageCreditStripeEvent({
      event: makeCheckoutEvent("checkout.session.completed"),
      prisma: harness.client,
    }).catch((caught: unknown) => caught);

    expect(error).toBe(stripeError);
    expect(isHostedUsageCreditStripeRetryableError(error)).toBe(false);
    expect(harness.client.$transaction).not.toHaveBeenCalled();
    expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
  });

  it("grants once from verified live paid Checkout state and binds payment identities", async () => {
    const harness = createUsageCreditStripePrismaHarness();
    const event = makeCheckoutEvent("checkout.session.completed");

    await expect(reconcileHostedUsageCreditStripeEvent({
      event,
      prisma: harness.client,
    })).resolves.toEqual({
      beneficiaryMemberId: "member_beneficiary",
      granted: true,
      handled: true,
      purchaseId: "hucp_purchase_123",
      wakeRequired: true,
    });

    expect(mocks.grantUsageCredit).toHaveBeenCalledWith({
      paidAt: new Date("2026-07-16T03:20:00.000Z"),
      purchaseId: "hucp_purchase_123",
      tx: harness.client,
    });
    expect(mocks.stripe.disputes.list).toHaveBeenCalledBefore(
      vi.mocked(harness.client.$transaction),
    );
    expect(mocks.encryptStripeField).toHaveBeenCalledBefore(
      vi.mocked(harness.client.$transaction),
    );
    expect(harness.purchase).toEqual(expect.objectContaining({
      lastReconciledAt: expect.any(Date),
      stripeChargeLookupKey: "stripe-billing-event:ch_usage_123",
      stripeCheckoutSessionLookupKey:
        "stripe-checkout-session:cs_usage_123",
      stripePaymentIntentLookupKey: "stripe-billing-event:pi_usage_123",
    }));
  });

  it.each([
    "hosted-usage-credit-checkout-v2",
    "hosted-usage-credit-checkout-v3",
    "hosted-usage-credit-checkout-v4",
  ])("grants once from an owned %s saved-card PaymentIntent without Checkout", async (
    policyVersion,
  ) => {
    const harness = createUsageCreditStripePrismaHarness({
      checkoutRequestPolicyVersion: policyVersion,
      status: HostedUsageCreditPurchaseStatus.payment_pending,
      stripeChargeLookupKey: "stripe-billing-event:ch_usage_123",
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey: null,
      stripePaymentIntentLookupKey: "stripe-billing-event:pi_usage_123",
    });
    const paymentIntent = makePaymentIntent({
      policyVersion,
      purpose: "saved_card",
    });
    mocks.stripe.paymentIntents.retrieve.mockResolvedValue(paymentIntent);

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeDirectPaymentEvent("payment_intent.succeeded", paymentIntent),
      prisma: harness.client,
    })).resolves.toEqual({
      beneficiaryMemberId: "member_beneficiary",
      granted: true,
      handled: true,
      purchaseId: "hucp_purchase_123",
      wakeRequired: true,
    });

    expect(mocks.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.list).not.toHaveBeenCalled();
    expect(mocks.grantUsageCredit).toHaveBeenCalledOnce();
    expect(harness.purchase).toEqual(expect.objectContaining({
      stripeChargeLookupKey: "stripe-billing-event:ch_usage_123",
      stripeCheckoutSessionLookupKey: null,
      stripePaymentIntentLookupKey: "stripe-billing-event:pi_usage_123",
    }));
  });

  it("rejects v2 saved-card proof for a personal purchase", async () => {
    const personalSuccessUrl =
      "https://murph.example/settings?usageCheckout=success&usagePurchase=hucp_purchase_123#subscription";
    const harness = createUsageCreditStripePrismaHarness({
      beneficiaryMemberId: "member_payer",
      checkoutCancelUrl:
        "https://murph.example/settings?usageCheckout=cancel&usagePurchase=hucp_purchase_123#subscription",
      checkoutRequestPolicyVersion: "hosted-usage-credit-checkout-v2",
      checkoutSuccessUrl: personalSuccessUrl,
      status: HostedUsageCreditPurchaseStatus.payment_pending,
      stripeChargeLookupKey: "stripe-billing-event:ch_usage_123",
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey: null,
      stripePaymentIntentLookupKey: "stripe-billing-event:pi_usage_123",
    });
    const paymentIntent = makePaymentIntent({
      policyVersion: "hosted-usage-credit-checkout-v2",
      purpose: "saved_card",
    });
    mocks.stripe.paymentIntents.retrieve.mockResolvedValue(paymentIntent);

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeDirectPaymentEvent("payment_intent.succeeded", paymentIntent),
      prisma: harness.client,
    })).rejects.toThrow("Usage-credit payment policy did not match.");

    expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
  });

  it("keeps an owned processing saved-card PaymentIntent pending", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      checkoutRequestPolicyVersion: "hosted-usage-credit-checkout-v2",
      status: HostedUsageCreditPurchaseStatus.payment_pending,
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey: null,
      stripePaymentIntentLookupKey: "stripe-billing-event:pi_usage_123",
    });
    const paymentIntent = makePaymentIntent({
      amountReceived: 0,
      latestCharge: null,
      purpose: "saved_card",
      status: "processing",
    });
    mocks.stripe.paymentIntents.retrieve.mockResolvedValue(paymentIntent);

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeDirectPaymentEvent("payment_intent.processing", paymentIntent),
      prisma: harness.client,
    })).resolves.toMatchObject({
      granted: false,
      handled: true,
      wakeRequired: false,
    });

    expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
    expect(harness.purchase).toEqual(expect.objectContaining({
      status: HostedUsageCreditPurchaseStatus.payment_pending,
      terminalAt: null,
    }));
  });

  it("keeps an unbound saved-card success retryable instead of consuming it", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      checkoutRequestPolicyVersion: "hosted-usage-credit-checkout-v2",
      status: HostedUsageCreditPurchaseStatus.created,
      stripeChargeLookupKey: null,
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey: null,
      stripePaymentIntentLookupKey: null,
    });
    const paymentIntent = makePaymentIntent({ purpose: "saved_card" });

    const result = reconcileHostedUsageCreditStripeEvent({
      event: makeDirectPaymentEvent("payment_intent.succeeded", paymentIntent),
      prisma: harness.client,
    });
    await expect(result).rejects.toSatisfy(
      isHostedUsageCreditStripeRetryableError,
    );

    expect(mocks.stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
    expect(harness.purchase.status).toBe(
      HostedUsageCreditPurchaseStatus.created,
    );
  });

  it.each([
    ["payment_intent.payment_failed", "requires_payment_method"],
    ["payment_intent.canceled", "canceled"],
  ] as const)(
    "keeps an owned saved-card PaymentIntent pending after %s",
    async (eventType, status) => {
      const harness = createUsageCreditStripePrismaHarness({
        checkoutRequestPolicyVersion: "hosted-usage-credit-checkout-v2",
        status: HostedUsageCreditPurchaseStatus.payment_pending,
        stripeCheckoutSessionIdEncrypted: null,
        stripeCheckoutSessionLookupKey: null,
        stripePaymentIntentLookupKey: "stripe-billing-event:pi_usage_123",
      });
      const paymentIntent = makePaymentIntent({
        amountReceived: 0,
        latestCharge: null,
        purpose: "saved_card",
        status,
      });
      mocks.stripe.paymentIntents.retrieve.mockResolvedValue(paymentIntent);

      await expect(reconcileHostedUsageCreditStripeEvent({
        event: makeDirectPaymentEvent(eventType, paymentIntent),
        prisma: harness.client,
      })).resolves.toMatchObject({
        granted: false,
        handled: true,
        wakeRequired: false,
      });

      expect(mocks.stripe.paymentIntents.retrieve).toHaveBeenCalledWith(
        "pi_usage_123",
        { expand: ["latest_charge"] },
        BOUNDED_STRIPE_READ_OPTIONS,
      );
      expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
      expect(harness.purchase).toEqual(expect.objectContaining({
        grantSlotReleasedAt: null,
        status: HostedUsageCreditPurchaseStatus.payment_pending,
        terminalAt: null,
      }));
    },
  );

  it("acknowledges a terminal saved-card event after Checkout fallback owns the purchase", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      checkoutRequestPolicyVersion: "hosted-usage-credit-checkout-v2",
      status: HostedUsageCreditPurchaseStatus.checkout_open,
      stripePaymentIntentLookupKey:
        "stripe-billing-event:pi_checkout_replacement",
    });
    const paymentIntent = makePaymentIntent({
      amountReceived: 0,
      latestCharge: null,
      purpose: "saved_card",
      status: "canceled",
    });

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeDirectPaymentEvent("payment_intent.canceled", paymentIntent),
      prisma: harness.client,
    })).resolves.toEqual({
      beneficiaryMemberId: "member_beneficiary",
      granted: false,
      handled: true,
      purchaseId: "hucp_purchase_123",
      wakeRequired: false,
    });

    expect(mocks.stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
    expect(harness.purchase.status).toBe(
      HostedUsageCreditPurchaseStatus.checkout_open,
    );
  });

  it("restores a locally expired delayed Checkout reservation and later grants async success", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      status: HostedUsageCreditPurchaseStatus.expired,
      terminalAt: new Date("2026-07-16T04:50:01.000Z"),
    });
    mocks.stripe.checkout.sessions.retrieve
      .mockResolvedValueOnce(makeCheckoutSession({ paymentStatus: "unpaid" }))
      .mockResolvedValueOnce(makeCheckoutSession());
    mocks.stripe.paymentIntents.retrieve
      .mockResolvedValueOnce(makePaymentIntent({ status: "processing" }))
      .mockResolvedValueOnce(makePaymentIntent());

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeCheckoutEvent("checkout.session.completed"),
      prisma: harness.client,
    })).resolves.toMatchObject({
      granted: false,
      handled: true,
    });

    expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
    expect(harness.purchase).toEqual(expect.objectContaining({
      grantSlotReleasedAt: null,
      status: HostedUsageCreditPurchaseStatus.payment_pending,
      terminalAt: null,
    }));

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeCheckoutEvent("checkout.session.async_payment_succeeded"),
      prisma: harness.client,
    })).resolves.toMatchObject({
      granted: true,
      handled: true,
    });

    expect(mocks.grantUsageCredit).toHaveBeenCalledOnce();
  });

  it("fulfills a delayed payment from asynchronous success", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      status: HostedUsageCreditPurchaseStatus.payment_pending,
    });

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeCheckoutEvent("checkout.session.async_payment_succeeded"),
      prisma: harness.client,
    })).resolves.toMatchObject({
      granted: true,
      handled: true,
    });

    expect(mocks.grantUsageCredit).toHaveBeenCalledOnce();
  });

  it("adopts a verified Session when its webhook beats producer attachment", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      stripeCheckoutSessionLookupKey: null,
    });

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeCheckoutEvent("checkout.session.completed"),
      prisma: harness.client,
    })).resolves.toMatchObject({
      granted: true,
      handled: true,
      wakeRequired: true,
    });

    expect(harness.purchase.stripeCheckoutSessionLookupKey).toBe(
      "stripe-checkout-session:cs_usage_123",
    );
    expect(mocks.grantUsageCredit).toHaveBeenCalledOnce();
  });

  it("closes an asynchronously failed payment without granting credit", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      status: HostedUsageCreditPurchaseStatus.payment_pending,
    });
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValue(
      makeCheckoutSession({ paymentStatus: "unpaid" }),
    );
    mocks.stripe.paymentIntents.retrieve.mockResolvedValue(
      makePaymentIntent({ status: "requires_payment_method" }),
    );

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeCheckoutEvent("checkout.session.async_payment_failed"),
      prisma: harness.client,
    })).resolves.toMatchObject({
      granted: false,
      handled: true,
    });

    expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
    expect(harness.purchase).toEqual(expect.objectContaining({
      grantSlotReleasedAt: null,
      status: HostedUsageCreditPurchaseStatus.payment_failed,
      terminalAt: new Date("2026-07-16T03:20:00.000Z"),
    }));
  });

  it("does not move a terminal payment failure backward on an older unpaid completion", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      status: HostedUsageCreditPurchaseStatus.payment_pending,
    });
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValue(
      makeCheckoutSession({ paymentStatus: "unpaid" }),
    );
    mocks.stripe.paymentIntents.retrieve.mockResolvedValue(
      makePaymentIntent({ status: "requires_payment_method" }),
    );

    await reconcileHostedUsageCreditStripeEvent({
      event: makeCheckoutEvent("checkout.session.async_payment_failed"),
      prisma: harness.client,
    });
    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeCheckoutEvent("checkout.session.completed"),
      prisma: harness.client,
    })).resolves.toMatchObject({
      granted: false,
      handled: true,
      wakeRequired: false,
    });

    expect(harness.purchase).toEqual(expect.objectContaining({
      status: HostedUsageCreditPurchaseStatus.payment_failed,
    }));
    expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
  });

  it("releases a slot only from a live provider-expired unpaid Session and preserves it on replay", async () => {
    const harness = createUsageCreditStripePrismaHarness();
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValue(
      makeCheckoutSession({ paymentIntentId: null, paymentStatus: "unpaid", status: "expired" }),
    );

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeCheckoutEvent("checkout.session.expired"),
      prisma: harness.client,
    })).resolves.toMatchObject({
      granted: false,
      handled: true,
    });

    expect(mocks.stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
    expect(harness.purchase).toEqual(expect.objectContaining({
      grantSlotReleasedAt: expect.any(Date),
      status: HostedUsageCreditPurchaseStatus.expired,
    }));
    expect(mocks.lockPurchaseReservationOwners).toHaveBeenLastCalledWith({
      beneficiaryMemberId: "member_beneficiary",
      payerMemberId: "member_payer",
      tx: harness.client,
    });

    const releasedAt = harness.purchase.grantSlotReleasedAt;
    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeCheckoutEvent("checkout.session.expired"),
      prisma: harness.client,
    })).resolves.toMatchObject({
      granted: false,
      handled: true,
    });

    expect(harness.purchase.grantSlotReleasedAt).toEqual(releasedAt);
    expect(mocks.lockPurchaseReservationOwners).toHaveBeenCalledOnce();
    const updateMany = vi.mocked(
      harness.client.hostedUsageCreditPurchase.updateMany,
    );
    expect(updateMany).toHaveBeenCalledOnce();
    expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
  });

  it("replays a provider-final release after account deletion detached the payer", async () => {
    const releasedAt = new Date("2026-07-16T04:55:00.000Z");
    const harness = createUsageCreditStripePrismaHarness({
      grantSlotReleasedAt: releasedAt,
      payerMemberId: null,
      status: HostedUsageCreditPurchaseStatus.expired,
      stripeCheckoutSessionIdEncrypted: null,
      terminalAt: new Date("2026-07-16T03:20:00.000Z"),
    });
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValue(
      makeCheckoutSession({
        paymentIntentId: null,
        paymentStatus: "unpaid",
        status: "expired",
      }),
    );

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeCheckoutEvent("checkout.session.expired"),
      prisma: harness.client,
    })).resolves.toMatchObject({
      granted: false,
      handled: true,
      wakeRequired: false,
    });

    expect(harness.purchase.grantSlotReleasedAt).toEqual(releasedAt);
    expect(harness.purchase.payerMemberId).toBeNull();
    expect(mocks.lockPurchaseReservationOwners).not.toHaveBeenCalled();
  });

  it("fails closed when live paid Checkout contradicts provider-final release", async () => {
    const releasedAt = new Date("2026-07-16T04:55:00.000Z");
    const harness = createUsageCreditStripePrismaHarness({
      grantSlotReleasedAt: releasedAt,
      status: HostedUsageCreditPurchaseStatus.expired,
      terminalAt: new Date("2026-07-16T03:20:00.000Z"),
    });

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeCheckoutEvent("checkout.session.completed"),
      prisma: harness.client,
    })).rejects.toThrow(
      "Provider-final usage-credit Checkout release contradicted live Stripe state.",
    );

    expect(harness.purchase.grantSlotReleasedAt).toEqual(releasedAt);
    expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
  });

  it("acknowledges an unknown safely expired Checkout after purchase deletion", async () => {
    const harness = createUsageCreditStripePrismaHarness(undefined, {
      purchaseExists: false,
    });
    const expiredSession = makeCheckoutSession({
      paymentIntentId: null,
      paymentStatus: "unpaid",
      status: "expired",
    });
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValue(expiredSession);
    const event = makeCheckoutEvent("checkout.session.expired");
    event.data.object = expiredSession;

    await expect(reconcileHostedUsageCreditStripeEvent({
      event,
      prisma: harness.client,
    })).resolves.toEqual({
      beneficiaryMemberId: null,
      granted: false,
      handled: true,
      purchaseId: "hucp_purchase_123",
      wakeRequired: false,
    });

    expect(harness.client.$transaction).not.toHaveBeenCalled();
    expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
  });

  it("rejects an unknown paid Checkout even when its event says expired", async () => {
    const harness = createUsageCreditStripePrismaHarness(undefined, {
      purchaseExists: false,
    });

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeCheckoutEvent("checkout.session.expired"),
      prisma: harness.client,
    })).rejects.toThrow(
      "Deleted usage-credit Checkout did not have safe expired state.",
    );

    expect(harness.client.$transaction).not.toHaveBeenCalled();
    expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
  });

  it("rejects a spoofed Price before granting credit", async () => {
    const harness = createUsageCreditStripePrismaHarness();
    mocks.stripe.checkout.sessions.listLineItems.mockResolvedValue(
      makeCheckoutLineItems({ priceId: "price_wrong" }),
    );

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeCheckoutEvent("checkout.session.completed"),
      prisma: harness.client,
    })).rejects.toThrow("Usage-credit Stripe identity did not match its purchase.");

    expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
  });

  it("rejects test-mode usage-credit events when production requires live Stripe", async () => {
    const harness = createUsageCreditStripePrismaHarness();
    mocks.stripeApiMode.mockImplementationOnce(() => {
      throw new Error("HOSTED_USAGE_CREDIT_LIVE_STRIPE_REQUIRED");
    });

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeCheckoutEvent("checkout.session.completed"),
      prisma: harness.client,
    })).rejects.toThrow("HOSTED_USAGE_CREDIT_LIVE_STRIPE_REQUIRED");

    expect(mocks.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
  });

  it("rejects a financial event from the opposite Stripe mode before lookup", async () => {
    const harness = createUsageCreditStripePrismaHarness();
    const event = {
      ...makeRefundEvent(),
      livemode: true,
    } as Stripe.Event;

    await expect(reconcileHostedUsageCreditStripeEvent({
      event,
      prisma: harness.client,
    })).rejects.toThrow("Usage-credit Stripe event environment did not match.");

    expect(harness.client.hostedUsageCreditPurchase.findMany).not.toHaveBeenCalled();
    expect(mocks.stripe.charges.retrieve).not.toHaveBeenCalled();
    expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
  });

  it("rejects a discounted Checkout total before granting full credit", async () => {
    const harness = createUsageCreditStripePrismaHarness();
    mocks.stripe.checkout.sessions.retrieve.mockResolvedValue(
      makeCheckoutSession({ amountTotal: 400 }),
    );
    mocks.stripe.paymentIntents.retrieve.mockResolvedValue({
      ...makePaymentIntent(),
      amount: 400,
      amount_received: 400,
    });

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeCheckoutEvent("checkout.session.completed"),
      prisma: harness.client,
    })).rejects.toThrow("Usage-credit Checkout amount or currency did not match.");

    expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
  });

  it("does not claim an ordinary subscription Checkout event", async () => {
    const harness = createUsageCreditStripePrismaHarness();
    const event = makeCheckoutEvent("checkout.session.completed");
    (event.data.object as Stripe.Checkout.Session).metadata = {
      memberId: "member_beneficiary",
    };

    await expect(reconcileHostedUsageCreditStripeEvent({
      event,
      prisma: harness.client,
    })).resolves.toEqual({ handled: false });

    expect(mocks.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
  });

  it("reconciles a successful refund proportionally before subscription handling", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      status: HostedUsageCreditPurchaseStatus.fulfilled,
      stripeChargeLookupKey: "stripe-billing-event:ch_usage_123",
      stripePaymentIntentLookupKey: "stripe-billing-event:pi_usage_123",
    });
    mocks.stripe.charges.retrieve.mockResolvedValue(
      makeCharge({ amountRefunded: 250 }),
    );
    mocks.stripe.refunds.list.mockResolvedValue(
      makeRefundList([makeRefund()]),
    );
    mockExistingUsageCreditGrant();

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeRefundEvent(),
      prisma: harness.client,
    })).resolves.toEqual({
      beneficiaryMemberId: "member_beneficiary",
      granted: false,
      handled: true,
      purchaseId: "hucp_purchase_123",
      wakeRequired: true,
    });

    expect(mocks.reconcileRefundNetReversal).toHaveBeenCalledTimes(2);
    expect(mocks.reconcileRefundNetReversal).toHaveBeenCalledWith({
      effectiveAt: new Date("2026-07-16T03:25:00.000Z"),
      purchaseId: "hucp_purchase_123",
      sourceReferenceLookupKey: "stripe-billing-event:re_usage_123",
      targetNetReversalUsdMicros: 2_500_000n,
      tx: harness.client,
    });
    expect(mocks.grantUsageCredit).toHaveBeenCalledOnce();
    expect(mocks.decryptStripeField).toHaveBeenCalledBefore(
      vi.mocked(harness.client.$transaction),
    );
    expect(mocks.decryptStripeField).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.encryptStripeField).toHaveBeenCalledBefore(
      vi.mocked(harness.client.$transaction),
    );
    expect(mocks.encryptStripeField).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(
      mocks.decryptStripeField.mock.calls.length +
        mocks.encryptStripeField.mock.calls.length,
    ).toBe(HOSTED_USAGE_CREDIT_STRIPE_PREPARATION_BUDGET.kmsMaxOperations);
  });

  it("reconciles a saved-card refund without requiring Checkout", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      checkoutRequestPolicyVersion: "hosted-usage-credit-checkout-v2",
      status: HostedUsageCreditPurchaseStatus.fulfilled,
      stripeChargeLookupKey: "stripe-billing-event:ch_usage_123",
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey: null,
      stripePaymentIntentLookupKey: "stripe-billing-event:pi_usage_123",
    });
    mocks.stripe.paymentIntents.retrieve.mockResolvedValue(
      makePaymentIntent({ purpose: "saved_card" }),
    );
    mocks.stripe.charges.retrieve.mockResolvedValue(
      makeCharge({ amountRefunded: 250 }),
    );
    mocks.stripe.refunds.list.mockResolvedValue(
      makeRefundList([makeRefund()]),
    );
    mockExistingUsageCreditGrant();

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeRefundEvent(),
      prisma: harness.client,
    })).resolves.toMatchObject({
      granted: false,
      handled: true,
      wakeRequired: true,
    });

    expect(mocks.stripe.checkout.sessions.list).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(mocks.reconcileRefundNetReversal).toHaveBeenCalled();
  });

  it("reconciles a direct refund after the payer account was detached", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      checkoutRequestPolicyVersion: "hosted-usage-credit-checkout-v2",
      payerMemberId: null,
      status: HostedUsageCreditPurchaseStatus.fulfilled,
      stripeChargeLookupKey: "stripe-billing-event:ch_usage_123",
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey: null,
      stripePaymentIntentLookupKey: "stripe-billing-event:pi_usage_123",
      terminalAt: new Date("2026-07-16T03:20:00.000Z"),
    });
    mocks.stripe.paymentIntents.retrieve.mockResolvedValue(
      makePaymentIntent({ purpose: "saved_card" }),
    );
    mocks.stripe.charges.retrieve.mockResolvedValue(
      makeCharge({ amountRefunded: 250 }),
    );
    mocks.stripe.refunds.list.mockResolvedValue(
      makeRefundList([makeRefund()]),
    );
    mockExistingUsageCreditGrant();

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeRefundEvent(),
      prisma: harness.client,
    })).resolves.toMatchObject({
      beneficiaryMemberId: "member_beneficiary",
      handled: true,
      purchaseId: "hucp_purchase_123",
    });

    expect(mocks.stripe.checkout.sessions.list).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(mocks.decryptStripeField).not.toHaveBeenCalled();
    expect(mocks.encryptStripeField).not.toHaveBeenCalled();
    expect(mocks.reconcileRefundNetReversal).toHaveBeenCalled();
    expect(harness.purchase.payerMemberId).toBeNull();
  });

  it("reconciles a terminal refund after the payer account was detached", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      payerMemberId: null,
      status: HostedUsageCreditPurchaseStatus.fulfilled,
      stripeChargeLookupKey: "stripe-billing-event:ch_usage_123",
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey:
        "stripe-checkout-session:cs_usage_123",
      stripePaymentIntentLookupKey: "stripe-billing-event:pi_usage_123",
      terminalAt: new Date("2026-07-16T03:20:00.000Z"),
    });
    mocks.stripe.charges.retrieve.mockResolvedValue(
      makeCharge({ amountRefunded: 250 }),
    );
    mocks.stripe.refunds.list.mockResolvedValue(
      makeRefundList([makeRefund()]),
    );
    mockExistingUsageCreditGrant();

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeRefundEvent(),
      prisma: harness.client,
    })).resolves.toMatchObject({
      beneficiaryMemberId: "member_beneficiary",
      handled: true,
      purchaseId: "hucp_purchase_123",
    });

    expect(mocks.reconcileRefundNetReversal).toHaveBeenCalled();
    expect(mocks.decryptStripeField).not.toHaveBeenCalled();
    expect(mocks.encryptStripeField).not.toHaveBeenCalled();
    expect(harness.purchase.payerMemberId).toBeNull();
  });

  it("reconciles a terminal dispute after the payer account was detached", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      payerMemberId: null,
      status: HostedUsageCreditPurchaseStatus.fulfilled,
      stripeChargeLookupKey: "stripe-billing-event:ch_usage_123",
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey:
        "stripe-checkout-session:cs_usage_123",
      stripePaymentIntentLookupKey: "stripe-billing-event:pi_usage_123",
      terminalAt: new Date("2026-07-16T03:20:00.000Z"),
    });
    mocks.stripe.disputes.list.mockResolvedValue(
      makeDisputeList([makeDispute({ withdrawnAmount: 250 })]),
    );
    mockExistingUsageCreditGrant();

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeDisputeEvent("charge.dispute.funds_withdrawn"),
      prisma: harness.client,
    })).resolves.toMatchObject({
      beneficiaryMemberId: "member_beneficiary",
      handled: true,
      purchaseId: "hucp_purchase_123",
    });

    expect(mocks.reconcileDisputeNetReversal).toHaveBeenCalled();
    expect(mocks.decryptStripeField).not.toHaveBeenCalled();
    expect(mocks.encryptStripeField).not.toHaveBeenCalled();
    expect(harness.purchase.payerMemberId).toBeNull();
  });

  it("reconciles a direct dispute after the payer account was detached", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      checkoutRequestPolicyVersion: "hosted-usage-credit-checkout-v2",
      payerMemberId: null,
      status: HostedUsageCreditPurchaseStatus.fulfilled,
      stripeChargeLookupKey: "stripe-billing-event:ch_usage_123",
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey: null,
      stripePaymentIntentLookupKey: "stripe-billing-event:pi_usage_123",
      terminalAt: new Date("2026-07-16T03:20:00.000Z"),
    });
    mocks.stripe.paymentIntents.retrieve.mockResolvedValue(
      makePaymentIntent({ purpose: "saved_card" }),
    );
    mocks.stripe.disputes.list.mockResolvedValue(
      makeDisputeList([makeDispute({ withdrawnAmount: 250 })]),
    );
    mockExistingUsageCreditGrant();

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeDisputeEvent("charge.dispute.funds_withdrawn"),
      prisma: harness.client,
    })).resolves.toMatchObject({
      beneficiaryMemberId: "member_beneficiary",
      handled: true,
      purchaseId: "hucp_purchase_123",
    });

    expect(mocks.stripe.checkout.sessions.list).not.toHaveBeenCalled();
    expect(mocks.stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(mocks.decryptStripeField).not.toHaveBeenCalled();
    expect(mocks.encryptStripeField).not.toHaveBeenCalled();
    expect(mocks.reconcileDisputeNetReversal).toHaveBeenCalled();
    expect(harness.purchase.payerMemberId).toBeNull();
  });

  it("atomically grants then reverses when a refund beats Checkout fulfillment", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      status: HostedUsageCreditPurchaseStatus.checkout_open,
      stripeChargeLookupKey: null,
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey: null,
      stripePaymentIntentLookupKey: null,
    });
    mocks.stripe.paymentIntents.retrieve.mockResolvedValue(
      makePaymentIntent(),
    );
    mocks.stripe.charges.retrieve.mockResolvedValue(
      makeCharge({ amountRefunded: 500 }),
    );
    mocks.stripe.refunds.list.mockResolvedValue(
      makeRefundList([makeRefund({ amount: 500 })]),
    );
    mocks.reconcileRefundNetReversal.mockResolvedValue(
      makeNetReversalResult({
        balanceUsdMicros: 0n,
        netReversedUsdMicros: 5_000_000n,
        reversedNowUsdMicros: 5_000_000n,
      }),
    );

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeRefundEvent(),
      prisma: harness.client,
    })).resolves.toMatchObject({
      granted: true,
      handled: true,
      wakeRequired: false,
    });

    expect(mocks.stripe.paymentIntents.retrieve).toHaveBeenCalledWith(
      "pi_usage_123",
      undefined,
      BOUNDED_STRIPE_READ_OPTIONS,
    );
    expect(mocks.stripe.checkout.sessions.list).toHaveBeenCalledWith(
      {
        limit: 2,
        payment_intent: "pi_usage_123",
      },
      BOUNDED_STRIPE_READ_OPTIONS,
    );
    expect(mocks.stripe.checkout.sessions.listLineItems).toHaveBeenCalledBefore(
      mocks.grantUsageCredit,
    );
    expect(mocks.grantUsageCredit).toHaveBeenCalledBefore(
      mocks.reconcileRefundNetReversal,
    );
    expect(mocks.reconcileRefundNetReversal).toHaveBeenCalledWith(
      expect.objectContaining({
        targetNetReversalUsdMicros: 5_000_000n,
      }),
    );
    expect([
      mocks.stripe.charges.retrieve,
      mocks.stripe.paymentIntents.retrieve,
      mocks.stripe.refunds.retrieve,
      mocks.stripe.refunds.list,
      mocks.stripe.disputes.retrieve,
      mocks.stripe.disputes.list,
      mocks.stripe.checkout.sessions.list,
      mocks.stripe.checkout.sessions.retrieve,
      mocks.stripe.checkout.sessions.listLineItems,
    ].reduce((total, mock) => total + mock.mock.calls.length, 0)).toBe(
      HOSTED_USAGE_CREDIT_STRIPE_PREPARATION_BUDGET.stripeMaxReads,
    );
  });

  it("rejects an early financial event whose Checkout used the wrong Price", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      status: HostedUsageCreditPurchaseStatus.checkout_open,
      stripeChargeLookupKey: null,
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey: null,
      stripePaymentIntentLookupKey: null,
    });
    mocks.stripe.charges.retrieve.mockResolvedValue(
      makeCharge({ amountRefunded: 250 }),
    );
    mocks.stripe.refunds.list.mockResolvedValue(
      makeRefundList([makeRefund()]),
    );
    mocks.stripe.checkout.sessions.listLineItems.mockResolvedValue(
      makeCheckoutLineItems({ priceId: "price_wrong" }),
    );

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeRefundEvent(),
      prisma: harness.client,
    })).rejects.toThrow("Usage-credit Stripe identity did not match its purchase.");

    expect(mocks.stripe.checkout.sessions.list).toHaveBeenCalledWith(
      {
        limit: 2,
        payment_intent: "pi_usage_123",
      },
      BOUNDED_STRIPE_READ_OPTIONS,
    );
    expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
    expect(mocks.reconcileRefundNetReversal).not.toHaveBeenCalled();
  });

  it("rejects an early financial event with an ambiguous Checkout association", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      status: HostedUsageCreditPurchaseStatus.checkout_open,
      stripeChargeLookupKey: null,
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey: null,
      stripePaymentIntentLookupKey: null,
    });
    mocks.stripe.charges.retrieve.mockResolvedValue(
      makeCharge({ amountRefunded: 250 }),
    );
    mocks.stripe.refunds.list.mockResolvedValue(
      makeRefundList([makeRefund()]),
    );
    mocks.stripe.checkout.sessions.list.mockResolvedValue(
      makeCheckoutSessionList([
        makeCheckoutSession(),
        { ...makeCheckoutSession(), id: "cs_usage_other" },
      ]),
    );

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeRefundEvent(),
      prisma: harness.client,
    })).rejects.toThrow(
      "Usage-credit payment did not resolve to exactly one Checkout Session.",
    );

    expect(mocks.grantUsageCredit).not.toHaveBeenCalled();
  });

  it.each(["pending", "requires_action"] as const)(
    "reserves credit while a refund is %s",
    async (status) => {
      const harness = createUsageCreditStripePrismaHarness({
        status: HostedUsageCreditPurchaseStatus.fulfilled,
        stripeChargeLookupKey: "stripe-billing-event:ch_usage_123",
        stripePaymentIntentLookupKey: "stripe-billing-event:pi_usage_123",
      });
      const refund = makeRefund({ status });
      mocks.stripe.charges.retrieve.mockResolvedValue(
        makeCharge({ amountRefunded: 0 }),
      );
      mocks.stripe.refunds.retrieve.mockResolvedValue(refund);
      mocks.stripe.refunds.list.mockResolvedValue(makeRefundList([refund]));
      mockExistingUsageCreditGrant();

      await expect(reconcileHostedUsageCreditStripeEvent({
        event: makeRefundEvent("refund.updated"),
        prisma: harness.client,
      })).resolves.toMatchObject({ handled: true });

      expect(mocks.reconcileRefundNetReversal).toHaveBeenCalledWith(
        expect.objectContaining({
          targetNetReversalUsdMicros: 2_500_000n,
        }),
      );
    },
  );

  it("rejects a stale pending-refund snapshot after a newer failed snapshot applies", async () => {
    const firstApplyReached = createDeferred();
    const releaseFirstApply = createDeferred();
    const harness = createUsageCreditStripePrismaHarness(
      {
        status: HostedUsageCreditPurchaseStatus.fulfilled,
        stripeChargeLookupKey: "stripe-billing-event:ch_usage_123",
        stripePaymentIntentLookupKey: "stripe-billing-event:pi_usage_123",
      },
      {
        beforeTransaction: async (call) => {
          if (call === 1) {
            firstApplyReached.resolve();
            await releaseFirstApply.promise;
          }
        },
      },
    );
    const pendingRefund = makeRefund({ status: "pending" });
    mocks.stripe.charges.retrieve.mockResolvedValue(
      makeCharge({ amountRefunded: 0 }),
    );
    mocks.stripe.refunds.retrieve.mockResolvedValue(pendingRefund);
    mocks.stripe.refunds.list.mockResolvedValue(
      makeRefundList([pendingRefund]),
    );
    mockExistingUsageCreditGrant();

    const stalePending = reconcileHostedUsageCreditStripeEvent({
      event: makeRefundEvent("refund.updated"),
      prisma: harness.client,
    });
    const stalePendingExpectation = expect(stalePending).rejects.toThrow(
      "Usage-credit Stripe preparation became stale before reconciliation.",
    );
    await firstApplyReached.promise;

    const failedRefund = makeRefund({ status: "failed" });
    mocks.stripe.refunds.retrieve.mockResolvedValue(failedRefund);
    mocks.stripe.refunds.list.mockResolvedValue(
      makeRefundList([failedRefund]),
    );
    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeRefundEvent("refund.failed"),
      prisma: harness.client,
    })).resolves.toMatchObject({ handled: true });

    releaseFirstApply.resolve();
    await stalePendingExpectation;
    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeRefundEvent("refund.updated"),
      prisma: harness.client,
    })).resolves.toMatchObject({ handled: true });

    expect(harness.purchase.reconciliationVersion).toBe(2n);
    expect(mocks.reconcileRefundNetReversal).toHaveBeenCalledTimes(4);
    expect(mocks.reconcileRefundNetReversal).not.toHaveBeenCalledWith(
      expect.objectContaining({ targetNetReversalUsdMicros: 2_500_000n }),
    );
    expect(mocks.reconcileRefundNetReversal).toHaveBeenCalledWith(
      expect.objectContaining({ targetNetReversalUsdMicros: 0n }),
    );
  });

  it("converges cumulative refunds from charge.refunded with Refund provenance", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      status: HostedUsageCreditPurchaseStatus.fulfilled,
      stripeChargeLookupKey: "stripe-billing-event:ch_usage_123",
      stripePaymentIntentLookupKey: "stripe-billing-event:pi_usage_123",
    });
    mocks.stripe.charges.retrieve.mockResolvedValue(
      makeCharge({ amountRefunded: 250 }),
    );
    mocks.stripe.refunds.list.mockResolvedValue(
      makeRefundList([makeRefund()]),
    );
    mockExistingUsageCreditGrant();

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeChargeRefundedEvent(),
      prisma: harness.client,
    })).resolves.toEqual({
      beneficiaryMemberId: "member_beneficiary",
      granted: false,
      handled: true,
      purchaseId: "hucp_purchase_123",
      wakeRequired: true,
    });

    expect(mocks.stripe.refunds.list).toHaveBeenCalledWith(
      {
        charge: "ch_usage_123",
        limit: 100,
      },
      BOUNDED_STRIPE_READ_OPTIONS,
    );
    expect(mocks.reconcileRefundNetReversal).toHaveBeenCalledWith({
      effectiveAt: new Date("2026-07-16T03:25:00.000Z"),
      purchaseId: "hucp_purchase_123",
      sourceReferenceLookupKey: "stripe-billing-event:re_usage_123",
      targetNetReversalUsdMicros: 2_500_000n,
      tx: harness.client,
    });
  });

  it("restores a later-failed refund when an older charge.refunded event retries", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      status: HostedUsageCreditPurchaseStatus.fulfilled,
      stripeChargeLookupKey: "stripe-billing-event:ch_usage_123",
      stripePaymentIntentLookupKey: "stripe-billing-event:pi_usage_123",
    });
    mocks.stripe.charges.retrieve.mockResolvedValue(
      makeCharge({ amountRefunded: 0 }),
    );
    mocks.stripe.refunds.list.mockResolvedValue(
      makeRefundList([makeRefund({ status: "failed" })]),
    );
    mockExistingUsageCreditGrant();

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeChargeRefundedEvent(),
      prisma: harness.client,
    })).resolves.toMatchObject({
      granted: false,
      handled: true,
      wakeRequired: true,
    });

    expect(mocks.reconcileRefundNetReversal).toHaveBeenCalledWith(
      expect.objectContaining({ targetNetReversalUsdMicros: 0n }),
    );
  });

  it("finds stored payment references and dispute history across key rotation", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      status: HostedUsageCreditPurchaseStatus.fulfilled,
      stripeChargeLookupKey:
        "stripe-billing-event:previous:ch_usage_123",
      stripePaymentIntentLookupKey:
        "stripe-billing-event:previous:pi_usage_123",
    });
    mocks.stripe.disputes.list.mockResolvedValue(
      makeDisputeList([makeDispute({ withdrawnAmount: 250 })]),
    );
    mockExistingUsageCreditGrant();

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeDisputeEvent("charge.dispute.funds_withdrawn"),
      prisma: harness.client,
    })).resolves.toMatchObject({
      handled: true,
      purchaseId: "hucp_purchase_123",
    });

    expect(mocks.reconcileDisputeNetReversal).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceReferenceLookupKey: "stripe-billing-event:dp_usage_123",
        sourceReferenceLookupKeyCandidates: [
          "stripe-billing-event:dp_usage_123",
          "stripe-billing-event:previous:dp_usage_123",
        ],
      }),
    );
  });

  it("reverses unused credit when dispute funds are withdrawn", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      status: HostedUsageCreditPurchaseStatus.fulfilled,
      stripeChargeLookupKey: "stripe-billing-event:ch_usage_123",
      stripePaymentIntentLookupKey: "stripe-billing-event:pi_usage_123",
    });
    mocks.stripe.disputes.list.mockResolvedValue(
      makeDisputeList([makeDispute({ withdrawnAmount: 250 })]),
    );
    mockExistingUsageCreditGrant();

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeDisputeEvent("charge.dispute.funds_withdrawn"),
      prisma: harness.client,
    })).resolves.toMatchObject({
      granted: false,
      handled: true,
      wakeRequired: true,
    });

    expect(mocks.reconcileDisputeNetReversal).toHaveBeenCalledTimes(2);
    expect(mocks.reconcileDisputeNetReversal).toHaveBeenCalledWith({
      effectiveAt: new Date("2026-07-16T03:25:00.000Z"),
      purchaseId: "hucp_purchase_123",
      sourceReferenceLookupKey: "stripe-billing-event:dp_usage_123",
      sourceReferenceLookupKeyCandidates: [
        "stripe-billing-event:dp_usage_123",
        "stripe-billing-event:previous:dp_usage_123",
      ],
      targetNetReversalUsdMicros: 2_500_000n,
      tx: harness.client,
    });
  });

  it("caps an oversized dispute at the full top-up grant", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      status: HostedUsageCreditPurchaseStatus.fulfilled,
      stripeChargeLookupKey: "stripe-billing-event:ch_usage_123",
      stripePaymentIntentLookupKey: "stripe-billing-event:pi_usage_123",
    });
    const dispute = makeDispute({ amount: 700, withdrawnAmount: 700 });
    mocks.stripe.disputes.retrieve.mockResolvedValue(dispute);
    mocks.stripe.disputes.list.mockResolvedValue(makeDisputeList([dispute]));
    mockExistingUsageCreditGrant();

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeDisputeEvent("charge.dispute.funds_withdrawn"),
      prisma: harness.client,
    })).resolves.toMatchObject({ handled: true });

    expect(mocks.reconcileDisputeNetReversal).toHaveBeenCalledWith(
      expect.objectContaining({ targetNetReversalUsdMicros: 5_000_000n }),
    );
  });

  it("conservatively reserves the full grant for foreign-currency dispute exposure", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      status: HostedUsageCreditPurchaseStatus.fulfilled,
      stripeChargeLookupKey: "stripe-billing-event:ch_usage_123",
      stripePaymentIntentLookupKey: "stripe-billing-event:pi_usage_123",
    });
    const dispute = makeDispute({
      amount: 250,
      balanceCurrency: "eur",
      withdrawnAmount: 230,
    });
    mocks.stripe.disputes.retrieve.mockResolvedValue(dispute);
    mocks.stripe.disputes.list.mockResolvedValue(makeDisputeList([dispute]));
    mockExistingUsageCreditGrant();

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeDisputeEvent("charge.dispute.funds_withdrawn"),
      prisma: harness.client,
    })).resolves.toMatchObject({ handled: true });

    expect(mocks.reconcileDisputeNetReversal).toHaveBeenCalledWith(
      expect.objectContaining({ targetNetReversalUsdMicros: 5_000_000n }),
    );
  });

  it("uses net balance movement for a partial dispute reinstatement", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      status: HostedUsageCreditPurchaseStatus.fulfilled,
      stripeChargeLookupKey: "stripe-billing-event:ch_usage_123",
      stripePaymentIntentLookupKey: "stripe-billing-event:pi_usage_123",
    });
    mocks.stripe.disputes.retrieve.mockResolvedValue(
      makeDispute({
        amount: 500,
        reinstatedAmount: 200,
        status: "lost",
        withdrawnAmount: 500,
      }),
    );
    mocks.stripe.disputes.list.mockResolvedValue(
      makeDisputeList([makeDispute({
        amount: 500,
        reinstatedAmount: 200,
        status: "lost",
        withdrawnAmount: 500,
      })]),
    );
    mockExistingUsageCreditGrant();

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeDisputeEvent("charge.dispute.funds_reinstated"),
      prisma: harness.client,
    })).resolves.toMatchObject({
      granted: false,
      handled: true,
      wakeRequired: true,
    });

    expect(mocks.reconcileDisputeNetReversal).toHaveBeenCalledWith({
      effectiveAt: new Date("2026-07-16T03:25:00.000Z"),
      purchaseId: "hucp_purchase_123",
      sourceReferenceLookupKey: "stripe-billing-event:dp_usage_123",
      sourceReferenceLookupKeyCandidates: [
        "stripe-billing-event:dp_usage_123",
        "stripe-billing-event:previous:dp_usage_123",
      ],
      targetNetReversalUsdMicros: 3_000_000n,
      tx: harness.client,
    });
  });

  it("keeps a failed-refund restoration wake durable on replay", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      status: HostedUsageCreditPurchaseStatus.fulfilled,
      stripeChargeLookupKey: "stripe-billing-event:ch_usage_123",
      stripePaymentIntentLookupKey: "stripe-billing-event:pi_usage_123",
    });
    mocks.stripe.charges.retrieve.mockResolvedValue(
      makeCharge({ amountRefunded: 0 }),
    );
    mocks.stripe.refunds.list.mockResolvedValue(
      makeRefundList([makeRefund({ status: "failed" })]),
    );
    mocks.stripe.refunds.retrieve.mockResolvedValue(
      makeRefund({ status: "failed" }),
    );
    mocks.reconcileRefundNetReversal
      .mockResolvedValueOnce(makeNetReversalResult({
        balanceUsdMicros: 5_000_000n,
        restoredNowUsdMicros: 2_500_000n,
      }))
      .mockResolvedValue(makeNetReversalResult({
        balanceUsdMicros: 5_000_000n,
      }));
    mockExistingUsageCreditGrant(5_000_000n);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(reconcileHostedUsageCreditStripeEvent({
        event: makeRefundEvent("refund.failed"),
        prisma: harness.client,
      })).resolves.toMatchObject({
        granted: false,
        handled: true,
        wakeRequired: true,
      });
    }

    expect(mocks.reconcileRefundNetReversal).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceReferenceLookupKey: "stripe-billing-event:re_usage_123",
        targetNetReversalUsdMicros: 0n,
      }),
    );
  });

  it("keeps an overflowing final restoration retryable", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      status: HostedUsageCreditPurchaseStatus.fulfilled,
      stripeChargeLookupKey: "stripe-billing-event:ch_usage_123",
      stripePaymentIntentLookupKey: "stripe-billing-event:pi_usage_123",
    });
    mocks.stripe.charges.retrieve.mockResolvedValue(
      makeCharge({ amountRefunded: 0 }),
    );
    mocks.stripe.refunds.list.mockResolvedValue(
      makeRefundList([makeRefund({ status: "failed" })]),
    );
    mocks.stripe.refunds.retrieve.mockResolvedValue(
      makeRefund({ status: "failed" }),
    );
    mocks.readGrantCapacity.mockResolvedValue({
      expectedPurchaseOwnsReservation: false,
      state: "overflow",
    });
    mockExistingUsageCreditGrant(32_000_000n);

    const reconciliation = reconcileHostedUsageCreditStripeEvent({
      event: makeRefundEvent("refund.failed"),
      prisma: harness.client,
    });

    await expect(reconciliation).rejects.toSatisfy(
      isHostedUsageCreditStripeRetryableError,
    );
    expect(mocks.readGrantCapacity).toHaveBeenCalledTimes(1);
    expect(mocks.readGrantCapacity).toHaveBeenCalledWith({
      lockedBeneficiary: {
        balanceUsdMicros: 2_500_000n,
        beneficiaryMemberId: "member_beneficiary",
        ledgerVersion: 2n,
      },
      tx: harness.client,
    });
    expect(harness.purchase.reconciliationVersion).toBe(0n);
  });

  it("converges refunds and multiple disputes in two deterministic passes", async () => {
    const harness = createUsageCreditStripePrismaHarness({
      status: HostedUsageCreditPurchaseStatus.fulfilled,
      stripeChargeLookupKey: "stripe-billing-event:ch_usage_123",
      stripePaymentIntentLookupKey: "stripe-billing-event:pi_usage_123",
    });
    const disputeA = makeDispute({
      amount: 200,
      id: "dp_usage_a",
      withdrawnAmount: 200,
    });
    const disputeB = makeDispute({
      amount: 200,
      id: "dp_usage_b",
      withdrawnAmount: 200,
    });
    mocks.stripe.disputes.retrieve.mockResolvedValue(disputeB);
    mocks.stripe.disputes.list.mockResolvedValue(
      makeDisputeList([disputeB, disputeA]),
    );
    mocks.stripe.charges.retrieve.mockResolvedValue(
      makeCharge({ amountRefunded: 100 }),
    );
    mocks.stripe.refunds.list.mockResolvedValue(
      makeRefundList([makeRefund({ amount: 100 })]),
    );
    mocks.reconcileRefundNetReversal.mockResolvedValue(
      makeNetReversalResult({ balanceUsdMicros: 0n }),
    );
    mocks.reconcileDisputeNetReversal.mockResolvedValue(
      makeNetReversalResult({ balanceUsdMicros: 0n }),
    );
    mockExistingUsageCreditGrant(0n);
    const order: string[] = [];
    mocks.reconcileRefundNetReversal.mockImplementation(async () => {
      order.push("refund");
      return makeNetReversalResult({ balanceUsdMicros: 0n });
    });
    mocks.reconcileDisputeNetReversal.mockImplementation(async (call: {
      sourceReferenceLookupKey: string;
    }) => {
      order.push(call.sourceReferenceLookupKey.endsWith("dp_usage_a")
        ? "dispute-a"
        : "dispute-b");
      return makeNetReversalResult({ balanceUsdMicros: 0n });
    });
    mocks.readGrantCapacity.mockImplementation(async () => {
      order.push("capacity");
      return {
        expectedPurchaseOwnsReservation: false,
        state: "at_capacity",
      };
    });

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeDisputeEvent("charge.dispute.funds_withdrawn", {
        disputeId: "dp_usage_b",
      }),
      prisma: harness.client,
    })).resolves.toMatchObject({
      handled: true,
      wakeRequired: false,
    });

    expect(order).toEqual([
      "refund",
      "dispute-a",
      "dispute-b",
      "refund",
      "dispute-a",
      "dispute-b",
      "capacity",
    ]);
    expect(mocks.readGrantCapacity).toHaveBeenCalledOnce();
    expect(mocks.readGrantCapacity).toHaveBeenCalledWith({
      lockedBeneficiary: {
        balanceUsdMicros: 0n,
        beneficiaryMemberId: "member_beneficiary",
        ledgerVersion: 2n,
      },
      tx: harness.client,
    });
    expect(mocks.reconcileRefundNetReversal).toHaveBeenCalledWith(
      expect.objectContaining({ targetNetReversalUsdMicros: 1_000_000n }),
    );
    expect(mocks.reconcileDisputeNetReversal).toHaveBeenCalledWith(
      expect.objectContaining({ targetNetReversalUsdMicros: 2_000_000n }),
    );
  });

  it("converges live refunds and disputes before a paid Checkout can wake", async () => {
    const harness = createUsageCreditStripePrismaHarness();
    mocks.stripe.charges.retrieve.mockResolvedValue(
      makeCharge({ amountRefunded: 200 }),
    );
    mocks.stripe.refunds.list.mockResolvedValue(
      makeRefundList([makeRefund({ amount: 200 })]),
    );
    mocks.stripe.disputes.list.mockResolvedValue(
      makeDisputeList([makeDispute({
        amount: 300,
        withdrawnAmount: 300,
      })]),
    );
    mocks.reconcileRefundNetReversal.mockResolvedValue(
      makeNetReversalResult({ balanceUsdMicros: 3_000_000n }),
    );
    mocks.reconcileDisputeNetReversal.mockResolvedValue(
      makeNetReversalResult({ balanceUsdMicros: 0n }),
    );

    await expect(reconcileHostedUsageCreditStripeEvent({
      event: makeCheckoutEvent("checkout.session.completed"),
      prisma: harness.client,
    })).resolves.toMatchObject({
      granted: true,
      handled: true,
      wakeRequired: false,
    });

    expect(mocks.grantUsageCredit).toHaveBeenCalledBefore(
      mocks.reconcileRefundNetReversal,
    );
    expect(mocks.reconcileRefundNetReversal).toHaveBeenCalledTimes(2);
    expect(mocks.reconcileDisputeNetReversal).toHaveBeenCalledTimes(2);
  });
});

function createUsageCreditStripePrismaHarness(
  overrides?: Partial<MutableUsageCreditPurchase>,
  options?: {
    beforeTransaction?: (call: number) => Promise<void> | void;
    purchaseExists?: boolean;
  },
): {
  client: UsageCreditStripePrismaHarnessClient;
  purchase: MutableUsageCreditPurchase;
} {
  const purchase = makeUsageCreditPurchase(overrides);
  const purchaseExists = options?.purchaseExists ?? true;
  let transactionCall = 0;
  const client: UsageCreditStripePrismaHarnessClient = {
    $transaction: vi.fn(async (callback) => {
      transactionCall += 1;
      await options?.beforeTransaction?.(transactionCall);
      return callback(client);
    }),
    hostedUsageCreditPurchase: {
      findMany: vi.fn(async ({ where }: {
        where: {
          OR?: Array<Record<string, UsageCreditStripeLookupFilter>>;
        };
      }) => {
        const matches = (where.OR ?? []).some((condition) =>
          Object.entries(condition).some(([key, filter]) => {
            const value = purchase[key as keyof MutableUsageCreditPurchase];
            return typeof filter === "string"
              ? value === filter
              : typeof value === "string" && filter.in.includes(value);
          })
        );
        return purchaseExists && matches ? [purchase] : [];
      }),
      findUnique: vi.fn(async ({ where }) =>
        purchaseExists && where.id === purchase.id ? purchase : null
      ),
      updateMany: vi.fn(async ({ data, where }) => {
        const statusAllowed = !where.status || where.status.in.includes(purchase.status);
        const versionAllowed = where.reconciliationVersion === undefined ||
          where.reconciliationVersion === purchase.reconciliationVersion;
        if (
          !purchaseExists ||
          where.id !== purchase.id ||
          !statusAllowed ||
          !versionAllowed
        ) {
          return { count: 0 };
        }
        const { reconciliationVersion, ...plainData } = data;
        Object.assign(purchase, plainData);
        if (typeof reconciliationVersion === "bigint") {
          purchase.reconciliationVersion = reconciliationVersion;
        } else if (reconciliationVersion) {
          purchase.reconciliationVersion += reconciliationVersion.increment;
        }
        return { count: 1 };
      }),
    },
  };
  return { client, purchase };
}

function makeUsageCreditPurchase(
  overrides?: Partial<{
    beneficiaryMemberId: string;
    checkoutCancelUrl: string;
    checkoutRequestPolicyVersion: string;
    checkoutSuccessUrl: string;
    grantSlotReleasedAt: Date | null;
    payerMemberId: string | null;
    status: HostedUsageCreditPurchaseStatus;
    stripeChargeLookupKey: string | null;
    stripeCheckoutSessionIdEncrypted: string | null;
    stripeCheckoutSessionLookupKey: string | null;
    stripePaymentIntentLookupKey: string | null;
    terminalAt: Date | null;
  }>,
) {
  const isVersionTwo =
    overrides?.checkoutRequestPolicyVersion ===
      "hosted-usage-credit-checkout-v2";
  return {
    beneficiaryMemberId: overrides?.beneficiaryMemberId ??
      "member_beneficiary",
    cashAmountMinor: 500,
    cashCurrency: "usd",
    checkoutCancelUrl: overrides?.checkoutCancelUrl ?? (isVersionTwo
      ? "https://murph.example/groups/fund/group_join_code_1234?usageCredit=cancel"
      : "https://murph.example/settings?usageCredit=cancel"),
    checkoutExpiresAt: new Date("2026-07-16T04:50:00.456Z"),
    checkoutRequestPolicyVersion:
      overrides?.checkoutRequestPolicyVersion ??
      "hosted-usage-credit-checkout-v1",
    checkoutSuccessUrl: overrides?.checkoutSuccessUrl ?? (isVersionTwo
      ? "https://murph.example/groups/fund/group_join_code_1234?usageCredit=success"
      : "https://murph.example/settings?usageCredit=success"),
    createdAt: new Date("2026-07-16T03:20:00.000Z"),
    grantSlotReleasedAt: overrides?.grantSlotReleasedAt ?? null,
    grantUsdMicros: 5_000_000n,
    id: "hucp_purchase_123",
    lastReconciledAt: null as Date | null,
    payerMemberId: overrides?.payerMemberId === undefined
      ? "member_payer"
      : overrides.payerMemberId,
    reconciliationVersion: 0n,
    status: overrides?.status ?? HostedUsageCreditPurchaseStatus.checkout_open,
    stripeChargeIdEncrypted: null as string | null,
    stripeChargeLookupKey: overrides?.stripeChargeLookupKey ?? null,
    stripeCheckoutSessionIdEncrypted:
      overrides?.stripeCheckoutSessionIdEncrypted === undefined
        ? "encrypted-session"
        : overrides.stripeCheckoutSessionIdEncrypted,
    stripeCheckoutSessionLookupKey: overrides?.stripeCheckoutSessionLookupKey === undefined
      ? "stripe-checkout-session:cs_usage_123"
      : overrides.stripeCheckoutSessionLookupKey,
    stripeCustomerLookupKey: "stripe-customer:cus_usage_123",
    stripeLiveMode: false,
    stripePaymentIntentIdEncrypted: null as string | null,
    stripePaymentIntentLookupKey:
      overrides?.stripePaymentIntentLookupKey ?? null,
    stripePriceLookupKey: "stripe-price:price_usage_5",
    terminalAt: overrides?.terminalAt ?? null,
  };
}

function makeCheckoutEvent(
  type:
    | "checkout.session.async_payment_failed"
    | "checkout.session.async_payment_succeeded"
    | "checkout.session.completed"
    | "checkout.session.expired",
): Stripe.Event {
  return {
    api_version: "2025-03-31.basil",
    created: 1_784_172_000,
    data: {
      object: makeCheckoutSession(),
    },
    id: `evt_${type.replaceAll(".", "_")}`,
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type,
  } as Stripe.Event;
}

function makeDirectPaymentEvent(
  type:
    | "payment_intent.canceled"
    | "payment_intent.payment_failed"
    | "payment_intent.processing"
    | "payment_intent.succeeded",
  paymentIntent: Stripe.PaymentIntent,
): Stripe.Event {
  return {
    api_version: "2025-03-31.basil",
    created: 1_784_172_000,
    data: { object: paymentIntent },
    id: `evt_${type.replaceAll(".", "_")}`,
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type,
  } as Stripe.Event;
}

function makeRefundEvent(
  type: "refund.created" | "refund.failed" | "refund.updated" =
    "refund.created",
): Stripe.Event {
  return {
    api_version: "2025-03-31.basil",
    created: 1_784_172_300,
    data: {
      object: {
        charge: "ch_usage_123",
        id: "re_usage_123",
        payment_intent: "pi_usage_123",
      },
    },
    id: `evt_${type.replaceAll(".", "_")}_usage_123`,
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type,
  } as Stripe.Event;
}

function makeChargeRefundedEvent(): Stripe.Event {
  return {
    api_version: "2025-03-31.basil",
    created: 1_784_172_300,
    data: {
      object: makeCharge({ amountRefunded: 250 }),
    },
    id: "evt_charge_refunded_usage_123",
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type: "charge.refunded",
  } as Stripe.Event;
}

function makeDisputeEvent(
  type:
    | "charge.dispute.funds_reinstated"
    | "charge.dispute.funds_withdrawn",
  overrides?: {
    disputeId?: string;
  },
): Stripe.Event {
  return {
    api_version: "2025-03-31.basil",
    created: 1_784_172_300,
    data: {
      object: {
        charge: "ch_usage_123",
        id: overrides?.disputeId ?? "dp_usage_123",
        payment_intent: "pi_usage_123",
      },
    },
    id: `evt_${type.replaceAll(".", "_")}`,
    livemode: false,
    object: "event",
    pending_webhooks: 0,
    request: {
      id: null,
      idempotency_key: null,
    },
    type,
  } as Stripe.Event;
}

function makeCheckoutSession(overrides?: {
  amountTotal?: number;
  paymentIntentId?: string | null;
  paymentStatus?: Stripe.Checkout.Session["payment_status"];
  status?: Stripe.Checkout.Session["status"];
}): Stripe.Checkout.Session {
  return {
    amount_subtotal: 500,
    amount_total: overrides?.amountTotal ?? 500,
    cancel_url: "https://murph.example/settings?usageCredit=cancel",
    client_reference_id: "hucp_purchase_123",
    currency: "usd",
    customer: "cus_usage_123",
    expires_at: 1_784_177_400,
    id: "cs_usage_123",
    livemode: false,
    metadata: makeUsageCreditMetadata(),
    mode: "payment",
    object: "checkout.session",
    payment_intent: overrides?.paymentIntentId === undefined
      ? "pi_usage_123"
      : overrides.paymentIntentId,
    payment_status: overrides?.paymentStatus ?? "paid",
    status: overrides?.status ?? "complete",
    success_url: "https://murph.example/settings?usageCredit=success",
  } as Stripe.Checkout.Session;
}

function makeCheckoutSessionList(
  sessions: Stripe.Checkout.Session[],
  overrides?: { hasMore?: boolean },
): Stripe.ApiList<Stripe.Checkout.Session> {
  return {
    data: sessions,
    has_more: overrides?.hasMore ?? false,
    object: "list",
    url: "/v1/checkout/sessions",
  };
}

function makeCheckoutLineItems(overrides?: {
  priceId?: string;
}): Stripe.ApiList<Stripe.LineItem> {
  return {
    data: [{
      id: "li_usage_123",
      object: "item",
      price: {
        id: overrides?.priceId ?? "price_usage_5",
        object: "price",
      } as Stripe.Price,
      quantity: 1,
    } as Stripe.LineItem],
    has_more: false,
    object: "list",
    url: "/v1/checkout/sessions/cs_usage_123/line_items",
  };
}

function makePaymentIntent(overrides?: {
  amountReceived?: number;
  latestCharge?: Stripe.Charge | string | null;
  policyVersion?: string;
  purpose?: "checkout" | "saved_card";
  status?: Stripe.PaymentIntent.Status;
}): Stripe.PaymentIntent {
  return {
    amount: 500,
    amount_received: overrides?.amountReceived ?? 500,
    created: 1_784_171_900,
    currency: "usd",
    customer: "cus_usage_123",
    id: "pi_usage_123",
    latest_charge: overrides?.latestCharge === undefined
      ? {
          created: 1_784_172_000,
          id: "ch_usage_123",
          object: "charge",
        } as Stripe.Charge
      : overrides.latestCharge,
    livemode: false,
    metadata: overrides?.purpose === "saved_card"
      ? makeSavedCardUsageCreditMetadata(overrides.policyVersion)
      : makeUsageCreditMetadata(),
    object: "payment_intent",
    status: overrides?.status ?? "succeeded",
  } as Stripe.PaymentIntent;
}

function makeCharge(overrides?: {
  amountRefunded?: number;
}): Stripe.Charge {
  return {
    amount: 500,
    amount_refunded: overrides?.amountRefunded ?? 250,
    created: 1_784_172_000,
    currency: "usd",
    customer: "cus_usage_123",
    id: "ch_usage_123",
    livemode: false,
    metadata: {},
    object: "charge",
    paid: true,
    payment_intent: "pi_usage_123",
  } as Stripe.Charge;
}

function makeRefund(overrides?: {
  amount?: number;
  created?: number;
  id?: string;
  status?: string;
}): Stripe.Refund {
  return {
    amount: overrides?.amount ?? 250,
    charge: "ch_usage_123",
    created: overrides?.created ?? 1_784_172_200,
    currency: "usd",
    id: overrides?.id ?? "re_usage_123",
    object: "refund",
    payment_intent: "pi_usage_123",
    status: overrides?.status ?? "succeeded",
  } as Stripe.Refund;
}

function makeRefundList(
  refunds: Stripe.Refund[],
): Stripe.ApiList<Stripe.Refund> {
  return {
    data: refunds,
    has_more: false,
    object: "list",
    url: "/v1/refunds",
  };
}

function makeDispute(overrides?: {
  amount?: number;
  balanceCurrency?: string;
  id?: string;
  reinstatedAmount?: number;
  status?: Stripe.Dispute["status"];
  withdrawnAmount?: number;
}): Stripe.Dispute {
  const disputeId = overrides?.id ?? "dp_usage_123";
  const balanceTransactions: Stripe.BalanceTransaction[] = [];
  if (overrides?.withdrawnAmount) {
    balanceTransactions.push(makeDisputeBalanceTransaction({
      amount: -overrides.withdrawnAmount,
      currency: overrides.balanceCurrency,
      id: `txn_withdrawn_${disputeId}`,
      sourceId: disputeId,
    }));
  }
  if (overrides?.reinstatedAmount) {
    balanceTransactions.push(makeDisputeBalanceTransaction({
      amount: overrides.reinstatedAmount,
      currency: overrides.balanceCurrency,
      id: `txn_reinstated_${disputeId}`,
      sourceId: disputeId,
    }));
  }
  return {
    amount: overrides?.amount ?? 250,
    balance_transactions: balanceTransactions,
    charge: "ch_usage_123",
    created: 1_784_172_100,
    currency: "usd",
    id: disputeId,
    livemode: false,
    object: "dispute",
    payment_intent: "pi_usage_123",
    status: overrides?.status ?? "lost",
  } as Stripe.Dispute;
}

function makeDisputeBalanceTransaction(input: {
  amount: number;
  currency?: string;
  id: string;
  sourceId: string;
}): Stripe.BalanceTransaction {
  return {
    amount: input.amount,
    currency: input.currency ?? "usd",
    id: input.id,
    object: "balance_transaction",
    source: input.sourceId,
  } as Stripe.BalanceTransaction;
}

function makeDisputeList(
  disputes: Stripe.Dispute[],
): Stripe.ApiList<Stripe.Dispute> {
  return {
    data: disputes,
    has_more: false,
    object: "list",
    url: "/v1/disputes",
  };
}

function makeNetReversalResult(overrides?: {
  balanceUsdMicros?: bigint;
  netReversedUsdMicros?: bigint;
  restoredNowUsdMicros?: bigint;
  reversedNowUsdMicros?: bigint;
}) {
  return {
    balanceUsdMicros: overrides?.balanceUsdMicros ?? 2_500_000n,
    entryId: null,
    ledgerVersion: 2n,
    netReversedUsdMicros: overrides?.netReversedUsdMicros ?? 0n,
    restoredNowUsdMicros: overrides?.restoredNowUsdMicros ?? 0n,
    reversedNowUsdMicros: overrides?.reversedNowUsdMicros ?? 0n,
    unmetTargetUsdMicros: 0n,
  };
}

function mockExistingUsageCreditGrant(
  balanceUsdMicros = 5_000_000n,
): void {
  mocks.grantUsageCredit.mockResolvedValue({
    balanceUsdMicros,
    entryId: "huce_grant_123",
    granted: false,
    ledgerVersion: 1n,
  });
}

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function makeUsageCreditMetadata(): Record<string, string> {
  return {
    policyVersion: "hosted-usage-credit-checkout-v1",
    purchaseId: "hucp_purchase_123",
    purpose: "hosted_usage_credit",
  };
}

function makeSavedCardUsageCreditMetadata(
  policyVersion = "hosted-usage-credit-checkout-v2",
): Record<string, string> {
  return {
    policyVersion,
    purchaseId: "hucp_purchase_123",
    purpose: "hosted_usage_credit_saved_card",
  };
}
