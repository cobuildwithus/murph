import { beforeEach, expect, test, vi } from "vitest";

import { makeSafeStripePortalConfiguration } from "./support/stripe-portal";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  getPrisma: vi.fn(),
  readHostedAccountGroupStripeBillingRef: vi.fn(),
  readHostedFamilyOwnerSnapshotForMember: vi.fn(),
  readHostedMemberStripeBillingRef: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  requireHostedStripeApi: vi.fn(),
  resolveHostedStripePortalConfigurationId: vi.fn(),
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

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  readHostedAccountGroupStripeBillingRef: mocks.readHostedAccountGroupStripeBillingRef,
  readHostedFamilyOwnerSnapshotForMember: mocks.readHostedFamilyOwnerSnapshotForMember,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedStripeApi: mocks.requireHostedStripeApi,
  resolveHostedStripePortalConfigurationId:
    mocks.resolveHostedStripePortalConfigurationId,
}));

type BillingPortalRouteModule = typeof import("../app/api/settings/billing/portal/route");

let billingPortalRoute: BillingPortalRouteModule;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
  mocks.getPrisma.mockReturnValue({} as never);
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
      configurations: {
        retrieve: vi.fn(async (configurationId: string) =>
          makeSafeStripePortalConfiguration({
            configurationId,
          })
        ),
      },
      sessions: {
        create: vi.fn().mockResolvedValue({
          id: "bps_123",
          url: "https://stripe.example.test/portal/session_123",
        }),
      },
    },
  });
  mocks.resolveHostedStripePortalConfigurationId.mockImplementation(
    (kind: "family" | "member") =>
      kind === "family" ? "bpc_family" : "bpc_member",
  );

  billingPortalRoute = await import("../app/api/settings/billing/portal/route");
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
  expect(mocks.resolveHostedStripePortalConfigurationId).toHaveBeenCalledWith(
    "member",
  );
  expect(
    mocks.requireHostedStripeApi().billingPortal.configurations.retrieve,
  ).toHaveBeenCalledWith("bpc_member");
  expect(mocks.requireHostedStripeApi().billingPortal.sessions.create).toHaveBeenCalledWith({
    configuration: "bpc_member",
    customer: "cus_123",
    return_url: "https://join.example.test/settings",
  });
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
  expect(mocks.resolveHostedStripePortalConfigurationId).toHaveBeenCalledWith(
    "family",
  );
  expect(
    mocks.requireHostedStripeApi().billingPortal.configurations.retrieve,
  ).toHaveBeenCalledWith("bpc_family");
  expect(mocks.requireHostedStripeApi().billingPortal.sessions.create).toHaveBeenCalledWith({
    configuration: "bpc_family",
    customer: "cus_family_123",
    return_url: "https://join.example.test/settings",
  });
});

test("omits an explicit portal configuration only when the resolver permits fallback", async () => {
  mocks.resolveHostedStripePortalConfigurationId.mockReturnValueOnce(undefined);

  const response = await billingPortalRoute.POST(
    new Request("https://join.example.test/api/settings/billing/portal", {
      headers: {
        origin: "https://join.example.test",
      },
      method: "POST",
    }),
  );

  expect(response.status).toBe(200);
  expect(mocks.requireHostedStripeApi().billingPortal.sessions.create).toHaveBeenCalledWith({
    customer: "cus_123",
    return_url: "https://join.example.test/settings",
  });
});

test("keeps billing self-serve available for canceled members with a stored Stripe customer", async () => {
  mocks.requireHostedAppSessionFromRequest.mockResolvedValueOnce({
    member: {
      billingStatus: "canceled",
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
