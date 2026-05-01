import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  completeHostedPrivyVerification: vi.fn(),
  reconcileHostedBillingCheckoutSuccess: vi.fn(),
  requirePrivyMemberAuth: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/billing-success-service", () => ({
  reconcileHostedBillingCheckoutSuccess: mocks.reconcileHostedBillingCheckoutSuccess,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-onboarding/member-service", () => ({
  completeHostedPrivyVerification: mocks.completeHostedPrivyVerification,
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
      identity: {
        email: {
          address: "member@example.test",
          verifiedAt: 1_710_000_000,
        },
        phone: null,
        telegram: null,
        userId: "did:privy:member_123",
        wallet: null,
      },
      linkedAccounts: [
        {
          address: "member@example.test",
          type: "email",
          verified_at: 1_710_000_000,
        },
      ],
      member: {
        id: "member_123",
      },
      verifiedPrivyUser: {
        id: "did:privy:member_123",
      },
    });
    mocks.completeHostedPrivyVerification.mockResolvedValue({
      inviteCode: "invite-code",
      joinUrl: "https://join.example.test/join/invite-code",
      memberId: "member_123",
      messagingSetupRequired: false,
      stage: "activating",
    });
    mocks.reconcileHostedBillingCheckoutSuccess.mockResolvedValue({
      activationPending: true,
      billing: {
        defaultPlanCode: "launch_monthly",
        plans: [],
      },
      capabilities: {
        billingReady: true,
        phoneAuthReady: true,
      },
      invite: {
        code: "invite-code",
        expiresAt: "2026-03-27T12:00:00.000Z",
        phoneAuthTarget: {
          kind: "saved",
          phoneHint: "+1 415 555 2671",
        },
        phoneHint: "+1 415 555 2671",
        verificationMode: "invite_phone",
      },
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "activating",
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
      billing: {
        defaultPlanCode: "launch_monthly",
        plans: [],
      },
      capabilities: {
        billingReady: true,
        phoneAuthReady: true,
      },
      invite: {
        code: "invite-code",
        expiresAt: "2026-03-27T12:00:00.000Z",
        phoneAuthTarget: {
          kind: "saved",
          phoneHint: "+1 415 555 2671",
        },
        phoneHint: "+1 415 555 2671",
        verificationMode: "invite_phone",
      },
      session: {
        authenticated: true,
        expiresAt: null,
        matchesInvite: true,
      },
      stage: "activating",
    });
    expect(mocks.completeHostedPrivyVerification).toHaveBeenCalledWith({
      identity: {
        email: {
          address: "member@example.test",
          verifiedAt: 1_710_000_000,
        },
        phone: null,
        telegram: null,
        userId: "did:privy:member_123",
        wallet: null,
      },
      inviteCode: "invite-code",
      verifiedPrivyUser: {
        id: "did:privy:member_123",
      },
    });
    expect(mocks.reconcileHostedBillingCheckoutSuccess).toHaveBeenCalledWith({
      inviteCode: "invite-code",
      linkedAccounts: [
        {
          address: "member@example.test",
          type: "email",
          verified_at: 1_710_000_000,
        },
      ],
      member: {
        id: "member_123",
      },
      sessionId: "cs_123",
    });
    expect(mocks.completeHostedPrivyVerification.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.reconcileHostedBillingCheckoutSuccess.mock.invocationCallOrder[0] ?? 0);
  });
});
