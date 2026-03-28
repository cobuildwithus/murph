import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleHostedOnboardingLinqWebhook: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-service", () => ({
  handleHostedOnboardingLinqWebhook: mocks.handleHostedOnboardingLinqWebhook,
}));

type HostedOnboardingLinqRouteModule = typeof import("../app/api/hosted-onboarding/linq/webhook/route");

let hostedOnboardingLinqRoute: HostedOnboardingLinqRouteModule;

describe("hosted onboarding Linq webhook route", () => {
  beforeAll(async () => {
    hostedOnboardingLinqRoute = await import("../app/api/hosted-onboarding/linq/webhook/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleHostedOnboardingLinqWebhook.mockResolvedValue({
      ok: true,
    });
  });

  it("forwards the public request signal into the hosted Linq webhook service", async () => {
    const request = new Request("https://join.example.test/api/hosted-onboarding/linq/webhook", {
      method: "POST",
      body: JSON.stringify({
        ok: true,
      }),
      headers: {
        "x-webhook-signature": "sha256=test",
        "x-webhook-timestamp": "1711278000",
      },
    });

    const response = await hostedOnboardingLinqRoute.POST(request);

    expect(response.status).toBe(202);
    expect(mocks.handleHostedOnboardingLinqWebhook).toHaveBeenCalledWith({
      rawBody: JSON.stringify({
        ok: true,
      }),
      signature: "sha256=test",
      signal: request.signal,
      timestamp: "1711278000",
    });
  });
});
