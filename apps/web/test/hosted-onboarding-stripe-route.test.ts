import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleHostedStripeWebhook: vi.fn(),
}));

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
    mocks.handleHostedStripeWebhook.mockResolvedValue({
      ok: true,
      type: "invoice.paid",
    });
  });

  it("passes the verified payload into the Stripe webhook service inline", async () => {
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
      rawBody: JSON.stringify({
        id: "evt_123",
      }),
      signature: "sig_123",
    });
  });

  it("rejects oversized Stripe webhook bodies before calling the service", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const request = new Request("https://join.example.test/api/hosted-onboarding/stripe/webhook", {
        body: "{}",
        headers: {
          "content-length": String(1024 * 1024 + 1),
          "stripe-signature": "sig_123",
        },
        method: "POST",
      });

      const response = await hostedOnboardingStripeRoute.POST(request);

      expect(response.status).toBe(413);
      expect(mocks.handleHostedStripeWebhook).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "STRIPE_WEBHOOK_BODY_TOO_LARGE",
          message: "Stripe webhook body is too large.",
          retryable: false,
        },
      });
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("{}");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("waits for the Stripe webhook service before returning the response", async () => {
    let resolveWebhook!: (value: { ok: true; type: string }) => void;
    const webhookResult = new Promise<{ ok: true; type: string }>((resolve) => {
      resolveWebhook = resolve;
    });

    mocks.handleHostedStripeWebhook.mockReturnValueOnce(webhookResult);

    const request = new Request("https://join.example.test/api/hosted-onboarding/stripe/webhook", {
      method: "POST",
      body: JSON.stringify({
        id: "evt_123",
      }),
      headers: {
        "stripe-signature": "sig_123",
      },
    });

    let settled = false;
    const responsePromise = hostedOnboardingStripeRoute.POST(request).then((response) => {
      settled = true;
      return response;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    resolveWebhook({
      ok: true,
      type: "invoice.paid",
    });

    await expect(responsePromise).resolves.toMatchObject({
      status: 200,
    });
  });
});
