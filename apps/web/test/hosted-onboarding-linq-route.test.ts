import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  deriveHostedOnboardingTimingErrorName: vi.fn(() => "Error"),
  finishHostedOnboardingTiming: vi.fn(),
  handleHostedOnboardingLinqWebhook: vi.fn(),
  startHostedOnboardingTiming: vi.fn((step: string, baseDetails: Record<string, unknown> = {}) => ({
    baseDetails,
    startedAtMs: 0,
    step,
  })),
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

vi.mock("@/src/lib/hosted-onboarding/logging", async () => {
  const actual = await vi.importActual<typeof import("@/src/lib/hosted-onboarding/logging")>(
    "@/src/lib/hosted-onboarding/logging",
  );

  return {
    ...actual,
    deriveHostedOnboardingTimingErrorName: mocks.deriveHostedOnboardingTimingErrorName,
    finishHostedOnboardingTiming: mocks.finishHostedOnboardingTiming,
    startHostedOnboardingTiming: mocks.startHostedOnboardingTiming,
  };
});

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

  it("does not expose a public GET health handler", () => {
    expect(hostedOnboardingLinqRoute).not.toHaveProperty("GET");
  });

  it("does not bind durable Linq webhook handling to the public request abort signal", async () => {
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
      scheduleAfterResponse: expect.any(Function),
      signature: "sha256=test",
      timestamp: "1711278000",
    });
    expect(mocks.startHostedOnboardingTiming).toHaveBeenCalledWith(
      "hosted-onboarding.route.linq-webhook",
      expect.objectContaining({
        signaturePresent: true,
        signalAbortedAtStart: false,
        timestampPresent: true,
      }),
    );
    expect(mocks.startHostedOnboardingTiming).toHaveBeenCalledWith(
      "hosted-onboarding.route.linq-webhook.read-body",
      expect.objectContaining({
        signalAbortedAtStart: false,
      }),
    );
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "hosted-onboarding.route.linq-webhook.read-body",
      }),
      "completed",
      expect.objectContaining({
        rawBodyBytes: JSON.stringify({ ok: true }).length,
        signalAbortedAfterRead: false,
      }),
    );
    expect(mocks.finishHostedOnboardingTiming).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "hosted-onboarding.route.linq-webhook",
      }),
      "completed",
      expect.objectContaining({
        duplicate: false,
        rawBodyBytes: JSON.stringify({ ok: true }).length,
        reason: null,
        signalAbortedBeforeReturn: false,
      }),
    );
  });

  it("routes scheduled Linq webhook follow-up work through Next after", async () => {
    let scheduled = false;
    mocks.handleHostedOnboardingLinqWebhook.mockImplementationOnce((input: {
      scheduleAfterResponse?: (task: () => Promise<void>) => void;
    }) => {
      input.scheduleAfterResponse?.(() => {
        scheduled = true;
        return Promise.resolve();
      });

      return Promise.resolve({
        ok: true,
        reason: "wake-appended-active-member",
      });
    });

    const response = await hostedOnboardingLinqRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/linq/webhook", {
        method: "POST",
        body: JSON.stringify({ ok: true }),
      }),
    );

    expect(response.status).toBe(202);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(scheduled).toBe(true);
  });

  it("falls back to fire-and-forget scheduled follow-up work when Next after throws", async () => {
    let scheduled = false;
    mocks.after.mockImplementationOnce(() => {
      throw new Error("after unavailable");
    });
    mocks.handleHostedOnboardingLinqWebhook.mockImplementationOnce((input: {
      scheduleAfterResponse?: (task: () => Promise<void>) => void;
    }) => {
      input.scheduleAfterResponse?.(() => {
        scheduled = true;
        return Promise.resolve();
      });

      return Promise.resolve({
        ok: true,
        reason: "wake-appended-active-member",
      });
    });

    const response = await hostedOnboardingLinqRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/linq/webhook", {
        method: "POST",
        body: JSON.stringify({ ok: true }),
      }),
    );

    expect(response.status).toBe(202);
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(scheduled).toBe(true);
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

  it("rejects oversized webhook bodies before invoking the Linq service", async () => {
    const response = await hostedOnboardingLinqRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/linq/webhook", {
        body: "x".repeat((256 * 1024) + 1),
        headers: {
          "content-length": String((256 * 1024) + 1),
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    expect(mocks.handleHostedOnboardingLinqWebhook).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "LINQ_WEBHOOK_BODY_TOO_LARGE",
        message: "Linq webhook body is too large.",
        retryable: false,
      },
    });
  });

  it("rejects streamed oversized webhook bodies without a declared content length", async () => {
    const response = await hostedOnboardingLinqRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/linq/webhook", {
        body: "x".repeat((256 * 1024) + 1),
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    expect(mocks.handleHostedOnboardingLinqWebhook).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "LINQ_WEBHOOK_BODY_TOO_LARGE",
        message: "Linq webhook body is too large.",
        retryable: false,
      },
    });
  });
});
