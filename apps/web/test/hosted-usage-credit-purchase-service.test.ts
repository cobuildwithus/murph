import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nextServerMocks = vi.hoisted(() => ({
  after: vi.fn<(task: () => Promise<void>) => void>(),
}));

vi.mock("next/server", () => ({
  after: nextServerMocks.after,
}));

const mocks = vi.hoisted(() => ({
  createHostedStripeBillingEventLookupKey: vi.fn(
    (value: string | null | undefined) => value ? `billing:${value}` : null,
  ),
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
    input.kind === "stripe-price"
      ? "price"
      : input.kind === "stripe-customer"
        ? "customer"
        : input.kind === "stripe-billing-event"
          ? "billing"
          : "checkout"
  }:${input.normalizedValue}`),
  decryptHostedWebNullableString: vi.fn(async (input: { value?: string | null }) =>
    input.value?.startsWith("encrypted:") ? input.value.slice("encrypted:".length) : null
  ),
  encryptHostedWebNullableString: vi.fn(async (input: { value?: string | null }) =>
    input.value ? `encrypted:${input.value}` : null
  ),
  ensureHostedMemberStripeCustomer: vi.fn(),
  getPrisma: vi.fn(),
  hasHostedRuntimeActiveAccessForUpdateTx: vi.fn(),
  lockHostedMemberRow: vi.fn(async () => {}),
  readHostedAiUsageGate: vi.fn(),
  readHostedPersonalUsageCreditOfferCodes: vi.fn(),
  readHostedConfiguredUsageCreditOfferCodes: vi.fn(),
  readHostedGroupUsageFundingTargetByJoinCode: vi.fn(),
  readHostedAccountGroupStripeBillingRef: vi.fn(),
  resolveHostedFamilyUsageCreditCheckoutTargetTx: vi.fn(),
  readHostedMemberBillingSnapshot: vi.fn(),
  readHostedMemberStripeBillingRef: vi.fn(),
  requireHostedOnboardingPublicBaseUrl: vi.fn(() => "https://join.example.test"),
  requireHostedStripeApiMode: vi.fn(),
  requireHostedStripeUsageCreditCheckoutConfig: vi.fn(),
  stripeCheckoutCreate: vi.fn(),
  stripeCheckoutExpire: vi.fn(),
  stripeCheckoutList: vi.fn(),
  stripeCheckoutRetrieve: vi.fn(),
  stripeCustomerRetrieve: vi.fn(),
  stripePaymentIntentCancel: vi.fn(),
  stripePaymentIntentConfirm: vi.fn(),
  stripePaymentIntentCreate: vi.fn(),
  stripePaymentIntentRetrieve: vi.fn(),
  stripePaymentMethodsList: vi.fn(),
  stripePriceRetrieve: vi.fn(),
  stripeSubscriptionsList: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/contact-privacy", () => ({
  createHostedStripeBillingEventLookupKey:
    mocks.createHostedStripeBillingEventLookupKey,
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

vi.mock("@/src/lib/hosted-crypto/secure-box", () => ({
  openHostedUserSecureBoxStrings: vi.fn(async (input: {
    entries: Array<{ value: string | null }>;
  }) => input.entries.map((entry) =>
    entry.value?.startsWith("sealed:")
      ? entry.value.slice("sealed:".length)
      : null
  )),
  sealHostedUserSecureBoxStrings: vi.fn(async (input: {
    entries: Array<{ value: string }>;
  }) => input.entries.map((entry) => `sealed:${entry.value}`)),
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberStripeBillingRef: mocks.readHostedMemberStripeBillingRef,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", () => ({
  readHostedMemberBillingSnapshot: mocks.readHostedMemberBillingSnapshot,
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  hasHostedAccountGroupAccess: (input: {
    billingStatus: string;
    suspendedAt?: Date | null;
  }) => input.billingStatus === "active" && !input.suspendedAt,
  readHostedAccountGroupStripeBillingRef:
    mocks.readHostedAccountGroupStripeBillingRef,
  resolveHostedFamilyUsageCreditCheckoutTargetTx:
    mocks.resolveHostedFamilyUsageCreditCheckoutTargetTx,
}));

vi.mock("@/src/lib/hosted-onboarding/personal-usage-credit-eligibility", () => ({
  readHostedConfiguredUsageCreditOfferCodes:
    mocks.readHostedConfiguredUsageCreditOfferCodes,
  readHostedPersonalUsageCreditOfferCodes:
    mocks.readHostedPersonalUsageCreditOfferCodes,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-stripe-customer", () => ({
  ensureHostedMemberStripeCustomer: mocks.ensureHostedMemberStripeCustomer,
}));

vi.mock("@/src/lib/hosted-groups/group-usage-funding", () => ({
  buildHostedGroupUsageFundingPath: (joinCode: string) =>
    `/groups/fund/${encodeURIComponent(joinCode)}`,
  normalizeHostedGroupUsageFundingLocator: (value: unknown) =>
    typeof value === "string" && value.length >= 16 ? value : null,
  normalizeHostedGroupUsageJoinCode: (value: unknown) =>
    typeof value === "string" && value.length >= 16 && !value.startsWith("gf1.")
      ? value
      : null,
  readHostedGroupUsageFundingLocatorRuntimeMemberId: (value: unknown) =>
    typeof value === "string" && value.startsWith("gf1.")
      ? value.split(".")[1] ?? null
      : null,
  readHostedGroupUsageFundingTargetByLocator:
    mocks.readHostedGroupUsageFundingTargetByJoinCode,
}));

vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({
  hasHostedRuntimeActiveAccessForUpdateTx:
    mocks.hasHostedRuntimeActiveAccessForUpdateTx,
}));

vi.mock("@/src/lib/hosted-execution/usage-allowance", () => ({
  readHostedAiUsageGate: mocks.readHostedAiUsageGate,
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
  createHostedFamilyMemberUsageCreditCheckout,
  createHostedGroupUsageCreditCheckout,
  createHostedUsageCreditCheckout,
  expireHostedUsageCreditCheckout,
  parseHostedGroupSponsorshipCheckoutRequest,
  parseHostedUsageCreditCheckoutRequest,
  readHostedActiveUsageCreditPurchaseForPayer,
  readHostedUsageCreditPurchaseTargetForPayer,
  readHostedUsageCreditPurchaseStatus,
  recoverHostedGroupSponsorshipUsageCreditCheckout,
} from "@/src/lib/hosted-onboarding/usage-credit-purchase-service";
import {
  buildHostedUsageCreditSavedCardIdempotencyKey,
  tryChargeHostedUsageCreditSavedCard,
} from "@/src/lib/hosted-onboarding/usage-credit-saved-card-payment";
import {
  buildHostedUsageCreditSavedCardMetadata,
  reconstructHostedUsageCreditStripeCheckoutRequest,
} from "@/src/lib/hosted-onboarding/usage-credit-purchase-stripe";
import {
  hostedUsageCreditPolicySupportsSavedCardTarget,
} from "@/src/lib/hosted-onboarding/usage-credit-offers";

const NOW = new Date("2026-07-16T17:00:00.000Z");
const LAST_STRIPE_EVENT_AT = new Date("2026-07-16T16:59:00.000Z");
const MEMBER_ID = "hbm_member123";
const CLIENT_REQUEST_KEY = "request_key_123456";

function buildPersonalSavedCardBillingSnapshot(input?: {
  billingStatus?: "active" | "canceled";
  lastStripeEventCreatedAt?: Date;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}) {
  return {
    billingRef: {
      currentBillingPhase: "paid",
      currentBillingPlanCode: "launch_monthly",
      currentCheckoutOffer: "standard",
      lastStripeEventCreatedAt:
        input?.lastStripeEventCreatedAt ?? LAST_STRIPE_EVENT_AT,
      memberId: MEMBER_ID,
      stripeCustomerId: input?.stripeCustomerId ?? "cus_123",
      stripeSubscriptionId: input?.stripeSubscriptionId ?? "sub_123",
    },
    core: {
      billingStatus: input?.billingStatus ?? "active",
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      id: MEMBER_ID,
      suspendedAt: null,
      updatedAt: NOW,
    },
  };
}

function buildFamilySavedCardBillingRef(input?: {
  billingStatus?: "active" | "canceled";
  lastStripeEventCreatedAt?: Date;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}) {
  return {
    group: {
      billingStatus: input?.billingStatus ?? "active",
      id: "hbag_abcdefghijklmnop",
      ownerMemberId: MEMBER_ID,
      suspendedAt: null,
    },
    groupId: "hbag_abcdefghijklmnop",
    lastStripeEventCreatedAt:
      input?.lastStripeEventCreatedAt ?? LAST_STRIPE_EVENT_AT,
    stripeCustomerId: input?.stripeCustomerId ?? "cus_family_owner",
    stripeSubscriptionId:
      input?.stripeSubscriptionId ?? "sub_family_owner",
    updatedAt: NOW,
  };
}

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
  mocks.stripeCustomerRetrieve.mockReset();
  mocks.stripePaymentIntentCancel.mockReset();
  mocks.stripePaymentIntentConfirm.mockReset();
  mocks.stripePaymentIntentCreate.mockReset();
  mocks.stripePaymentIntentRetrieve.mockReset();
  mocks.stripePaymentMethodsList.mockReset();
  mocks.stripePriceRetrieve.mockReset();
  mocks.stripeSubscriptionsList.mockReset();
  mocks.lockHostedMemberRow.mockReset();
  mocks.lockHostedMemberRow.mockImplementation(async () => {});
  mocks.readHostedMemberStripeBillingRef.mockResolvedValue({
    currentBillingPhase: "paid",
    currentBillingPlanCode: "launch_monthly",
    currentCheckoutOffer: "standard",
    memberId: MEMBER_ID,
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
  });
  mocks.readHostedMemberBillingSnapshot.mockResolvedValue(
    buildPersonalSavedCardBillingSnapshot(),
  );
  mocks.readHostedPersonalUsageCreditOfferCodes.mockResolvedValue([
    "usage_5_usd",
    "usage_10_usd",
    "usage_25_usd",
  ]);
  mocks.readHostedConfiguredUsageCreditOfferCodes.mockReturnValue([
    "usage_5_usd",
    "usage_10_usd",
    "usage_25_usd",
  ]);
  mocks.ensureHostedMemberStripeCustomer.mockResolvedValue("cus_group_payer");
  mocks.hasHostedRuntimeActiveAccessForUpdateTx.mockResolvedValue(true);
  mocks.readHostedGroupUsageFundingTargetByJoinCode.mockResolvedValue({
    displayName: "Sunday sleep crew",
    fundingPath: "/groups/fund/group_join_code_1234",
    joinCode: "group_join_code_1234",
    kind: "friends",
    runtimeMemberId: "member_group_runtime",
  });
  mocks.resolveHostedFamilyUsageCreditCheckoutTargetTx.mockResolvedValue({
    beneficiaryMemberId: "hbm_familymember1",
    groupId: "hbag_abcdefghijklmnop",
    stripeCustomerId: "cus_family_owner",
  });
  mocks.readHostedAccountGroupStripeBillingRef.mockResolvedValue(
    buildFamilySavedCardBillingRef(),
  );
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
        customers: { retrieve: mocks.stripeCustomerRetrieve },
        paymentIntents: {
          cancel: mocks.stripePaymentIntentCancel,
          confirm: mocks.stripePaymentIntentConfirm,
          create: mocks.stripePaymentIntentCreate,
          retrieve: mocks.stripePaymentIntentRetrieve,
        },
        paymentMethods: { list: mocks.stripePaymentMethodsList },
        prices: { retrieve: mocks.stripePriceRetrieve },
        subscriptions: { list: mocks.stripeSubscriptionsList },
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
      customers: { retrieve: mocks.stripeCustomerRetrieve },
      paymentIntents: {
        cancel: mocks.stripePaymentIntentCancel,
        confirm: mocks.stripePaymentIntentConfirm,
        create: mocks.stripePaymentIntentCreate,
        retrieve: mocks.stripePaymentIntentRetrieve,
      },
      paymentMethods: { list: mocks.stripePaymentMethodsList },
      prices: { retrieve: mocks.stripePriceRetrieve },
      subscriptions: { list: mocks.stripeSubscriptionsList },
    },
    stripeLiveMode: false,
  });
  mocks.stripeCustomerRetrieve.mockImplementation(async (customerId: string) => ({
    id: customerId,
    invoice_settings: { default_payment_method: null },
    livemode: false,
    object: "customer",
  }));
  mocks.stripePaymentMethodsList.mockResolvedValue({
    data: [],
    has_more: false,
    object: "list",
    url: "/v1/payment_methods",
  });
  mocks.stripeSubscriptionsList.mockResolvedValue({
    data: [],
    has_more: false,
    object: "list",
    url: "/v1/subscriptions",
  });
  mocks.stripePriceRetrieve.mockImplementation(async (priceId: string) =>
    buildStripePriceForId(priceId)
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("parseHostedUsageCreditCheckoutRequest", () => {
  it("accepts only an exact opaque offer and request key", () => {
    expect(parseHostedUsageCreditCheckoutRequest({
      clientRequestKey: CLIENT_REQUEST_KEY,
      offerCode: "usage_10_usd",
    })).toEqual({
      clientRequestKey: CLIENT_REQUEST_KEY,
      offerCode: "usage_10_usd",
      recoveryOnly: false,
    });
  });

  it("accepts only the literal recovery-only capability", () => {
    expect(parseHostedUsageCreditCheckoutRequest({
      clientRequestKey: CLIENT_REQUEST_KEY,
      offerCode: "usage_10_usd",
      recoveryOnly: true,
    })).toEqual({
      clientRequestKey: CLIENT_REQUEST_KEY,
      offerCode: "usage_10_usd",
      recoveryOnly: true,
    });
  });

  it.each([
    { clientRequestKey: CLIENT_REQUEST_KEY, offerCode: "usage_10_usd", amount: 10 },
    { clientRequestKey: "short", offerCode: "usage_10_usd" },
    { clientRequestKey: CLIENT_REQUEST_KEY, offerCode: "usage_100_usd" },
    {
      clientRequestKey: CLIENT_REQUEST_KEY,
      offerCode: "usage_10_usd",
      recoveryOnly: false,
    },
  ])("rejects malformed or browser-authoritative input", (input) => {
    expect(() => parseHostedUsageCreditCheckoutRequest(input)).toThrowError(
      expect.objectContaining({ httpStatus: 400 }),
    );
  });
});

describe("usage-credit saved-card policy", () => {
  it.each([
    ["hosted-usage-credit-checkout-v1", "personal", false],
    ["hosted-usage-credit-checkout-v1", "family", false],
    ["hosted-usage-credit-checkout-v1", "group", false],
    ["hosted-usage-credit-checkout-v2", "personal", false],
    ["hosted-usage-credit-checkout-v2", "family", false],
    ["hosted-usage-credit-checkout-v2", "group", true],
    ["hosted-usage-credit-checkout-v3", "personal", true],
    ["hosted-usage-credit-checkout-v3", "family", true],
    ["hosted-usage-credit-checkout-v3", "group", true],
    ["hosted-usage-credit-checkout-v4", "personal", true],
    ["hosted-usage-credit-checkout-v4", "family", true],
    ["hosted-usage-credit-checkout-v4", "group", true],
  ] as const)(
    "maps %s and %s to saved-card support=%s",
    (policyVersion, targetKind, supported) => {
      expect(hostedUsageCreditPolicySupportsSavedCardTarget({
        policyVersion,
        targetKind,
      })).toBe(supported);
    },
  );

  it.each([
    "hosted-usage-credit-checkout-v2",
    "hosted-usage-credit-checkout-v3",
    "hosted-usage-credit-checkout-v4",
  ] as const)("freezes %s in saved-card metadata", (policyVersion) => {
    expect(buildHostedUsageCreditSavedCardMetadata(
      "hucp_abcdefghijklmnop",
      policyVersion,
    )).toEqual({
      policyVersion,
      purchaseId: "hucp_abcdefghijklmnop",
      purpose: "hosted_usage_credit_saved_card",
    });
  });
});

describe("parseHostedGroupSponsorshipCheckoutRequest", () => {
  it("accepts only group offers and bounded optional social copy", () => {
    expect(parseHostedGroupSponsorshipCheckoutRequest({
      clientRequestKey: CLIENT_REQUEST_KEY,
      offerCode: "usage_20_usd",
      sponsorship: {
        publicAlias: " The Group Historian ",
        runningBitRequest: "Treat me like the exhausted CFO.",
        sponsorMessage: "For whatever adventure comes next.",
      },
    })).toEqual({
      clientRequestKey: CLIENT_REQUEST_KEY,
      monthlyCapMinor: null,
      offerCode: "usage_20_usd",
      recoveryOnly: false,
      sponsorship: {
        publicAlias: "The Group Historian",
        runningBitRequest: "Treat me like the exhausted CFO.",
        sponsorMessage: "For whatever adventure comes next.",
      },
      sponsorshipKind: "one_time",
    });
  });

  it("parses monthly sponsorship as an exact $5 activation with an explicit cap", () => {
    expect(parseHostedGroupSponsorshipCheckoutRequest({
      clientRequestKey: CLIENT_REQUEST_KEY,
      monthlyCapMinor: 1_000,
      offerCode: "usage_5_usd",
      sponsorshipKind: "monthly",
    })).toEqual({
      clientRequestKey: CLIENT_REQUEST_KEY,
      monthlyCapMinor: 1_000,
      offerCode: "usage_5_usd",
      recoveryOnly: false,
      sponsorship: null,
      sponsorshipKind: "monthly",
    });
    expect(() => parseHostedGroupSponsorshipCheckoutRequest({
      clientRequestKey: CLIENT_REQUEST_KEY,
      monthlyCapMinor: 1_000,
      offerCode: "usage_10_usd",
      sponsorshipKind: "monthly",
    })).toThrowError(expect.objectContaining({ httpStatus: 400 }));
  });

  it.each([
    {
      clientRequestKey: CLIENT_REQUEST_KEY,
      offerCode: "usage_25_usd",
    },
    {
      clientRequestKey: CLIENT_REQUEST_KEY,
      offerCode: "usage_10_usd",
      sponsorship: { publicAlias: "Sponsor", role: "administrator" },
    },
  ])("rejects non-group offers and extra sponsorship authority", (input) => {
    expect(() => parseHostedGroupSponsorshipCheckoutRequest(input))
      .toThrowError(expect.objectContaining({ httpStatus: 400 }));
  });
});

describe("createHostedUsageCreditCheckout", () => {
  it("admits a new Family checkout with 31 combined occupied slots under beneficiary-first locking", async () => {
    const usageCreditEvents: string[] = [];
    const fake = createFakePrisma({
      occupiedUsageCreditSlotCount: 31,
      usageCreditEvents,
    });
    mocks.lockHostedMemberRow.mockImplementationOnce(async () => {
      usageCreditEvents.push("payer-lock");
    });
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );

    await expect(createHostedFamilyMemberUsageCreditCheckout({
      beneficiaryMemberId: "hbm_familymember1",
      clientRequestKey: CLIENT_REQUEST_KEY,
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toMatchObject({ status: "checkout_open" });

    expect(usageCreditEvents).toEqual([
      "beneficiary-lock",
      "payer-lock",
      "capacity-read",
      "purchase-create",
    ]);
    expect(fake.usageCreditBeneficiaryLockQueryCalls).toHaveLength(1);
    expect(fake.usageCreditCapacityQueryCalls).toHaveLength(1);
    expect(fake.usageCreditCapacityQueryCalls[0]?.values).toEqual([
      "hbm_familymember1",
      "hbm_familymember1",
      33,
      null,
    ]);
    expect(onlyPurchase(fake.purchases)).toMatchObject({
      beneficiaryMemberId: "hbm_familymember1",
      grantSlotReleasedAt: null,
      payerMemberId: MEMBER_ID,
      status: "checkout_open",
    });
  });

  it("rejects a new personal checkout at 32 combined slots before creating a purchase", async () => {
    const usageCreditEvents: string[] = [];
    const fake = createFakePrisma({
      occupiedUsageCreditSlotCount: 32,
      usageCreditEvents,
    });

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
      prisma: fake.prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_NOT_ELIGIBLE",
      httpStatus: 409,
    });

    expect(usageCreditEvents).toEqual([
      "beneficiary-lock",
      "capacity-read",
    ]);
    expect(fake.usageCreditBeneficiaryLockQueryCalls).toHaveLength(1);
    expect(mocks.lockHostedMemberRow).not.toHaveBeenCalled();
    expect(fake.prisma.hostedUsageCreditPurchase.create).not.toHaveBeenCalled();
    expect(fake.purchases.size).toBe(0);
    expect(mocks.stripeCheckoutCreate).not.toHaveBeenCalled();
    expect(mocks.encryptHostedWebNullableString).not.toHaveBeenCalled();
  });

  it("returns a matching active purchase at capacity without reserving another slot", async () => {
    let occupiedUsageCreditSlotCount = 31;
    const fake = createFakePrisma({
      occupiedUsageCreditSlotCount: () => occupiedUsageCreditSlotCount,
    });
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );

    const initial = await createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
      prisma: fake.prisma as never,
    });
    occupiedUsageCreditSlotCount = 32;
    const replay = await createHostedUsageCreditCheckout({
      clientRequestKey: "matching_active_key_1234",
      memberId: MEMBER_ID,
      now: new Date(NOW.getTime() + 1_000),
      offerCode: "usage_10_usd",
      prisma: fake.prisma as never,
    });

    expect(replay).toMatchObject({
      purchaseId: initial.purchaseId,
      recovered: true,
      status: "checkout_open",
    });
    expect(fake.usageCreditCapacityQueryCalls).toHaveLength(1);
    expect(fake.prisma.hostedUsageCreditPurchase.create).toHaveBeenCalledOnce();
    expect(fake.purchases.size).toBe(1);
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledOnce();
  });

  it("preserves price-read request identity while keeping recovered retries silent", async () => {
    const fake = createFakePrisma();
    const fetchMock = stubStripeAlertEmailDelivery();
    mocks.stripePriceRetrieve
      .mockRejectedValueOnce(buildStripeConnectionError("req_first_failure"))
      .mockRejectedValue(buildStripeConnectionError("req_second_failure"));

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
      prisma: fake.prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
    });

    await runOnlyScheduledStripeAlert();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstAlert = readResendRequestBody(fetchMock);
    expect(firstAlert).toMatchObject({
      subject: "Murph Stripe operation failed — usage-credit.checkout",
    });
    expect(firstAlert.text).toContain("error type: StripeConnectionError");
    expect(firstAlert.text).toContain("error code: api_connection_error");
    expect(firstAlert.text).toContain("http status: 503");
    expect(firstAlert.text).toContain("Stripe request id: req_first_failure");

    nextServerMocks.after.mockClear();
    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: "recovered_price_read_key",
      memberId: MEMBER_ID,
      now: new Date(NOW.getTime() + 1_000),
      offerCode: "usage_10_usd",
      prisma: fake.prisma as never,
    })).resolves.toMatchObject({
      recovered: true,
      status: "reconciling",
    });
    expect(nextServerMocks.after).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: new Date(NOW.getTime() + 2_000),
      offerCode: "usage_10_usd",
      prisma: fake.prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
    });
    await runOnlyScheduledStripeAlert();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(readResendIdempotencyKey(fetchMock, 1)).not.toBe(
      readResendIdempotencyKey(fetchMock, 0),
    );
    expect(fetchMock.mock.calls[1]?.[1]?.body).not.toBe(
      fetchMock.mock.calls[0]?.[1]?.body,
    );
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain(
      "req_second_failure",
    );

    nextServerMocks.after.mockClear();
    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: new Date(NOW.getTime() + 3_000),
      offerCode: "usage_10_usd",
      prisma: fake.prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
    });
    await runOnlyScheduledStripeAlert();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(readResendIdempotencyKey(fetchMock, 2)).toBe(
      readResendIdempotencyKey(fetchMock, 1),
    );
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(
      fetchMock.mock.calls[1]?.[1]?.body,
    );
  });

  it("emails when final Checkout Session creation terminates the action", async () => {
    const fake = createFakePrisma();
    const fetchMock = stubStripeAlertEmailDelivery();
    mocks.stripeCheckoutCreate.mockRejectedValueOnce(
      buildStripeConnectionError("req_session_create_failed"),
    );

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
      prisma: fake.prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
    });

    await runOnlyScheduledStripeAlert();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("emails when saved-card preparation terminates the checkout action", async () => {
    const fake = createFakePrisma();
    const fetchMock = stubStripeAlertEmailDelivery();
    mockCanonicalSavedCard("cus_123");
    mocks.stripeSubscriptionsList.mockResolvedValueOnce({
      data: [{
        customer: "cus_123",
        default_payment_method: null,
        id: "sub_123",
        livemode: false,
        object: "subscription",
        status: "active",
      }],
      has_more: false,
      object: "list",
      url: "/v1/subscriptions",
    });
    mocks.stripePaymentIntentCreate.mockRejectedValueOnce(
      buildStripeConnectionError("req_saved_card_failed"),
    );

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
      prisma: fake.prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
    });

    await runOnlyScheduledStripeAlert();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.stripeCheckoutCreate).not.toHaveBeenCalled();
  });

  it("emails when group customer provisioning terminates the checkout action", async () => {
    const fake = createFakePrisma();
    const fetchMock = stubStripeAlertEmailDelivery();
    mocks.ensureHostedMemberStripeCustomer.mockRejectedValueOnce(
      buildStripeConnectionError("req_group_customer_failed"),
    );

    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).rejects.toMatchObject({
      requestId: "req_group_customer_failed",
    });

    await runOnlyScheduledStripeAlert();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fake.purchases.size).toBe(0);
  });

  it("starts monthly group sponsorship through initial capacity admission", async () => {
    const fake = createFakePrisma();
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );

    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      monthlyCapMinor: 1_000,
      now: NOW,
      offerCode: "usage_5_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
      sponsorshipKind: "monthly",
    })).resolves.toMatchObject({ status: "checkout_open" });

    expect([...fake.sponsorshipAuthorizations.values()]).toEqual([
      expect.objectContaining({
        beneficiaryMemberId: "member_group_runtime",
        monthlyCapMinor: 1_000,
        payerMemberId: MEMBER_ID,
        status: "pending_activation",
      }),
    ]);
    expect(onlyPurchase(fake.purchases)).toMatchObject({
      cashAmountMinor: 500,
      grantSlotReleasedAt: null,
      groupSponsorshipAuthorizationId: expect.stringMatching(/^hgsa_/u),
      groupSponsorshipChargeOrdinal: 0,
      offerCode: "usage_5_usd",
    });
    expect(fake.usageCreditCapacityQueryCalls).toHaveLength(1);
  });

  it("charges the Family customer and freezes the selected member as beneficiary", async () => {
    const fake = createFakePrisma();
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );

    const checkout = await createHostedFamilyMemberUsageCreditCheckout({
      beneficiaryMemberId: "hbm_familymember1",
      clientRequestKey: CLIENT_REQUEST_KEY,
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });

    expect(checkout).toMatchObject({
      status: "checkout_open",
      url: "https://checkout.stripe.test/session",
    });
    const purchase = onlyPurchase(fake.purchases);
    expect(purchase).toMatchObject({
      beneficiaryMemberId: "hbm_familymember1",
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
    });
    expect(new URL(String(purchase.checkoutSuccessUrl))).toMatchObject({
      hash: "#family",
      pathname: "/settings",
    });
    const successUrl = new URL(String(purchase.checkoutSuccessUrl));
    expect(Object.fromEntries(successUrl.searchParams)).toEqual({
      usageCheckout: "success",
      usageFamily: "hbag_abcdefghijklmnop",
      usageMember: "hbm_familymember1",
      usagePurchase: checkout.purchaseId,
    });
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: "cus_family_owner",
        payment_intent_data: expect.objectContaining({
          setup_future_usage: "off_session",
        }),
      }),
      expect.any(Object),
    );
    expect(mocks.readHostedConfiguredUsageCreditOfferCodes).toHaveBeenCalledTimes(1);
    expect(mocks.readHostedPersonalUsageCreditOfferCodes).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberStripeBillingRef).not.toHaveBeenCalled();
    expect(mocks.ensureHostedMemberStripeCustomer).not.toHaveBeenCalled();
    await expect(createHostedFamilyMemberUsageCreditCheckout({
      beneficiaryMemberId: "hbm_familymember1",
      clientRequestKey: CLIENT_REQUEST_KEY,
      now: new Date(NOW.getTime() + 1_000),
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toMatchObject({
      purchaseId: checkout.purchaseId,
      status: "checkout_open",
      url: "https://checkout.stripe.test/session",
    });
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledTimes(1);
    await expect(readHostedActiveUsageCreditPurchaseForPayer({
      now: NOW,
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toMatchObject({
      purchaseId: checkout.purchaseId,
      target: {
        beneficiaryMemberId: "hbm_familymember1",
        familyGroupId: "hbag_abcdefghijklmnop",
        kind: "family",
      },
    });
    await expect(readHostedUsageCreditPurchaseTargetForPayer({
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
      purchaseId: checkout.purchaseId,
    })).resolves.toEqual({
      beneficiaryMemberId: "hbm_familymember1",
      familyGroupId: "hbag_abcdefghijklmnop",
      kind: "family",
    });
  });

  it("returns an owner-seat Family purchase to the usage meter and reads legacy URLs", async () => {
    const fake = createFakePrisma();
    mocks.resolveHostedFamilyUsageCreditCheckoutTargetTx.mockResolvedValueOnce({
      beneficiaryMemberId: MEMBER_ID,
      groupId: "hbag_abcdefghijklmnop",
      stripeCustomerId: "cus_family_owner",
    });
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );

    const checkout = await createHostedFamilyMemberUsageCreditCheckout({
      beneficiaryMemberId: MEMBER_ID,
      clientRequestKey: CLIENT_REQUEST_KEY,
      now: NOW,
      offerCode: "usage_5_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });
    const purchase = onlyPurchase(fake.purchases);
    const successUrl = new URL(String(purchase.checkoutSuccessUrl));
    const cancelUrl = new URL(String(purchase.checkoutCancelUrl));
    expect(successUrl).toMatchObject({
      hash: "#subscription",
      pathname: "/settings",
    });
    expect(cancelUrl).toMatchObject({
      hash: "#subscription",
      pathname: "/settings",
    });
    expect(Object.fromEntries(successUrl.searchParams)).toEqual({
      usageCheckout: "success",
      usageFamily: "hbag_abcdefghijklmnop",
      usageMember: MEMBER_ID,
      usagePurchase: checkout.purchaseId,
    });
    expect(Object.fromEntries(cancelUrl.searchParams)).toEqual({
      usageCheckout: "cancel",
      usageFamily: "hbag_abcdefghijklmnop",
      usageMember: MEMBER_ID,
      usagePurchase: checkout.purchaseId,
    });
    await expect(readHostedUsageCreditPurchaseTargetForPayer({
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
      purchaseId: checkout.purchaseId,
    })).resolves.toEqual({
      beneficiaryMemberId: MEMBER_ID,
      familyGroupId: "hbag_abcdefghijklmnop",
      kind: "family",
    });

    successUrl.hash = "family";
    purchase.checkoutSuccessUrl = successUrl.toString();
    await expect(readHostedUsageCreditPurchaseTargetForPayer({
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
      purchaseId: checkout.purchaseId,
    })).resolves.toEqual({
      beneficiaryMemberId: MEMBER_ID,
      familyGroupId: "hbag_abcdefghijklmnop",
      kind: "family",
    });
  });

  it.each([
    ["personal", "cus_123"],
    ["family", "cus_family_owner"],
  ] as const)(
    "charges the canonical saved card for a v4 %s top-up",
    async (targetKind, customerId) => {
      const fake = createFakePrisma();
      mockCanonicalSavedCard(customerId);
      mocks.stripeSubscriptionsList.mockResolvedValueOnce({
        data: [{
          customer: customerId,
          default_payment_method: null,
          id: targetKind === "family" ? "sub_family_owner" : "sub_123",
          livemode: false,
          object: "subscription",
          status: "active",
        }],
        has_more: false,
        object: "list",
        url: "/v1/subscriptions",
      });
      mocks.stripePaymentIntentCreate.mockImplementationOnce(
        async (request: Record<string, unknown>) => ({
          amount: request.amount,
          amount_received: 0,
          currency: request.currency,
          customer: request.customer,
          id: "pi_saved_card_123",
          latest_charge: null,
          livemode: false,
          metadata: request.metadata,
          object: "payment_intent",
          status: "requires_confirmation",
        }),
      );
      mocks.stripePaymentIntentConfirm.mockImplementationOnce(
        async (paymentIntentId: string) => {
          expect(paymentIntentId).toBe("pi_saved_card_123");
          const purchase = onlyPurchase(fake.purchases);
          return buildSavedCardPaymentIntent({
            amountReceived: 1_000,
            customerId,
            latestCharge: "ch_saved_card_123",
            purchaseId: String(purchase.id),
            status: "succeeded",
          });
        },
      );

      const result = targetKind === "family"
        ? await createHostedFamilyMemberUsageCreditCheckout({
            beneficiaryMemberId: "hbm_familymember1",
            clientRequestKey: CLIENT_REQUEST_KEY,
            now: NOW,
            offerCode: "usage_10_usd",
            payerMemberId: MEMBER_ID,
            prisma: fake.prisma as never,
          })
        : await createHostedUsageCreditCheckout({
            clientRequestKey: CLIENT_REQUEST_KEY,
            memberId: MEMBER_ID,
            now: NOW,
            offerCode: "usage_10_usd",
            prisma: fake.prisma as never,
          });

      expect(result).toMatchObject({ status: "payment_pending" });
      expect(result).not.toHaveProperty("url");
      expect(mocks.stripePaymentIntentCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: customerId,
          metadata: expect.objectContaining({
            policyVersion: "hosted-usage-credit-checkout-v4",
          }),
          payment_method: "pm_saved_card_123",
        }),
        expect.any(Object),
      );
      expect(mocks.stripePaymentIntentConfirm).toHaveBeenCalledOnce();
      expect(mocks.stripeCheckoutCreate).not.toHaveBeenCalled();
      const payableTarget = targetKind === "family"
        ? {
            beneficiaryMemberId: "hbm_familymember1",
            familyGroupId: "hbag_abcdefghijklmnop",
            kind: "family" as const,
          }
        : {
            beneficiaryMemberId: MEMBER_ID,
            kind: "personal" as const,
          };
      await expect(readHostedActiveUsageCreditPurchaseForPayer({
        now: new Date(NOW.getTime() + 1_000),
        payerMemberId: MEMBER_ID,
        prisma: fake.prisma as never,
        serverApprovedPayableTargets: [payableTarget],
      })).resolves.toMatchObject({
        retryAllowed: true,
        status: "payment_pending",
        target: payableTarget,
      });
    },
  );

  it("does not confuse an owner Family seat with the owner's personal target", async () => {
    const fake = createFakePrisma();
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );
    await createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
      prisma: fake.prisma as never,
    });
    mocks.resolveHostedFamilyUsageCreditCheckoutTargetTx.mockResolvedValueOnce({
      beneficiaryMemberId: MEMBER_ID,
      groupId: "hbag_abcdefghijklmnop",
      stripeCustomerId: "cus_family_owner",
    });

    const conflict = await createHostedFamilyMemberUsageCreditCheckout({
      beneficiaryMemberId: MEMBER_ID,
      clientRequestKey: "family_owner_key_12",
      now: new Date(NOW.getTime() + 1_000),
      offerCode: "usage_5_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });
    expect(conflict).toMatchObject({
      recovered: true,
      targetConflict: true,
    });
    expect(conflict.url).toBeUndefined();
    expect(conflict.retryAllowed).toBeUndefined();
    expect(fake.purchases.size).toBe(1);
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledTimes(1);
  });

  it.each([
    "personal",
    "family",
  ] as const)(
    "returns the frozen %s purchase without provider I/O when a fresh amount conflicts",
    async (targetKind) => {
      const fake = createFakePrisma();
      mocks.stripeCheckoutCreate.mockRejectedValueOnce(
        new Error("connection lost"),
      );
      const createCheckout = (
        clientRequestKey: string,
        offerCode: "usage_5_usd" | "usage_25_usd",
        now: Date,
      ) => targetKind === "family"
        ? createHostedFamilyMemberUsageCreditCheckout({
            beneficiaryMemberId: "hbm_familymember1",
            clientRequestKey,
            now,
            offerCode,
            payerMemberId: MEMBER_ID,
            prisma: fake.prisma as never,
          })
        : createHostedUsageCreditCheckout({
            clientRequestKey,
            memberId: MEMBER_ID,
            now,
            offerCode,
            prisma: fake.prisma as never,
          });

      await expect(createCheckout(
        CLIENT_REQUEST_KEY,
        "usage_25_usd",
        NOW,
      )).rejects.toMatchObject({
        code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
      });
      clearStripeProviderMockHistory();

      const conflict = await createCheckout(
        "fresh_amount_key_1234",
        "usage_5_usd",
        new Date(NOW.getTime() + 1_000),
      );

      expect(conflict).toMatchObject({
        selectionConflict: "offer",
        recovered: true,
        status: "reconciling",
      });
      expect(conflict).not.toHaveProperty("retryAllowed");
      expect(conflict).not.toHaveProperty("url");

      expect(onlyPurchase(fake.purchases)).toMatchObject({
        clientRequestKey: CLIENT_REQUEST_KEY,
        offerCode: "usage_25_usd",
        status: "created",
      });
      expectNoStripeProviderIo();
    },
  );

  it.each([
    "personal",
    "family",
    "group",
  ] as const)(
    "never creates a new %s purchase when recovery follows a lost amount-conflict response",
    async (targetKind) => {
      const fake = createFakePrisma();
      const originalOfferCode =
        targetKind === "group" ? "usage_10_usd" : "usage_25_usd";
      mocks.stripeCheckoutCreate
        .mockRejectedValueOnce(new Error("connection lost"))
        .mockImplementationOnce(async (request) => buildStripeSession(request));
      const createCheckout = (
        clientRequestKey: string,
        offerCode: "usage_5_usd" | "usage_10_usd" | "usage_25_usd",
        now: Date,
        recoveryOnly = false,
      ) => {
        const recoveryInput = recoveryOnly ? { recoveryOnly: true as const } : {};
        if (targetKind === "family") {
          return createHostedFamilyMemberUsageCreditCheckout({
            beneficiaryMemberId: "hbm_familymember1",
            clientRequestKey,
            now,
            offerCode,
            payerMemberId: MEMBER_ID,
            prisma: fake.prisma as never,
            ...recoveryInput,
          });
        }
        if (targetKind === "group") {
          return createHostedGroupUsageCreditCheckout({
            clientRequestKey,
            joinCode: "group_join_code_1234",
            now,
            offerCode,
            payerMemberId: MEMBER_ID,
            prisma: fake.prisma as never,
            ...recoveryInput,
          });
        }
        return createHostedUsageCreditCheckout({
          clientRequestKey,
          memberId: MEMBER_ID,
          now,
          offerCode,
          prisma: fake.prisma as never,
          ...recoveryInput,
        });
      };

      await expect(createCheckout(
        CLIENT_REQUEST_KEY,
        originalOfferCode,
        NOW,
      )).rejects.toMatchObject({
        code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
      });
      const originalPurchase = onlyPurchase(fake.purchases);
      clearStripeProviderMockHistory();
      mocks.ensureHostedMemberStripeCustomer.mockClear();

      const unboundRecovery = await createCheckout(
        "unbound_recovery_key_12",
        originalOfferCode,
        new Date(NOW.getTime() + 500),
        true,
      );
      expect(unboundRecovery).toMatchObject({
        purchaseId: originalPurchase.id,
        recovered: true,
        status: "checkout_open",
        url: "https://checkout.stripe.test/session",
      });
      expect(unboundRecovery).not.toHaveProperty("requestKeyMatched");
      expect(fake.purchases.size).toBe(1);
      expect(mocks.ensureHostedMemberStripeCustomer).not.toHaveBeenCalled();
      expect(mocks.stripeCheckoutCreate).toHaveBeenCalledOnce();
      clearStripeProviderMockHistory();

      await expect(createCheckout(
        CLIENT_REQUEST_KEY,
        originalOfferCode,
        new Date(NOW.getTime() + 750),
        true,
      )).resolves.toMatchObject({
        purchaseId: originalPurchase.id,
        requestKeyMatched: true,
        status: "checkout_open",
        url: "https://checkout.stripe.test/session",
      });
      expect(fake.purchases.size).toBe(1);
      expectNoStripeProviderIo();

      const rejectedRequestKey = "lost_conflict_key_1234";
      await expect(createCheckout(
        rejectedRequestKey,
        "usage_5_usd",
        new Date(NOW.getTime() + 1_000),
      )).resolves.toMatchObject({
        selectionConflict: "offer",
        recovered: true,
      });

      const frozenPurchase = onlyPurchase(fake.purchases);
      frozenPurchase.status = "fulfilled";
      frozenPurchase.terminalAt = new Date(NOW.getTime() + 2_000);
      clearStripeProviderMockHistory();
      mocks.ensureHostedMemberStripeCustomer.mockClear();

      await expect(createCheckout(
        rejectedRequestKey,
        "usage_5_usd",
        new Date(NOW.getTime() + 3_000),
        true,
      )).resolves.toEqual({ recoveryMiss: true });

      expect(fake.purchases.size).toBe(1);
      expect(onlyPurchase(fake.purchases)).toMatchObject({
        clientRequestKey: CLIENT_REQUEST_KEY,
        offerCode: originalOfferCode,
        status: "fulfilled",
      });
      expect(mocks.ensureHostedMemberStripeCustomer).not.toHaveBeenCalled();
      expectNoStripeProviderIo();
    },
  );

  it.each([
    "personal",
    "family",
    "group",
  ] as const)(
    "continues a retryable %s saved-card payment from its exact bound intent",
    async (targetKind) => {
      const fake = createFakePrisma();
      const customerId = targetKind === "personal"
        ? "cus_123"
        : targetKind === "family"
          ? "cus_family_owner"
          : "cus_group_payer";
      mockCanonicalSavedCard(customerId);
      if (targetKind !== "group") {
        mocks.stripeSubscriptionsList.mockResolvedValueOnce({
          data: [{
            customer: customerId,
            default_payment_method: null,
            id: targetKind === "family" ? "sub_family_owner" : "sub_123",
            livemode: false,
            object: "subscription",
            status: "active",
          }],
          has_more: false,
          object: "list",
          url: "/v1/subscriptions",
        });
      }
      const readUnconfirmedIntent = () => buildSavedCardPaymentIntent({
        amountReceived: 0,
        customerId,
        latestCharge: null,
        purchaseId: String(onlyPurchase(fake.purchases).id),
        status: "requires_confirmation",
      });
      mocks.stripePaymentIntentCreate.mockImplementationOnce(
        async () => readUnconfirmedIntent(),
      );
      mocks.stripePaymentIntentConfirm
        .mockRejectedValueOnce(new Error("connection lost"))
        .mockImplementationOnce(async () => buildSavedCardPaymentIntent({
          amountReceived: 1_000,
          customerId,
          latestCharge: "ch_saved_card_123",
          purchaseId: String(onlyPurchase(fake.purchases).id),
          status: "succeeded",
        }));
      mocks.stripePaymentIntentRetrieve
        .mockRejectedValueOnce(new Error("connection lost"))
        .mockImplementationOnce(async () => readUnconfirmedIntent());
      const createCheckout = (
        clientRequestKey: string,
        recoveryOnly = false,
      ) => {
        const recoveryInput = recoveryOnly ? { recoveryOnly: true as const } : {};
        if (targetKind === "family") {
          return createHostedFamilyMemberUsageCreditCheckout({
            beneficiaryMemberId: "hbm_familymember1",
            clientRequestKey,
            now: recoveryOnly ? new Date(NOW.getTime() + 1_000) : NOW,
            offerCode: "usage_10_usd",
            payerMemberId: MEMBER_ID,
            prisma: fake.prisma as never,
            ...recoveryInput,
          });
        }
        if (targetKind === "group") {
          return createHostedGroupUsageCreditCheckout({
            clientRequestKey,
            joinCode: "group_join_code_1234",
            now: recoveryOnly ? new Date(NOW.getTime() + 1_000) : NOW,
            offerCode: "usage_10_usd",
            payerMemberId: MEMBER_ID,
            prisma: fake.prisma as never,
            ...recoveryInput,
          });
        }
        return createHostedUsageCreditCheckout({
          clientRequestKey,
          memberId: MEMBER_ID,
          now: recoveryOnly ? new Date(NOW.getTime() + 1_000) : NOW,
          offerCode: "usage_10_usd",
          prisma: fake.prisma as never,
          ...recoveryInput,
        });
      };

      await expect(createCheckout(CLIENT_REQUEST_KEY)).rejects.toMatchObject({
        code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
      });
      const originalPurchase = onlyPurchase(fake.purchases);
      expect(originalPurchase).toMatchObject({
        status: "payment_pending",
        stripePaymentIntentLookupKey: "billing:pi_saved_card_123",
      });
      clearStripeProviderMockHistory();
      mocks.ensureHostedMemberStripeCustomer.mockClear();
      if (targetKind === "family") {
        mocks.readHostedAccountGroupStripeBillingRef.mockResolvedValue({
          groupId: "hbag_abcdefghijklmnop",
          stripeCustomerId: customerId,
          stripeSubscriptionId: "sub_family_replacement",
        });
      } else if (targetKind === "personal") {
        mocks.readHostedMemberStripeBillingRef.mockResolvedValue({
          memberId: MEMBER_ID,
          stripeCustomerId: customerId,
          stripeSubscriptionId: "sub_personal_replacement",
        });
      }

      await expect(createCheckout(
        "unbound_recovery_key_12",
        true,
      )).resolves.toMatchObject({
        purchaseId: originalPurchase.id,
        recovered: true,
        status: "payment_pending",
      });

      expect(fake.purchases.size).toBe(1);
      expect(onlyPurchase(fake.purchases)).toMatchObject({
        clientRequestKey: CLIENT_REQUEST_KEY,
        status: "payment_pending",
        stripeChargeLookupKey: "billing:ch_saved_card_123",
      });
      expect(mocks.ensureHostedMemberStripeCustomer).not.toHaveBeenCalled();
      expect(mocks.stripePaymentIntentCreate).not.toHaveBeenCalled();
      expect(mocks.stripePaymentIntentRetrieve).toHaveBeenCalledOnce();
      expect(mocks.stripePaymentIntentConfirm).toHaveBeenCalledOnce();
      expect(mocks.stripeCheckoutCreate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["original_first", "usage_10_usd"],
    ["original_first", "usage_5_usd"],
    ["reauthorization_first", "usage_10_usd"],
    ["reauthorization_first", "usage_5_usd"],
  ] as const)(
    "serializes delayed group creation when %s wins and the next offer is %s",
    async (winner, nextOfferCode) => {
      const fake = createFakePrisma();
      let resolveOriginalCustomer:
        | ((customerId: string) => void)
        | undefined;
      const originalCustomer = new Promise<string>((resolve) => {
        resolveOriginalCustomer = resolve;
      });
      mocks.ensureHostedMemberStripeCustomer
        .mockReset()
        .mockImplementationOnce(async () => originalCustomer)
        .mockResolvedValue("cus_group_payer");
      mocks.stripeCheckoutCreate.mockImplementation(async (request) =>
        buildStripeSession(request)
      );
      const createCheckout = (
        offerCode: "usage_5_usd" | "usage_10_usd",
        recoveryOnly = false,
      ) => createHostedGroupUsageCreditCheckout({
        clientRequestKey: CLIENT_REQUEST_KEY,
        joinCode: "group_join_code_1234",
        now: recoveryOnly ? new Date(NOW.getTime() + 500) : NOW,
        offerCode,
        payerMemberId: MEMBER_ID,
        prisma: fake.prisma as never,
        ...(recoveryOnly ? { recoveryOnly: true as const } : {}),
      });

      const originalRequest = createCheckout("usage_10_usd");
      await vi.waitFor(() => {
        expect(mocks.ensureHostedMemberStripeCustomer).toHaveBeenCalledOnce();
      });

      await expect(createCheckout(
        "usage_10_usd",
        true,
      )).resolves.toEqual({ recoveryMiss: true });
      expect(fake.purchases.size).toBe(0);
      expect(mocks.ensureHostedMemberStripeCustomer).toHaveBeenCalledOnce();
      expectNoStripeProviderIo();

      if (!resolveOriginalCustomer) {
        throw new Error("Expected the delayed Customer resolution.");
      }
      let originalResult;
      let reauthorizationResult;
      if (winner === "original_first") {
        resolveOriginalCustomer("cus_group_payer");
        originalResult = await originalRequest;
        reauthorizationResult = await createCheckout(nextOfferCode);
      } else {
        reauthorizationResult = await createCheckout(nextOfferCode);
        onlyPurchase(fake.purchases).status = "fulfilled";
        resolveOriginalCustomer("cus_group_payer");
        originalResult = await originalRequest;
      }

      expect(fake.purchases.size).toBe(1);
      const purchase = onlyPurchase(fake.purchases);
      expect(purchase).toMatchObject({
        clientRequestKey: CLIENT_REQUEST_KEY,
        offerCode:
          winner === "original_first" ? "usage_10_usd" : nextOfferCode,
        status:
          winner === "original_first" ? "checkout_open" : "fulfilled",
      });
      expect(originalResult.purchaseId).toBe(purchase.id);
      expect(reauthorizationResult.purchaseId).toBe(purchase.id);
      expect(mocks.stripeCheckoutCreate).toHaveBeenCalledOnce();
      expect(mocks.stripePaymentIntentCreate).not.toHaveBeenCalled();

      if (nextOfferCode === "usage_5_usd") {
        const losingResult =
          winner === "original_first"
            ? reauthorizationResult
            : originalResult;
        expect(losingResult).toMatchObject({
          selectionConflict: "offer",
          recovered: true,
          status:
            winner === "original_first" ? "checkout_open" : "fulfilled",
        });
        expect(losingResult).not.toHaveProperty("url");
      } else if (winner === "reauthorization_first") {
        expect(reauthorizationResult).toMatchObject({
          status: "checkout_open",
          url: "https://checkout.stripe.test/session",
        });
        expect(originalResult).toMatchObject({
          status: "fulfilled",
        });
        expect(originalResult).not.toHaveProperty("url");
      } else {
        expect(originalResult).toMatchObject({
          status: "checkout_open",
          url: "https://checkout.stripe.test/session",
        });
        expect(reauthorizationResult).toMatchObject({
          status: "checkout_open",
          url: "https://checkout.stripe.test/session",
        });
      }
    },
  );

  it("does not expose member A's payable checkout from member B's Family request", async () => {
    const fake = createFakePrisma();
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );
    const first = await createHostedFamilyMemberUsageCreditCheckout({
      beneficiaryMemberId: "hbm_familymember1",
      clientRequestKey: CLIENT_REQUEST_KEY,
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });
    mocks.resolveHostedFamilyUsageCreditCheckoutTargetTx.mockResolvedValueOnce({
      beneficiaryMemberId: "hbm_familymember2",
      groupId: "hbag_abcdefghijklmnop",
      stripeCustomerId: "cus_family_owner",
    });

    const conflict = await createHostedFamilyMemberUsageCreditCheckout({
      beneficiaryMemberId: "hbm_familymember2",
      clientRequestKey: "family_member_b_key",
      now: new Date(NOW.getTime() + 1_000),
      offerCode: "usage_25_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });

    expect(conflict).toMatchObject({
      purchaseId: first.purchaseId,
      recovered: true,
      status: "checkout_open",
      targetConflict: true,
    });
    expect(conflict.url).toBeUndefined();
    expect(conflict.retryAllowed).toBeUndefined();
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["family", "group"],
    ["family", "personal"],
    ["group", "family"],
    ["group", "personal"],
    ["personal", "family"],
    ["personal", "group"],
  ] as const)(
    "never returns a payable capability for a %s-to-%s target conflict",
    async (activeKind, requestedKind) => {
      const fake = createFakePrisma();
      mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
        buildStripeSession(request)
      );
      const createCheckout = (
        kind: "family" | "group" | "personal",
        clientRequestKey: string,
        now: Date,
      ) => {
        switch (kind) {
          case "family":
            return createHostedFamilyMemberUsageCreditCheckout({
              beneficiaryMemberId: "hbm_familymember1",
              clientRequestKey,
              now,
              offerCode: "usage_10_usd",
              payerMemberId: MEMBER_ID,
              prisma: fake.prisma as never,
            });
          case "group":
            return createHostedGroupUsageCreditCheckout({
              clientRequestKey,
              joinCode: "group_join_code_1234",
              now,
              offerCode: "usage_10_usd",
              payerMemberId: MEMBER_ID,
              prisma: fake.prisma as never,
            });
          case "personal":
            return createHostedUsageCreditCheckout({
              clientRequestKey,
              memberId: MEMBER_ID,
              now,
              offerCode: "usage_10_usd",
              prisma: fake.prisma as never,
            });
        }
      };

      await createCheckout(activeKind, CLIENT_REQUEST_KEY, NOW);
      const conflict = await createCheckout(
        requestedKind,
        `request_${activeKind}_${requestedKind}_1234`,
        new Date(NOW.getTime() + 1_000),
      );

      expect(conflict).toMatchObject({
        recovered: true,
        status: "checkout_open",
        targetConflict: true,
      });
      expect(conflict).not.toHaveProperty("url");
      expect(conflict).not.toHaveProperty("retryAllowed");
      expect(mocks.stripeCheckoutCreate).toHaveBeenCalledTimes(1);
    },
  );

  it("reauthorizes every payable Family recovery after membership changes", async () => {
    const fake = createFakePrisma();
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );
    const first = await createHostedFamilyMemberUsageCreditCheckout({
      beneficiaryMemberId: "hbm_familymember1",
      clientRequestKey: CLIENT_REQUEST_KEY,
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });
    mocks.resolveHostedFamilyUsageCreditCheckoutTargetTx.mockResolvedValue(null);

    const replay = await createHostedFamilyMemberUsageCreditCheckout({
      beneficiaryMemberId: "hbm_familymember1",
      clientRequestKey: CLIENT_REQUEST_KEY,
      now: new Date(NOW.getTime() + 1_000),
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });
    expect(replay).toMatchObject({
      purchaseId: first.purchaseId,
      recovered: true,
      targetConflict: true,
    });
    expect(replay).not.toHaveProperty("url");
    expect(replay).not.toHaveProperty("retryAllowed");
    expect(mocks.resolveHostedFamilyUsageCreditCheckoutTargetTx).toHaveBeenCalledTimes(4);

    await expect(createHostedFamilyMemberUsageCreditCheckout({
      beneficiaryMemberId: "hbm_familymember1",
      clientRequestKey: "fresh_family_key_12",
      now: new Date(NOW.getTime() + 2_000),
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_NOT_ELIGIBLE",
      httpStatus: 403,
    });
  });

  it("withholds a Family Checkout URL when membership ends during Stripe creation", async () => {
    const fake = createFakePrisma();
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) => {
      mocks.resolveHostedFamilyUsageCreditCheckoutTargetTx.mockResolvedValue(null);
      return buildStripeSession(request);
    });

    const checkout = await createHostedFamilyMemberUsageCreditCheckout({
      beneficiaryMemberId: "hbm_familymember1",
      clientRequestKey: CLIENT_REQUEST_KEY,
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });

    expect(checkout).toMatchObject({
      status: "checkout_open",
      targetConflict: true,
    });
    expect(checkout).not.toHaveProperty("url");
    expect(checkout).not.toHaveProperty("retryAllowed");
    expect(fake.purchases.size).toBe(1);
    expect(onlyPurchase(fake.purchases)).toMatchObject({
      status: "checkout_open",
      stripeCheckoutSessionIdEncrypted: expect.any(String),
      stripeCheckoutSessionLookupKey: expect.any(String),
    });
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledTimes(1);
  });

  it("rechecks Family authority after exact request-key replay resolution", async () => {
    const fake = createFakePrisma();
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );
    const first = await createHostedFamilyMemberUsageCreditCheckout({
      beneficiaryMemberId: "hbm_familymember1",
      clientRequestKey: CLIENT_REQUEST_KEY,
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });
    const currentTarget = {
      beneficiaryMemberId: "hbm_familymember1",
      groupId: "hbag_abcdefghijklmnop",
      stripeCustomerId: "cus_family_owner",
    };
    mocks.resolveHostedFamilyUsageCreditCheckoutTargetTx.mockReset();
    mocks.resolveHostedFamilyUsageCreditCheckoutTargetTx
      .mockResolvedValueOnce(currentTarget)
      .mockResolvedValue(null);

    const replay = await createHostedFamilyMemberUsageCreditCheckout({
      beneficiaryMemberId: "hbm_familymember1",
      clientRequestKey: CLIENT_REQUEST_KEY,
      now: new Date(NOW.getTime() + 1_000),
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });

    expect(replay).toMatchObject({
      purchaseId: first.purchaseId,
      status: "checkout_open",
      targetConflict: true,
    });
    expect(replay).not.toHaveProperty("url");
    expect(replay).not.toHaveProperty("retryAllowed");
    expect(fake.purchases.size).toBe(1);
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledTimes(1);
  });

  it("withholds Family retry capability when authority ends after Stripe failure", async () => {
    const fake = createFakePrisma();
    mocks.stripeCheckoutCreate.mockRejectedValue(new Error("connection lost"));

    await expect(createHostedFamilyMemberUsageCreditCheckout({
      beneficiaryMemberId: "hbm_familymember1",
      clientRequestKey: CLIENT_REQUEST_KEY,
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
    });
    const currentTarget = {
      beneficiaryMemberId: "hbm_familymember1",
      groupId: "hbag_abcdefghijklmnop",
      stripeCustomerId: "cus_family_owner",
    };
    mocks.resolveHostedFamilyUsageCreditCheckoutTargetTx.mockReset();
    mocks.resolveHostedFamilyUsageCreditCheckoutTargetTx
      .mockResolvedValueOnce(currentTarget)
      .mockResolvedValueOnce(currentTarget)
      .mockResolvedValue(null);

    const recovered = await createHostedFamilyMemberUsageCreditCheckout({
      beneficiaryMemberId: "hbm_familymember1",
      clientRequestKey: "fresh_family_key_12",
      now: new Date(NOW.getTime() + 1_000),
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });

    expect(recovered).toMatchObject({
      recovered: true,
      status: "reconciling",
      targetConflict: true,
    });
    expect(recovered).not.toHaveProperty("url");
    expect(recovered).not.toHaveProperty("retryAllowed");
    expect(fake.purchases.size).toBe(1);
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledTimes(2);
  });

  it("funds the server-resolved group beneficiary without requiring a paid plan", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );

    const checkout = await createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });

    expect(checkout).toMatchObject({
      status: "checkout_open",
      url: "https://checkout.stripe.test/session",
    });
    expect(onlyPurchase(fake.purchases)).toMatchObject({
      beneficiaryMemberId: "member_group_runtime",
      checkoutCancelUrl: expect.stringContaining(
        "/groups/fund/group_join_code_1234?usageCheckout=cancel",
      ),
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
    });
    expect(mocks.readHostedPersonalUsageCreditOfferCodes).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberStripeBillingRef).not.toHaveBeenCalled();
    expect(mocks.ensureHostedMemberStripeCustomer).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: fake.prisma,
    });
    await expect(readHostedActiveUsageCreditPurchaseForPayer({
      beneficiaryMemberId: "member_group_runtime",
      now: NOW,
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toMatchObject({ purchaseId: checkout.purchaseId });
    await expect(readHostedActiveUsageCreditPurchaseForPayer({
      beneficiaryMemberId: "member_other_group_runtime",
      now: NOW,
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toBeNull();
  });

  it("offers $20 only to groups while preserving $25 for Family", async () => {
    mocks.readHostedConfiguredUsageCreditOfferCodes.mockReturnValue([
      "usage_5_usd",
      "usage_10_usd",
      "usage_20_usd",
      "usage_25_usd",
    ]);
    const fake = createFakePrisma();
    mocks.stripeCheckoutCreate.mockImplementation(async (request) =>
      buildStripeSession(request)
    );

    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_20_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toMatchObject({ status: "checkout_open" });
    expect(onlyPurchase(fake.purchases)).toMatchObject({
      offerCode: "usage_20_usd",
    });

    const familyFake = createFakePrisma();
    await expect(createHostedFamilyMemberUsageCreditCheckout({
      beneficiaryMemberId: "hbm_familymember1",
      clientRequestKey: "family_group_only_offer",
      now: NOW,
      offerCode: "usage_20_usd",
      payerMemberId: MEMBER_ID,
      prisma: familyFake.prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_NOT_ELIGIBLE",
    });
    expect(familyFake.purchases.size).toBe(0);
  });

  it("charges a canonical saved card without opening Checkout", async () => {
    const fake = createFakePrisma();
    mockCanonicalSavedCard();
    mocks.stripePaymentIntentCreate.mockImplementationOnce(
      async (request: Record<string, unknown>) => ({
        amount: request.amount,
        amount_received: 0,
        currency: request.currency,
        customer: request.customer,
        id: "pi_saved_card_123",
        latest_charge: null,
        livemode: false,
        metadata: request.metadata,
        object: "payment_intent",
        status: "requires_confirmation",
      }),
    );
    mocks.stripePaymentIntentConfirm.mockImplementationOnce(
      async (paymentIntentId: string) => {
        const purchase = onlyPurchase(fake.purchases);
        expect(paymentIntentId).toBe("pi_saved_card_123");
        expect(purchase).toMatchObject({
          status: "payment_pending",
          stripePaymentIntentIdEncrypted: "encrypted:pi_saved_card_123",
          stripePaymentIntentLookupKey: "billing:pi_saved_card_123",
        });
        return {
          amount: 1_000,
          amount_received: 1_000,
          currency: "usd",
          customer: "cus_group_payer",
          id: paymentIntentId,
          latest_charge: "ch_saved_card_123",
          livemode: false,
          metadata: {
            policyVersion: "hosted-usage-credit-checkout-v4",
            purchaseId: purchase.id,
            purpose: "hosted_usage_credit_saved_card",
          },
          object: "payment_intent",
          status: "succeeded",
        };
      },
    );

    const result = await createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });

    expect(result).toMatchObject({ status: "payment_pending" });
    expect(result).not.toHaveProperty("url");
    expect(mocks.stripePaymentIntentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1_000,
        currency: "usd",
        customer: "cus_group_payer",
        payment_method: "pm_saved_card_123",
        setup_future_usage: "off_session",
      }),
      {
        idempotencyKey: expect.stringMatching(
          /^hosted-usage-credit-saved-card:hucp_/,
        ),
      },
    );
    expect(mocks.stripePaymentIntentConfirm).toHaveBeenCalledWith(
      "pi_saved_card_123",
      {
        expand: ["latest_charge"],
        off_session: true,
      },
      {
        idempotencyKey: expect.stringMatching(
          /^hosted-usage-credit-saved-card:hucp_.+:confirm$/,
        ),
      },
    );
    expect(mocks.stripeCheckoutCreate).not.toHaveBeenCalled();
    expect(onlyPurchase(fake.purchases)).toMatchObject({
      status: "payment_pending",
      stripeChargeIdEncrypted: "encrypted:ch_saved_card_123",
      stripeChargeLookupKey: "billing:ch_saved_card_123",
      stripePaymentIntentIdEncrypted: "encrypted:pi_saved_card_123",
      stripePaymentIntentLookupKey: "billing:pi_saved_card_123",
    });
  });

  it("uses the customer default even when another card is redisplayable", async () => {
    const fake = createFakePrisma();
    mocks.stripeCustomerRetrieve.mockResolvedValueOnce({
      id: "cus_group_payer",
      invoice_settings: { default_payment_method: "pm_customer_default" },
      livemode: false,
      object: "customer",
    });
    mocks.stripePaymentMethodsList.mockResolvedValueOnce({
      data: [
        {
          allow_redisplay: "limited",
          customer: "cus_group_payer",
          id: "pm_customer_default",
          livemode: false,
          object: "payment_method",
          type: "card",
        },
        {
          allow_redisplay: "always",
          customer: "cus_group_payer",
          id: "pm_reusable_topup",
          livemode: false,
          object: "payment_method",
          type: "card",
        },
      ],
      has_more: false,
      object: "list",
      url: "/v1/payment_methods",
    });
    mocks.stripeSubscriptionsList.mockResolvedValueOnce({
      data: [{
        customer: "cus_group_payer",
        default_payment_method: "pm_unrelated_subscription_default",
        id: "sub_group_payer",
        livemode: false,
        object: "subscription",
        status: "active",
      }],
      has_more: false,
      object: "list",
      url: "/v1/subscriptions",
    });
    mocks.stripePaymentIntentCreate.mockImplementationOnce(
      async (request: Record<string, unknown>) => ({
        amount: request.amount,
        amount_received: 0,
        currency: request.currency,
        customer: request.customer,
        id: "pi_saved_card_123",
        latest_charge: null,
        livemode: false,
        metadata: request.metadata,
        object: "payment_intent",
        status: "requires_confirmation",
      }),
    );
    mocks.stripePaymentIntentConfirm.mockImplementationOnce(
      async () => buildSavedCardPaymentIntent({
        amountReceived: 1_000,
        latestCharge: "ch_saved_card_123",
        purchaseId: String(onlyPurchase(fake.purchases).id),
        status: "succeeded",
      }),
    );

    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toMatchObject({ status: "payment_pending" });

    expect(mocks.stripePaymentIntentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_method: "pm_customer_default",
      }),
      expect.any(Object),
    );
    expect(mocks.stripeCheckoutCreate).not.toHaveBeenCalled();
  });

  it(
    "reuses a legacy unspecified customer default over another attached card",
    async () => {
      const fake = createFakePrisma();
      mocks.stripeCustomerRetrieve.mockResolvedValueOnce({
        id: "cus_group_payer",
        invoice_settings: { default_payment_method: "pm_legacy_default" },
        livemode: false,
        object: "customer",
      });
      mocks.stripePaymentMethodsList.mockResolvedValueOnce({
        data: [
          {
            customer: "cus_group_payer",
            id: "pm_legacy_default",
            livemode: false,
            object: "payment_method",
            type: "card",
          },
          {
            allow_redisplay: "always",
            customer: "cus_group_payer",
            id: "pm_other_attached",
            livemode: false,
            object: "payment_method",
            type: "card",
          },
        ],
        has_more: false,
        object: "list",
        url: "/v1/payment_methods",
      });
      mocks.stripeSubscriptionsList.mockResolvedValueOnce({
        data: [{
          customer: "cus_group_payer",
          default_payment_method: "pm_legacy_default",
          id: "sub_group_payer",
          livemode: false,
          object: "subscription",
          status: "active",
        }],
        has_more: false,
        object: "list",
        url: "/v1/subscriptions",
      });
      mocks.stripePaymentIntentCreate.mockImplementationOnce(
        async (request: Record<string, unknown>) => ({
          amount: request.amount,
          amount_received: 0,
          currency: request.currency,
          customer: request.customer,
          id: "pi_saved_card_123",
          latest_charge: null,
          livemode: false,
          metadata: request.metadata,
          object: "payment_intent",
          status: "requires_confirmation",
        }),
      );
      mocks.stripePaymentIntentConfirm.mockImplementationOnce(
        async () => buildSavedCardPaymentIntent({
          amountReceived: 1_000,
          latestCharge: "ch_saved_card_123",
          purchaseId: String(onlyPurchase(fake.purchases).id),
          status: "succeeded",
        }),
      );

      await expect(createHostedGroupUsageCreditCheckout({
        clientRequestKey: CLIENT_REQUEST_KEY,
        joinCode: "group_join_code_1234",
        now: NOW,
        offerCode: "usage_10_usd",
        payerMemberId: MEMBER_ID,
        prisma: fake.prisma as never,
      })).resolves.toMatchObject({ status: "payment_pending" });

      expect(mocks.stripePaymentIntentCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_method: "pm_legacy_default",
        }),
        expect.any(Object),
      );
      expect(mocks.stripePaymentIntentConfirm).toHaveBeenCalledOnce();
      expect(mocks.stripeCheckoutCreate).not.toHaveBeenCalled();
    },
  );

  it("uses the customer default when several cards are attached", async () => {
    const fake = createFakePrisma();
    mocks.stripeCustomerRetrieve.mockResolvedValueOnce({
      id: "cus_group_payer",
      invoice_settings: { default_payment_method: "pm_reusable_two" },
      livemode: false,
      object: "customer",
    });
    mocks.stripePaymentMethodsList.mockResolvedValueOnce({
      data: [
        {
          allow_redisplay: "always",
          customer: "cus_group_payer",
          id: "pm_reusable_one",
          livemode: false,
          object: "payment_method",
          type: "card",
        },
        {
          allow_redisplay: "always",
          customer: "cus_group_payer",
          id: "pm_reusable_two",
          livemode: false,
          object: "payment_method",
          type: "card",
        },
      ],
      has_more: false,
      object: "list",
      url: "/v1/payment_methods",
    });
    mocks.stripePaymentIntentCreate.mockImplementationOnce(
      async (request: Record<string, unknown>) => ({
        amount: request.amount,
        amount_received: 0,
        currency: request.currency,
        customer: request.customer,
        id: "pi_saved_card_123",
        latest_charge: null,
        livemode: false,
        metadata: request.metadata,
        object: "payment_intent",
        status: "requires_confirmation",
      }),
    );
    mocks.stripePaymentIntentConfirm.mockImplementationOnce(
      async () => buildSavedCardPaymentIntent({
        amountReceived: 1_000,
        latestCharge: "ch_saved_card_123",
        purchaseId: String(onlyPurchase(fake.purchases).id),
        status: "succeeded",
      }),
    );

    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toMatchObject({ status: "payment_pending" });

    expect(mocks.stripePaymentIntentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_method: "pm_reusable_two",
      }),
      expect.any(Object),
    );
    expect(mocks.stripeCheckoutCreate).not.toHaveBeenCalled();
  });

  it("retains the frozen v3 default-card choice over a newly reusable card", async () => {
    const fake = createFakePrisma({
      createdCheckoutRequestPolicyVersion: "hosted-usage-credit-checkout-v3",
    });
    mocks.stripeCustomerRetrieve.mockResolvedValueOnce({
      id: "cus_group_payer",
      invoice_settings: { default_payment_method: "pm_legacy_default" },
      livemode: false,
      object: "customer",
    });
    mocks.stripePaymentMethodsList.mockResolvedValueOnce({
      data: [
        {
          allow_redisplay: "limited",
          customer: "cus_group_payer",
          id: "pm_legacy_default",
          livemode: false,
          object: "payment_method",
          type: "card",
        },
        {
          allow_redisplay: "always",
          customer: "cus_group_payer",
          id: "pm_reusable_topup",
          livemode: false,
          object: "payment_method",
          type: "card",
        },
      ],
      has_more: false,
      object: "list",
      url: "/v1/payment_methods",
    });
    mocks.stripePaymentIntentCreate.mockImplementationOnce(
      async (request: Record<string, unknown>) => ({
        amount: request.amount,
        amount_received: 0,
        currency: request.currency,
        customer: request.customer,
        id: "pi_saved_card_123",
        latest_charge: null,
        livemode: false,
        metadata: request.metadata,
        object: "payment_intent",
        status: "requires_confirmation",
      }),
    );
    mocks.stripePaymentIntentConfirm.mockImplementationOnce(async () => {
      const purchaseId = String(onlyPurchase(fake.purchases).id);
      return {
        ...buildSavedCardPaymentIntent({
          amountReceived: 1_000,
          latestCharge: "ch_saved_card_123",
          purchaseId,
          status: "succeeded",
        }),
        metadata: {
          policyVersion: "hosted-usage-credit-checkout-v3",
          purchaseId,
          purpose: "hosted_usage_credit_saved_card",
        },
      };
    });

    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toMatchObject({ status: "payment_pending" });

    expect(mocks.stripePaymentIntentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_method: "pm_legacy_default",
      }),
      expect.any(Object),
    );
    expect(mocks.stripeCheckoutCreate).not.toHaveBeenCalled();
  });

  it("uses Checkout instead of guessing among attached cards", async () => {
    const fake = createFakePrisma();
    mocks.stripePaymentMethodsList.mockResolvedValueOnce({
      data: [
        {
          allow_redisplay: "always",
          customer: "cus_group_payer",
          id: "pm_reusable_one",
          livemode: false,
          object: "payment_method",
          type: "card",
        },
        {
          allow_redisplay: "always",
          customer: "cus_group_payer",
          id: "pm_reusable_two",
          livemode: false,
          object: "payment_method",
          type: "card",
        },
      ],
      has_more: false,
      object: "list",
      url: "/v1/payment_methods",
    });
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );

    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toMatchObject({ status: "checkout_open" });

    expect(mocks.stripePaymentIntentCreate).not.toHaveBeenCalled();
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        saved_payment_method_options: {
          allow_redisplay_filters: ["always"],
          payment_method_save: "enabled",
        },
      }),
      expect.any(Object),
    );
  });

  it("uses the customer default for group funding without a billing subscription", async () => {
    const fake = createFakePrisma();
    mocks.stripeCustomerRetrieve.mockResolvedValueOnce({
      id: "cus_group_payer",
      invoice_settings: {
        default_payment_method: "pm_customer_default",
      },
      livemode: false,
      object: "customer",
    });
    mocks.stripePaymentMethodsList.mockResolvedValueOnce({
      data: [
        {
          customer: "cus_group_payer",
          id: "pm_customer_default",
          livemode: false,
          object: "payment_method",
          type: "card",
        },
        {
          customer: "cus_group_payer",
          id: "pm_subscription_default",
          livemode: false,
          object: "payment_method",
          type: "card",
        },
      ],
      has_more: false,
      object: "list",
      url: "/v1/payment_methods",
    });
    mocks.stripeSubscriptionsList.mockResolvedValueOnce({
      data: [{
        customer: "cus_group_payer",
        default_payment_method: "pm_subscription_default",
        id: "sub_group_payer",
        livemode: false,
        object: "subscription",
        status: "active",
      }],
      has_more: false,
      object: "list",
      url: "/v1/subscriptions",
    });
    mocks.stripePaymentIntentCreate.mockImplementationOnce(
      async (request: Record<string, unknown>) => ({
        amount: request.amount,
        amount_received: 0,
        currency: request.currency,
        customer: request.customer,
        id: "pi_saved_card_123",
        latest_charge: null,
        livemode: false,
        metadata: request.metadata,
        object: "payment_intent",
        status: "requires_confirmation",
      }),
    );
    mocks.stripePaymentIntentConfirm.mockImplementationOnce(
      async () => buildSavedCardPaymentIntent({
        amountReceived: 1_000,
        latestCharge: "ch_saved_card_123",
        purchaseId: String(onlyPurchase(fake.purchases).id),
        status: "succeeded",
      }),
    );

    const result = await createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });

    expect(result).toMatchObject({
      status: "payment_pending",
    });
    expect(mocks.stripePaymentIntentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_method: "pm_customer_default",
      }),
      expect.any(Object),
    );
    expect(mocks.stripePaymentIntentConfirm).toHaveBeenCalledOnce();
    expect(mocks.stripeCheckoutCreate).not.toHaveBeenCalled();
  });

  it("keeps the frozen v3 Checkout fallback when customer and subscription defaults disagree", async () => {
    const fake = createFakePrisma({
      createdCheckoutRequestPolicyVersion: "hosted-usage-credit-checkout-v3",
    });
    mocks.stripeCustomerRetrieve.mockResolvedValueOnce({
      id: "cus_group_payer",
      invoice_settings: {
        default_payment_method: "pm_customer_default",
      },
      livemode: false,
      object: "customer",
    });
    mocks.stripePaymentMethodsList.mockResolvedValueOnce({
      data: [
        {
          customer: "cus_group_payer",
          id: "pm_customer_default",
          livemode: false,
          object: "payment_method",
          type: "card",
        },
        {
          customer: "cus_group_payer",
          id: "pm_subscription_default",
          livemode: false,
          object: "payment_method",
          type: "card",
        },
      ],
      has_more: false,
      object: "list",
      url: "/v1/payment_methods",
    });
    mocks.stripeSubscriptionsList.mockResolvedValueOnce({
      data: [{
        customer: "cus_group_payer",
        default_payment_method: "pm_subscription_default",
        id: "sub_group_payer",
        livemode: false,
        object: "subscription",
        status: "active",
      }],
      has_more: false,
      object: "list",
      url: "/v1/subscriptions",
    });
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );

    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toMatchObject({ status: "checkout_open" });

    expect(mocks.stripePaymentIntentCreate).not.toHaveBeenCalled();
    expect(mocks.stripePaymentIntentConfirm).not.toHaveBeenCalled();
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledOnce();
  });

  it.each([
    ["explicit", "pm_family_subscription", "pm_family_subscription"],
    ["inherited", null, "pm_customer_default"],
  ] as const)(
    "uses the exact Family subscription's %s card and ignores another active subscription",
    async (_mode, familySubscriptionDefault, expectedPaymentMethod) => {
      const fake = createFakePrisma();
      mocks.stripeCustomerRetrieve.mockResolvedValueOnce({
        id: "cus_family_owner",
        invoice_settings: {
          default_payment_method: "pm_customer_default",
        },
        livemode: false,
        object: "customer",
      });
      mocks.stripePaymentMethodsList.mockResolvedValueOnce({
        data: [
          {
            customer: "cus_family_owner",
            id: "pm_customer_default",
            livemode: false,
            object: "payment_method",
            type: "card",
          },
          {
            customer: "cus_family_owner",
            id: "pm_family_subscription",
            livemode: false,
            object: "payment_method",
            type: "card",
          },
          {
            customer: "cus_family_owner",
            id: "pm_other_subscription",
            livemode: false,
            object: "payment_method",
            type: "card",
          },
        ],
        has_more: false,
        object: "list",
        url: "/v1/payment_methods",
      });
      mocks.stripeSubscriptionsList.mockResolvedValueOnce({
        data: [
          {
            customer: "cus_family_owner",
            default_payment_method: familySubscriptionDefault,
            id: "sub_family_owner",
            livemode: false,
            object: "subscription",
            status: "active",
          },
          {
            customer: "cus_family_owner",
            default_payment_method: "pm_other_subscription",
            id: "sub_other_active",
            livemode: false,
            object: "subscription",
            status: "active",
          },
        ],
        has_more: false,
        object: "list",
        url: "/v1/subscriptions",
      });
      mocks.stripePaymentIntentCreate.mockImplementationOnce(
        async (request: Record<string, unknown>) => ({
          amount: request.amount,
          amount_received: 0,
          currency: request.currency,
          customer: request.customer,
          id: "pi_saved_card_123",
          latest_charge: null,
          livemode: false,
          metadata: request.metadata,
          object: "payment_intent",
          status: "requires_confirmation",
        }),
      );
      mocks.stripePaymentIntentConfirm.mockImplementationOnce(
        async () => buildSavedCardPaymentIntent({
          amountReceived: 1_000,
          customerId: "cus_family_owner",
          latestCharge: "ch_saved_card_123",
          purchaseId: String(onlyPurchase(fake.purchases).id),
          status: "succeeded",
        }),
      );

      await expect(createHostedFamilyMemberUsageCreditCheckout({
        beneficiaryMemberId: "hbm_familymember1",
        clientRequestKey: CLIENT_REQUEST_KEY,
        now: NOW,
        offerCode: "usage_10_usd",
        payerMemberId: MEMBER_ID,
        prisma: fake.prisma as never,
      })).resolves.toMatchObject({ status: "payment_pending" });

      expect(mocks.stripePaymentIntentCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          payment_method: expectedPaymentMethod,
        }),
        expect.any(Object),
      );
      expect(mocks.stripeCheckoutCreate).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["missing", null, "sub_other_active", "active", "pm_other_subscription"],
    [
      "stale",
      "cus_family_owner",
      "sub_other_active",
      "active",
      "pm_other_subscription",
    ],
    [
      "terminal",
      "cus_family_owner",
      "sub_family_owner",
      "canceled",
      "pm_other_subscription",
    ],
    [
      "customer-mismatched",
      "cus_other",
      "sub_family_owner",
      "active",
      "pm_other_subscription",
    ],
    [
      "bound to an unattached default",
      "cus_family_owner",
      "sub_family_owner",
      "active",
      "pm_unattached",
    ],
  ] as const)(
    "uses Checkout when the exact Family billing subscription is %s",
    async (
      _reason,
      billingCustomerId,
      listedSubscriptionId,
      listedSubscriptionStatus,
      listedDefaultPaymentMethodId,
    ) => {
      const fake = createFakePrisma();
      mocks.readHostedAccountGroupStripeBillingRef.mockResolvedValueOnce(
        billingCustomerId
          ? buildFamilySavedCardBillingRef({
              stripeCustomerId: billingCustomerId,
              stripeSubscriptionId: "sub_family_owner",
            })
          : null,
      );
      mocks.stripeCustomerRetrieve.mockResolvedValueOnce({
        id: "cus_family_owner",
        invoice_settings: {
          default_payment_method: "pm_customer_default",
        },
        livemode: false,
        object: "customer",
      });
      mocks.stripePaymentMethodsList.mockResolvedValueOnce({
        data: [
          {
            customer: "cus_family_owner",
            id: "pm_customer_default",
            livemode: false,
            object: "payment_method",
            type: "card",
          },
          {
            customer: "cus_family_owner",
            id: "pm_other_subscription",
            livemode: false,
            object: "payment_method",
            type: "card",
          },
        ],
        has_more: false,
        object: "list",
        url: "/v1/payment_methods",
      });
      mocks.stripeSubscriptionsList.mockResolvedValueOnce({
        data: [{
          customer: "cus_family_owner",
          default_payment_method: listedDefaultPaymentMethodId,
          id: listedSubscriptionId,
          livemode: false,
          object: "subscription",
          status: listedSubscriptionStatus,
        }],
        has_more: false,
        object: "list",
        url: "/v1/subscriptions",
      });
      mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
        buildStripeSession(request)
      );

      await expect(createHostedFamilyMemberUsageCreditCheckout({
        beneficiaryMemberId: "hbm_familymember1",
        clientRequestKey: CLIENT_REQUEST_KEY,
        now: NOW,
        offerCode: "usage_10_usd",
        payerMemberId: MEMBER_ID,
        prisma: fake.prisma as never,
      })).resolves.toMatchObject({ status: "checkout_open" });

      expect(mocks.stripePaymentIntentCreate).not.toHaveBeenCalled();
      expect(mocks.stripePaymentIntentConfirm).not.toHaveBeenCalled();
      expect(mocks.stripeCheckoutCreate).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["personal", "cus_123", "sub_123"],
    ["family", "cus_family_owner", "sub_family_owner"],
  ] as const)(
    "uses Checkout when the exact %s subscription has a legacy default Source",
    async (targetKind, customerId, subscriptionId) => {
      const fake = createFakePrisma();
      mocks.stripeCustomerRetrieve.mockResolvedValueOnce({
        default_source: null,
        id: customerId,
        invoice_settings: {
          default_payment_method: "pm_customer_default",
        },
        livemode: false,
        object: "customer",
      });
      mocks.stripePaymentMethodsList.mockResolvedValueOnce({
        data: [{
          allow_redisplay: "limited",
          customer: customerId,
          id: "pm_customer_default",
          livemode: false,
          object: "payment_method",
          type: "card",
        }],
        has_more: false,
        object: "list",
        url: "/v1/payment_methods",
      });
      mocks.stripeSubscriptionsList.mockResolvedValueOnce({
        data: [{
          customer: customerId,
          default_payment_method: null,
          default_source: "card_legacy_subscription",
          id: subscriptionId,
          livemode: false,
          object: "subscription",
          status: "active",
        }],
        has_more: false,
        object: "list",
        url: "/v1/subscriptions",
      });
      mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
        buildStripeSession(request)
      );

      const result = targetKind === "family"
        ? await createHostedFamilyMemberUsageCreditCheckout({
            beneficiaryMemberId: "hbm_familymember1",
            clientRequestKey: CLIENT_REQUEST_KEY,
            now: NOW,
            offerCode: "usage_10_usd",
            payerMemberId: MEMBER_ID,
            prisma: fake.prisma as never,
          })
        : await createHostedUsageCreditCheckout({
            clientRequestKey: CLIENT_REQUEST_KEY,
            memberId: MEMBER_ID,
            now: NOW,
            offerCode: "usage_10_usd",
            prisma: fake.prisma as never,
          });

      expect(result).toMatchObject({ status: "checkout_open" });
      expect(mocks.stripePaymentIntentCreate).not.toHaveBeenCalled();
      expect(mocks.stripePaymentIntentConfirm).not.toHaveBeenCalled();
      expect(mocks.stripeCheckoutCreate).toHaveBeenCalledOnce();
    },
  );

  it("uses Checkout instead of replacing a group Customer's legacy default Source", async () => {
    const fake = createFakePrisma();
    mocks.stripeCustomerRetrieve.mockResolvedValueOnce({
      default_source: "card_legacy_customer",
      id: "cus_group_payer",
      invoice_settings: { default_payment_method: null },
      livemode: false,
      object: "customer",
    });
    mocks.stripePaymentMethodsList.mockResolvedValueOnce({
      data: [{
        customer: "cus_group_payer",
        id: "pm_other_attached",
        livemode: false,
        object: "payment_method",
        type: "card",
      }],
      has_more: false,
      object: "list",
      url: "/v1/payment_methods",
    });
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );

    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toMatchObject({ status: "checkout_open" });

    expect(mocks.stripePaymentIntentCreate).not.toHaveBeenCalled();
    expect(mocks.stripePaymentIntentConfirm).not.toHaveBeenCalled();
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledOnce();
  });

  it("reconstructs a frozen v1 group Checkout without changing its payment shape", async () => {
    const fake = createFakePrisma();
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );
    await createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });
    const purchase = onlyPurchase(fake.purchases);
    purchase.checkoutRequestPolicyVersion =
      "hosted-usage-credit-checkout-v1";

    const request = await reconstructHostedUsageCreditStripeCheckoutRequest({
      prisma: fake.prisma as never,
      purchase: purchase as never,
    });

    expect(request.metadata).toEqual({
      policyVersion: "hosted-usage-credit-checkout-v1",
      purchaseId: purchase.id,
      purpose: "hosted_usage_credit",
    });
    expect(request.payment_intent_data?.metadata).toEqual(request.metadata);
    expect(request.payment_intent_data).not.toHaveProperty(
      "setup_future_usage",
    );
    expect(request).not.toHaveProperty("saved_payment_method_options");
  });

  it.each([
    "hosted-usage-credit-checkout-v2",
    "hosted-usage-credit-checkout-v3",
  ] as const)(
    "reconstructs a frozen %s group Checkout without adding the v4 save control",
    async (policyVersion) => {
      const fake = createFakePrisma();
      mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
        buildStripeSession(request)
      );
      await createHostedGroupUsageCreditCheckout({
        clientRequestKey: CLIENT_REQUEST_KEY,
        joinCode: "group_join_code_1234",
        now: NOW,
        offerCode: "usage_10_usd",
        payerMemberId: MEMBER_ID,
        prisma: fake.prisma as never,
      });
      const purchase = onlyPurchase(fake.purchases);
      purchase.checkoutRequestPolicyVersion = policyVersion;

      const request = await reconstructHostedUsageCreditStripeCheckoutRequest({
        prisma: fake.prisma as never,
        purchase: purchase as never,
      });

      expect(request.metadata).toEqual({
        policyVersion,
        purchaseId: purchase.id,
        purpose: "hosted_usage_credit",
      });
      expect(request.payment_intent_data).toEqual({
        metadata: request.metadata,
        setup_future_usage: "off_session",
      });
      expect(request).not.toHaveProperty("saved_payment_method_options");
    },
  );

  it("cancels an authentication-required saved-card intent before opening Checkout", async () => {
    const fake = createFakePrisma();
    mockCanonicalSavedCard();
    const readUnconfirmedIntent = () => buildSavedCardPaymentIntent({
      amountReceived: 0,
      latestCharge: null,
      purchaseId: String(onlyPurchase(fake.purchases).id),
      status: "requires_confirmation",
    });
    mocks.stripePaymentIntentCreate.mockImplementationOnce(
      async () => readUnconfirmedIntent(),
    );
    mocks.stripePaymentIntentConfirm.mockRejectedValueOnce(
      new Error("authentication required"),
    );
    mocks.stripePaymentIntentRetrieve.mockImplementationOnce(async () => ({
      ...readUnconfirmedIntent(),
      status: "requires_action",
    }));
    mocks.stripePaymentIntentCancel.mockImplementationOnce(async () => ({
      ...readUnconfirmedIntent(),
      status: "canceled",
    }));
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );

    const result = await createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });

    expect(result).toMatchObject({
      status: "checkout_open",
      url: "https://checkout.stripe.test/session",
    });
    expect(mocks.stripePaymentIntentCancel).toHaveBeenCalledWith(
      "pi_saved_card_123",
      { cancellation_reason: "abandoned" },
      {
        idempotencyKey: expect.stringMatching(
          /^hosted-usage-credit-saved-card:hucp_.+:cancel$/,
        ),
      },
    );
    expect(mocks.stripePaymentIntentCancel).toHaveBeenCalledBefore(
      mocks.stripeCheckoutCreate,
    );
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_intent_data: expect.objectContaining({
          setup_future_usage: "off_session",
        }),
      }),
      expect.any(Object),
    );
    expect(onlyPurchase(fake.purchases)).toMatchObject({
      status: "checkout_open",
      stripeChargeIdEncrypted: null,
      stripeChargeLookupKey: null,
      stripePaymentIntentIdEncrypted: null,
      stripePaymentIntentLookupKey: null,
    });
  });

  it("does not open Checkout when an ambiguous cancel reveals the saved-card payment succeeded", async () => {
    const fake = createFakePrisma();
    mockCanonicalSavedCard();
    const readUnconfirmedIntent = () => buildSavedCardPaymentIntent({
      amountReceived: 0,
      latestCharge: null,
      purchaseId: String(onlyPurchase(fake.purchases).id),
      status: "requires_confirmation",
    });
    mocks.stripePaymentIntentCreate.mockImplementationOnce(
      async () => readUnconfirmedIntent(),
    );
    mocks.stripePaymentIntentConfirm.mockRejectedValueOnce(
      new Error("authentication required"),
    );
    mocks.stripePaymentIntentRetrieve
      .mockImplementationOnce(async () => ({
        ...readUnconfirmedIntent(),
        status: "requires_action",
      }))
      .mockImplementationOnce(async () => buildSavedCardPaymentIntent({
        amountReceived: 1_000,
        latestCharge: "ch_saved_card_123",
        purchaseId: String(onlyPurchase(fake.purchases).id),
        status: "succeeded",
      }));
    mocks.stripePaymentIntentCancel.mockRejectedValueOnce(
      new Error("connection lost"),
    );

    const result = await createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });

    expect(result).toMatchObject({ status: "payment_pending" });
    expect(result).not.toHaveProperty("url");
    expect(mocks.stripePaymentIntentCancel).toHaveBeenCalledOnce();
    expect(mocks.stripePaymentIntentRetrieve).toHaveBeenCalledTimes(2);
    expect(mocks.stripeCheckoutCreate).not.toHaveBeenCalled();
    expect(onlyPurchase(fake.purchases)).toMatchObject({
      status: "payment_pending",
      stripeChargeIdEncrypted: "encrypted:ch_saved_card_123",
      stripeChargeLookupKey: "billing:ch_saved_card_123",
      stripePaymentIntentIdEncrypted: "encrypted:pi_saved_card_123",
      stripePaymentIntentLookupKey: "billing:pi_saved_card_123",
    });
  });

  it.each([
    ["personal", "cus_123", "sub_123"],
    ["family", "cus_family_owner", "sub_family_owner"],
  ] as const)(
    "cancels an unbound %s intent when billing authority changes before bind",
    async (targetKind, customerId, subscriptionId) => {
      const fake = createFakePrisma();
      mockCanonicalSavedCard(customerId);
      mocks.stripeSubscriptionsList.mockResolvedValueOnce({
        data: [{
          customer: customerId,
          default_payment_method: null,
          id: subscriptionId,
          livemode: false,
          object: "subscription",
          status: "active",
        }],
        has_more: false,
        object: "list",
        url: "/v1/subscriptions",
      });
      mocks.stripePaymentIntentCreate.mockImplementationOnce(async () => {
        if (targetKind === "family") {
          mocks.readHostedAccountGroupStripeBillingRef.mockResolvedValue(
            buildFamilySavedCardBillingRef({
              stripeCustomerId: customerId,
              stripeSubscriptionId: "sub_family_replacement",
            }),
          );
        } else {
          mocks.readHostedMemberBillingSnapshot.mockResolvedValue(
            buildPersonalSavedCardBillingSnapshot({
              stripeCustomerId: customerId,
              stripeSubscriptionId: "sub_personal_replacement",
            }),
          );
        }
        return buildSavedCardPaymentIntent({
          amountReceived: 0,
          customerId,
          latestCharge: null,
          purchaseId: String(onlyPurchase(fake.purchases).id),
          status: "requires_confirmation",
        });
      });
      mocks.stripePaymentIntentCancel.mockImplementationOnce(async () => ({
        ...buildSavedCardPaymentIntent({
          amountReceived: 0,
          customerId,
          latestCharge: null,
          purchaseId: String(onlyPurchase(fake.purchases).id),
          status: "canceled",
        }),
      }));
      mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
        buildStripeSession(request)
      );

      const result = targetKind === "family"
        ? await createHostedFamilyMemberUsageCreditCheckout({
            beneficiaryMemberId: "hbm_familymember1",
            clientRequestKey: CLIENT_REQUEST_KEY,
            now: NOW,
            offerCode: "usage_10_usd",
            payerMemberId: MEMBER_ID,
            prisma: fake.prisma as never,
          })
        : await createHostedUsageCreditCheckout({
            clientRequestKey: CLIENT_REQUEST_KEY,
            memberId: MEMBER_ID,
            now: NOW,
            offerCode: "usage_10_usd",
            prisma: fake.prisma as never,
          });

      expect(result).toMatchObject({ status: "checkout_open" });
      expect(mocks.stripePaymentIntentCancel).toHaveBeenCalledWith(
        "pi_saved_card_123",
        { cancellation_reason: "abandoned" },
        expect.objectContaining({
          idempotencyKey: expect.stringContaining(":cancel"),
        }),
      );
      expect(mocks.stripePaymentIntentCancel).toHaveBeenCalledBefore(
        mocks.stripeCheckoutCreate,
      );
      expect(mocks.stripePaymentIntentConfirm).not.toHaveBeenCalled();
      expect(onlyPurchase(fake.purchases)).toMatchObject({
        status: "checkout_open",
        stripePaymentIntentLookupKey: null,
      });
    },
  );

  it.each([
    ["personal", "terminal billing status", "cus_123", "sub_123"],
    [
      "family",
      "terminal billing status",
      "cus_family_owner",
      "sub_family_owner",
    ],
    ["personal", "billing freshness", "cus_123", "sub_123"],
    [
      "family",
      "billing freshness",
      "cus_family_owner",
      "sub_family_owner",
    ],
  ] as const)(
    "cancels an unbound %s intent when %s changes without changing Stripe IDs",
    async (targetKind, authorityChange, customerId, subscriptionId) => {
      const fake = createFakePrisma();
      mockCanonicalSavedCard(customerId);
      mocks.stripeSubscriptionsList.mockResolvedValueOnce({
        data: [{
          customer: customerId,
          default_payment_method: null,
          id: subscriptionId,
          livemode: false,
          object: "subscription",
          status: "active",
        }],
        has_more: false,
        object: "list",
        url: "/v1/subscriptions",
      });
      mocks.stripePaymentIntentCreate.mockImplementationOnce(async () => {
        const changedAuthority = authorityChange === "terminal billing status"
          ? { billingStatus: "canceled" as const }
          : {
              lastStripeEventCreatedAt: new Date(
                LAST_STRIPE_EVENT_AT.getTime() + 1_000,
              ),
            };
        if (targetKind === "family") {
          mocks.readHostedAccountGroupStripeBillingRef.mockResolvedValue(
            buildFamilySavedCardBillingRef(changedAuthority),
          );
        } else {
          mocks.readHostedMemberBillingSnapshot.mockResolvedValue(
            buildPersonalSavedCardBillingSnapshot(changedAuthority),
          );
        }
        return buildSavedCardPaymentIntent({
          amountReceived: 0,
          customerId,
          latestCharge: null,
          purchaseId: String(onlyPurchase(fake.purchases).id),
          status: "requires_confirmation",
        });
      });
      mocks.stripePaymentIntentCancel.mockImplementationOnce(async () =>
        buildSavedCardPaymentIntent({
          amountReceived: 0,
          customerId,
          latestCharge: null,
          purchaseId: String(onlyPurchase(fake.purchases).id),
          status: "canceled",
        })
      );
      mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
        buildStripeSession(request)
      );

      const result = targetKind === "family"
        ? await createHostedFamilyMemberUsageCreditCheckout({
            beneficiaryMemberId: "hbm_familymember1",
            clientRequestKey: CLIENT_REQUEST_KEY,
            now: NOW,
            offerCode: "usage_10_usd",
            payerMemberId: MEMBER_ID,
            prisma: fake.prisma as never,
          })
        : await createHostedUsageCreditCheckout({
            clientRequestKey: CLIENT_REQUEST_KEY,
            memberId: MEMBER_ID,
            now: NOW,
            offerCode: "usage_10_usd",
            prisma: fake.prisma as never,
          });

      expect(result).toMatchObject({ status: "checkout_open" });
      expect(mocks.stripePaymentIntentCancel).toHaveBeenCalledBefore(
        mocks.stripeCheckoutCreate,
      );
      expect(mocks.stripePaymentIntentConfirm).not.toHaveBeenCalled();
      expect(onlyPurchase(fake.purchases)).toMatchObject({
        status: "checkout_open",
        stripePaymentIntentLookupKey: null,
      });
    },
  );

  it("never confirms an intent that lost the account-deletion binding race", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mockCanonicalSavedCard();
    let deletionSession: ReturnType<typeof buildStripeSession> | null = null;
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) => {
      deletionSession = buildStripeSession(request);
      return deletionSession;
    });
    mocks.stripeCheckoutRetrieve.mockImplementationOnce(async () => {
      if (!deletionSession) {
        throw new Error("Expected account deletion to reconstruct Checkout.");
      }
      return deletionSession;
    });
    mocks.stripeCheckoutExpire.mockImplementationOnce(async () => {
      if (!deletionSession) {
        throw new Error("Expected account deletion to reconstruct Checkout.");
      }
      return { ...deletionSession, status: "expired", url: null };
    });
    mocks.stripePaymentIntentCreate.mockImplementationOnce(async () => {
      const purchase = onlyPurchase(fake.purchases);
      fake.member.suspendedAt = NOW;
      await closeHostedUsageCreditPurchasesForAccountDeletion({
        memberIds: [MEMBER_ID],
        now: new Date(NOW.getTime() + 1_000),
      });
      await assertHostedUsageCreditPurchasesReadyForAccountDeletionTx({
        memberIds: [MEMBER_ID],
        now: new Date(NOW.getTime() + 2_000),
        prisma: fake.prisma as never,
      });
      return buildSavedCardPaymentIntent({
        amountReceived: 0,
        latestCharge: null,
        purchaseId: String(purchase.id),
        status: "requires_confirmation",
      });
    });
    mocks.stripePaymentIntentCancel.mockImplementationOnce(
      async (paymentIntentId: string) => buildSavedCardPaymentIntent({
        amountReceived: 0,
        latestCharge: null,
        purchaseId: String(onlyPurchase(fake.purchases).id),
        status: paymentIntentId === "pi_saved_card_123"
          ? "canceled"
          : "requires_confirmation",
      }),
    );

    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).rejects.toBeTruthy();

    expect(mocks.stripePaymentIntentConfirm).not.toHaveBeenCalled();
    expect(mocks.stripePaymentIntentCancel).toHaveBeenCalledWith(
      "pi_saved_card_123",
      { cancellation_reason: "abandoned" },
      expect.objectContaining({
        idempotencyKey: expect.stringContaining(":cancel"),
      }),
    );
    expect(onlyPurchase(fake.purchases)).toMatchObject({
      payerMemberId: null,
      status: "expired",
      stripePaymentIntentLookupKey: null,
    });
  });

  it("resumes the same durably bound intent after an ambiguous confirmation response", async () => {
    const fake = createFakePrisma();
    mockCanonicalSavedCard();
    const readUnconfirmedIntent = () => buildSavedCardPaymentIntent({
      amountReceived: 0,
      latestCharge: null,
      purchaseId: String(onlyPurchase(fake.purchases).id),
      status: "requires_confirmation",
    });
    mocks.stripePaymentIntentCreate.mockImplementationOnce(
      async () => readUnconfirmedIntent(),
    );
    mocks.stripePaymentIntentConfirm
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockImplementationOnce(async () => buildSavedCardPaymentIntent({
        amountReceived: 1_000,
        latestCharge: "ch_saved_card_123",
        purchaseId: String(onlyPurchase(fake.purchases).id),
        status: "succeeded",
      }));
    mocks.stripePaymentIntentRetrieve
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockImplementationOnce(async () => readUnconfirmedIntent());

    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
    });
    expect(onlyPurchase(fake.purchases)).toMatchObject({
      status: "payment_pending",
      stripePaymentIntentIdEncrypted: "encrypted:pi_saved_card_123",
      stripePaymentIntentLookupKey: "billing:pi_saved_card_123",
    });
    await expect(readHostedActiveUsageCreditPurchaseForPayer({
      beneficiaryMemberId: "member_group_runtime",
      now: new Date(NOW.getTime() + 500),
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
      serverApprovedPayableTargets: [{
        beneficiaryMemberId: "member_group_runtime",
        groupJoinCode: "group_join_code_1234",
        kind: "group",
      }],
    })).resolves.toMatchObject({
      retryAllowed: true,
      status: "payment_pending",
      target: {
        beneficiaryMemberId: "member_group_runtime",
        kind: "group",
      },
    });

    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: "fresh_group_key_1234",
      joinCode: "group_join_code_1234",
      now: new Date(NOW.getTime() + 500),
      offerCode: "usage_5_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toMatchObject({
      selectionConflict: "offer",
      recovered: true,
      status: "payment_pending",
    });

    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: new Date(NOW.getTime() + 1_000),
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toMatchObject({
      status: "payment_pending",
    });

    expect(mocks.stripePaymentIntentCreate).toHaveBeenCalledOnce();
    expect(mocks.stripePaymentIntentConfirm).toHaveBeenCalledTimes(2);
    expect(mocks.stripeCheckoutCreate).not.toHaveBeenCalled();
    expect(onlyPurchase(fake.purchases)).toMatchObject({
      status: "payment_pending",
      stripeChargeIdEncrypted: "encrypted:ch_saved_card_123",
      stripeChargeLookupKey: "billing:ch_saved_card_123",
    });
  });

  it("rechecks the exact group thread-container target inside checkout", async () => {
    const fake = createFakePrisma({ groupFundingTargetLocked: false });

    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_NOT_ELIGIBLE",
      httpStatus: 403,
    });
    expect(fake.groupFundingQueryCalls).toHaveLength(1);
    const queryCall = fake.groupFundingQueryCalls[0];
    if (!queryCall) {
      throw new Error("Expected the group funding target query to run");
    }
    const queryText = Array.from(queryCall.queryParts).join("");
    expect(queryText).toContain('INNER JOIN "hosted_thread_container" AS "container"');
    expect(queryText).toContain(
      '"container"."member_id" = "group"."runtime_member_id"',
    );
    expect(queryText).toContain('"group"."join_code" = ');
    expect(queryText).toContain('"group"."runtime_member_id" = ');
    expect(queryCall.values).toEqual([
      "group_join_code_1234",
      "member_group_runtime",
    ]);
    expect(fake.purchases.size).toBe(0);
    expect(mocks.stripeCheckoutCreate).not.toHaveBeenCalled();
  });

  it.each([
    [
      "owner code to signed funding locator",
      "group_join_code_1234",
      "gf1.member_group_runtime.signed_funding_locator",
    ],
    [
      "signed funding locator to owner code",
      "gf1.member_group_runtime.signed_funding_locator",
      "group_join_code_1234",
    ],
  ] as const)(
    "matches one group purchase by beneficiary across %s",
    async (_direction, firstLocator, secondLocator) => {
      const fake = createFakePrisma();
      const targetFor = (joinCode: string) => ({
        displayName: "Sunday sleep crew",
        fundingPath: `/groups/fund/${encodeURIComponent(joinCode)}`,
        joinCode,
        kind: "friends",
        runtimeMemberId: "member_group_runtime",
      });
      mocks.readHostedGroupUsageFundingTargetByJoinCode
        .mockResolvedValueOnce(targetFor(firstLocator))
        .mockResolvedValueOnce(targetFor(secondLocator));
      mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
        buildStripeSession(request)
      );

      const first = await createHostedGroupUsageCreditCheckout({
        clientRequestKey: CLIENT_REQUEST_KEY,
        joinCode: firstLocator,
        now: NOW,
        offerCode: "usage_10_usd",
        payerMemberId: MEMBER_ID,
        prisma: fake.prisma as never,
      });

      await expect(readHostedActiveUsageCreditPurchaseForPayer({
        beneficiaryMemberId: "member_group_runtime",
        now: new Date(NOW.getTime() + 500),
        payerMemberId: MEMBER_ID,
        prisma: fake.prisma as never,
        serverApprovedPayableTargets: [{
          beneficiaryMemberId: "member_group_runtime",
          groupJoinCode: secondLocator,
          kind: "group",
        }],
      })).resolves.toMatchObject({
        url: "https://checkout.stripe.test/session",
        target: {
          beneficiaryMemberId: "member_group_runtime",
          groupJoinCode: firstLocator,
          kind: "group",
        },
      });

      const recovered = await createHostedGroupUsageCreditCheckout({
        clientRequestKey: "same_group_new_locator_key",
        joinCode: secondLocator,
        now: new Date(NOW.getTime() + 1_000),
        offerCode: "usage_10_usd",
        payerMemberId: MEMBER_ID,
        prisma: fake.prisma as never,
      });
      expect(recovered).toMatchObject({
        purchaseId: first.purchaseId,
        recovered: true,
      });
      expect(recovered).not.toHaveProperty("targetConflict");
      expect(fake.purchases.size).toBe(1);
      expect(mocks.stripeCheckoutCreate).toHaveBeenCalledOnce();
    },
  );

  it("recovers only the active checkout for the same funding target", async () => {
    const fake = createFakePrisma();
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );
    await createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });

    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: "fresh_group_key_1234",
      joinCode: "group_join_code_1234",
      now: new Date(NOW.getTime() + 1_000),
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toMatchObject({ recovered: true });

    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: "different_offer_key_1234",
      joinCode: "group_join_code_1234",
      now: new Date(NOW.getTime() + 1_500),
      offerCode: "usage_5_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toMatchObject({
      selectionConflict: "offer",
      recovered: true,
      status: "checkout_open",
    });

    mocks.readHostedGroupUsageFundingTargetByJoinCode.mockResolvedValueOnce({
      displayName: null,
      fundingPath: "/groups/fund/other_group_code_12",
      joinCode: "other_group_code_12",
      kind: "custom",
      runtimeMemberId: "member_other_group_runtime",
    });
    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: "other_group_key_1234",
      joinCode: "other_group_code_12",
      now: new Date(NOW.getTime() + 2_000),
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toMatchObject({
      recovered: true,
      status: "checkout_open",
      targetConflict: true,
    });
    expect(fake.purchases.size).toBe(1);
  });

  it("rejects request-key replay against a different group target", async () => {
    const fake = createFakePrisma();
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );
    await createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });

    mocks.readHostedGroupUsageFundingTargetByJoinCode.mockResolvedValueOnce({
      displayName: null,
      fundingPath: "/groups/fund/other_group_code_12",
      joinCode: "other_group_code_12",
      kind: "custom",
      runtimeMemberId: "member_other_group_runtime",
    });
    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "other_group_code_12",
      now: new Date(NOW.getTime() + 1_000),
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_REQUEST_KEY_CONFLICT",
      httpStatus: 409,
    });
    expect(fake.purchases.size).toBe(1);
  });

  it("freezes sponsorship configuration into request-key replay", async () => {
    const fake = createFakePrisma();
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );
    const sponsorship = {
      publicAlias: "The Group Historian",
      runningBitRequest: "Treat me like the exhausted CFO.",
      sponsorMessage: "For whatever adventure comes next.",
    };
    await createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
      sponsorship,
    });

    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: new Date(NOW.getTime() + 500),
      offerCode: "usage_5_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
      sponsorship: {
        ...sponsorship,
        sponsorMessage: "A changed note for another amount.",
      },
    })).resolves.toMatchObject({
      selectionConflict: "offer",
      requestKeyMatched: true,
    });

    clearStripeProviderMockHistory();
    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: new Date(NOW.getTime() + 1_000),
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
      sponsorship: {
        ...sponsorship,
        sponsorMessage: "A changed note.",
      },
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_REQUEST_KEY_CONFLICT",
    });
    expectNoStripeProviderIo();

    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: new Date(NOW.getTime() + 2_000),
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_REQUEST_KEY_CONFLICT",
    });

    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: "request_key_654321",
      joinCode: "group_join_code_1234",
      now: new Date(NOW.getTime() + 3_000),
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_REQUEST_KEY_CONFLICT",
    });
    expect(fake.sponsorshipMoments.get(
      onlyPurchase(fake.purchases).id as string,
    )).toMatchObject({
      creativeRequestEncrypted: `sealed:${JSON.stringify({
        request: {
          format: "message",
          prompt: "For whatever adventure comes next.",
          styleRequest: null,
        },
        schema: "murph.group-sponsorship-creative.v1",
      })}`,
      publicAliasEncrypted: "sealed:The Group Historian",
      runningBitRequestEncrypted: "sealed:Treat me like the exhausted CFO.",
      sponsorMessageEncrypted: null,
    });
  });

  it.each([
    "fulfilled",
    "expired",
    "payment_failed",
  ] as const)(
    "acknowledges the exact request key when a %s group purchase outlives its sponsor draft",
    async (status) => {
      const fake = createFakePrisma();
      mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
        buildStripeSession(request)
      );
      const originalSponsorship = {
        publicAlias: "Original sponsor",
        runningBitRequest: null,
        sponsorMessage: "Original note",
      };
      await createHostedGroupUsageCreditCheckout({
        clientRequestKey: CLIENT_REQUEST_KEY,
        joinCode: "group_join_code_1234",
        now: NOW,
        offerCode: "usage_10_usd",
        payerMemberId: MEMBER_ID,
        prisma: fake.prisma as never,
        sponsorship: originalSponsorship,
      });
      const purchase = onlyPurchase(fake.purchases);
      purchase.status = status;
      purchase.terminalAt = new Date(NOW.getTime() + 500);
      clearStripeProviderMockHistory();

      await expect(createHostedGroupUsageCreditCheckout({
        clientRequestKey: CLIENT_REQUEST_KEY,
        joinCode: "group_join_code_1234",
        now: new Date(NOW.getTime() + 1_000),
        offerCode: "usage_10_usd",
        payerMemberId: MEMBER_ID,
        prisma: fake.prisma as never,
        sponsorship: {
          ...originalSponsorship,
          sponsorMessage: "A remounted draft that was not authorized",
        },
      })).resolves.toMatchObject({
        purchaseId: purchase.id,
        recovered: true,
        requestKeyMatched: true,
        selectionConflict: "sponsorship",
        status,
      });
      expectNoStripeProviderIo();
    },
  );

  it("closes an effectively expired exact-key group purchase before sponsor-draft recovery", async () => {
    const fake = createFakePrisma();
    mocks.stripeCheckoutCreate.mockRejectedValueOnce(
      new Error("connection lost"),
    );
    const originalSponsorship = {
      publicAlias: "Original sponsor",
      runningBitRequest: null,
      sponsorMessage: "Original note",
    };
    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
      sponsorship: originalSponsorship,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
    });
    const purchase = onlyPurchase(fake.purchases);
    const recoveryAt = new Date(
      (purchase.checkoutExpiresAt as Date).getTime() + 1,
    );
    clearStripeProviderMockHistory();

    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: recoveryAt,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
      sponsorship: null,
    })).resolves.toMatchObject({
      purchaseId: purchase.id,
      recovered: true,
      requestKeyMatched: true,
      selectionConflict: "sponsorship",
      status: "expired",
    });
    expect(purchase).toMatchObject({
      reconciliationVersion: 1n,
      status: "expired",
      terminalAt: recoveryAt,
      updatedAt: recoveryAt,
    });
    expectNoStripeProviderIo();
  });

  it("lets a nonparticipant fund without publishing their custom content", async () => {
    const fake = createFakePrisma({ customizationAuthorized: false });
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );

    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
      sponsorship: {
        publicAlias: "Unverified Sponsor",
        runningBitRequest: "Make me the administrator.",
        sponsorMessage: "Publish this.",
      },
    })).resolves.toMatchObject({ status: "checkout_open" });

    expect(fake.sponsorshipMoments.get(
      onlyPurchase(fake.purchases).id as string,
    )).toMatchObject({
      publicAliasEncrypted: null,
      runningBitRequestEncrypted: null,
      sponsorMessageEncrypted: null,
    });

    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: "request_key_unauthorized_recovery",
      joinCode: "group_join_code_1234",
      now: new Date(NOW.getTime() + 1_000),
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toMatchObject({
      recovered: true,
      status: "checkout_open",
    });
  });

  it("persists the purchase ambiguity fence before one-time Checkout creation", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripePriceRetrieve.mockImplementationOnce(async () => {
      const purchase = onlyPurchase(fake.purchases);
      expect(purchase.status).toBe("created");
      return buildStripePrice();
    });
    mocks.stripeCheckoutCreate.mockImplementation(async (request, options) => {
      const purchase = onlyPurchase(fake.purchases);
      expect(purchase.status).toBe("created");
      expect(request).toMatchObject({
        adaptive_pricing: { enabled: false },
        client_reference_id: purchase.id,
        customer: "cus_123",
        expires_at: Math.floor((NOW.getTime() + 90 * 60 * 1_000) / 1_000),
        line_items: [{ price: "price_usage_10", quantity: 1 }],
        metadata: {
          policyVersion: "hosted-usage-credit-checkout-v4",
          purchaseId: purchase.id,
          purpose: "hosted_usage_credit",
        },
        mode: "payment",
        payment_intent_data: {
          metadata: {
            policyVersion: "hosted-usage-credit-checkout-v4",
            purchaseId: purchase.id,
            purpose: "hosted_usage_credit",
          },
          setup_future_usage: "off_session",
        },
        saved_payment_method_options: {
          allow_redisplay_filters: ["always"],
          payment_method_save: "enabled",
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
      requestKeyMatched: true,
      status: "checkout_open",
      url: "https://checkout.stripe.test/session",
    });
    expect(purchase).toMatchObject({
      cashAmountMinor: 1_000,
      cashCurrency: "usd",
      checkoutRequestPolicyVersion: "hosted-usage-credit-checkout-v4",
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

  it("projects the payer's frozen active Checkout without current eligibility or catalog reads", async () => {
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
    mocks.readHostedPersonalUsageCreditOfferCodes.mockReset();
    mocks.requireHostedStripeUsageCreditCheckoutConfig.mockReset();

    await expect(readHostedActiveUsageCreditPurchaseForPayer({
      now: NOW,
      serverApprovedPayableTargets: [{
        beneficiaryMemberId: MEMBER_ID,
        kind: "personal",
      }],
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toEqual({
      offerCode: "usage_10_usd",
      purchaseId: checkout.purchaseId,
      retryAllowed: false,
      status: "checkout_open",
      target: {
        beneficiaryMemberId: MEMBER_ID,
        kind: "personal",
      },
      url: "https://checkout.stripe.test/session",
    });
    expect(mocks.readHostedPersonalUsageCreditOfferCodes).not.toHaveBeenCalled();
    expect(mocks.requireHostedStripeUsageCreditCheckoutConfig).not.toHaveBeenCalled();
  });

  it("keeps a former Family beneficiary status-only before serializing the active purchase", async () => {
    const fake = createFakePrisma();
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );
    const checkout = await createHostedFamilyMemberUsageCreditCheckout({
      beneficiaryMemberId: "hbm_familymember1",
      clientRequestKey: CLIENT_REQUEST_KEY,
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });
    mocks.decryptHostedWebNullableString.mockClear();

    const statusOnly = await readHostedActiveUsageCreditPurchaseForPayer({
      now: NOW,
      serverApprovedPayableTargets: [{
        beneficiaryMemberId: MEMBER_ID,
        kind: "personal",
      }],
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });

    expect(statusOnly).toEqual({
      offerCode: "usage_10_usd",
      purchaseId: checkout.purchaseId,
      retryAllowed: false,
      status: "checkout_open",
      target: {
        beneficiaryMemberId: "hbm_familymember1",
        familyGroupId: "hbag_abcdefghijklmnop",
        kind: "family",
      },
    });
    expect(JSON.stringify(statusOnly)).not.toContain("checkout.stripe.test");
    expect(mocks.decryptHostedWebNullableString).not.toHaveBeenCalled();
  });

  it("releases an active Family checkout only for the exact server-approved target", async () => {
    const fake = createFakePrisma();
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );
    await createHostedFamilyMemberUsageCreditCheckout({
      beneficiaryMemberId: "hbm_familymember1",
      clientRequestKey: CLIENT_REQUEST_KEY,
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });

    await expect(readHostedActiveUsageCreditPurchaseForPayer({
      now: NOW,
      serverApprovedPayableTargets: [{
        beneficiaryMemberId: "hbm_familymember1",
        familyGroupId: "hbag_abcdefghijklmnop",
        kind: "family",
      }],
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toMatchObject({
      retryAllowed: false,
      url: "https://checkout.stripe.test/session",
    });
  });

  it("rechecks live Family authority before decrypting an active Checkout URL", async () => {
    const fake = createFakePrisma();
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );
    await createHostedFamilyMemberUsageCreditCheckout({
      beneficiaryMemberId: "hbm_familymember1",
      clientRequestKey: CLIENT_REQUEST_KEY,
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    });
    mocks.resolveHostedFamilyUsageCreditCheckoutTargetTx.mockResolvedValueOnce(null);
    mocks.decryptHostedWebNullableString.mockClear();

    await expect(readHostedActiveUsageCreditPurchaseForPayer({
      now: NOW,
      serverApprovedPayableTargets: [{
        beneficiaryMemberId: "hbm_familymember1",
        familyGroupId: "hbag_abcdefghijklmnop",
        kind: "family",
      }],
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toEqual({
      offerCode: "usage_10_usd",
      purchaseId: expect.any(String),
      retryAllowed: false,
      status: "checkout_open",
      target: {
        beneficiaryMemberId: "hbm_familymember1",
        familyGroupId: "hbag_abcdefghijklmnop",
        kind: "family",
      },
    });
    expect(mocks.decryptHostedWebNullableString).not.toHaveBeenCalled();
  });

  it("withholds the stored Checkout URL from a suspended payer while preserving cancel visibility", async () => {
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
    fake.member.suspendedAt = NOW;

    await expect(readHostedActiveUsageCreditPurchaseForPayer({
      now: NOW,
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toEqual({
      offerCode: "usage_10_usd",
      purchaseId: checkout.purchaseId,
      retryAllowed: false,
      status: "checkout_open",
      target: {
        beneficiaryMemberId: MEMBER_ID,
        kind: "personal",
      },
    });
  });

  it("withholds retry capability for a suspended payer's unattached purchase", async () => {
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
    fake.member.suspendedAt = NOW;
    clearStripeProviderMockHistory();

    await expect(readHostedActiveUsageCreditPurchaseForPayer({
      now: new Date(NOW.getTime() + 60_000),
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toEqual({
      offerCode: "usage_10_usd",
      purchaseId: purchase.id,
      restartAt: (purchase.checkoutExpiresAt as Date).toISOString(),
      retryAllowed: false,
      status: "reconciling",
      target: {
        beneficiaryMemberId: MEMBER_ID,
        kind: "personal",
      },
    });
    expectNoStripeProviderIo();
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
      status: "created",
    });
  });

  it("accepts Stripe's expanded base-currency Price option", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripePriceRetrieve.mockResolvedValueOnce(buildStripePrice({
      currency_options: {
        usd: {
          custom_unit_amount: null,
          tax_behavior: "inclusive",
          unit_amount: 1_000,
          unit_amount_decimal: "1000",
        },
      },
      tax_behavior: "inclusive",
      unit_amount_decimal: "1000",
    }));
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    })).resolves.toMatchObject({
      status: "checkout_open",
    });
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledTimes(1);
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

  it("replays the purchase-derived request and stable key after an ambiguous response", async () => {
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
    expect(checkoutError.cause).toEqual({
      kind: "hosted_stripe_alert_correlation",
      requestId: "req_private",
    });
    expect(Object.isFrozen(checkoutError.cause)).toBe(true);
    expect(JSON.stringify(checkoutError)).not.toContain("price_private");
    expect(JSON.stringify(checkoutError)).not.toContain("cus_private");
    expect(JSON.stringify(checkoutError)).not.toContain("req_private");
    expect(onlyPurchase(fake.purchases)).toMatchObject({
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

  it("rejects an unsupported Checkout request policy before retrying Stripe", async () => {
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
    purchase.checkoutRequestPolicyVersion = "hosted-usage-credit-checkout-v0";
    clearStripeProviderMockHistory();

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: new Date(NOW.getTime() + 60_000),
      offerCode: "usage_10_usd",
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_CHECKOUT_INVARIANT_FAILED",
      details: { code: "checkout_policy_mismatch" },
      httpStatus: 500,
    });
    expectNoStripeProviderIo();
  });

  it("stops provider creation retries at the derived 30-minute safety window", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate.mockRejectedValueOnce(new Error("connection lost"));

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    })).rejects.toBeTruthy();

    const cutoffRecovery = await createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: new Date(NOW.getTime() + 30 * 60 * 1_000),
      offerCode: "usage_10_usd",
    });
    expect(cutoffRecovery).toMatchObject({
      restartAt: new Date(NOW.getTime() + 90 * 60 * 1_000).toISOString(),
      status: "reconciling",
    });
    expect(cutoffRecovery).not.toHaveProperty("retryAllowed");
    await expect(readHostedActiveUsageCreditPurchaseForPayer({
      now: new Date(NOW.getTime() + 30 * 60 * 1_000),
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toMatchObject({
      restartAt: new Date(NOW.getTime() + 90 * 60 * 1_000).toISOString(),
      retryAllowed: false,
      status: "reconciling",
    });

    expect(onlyPurchase(fake.purchases)).toMatchObject({ status: "created" });
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledTimes(1);
  });

  it("stops projecting an unattached purchase at the exact frozen expiry", async () => {
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

    await expect(readHostedActiveUsageCreditPurchaseForPayer({
      now: new Date(NOW.getTime() + 89 * 60 * 1_000),
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toMatchObject({
      restartAt: new Date(NOW.getTime() + 90 * 60 * 1_000).toISOString(),
      retryAllowed: false,
      status: "reconciling",
    });
    await expect(readHostedActiveUsageCreditPurchaseForPayer({
      now: new Date(NOW.getTime() + 90 * 60 * 1_000),
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toBeNull();

    expect(onlyPurchase(fake.purchases)).toMatchObject({ status: "created" });
    expectNoStripeProviderIo();
  });

  it("recovers a created purchase for a fresh browser request", async () => {
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

    mocks.requireHostedStripeUsageCreditCheckoutConfig.mockImplementation(() => {
      throw new Error("Current offer configuration must not gate recovery.");
    });
    mocks.requireHostedOnboardingPublicBaseUrl.mockImplementation(() => {
      throw new Error("Current public URL configuration must not gate recovery.");
    });

    const recovered = await createHostedUsageCreditCheckout({
      clientRequestKey: "another_request_1234",
      memberId: MEMBER_ID,
      now: new Date(NOW.getTime() + 60_000),
      offerCode: "usage_10_usd",
    });

    expect(recovered).toMatchObject({
      recovered: true,
      status: "checkout_open",
      url: "https://checkout.stripe.test/session",
    });
    expect(onlyPurchase(fake.purchases)).toMatchObject({
      clientRequestKey: CLIENT_REQUEST_KEY,
      offerCode: "usage_10_usd",
      status: "checkout_open",
    });
    expect(fake.purchases.size).toBe(1);
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledTimes(2);
    expect(mocks.requireHostedStripeUsageCreditCheckoutConfig).toHaveBeenCalledTimes(1);
    expect(mocks.requireHostedOnboardingPublicBaseUrl).toHaveBeenCalledTimes(1);
  });

  it("returns the existing Checkout URL for a fresh browser request", async () => {
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
    clearStripeProviderMockHistory();
    fake.member.billingStatus = "past_due";
    mocks.readHostedMemberStripeBillingRef.mockImplementation(() => {
      throw new Error("Current billing eligibility must not gate recovery.");
    });
    mocks.requireHostedStripeUsageCreditCheckoutConfig.mockImplementation(() => {
      throw new Error("Current offer configuration must not gate recovery.");
    });
    mocks.requireHostedOnboardingPublicBaseUrl.mockImplementation(() => {
      throw new Error("Current public URL configuration must not gate recovery.");
    });

    const recovered = await createHostedUsageCreditCheckout({
      clientRequestKey: "another_request_1234",
      memberId: MEMBER_ID,
      now: new Date(NOW.getTime() + 60_000),
      offerCode: "usage_10_usd",
    });

    expect(recovered).toEqual({
      purchaseId: checkout.purchaseId,
      recovered: true,
      status: checkout.status,
      url: checkout.url,
    });
    expect(recovered).not.toHaveProperty("requestKeyMatched");
    expect(fake.purchases.size).toBe(1);
    expectNoStripeProviderIo();
    expect(mocks.readHostedMemberStripeBillingRef).toHaveBeenCalledOnce();
    expect(mocks.readHostedMemberBillingSnapshot).toHaveBeenCalledOnce();
    expect(mocks.readHostedPersonalUsageCreditOfferCodes).toHaveBeenCalledTimes(1);
    expect(mocks.requireHostedStripeUsageCreditCheckoutConfig).toHaveBeenCalledTimes(1);
    expect(mocks.requireHostedOnboardingPublicBaseUrl).toHaveBeenCalledTimes(1);
  });

  it("returns honest recovery state when the frozen create retry stays ambiguous", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate.mockRejectedValue(new Error("connection lost"));

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
    });
    const purchase = onlyPurchase(fake.purchases);

    await expect(createHostedUsageCreditCheckout({
      clientRequestKey: "another_request_1234",
      memberId: MEMBER_ID,
      now: new Date(NOW.getTime() + 60_000),
      offerCode: "usage_10_usd",
    })).resolves.toEqual({
      purchaseId: String(purchase.id),
      recovered: true,
      restartAt: (purchase.checkoutExpiresAt as Date).toISOString(),
      retryAllowed: true,
      status: "reconciling",
    });

    expect(fake.purchases.size).toBe(1);
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledTimes(2);
  });

  it("scopes active-purchase recovery to the authenticated payer", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mocks.stripeCheckoutCreate.mockImplementation(async (request) =>
      buildStripeSession(request)
    );

    const first = await createHostedUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      memberId: MEMBER_ID,
      now: NOW,
      offerCode: "usage_10_usd",
    });
    const second = await createHostedUsageCreditCheckout({
      clientRequestKey: "another_request_1234",
      memberId: "hbm_othermember",
      now: new Date(NOW.getTime() + 60_000),
      offerCode: "usage_5_usd",
    });

    expect(first).not.toHaveProperty("recovered");
    expect(second).not.toHaveProperty("recovered");
    expect(second.purchaseId).not.toBe(first.purchaseId);
    expect(fake.purchases.size).toBe(2);
  });

  it("closes an expired unbound purchase before applying the active-purchase fence", async () => {
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
      status: "expired",
    });
    expect(fake.purchases.size).toBe(2);
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledTimes(2);
  });

  it("closes a same-key unbound purchase after its Checkout expiry", async () => {
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
      status: "expired",
    });
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledTimes(1);
  });

  it("projects the winning purchase when a request key is reauthorized for another offer", async () => {
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
      now: NOW,
      offerCode: "usage_5_usd",
    })).resolves.toMatchObject({
      selectionConflict: "offer",
      recovered: true,
      status: "reconciling",
    });
    expect(fake.purchases.size).toBe(1);
    expect(onlyPurchase(fake.purchases)).toMatchObject({
      clientRequestKey: CLIENT_REQUEST_KEY,
      offerCode: "usage_10_usd",
    });
    expectNoStripeProviderIo();
  });

  it("fails closed for sponsored, synthetic, trial, or inactive members", async () => {
    for (let caseIndex = 0; caseIndex < 3; caseIndex += 1) {
      const fake = createFakePrisma();
      mocks.getPrisma.mockReturnValue(fake.prisma);
      mocks.readHostedPersonalUsageCreditOfferCodes.mockResolvedValueOnce([]);
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
    mocks.readHostedPersonalUsageCreditOfferCodes.mockResolvedValueOnce([]);
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

describe("automatic group refill saved-card recovery", () => {
  it("repairs a pre-fix failed refill and opens Checkout on the first recovery attempt", async () => {
    const fake = createFakePrisma();
    const fixture = installRecoverableAutomaticGroupRefillFixture(fake);
    mocks.stripeCheckoutCreate.mockImplementationOnce(async (request) =>
      buildStripeSession(request)
    );

    await expect(recoverHostedGroupSponsorshipUsageCreditCheckout({
      authorizationId: fixture.authority.authorizationId,
      beneficiaryMemberId: fixture.authority.beneficiaryMemberId,
      now: NOW,
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toMatchObject({
      purchaseId: fixture.refill.id,
      status: "checkout_open",
      url: "https://checkout.stripe.test/session",
    });

    expect(new URL(String(fixture.refill.checkoutSuccessUrl)).searchParams.get(
      "usagePurchase",
    )).toBe(fixture.refill.id);
    expect(new URL(String(fixture.refill.checkoutCancelUrl)).searchParams.get(
      "usagePurchase",
    )).toBe(fixture.refill.id);
    expect(fake.purchases.size).toBe(2);
    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ purchaseId: fixture.refill.id }),
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringContaining(fixture.refill.id),
      }),
    );
  });

  it.each(["price-read", "session-create"] as const)(
    "emails when explicit group-sponsorship recovery terminates at %s",
    async (failurePoint) => {
      const fake = createFakePrisma();
      const fixture = installRecoverableAutomaticGroupRefillFixture(fake);
      const fetchMock = stubStripeAlertEmailDelivery();
      if (failurePoint === "price-read") {
        mocks.stripePriceRetrieve.mockRejectedValueOnce(
          buildStripeConnectionErrorWithoutRequestId(),
        );
      } else {
        mocks.stripeCheckoutCreate.mockRejectedValueOnce(
          buildStripeConnectionErrorWithoutRequestId(),
        );
      }

      await expect(recoverHostedGroupSponsorshipUsageCreditCheckout({
        authorizationId: fixture.authority.authorizationId,
        beneficiaryMemberId: fixture.authority.beneficiaryMemberId,
        now: NOW,
        payerMemberId: MEMBER_ID,
        prisma: fake.prisma as never,
      })).rejects.toMatchObject({
        code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
      });

      await runOnlyScheduledStripeAlert();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(readResendRequestBody(fetchMock)).toMatchObject({
        subject: "Murph Stripe operation failed — usage-credit.checkout",
      });
    },
  );

  it("keeps a no-charge group-sponsorship recovery projection alert-silent", async () => {
    const fake = createFakePrisma();
    const fixture = installRecoverableAutomaticGroupRefillFixture(fake, {
      capacityHealthy: true,
    });
    const fetchMock = stubStripeAlertEmailDelivery();

    await expect(recoverHostedGroupSponsorshipUsageCreditCheckout({
      authorizationId: fixture.authority.authorizationId,
      beneficiaryMemberId: fixture.authority.beneficiaryMemberId,
      now: NOW,
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).resolves.toBeNull();

    expect(nextServerMocks.after).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retrieves and confirms the same bound PaymentIntent after a bind-before-confirm crash", async () => {
    const fake = createFakePrisma();
    const fixture = installAutomaticGroupRefillFixture(fake, {
      status: "payment_pending",
    });
    mockCanonicalSavedCard();
    const requiresConfirmation = buildSavedCardPaymentIntent({
      amount: 500,
      amountReceived: 0,
      latestCharge: null,
      purchaseId: fixture.refill.id,
      status: "requires_confirmation",
    });
    const succeeded = buildSavedCardPaymentIntent({
      amount: 500,
      amountReceived: 500,
      latestCharge: "ch_refill_123",
      purchaseId: fixture.refill.id,
      status: "succeeded",
    });
    mocks.stripePaymentIntentRetrieve.mockResolvedValueOnce(requiresConfirmation);
    mocks.stripePaymentIntentConfirm.mockResolvedValueOnce(succeeded);
    const stripe = mocks.requireHostedStripeApiMode().stripe;
    const input = {
      billingAuthority: {
        automaticSponsorship: fixture.authority,
        kind: "group" as const,
      },
      checkoutRequest: { customer: "cus_group_payer" } as never,
      now: NOW,
      policyVersion: "hosted-usage-credit-checkout-v4" as const,
      prisma: fake.prisma as never,
      purchase: fixture.refill as never,
      stripe: stripe as never,
    };

    await expect(tryChargeHostedUsageCreditSavedCard(input)).resolves.toMatchObject({
      id: fixture.refill.id,
      status: "payment_pending",
      stripePaymentIntentLookupKey: "billing:pi_saved_card_123",
    });

    expect(mocks.stripePaymentIntentCreate).not.toHaveBeenCalled();
    expect(mocks.stripePaymentIntentRetrieve).toHaveBeenCalledTimes(1);
    expect(mocks.stripePaymentIntentRetrieve).toHaveBeenCalledWith(
      "pi_saved_card_123",
      { expand: ["latest_charge"] },
    );
    expect(mocks.stripePaymentIntentConfirm).toHaveBeenCalledTimes(1);
    expect(mocks.stripePaymentIntentConfirm).toHaveBeenCalledWith(
      "pi_saved_card_123",
      expect.any(Object),
      expect.any(Object),
    );
  });

  it("cancels a bound refill instead of confirming after sponsorship is paused", async () => {
    const fake = createFakePrisma();
    const fixture = installAutomaticGroupRefillFixture(fake, {
      status: "payment_pending",
    });
    const authorization = fake.sponsorshipAuthorizations.get(
      fixture.authority.authorizationId,
    );
    expect(authorization).toBeDefined();
    Object.assign(authorization!, { status: "paused" });
    const requiresConfirmation = buildSavedCardPaymentIntent({
      amount: 500,
      amountReceived: 0,
      latestCharge: null,
      purchaseId: fixture.refill.id,
      status: "requires_confirmation",
    });
    mocks.stripePaymentIntentRetrieve.mockResolvedValueOnce(requiresConfirmation);
    mocks.stripePaymentIntentCancel.mockResolvedValueOnce({
      ...requiresConfirmation,
      status: "canceled",
    });

    await expect(tryChargeHostedUsageCreditSavedCard({
      billingAuthority: {
        automaticSponsorship: fixture.authority,
        kind: "group",
      },
      checkoutRequest: { customer: "cus_group_payer" } as never,
      now: NOW,
      policyVersion: "hosted-usage-credit-checkout-v4",
      prisma: fake.prisma as never,
      purchase: fixture.refill as never,
      stripe: mocks.requireHostedStripeApiMode().stripe as never,
    })).resolves.toMatchObject({
      id: fixture.refill.id,
      status: "expired",
    });

    expect(mocks.stripePaymentIntentConfirm).not.toHaveBeenCalled();
    expect(mocks.stripePaymentIntentCancel).toHaveBeenCalledWith(
      "pi_saved_card_123",
      { cancellation_reason: "abandoned" },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(fixture.refill).toMatchObject({
      status: "expired",
      terminalAt: NOW,
    });
  });

  it("keeps an already-admitted refill bound after later capacity changes", async () => {
    const fake = createFakePrisma();
    const fixture = installAutomaticGroupRefillFixture(fake, {
      status: "payment_pending",
    });
    const requiresConfirmation = buildSavedCardPaymentIntent({
      amount: 500,
      amountReceived: 0,
      latestCharge: null,
      purchaseId: fixture.refill.id,
      status: "requires_confirmation",
    });
    const succeeded = buildSavedCardPaymentIntent({
      amount: 500,
      amountReceived: 500,
      latestCharge: "ch_refill_after_capacity_change",
      purchaseId: fixture.refill.id,
      status: "succeeded",
    });
    mocks.stripePaymentIntentRetrieve.mockResolvedValueOnce(requiresConfirmation);
    mocks.stripePaymentIntentConfirm.mockResolvedValueOnce(succeeded);

    await expect(tryChargeHostedUsageCreditSavedCard({
      billingAuthority: {
        automaticSponsorship: fixture.authority,
        kind: "group",
      },
      checkoutRequest: { customer: "cus_group_payer" } as never,
      now: NOW,
      policyVersion: "hosted-usage-credit-checkout-v4",
      prisma: fake.prisma as never,
      purchase: fixture.refill as never,
      stripe: mocks.requireHostedStripeApiMode().stripe as never,
    })).resolves.toMatchObject({
      id: fixture.refill.id,
      status: "payment_pending",
    });

    expect(mocks.stripePaymentIntentConfirm).toHaveBeenCalledTimes(1);
    expect(mocks.stripePaymentIntentCancel).not.toHaveBeenCalled();
    expect(fixture.refill).toMatchObject({
      status: "payment_pending",
      terminalAt: null,
    });
  });

  it("does not bind or confirm after the group loses runtime viability", async () => {
    const fake = createFakePrisma();
    const fixture = installAutomaticGroupRefillFixture(fake);
    mockCanonicalSavedCard();
    mocks.hasHostedRuntimeActiveAccessForUpdateTx.mockResolvedValue(false);
    const requiresConfirmation = buildSavedCardPaymentIntent({
      amount: 500,
      amountReceived: 0,
      latestCharge: null,
      purchaseId: fixture.refill.id,
      status: "requires_confirmation",
    });
    mocks.stripePaymentIntentCreate.mockResolvedValueOnce(requiresConfirmation);
    mocks.stripePaymentIntentCancel.mockResolvedValueOnce({
      ...requiresConfirmation,
      status: "canceled",
    });

    await expect(tryChargeHostedUsageCreditSavedCard({
      billingAuthority: {
        automaticSponsorship: fixture.authority,
        kind: "group",
      },
      checkoutRequest: { customer: "cus_group_payer" } as never,
      now: NOW,
      policyVersion: "hosted-usage-credit-checkout-v4",
      prisma: fake.prisma as never,
      purchase: fixture.refill as never,
      stripe: mocks.requireHostedStripeApiMode().stripe as never,
    })).resolves.toMatchObject({
      id: fixture.refill.id,
      status: "expired",
    });

    expect(mocks.stripePaymentIntentCreate).toHaveBeenCalledTimes(1);
    expect(mocks.stripePaymentIntentCancel).toHaveBeenCalledWith(
      "pi_saved_card_123",
      { cancellation_reason: "abandoned" },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(mocks.stripePaymentIntentConfirm).not.toHaveBeenCalled();
    expect(fixture.refill).toMatchObject({
      status: "expired",
      stripePaymentIntentIdEncrypted: null,
      stripePaymentIntentLookupKey: null,
      terminalAt: NOW,
    });
  });
});

describe("expireHostedUsageCreditCheckout", () => {
  it("does not treat a cancel return as authority for an unbound created purchase", async () => {
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
      status: "created",
    });
    expect(mocks.stripeCheckoutRetrieve).not.toHaveBeenCalled();
    expect(mocks.stripeCheckoutExpire).not.toHaveBeenCalled();
  });

  it("expires only the payer-owned bound unpaid Stripe Session", async () => {
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
      status: "expired",
    });
  });

  it("cancels a payer-owned sessionless direct attempt and releases the purchase fence", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    mockCanonicalSavedCard();
    const readUnconfirmedIntent = () => buildSavedCardPaymentIntent({
      amountReceived: 0,
      latestCharge: null,
      purchaseId: String(onlyPurchase(fake.purchases).id),
      status: "requires_confirmation",
    });
    mocks.stripePaymentIntentCreate.mockImplementationOnce(
      async () => readUnconfirmedIntent(),
    );
    mocks.stripePaymentIntentConfirm.mockRejectedValueOnce(
      new Error("connection lost"),
    );
    mocks.stripePaymentIntentRetrieve
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockImplementationOnce(async () => ({
        ...readUnconfirmedIntent(),
        status: "requires_payment_method",
      }));
    mocks.stripePaymentIntentCancel.mockImplementationOnce(async () => ({
      ...readUnconfirmedIntent(),
      status: "canceled",
    }));

    await expect(createHostedGroupUsageCreditCheckout({
      clientRequestKey: CLIENT_REQUEST_KEY,
      joinCode: "group_join_code_1234",
      now: NOW,
      offerCode: "usage_10_usd",
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
    })).rejects.toMatchObject({
      code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
    });
    const purchase = onlyPurchase(fake.purchases);

    await expect(readHostedActiveUsageCreditPurchaseForPayer({
      now: new Date(NOW.getTime() + 30_000),
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
      serverApprovedPayableTargets: [],
    })).resolves.toMatchObject({
      cancelAllowed: true,
      retryAllowed: false,
      status: "payment_pending",
    });
    await expect(readHostedUsageCreditPurchaseStatus({
      payerMemberId: MEMBER_ID,
      prisma: fake.prisma as never,
      purchaseId: String(purchase.id),
    })).resolves.toMatchObject({
      cancelAllowed: true,
      status: "payment_pending",
    });

    await expect(expireHostedUsageCreditCheckout({
      now: new Date(NOW.getTime() + 60_000),
      payerMemberId: MEMBER_ID,
      purchaseId: String(purchase.id),
    })).resolves.toMatchObject({
      purchaseId: purchase.id,
      status: "expired",
    });

    expect(mocks.stripeCheckoutRetrieve).not.toHaveBeenCalled();
    expect(mocks.stripeCheckoutExpire).not.toHaveBeenCalled();
    expect(mocks.stripePaymentIntentCancel).toHaveBeenCalledOnce();
    expect(purchase).toMatchObject({
      lastReconciledAt: new Date(NOW.getTime() + 60_000),
      status: "expired",
      terminalAt: new Date(NOW.getTime() + 60_000),
    });
  });

  it.each([
    ["processing", 0, null],
    ["succeeded", 1_000, "ch_saved_card_123"],
  ] as const)(
    "does not clear a direct attempt when cancellation observes %s",
    async (status, amountReceived, latestCharge) => {
      const fake = createFakePrisma();
      mocks.getPrisma.mockReturnValue(fake.prisma);
      mockCanonicalSavedCard();
      const readUnconfirmedIntent = () => buildSavedCardPaymentIntent({
        amountReceived: 0,
        latestCharge: null,
        purchaseId: String(onlyPurchase(fake.purchases).id),
        status: "requires_confirmation",
      });
      mocks.stripePaymentIntentCreate.mockImplementationOnce(
        async () => readUnconfirmedIntent(),
      );
      mocks.stripePaymentIntentConfirm.mockRejectedValueOnce(
        new Error("connection lost"),
      );
      mocks.stripePaymentIntentRetrieve
        .mockRejectedValueOnce(new Error("connection lost"))
        .mockImplementationOnce(async () => buildSavedCardPaymentIntent({
          amountReceived,
          latestCharge,
          purchaseId: String(onlyPurchase(fake.purchases).id),
          status,
        }));

      await expect(createHostedGroupUsageCreditCheckout({
        clientRequestKey: CLIENT_REQUEST_KEY,
        joinCode: "group_join_code_1234",
        now: NOW,
        offerCode: "usage_10_usd",
        payerMemberId: MEMBER_ID,
        prisma: fake.prisma as never,
      })).rejects.toMatchObject({
        code: "HOSTED_USAGE_CREDIT_STRIPE_UNAVAILABLE",
      });
      const purchase = onlyPurchase(fake.purchases);

      await expect(expireHostedUsageCreditCheckout({
        now: new Date(NOW.getTime() + 60_000),
        payerMemberId: MEMBER_ID,
        purchaseId: String(purchase.id),
      })).resolves.toMatchObject({
        purchaseId: purchase.id,
        status: "payment_pending",
      });

      expect(mocks.stripePaymentIntentCancel).not.toHaveBeenCalled();
      expect(purchase).toMatchObject({
        status: "payment_pending",
        stripePaymentIntentLookupKey: "billing:pi_saved_card_123",
        terminalAt: null,
      });
    },
  );

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
      status: "checkout_open",
    });
  });

  it("does not reveal or mutate another payer's bound Session", async () => {
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
  it("detaches a terminal payer and later permits the group beneficiary deletion", async () => {
    const fake = createFakePrisma();
    const purchase = {
      beneficiaryMemberId: "member_group_runtime",
      id: "hucp_group_purchase",
      lastReconciledAt: NOW,
      paidAt: NOW,
      payerMemberId: MEMBER_ID,
      reconciliationVersion: 0n,
      status: "fulfilled",
      stripeChargeIdEncrypted: "encrypted:charge",
      stripeChargeLookupKey: "charge:lookup",
      stripeCheckoutSessionIdEncrypted: "encrypted:session",
      stripeCheckoutSessionLookupKey: "session:lookup",
      stripeCheckoutUrlEncrypted: null,
      stripeCustomerIdEncrypted: "encrypted:customer",
      stripePaymentIntentIdEncrypted: "encrypted:payment-intent",
      stripePaymentIntentLookupKey: "payment-intent:lookup",
      stripePriceIdEncrypted: "encrypted:price",
      terminalAt: NOW,
      updatedAt: NOW,
    };
    fake.purchases.set(String(purchase.id), purchase);

    await expect(assertHostedUsageCreditPurchasesReadyForAccountDeletionTx({
      memberIds: [MEMBER_ID],
      now: new Date(NOW.getTime() + 1_000),
      prisma: fake.prisma as never,
    })).resolves.toBeUndefined();

    expect(purchase).toMatchObject({
      beneficiaryMemberId: "member_group_runtime",
      payerMemberId: null,
      reconciliationVersion: 1n,
      stripeChargeIdEncrypted: null,
      stripeCheckoutSessionIdEncrypted: null,
      stripeCustomerIdEncrypted: null,
      stripePaymentIntentIdEncrypted: null,
      stripePriceIdEncrypted: null,
    });
    expect(purchase.stripeChargeLookupKey).toBe("charge:lookup");
    expect(purchase.stripePaymentIntentLookupKey).toBe("payment-intent:lookup");

    await expect(assertHostedUsageCreditPurchasesReadyForAccountDeletionTx({
      memberIds: ["member_group_runtime"],
      prisma: fake.prisma as never,
    })).resolves.toBeUndefined();
  });

  it("detaches a fulfilled direct purchase without reconstructing Checkout", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    const purchase = {
      beneficiaryMemberId: "member_group_runtime",
      id: "hucp_direct_group_purchase",
      lastReconciledAt: NOW,
      paidAt: NOW,
      payerMemberId: MEMBER_ID,
      reconciliationVersion: 0n,
      status: "fulfilled",
      stripeChargeIdEncrypted: "encrypted:ch_direct_123",
      stripeChargeLookupKey: "billing:ch_direct_123",
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey: null,
      stripeCheckoutUrlEncrypted: null,
      stripeCustomerIdEncrypted: "encrypted:cus_group_payer",
      stripeCustomerLookupKey: "customer:cus_group_payer",
      stripePaymentIntentIdEncrypted: "encrypted:pi_direct_123",
      stripePaymentIntentLookupKey: "billing:pi_direct_123",
      stripePriceIdEncrypted: "encrypted:price_usage_10",
      terminalAt: NOW,
      updatedAt: NOW,
    };
    fake.purchases.set(String(purchase.id), purchase);
    fake.member.suspendedAt = NOW;

    await expect(closeHostedUsageCreditPurchasesForAccountDeletion({
      memberIds: [MEMBER_ID],
      now: new Date(NOW.getTime() + 1_000),
    })).resolves.toBeUndefined();
    expectNoStripeProviderIo();

    await expect(assertHostedUsageCreditPurchasesReadyForAccountDeletionTx({
      memberIds: [MEMBER_ID],
      now: new Date(NOW.getTime() + 2_000),
      prisma: fake.prisma as never,
    })).resolves.toBeUndefined();

    expect(purchase).toMatchObject({
      payerMemberId: null,
      reconciliationVersion: 1n,
      stripeChargeIdEncrypted: null,
      stripeCheckoutSessionIdEncrypted: null,
      stripeCustomerIdEncrypted: null,
      stripePaymentIntentIdEncrypted: null,
      stripePriceIdEncrypted: null,
    });
    expect(purchase.stripeChargeLookupKey).toBe("billing:ch_direct_123");
    expect(purchase.stripeCheckoutSessionLookupKey).toBeNull();
    expect(purchase.stripePaymentIntentLookupKey).toBe(
      "billing:pi_direct_123",
    );
  });

  it("detaches an exact terminal unbound automatic-refill failure without changing beneficiary credit", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    const purchase = {
      beneficiaryMemberId: "member_group_runtime",
      groupSponsorshipAuthorizationId: "hgsa_abcdefghijklmnop",
      groupSponsorshipChargeOrdinal: 1,
      id: "hucp_terminal_automatic_failure",
      lastReconciledAt: NOW,
      paidAt: null,
      payerMemberId: MEMBER_ID,
      reconciliationVersion: 2n,
      remainingCreditUsdMicros: 3_500_000n,
      status: "payment_failed",
      stripeChargeIdEncrypted: null,
      stripeChargeLookupKey: null,
      stripeCheckoutSessionIdEncrypted: null,
      stripeCheckoutSessionLookupKey: null,
      stripeCheckoutUrlEncrypted: null,
      stripeCustomerIdEncrypted: "encrypted:customer",
      stripePaymentIntentIdEncrypted: null,
      stripePaymentIntentLookupKey: null,
      stripePriceIdEncrypted: "encrypted:price",
      terminalAt: NOW,
      updatedAt: NOW,
    };
    fake.purchases.set(String(purchase.id), purchase);
    fake.member.suspendedAt = NOW;

    await expect(closeHostedUsageCreditPurchasesForAccountDeletion({
      memberIds: [MEMBER_ID],
      now: new Date(NOW.getTime() + 1_000),
    })).resolves.toBeUndefined();
    expectNoStripeProviderIo();
    await expect(assertHostedUsageCreditPurchasesReadyForAccountDeletionTx({
      memberIds: [MEMBER_ID],
      now: new Date(NOW.getTime() + 2_000),
      prisma: fake.prisma as never,
    })).resolves.toBeUndefined();

    expect(purchase).toMatchObject({
      beneficiaryMemberId: "member_group_runtime",
      payerMemberId: null,
      reconciliationVersion: 3n,
      remainingCreditUsdMicros: 3_500_000n,
      status: "payment_failed",
      stripeCustomerIdEncrypted: null,
      stripePriceIdEncrypted: null,
    });
  });

  it("cancels an exact bound direct payment before deleting its payer", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    const fixture = installAutomaticGroupRefillFixture(fake, {
      status: "payment_pending",
    });
    const requiresConfirmation = buildSavedCardPaymentIntent({
      amount: 500,
      amountReceived: 0,
      latestCharge: null,
      purchaseId: fixture.refill.id,
      status: "requires_confirmation",
    });
    mocks.stripePaymentIntentRetrieve.mockResolvedValueOnce(
      requiresConfirmation,
    );
    mocks.stripePaymentIntentCancel.mockResolvedValueOnce({
      ...requiresConfirmation,
      status: "canceled",
    });
    fake.member.suspendedAt = NOW;
    const deletionAt = new Date(NOW.getTime() + 1_000);

    await expect(closeHostedUsageCreditPurchasesForAccountDeletion({
      memberIds: [MEMBER_ID],
      now: deletionAt,
    })).resolves.toBeUndefined();

    expect(mocks.stripePaymentIntentRetrieve).toHaveBeenCalledWith(
      "pi_saved_card_123",
      { expand: ["latest_charge"] },
    );
    expect(mocks.stripePaymentIntentCancel).toHaveBeenCalledWith(
      "pi_saved_card_123",
      { cancellation_reason: "abandoned" },
      {
        idempotencyKey:
          `${buildHostedUsageCreditSavedCardIdempotencyKey(fixture.refill.id)}:cancel`,
      },
    );
    expect(fixture.refill).toMatchObject({
      lastReconciledAt: deletionAt,
      status: "expired",
      terminalAt: deletionAt,
    });
    await expect(assertHostedUsageCreditPurchasesReadyForAccountDeletionTx({
      memberIds: [MEMBER_ID],
      now: new Date(deletionAt.getTime() + 1_000),
      prisma: fake.prisma as never,
    })).resolves.toBeUndefined();
  });

  it("recovers a crash after Stripe canceled the bound direct payment", async () => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    const fixture = installAutomaticGroupRefillFixture(fake, {
      status: "payment_pending",
    });
    const requiresConfirmation = buildSavedCardPaymentIntent({
      amount: 500,
      amountReceived: 0,
      latestCharge: null,
      purchaseId: fixture.refill.id,
      status: "requires_confirmation",
    });
    const canceled = {
      ...requiresConfirmation,
      status: "canceled",
    };
    mocks.stripePaymentIntentRetrieve
      .mockResolvedValueOnce(requiresConfirmation)
      .mockResolvedValueOnce(canceled);
    mocks.stripePaymentIntentCancel.mockRejectedValueOnce(
      new Error("response lost after cancellation"),
    );
    fake.member.suspendedAt = NOW;

    await expect(closeHostedUsageCreditPurchasesForAccountDeletion({
      memberIds: [MEMBER_ID],
      now: new Date(NOW.getTime() + 1_000),
    })).resolves.toBeUndefined();

    expect(mocks.stripePaymentIntentRetrieve).toHaveBeenCalledTimes(2);
    expect(fixture.refill).toMatchObject({
      status: "expired",
    });
  });

  it.each([
    { amountReceived: 0, latestCharge: null, status: "processing" },
    {
      amountReceived: 500,
      latestCharge: "ch_refill_account_deletion",
      status: "succeeded",
    },
  ])("does not cancel a provider-$status direct payment", async (providerState) => {
    const fake = createFakePrisma();
    mocks.getPrisma.mockReturnValue(fake.prisma);
    const fixture = installAutomaticGroupRefillFixture(fake, {
      status: "payment_pending",
    });
    mocks.stripePaymentIntentRetrieve.mockResolvedValueOnce(
      buildSavedCardPaymentIntent({
        amount: 500,
        amountReceived: providerState.amountReceived,
        latestCharge: providerState.latestCharge,
        purchaseId: fixture.refill.id,
        status: providerState.status,
      }),
    );
    fake.member.suspendedAt = NOW;

    await expect(closeHostedUsageCreditPurchasesForAccountDeletion({
      memberIds: [MEMBER_ID],
      now: new Date(NOW.getTime() + 1_000),
    })).rejects.toMatchObject({
      code: "ACCOUNT_DELETION_USAGE_CREDIT_PAYMENT_PENDING",
      retryable: true,
    });

    expect(mocks.stripePaymentIntentCancel).not.toHaveBeenCalled();
    expect(fixture.refill).toMatchObject({
      status: "payment_pending",
    });
  });

  it("expires a bound open Session before permitting local deletion", async () => {
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
      status: "expired",
    });
    await expect(assertHostedUsageCreditPurchasesReadyForAccountDeletionTx({
      memberIds: [MEMBER_ID],
    })).resolves.toBeUndefined();
  });

  it("replays an unresolved created purchase with its derived request and stable key before expiring it", async () => {
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
      now: new Date(NOW.getTime() + 60_000),
    });

    expect(mocks.stripeCheckoutCreate).toHaveBeenCalledTimes(2);
    expect(mocks.stripeCheckoutCreate.mock.calls[1]).toEqual(
      mocks.stripeCheckoutCreate.mock.calls[0],
    );
    expect(mocks.stripePriceRetrieve).toHaveBeenCalledTimes(1);
    expect(purchase).toMatchObject({
      lastReconciledAt: new Date(NOW.getTime() + 60_000),
      status: "expired",
    });
  });

  it("replays and verifies a locally expired created purchase before treating it as terminal", async () => {
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
      lastReconciledAt: deletionAt,
      status: "expired",
      stripeCheckoutSessionLookupKey: expect.any(String),
    });
    await expect(assertHostedUsageCreditPurchasesReadyForAccountDeletionTx({
      memberIds: [MEMBER_ID],
    })).resolves.toBeUndefined();
  });

  it("accepts provider-proven absence after an unbound purchase expires", async () => {
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
      status: "expired",
    });
  });

  it("blocks deletion when Stripe cannot prove a bound Session is no longer open", async () => {
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
  it("projects a created purchase as reconciliation without provider I/O", async () => {
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
      restartAt: (purchase.checkoutExpiresAt as Date).toISOString(),
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

  it("does not reveal a payer's purchase for another beneficiary", async () => {
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
      beneficiaryMemberId: "member_other_beneficiary",
      payerMemberId: MEMBER_ID,
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

function stubStripeAlertEmailDelivery() {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv(
    "HOSTED_LINQ_ALERT_EMAIL_FROM",
    "Murph Alerts <alerts@example.com>",
  );
  vi.stubEnv("HOSTED_LINQ_ALERT_EMAILS", "operator@example.com");
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(
    JSON.stringify({ id: "email_usage_credit_failure" }),
    {
      headers: { "Content-Type": "application/json" },
      status: 200,
    },
  ));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function buildStripeConnectionError(requestId: string) {
  return Object.assign(new Error("Stripe API unavailable"), {
    code: "api_connection_error",
    rawType: "api_connection_error",
    requestId,
    statusCode: 503,
    type: "StripeConnectionError",
  });
}

function buildStripeConnectionErrorWithoutRequestId() {
  return Object.assign(new Error("Stripe API unavailable"), {
    code: "api_connection_error",
    rawType: "api_connection_error",
    statusCode: 503,
    type: "StripeConnectionError",
  });
}

async function runOnlyScheduledStripeAlert(): Promise<void> {
  expect(nextServerMocks.after).toHaveBeenCalledTimes(1);
  const task = nextServerMocks.after.mock.calls[0]?.[0];
  expect(task).toBeTypeOf("function");
  await task?.();
}

function readResendRequestBody(
  fetchMock: ReturnType<typeof stubStripeAlertEmailDelivery>,
): { subject: string; text: string } {
  const request = fetchMock.mock.calls[0];
  return JSON.parse(String(request?.[1]?.body)) as {
    subject: string;
    text: string;
  };
}

function readResendIdempotencyKey(
  fetchMock: ReturnType<typeof stubStripeAlertEmailDelivery>,
  callIndex: number,
): string | null {
  return new Headers(fetchMock.mock.calls[callIndex]?.[1]?.headers)
    .get("Idempotency-Key");
}

function clearStripeProviderMockHistory(): void {
  mocks.stripeCheckoutCreate.mockClear();
  mocks.stripeCheckoutExpire.mockClear();
  mocks.stripeCheckoutList.mockClear();
  mocks.stripeCheckoutRetrieve.mockClear();
  mocks.stripeCustomerRetrieve.mockClear();
  mocks.stripePaymentIntentCancel.mockClear();
  mocks.stripePaymentIntentConfirm.mockClear();
  mocks.stripePaymentIntentCreate.mockClear();
  mocks.stripePaymentIntentRetrieve.mockClear();
  mocks.stripePaymentMethodsList.mockClear();
  mocks.stripePriceRetrieve.mockClear();
  mocks.stripeSubscriptionsList.mockClear();
}

function expectNoStripeProviderIo(): void {
  expect(mocks.stripeCheckoutCreate).not.toHaveBeenCalled();
  expect(mocks.stripeCheckoutExpire).not.toHaveBeenCalled();
  expect(mocks.stripeCheckoutList).not.toHaveBeenCalled();
  expect(mocks.stripeCheckoutRetrieve).not.toHaveBeenCalled();
  expect(mocks.stripeCustomerRetrieve).not.toHaveBeenCalled();
  expect(mocks.stripePaymentIntentCancel).not.toHaveBeenCalled();
  expect(mocks.stripePaymentIntentConfirm).not.toHaveBeenCalled();
  expect(mocks.stripePaymentIntentCreate).not.toHaveBeenCalled();
  expect(mocks.stripePaymentIntentRetrieve).not.toHaveBeenCalled();
  expect(mocks.stripePaymentMethodsList).not.toHaveBeenCalled();
  expect(mocks.stripePriceRetrieve).not.toHaveBeenCalled();
  expect(mocks.stripeSubscriptionsList).not.toHaveBeenCalled();
}

function mockCanonicalSavedCard(customerId = "cus_group_payer"): void {
  mocks.stripeCustomerRetrieve.mockResolvedValueOnce({
    id: customerId,
    invoice_settings: { default_payment_method: "pm_saved_card_123" },
    livemode: false,
    object: "customer",
  });
  mocks.stripePaymentMethodsList.mockResolvedValueOnce({
    data: [{
      allow_redisplay: "always",
      customer: customerId,
      id: "pm_saved_card_123",
      livemode: false,
      object: "payment_method",
      type: "card",
    }],
    has_more: false,
    object: "list",
    url: "/v1/payment_methods",
  });
}

function buildSavedCardPaymentIntent(input: {
  amount?: number;
  amountReceived: number;
  customerId?: string;
  latestCharge: string | null;
  purchaseId: string;
  status: string;
}) {
  return {
    amount: input.amount ?? 1_000,
    amount_received: input.amountReceived,
    currency: "usd",
    customer: input.customerId ?? "cus_group_payer",
    id: "pi_saved_card_123",
    latest_charge: input.latestCharge,
    livemode: false,
    metadata: {
      policyVersion: "hosted-usage-credit-checkout-v4",
      purchaseId: input.purchaseId,
      purpose: "hosted_usage_credit_saved_card",
    },
    object: "payment_intent",
    status: input.status,
  };
}

function installAutomaticGroupRefillFixture(
  fake: ReturnType<typeof createFakePrisma>,
  input: {
    status?: "created" | "payment_failed" | "payment_pending";
  } = {},
) {
  const authorizationId = "hgsa_abcdefghijklmnop";
  const beneficiaryMemberId = "member_group_runtime";
  const periodStartedAt = new Date("2026-07-30T12:00:00.000Z");
  const periodEndsAt = new Date("2026-08-30T12:00:00.000Z");
  const authorization = {
    anchorDay: 30,
    anchorEndOfMonth: false,
    beneficiaryMemberId,
    canceledAt: null,
    createdAt: periodStartedAt,
    id: authorizationId,
    monthlyCapMinor: 1_000,
    payerMemberId: MEMBER_ID,
    pendingMonthlyCapMinor: null,
    periodEndsAt,
    periodStartedAt,
    recoveryStartedAt: null,
    status: "active",
    updatedAt: periodStartedAt,
  };
  fake.sponsorshipAuthorizations.set(authorizationId, authorization);
  const common = {
    beneficiaryMemberId,
    cashAmountMinor: 500,
    cashCurrency: "usd",
    checkoutCancelUrl: "https://join.example.test/groups/fund/example",
    checkoutExpiresAt: periodEndsAt,
    checkoutRequestPolicyVersion: "hosted-usage-credit-checkout-v4",
    checkoutSuccessUrl: "https://join.example.test/groups/fund/example",
    createdAt: periodStartedAt,
    grantUsdMicros: 5_000_000n,
    groupSponsorshipAuthorizationId: authorizationId,
    groupSponsorshipPeriodStartedAt: periodStartedAt,
    offerCode: "usage_5_usd",
    payerMemberId: MEMBER_ID,
    reconciliationVersion: 0n,
    remainingCreditUsdMicros: 0n,
    stripeChargeIdEncrypted: null,
    stripeChargeLookupKey: null,
    stripeCheckoutSessionIdEncrypted: null,
    stripeCheckoutSessionLookupKey: null,
    stripeCheckoutUrlEncrypted: null,
    stripeCustomerIdEncrypted: "sealed:cus_group_payer",
    stripeCustomerLookupKey: "customer:cus_group_payer",
    stripeLiveMode: false,
    stripePriceIdEncrypted: "sealed:price_usage_5",
    stripePriceLookupKey: "price:price_usage_5",
    terminalAt: null,
    updatedAt: periodStartedAt,
  };
  fake.purchases.set("hucp_activation_abcdefghijkl", {
    ...common,
    clientRequestKey: "group-sponsorship:activation",
    groupSponsorshipChargeOrdinal: 0,
    id: "hucp_activation_abcdefghijkl",
    lastReconciledAt: periodStartedAt,
    paidAt: periodStartedAt,
    remainingCreditUsdMicros: 5_000_000n,
    status: "fulfilled",
    stripeChargeIdEncrypted: "sealed:ch_activation",
    stripeChargeLookupKey: "billing:ch_activation",
    stripePaymentIntentIdEncrypted: "sealed:pi_activation",
    stripePaymentIntentLookupKey: "billing:pi_activation",
    terminalAt: periodStartedAt,
  });
  const refill = {
    ...common,
    clientRequestKey: "group-sponsorship:period:1",
    groupSponsorshipChargeOrdinal: 1,
    id: "hucp_refill_abcdefghijklmnop",
    lastReconciledAt: null,
    paidAt: null,
    status: input.status ?? "created",
    stripePaymentIntentIdEncrypted: input.status === "payment_pending"
      ? "encrypted:pi_saved_card_123"
      : null,
    stripePaymentIntentLookupKey: input.status === "payment_pending"
      ? "billing:pi_saved_card_123"
      : null,
  };
  fake.purchases.set(refill.id, refill);
  return {
    authority: {
      authorizationId,
      beneficiaryMemberId,
      chargeOrdinal: 1,
      mode: "automatic" as const,
      periodStartedAt,
    },
    refill,
  };
}

function installRecoverableAutomaticGroupRefillFixture(
  fake: ReturnType<typeof createFakePrisma>,
  input: { capacityHealthy?: boolean } = {},
) {
  const fixture = installAutomaticGroupRefillFixture(fake, {
    status: "payment_failed",
  });
  const authorization = fake.sponsorshipAuthorizations.get(
    fixture.authority.authorizationId,
  );
  expect(authorization).toBeDefined();
  Object.assign(authorization!, {
    recoveryStartedAt: NOW,
    status: "recovery_required",
  });
  fixture.refill.checkoutCancelUrl =
    "https://join.example.test/groups/fund/group_join_code_1234?usageCheckout=cancel&usagePurchase=hucp_activation_abcdefghijkl";
  fixture.refill.checkoutSuccessUrl =
    "https://join.example.test/groups/fund/group_join_code_1234?usageCheckout=success&usagePurchase=hucp_activation_abcdefghijkl";
  fixture.refill.stripeCustomerIdEncrypted = "encrypted:cus_group_payer";
  fixture.refill.stripePriceIdEncrypted = "encrypted:price_usage_5";
  Object.assign(fixture.refill, { terminalAt: NOW });
  mocks.readHostedAiUsageGate.mockResolvedValueOnce({
    allowanceSource: "thread_container",
    allowed: input.capacityHealthy ?? false,
    limitUsdMicros: 5_000_000n,
    reason: input.capacityHealthy ? null : "ai_usage_limit_exceeded",
    remainingUsdMicros: input.capacityHealthy ? 5_000_000n : 0n,
  });
  return fixture;
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
    price_usage_20: 2_000,
    price_usage_25: 2_500,
  };
  return buildStripePrice({
    id: priceId,
    unit_amount: amountByPriceId[priceId] ?? -1,
  });
}

function buildStripeSessionFromPurchase(purchase: Record<string, unknown>) {
  const purchaseId = String(purchase.id);
  return {
    adaptive_pricing: { enabled: false },
    client_reference_id: purchaseId,
    customer: "cus_123",
    expires_at: Math.floor((purchase.checkoutExpiresAt as Date).getTime() / 1_000),
    id: "cs_test_usage_credit_123",
    livemode: false,
    metadata: {
      policyVersion: String(purchase.checkoutRequestPolicyVersion),
      purchaseId,
      purpose: "hosted_usage_credit",
    },
    mode: "payment",
    payment_status: "unpaid",
    status: "open",
    url: "https://checkout.stripe.test/session",
  };
}

function createFakePrisma(input: {
  createdCheckoutRequestPolicyVersion?: "hosted-usage-credit-checkout-v3";
  customizationAuthorized?: boolean;
  groupFundingTargetLocked?: boolean;
  memberOverride?: Record<string, unknown>;
  occupiedUsageCreditSlotCount?: number | (() => number);
  usageCreditEvents?: string[];
} = {}) {
  const groupFundingQueryCalls: Array<{
    queryParts: TemplateStringsArray;
    values: unknown[];
  }> = [];
  const usageCreditBeneficiaryLockQueryCalls: Array<{
    queryParts: TemplateStringsArray;
    values: unknown[];
  }> = [];
  const usageCreditCapacityQueryCalls: Array<{
    queryParts: TemplateStringsArray;
    values: unknown[];
  }> = [];
  const purchases = new Map<string, Record<string, unknown>>();
  const sponsorshipAuthorizations = new Map<string, Record<string, unknown>>();
  const sponsorshipMoments = new Map<string, Record<string, unknown>>();
  const hostedUsageCreditPurchase = {
    aggregate: vi.fn(async (query: PurchaseQuery) => ({
      _sum: {
        cashAmountMinor: [...purchases.values()]
          .filter((candidate) => matchesPurchaseWhere(candidate, query.where))
          .reduce((sum, candidate) =>
            sum + Number(candidate.cashAmountMinor ?? 0), 0),
      },
    })),
    create: vi.fn(async (query: { data: Record<string, unknown> }) => {
      input.usageCreditEvents?.push("purchase-create");
      const record: Record<string, unknown> = {
        grantSlotReleasedAt: null,
        lastReconciledAt: null,
        paidAt: null,
        reconciliationVersion: 0n,
        remainingCreditUsdMicros: 0n,
        groupSponsorshipAuthorizationId: null,
        groupSponsorshipChargeOrdinal: null,
        groupSponsorshipPeriodStartedAt: null,
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
        ...(input.createdCheckoutRequestPolicyVersion
          ? {
              checkoutRequestPolicyVersion:
                input.createdCheckoutRequestPolicyVersion,
            }
          : {}),
      };
      purchases.set(String(record.id), record);
      return record;
    }),
    findFirst: vi.fn(async (query: PurchaseQuery) => {
      const record = [...purchases.values()].find((candidate) =>
        matchesPurchaseWhere(candidate, query.where)
      ) ?? null;
      const projected = projectFakeRecord(record, query.select);
      return projected && query.include?.payer
        ? {
            ...projected,
            payer: { suspendedAt: member.suspendedAt },
          }
        : projected;
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
  const hostedGroupSponsorshipMoment = {
    create: vi.fn(async (query: { data: Record<string, unknown> }) => {
      sponsorshipMoments.set(String(query.data.purchaseId), query.data);
      return query.data;
    }),
    findUnique: vi.fn(async (query: {
      select?: Record<string, boolean>;
      where: { purchaseId: string };
    }) =>
      projectFakeRecord(
        sponsorshipMoments.get(query.where.purchaseId) ?? null,
        query.select,
      )),
  };
  const prisma = {
    hostedGroupSponsorshipAuthorization: {
      create: vi.fn(async (query: { data: Record<string, unknown> }) => {
        const record: Record<string, unknown> = {
          canceledAt: null,
          pendingMonthlyCapMinor: null,
          recoveryStartedAt: null,
          ...query.data,
        };
        sponsorshipAuthorizations.set(String(record.id), record);
        return record;
      }),
      findFirst: vi.fn(async (query: {
        where: Record<string, unknown>;
      }) =>
        [...sponsorshipAuthorizations.values()].find((authorization) =>
          matchesPurchaseWhere(authorization, query.where)
        ) ?? null),
      findUnique: vi.fn(async (query: {
        select?: Record<string, boolean>;
        where: { id: string };
      }) => projectFakeRecord(
        sponsorshipAuthorizations.get(query.where.id) ?? null,
        query.select,
      )),
      updateMany: vi.fn(async (query: {
        data: Record<string, unknown>;
        where: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const authorization of sponsorshipAuthorizations.values()) {
          if (!matchesPurchaseWhere(authorization, query.where)) {
            continue;
          }
          Object.assign(authorization, query.data);
          count += 1;
        }
        return { count };
      }),
    },
    hostedGroupSponsorshipMoment,
    hostedMember,
    hostedGroup: {
      findUnique: vi.fn(async () => ({ runtimeMemberId: "member_group_runtime" })),
    },
    hostedThreadContainer: {
      findFirst: vi.fn(async () =>
        input.customizationAuthorized === false
          ? null
          : { memberId: "member_group_runtime" }
      ),
    },
    hostedUsageCreditPurchase,
    $queryRaw: vi.fn(async (
      queryParts: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      const sql = queryParts.join("?");
      if (
        sql.includes('FROM "hosted_member"')
        && sql.includes('COALESCE("usage_credit_balance_usd_micros", 0)')
        && sql.includes("FOR UPDATE")
      ) {
        input.usageCreditEvents?.push("beneficiary-lock");
        usageCreditBeneficiaryLockQueryCalls.push({ queryParts, values });
        return [{
          balanceUsdMicros: 0n,
          beneficiaryMemberId: String(values[0]),
          ledgerVersion: 0n,
        }];
      }
      if (sql.includes("bounded_occupied_slots")) {
        input.usageCreditEvents?.push("capacity-read");
        usageCreditCapacityQueryCalls.push({ queryParts, values });
        return [{
          expectedPurchaseOwnsReservation: false,
          occupiedSlotCount:
            typeof input.occupiedUsageCreditSlotCount === "function"
              ? input.occupiedUsageCreditSlotCount()
              : input.occupiedUsageCreditSlotCount ?? 0,
        }];
      }
      groupFundingQueryCalls.push({ queryParts, values });
      return input.groupFundingTargetLocked === false
        ? []
        : [{ id: "hgrp_123" }];
    }),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (
    callback: (tx: typeof prisma) => Promise<unknown>,
  ) => callback(prisma));

  return {
    groupFundingQueryCalls,
    member,
    prisma,
    purchases,
    sponsorshipAuthorizations,
    sponsorshipMoments,
    usageCreditBeneficiaryLockQueryCalls,
    usageCreditCapacityQueryCalls,
  };
}

interface PurchaseQuery {
  include?: Record<string, unknown>;
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
    if (isFakeRecord(expected) && expected.gt instanceof Date) {
      return record[key] instanceof Date && record[key].getTime() > expected.gt.getTime();
    }
    if (isFakeRecord(expected) && typeof expected.gt === "number") {
      return typeof record[key] === "number" && record[key] > expected.gt;
    }
    if (expected instanceof Date) {
      return record[key] instanceof Date &&
        record[key].getTime() === expected.getTime();
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
