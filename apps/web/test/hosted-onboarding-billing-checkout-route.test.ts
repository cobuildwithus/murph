import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertHostedOnboardingMutationOrigin: vi.fn(),
  completeHostedPrivyVerification: vi.fn(),
  createHostedBillingCheckout: vi.fn(),
  requireHostedInviteCodeFromRequest: vi.fn(),
  requirePrivyMemberAuth: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/billing-service", () => ({
  createHostedBillingCheckout: mocks.createHostedBillingCheckout,
}));

vi.mock("@/src/lib/hosted-onboarding/member-service", () => ({
  completeHostedPrivyVerification: mocks.completeHostedPrivyVerification,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requirePrivyMemberAuth: mocks.requirePrivyMemberAuth,
}));

vi.mock("@/src/lib/hosted-onboarding/route-helpers", () => ({
  requireHostedInviteCodeFromRequest: mocks.requireHostedInviteCodeFromRequest,
}));

type BillingCheckoutRouteModule = typeof import("../app/api/hosted-onboarding/billing/checkout/route");

let billingCheckoutRoute: BillingCheckoutRouteModule;

describe("hosted onboarding billing checkout route", () => {
  beforeAll(async () => {
    billingCheckoutRoute = await import("../app/api/hosted-onboarding/billing/checkout/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
    mocks.createHostedBillingCheckout.mockResolvedValue({
      alreadyActive: false,
      url: "https://stripe.example.test/checkout",
    });
    mocks.completeHostedPrivyVerification.mockResolvedValue({
      inviteCode: "invite_123",
      joinUrl: "https://join.example.test/join/invite_123",
      memberId: "member_123",
      messagingSetupRequired: false,
      stage: "checkout",
    });
    mocks.requireHostedInviteCodeFromRequest.mockResolvedValue({
      body: {
        shareCode: "share_123",
      },
      inviteCode: "invite_123",
    });
    mocks.requirePrivyMemberAuth.mockResolvedValue({
      linkedAccounts: [
        {
          address: "member@example.test",
          type: "email",
          verified_at: 1_710_000_000,
        },
      ],
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
      member: {
        id: "member_123",
        suspendedAt: null,
      },
      verifiedPrivyUser: {
        id: "did:privy:member_123",
      },
    });
  });

  it("returns the checkout session", async () => {
    const response = await billingCheckoutRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/billing/checkout", {
        body: JSON.stringify({
          inviteCode: "invite_123",
          shareCode: "share_123",
        }),
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      alreadyActive: false,
      url: "https://stripe.example.test/checkout",
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
      inviteCode: "invite_123",
      verifiedPrivyUser: {
        id: "did:privy:member_123",
      },
    });
    expect(mocks.createHostedBillingCheckout).toHaveBeenCalledWith({
      inviteCode: "invite_123",
      linkedAccounts: [
        {
          address: "member@example.test",
          type: "email",
          verified_at: 1_710_000_000,
        },
      ],
      member: {
        id: "member_123",
        suspendedAt: null,
      },
      shareCode: "share_123",
    });
    expect(mocks.completeHostedPrivyVerification.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.createHostedBillingCheckout.mock.invocationCallOrder[0] ?? 0);
  });

  it("returns the already-active checkout payload when the hosted member is already active", async () => {
    mocks.createHostedBillingCheckout.mockResolvedValueOnce({
      alreadyActive: true,
      url: null,
    });

    const response = await billingCheckoutRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/billing/checkout", {
        body: JSON.stringify({
          inviteCode: "invite_123",
        }),
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      alreadyActive: true,
      url: null,
    });
  });
});
