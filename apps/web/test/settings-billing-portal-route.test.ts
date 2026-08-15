import type Stripe from "stripe";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

type BillingPortalSessionCreateArguments = Parameters<
  Stripe["billingPortal"]["sessions"]["create"]
>;

const mocks = vi.hoisted(() => ({
  assertNoHostedDirectSubscriptionStripeEffectByLookupKeyTx: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  decryptHostedWebNullableString: vi.fn(),
  getPrisma: vi.fn(),
  hostedAccountGroupFindUnique: vi.fn(),
  hostedMemberBillingRefFindUnique: vi.fn(),
  operationOrder: [] as string[],
  requireHostedAppSessionFromRequest: vi.fn(),
  requireHostedStripeApi: vi.fn(),
  stripeBillingPortalSessionCreate: vi.fn<
    (...args: BillingPortalSessionCreateArguments) => Promise<unknown>
  >(),
  withHostedMemberStripeMutationLock: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  assertNoHostedDirectSubscriptionStripeEffectByLookupKeyTx:
    mocks.assertNoHostedDirectSubscriptionStripeEffectByLookupKeyTx,
  assertHostedStripeEffectClaimAbsent: (claimId: string | null | undefined) => {
    if (claimId !== null && claimId !== undefined) {
      throw hostedOnboardingError({
        code: "HOSTED_STRIPE_EFFECT_PENDING",
        httpStatus: 409,
        message: "Billing is already changing.",
        retryable: true,
      });
    }
  },
  withHostedMemberStripeMutationLock: mocks.withHostedMemberStripeMutationLock,
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  HOSTED_ACCOUNT_GROUP_BILLING_STRIPE_CUSTOMER_FIELD:
    "hosted-account-group-billing-ref.stripe-customer-id",
}));

vi.mock("@/src/lib/hosted-onboarding/member-private-codecs", () => ({
  HOSTED_MEMBER_BILLING_STRIPE_CUSTOMER_FIELD:
    "hosted-member-billing-ref.stripe-customer-id",
}));

vi.mock("@/src/lib/hosted-web/encryption", () => ({
  decryptHostedWebNullableString: mocks.decryptHostedWebNullableString,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedStripeApi: mocks.requireHostedStripeApi,
}));

type BillingPortalRouteModule = typeof import("../app/api/settings/billing/portal/route");

let billingPortalRoute: BillingPortalRouteModule;
const originalFamilyPortalConfigurationId =
  process.env.HOSTED_ONBOARDING_STRIPE_FAMILY_PORTAL_CONFIGURATION_ID;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.operationOrder.splice(0);
  delete process.env.HOSTED_ONBOARDING_STRIPE_FAMILY_PORTAL_CONFIGURATION_ID;
  mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
  const prisma = {
    hostedAccountGroup: {
      findUnique: mocks.hostedAccountGroupFindUnique,
    },
    hostedMemberBillingRef: {
      findUnique: mocks.hostedMemberBillingRefFindUnique,
    },
  };
  mocks.getPrisma.mockReturnValue(prisma as never);
  mocks.withHostedMemberStripeMutationLock.mockImplementation(
    async (input: { run: (tx: unknown) => Promise<unknown> }) => {
      mocks.operationOrder.push("lock:start");
      try {
        return await input.run(prisma);
      } finally {
        mocks.operationOrder.push("lock:end");
      }
    },
  );
  mocks.assertNoHostedDirectSubscriptionStripeEffectByLookupKeyTx
    .mockImplementation(async () => {
      mocks.operationOrder.push("direct-claim-check");
    });
  mocks.decryptHostedWebNullableString.mockImplementation(async (input: {
    field: string;
    value: string | null;
  }) => {
    mocks.operationOrder.push("decrypt");
    if (input.value === null) {
      return null;
    }
    return input.field === "hosted-member-billing-ref.stripe-customer-id"
      ? "cus_123"
      : "cus_family_123";
  });
  mocks.hostedAccountGroupFindUnique.mockResolvedValue({
    billingRef: {
      stripeCustomerIdEncrypted: "encrypted:cus_family_123",
      stripeCustomerLookupKey: "lookup:cus_family_123",
      stripeEffectClaimId: null,
      stripeSubscriptionIdEncrypted: "encrypted:sub_family_123",
      stripeSubscriptionLookupKey: "lookup:sub_family_123",
    },
    id: "hbag_123",
    ownerMemberId: "member_123",
  });
  mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
    member: {
      id: "member_123",
      suspendedAt: null,
    },
  });
  mocks.hostedMemberBillingRefFindUnique.mockImplementation(async () => {
    mocks.operationOrder.push("member-read");
    return {
      stripeCustomerIdEncrypted: "encrypted:cus_123",
      stripeCustomerLookupKey: "lookup:cus_123",
      stripeEffectClaimId: null,
      stripeSubscriptionLookupKey: "lookup:sub_123",
    };
  });
  mocks.requireHostedStripeApi.mockReturnValue({
    billingPortal: {
      sessions: {
        create: mocks.stripeBillingPortalSessionCreate.mockImplementation(
          async () => {
            mocks.operationOrder.push("stripe");
            return {
              id: "bps_123",
              url: "https://stripe.example.test/portal/session_123",
            };
          },
        ),
      },
    },
  });

  billingPortalRoute = await import("../app/api/settings/billing/portal/route");
});

afterEach(() => {
  if (originalFamilyPortalConfigurationId === undefined) {
    delete process.env.HOSTED_ONBOARDING_STRIPE_FAMILY_PORTAL_CONFIGURATION_ID;
  } else {
    process.env.HOSTED_ONBOARDING_STRIPE_FAMILY_PORTAL_CONFIGURATION_ID =
      originalFamilyPortalConfigurationId;
  }
});

test("creates a Stripe billing portal session for an authenticated hosted member", async () => {
  const response = await billingPortalRoute.POST(
    new Request("https://join.example.test/api/settings/billing/portal", {
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    url: "https://stripe.example.test/portal/session_123",
  });
  expect(mocks.requireHostedAppSessionFromRequest).toHaveBeenCalledWith(expect.any(Request));
  expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(expect.any(Request));
  expect(mocks.hostedMemberBillingRefFindUnique).toHaveBeenCalledWith({
    select: {
      stripeCustomerIdEncrypted: true,
      stripeCustomerLookupKey: true,
      stripeEffectClaimId: true,
      stripeSubscriptionLookupKey: true,
    },
    where: { memberId: "member_123" },
  });
  expect(mocks.stripeBillingPortalSessionCreate).toHaveBeenCalledWith({
    customer: "cus_123",
    return_url: "https://join.example.test/settings",
  });
  expect(mocks.withHostedMemberStripeMutationLock).toHaveBeenCalledTimes(2);
  expect(
    mocks.assertNoHostedDirectSubscriptionStripeEffectByLookupKeyTx,
  ).toHaveBeenCalledTimes(2);
  expect(mocks.decryptHostedWebNullableString).toHaveBeenCalledOnce();
  expect(mocks.decryptHostedWebNullableString).toHaveBeenCalledWith({
    field: "hosted-member-billing-ref.stripe-customer-id",
    memberId: "member_123",
    prisma: expect.any(Object),
    value: "encrypted:cus_123",
  });
  expect(mocks.operationOrder).toEqual([
    "lock:start",
    "member-read",
    "direct-claim-check",
    "lock:end",
    "decrypt",
    "stripe",
    "lock:start",
    "member-read",
    "direct-claim-check",
    "lock:end",
  ]);
});

test("creates a Stripe billing portal session for a family owner group", async () => {
  const response = await billingPortalRoute.POST(
    new Request("https://join.example.test/api/settings/billing/portal", {
      body: JSON.stringify({
        billingScope: "family",
      }),
      headers: {
        "content-type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    url: "https://stripe.example.test/portal/session_123",
  });
  expect(mocks.hostedAccountGroupFindUnique).toHaveBeenCalledTimes(2);
  expect(mocks.hostedAccountGroupFindUnique).toHaveBeenCalledWith({
    select: {
      billingRef: {
        select: {
          stripeCustomerIdEncrypted: true,
          stripeCustomerLookupKey: true,
          stripeEffectClaimId: true,
          stripeSubscriptionIdEncrypted: true,
          stripeSubscriptionLookupKey: true,
        },
      },
      id: true,
      ownerMemberId: true,
    },
    where: { ownerMemberId: "member_123" },
  });
  expect(mocks.decryptHostedWebNullableString).toHaveBeenCalledOnce();
  expect(mocks.decryptHostedWebNullableString).toHaveBeenCalledWith({
    field: "hosted-account-group-billing-ref.stripe-customer-id",
    memberId: "member_123",
    prisma: expect.any(Object),
    value: "encrypted:cus_family_123",
  });
  expect(mocks.hostedMemberBillingRefFindUnique).not.toHaveBeenCalled();
  expect(mocks.stripeBillingPortalSessionCreate).toHaveBeenCalledWith({
    customer: "cus_family_123",
    return_url: "https://join.example.test/settings",
  });
});

test.each([
  { billingScope: undefined, guard: "member" as const },
  { billingScope: "family", guard: "family" as const },
])("does not create a $guard Portal session while its future effect owns billing", async ({
  billingScope,
  guard,
}) => {
  const rejection = hostedOnboardingError({
    code: "HOSTED_STRIPE_EFFECT_PENDING",
    httpStatus: 409,
    message: "Billing is already changing.",
    retryable: true,
  });
  if (guard === "family") {
    mocks.hostedAccountGroupFindUnique.mockResolvedValueOnce({
      billingRef: {
        stripeCustomerIdEncrypted: "encrypted:cus_family_123",
        stripeCustomerLookupKey: "lookup:cus_family_123",
        stripeEffectClaimId: "future-family-effect",
        stripeSubscriptionIdEncrypted: "encrypted:sub_family_123",
        stripeSubscriptionLookupKey: "lookup:sub_family_123",
      },
      id: "hbag_123",
      ownerMemberId: "member_123",
    });
  } else {
    mocks.assertNoHostedDirectSubscriptionStripeEffectByLookupKeyTx
      .mockRejectedValueOnce(rejection);
  }

  const response = await billingPortalRoute.POST(
    new Request("https://join.example.test/api/settings/billing/portal", {
      ...(billingScope
        ? {
            body: JSON.stringify({ billingScope }),
            headers: {
              "content-type": "application/json",
              origin: "https://join.example.test",
            },
          }
        : {
            headers: { origin: "https://join.example.test" },
          }),
      method: "POST",
    }),
  );

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_STRIPE_EFFECT_PENDING" },
  });
  expect(mocks.stripeBillingPortalSessionCreate).not.toHaveBeenCalled();
});

test("does not return a newly created Portal URL when a claim wins the final owner check", async () => {
  mocks.assertNoHostedDirectSubscriptionStripeEffectByLookupKeyTx
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(hostedOnboardingError({
      code: "HOSTED_STRIPE_EFFECT_PENDING",
      httpStatus: 409,
      message: "Billing is already changing.",
      retryable: true,
    }));

  const response = await billingPortalRoute.POST(
    new Request("https://join.example.test/api/settings/billing/portal", {
      headers: { origin: "https://join.example.test" },
      method: "POST",
    }),
  );

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_STRIPE_EFFECT_PENDING" },
  });
  expect(mocks.stripeBillingPortalSessionCreate).toHaveBeenCalledOnce();
  expect(
    mocks.assertNoHostedDirectSubscriptionStripeEffectByLookupKeyTx,
  ).toHaveBeenCalledTimes(2);
});

test("does not return or re-decrypt a Family Portal URL when a claim wins the final check", async () => {
  mocks.hostedAccountGroupFindUnique
    .mockResolvedValueOnce({
      billingRef: {
        stripeCustomerIdEncrypted: "encrypted:cus_family_123",
        stripeCustomerLookupKey: "lookup:cus_family_123",
        stripeEffectClaimId: null,
        stripeSubscriptionIdEncrypted: "encrypted:sub_family_123",
        stripeSubscriptionLookupKey: "lookup:sub_family_123",
      },
      id: "hbag_123",
      ownerMemberId: "member_123",
    })
    .mockResolvedValueOnce({
      billingRef: {
        stripeCustomerIdEncrypted: "encrypted:cus_family_123",
        stripeCustomerLookupKey: "lookup:cus_family_123",
        stripeEffectClaimId: "future-family-effect",
        stripeSubscriptionIdEncrypted: "encrypted:sub_family_123",
        stripeSubscriptionLookupKey: "lookup:sub_family_123",
      },
      id: "hbag_123",
      ownerMemberId: "member_123",
    });

  const response = await billingPortalRoute.POST(
    new Request("https://join.example.test/api/settings/billing/portal", {
      body: JSON.stringify({ billingScope: "family" }),
      headers: {
        "content-type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_STRIPE_EFFECT_PENDING" },
  });
  expect(mocks.stripeBillingPortalSessionCreate).toHaveBeenCalledOnce();
  expect(mocks.hostedAccountGroupFindUnique).toHaveBeenCalledTimes(2);
  expect(mocks.decryptHostedWebNullableString).toHaveBeenCalledOnce();
});

test("uses the dedicated Family portal configuration when configured", async () => {
  process.env.HOSTED_ONBOARDING_STRIPE_FAMILY_PORTAL_CONFIGURATION_ID = "bpc_family";

  const response = await billingPortalRoute.POST(
    new Request("https://join.example.test/api/settings/billing/portal", {
      body: JSON.stringify({
        billingScope: "family",
      }),
      headers: {
        "content-type": "application/json",
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(200);
  expect(mocks.stripeBillingPortalSessionCreate).toHaveBeenCalledWith({
    configuration: "bpc_family",
    customer: "cus_family_123",
    return_url: "https://join.example.test/settings",
  });
});

test.each([
  "paused",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
] as const)(
  "keeps billing self-serve available for %s members with stored Stripe billing",
  async (billingStatus) => {
    mocks.requireHostedAppSessionFromRequest.mockResolvedValueOnce({
      member: {
        billingStatus,
        id: "member_123",
        suspendedAt: null,
      },
    });

    const response = await billingPortalRoute.POST(
      new Request("https://join.example.test/api/settings/billing/portal", {
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: "https://stripe.example.test/portal/session_123",
    });
  },
);

test.each([
  { billingScope: undefined, customer: "cus_123", label: "personal" },
  { billingScope: "family", customer: "cus_family_123", label: "Family" },
] as const)(
  "keeps $label billing self-serve available after account suspension",
  async ({ billingScope, customer }) => {
    mocks.requireHostedAppSessionFromRequest.mockResolvedValueOnce({
      member: {
        id: "member_123",
        suspendedAt: new Date("2026-08-10T12:00:00.000Z"),
      },
    });

    const response = await billingPortalRoute.POST(
      new Request("https://join.example.test/api/settings/billing/portal", {
        ...(billingScope
          ? {
              body: JSON.stringify({ billingScope }),
              headers: {
                "content-type": "application/json",
                origin: "https://join.example.test",
              },
            }
          : {
              headers: {
                origin: "https://join.example.test",
              },
            }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.stripeBillingPortalSessionCreate).toHaveBeenCalledWith({
      customer,
      return_url: "https://join.example.test/settings",
    });
  },
);

test("fails closed when the hosted member has no stored Stripe customer", async () => {
  mocks.hostedMemberBillingRefFindUnique.mockResolvedValueOnce({
    stripeCustomerIdEncrypted: null,
    stripeCustomerLookupKey: null,
    stripeEffectClaimId: null,
    stripeSubscriptionLookupKey: null,
  });

  const response = await billingPortalRoute.POST(
    new Request("https://join.example.test/api/settings/billing/portal", {
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: {
      code: "STRIPE_CUSTOMER_NOT_READY",
    },
  });
});
