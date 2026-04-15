import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  handleHostedStripeWebhook: vi.fn(),
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");

  return {
    ...actual,
    after: mocks.after,
  };
});

vi.mock("@/src/lib/hosted-onboarding/webhook-service", () => ({
  handleHostedStripeWebhook: mocks.handleHostedStripeWebhook,
}));

type HostedOnboardingStripeRouteModule = typeof import("../app/api/hosted-onboarding/stripe/webhook/route");

let hostedOnboardingStripeRoute: HostedOnboardingStripeRouteModule;

describe("hosted onboarding Stripe webhook route", () => {
  beforeAll(async () => {
    hostedOnboardingStripeRoute = await import("../app/api/hosted-onboarding/stripe/webhook/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.after.mockImplementation((callback: () => void) => callback());
    mocks.handleHostedStripeWebhook.mockResolvedValue({
      ok: true,
      type: "invoice.paid",
    });
  });

  it("passes a deferred best-effort scheduler into the Stripe webhook service", async () => {
    const request = new Request("https://join.example.test/api/hosted-onboarding/stripe/webhook", {
      method: "POST",
      body: JSON.stringify({
        id: "evt_123",
      }),
      headers: {
        "stripe-signature": "sig_123",
      },
    });

    const response = await hostedOnboardingStripeRoute.POST(request);

    expect(response.status).toBe(200);
    expect(mocks.handleHostedStripeWebhook).toHaveBeenCalledWith({
      defer: expect.any(Function),
      rawBody: JSON.stringify({
        id: "evt_123",
      }),
      signature: "sig_123",
    });
  });
});
