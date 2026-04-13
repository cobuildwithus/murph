import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  reconcileHostedBillingCheckoutSuccess: vi.fn(),
  requirePrivyMemberAuth: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/billing-success-service", () => ({
  reconcileHostedBillingCheckoutSuccess: mocks.reconcileHostedBillingCheckoutSuccess,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requirePrivyMemberAuth: mocks.requirePrivyMemberAuth,
}));

type BillingSuccessRouteModule = typeof import("../app/api/hosted-onboarding/billing/success/route");

let billingSuccessRoute: BillingSuccessRouteModule;

describe("hosted onboarding billing success route", () => {
  beforeAll(async () => {
    billingSuccessRoute = await import("../app/api/hosted-onboarding/billing/success/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
    mocks.requirePrivyMemberAuth.mockResolvedValue({
      member: {
        id: "member_123",
      },
    });
    mocks.reconcileHostedBillingCheckoutSuccess.mockResolvedValue({
      activationPending: true,
      capabilities: {
        billingReady: true,
        phoneAuthReady: true,
      },
      invite: {
        code: "invite-code",
        expiresAt: "2026-03-27T12:00:00.000Z",
        phoneHint: "+1 415 555 2671",
      },
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "active",
    });
  });

  it("reconciles the returned checkout session for the authenticated member", async () => {
    const response = await billingSuccessRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/billing/success", {
        body: JSON.stringify({
          inviteCode: "invite-code",
          sessionId: "cs_123",
        }),
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      activationPending: true,
      capabilities: {
        billingReady: true,
        phoneAuthReady: true,
      },
      invite: {
        code: "invite-code",
        expiresAt: "2026-03-27T12:00:00.000Z",
        phoneHint: "+1 415 555 2671",
      },
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "active",
    });
    expect(mocks.reconcileHostedBillingCheckoutSuccess).toHaveBeenCalledWith({
      inviteCode: "invite-code",
      member: {
        id: "member_123",
      },
      sessionId: "cs_123",
    });
  });
});
