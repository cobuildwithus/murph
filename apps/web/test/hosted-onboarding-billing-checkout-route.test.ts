import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  assertHostedLaunchRequiredConsentGranted: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  createHostedBillingCheckout: vi.fn(),
  getPrisma: vi.fn(),
  requireHostedAppSessionFromRequest: vi.fn(),
  requireHostedInviteCodeFromRequest: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/billing-service", () => ({
  createHostedBillingCheckout: mocks.createHostedBillingCheckout,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedLaunchRequiredConsentGranted: mocks.assertHostedLaunchRequiredConsentGranted,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/csrf", () => ({
  assertHostedOnboardingMutationOrigin: mocks.assertHostedOnboardingMutationOrigin,
}));

vi.mock("@/src/lib/hosted-onboarding/app-session", () => ({
  requireHostedAppSessionFromRequest: mocks.requireHostedAppSessionFromRequest,
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
    vi.stubEnv("HOSTED_ACCOUNT_DELETION_MAINTENANCE", "");
    vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
    mocks.assertHostedLaunchRequiredConsentGranted.mockResolvedValue(undefined);
    mocks.createHostedBillingCheckout.mockResolvedValue({
      alreadyActive: false,
      url: "https://stripe.example.test/checkout",
    });
    mocks.getPrisma.mockReturnValue({ prisma: true });
    mocks.requireHostedInviteCodeFromRequest.mockResolvedValue({
      body: {},
      inviteCode: "invite_123",
    });
    mocks.requireHostedAppSessionFromRequest.mockResolvedValue({
      member: {
        id: "member_123",
        suspendedAt: null,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects maintenance before reading the authenticated session", async () => {
    vi.stubEnv("HOSTED_ACCOUNT_DELETION_MAINTENANCE", "1");

    const response = await billingCheckoutRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/billing/checkout", {
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "subscription_checkout_maintenance",
        retryable: true,
      },
    });
    expect(mocks.requireHostedAppSessionFromRequest).not.toHaveBeenCalled();
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(mocks.createHostedBillingCheckout).not.toHaveBeenCalled();
  });

  it("returns the checkout session", async () => {
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
      alreadyActive: false,
      url: "https://stripe.example.test/checkout",
    });
    expect(mocks.requireHostedAppSessionFromRequest).toHaveBeenCalledWith(expect.any(Request));
    expect(mocks.createHostedBillingCheckout).toHaveBeenCalledWith({
      inviteCode: "invite_123",
      member: {
        id: "member_123",
        suspendedAt: null,
      },
    });
    expect(mocks.assertHostedLaunchRequiredConsentGranted).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: { prisma: true },
    });
    expect(mocks.requireHostedAppSessionFromRequest.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.assertHostedLaunchRequiredConsentGranted.mock.invocationCallOrder[0] ?? 0);
    expect(mocks.assertHostedLaunchRequiredConsentGranted.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.createHostedBillingCheckout.mock.invocationCallOrder[0] ?? 0);
  });

  it("forwards the public Pulse Trial checkout offer", async () => {
    mocks.requireHostedInviteCodeFromRequest.mockResolvedValueOnce({
      body: {
        checkoutOffer: "pulse_trial_7d",
        inviteCode: "invite_123",
      },
      inviteCode: "invite_123",
    });

    const response = await billingCheckoutRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/billing/checkout", {
        body: JSON.stringify({
          checkoutOffer: "pulse_trial_7d",
          inviteCode: "invite_123",
        }),
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.createHostedBillingCheckout).toHaveBeenCalledWith({
      checkoutOffer: "pulse_trial_7d",
      inviteCode: "invite_123",
      member: {
        id: "member_123",
        suspendedAt: null,
      },
    });
  });

  it("rejects unsupported checkout offers instead of forwarding them", async () => {
    mocks.requireHostedInviteCodeFromRequest.mockResolvedValueOnce({
      body: {
        checkoutOffer: "standard",
        inviteCode: "invite_123",
      },
      inviteCode: "invite_123",
    });

    const response = await billingCheckoutRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/billing/checkout", {
        body: JSON.stringify({
          checkoutOffer: "standard",
          inviteCode: "invite_123",
        }),
        headers: {
          origin: "https://join.example.test",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_BILLING_CHECKOUT_OFFER_INVALID",
        message: "checkoutOffer must be pulse_trial_7d when present.",
        retryable: false,
      },
    });
    expect(mocks.createHostedBillingCheckout).not.toHaveBeenCalled();
  });

  it("rejects checkout before launch legal consent is current", async () => {
    mocks.assertHostedLaunchRequiredConsentGranted.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_CONSENT_REQUIRED",
        httpStatus: 403,
        message: "Accept the current Murph legal consent before continuing.",
      }),
    );

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

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_CONSENT_REQUIRED",
        message: "Accept the current Murph legal consent before continuing.",
        retryable: false,
      },
    });
    expect(mocks.createHostedBillingCheckout).not.toHaveBeenCalled();
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
