import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  markHostedAiUsageStripeFailed: vi.fn(),
  listHostedAiUsagePendingStripeMetering: vi.fn(),
  markHostedAiUsageStripeMetered: vi.fn(),
  markHostedAiUsageStripeRetryableFailure: vi.fn(),
  markHostedAiUsageStripeSkipped: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/usage", () => ({
  markHostedAiUsageStripeFailed: mocks.markHostedAiUsageStripeFailed,
  listHostedAiUsagePendingStripeMetering: mocks.listHostedAiUsagePendingStripeMetering,
  markHostedAiUsageStripeMetered: mocks.markHostedAiUsageStripeMetered,
  markHostedAiUsageStripeRetryableFailure: mocks.markHostedAiUsageStripeRetryableFailure,
  markHostedAiUsageStripeSkipped: mocks.markHostedAiUsageStripeSkipped,
}));

import {
  drainHostedAiUsageStripeMetering,
  readHostedAiUsageStripeMeterEnvironment,
} from "@/src/lib/hosted-execution/stripe-metering";

describe("drainHostedAiUsageStripeMetering", () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HOSTED_AI_USAGE_STRIPE_METER_EVENT_NAME = "ai_total_tokens";
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ id: "mtr_evt_123" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      })) as typeof fetch;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it("returns unconfigured when Stripe metering env is absent", async () => {
    delete process.env.HOSTED_AI_USAGE_STRIPE_METER_EVENT_NAME;
    delete process.env.STRIPE_SECRET_KEY;

    const result = await drainHostedAiUsageStripeMetering();

    expect(result).toEqual({
      configured: false,
      failed: 0,
      metered: 0,
      skipped: 0,
    });
    expect(mocks.listHostedAiUsagePendingStripeMetering).not.toHaveBeenCalled();
  });

  it("skips non-platform-funded usage instead of sending a Stripe meter event", async () => {
    mocks.listHostedAiUsagePendingStripeMetering.mockResolvedValue([
      {
        apiKeyEnv: "OPENAI_API_KEY",
        credentialSource: "unknown",
        id: "usage_123",
        inputTokens: 10,
        memberId: "member_123",
        occurredAt: new Date("2026-03-29T12:00:00.000Z"),
        member: {
          stripeCustomerId: "cus_123",
        },
        outputTokens: 5,
        provider: "openai-compatible",
        requestedModel: "gpt-5.4-mini",
        stripeMeterStatus: "pending",
        totalTokens: 15,
      },
    ]);

    const result = await drainHostedAiUsageStripeMetering();

    expect(result).toEqual({
      configured: true,
      failed: 0,
      metered: 0,
      skipped: 1,
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mocks.markHostedAiUsageStripeSkipped).toHaveBeenCalledWith({
      id: "usage_123",
      message: "Skipped Stripe AI metering because the run did not use platform credentials.",
    });
  });

  it("sends platform total-token usage to Stripe with a deterministic identifier and original timestamp", async () => {
    mocks.listHostedAiUsagePendingStripeMetering.mockResolvedValue([
      {
        apiKeyEnv: null,
        credentialSource: "platform",
        id: "usage_abc",
        inputTokens: 120,
        memberId: "member_123",
        occurredAt: new Date("2026-03-29T12:34:56.000Z"),
        member: {
          stripeCustomerId: "cus_123",
        },
        outputTokens: 45,
        provider: "openai-compatible",
        requestedModel: "venice/deepseek-r1-671b",
        stripeMeterStatus: "pending",
        totalTokens: 165,
      },
    ]);

    const result = await drainHostedAiUsageStripeMetering();

    expect(result).toEqual({
      configured: true,
      failed: 0,
      metered: 1,
      skipped: 0,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, requestInit] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(url).toBe("https://api.stripe.com/v1/billing/meter_events");
    const headers = new Headers(requestInit?.headers);
    expect(headers.get("authorization")).toBe("Bearer sk_test_123");
    expect(headers.get("Idempotency-Key")).toBe("usage_abc");
    const body = String(requestInit?.body ?? "");
    expect(body).toContain("event_name=ai_total_tokens");
    expect(body).toContain("identifier=usage_abc");
    expect(body).toContain("payload%5Bstripe_customer_id%5D=cus_123");
    expect(body).toContain("payload%5Bvalue%5D=165");
    expect(body).toContain("timestamp=1774787696");
    expect(mocks.markHostedAiUsageStripeMetered).toHaveBeenCalledWith({
      id: "usage_abc",
      identifier: "usage_abc",
    });
  });

  it("keeps Stripe failures retryable by leaving rows pending", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        error: {
          message: "temporary failure",
        },
      }), {
        status: 500,
      })) as typeof fetch;
    mocks.listHostedAiUsagePendingStripeMetering.mockResolvedValue([
      {
        apiKeyEnv: null,
        credentialSource: "platform",
        id: "usage_retry",
        inputTokens: 10,
        memberId: "member_123",
        occurredAt: new Date("2026-03-29T12:00:00.000Z"),
        member: {
          stripeCustomerId: "cus_123",
        },
        outputTokens: 5,
        provider: "openai-compatible",
        requestedModel: "gpt-5.4-mini",
        stripeMeterStatus: "pending",
        totalTokens: 15,
      },
    ]);

    const result = await drainHostedAiUsageStripeMetering();

    expect(result).toEqual({
      configured: true,
      failed: 1,
      metered: 0,
      skipped: 0,
    });
    expect(mocks.markHostedAiUsageStripeRetryableFailure).toHaveBeenCalledWith({
      id: "usage_retry",
      message: expect.stringContaining("HTTP 500"),
    });
  });

  it("marks permanent Stripe client failures as terminal", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        error: {
          message: "bad request",
        },
      }), {
        status: 400,
      })) as typeof fetch;
    mocks.listHostedAiUsagePendingStripeMetering.mockResolvedValue([
      {
        apiKeyEnv: null,
        credentialSource: "platform",
        id: "usage_bad_request",
        inputTokens: 10,
        memberId: "member_123",
        occurredAt: new Date("2026-03-29T12:00:00.000Z"),
        member: {
          stripeCustomerId: "cus_123",
        },
        outputTokens: 5,
        provider: "openai-compatible",
        requestedModel: "gpt-5.4-mini",
        stripeMeterStatus: "pending",
        totalTokens: 15,
      },
    ]);

    const result = await drainHostedAiUsageStripeMetering();

    expect(result).toEqual({
      configured: true,
      failed: 1,
      metered: 0,
      skipped: 0,
    });
    expect(mocks.markHostedAiUsageStripeFailed).toHaveBeenCalledWith({
      id: "usage_bad_request",
      message: expect.stringContaining("HTTP 400"),
    });
    expect(mocks.markHostedAiUsageStripeRetryableFailure).not.toHaveBeenCalled();
  });

  it("skips usage without an explicit total token count", async () => {
    mocks.listHostedAiUsagePendingStripeMetering.mockResolvedValue([
      {
        apiKeyEnv: null,
        credentialSource: "platform",
        id: "usage_missing_total",
        inputTokens: 120,
        memberId: "member_123",
        occurredAt: new Date("2026-03-29T12:34:56.000Z"),
        member: {
          stripeCustomerId: "cus_123",
        },
        outputTokens: 45,
        provider: "openai-compatible",
        requestedModel: "gpt-5.4-mini",
        stripeMeterStatus: "pending",
        totalTokens: null,
      },
    ]);

    const result = await drainHostedAiUsageStripeMetering();

    expect(result).toEqual({
      configured: true,
      failed: 0,
      metered: 0,
      skipped: 1,
    });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mocks.markHostedAiUsageStripeSkipped).toHaveBeenCalledWith({
      id: "usage_missing_total",
      message: "Skipped Stripe AI metering because no total token count was available.",
    });
  });
});

describe("readHostedAiUsageStripeMeterEnvironment", () => {
  it("reads batch size and the Stripe meter event name", () => {
    expect(
      readHostedAiUsageStripeMeterEnvironment({
        HOSTED_AI_USAGE_STRIPE_BATCH_LIMIT: "16",
        HOSTED_AI_USAGE_STRIPE_METER_EVENT_NAME: "ai_total_tokens",
        STRIPE_SECRET_KEY: "sk_test_123",
      }),
    ).toEqual({
      batchLimit: 16,
      meterEventName: "ai_total_tokens",
      stripeSecretKey: "sk_test_123",
    });
  });
});
