import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHostedStripeCheckoutSessionLookupKey: vi.fn((value: string | null | undefined) =>
    value ? `checkout:${value}` : null
  ),
  createHostedStripeCustomerLookupKey: vi.fn((value: string | null | undefined) =>
    value ? `customer:${value}` : null
  ),
  createHostedStripeCustomerLookupKeyReadCandidates: vi.fn(
    (value: string | null | undefined) => value ? [`customer:${value}`] : [],
  ),
  createHostedStripePriceLookupKey: vi.fn((value: string | null | undefined) =>
    value ? `price:${value}` : null
  ),
  hostedLookupKeyMatchesValue: vi.fn((input: {
    expectedLookupKey?: string | null;
    kind: string;
    normalizedValue: string | null;
  }) => input.expectedLookupKey === `${
    input.kind === "stripe-price" ? "price" : "checkout"
  }:${input.normalizedValue}`),
  decryptHostedWebNullableString: vi.fn(async (input: { value?: string | null }) =>
    input.value?.startsWith("encrypted:") ? input.value.slice("encrypted:".length) : null
  ),
  encryptHostedWebNullableString: vi.fn(async (input: { value?: string | null }) =>
    input.value ? `encrypted:${input.value}` : null
  ),
  getPrisma: vi.fn(),
  lockHostedMemberRow: vi.fn(async () => {}),
  readHostedMemberStripeBillingRef: vi.fn(),
  requireHostedOnboardingPublicBaseUrl: vi.fn(() => "https://join.example.test"),
  requireHostedStripeApiMode: vi.fn(),
  requireHostedStripeUsageCreditCheckoutConfig: vi.fn(),
  stripeCheckoutCreate: vi.fn(),
  stripeCheckoutExpire: vi.fn(),
  stripeCheckoutList: vi.fn(),
  stripeCheckoutRetrieve: vi.fn(),
  stripePriceRetrieve: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/contact-privacy", () => ({
  createHostedStripeCheckoutSessionLookupKey:
    mocks.createHostedStripeCheckoutSessionLookupKey,
  createHostedStripeCustomerLookupKey: mocks.createHostedStripeCustomerLookupKey,
  createHostedStripeCustomerLookupKeyReadCandidates:
    mocks.createHostedStripeCustomerLookupKeyReadCandidates,
  createHostedStripePriceLookupKey: mocks.createHostedStripePriceLookupKey,
  hostedLookupKeyMatchesValue: mocks.hostedLookupKeyMatchesValue,
}));

vi.mock("@/src/lib/hosted-web/encryption", () => ({
  decryptHostedWebNullableString: mocks.decryptHostedWebNullableString,
  encryptHostedWebNullableString: mocks.encryptHostedWebNullableString,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberStripeBillingRef: mocks.readHostedMemberStripeBillingRef,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingPublicBaseUrl: mocks.requireHostedOnboardingPublicBaseUrl,
  requireHostedStripeApiMode: mocks.requireHostedStripeApiMode,
  requireHostedStripeUsageCreditCheckoutConfig:
    mocks.requireHostedStripeUsageCreditCheckoutConfig,
}));

vi.mock("@/src/lib/hosted-onboarding/shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/hosted-onboarding/shared")>();
  return {
    ...original,
    lockHostedMemberRow: mocks.lockHostedMemberRow,
  };
});

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

import {
  assertHostedUsageCreditPurchasesReadyForAccountDeletionTx,
  closeHostedUsageCreditPurchasesForAccountDeletion,
  createHostedUsageCreditCheckout,
  expireHostedUsageCreditCheckout,
  parseHostedUsageCreditCheckoutRequest,
  readHostedUsageCreditPurchaseStatus,
} from "@/src/lib/hosted-onboarding/usage-credit-purchase-service";

const NOW = new Date("2026-07-16T17:00:00.000Z");
const RETRY_AT = new Date("2026-07-16T17:31:00.000Z");
const MEMBER_ID = "hbm_member123";
const CLIENT_REQUEST_KEY = "request_key_123456";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireHostedOnboardingPublicBaseUrl.mockReset();
  mocks.requireHostedOnboardingPublicBaseUrl.mockReturnValue(
    "https://join.example.test",
  );
  mocks.stripeCheckoutCreate.mockReset();
  mocks.stripeCheckoutExpire.mockReset();
  mocks.stripeCheckoutList.mockReset();
  mocks.stripeCheckoutRetrieve.mockReset();
  mocks.stripePriceRetrieve.mockReset();
  mocks.readHostedMemberStripeBillingRef.mockResolvedValue({
    currentBillingPhase: "paid",
    currentBillingPlanCode: "launch_monthly",
    currentCheckoutOffer: "standard",
    memberId: MEMBER_ID,
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
  });
  mocks.requireHostedStripeUsageCreditCheckoutConfig.mockImplementation(
    ({ offerCode }: { offerCode: string }) => ({
      offerCode,
      priceId: `price_${offerCode.replace("_usd", "")}`,
      stripe: {
        checkout: {
          sessions: {
            create: mocks.stripeCheckoutCreate,
            expire: mocks.stripeCheckoutExpire,
            list: mocks.stripeCheckoutList,
            retrieve: mocks.stripeCheckoutRetrieve,
          },
        },
        prices: { retrieve: mocks.stripePriceRetrieve },
      },
      stripeLiveMode: false,
    }),
  );
  mocks.requireHostedStripeApiMode.mockReturnValue({
    stripe: {
      checkout: {
        sessions: {
          create: mocks.stripeCheckoutCreate,
          expire: mocks.stripeCheckoutExpire,
          list: mocks.stripeCheckoutList,
          retrieve: mocks.stripeCheckoutRetrieve,
        },
      },
      prices: { retrieve: mocks.stripePriceRetrieve },
    },
    stripeLiveMode: false,
  });
  mocks.stripePriceRetrieve.mockImplementation(async (priceId: string) =>
    buildStripePriceForId(priceId)
  );
});

describe("parseHostedUsageCreditCheckoutRequest", () => {
  it("accepts only an exact opaque offer and request key", () => {
    expect(parseHostedUsageCreditCheckoutRequest({
      clientRequestKey: CLIENT_REQUEST_KEY,
      offerCode: "usage_10_usd",
    })).toEqual({
      clientRequestKey: CLIENT_REQUEST_KEY,
      offerCode: "usage_10_usd",
    });
  });

  it.each([
    { clientRequestKey: CLIENT_REQUEST_KEY, offerCode: "usage_10_usd", amount: 10 },
    { clientRequestKey: "short", offerCode: "usage_10_usd" },
    { clientRequestKey: CLIENT_REQUEST_KEY, offerCode: "usage_100_usd" },
  ])("rejects malformed or browser-authoritative input", (input) => {
    expect(() => parseHostedUsageCreditCheckoutRequest(input)).toThrowError(
      expect.objectContaining({ httpStatus: 400 }),
    );
  });
});

describe("createHostedUsageCreditCheckout", () => {
  it("persists and claims the frozen purchase before one-time Checkout creation", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripePriceRetrieve.mockImplementationOnce(async () => {
      const purchase = onlyPurchase(fake.purchases);
      expect(purchase.checkoutCreateState).toBe("claimed");
      expect(purchase.status).toBe("created");
      return buildStripePrice();
    });
    mocks.stripeCheckoutCreate.mockImplementation(async (request, options) => {
      const purchase = onlyPurchase(fake.purchases);
      expect(purchase.checkoutCreateState).toBe("claimed");
      expect(purchase.status).toBe("created");
      expect(request).toMatchObject({
        adaptive_pricing: { enabled: false },
        client_reference_id: purchase.id,
        customer: "cus_123",
        expires_at: Math.floor((NOW.getTime() + 90 * 60 * 1_000) / 1_000),
        line_items: [{ price: "price_usage_10", quantity: 1 }],
        metadata: {
          policyVersion: "hosted-usage-credit-checkout-v1",
          purchaseId: purchase.id,
          purpose: "hosted_usage_credit",
        },
        mode: "payment",
        payment_intent_data: {
          metadata: {
            policyVersion: "hosted-usage-credit-checkout-v1",
            purchaseId: purchase.id,
            purpose: "hosted_usage_credit",
          },
        },
      });
      expect(request).not.toHaveProperty("price_data");
      expect(request).not.toHaveProperty("payment_method_types");
      expect(options).toEqual({
        idempotencyKey: `hosted-usage-credit-checkout:${purchase.id}`,
      });
      return buildStripeSession(request);
    });

    const result = await createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    });

    const purchase = onlyPurchase(fake.purchases);
    expect(result).toEqual({
      purchaseId: purchase.id,
      status: "checkout_open",
      url: "https://checkout.stripe.test/session",
    });
    expect(purchase).toMatchObject({
      authorizationContext: "personal_self_v1",
      cashAmountMinor: 1_000,
      cashCurrency: "usd",
      checkoutCreateState: "attached",
      conversionPolicyVersion: "hosted-usage-credit-v1",
      grantUsdMicros: 10_000_000n,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      beneficiaryMemberId: MEMBER_ID,
      status: "checkout_open",
    });

    const retried = await createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: new Date(NOW.getTime() + 1_000),
      offerCode: "usage_10_usd",
    });
    expect(retried).toEqual(result);
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledTimes(1);
    expect(mocks.stripePriceRetrieve).toHaveBeenCalledWith(
      "price_usage_10",
      { expand: ["currency_options"] },
    );
  });

  it("retains a Session created during suspension without returning its Checkout URL", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) => {
      fake.member.suspendedAt = NOW;
      return buildStripeSession(request);
    });

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_NOT_ELIGIBLE",
      httpStatus: 403,
    });

    expect(onlyPurchase(fake.purchases)).toMatchObject({
      checkoutCreateState: "attached",
      status: "checkout_open",
      stripeCheckoutSessionIdEncrypted: expect.any(String),
      stripeCheckoutSessionLookupKey: expect.any(String),
    });
  });

  it.each([
    ["wrong amount", { unit_amount: 999 }, "price_amount_mismatch"],
    ["wrong currency", { currency: "eur" }, "price_currency_mismatch"],
    ["inactive", { active: false }, "price_inactive"],
    ["wrong Stripe mode", { livemode: true }, "price_mode_mismatch"],
    ["wrong identity", { id: "price_other" }, "price_identity_mismatch"],
    ["wrong object", { object: "product" }, "price_identity_mismatch"],
    ["tiered billing", { billing_scheme: "tiered" }, "price_billing_scheme_invalid"],
  ])("rejects a configured Price with %s before Checkout creation", async (
    _label,
    priceOverride,
    reason,
  ) => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripePriceRetrieve.mockResolvedValueOnce(
      buildStripePrice(priceOverride),
    );

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_STRIPE_PRICE_INVALID",
      details: { code: reason },
      httpStatus: 500,
    });

    expect(mocks.stripeCheckoutCreate).not.toHaveBeenCalled();
    expect(onlyPurchase(fake.purchases)).toMatchObject({
      checkoutCreateState: "claimed",
      status: "created",
    });
  });

  it.each([
    ["recurring", { recurring: { interval: "month" }, type: "recurring" }],
    ["custom amount", { custom_unit_amount: { enabled: true } }],
    ["transformed quantity", { transform_quantity: { divide_by: 2, round: "up" } }],
    ["alternate currencies", { currency_options: { eur: { unit_amount: 900 } } }],
  ])("rejects unsupported %s Price semantics", async (_label, priceOverride) => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripePriceRetrieve.mockResolvedValueOnce(
      buildStripePrice(priceOverride),
    );

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_STRIPE_PRICE_INVALID",
    });
    expect(mocks.stripeCheckoutCreate).not.toHaveBeenCalled();
  });

  it("replays the exact frozen request and stable key after an ambiguous response", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    const providerError = Object.assign(
      new Error("request for price_private and cus_private timed out"),
      {
        code: "api_connection_error",
        requestId: "req_private",
        statusCode: 503,
      },
    );
    mocks.stripeCheckoutCreate
      .mockRejectedValueOnce(providerError)
      .mockImplementationOnce(async (request) => buildStripeSession(request));

    let checkoutError: unknown;
    try {
      await createHostedUsageCreditCheckout({
        clientRequestKey: CLIENT_REQUEST_KEY,
        memberId: MEMBER_ID,
        now: NOW,
        offerCode: "usage_10_usd",
      });
    } catch (error) {
      checkoutError = error;
    }
    expect(checkoutError).toMatchObject({
      code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
      details: {
        providerErrorCode: "api_connection_error",
        providerRequestIdPresent: true,
        statusCode: 503,
      },
      retryable: true,
    });
    expect(checkoutError).toBeInstanceOf(Error);
    if (!(checkoutError instanceof Error)) {
      throw new TypeError("Expected a hosted Checkout error.");
    }
    expect(checkoutError.cause).toBeUndefined();
    expect(JSON.stringify(checkoutError)).not.toContain("price_private");
    expect(JSON.stringify(checkoutError)).not.toContain("cus_private");
    expect(onlyPurchase(fake.purchases)).toMatchObject({
      checkoutCreateState: "claimed",
      status: "created",
    });

    mocks.requireHostedStripeUsageCreditCheckoutConfig.mockImplementation(() => {
      throw new Error("Mutable offer configuration must not be read on retry.");
    });
    mocks.requireHostedOnboardingPublicBaseUrl.mockImplementation(() => {
      throw new Error("Mutable public URL configuration must not be read on retry.");
    });

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: new Date(NOW.getTime() + 60_000),
      offerCode: "usage_10_usd",
    })).resolves.toMatchObject({ status: "checkout_open" });

    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledTimes(2);
    expect(mocks.stripeCheckoutCreate.mock.calls[1]).toEqual(
      mocks.stripeCheckoutCreate.mock.calls[0],
    );
    expect(mocks.requireHostedStripeUsageCreditCheckoutConfig).toHaveBeenCalledTimes(1);
    expect(mocks.requireHostedOnboardingPublicBaseUrl).toHaveBeenCalledTimes(1);
    expect(fake.purchases.size).toBe(1);
  });

  it("rejects a corrupted frozen request before retrying Stripe", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate.mockRejectedValueOnce(new Error("connection lost"));

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    })).rejects.toBeTruthy();
    const purchase = onlyPurchase(fake.purchases);
    purchase.checkoutSuccessUrl = "https://tampered.example.test/settings";
    clearStripeProviderMockHistory();

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: new Date(NOW.getTime() + 60_000),
      offerCode: "usage_10_usd",
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_CHECKOUT_INVARIANT_FAILED",
      details: { code: "checkout_request_digest_mismatch" },
      httpStatus: 500,
    });
    expectNoStripeProviderIo();
  });

  it("does not create or replace a claimed attempt after its retry cutoff", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate.mockRejectedValueOnce(new Error("connection lost"));

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    })).rejects.toBeTruthy();
    clearStripeProviderMockHistory();

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: RETRY_AT,
      offerCode: "usage_10_usd",
    })).resolves.toMatchObject({
      status: "reconciling",
    });
    expectNoStripeProviderIo();
    expect(fake.purchases.size).toBe(1);
  });

  it("fences another request while one purchase is claimed", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate.mockRejectedValueOnce(new Error("connection lost"));

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    })).rejects.toBeTruthy();
    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: "another_request_1234",
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_5_usd",
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_CHECKOUT_IN_PROGRESS",
      httpStatus: 409,
    });
    expect(fake.purchases.size).toBe(1);
  });

  it("closes an expired unattached attempt before applying the active-purchase fence", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockImplementationOnce(async (request) => buildStripeSession(request));

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    })).rejects.toBeTruthy();
    const firstPurchase = onlyPurchase(fake.purchases);

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: "another_request_1234",
      memberId: MEMBER_ID,
      now: new Date(NOW.getTime() + 90 * 60 * 1_000),
      offerCode: "usage_5_usd",
    })).resolves.toMatchObject({ status: "checkout_open" });

    expect(firstPurchase).toMatchObject({
      checkoutCreateState: "closed",
      status: "expired",
    });
    expect(fake.purchases.size).toBe(2);
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledTimes(2);
  });

  it("closes a same-key unattached attempt after its frozen Checkout expiry", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate.mockRejectedValueOnce(new Error("connection lost"));

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    })).rejects.toBeTruthy();
    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: new Date(NOW.getTime() + 90 * 60 * 1_000),
      offerCode: "usage_10_usd",
    })).resolves.toMatchObject({ status: "expired" });

    expect(onlyPurchase(fake.purchases)).toMatchObject({
      checkoutCreateState: "closed",
      status: "expired",
    });
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledTimes(1);
  });

  it("rejects request-key reuse with different offer semantics", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate.mockRejectedValueOnce(new Error("connection lost"));

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    })).rejects.toBeTruthy();
    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_5_usd",
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_REQUEST_KEY_CONFLICT",
      httpStatus: 409,
    });
  });

  it("fails closed for sponsored, synthetic, trial, or inactive members", async () => {
    const ineligibleMembers = [
      { accountGroupMemberships: [{ id: "membership_1" }] },
      { threadContainer: { memberId: MEMBER_ID } },
      { billingStatus: "past_due" },
    ];

    for (const memberOverride of ineligibleMembers) {
      const fake = createFakePrisma({ memberOverride });
      mocks.getPrisma.mockReturnValue(fake.prisma);
      await expect(createHostedUsageCreditCheckout({
        clientRequestKey: CLIENT_REQUEST_KEY,
        memberId: MEMBER_ID,
        now: NOW,
        offerCode: "usage_10_usd",
      })).rejects.toMatchObject({
        code: "HOSTED_USAGE_CREDIT_NOT_ELIGIBLE",
      });
      expect(fake.purchases.size).toBe(0);
    }

    const trialFake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(trialFake.prisma);
    mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce({
      currentBillingPhase: "trial",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "pulse_trial_7d",
      stripeCustomerId: "cus_123",
      stripeSubscriptionId: "sub_123",
    });
    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_NOT_ELIGIBLE",
    });
  });
});

describe("expireHostedUsageCreditCheckout", () => {
  it("does not treat a cancel return as authority for an unattached attempt", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate.mockRejectedValueOnce(new Error("connection lost"));
    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    })).rejects.toBeTruthy();
    const purchase = onlyPurchase(fake.purchases);

    await expect(expireHostedUsageCreditCheckout({
      now: new Date(NOW.getTime() + 60_000),
      payerMemberId: MEMBER_ID,
      purchaseId: String(purchase.id),
    })).resolves.toMatchObject({ status: "reconciling" });

    expect(purchase).toMatchObject({
      checkoutCreateState: "claimed",
      status: "created",
    });
    expect(mocks.stripeCheckoutRetrieve).not.toHaveBeenCalled();
    expect(mocks.stripeCheckoutExpire).not.toHaveBeenCalled();
  });

  it("expires only the payer-owned attached unpaid Stripe Session", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );
    const checkout = await createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    });
    const purchase = onlyPurchase(fake.purchases);
    const openSession = buildStripeSessionFromPurchase(purchase);
    mocks.stripeCheckoutRetrieve.mockResolvedValueOnce(openSession);
    mocks.stripeCheckoutExpire.mockResolvedValueOnce({
      ...openSession,
      status: "expired",
      url: null,
    });

    await expect(expireHostedUsageCreditCheckout({
      now: new Date(NOW.getTime() + 60_000),
      payerMemberId: MEMBER_ID,
      purchaseId: checkout.purchaseId,
    })).resolves.toMatchObject({
      purchaseId: checkout.purchaseId,
      status: "expired",
    });

    expect(mocks.stripeCheckoutRetrieve).toHaveBeenCalledWith(
      "cs_test_usage_credit_123",
    );
    expect(mocks.stripeCheckoutExpire).toHaveBeenCalledWith(
      "cs_test_usage_credit_123",
    );
    expect(purchase).toMatchObject({
      checkoutCreateState: "closed",
      status: "expired",
    });
  });

  it.each([
    { paymentStatus: "unpaid", sessionStatus: "complete" },
    { paymentStatus: "paid", sessionStatus: "open" },
    { paymentStatus: "paid", sessionStatus: "complete" },
  ])("does not expire a Session reported as $sessionStatus/$paymentStatus", async ({
    paymentStatus,
    sessionStatus,
  }) => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );
    const checkout = await createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    });
    const purchase = onlyPurchase(fake.purchases);
    mocks.stripeCheckoutRetrieve.mockResolvedValueOnce({
      ...buildStripeSessionFromPurchase(purchase),
      payment_status: paymentStatus,
      status: sessionStatus,
      url: null,
    });

    await expect(expireHostedUsageCreditCheckout({
      now: new Date(NOW.getTime() + 60_000),
      payerMemberId: MEMBER_ID,
      purchaseId: checkout.purchaseId,
    })).resolves.toMatchObject({ status: "payment_pending" });

    expect(mocks.stripeCheckoutExpire).not.toHaveBeenCalled();
    expect(purchase).toMatchObject({
      checkoutCreateState: "attached",
      status: "payment_pending",
    });
  });

  it("leaves the purchase open when Stripe cannot authoritatively expire it", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );
    const checkout = await createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    });
    const purchase = onlyPurchase(fake.purchases);
    const openSession = buildStripeSessionFromPurchase(purchase);
    mocks.stripeCheckoutRetrieve
      .mockResolvedValueOnce(openSession)
      .mockResolvedValueOnce(openSession);
    mocks.stripeCheckoutExpire.mockRejectedValueOnce(new Error("Stripe timeout"));

    await expect(expireHostedUsageCreditCheckout({
      now: new Date(NOW.getTime() + 60_000),
      payerMemberId: MEMBER_ID,
      purchaseId: checkout.purchaseId,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
      httpStatus: 502,
    });
    expect(purchase).toMatchObject({
      checkoutCreateState: "attached",
      status: "checkout_open",
    });
  });

  it("does not reveal or mutate another payer's attached Session", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );
    const checkout = await createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    });

    await expect(expireHostedUsageCreditCheckout({
      payerMemberId: "hbm_someone_else",
      purchaseId: checkout.purchaseId,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_PURCHASE_NOT_FOUND",
      httpStatus: 404,
    });
    expect(mocks.stripeCheckoutRetrieve).not.toHaveBeenCalled();
    expect(mocks.stripeCheckoutExpire).not.toHaveBeenCalled();
  });
});

describe("usage-credit account-deletion convergence", () => {
  it("expires an attached open Session before permitting local deletion", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );
    await createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    });
    const purchase = onlyPurchase(fake.purchases);
    const openSession = buildStripeSessionFromPurchase(purchase);
    mocks.stripeCheckoutRetrieve.mockResolvedValueOnce(openSession);
    mocks.stripeCheckoutExpire.mockResolvedValueOnce({
      ...openSession,
      status: "expired",
      url: null,
    });
    fake.member.suspendedAt = NOW;

    await closeHostedUsageCreditPurchasesForAccountDeletion({
      memberIds: [MEMBER_ID],
      now: new Date(NOW.getTime() + 60_000),
    });

    expect(mocks.stripeCheckoutRetrieve).toHaveBeenCalledWith(
      "cs_test_usage_credit_123",
    );
    expect(mocks.stripeCheckoutExpire).toHaveBeenCalledWith(
      "cs_test_usage_credit_123",
    );
    expect(purchase).toMatchObject({
      checkoutCreateState: "closed",
      status: "expired",
    });
    await expect(assertHostedUsageCreditPurchasesReadyForAccountDeletionTx({
      memberIds: [MEMBER_ID],
    })).resolves.toBeUndefined();
  });

  it("replays a claimed attempt with its frozen request and stable key before expiring it", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate
      .mockRejectedValueOnce(new Error("ambiguous create"))
      .mockImplementationOnce(async (request) => buildStripeSession(request));

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    })).rejects.toBeTruthy();
    const purchase = onlyPurchase(fake.purchases);
    const openSession = buildStripeSessionFromPurchase(purchase);
    mocks.stripeCheckoutRetrieve.mockResolvedValueOnce(openSession);
    mocks.stripeCheckoutExpire.mockResolvedValueOnce({
      ...openSession,
      status: "expired",
      url: null,
    });
    fake.member.suspendedAt = NOW;

    await closeHostedUsageCreditPurchasesForAccountDeletion({
      memberIds: [MEMBER_ID],
      now: RETRY_AT,
    });

    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledTimes(2);
    expect(mocks.stripeCheckoutCreate.mock.calls[1]).toEqual(
      mocks.stripeCheckoutCreate.mock.calls[0],
    );
    expect(mocks.stripePriceRetrieve).toHaveBeenCalledTimes(1);
    expect(purchase).toMatchObject({
      checkoutCreateState: "closed",
      lastReconciledAt: RETRY_AT,
      status: "expired",
    });
  });

  it("replays and verifies a locally expired claimed attempt before treating it as terminal", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate
      .mockRejectedValueOnce(new Error("ambiguous create"))
      .mockImplementationOnce(async (request) => buildStripeSession(request));

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    })).rejects.toBeTruthy();
    const purchase = onlyPurchase(fake.purchases);
    const deletionAt = new Date((purchase.checkoutExpiresAt as Date).getTime() + 1);
    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: deletionAt,
      offerCode: "usage_10_usd",
    })).resolves.toMatchObject({ status: "expired" });
    expect(purchase).toMatchObject({
      checkoutCreateState: "closed",
      lastReconciledAt: null,
      status: "expired",
      stripeCheckoutSessionLookupKey: null,
    });
    await expect(assertHostedUsageCreditPurchasesReadyForAccountDeletionTx({
      memberIds: [MEMBER_ID],
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_USAGE_CREDIT_UNRESOLVED",
      retryable: true,
    });

    const openSession = buildStripeSessionFromPurchase(purchase);
    mocks.stripeCheckoutRetrieve.mockResolvedValueOnce(openSession);
    mocks.stripeCheckoutExpire.mockResolvedValueOnce({
      ...openSession,
      status: "expired",
      url: null,
    });
    fake.member.suspendedAt = NOW;

    await closeHostedUsageCreditPurchasesForAccountDeletion({
      memberIds: [MEMBER_ID],
      now: deletionAt,
    });

    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledTimes(2);
    expect(mocks.stripeCheckoutCreate.mock.calls[1]).toEqual(
      mocks.stripeCheckoutCreate.mock.calls[0],
    );
    expect(purchase).toMatchObject({
      checkoutCreateState: "closed",
      lastReconciledAt: deletionAt,
      status: "expired",
      stripeCheckoutSessionLookupKey: expect.any(String),
    });
    await expect(assertHostedUsageCreditPurchasesReadyForAccountDeletionTx({
      memberIds: [MEMBER_ID],
    })).resolves.toBeUndefined();
  });

  it("accepts provider-proven absence after an uncached frozen request expires", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate
      .mockRejectedValueOnce(new Error("request never reached Stripe"))
      .mockRejectedValueOnce(Object.assign(new Error("expires_at is in the past"), {
        rawType: "invalid_request_error",
        statusCode: 400,
        type: "StripeInvalidRequestError",
      }));

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    })).rejects.toBeTruthy();
    const purchase = onlyPurchase(fake.purchases);
    const deletionAt = new Date((purchase.checkoutExpiresAt as Date).getTime() + 1);
    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: deletionAt,
      offerCode: "usage_10_usd",
    })).resolves.toMatchObject({ status: "expired" });
    mocks.stripeCheckoutList.mockResolvedValueOnce({
      data: [],
      has_more: false,
      object: "list",
      url: "/v1/checkout/sessions",
    });
    fake.member.suspendedAt = NOW;

    await expect(closeHostedUsageCreditPurchasesForAccountDeletion({
      memberIds: [MEMBER_ID],
      now: deletionAt,
    })).resolves.toBeUndefined();

    expect(mocks.stripeCheckoutList).toHaveBeenCalledWith({
      created: {
        gte: Math.floor(NOW.getTime() / 1_000) - 1,
        lte: Math.floor((purchase.checkoutExpiresAt as Date).getTime() / 1_000),
      },
      customer: "cus_123",
      limit: 100,
    });
    expect(purchase).toMatchObject({
      checkoutCreateState: "closed",
      lastReconciledAt: deletionAt,
      status: "expired",
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey: null,
    });
    await expect(assertHostedUsageCreditPurchasesReadyForAccountDeletionTx({
      memberIds: [MEMBER_ID],
    })).resolves.toBeUndefined();
  });

  it("accepts expiry after an ambiguous Stripe expire response is verified", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );
    await createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    });
    const purchase = onlyPurchase(fake.purchases);
    const openSession = buildStripeSessionFromPurchase(purchase);
    mocks.stripeCheckoutRetrieve
      .mockResolvedValueOnce(openSession)
      .mockResolvedValueOnce({
        ...openSession,
        status: "expired",
        url: null,
      });
    mocks.stripeCheckoutExpire.mockRejectedValueOnce(new Error("Stripe timeout"));
    fake.member.suspendedAt = NOW;

    await expect(closeHostedUsageCreditPurchasesForAccountDeletion({
      memberIds: [MEMBER_ID],
      now: new Date(NOW.getTime() + 60_000),
    })).resolves.toBeUndefined();

    expect(mocks.stripeCheckoutRetrieve).toHaveBeenCalledTimes(2);
    expect(purchase).toMatchObject({
      checkoutCreateState: "closed",
      status: "expired",
    });
  });

  it("blocks deletion when Stripe cannot prove an attached Session is no longer open", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );
    await createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    });
    const purchase = onlyPurchase(fake.purchases);
    mocks.stripeCheckoutRetrieve.mockRejectedValueOnce(new Error("Stripe unavailable"));
    fake.member.suspendedAt = NOW;

    await expect(closeHostedUsageCreditPurchasesForAccountDeletion({
      memberIds: [MEMBER_ID],
      now: new Date(NOW.getTime() + 60_000),
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
      retryable: true,
    });
    expect(purchase).toMatchObject({
      checkoutCreateState: "attached",
      status: "checkout_open",
    });
    await expect(assertHostedUsageCreditPurchasesReadyForAccountDeletionTx({
      memberIds: [MEMBER_ID],
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_USAGE_CREDIT_UNRESOLVED",
      retryable: true,
    });
  });

  it.each([
    ["paid", { payment_status: "paid", status: "complete" }],
    ["asynchronous payment is pending", { payment_status: "unpaid", status: "complete" }],
  ])("blocks deletion when the live Session is %s", async (_label, providerState) => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );
    await createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    });
    const purchase = onlyPurchase(fake.purchases);
    mocks.stripeCheckoutRetrieve.mockResolvedValueOnce({
      ...buildStripeSessionFromPurchase(purchase),
      ...providerState,
      url: null,
    });
    fake.member.suspendedAt = NOW;

    await expect(closeHostedUsageCreditPurchasesForAccountDeletion({
      memberIds: [MEMBER_ID],
      now: new Date(NOW.getTime() + 60_000),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_USAGE_CREDIT_PAYMENT_PENDING",
      retryable: true,
    });
    expect(mocks.stripeCheckoutExpire).not.toHaveBeenCalled();
    expect(purchase).toMatchObject({
      checkoutCreateState: "attached",
      status: "payment_pending",
    });
  });

  it(
    "blocks deletion for local payment-pending state without deleting its reconciliation owner",
    async () => {
      const fake = createFakePrisma();
      mocks.getPrisma.mockReturnValue(fake.prisma);
      mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
        buildStripeSession(request)
      );
      await createHostedUsageCreditCheckout({
        clientRequestKey: CLIENT_REQUEST_KEY,
        memberId: MEMBER_ID,
        now: NOW,
        offerCode: "usage_10_usd",
      });
      const purchase = onlyPurchase(fake.purchases);
      purchase.status = "payment_pending";
      fake.member.suspendedAt = NOW;

      await expect(closeHostedUsageCreditPurchasesForAccountDeletion({
        memberIds: [MEMBER_ID],
        now: new Date(NOW.getTime() + 60_000),
      })).rejects.toMatchObject({
        code: "ACCOUNT_DELETION_USAGE_CREDIT_PAYMENT_PENDING",
        retryable: true,
      });
      expect(mocks.stripeCheckoutRetrieve).not.toHaveBeenCalled();
      expect(mocks.stripeCheckoutExpire).not.toHaveBeenCalled();
    },
  );
});

describe("readHostedUsageCreditPurchaseStatus", () => {
  it("projects a claimed purchase as reconciliation without provider I/O", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate.mockRejectedValueOnce(new Error("connection lost"));
    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    })).rejects.toBeTruthy();
    const purchase = onlyPurchase(fake.purchases);
    clearStripeProviderMockHistory();

    await expect(readHostedUsageCreditPurchaseStatus({
      payerMemberId: MEMBER_ID,
      purchaseId: String(purchase.id),
    })).resolves.toMatchObject({
      purchaseId: purchase.id,
      status: "reconciling",
    });
    expectNoStripeProviderIo();
  });

  it("does not reveal another payer's purchase", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate.mockRejectedValueOnce(new Error("connection lost"));
    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    })).rejects.toBeTruthy();
    const purchase = onlyPurchase(fake.purchases);

    await expect(readHostedUsageCreditPurchaseStatus({
      payerMemberId: "hbm_someone_else",
      purchaseId: String(purchase.id),
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_PURCHASE_NOT_FOUND",
      httpStatus: 404,
    });
  });
});

function buildStripeSession(request: Record<string, unknown>) {
  return {
    adaptive_pricing: request.adaptive_pricing,
    client_reference_id: request.client_reference_id,
    customer: request.customer,
    expires_at: request.expires_at,
    id: "cs_test_usage_credit_123",
    livemode: false,
    metadata: request.metadata,
    mode: "payment",
    payment_status: "unpaid",
    status: "open",
    url: "https://checkout.stripe.test/session",
  };
}

function clearStripeProviderMockHistory(): void {
  mocks.stripeCheckoutCreate.mockClear();
  mocks.stripeCheckoutExpire.mockClear();
  mocks.stripeCheckoutList.mockClear();
  mocks.stripeCheckoutRetrieve.mockClear();
  mocks.stripePriceRetrieve.mockClear();
}

function expectNoStripeProviderIo(): void {
  expect(mocks.stripeCheckoutCreate).not.toHaveBeenCalled();
  expect(mocks.stripeCheckoutExpire).not.toHaveBeenCalled();
  expect(mocks.stripeCheckoutList).not.toHaveBeenCalled();
  expect(mocks.stripeCheckoutRetrieve).not.toHaveBeenCalled();
  expect(mocks.stripePriceRetrieve).not.toHaveBeenCalled();
}

function buildStripePrice(override: Record<string, unknown> = {}) {
  return {
    active: true,
    billing_scheme: "per_unit",
    currency: "usd",
    currency_options: null,
    custom_unit_amount: null,
    id: "price_usage_10",
    livemode: false,
    object: "price",
    recurring: null,
    transform_quantity: null,
    type: "one_time",
    unit_amount: 1_000,
    ...override,
  };
}

function buildStripePriceForId(priceId: string) {
  const amountByPriceId: Record<string, number> = {
    price_usage_5: 500,
    price_usage_10: 1_000,
    price_usage_25: 2_500,
  };
  return buildStripePrice({
    id: priceId,
    unit_amount: amountByPriceId[priceId] ?? -1,
  });
}

function buildStripeSessionFromPurchase(purchase: Record<string, unknown>) {
  return {
    adaptive_pricing: { enabled: false },
    client_reference_id: purchase.checkoutClientReferenceId,
    customer: "cus_123",
    expires_at: Math.floor((purchase.checkoutExpiresAt as Date).getTime() / 1_000),
    id: "cs_test_usage_credit_123",
    livemode: false,
    metadata: purchase.checkoutMetadataJson,
    mode: "payment",
    payment_status: "unpaid",
    status: "open",
    url: "https://checkout.stripe.test/session",
  };
}

function createFakePrisma(input: {
  memberOverride?: Record<string, unknown>;
} = {}) {
  const purchases = new Map<string, Record<string, unknown>>();
  const hostedUsageCreditPurchase = {
    create: vi.fn(async (query: { data: Record<string, unknown> }) => {
      const record: Record<string, unknown> = {
        checkoutCreateState: "not_started",
        fulfilledAt: null,
        lastReconciledAt: null,
        paidAt: null,
        reconciliationVersion: 0n,
        remainingCreditUsdMicros: 0n,
        status: "created",
        stripeChargeIdEncrypted: null,
        stripeChargeLookupKey: null,
        stripeCheckoutSessionIdEncrypted: null,
        stripeCheckoutSessionLookupKey: null,
        stripeCheckoutUrlEncrypted: null,
        stripePaymentIntentIdEncrypted: null,
        stripePaymentIntentLookupKey: null,
        terminalAt: null,
        ...query.data,
      };
      purchases.set(String(record.id), record);
      return record;
    }),
    findFirst: vi.fn(async (query: PurchaseQuery) => {
      const record = [...purchases.values()].find((candidate) =>
        matchesPurchaseWhere(candidate, query.where)
      ) ?? null;
      return projectFakeRecord(record, query.select);
    }),
    findMany: vi.fn(async (query: PurchaseQuery) =>
      [...purchases.values()]
        .filter((candidate) => matchesPurchaseWhere(candidate, query.where))
        .sort((left, right) => String(left.id).localeCompare(String(right.id)))
        .map((record) => projectFakeRecord(record, query.select)),
    ),
    findUnique: vi.fn(async (query: PurchaseQuery) => {
      const where = query.where;
      let record: Record<string, unknown> | null = null;
      if (typeof where.id === "string") {
        record = purchases.get(where.id) ?? null;
      } else if (isFakeRecord(where.payerMemberId_clientRequestKey)) {
        const requestIdentity = where.payerMemberId_clientRequestKey;
        record = [...purchases.values()].find((candidate) =>
          candidate.payerMemberId === requestIdentity.payerMemberId &&
          candidate.clientRequestKey === requestIdentity.clientRequestKey
        ) ?? null;
      }
      return projectFakeRecord(record, query.select);
    }),
    updateMany: vi.fn(async (query: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    }) => {
      let count = 0;
      for (const record of purchases.values()) {
        if (!matchesPurchaseWhere(record, query.where)) {
          continue;
        }
        for (const [key, value] of Object.entries(query.data)) {
          if (isFakeRecord(value) && typeof value.increment === "bigint") {
            record[key] = (record[key] as bigint) + value.increment;
          } else {
            record[key] = value;
          }
        }
        count += 1;
      }
      return { count };
    }),
  };
  const member = {
    accountGroupMemberships: [],
    billingStatus: "active",
    suspendedAt: null as Date | null,
    threadContainer: null,
    ...input.memberOverride,
  };
  const hostedMember = {
    findUnique: vi.fn(async () => member),
  };
  const prisma = {
    hostedMember,
    hostedUsageCreditPurchase,
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (
    callback: (tx: typeof prisma) => Promise<unknown>,
  ) => callback(prisma));

  return { member, prisma, purchases };
}

interface PurchaseQuery {
  select?: Record<string, boolean>;
  where: Record<string, unknown>;
}

function matchesPurchaseWhere(
  record: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR" && Array.isArray(expected)) {
      return expected.some((condition) =>
        isFakeRecord(condition) && matchesPurchaseWhere(record, condition)
      );
    }
    if (key === "AND" && Array.isArray(expected)) {
      return expected.every((condition) =>
        isFakeRecord(condition) && matchesPurchaseWhere(record, condition)
      );
    }
    if (isFakeRecord(expected) && Array.isArray(expected.in)) {
      return expected.in.includes(record[key]);
    }
    if (isFakeRecord(expected) && "not" in expected) {
      return record[key] !== expected.not;
    }
    if (isFakeRecord(expected) && expected.lte instanceof Date) {
      return record[key] instanceof Date && record[key].getTime() <= expected.lte.getTime();
    }
    return record[key] === expected;
  });
}

function projectFakeRecord(
  record: Record<string, unknown> | null,
  select: Record<string, boolean> | undefined,
): Record<string, unknown> | null {
  if (!record || !select) {
    return record;
  }
  return Object.fromEntries(
    Object.keys(select).filter((key) => select[key]).map((key) => [key, record[key]]),
  );
}

function onlyPurchase(
  purchases: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
  expect(purchases.size).toBe(1);
  const purchase = purchases.values().next().value;
  if (!purchase) {
    throw new Error("Expected one usage-credit purchase.");
  }
  return purchase;
}

function isFakeRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
