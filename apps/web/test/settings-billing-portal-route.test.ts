import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  getPrisma: vi.fn(),
  readHostedMemberStripeBillingRef: vi.fn(),
  requireHostedPrivyActiveRequestAuthContext: vi.fn(),
  requireHostedStripeApi: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-billing-store", () => ({
  readHostedMemberStripeBillingRef: mocks.readHostedMemberStripeBillingRef,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireHostedPrivyActiveRequestAuthContext: mocks.requireHostedPrivyActiveRequestAuthContext,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedStripeApi: mocks.requireHostedStripeApi,
}));

type BillingPortalRouteModule = typeof import("../app/api/settings/billing/portal/route");

let billingPortalRoute: BillingPortalRouteModule;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
  mocks.getPrisma.mockReturnValue({} as never);
  mocks.requireHostedPrivyActiveRequestAuthContext.mockResolvedValue({
    member: {
      id: "member_123",
    },
  });
  mocks.readHostedMemberStripeBillingRef.mockResolvedValue({
    memberId: "member_123",
    stripeCustomerId: "cus_123",
    stripeSubscriptionId: "sub_123",
  });
  mocks.requireHostedStripeApi.mockReturnValue({
    billingPortal: {
      sessions: {
        create: vi.fn().mockResolvedValue({
          id: "bps_123",
          url: "https://stripe.example.test/portal/session_123",
        }),
      },
    },
  });

  billingPortalRoute = await import("../app/api/settings/billing/portal/route");
});

test("creates a Stripe billing portal session for the active hosted member", async () => {
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
  expect(mocks.requireHostedPrivyActiveRequestAuthContext).toHaveBeenCalledWith(
    expect.any(Request),
    expect.any(Object),
  );
  expect(mocks.assertHostedOnboardingMutationOrigin).toHaveBeenCalledWith(expect.any(Request));
  expect(mocks.readHostedMemberStripeBillingRef).toHaveBeenCalledWith({
    memberId: "member_123",
    prisma: expect.any(Object),
  });
});

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
