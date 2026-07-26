import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  handleHostedOnboardingLinqWebhook: vi.fn(),
  handleHostedOnboardingLinqWebhookWithVisibleSecondaryOutcomes: vi.fn(),
  handleHostedOnboardingTelegramWebhook: vi.fn(),
  handleHostedOnboardingTelegramWebhookWithVisibleAccess: vi.fn(),
  handleHostedOnboardingTelegramWebhookWithVisibleOutcomes: vi.fn(),
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");

  return {
    ...actual,
    after: mocks.after,
  };
});

vi.mock("@/src/lib/hosted-onboarding/visible-access-webhooks", () => ({
  handleHostedOnboardingTelegramWebhookWithVisibleAccess:
    mocks.handleHostedOnboardingTelegramWebhookWithVisibleAccess,
}));

vi.mock("@/src/lib/hosted-onboarding/visible-secondary-webhooks", () => ({
  withHostedVisibleSecondaryLinqOutcomes: vi.fn(
    () => mocks.handleHostedOnboardingLinqWebhookWithVisibleSecondaryOutcomes,
  ),
  withHostedVisibleSecondaryTelegramOutcomes: vi.fn(
    () => mocks.handleHostedOnboardingTelegramWebhookWithVisibleOutcomes,
  ),
}));

vi.mock("@/src/lib/hosted-onboarding/webhook-service", () => ({
  handleHostedOnboardingLinqWebhook: mocks.handleHostedOnboardingLinqWebhook,
  handleHostedOnboardingTelegramWebhook:
    mocks.handleHostedOnboardingTelegramWebhook,
}));

type LinqRoute = typeof import(
  "../app/api/hosted-onboarding/linq/webhook/route"
);
type TelegramRoute = typeof import(
  "../app/api/hosted-onboarding/telegram/webhook/route"
);

let linqRoute: LinqRoute;
let telegramRoute: TelegramRoute;

describe("visible access webhook route wiring", () => {
  beforeAll(async () => {
    [linqRoute, telegramRoute] = await Promise.all([
      import("../app/api/hosted-onboarding/linq/webhook/route"),
      import("../app/api/hosted-onboarding/telegram/webhook/route"),
    ]);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "telegram-secret");
    mocks.after.mockImplementation((callback: () => void) => callback());
    mocks.handleHostedOnboardingLinqWebhook.mockResolvedValue({
      ok: true,
    });
    mocks.handleHostedOnboardingLinqWebhookWithVisibleSecondaryOutcomes.mockImplementation(
      (input) => mocks.handleHostedOnboardingLinqWebhook(input),
    );
    mocks.handleHostedOnboardingTelegramWebhookWithVisibleAccess.mockResolvedValue({
      ok: true,
    });
    mocks.handleHostedOnboardingTelegramWebhookWithVisibleOutcomes.mockImplementation(
      (input) => mocks.handleHostedOnboardingTelegramWebhookWithVisibleAccess(input),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps Linq ingress on the composed canonical owner", async () => {
    const rawBody = JSON.stringify({ ok: true });
    const response = await linqRoute.POST(
      new Request(
        "https://join.example.test/api/hosted-onboarding/linq/webhook",
        {
          body: rawBody,
          method: "POST",
        },
      ),
    );

    expect(response.status).toBe(202);
    expect(
      mocks.handleHostedOnboardingLinqWebhookWithVisibleSecondaryOutcomes,
    ).toHaveBeenCalledWith({
      rawBody,
      scheduleAfterResponse: expect.any(Function),
      signature: null,
      timestamp: null,
    });
    expect(mocks.handleHostedOnboardingLinqWebhook).toHaveBeenCalledWith({
      rawBody,
      scheduleAfterResponse: expect.any(Function),
      signature: null,
      timestamp: null,
    });
  });

  it("routes Telegram ingress through the composed visible-outcomes owner", async () => {
    const rawBody = JSON.stringify({ ok: true });
    const request = new Request(
      "https://join.example.test/api/hosted-onboarding/telegram/webhook",
      {
        body: rawBody,
        headers: {
          "x-telegram-bot-api-secret-token": "telegram-secret",
        },
        method: "POST",
      },
    );
    const response = await telegramRoute.POST(request);

    expect(response.status).toBe(202);
    expect(
      mocks.handleHostedOnboardingTelegramWebhookWithVisibleOutcomes,
    ).toHaveBeenCalledWith({
      rawBody,
      scheduleAfterResponse: expect.any(Function),
      secretToken: "telegram-secret",
      signal: request.signal,
    });
    expect(
      mocks.handleHostedOnboardingTelegramWebhookWithVisibleAccess,
    ).toHaveBeenCalledWith({
      rawBody,
      scheduleAfterResponse: expect.any(Function),
      secretToken: "telegram-secret",
      signal: request.signal,
    });
    expect(mocks.handleHostedOnboardingTelegramWebhook).not.toHaveBeenCalled();
  });
});
