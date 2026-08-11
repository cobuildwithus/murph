import { beforeEach, expect, test, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  abandonHostedFamilyDraftForOwner: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  getPrisma: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
}));

vi.mock("@/src/lib/hosted-onboarding/family-plan", () => ({
  abandonHostedFamilyDraftForOwner: mocks.abandonHostedFamilyDraftForOwner,
}));

type BillingFamilyDraftRouteModule =
  typeof import("../app/api/settings/billing/family/draft/claim/route");

let billingFamilyDraftRoute: BillingFamilyDraftRouteModule;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.assertHostedOnboardingMutationOrigin.mockImplementation(() => {});
  mocks.getPrisma.mockReturnValue({ label: "prisma" });
  mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
    member: {
      billingStatus: "active",
      id: "member_owner",
      suspendedAt: null,
    },
  });
  mocks.abandonHostedFamilyDraftForOwner.mockResolvedValue({ abandoned: true });

  billingFamilyDraftRoute = await import(
    "../app/api/settings/billing/family/draft/claim/route"
  );
});

test("abandons the authenticated owner's exact unpaid Family draft", async () => {
  const response = await billingFamilyDraftRoute.DELETE(
    new Request("https://join.example.test/api/settings/billing/family/draft/claim", {
      body: JSON.stringify({
        checkoutAttemptId: null,
        groupId: "hbag_rendered_draft",
      }),
      headers: { origin: "https://join.example.test" },
      method: "DELETE",
    }),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ abandoned: true });
  expect(mocks.abandonHostedFamilyDraftForOwner).toHaveBeenCalledWith({
    expectedDraftClaim: {
      checkoutAttemptId: null,
      groupId: "hbag_rendered_draft",
    },
    ownerMemberId: "member_owner",
    prisma: { label: "prisma" },
  });
});

test("rejects abandonment without the exact rendered draft claim", async () => {
  const response = await billingFamilyDraftRoute.DELETE(
    new Request("https://join.example.test/api/settings/billing/family/draft/claim", {
      headers: { origin: "https://join.example.test" },
      method: "DELETE",
    }),
  );

  expect(response.status).toBe(400);
  expect(mocks.abandonHostedFamilyDraftForOwner).not.toHaveBeenCalled();
});

test("rejects cross-origin draft abandonment before reading the session", async () => {
  mocks.assertHostedOnboardingMutationOrigin.mockImplementationOnce(() => {
    throw hostedOnboardingError({
      code: "HOSTED_ONBOARDING_ORIGIN_INVALID",
      httpStatus: 403,
      message: "Invalid request origin.",
    });
  });

  const response = await billingFamilyDraftRoute.DELETE(
    new Request("https://join.example.test/api/settings/billing/family/draft/claim", {
      headers: { origin: "https://other.example.test" },
      method: "DELETE",
    }),
  );

  expect(response.status).toBe(403);
  expect(mocks.requireHostedAppSessionFromRequest).not.toHaveBeenCalled();
  expect(mocks.abandonHostedFamilyDraftForOwner).not.toHaveBeenCalled();
});

test("rejects suspended owners before changing a Family draft", async () => {
  mocks.requireHostedAppSessionFromRequest.mockResolvedValueOnce({
    member: {
      billingStatus: "active",
      id: "member_owner",
      suspendedAt: new Date("2026-08-01T12:00:00.000Z"),
    },
  });

  const response = await billingFamilyDraftRoute.DELETE(
    new Request("https://join.example.test/api/settings/billing/family/draft/claim", {
      headers: { origin: "https://join.example.test" },
      method: "DELETE",
    }),
  );

  expect(response.status).toBe(403);
  expect(mocks.abandonHostedFamilyDraftForOwner).not.toHaveBeenCalled();
});

test("returns a recoverable conflict when Stripe billing wins the race", async () => {
  mocks.abandonHostedFamilyDraftForOwner.mockRejectedValueOnce(
    hostedOnboardingError({
      code: "HOSTED_FAMILY_DRAFT_BILLING_SYNCING",
      httpStatus: 409,
      message: "Family billing is still syncing.",
      retryable: true,
    }),
  );

  const response = await billingFamilyDraftRoute.DELETE(
    new Request("https://join.example.test/api/settings/billing/family/draft/claim", {
      body: JSON.stringify({
        checkoutAttemptId: "hbfca_rendered_bound",
        groupId: "hbag_rendered_bound",
      }),
      headers: { origin: "https://join.example.test" },
      method: "DELETE",
    }),
  );

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: "HOSTED_FAMILY_DRAFT_BILLING_SYNCING" },
  });
});
