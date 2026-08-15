import type Stripe from "stripe";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

type BillingPortalSessionCreateArguments = Parameters<
  Stripe["billingPortal"]["sessions"]["create"]
>;

const mocks = vi.hoisted(() => ({
  assertNoHostedDirectSubscriptionStripeEffectTx: vi.fn(),
  assertNoHostedFamilyStripeEffectTx: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  getPrisma: vi.fn(),
  readHostedAccountGroupStripeBillingRef: vi.fn(),
  readHostedFamilyOwnerSnapshotForMember: vi.fn(),
  readHostedMemberStripeBillingRef: vi.fn(),
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
  assertNoHostedDirectSubscriptionStripeEffectTx:
    mocks.assertNoHostedDirectSubscriptionStripeEffectTx,
  readHostedMemberStripeBillingRef: mocks.readHostedMemberStripeBillingRef,
  withHostedMemberStripeMutationLock: mocks.withHostedMemberStripeMutationLock,
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  assertNoHostedFamilyStripeEffectTx: mocks.assertNoHostedFamilyStripeEffectTx,
  readHostedAccountGroupStripeBillingRef: mocks.readHostedAccountGroupStripeBillingRef,
  readHostedFamilyOwnerSnapshotForMember: mocks.readHostedFamilyOwnerSnapshotForMember,
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
  delete process.env.HOSTED_ONBOARDING_STRIPE_FAMILY_PORTAL_CONFIGURATION_ID;
  mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
  const prisma = {};
  mocks.getPrisma.mockReturnValue(prisma as never);
  mocks.withHostedMemberStripeMutationLock.mockImplementation(
    async (input: { run: (tx: unknown) => Promise<unknown> }) => input.run(prisma),
  );
  mocks.assertNoHostedDirectSubscriptionStripeEffectTx.mockResolvedValue(undefined);
  mocks.assertNoHostedFamilyStripeEffectTx.mockResolvedValue(undefined);
  mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
    member: {
      id: "member_123",
      suspendedAt: null,
    },
  });
  mocks.readHostedMemberStripeBillingRef.mockResolvedValue({
    memberId: "member_123",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
  });
  mocks.readHostedFamilyOwnerSnapshotForMember.mockResolvedValue({
    groupId: "hbag_123",
  });
  mocks.readHostedAccountGroupStripeBillingRef.mockResolvedValue({
    groupId: "hbag_123",
    stripeCustomerId: "cus_family_123",
    stripeSubscriptionId: "sub_family_123",
  });
  mocks.requireHostedStripeApi.mockReturnValue({
    billingPortal: {
      sessions: {
        create: mocks.stripeBillingPortalSessionCreate.mockResolvedValue({
          id: "bps_123",
          url: "https://stripe.example.test/portal/session_123",
        }),
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
  expect(mocks.readHostedMemberStripeBillingRef).toHaveBeenCalledWith({
    memberId: "member_123",
    prisma: expect.any(Object),
  });
  expect(mocks.stripeBillingPortalSessionCreate).toHaveBeenCalledWith({
    customer: "cus_123",
    return_url: "https://join.example.test/settings",
  });
  expect(mocks.withHostedMemberStripeMutationLock).toHaveBeenCalledTimes(2);
  expect(mocks.assertNoHostedDirectSubscriptionStripeEffectTx).toHaveBeenCalledTimes(2);
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
  expect(mocks.readHostedFamilyOwnerSnapshotForMember).toHaveBeenCalledWith({
    memberId: "member_123",
    prisma: expect.any(Object),
  });
  expect(mocks.readHostedAccountGroupStripeBillingRef).toHaveBeenCalledWith({
    groupId: "hbag_123",
    prisma: expect.any(Object),
  });
  expect(mocks.readHostedMemberStripeBillingRef).not.toHaveBeenCalled();
  expect(mocks.stripeBillingPortalSessionCreate).toHaveBeenCalledWith({
    customer: "cus_family_123",
    return_url: "https://join.example.test/settings",
  });
  expect(mocks.assertNoHostedFamilyStripeEffectTx).toHaveBeenCalledTimes(2);
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
    mocks.assertNoHostedFamilyStripeEffectTx.mockRejectedValueOnce(rejection);
  } else {
    mocks.assertNoHostedDirectSubscriptionStripeEffectTx.mockRejectedValueOnce(rejection);
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
  mocks.assertNoHostedDirectSubscriptionStripeEffectTx
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
  expect(mocks.assertNoHostedDirectSubscriptionStripeEffectTx).toHaveBeenCalledTimes(2);
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
  mocks.readHostedMemberStripeBillingRef.mockResolvedValueOnce({
    memberId: "member_123",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
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
