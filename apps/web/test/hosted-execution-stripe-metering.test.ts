import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listHostedAiUsagePendingStripeMetering: vi.fn(),
  markHostedAiUsageStripeFailed: vi.fn(),
  markHostedAiUsageStripeMetered: vi.fn(),
  markHostedAiUsageStripeSkipped: vi.fn(),
}));

vi.mock("@/src/lib/hosted-execution/usage", () => ({
  listHostedAiUsagePendingStripeMetering: mocks.listHostedAiUsagePendingStripeMetering,
  markHostedAiUsageStripeFailed: mocks.markHostedAiUsageStripeFailed,
  markHostedAiUsageStripeMetered: mocks.markHostedAiUsageStripeMetered,
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

  it("skips member-supplied API key usage instead of sending a Stripe meter event", async () => {
    mocks.listHostedAiUsagePendingStripeMetering.mockResolvedValue([
      {
        apiKeyEnv: "OPENAI_API_KEY",
        credentialSource: "member",
        id: "usage_123",
        inputTokens: 10,
        memberId: "member_123",
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
      message: "Skipped Stripe AI metering because the run used a member-supplied API key.",
    });
  });

  it("sends total-token usage to Stripe with a deterministic identifier", async () => {
    mocks.listHostedAiUsagePendingStripeMetering.mockResolvedValue([
      {
        apiKeyEnv: null,
        credentialSource: "platform",
        id: "usage_abc",
        inputTokens: 120,
        memberId: "member_123",
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
    expect(mocks.markHostedAiUsageStripeMetered).toHaveBeenCalledWith({
      id: "usage_abc",
      identifier: "usage_abc",
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
