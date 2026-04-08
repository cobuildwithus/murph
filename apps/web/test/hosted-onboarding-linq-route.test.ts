import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  handleHostedOnboardingLinqWebhook: vi.fn(),
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");

  return {
    ...actual,
    after: mocks.after,
  };
});

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
    mocks.after.mockImplementation((callback: () => void) => callback());
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
      defer: expect.any(Function),
      rawBody: JSON.stringify({
        ok: true,
      }),
      signature: "sha256=test",
      signal: request.signal,
      timestamp: "1711278000",
    });
  });

  it("maps in-progress receipt retries to a retryable 503 response", async () => {
    mocks.handleHostedOnboardingLinqWebhook.mockRejectedValue(
      hostedOnboardingError({
        code: "WEBHOOK_RECEIPT_IN_PROGRESS",
        httpStatus: 503,
        message: "Hosted webhook receipt is already being processed.",
        retryable: true,
      }),
    );

    const response = await hostedOnboardingLinqRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/linq/webhook", {
        method: "POST",
        body: JSON.stringify({ ok: true }),
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "WEBHOOK_RECEIPT_IN_PROGRESS",
        message: "Hosted webhook receipt is already being processed.",
        retryable: true,
      },
    });
  });
});
