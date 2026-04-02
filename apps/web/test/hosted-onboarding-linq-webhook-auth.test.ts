import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe as baseDescribe, expect, it, vi } from "vitest";

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: () => ({
    encryptionKeyVersion: "v1",
    inviteTtlHours: 24,
    isProduction: false,
    linqApiBaseUrl: "https://linq.example.test",
    linqApiToken: "linq-token",
    linqWebhookSecret: process.env.LINQ_WEBHOOK_SECRET ?? null,
    linqWebhookTimestampToleranceMs: Number(process.env.LINQ_WEBHOOK_TIMESTAMP_TOLERANCE_MS ?? 5 * 60_000),
    publicBaseUrl: "https://join.example.test",
    stripeBillingMode: "payment",
    stripePriceId: "price_123",
    stripeSecretKey: "sk_test_123",
    stripeWebhookSecret: "whsec_123",
    telegramBotUsername: null,
    telegramWebhookSecret: null,
  }),
}));

import { handleHostedOnboardingLinqWebhook } from "@/src/lib/hosted-onboarding/webhook-service";

const describe = baseDescribe.sequential;

describe("handleHostedOnboardingLinqWebhook auth", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    delete process.env.LINQ_WEBHOOK_SECRET;
    delete process.env.LINQ_WEBHOOK_TIMESTAMP_TOLERANCE_MS;
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

  it("rejects stale hosted webhook timestamps before journaling", async () => {
    process.env.LINQ_WEBHOOK_SECRET = "linq-secret";
    process.env.LINQ_WEBHOOK_TIMESTAMP_TOLERANCE_MS = "60000";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-25T10:10:00.000Z"));
    const rawBody = JSON.stringify({
      api_version: "v1",
      created_at: "2026-03-28T12:00:00.000Z",
      data: {
        chat_id: "chat_123",
        from: "+15551234567",
        is_from_me: false,
        message: {
          id: "msg_123",
          parts: [],
        },
      },
      event_id: "evt_stale",
      event_type: "message.received",
    });
    const timestamp = "1711360800";

    await expect(handleHostedOnboardingLinqWebhook({
      rawBody,
      signature: signLinqWebhook("linq-secret", rawBody, timestamp),
      timestamp,
    })).rejects.toMatchObject({
      code: "LINQ_SIGNATURE_INVALID",
      httpStatus: 401,
      message: "Linq webhook timestamp is outside the allowed tolerance window.",
    });
  });
});

function signLinqWebhook(secret: string, payload: string, timestamp: string): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  return `sha256=${signature}`;
}
