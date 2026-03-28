import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    encryptionKeyVersion: "v1",
    inviteTtlHours: 24,
    isProduction: false,
    linqApiBaseUrl: "https://linq.example.test",
    linqApiToken: "linq-token",
    linqWebhookSecret: process.env.LINQ_WEBHOOK_SECRET ?? null,
    publicBaseUrl: "https://join.example.test",
    sessionCookieName: "hosted_session",
    sessionTtlDays: 30,
    stripeBillingMode: "payment",
    stripePriceId: "price_123",
    stripeSecretKey: "sk_test_123",
    stripeWebhookSecret: "whsec_123",
    telegramBotUsername: null,
    telegramWebhookSecret: null,
  }),
}));

import { handleHostedOnboardingLinqWebhook } from "@/src/lib/hosted-onboarding/webhook-service";

describe("handleHostedOnboardingLinqWebhook auth", () => {
  beforeEach(() => {
    delete process.env.LINQ_WEBHOOK_SECRET;
  });

  it("fails closed when LINQ_WEBHOOK_SECRET is unset", async () => {
    await expect(handleHostedOnboardingLinqWebhook({
      rawBody: JSON.stringify({
        api_version: "v1",
        created_at: "2026-03-28T12:00:00.000Z",
        data: {},
        event_id: "evt_missing_secret",
        event_type: "message.received",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toMatchObject({
      code: "LINQ_WEBHOOK_SECRET_MISSING",
      httpStatus: 500,
    });
  });

  it("rejects unsigned hosted webhook requests when a secret is configured", async () => {
    process.env.LINQ_WEBHOOK_SECRET = "linq-secret";

    await expect(handleHostedOnboardingLinqWebhook({
      rawBody: JSON.stringify({
        api_version: "v1",
        created_at: "2026-03-28T12:00:00.000Z",
        data: {},
        event_id: "evt_missing_headers",
        event_type: "message.received",
      }),
      signature: null,
      timestamp: null,
    })).rejects.toMatchObject({
      code: "LINQ_SIGNATURE_REQUIRED",
      httpStatus: 401,
    });
  });

  it("rejects hosted webhook requests with invalid signatures when signature headers are present", async () => {
    process.env.LINQ_WEBHOOK_SECRET = "linq-secret";

    await expect(handleHostedOnboardingLinqWebhook({
      rawBody: JSON.stringify({
        api_version: "v1",
        created_at: "2026-03-28T12:00:00.000Z",
        data: {},
        event_id: "evt_invalid_signature",
        event_type: "message.received",
      }),
      signature: "sha256=deadbeef",
      timestamp: "1711278000",
    })).rejects.toMatchObject({
      code: "LINQ_SIGNATURE_INVALID",
      httpStatus: 401,
    });
  });
});
