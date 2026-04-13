import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  assertHostedOnboardingMutationOrigin: vi.fn(),
  createHostedBillingCheckout: vi.fn(),
  preProvisionManagedUserCryptoInHostedExecutionBestEffort: vi.fn(),
  scheduleManagedUserCryptoWarmupBestEffort: vi.fn(),
  requireHostedInviteCodeFromRequest: vi.fn(),
  requirePrivyMemberAuth: vi.fn(),
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");

  return {
    ...actual,
    after: mocks.after,
  };
});

vi.mock("@/src/lib/hosted-execution/control", () => ({
  preProvisionManagedUserCryptoInHostedExecutionBestEffort:
    mocks.preProvisionManagedUserCryptoInHostedExecutionBestEffort,
  scheduleManagedUserCryptoWarmupBestEffort:
    mocks.scheduleManagedUserCryptoWarmupBestEffort,
}));

vi.mock("@/src/lib/hosted-onboarding/billing-service", () => ({
  createHostedBillingCheckout: mocks.createHostedBillingCheckout,
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
    mocks.after.mockImplementation((callback: () => void | Promise<void>) => {
      const result = callback();

      if (result && typeof (result as Promise<void>).catch === "function") {
        void (result as Promise<void>).catch(() => {});
      }
    });
    mocks.assertHostedOnboardingMutationOrigin.mockReturnValue(undefined);
    mocks.createHostedBillingCheckout.mockResolvedValue({
      alreadyActive: false,
      url: "https://stripe.example.test/checkout",
    });
    mocks.preProvisionManagedUserCryptoInHostedExecutionBestEffort.mockResolvedValue(true);
    mocks.scheduleManagedUserCryptoWarmupBestEffort.mockImplementation(
      (input: {
        schedule: (callback: () => Promise<void> | void) => void;
        trigger: string;
        userId: string;
      }) => {
        const { schedule, ...warmupInput } = input;
        try {
          schedule(() =>
            mocks.preProvisionManagedUserCryptoInHostedExecutionBestEffort(warmupInput),
          );
          return "after";
        } catch (error) {
          console.error(
            `Hosted managed user crypto warmup scheduling failed during ${warmupInput.trigger}. Falling back to inline dispatch.`,
            error instanceof Error ? error.message : String(error),
          );
          void mocks.preProvisionManagedUserCryptoInHostedExecutionBestEffort(warmupInput);
          return "fallback-inline";
        }
      },
    );
    mocks.requireHostedInviteCodeFromRequest.mockResolvedValue({
      body: {
        shareCode: "share_123",
      },
      inviteCode: "invite_123",
    });
    mocks.requirePrivyMemberAuth.mockResolvedValue({
      member: {
        id: "member_123",
      },
    });
  });

  it("returns the checkout session and warms hosted crypto in the background", async () => {
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
    expect(mocks.createHostedBillingCheckout).toHaveBeenCalledWith({
      inviteCode: "invite_123",
      member: {
        id: "member_123",
      },
      shareCode: "share_123",
    });
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.preProvisionManagedUserCryptoInHostedExecutionBestEffort).toHaveBeenCalledWith({
      trigger: "billing-checkout-route",
      userId: "member_123",
    });
  });

  it("skips the background warmup when the hosted member is already active", async () => {
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
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.preProvisionManagedUserCryptoInHostedExecutionBestEffort).not.toHaveBeenCalled();
  });

  it("keeps the checkout response successful when after scheduling throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.after.mockImplementation(() => {
      throw new TypeError("after unavailable");
    });

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
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.preProvisionManagedUserCryptoInHostedExecutionBestEffort).toHaveBeenCalledWith({
      trigger: "billing-checkout-route",
      userId: "member_123",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "Hosted managed user crypto warmup scheduling failed during billing-checkout-route. Falling back to inline dispatch.",
      "after unavailable",
    );
  });
});
