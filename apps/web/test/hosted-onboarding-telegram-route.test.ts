import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  handleHostedOnboardingTelegramWebhook: vi.fn(),
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");

  return {
    ...actual,
    after: mocks.after,
  };
});

vi.mock("@/src/lib/hosted-onboarding/webhook-service", () => ({
  handleHostedOnboardingTelegramWebhook: mocks.handleHostedOnboardingTelegramWebhook,
}));

type HostedOnboardingTelegramRouteModule = typeof import("../app/api/hosted-onboarding/telegram/webhook/route");

let hostedOnboardingTelegramRoute: HostedOnboardingTelegramRouteModule;

describe("hosted onboarding Telegram webhook route", () => {
  beforeAll(async () => {
    hostedOnboardingTelegramRoute = await import("../app/api/hosted-onboarding/telegram/webhook/route");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.after.mockImplementation((callback: () => void) => callback());
    mocks.handleHostedOnboardingTelegramWebhook.mockResolvedValue({
      ok: true,
    });
  });

  it("forwards the public request signal into the hosted Telegram webhook service", async () => {
    const request = new Request("https://join.example.test/api/hosted-onboarding/telegram/webhook", {
      method: "POST",
      body: JSON.stringify({
        ok: true,
      }),
      headers: {
        "x-telegram-bot-api-secret-token": "telegram-secret",
      },
    });

    const response = await hostedOnboardingTelegramRoute.POST(request);

    expect(response.status).toBe(202);
    expect(mocks.handleHostedOnboardingTelegramWebhook).toHaveBeenCalledWith({
      rawBody: JSON.stringify({
        ok: true,
      }),
      secretToken: "telegram-secret",
      signal: request.signal,
    });
  });

  it("maps in-progress receipt retries to a retryable 503 response", async () => {
    mocks.handleHostedOnboardingTelegramWebhook.mockRejectedValue(
      hostedOnboardingError({
        code: "WEBHOOK_RECEIPT_IN_PROGRESS",
        httpStatus: 503,
        message: "Hosted webhook receipt is already being processed.",
        retryable: true,
      }),
    );

    const response = await hostedOnboardingTelegramRoute.POST(
      new Request("https://join.example.test/api/hosted-onboarding/telegram/webhook", {
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
